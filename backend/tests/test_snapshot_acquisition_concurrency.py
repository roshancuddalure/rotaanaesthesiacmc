"""A new proposal cannot certify a context older than its recorded input hash."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic
from uuid import UUID

import pytest
from sqlalchemy import select, text

from app.models import DutyAssignment, DutySlot, Person, RotaComputeJob, UserAccount
from app.services import rota_compute as compute, rota_intelligence as intelligence
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_rota_compute_concurrency import seed


@pytest.mark.parametrize("kind", ["members", "intelligent"])
def test_creator_snapshot_precedes_edit_that_waited_for_context_read(postgres_client, monkeypatch, kind):
    _, factory, _ = postgres_client
    user_id = seed(factory)
    loaded, release, pid_ready = Event(), Event(), Event()
    pids = []
    original = compute.candidate_context

    def hold(*args, **kwargs):
        context = original(*args, **kwargs)
        if not loaded.is_set():
            loaded.set()
            assert release.wait(12)
        return context

    monkeypatch.setattr(compute, "candidate_context", hold)
    monkeypatch.setattr(intelligence, "candidate_context", hold)

    def create():
        with factory() as db:
            user = db.get(UserAccount, user_id)
            if kind == "members":
                return compute.create_job(db, "2026-05", user)["id"]
            return intelligence.start(db, "2026-05", user, {"mode": "balanced", "seconds": 1,
                "repair_slots": [], "locked_slots": [], "preferences": []})["id"]

    def writer():
        assert loaded.wait(12)
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '10s'"))
            person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
            slot = db.scalar(select(DutySlot))
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            pid_ready.set()
            db.add(DutyAssignment(person=person, duty_slot=slot, status="assigned", source="race_fixture"))
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        creator, edit = pool.submit(create), pool.submit(writer)
        waiting = False
        try:
            assert loaded.wait(12) and pid_ready.wait(12)
            deadline = monotonic() + 4
            with factory() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)"), {"pid": pids[0]})
                    if waiting or edit.done():
                        break
                    Event().wait(0.025)
        finally:
            release.set()
        job_id = UUID(creator.result(timeout=20))
        edit.result(timeout=20)
    with factory() as db:
        job = db.get(RotaComputeJob, job_id)
        assert db.query(DutyAssignment).count() == 1
        assert sum(p["total"] for p in job.state["baseline_loads"]) == 0
        # Before the fix the writer committed during the held read, and the
        # creator certified its old zero-duty context using the writer's new hash.
        assert job.context_hash != compute.context_hash(db), "Old zero-duty evidence was certified with the new duty hash"
        assert waiting, "Input writer did not wait for coherent preview acquisition"
