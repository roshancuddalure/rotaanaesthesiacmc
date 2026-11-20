"""All reviewed creation paths recheck authority after their input-lock boundary."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RotaComputeJob, RotaPeriod
from app.services import rota_compute as compute, rota_intelligence as intelligence, template_compute
from tests.test_rota_compute import compute_db as compute_db  # noqa: F401


@pytest.mark.parametrize("kind", ["members", "intelligent", "template"])
def test_creation_rechecks_draft_after_acquiring_fresh_inputs(compute_db, monkeypatch, kind):
    db, user = compute_db
    period_id = db.scalar(select(RotaPeriod.id))
    original = compute.lock_operational_inputs

    def changed_before_lock(session):
        with Session(session.get_bind()) as editor:
            editor.get(RotaPeriod, period_id).status = "published"
            editor.commit()
        original(session)

    monkeypatch.setattr(compute, "lock_operational_inputs", changed_before_lock)
    with pytest.raises(HTTPException) as failure:
        if kind == "members":
            compute.create_job(db, "2026-05", user)
        elif kind == "intelligent":
            intelligence.start(db, "2026-05", user, {"mode": "balanced", "seconds": 1,
                "repair_slots": [], "locked_slots": [], "preferences": []})
        else:
            template_compute.start(db, "2026-05", user, {"duty_keys": ["MAIN_1ST_24HR"],
                "starts_on": "2026-05-02", "ends_on": "2026-05-02"}, "server")
    assert failure.value.status_code == 409
    assert db.query(RotaComputeJob).count() == 0
