"""The ordinary reviewed scorer must protect OT independently of optimizer mode."""

from uuid import UUID

import pytest
from fastapi import HTTPException

from app.models import DutyAssignment, MonthlyGenerationScopeUnit, RotaComputeJob, UserAccount
from app.services import rota_compute as compute
from app.services.compute_kernels import ranks
from app.services.extra_duty_verify import check_month
from app.services.rota_setup import monthly_setup
from tests.test_ot_assignment_integration import environment as environment, demand, slot  # noqa: F401


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
@pytest.mark.parametrize("changed_calendar", [False, True])
def test_reviewed_scorer_preserves_ot_and_rejects_changed_demand(environment, engine, changed_calendar):
    db, unit, _people, target = environment
    slot(db, unit, target.duty_date)
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    user = UserAccount(username="ot-reviewed-scoring", display_name="Anonymous operator",
                       role="computer_admin", password_hash="fixture")
    db.add(user)
    db.commit()
    response = compute.create_job(db, "2026-11", user, engine)
    job = db.get(RotaComputeJob, UUID(response["id"]))
    for _ in range(8):
        if job.status == "completed":
            break
        frame = compute.serialize(job)["frame"]
        compute.advance(db, job, job.revision,
                        ranks(frame["rows"], frame["ties"]).index(0) if frame else None,
                        frame["token"] if frame else None)
    assert job.status == "completed"
    assert not job.state.get("intelligence") and not job.state.get("template")
    assert sum(bool(d.get("person_id")) for d in job.state["decisions"]) == 1
    assert sum(d["action"] == "unresolved" for d in job.state["decisions"]) == 1
    if engine == "local_gpu":
        assert job.state["metrics"]["gpu_frames_verified"] > 0
    assert db.query(DutyAssignment).count() == 0
    assert compute.apply_job(db, job, job.revision, user, dry_run=True)["validated"]
    assert db.query(DutyAssignment).count() == 0
    if changed_calendar:
        demand(db, unit, minimum=4)
        with pytest.raises(HTTPException) as failure:
            compute.apply_job(db, job, job.revision, user)
        assert failure.value.status_code == 409
        assert job.status == "failed"
        assert db.query(DutyAssignment).count() == 0
    else:
        result = compute.apply_job(db, job, job.revision, user)
        assert result["status"] == "applied" and result["result"]["assigned"] == 1
        assert check_month(db, "2026-11")["ok"]
        assert compute.apply_job(db, job, 0, user)["result"]["assigned"] == 1
        assert db.query(DutyAssignment).count() == 1
