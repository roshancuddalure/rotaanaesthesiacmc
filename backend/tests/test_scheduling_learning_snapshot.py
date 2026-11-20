"""Preference activation belongs to the reviewed scheduling snapshot, not just benchmarks."""

from datetime import datetime
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.models import DutyAssignment, RotaComputeJob, RotaLearningVersion
from app.services import rota_compute as compute, rota_intelligence as intelligence
from tests.test_rota_compute import compute_db as compute_db  # noqa: F401


def learning_versions(db, user):
    # Existing approved version states, not evidence of model quality/training.
    old = RotaLearningVersion(operator_id=user.id, status="retired", data={
        "weights": {"burden": 1, "spacing": 1, "history": 1}, "activated_at": datetime.utcnow().isoformat()})
    current = RotaLearningVersion(operator_id=user.id, status="active", data={
        "weights": {"burden": 2, "spacing": 1, "history": 1}, "activated_at": datetime.utcnow().isoformat()})
    db.add_all([old, current])
    db.commit()
    return old, current


@pytest.mark.parametrize("kind", ["members", "intelligent"])
@pytest.mark.parametrize("change", ["activate", "rollback", "weights"])
def test_reviewed_apply_refuses_changed_active_preferences_without_assignment_writes(compute_db, kind, change):
    db, user = compute_db
    old, current = learning_versions(db, user)
    if kind == "members":
        response = compute.create_job(db, "2026-05", user, "server")
    else:
        response = intelligence.start(db, "2026-05", user, {"mode": "balanced", "seconds": 3,
            "repair_slots": [], "locked_slots": [], "preferences": []})
    job = db.get(RotaComputeJob, UUID(response["id"]))
    for _ in range(8):
        if job.status == "completed":
            break
        compute.advance(db, job, job.revision)
    assert job.status == "completed"
    assert any(d.get("person_id") for d in job.state["decisions"])
    before = compute.context_hash(db)
    if change == "activate":
        candidate = RotaLearningVersion(operator_id=user.id, status="candidate", data={
            "weights": dict(current.data["weights"]), "training_examples": [],
            "evaluation": {"passed": True, "results": [{"context_hash": before}]}})
        db.add(candidate)
        db.commit()
        intelligence.activate(db, candidate, user)
    elif change == "rollback":
        intelligence.activate(db, old, user, rollback=True)
    else:
        current.data = {**current.data, "weights": {"burden": 3, "spacing": 1, "history": 1}}
        db.commit()
    assert compute.context_hash(db) != before
    with pytest.raises(HTTPException) as failure:
        compute.apply_job(db, job, job.revision, user)
    assert failure.value.status_code == 409 and job.status == "failed"
    assert db.query(DutyAssignment).count() == 0


def test_inactive_learning_and_active_audit_metadata_do_not_change_snapshot(compute_db):
    db, user = compute_db
    old, current = learning_versions(db, user)
    before = compute.context_hash(db)
    old.data = {**old.data, "weights": {"burden": 9, "spacing": 1, "history": 1}}
    current.data = {**current.data, "review_note": "Private review text", "evaluated_at": "later"}
    db.add(RotaLearningVersion(operator_id=user.id, status="candidate", data={"weights": {"burden": 4}}))
    db.commit()
    assert compute.context_hash(db) == before
