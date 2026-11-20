"""Real PostgreSQL OT save races in the existing disposable-schema fixture."""

from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.models import OtCalendar, OtCalendarVersion, Unit, UserAccount
from app.services.ot_calendar_store import EMPTY_REVISION, SaveCalendar, save
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_ot_calendar_api import configuration
from tests.test_rota_compute_concurrency import simultaneous


@pytest.mark.parametrize("existing", [False, True])
def test_two_calendar_edits_with_same_base_commit_exactly_one(postgres_client, existing):
    _, factory, _ = postgres_client
    unit_id = uuid4()
    with factory() as db:
        db.add(Unit(id=unit_id, code="UNIT_OT", name="OT race unit"))
        db.commit()
        operator = db.scalar(select(UserAccount))
        operator_id = operator.id
        base = EMPTY_REVISION
        if existing:
            result = save(db, unit_id, SaveCalendar.model_validate({
                "base_revision": base, "configuration": configuration(unit_id)}), operator)
            base = result["revision"]

    def change(minimum):
        def perform():
            with factory() as db:
                cfg = configuration(unit_id)
                cfg["weekly"][0]["bands"][0]["minimum"] = minimum
                payload = SaveCalendar.model_validate({"base_revision": base, "configuration": cfg})
                try:
                    return save(db, unit_id, payload, db.get(UserAccount, operator_id))["revision"]
                except HTTPException as error:
                    assert error.status_code == 409
                    db.rollback()
                    return "conflict"
        return perform

    results = simultaneous([change(0), change(1)])
    assert results.count("conflict") == 1
    with factory() as db:
        assert db.query(OtCalendar).count() == 1
        assert db.query(OtCalendarVersion).count() == (2 if existing else 1)
        current = db.scalar(select(OtCalendar))
        assert current.revision in results
        matching = db.scalar(select(OtCalendarVersion).where(OtCalendarVersion.revision == current.revision))
        assert matching.configuration == current.configuration
