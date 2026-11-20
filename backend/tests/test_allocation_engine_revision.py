"""Algorithm revisions stale drafts and benchmark proofs without roster edits."""

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import DutyAssignment
from app.services import allocation_objectives, rota_compute, rota_intelligence
from app.services.operational_import import fingerprint
from app.services.scheduling_snapshot import capture
from tests.test_rota_compute import compute_db as compute_db
from tests.test_rota_intelligence import complete


def test_algorithm_revision_changes_scheduling_and_benchmark_not_import_data(compute_db, monkeypatch):
    db, _ = compute_db
    rota_compute.prepare_planning_inputs(db, "2026-05")
    before = capture(db)
    raw = json.loads(before.canonical_json)
    assert raw["engine_revisions"] == {"optimizer_objective": 2}
    assert raw["snapshot_version"] == 5
    imported = fingerprint(db)
    proof = rota_intelligence.benchmark_context_hash(before.digest, None)
    monkeypatch.setattr(allocation_objectives, "OPTIMIZER_OBJECTIVE_REVISION", 3)
    changed = capture(db)
    assert json.loads(changed.canonical_json)["tables"] == raw["tables"]
    assert changed.digest != before.digest
    assert rota_intelligence.benchmark_context_hash(changed.digest, None) != proof
    assert fingerprint(db) == imported
    monkeypatch.setattr(allocation_objectives, "OPTIMIZER_OBJECTIVE_REVISION", 2)
    assert capture(db) == before


@pytest.mark.parametrize("stage", ["advance", "apply"])
def test_pre_revision_proposal_cannot_resume_or_apply(compute_db, monkeypatch, stage):
    db, user = compute_db
    # Simulate a draft generated before this correction with otherwise identical data.
    with monkeypatch.context() as earlier:
        earlier.setattr(allocation_objectives, "OPTIMIZER_OBJECTIVE_REVISION", 1)
        job = complete(db, user)
        assert job.status == "completed"
        assert job.context_hash == capture(db).digest
    assert capture(db).digest != job.context_hash
    revision = job.revision
    if stage == "advance":
        job.status = "running"
        db.commit()
    with pytest.raises(HTTPException) as error:
        if stage == "advance":
            rota_intelligence.advance(db, job, revision)
        else:
            rota_compute.apply_job(db, job, revision, dry_run=True)
    assert error.value.status_code == 409
    db.expire_all()
    assert job.status == "failed"
    assert "fresh draft" in job.state["error"]
    assert list(db.scalars(select(DutyAssignment))) == []
