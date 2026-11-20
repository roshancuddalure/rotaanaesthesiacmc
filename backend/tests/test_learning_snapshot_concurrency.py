"""Real preference activation/rollback versus reviewed assignment application."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.models import DutyAssignment, RotaComputeJob, RotaLearningVersion, UserAccount
from app.services import rota_compute as compute, rota_intelligence as intelligence
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_rota_compute_concurrency import seed
from tests.test_scheduling_learning_snapshot import learning_versions


def reviewed(factory):
    user_id = seed(factory)
    with factory() as db:
        user = db.get(UserAccount, user_id)
        compute.candidate_context(db, "2026-05")
        old, current = learning_versions(db, user)
        candidate = RotaLearningVersion(operator_id=user_id, status="candidate", data={
            "weights": dict(current.data["weights"]), "training_examples": [],
            "evaluation": {"passed": True, "results": [{"context_hash": compute.context_hash(db)}]}})
        db.add(candidate)
        db.commit()
        response = compute.create_job(db, "2026-05", user)
        job = db.get(RotaComputeJob, UUID(response["id"]))
        while job.status in {"queued", "running"}:
            compute.advance(db, job, job.revision)
        return user_id, job.id, job.revision, old.id, candidate.id


@pytest.mark.parametrize("change", ["activate", "rollback"])
def test_preference_writer_waits_for_apply_then_revalidates(postgres_client, monkeypatch, change):
    _, factory, _ = postgres_client
    user_id, job_id, revision, old_id, candidate_id = reviewed(factory)
    locked, release, pid_ready = Event(), Event(), Event()
    pids = []
    original = compute.validate_assignment

    def hold(*args, **kwargs):
        locked.set()
        assert release.wait(10)
        return original(*args, **kwargs)

    monkeypatch.setattr(compute, "validate_assignment", hold)

    def apply():
        with factory() as db:
            return compute.apply_job(db, db.get(RotaComputeJob, job_id), revision,
                                     db.get(UserAccount, user_id))["status"]

    def writer():
        assert locked.wait(10)
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '8s'"))
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            pid_ready.set()
            try:
                intelligence.activate(db, db.get(RotaLearningVersion,
                    old_id if change == "rollback" else candidate_id), db.get(UserAccount, user_id),
                    rollback=change == "rollback")
                return "activated"
            except HTTPException as error:
                assert error.status_code == 409
                return "stale"

    with ThreadPoolExecutor(max_workers=2) as pool:
        allocation, activation = pool.submit(apply), pool.submit(writer)
        try:
            assert locked.wait(10) and pid_ready.wait(10)
            waiting = False
            deadline = monotonic() + 5
            with factory() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)"), {"pid": pids[0]})
                    if waiting:
                        break
                    Event().wait(0.025)
            assert waiting and not activation.done()
        finally:
            release.set()
        assert allocation.result(timeout=20) == "applied"
        assert activation.result(timeout=20) == ("activated" if change == "rollback" else "stale")
    with factory() as db:
        assert db.query(DutyAssignment).count() == 1
        if change == "rollback":
            assert db.get(RotaLearningVersion, old_id).status == "active"
        else:
            assert db.get(RotaLearningVersion, candidate_id).status == "candidate"


def test_preference_rollback_before_apply_refuses_old_proposal(postgres_client):
    _, factory, _ = postgres_client
    user_id, job_id, revision, old_id, _ = reviewed(factory)
    with factory() as db:
        intelligence.activate(db, db.get(RotaLearningVersion, old_id), db.get(UserAccount, user_id), rollback=True)
    with factory() as db:
        with pytest.raises(HTTPException) as failure:
            compute.apply_job(db, db.get(RotaComputeJob, job_id), revision, db.get(UserAccount, user_id))
        assert failure.value.status_code == 409
        assert db.query(DutyAssignment).count() == 0
