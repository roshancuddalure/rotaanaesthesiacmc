"""Real PostgreSQL table-lock races for scope and elective availability."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from io import BytesIO
from time import monotonic, sleep

import pytest
from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import select, text

from app.models import LeaveRequest, MonthlyGenerationScopeUnit, Person
from app.services.elective_members_export import elective_members_export
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_rota_auto_fill import seed_auto_fill_context
from tests.test_elective_members_export import seed


@pytest.mark.parametrize("change", ["scope", "leave"])
def test_export_waits_for_external_input_commit_and_uses_new_state(postgres_client, change):
    _, factory, _ = postgres_client
    with factory() as db:
        seed_auto_fill_context(db)
        seed(db)
        person_id = db.scalar(select(Person).where(Person.canonical_name == "Safe Member")).id
        schema = db.get_bind().get_execution_options()["schema_translate_map"][None]

    def export():
        with factory() as db:
            try:
                return elective_members_export(db, "2026-05")[1]
            except HTTPException as error:
                return error.status_code

    table = "monthly_generation_scope_units" if change == "scope" else "leave_requests"
    with factory() as editor:
        if change == "scope":
            editor.scalar(select(MonthlyGenerationScopeUnit)).status = "excluded"
        else:
            editor.add(LeaveRequest(person_id=person_id, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 1), ends_on=date(2026, 5, 1), status="approved"))
        editor.flush()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(export)
            waiting = False
            deadline = monotonic() + 15
            try:
                while monotonic() < deadline:
                    with factory() as observer:
                        waiting = observer.scalar(text("""SELECT EXISTS (
                            SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
                            JOIN pg_namespace n ON n.oid=c.relnamespace
                            WHERE c.relname=:table AND n.nspname=:schema AND NOT l.granted)"""),
                            {"table": table, "schema": schema})
                    if waiting:
                        break
                    sleep(.03)
            finally:
                editor.commit()
            result = future.result(timeout=30)
            assert waiting, "Export must acquire a consistent scheduling-input lock"
    if change == "scope":
        assert result == 409
    else:
        assert isinstance(result, bytes)
        book = load_workbook(BytesIO(result))
        assert "Safe Member" not in {r[2] for r in list(book["2026-05-01"].values)[1:]}
        assert "Safe Member" in {r[2] for r in list(book["2026-05-02"].values)[1:]}
