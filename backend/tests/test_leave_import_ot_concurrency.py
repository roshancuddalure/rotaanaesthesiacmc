"""Observed PostgreSQL locks bind import OT evidence to raw calendar edits."""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue

import pytest
from sqlalchemy import event, select, text

from app.core.config import settings
from app.models import LeaveRequest, OtCalendar
from app.services.scheduling_snapshot import capture
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_leave_allocation_concurrency import assert_waiting, pid
from tests.test_leave_ot_repair_api import setup_ot_only
from tests.test_rota_compute_concurrency import seed


@pytest.mark.parametrize("operation", ["preview", "apply"])
@pytest.mark.parametrize("legacy", [False, True])
def test_calendar_edit_serializes_frozen_import_ot_evidence(
    postgres_client, monkeypatch, operation, legacy
):
    client, factory, headers = postgres_client
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    seed(factory)
    with factory() as db:
        setup_ot_only(db)
        calendar_id = db.scalar(select(OtCalendar.id))
        count = db.query(LeaveRequest).count()

    def preview():
        return client.post(
            "/api/v1/leave/import-preview?month=2026-05"
            if legacy
            else "/api/v1/import-review/leave/preview",
            headers=headers,
            data={"month": "2026-05"},
            files={
                "file": (
                    "leave.csv",
                    b"member_name,starts_on,status\nSpare One,2026-05-20,approved\n",
                    "text/csv",
                )
            },
        )

    reviewed = preview()
    assert reviewed.status_code == 200, reviewed.text
    identity = reviewed.json()["preview_hash" if legacy else "id"]
    engine = factory.kw["bind"]
    schema = engine.get_execution_options()["schema_translate_map"][None]
    table = engine.dialect.identifier_preparer.quote(schema) + ".ot_calendars"
    waiting_pid = Queue()

    def observe(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("LOCK TABLE"):
            cursor.execute("SELECT pg_backend_pid()")
            waiting_pid.put(cursor.fetchone()[0])

    def apply():
        if legacy:
            return client.post(
                "/api/v1/leave/import-apply?month=2026-05",
                headers=headers,
                data={"preview_hash": identity},
                files={
                    "file": (
                        "leave.csv",
                        b"member_name,starts_on,status\nSpare One,2026-05-20,approved\n",
                        "text/csv",
                    )
                },
            )
        return client.post(f"/api/v1/import-review/{identity}/apply", headers=headers, json={})

    event.listen(engine, "before_cursor_execute", observe)
    try:
        with factory() as holder:
            holder.execute(
                text(f"UPDATE {table} SET revision=:revision WHERE id=:identity"),
                {"revision": "c" * 64, "identity": calendar_id},
            )
            holder_pid = pid(holder)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(preview if operation == "preview" else apply)
                try:
                    assert_waiting(factory, waiting_pid.get(timeout=15), holder_pid, future)
                finally:
                    holder.commit()
                response = future.result(timeout=45)
        if operation == "apply":
            assert response.status_code == 409, response.text
        else:
            assert response.status_code == 200, response.text
            with factory() as db:
                assert response.json()["ot_impact"]["context_digest"] == capture(db).digest
        with factory() as db:
            assert db.query(LeaveRequest).count() == count
    finally:
        event.remove(engine, "before_cursor_execute", observe)
