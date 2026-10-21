"""Real PostgreSQL races across reviewed template creation/apply/cancel/reversal."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.models import DutySlot, DutyAssignment, RotaComputeJob, UserAccount, Unit
from app.services import rota_compute as compute, template_compute as template
from app.services.generation_undo import revert
from app.services.rota_setup import monthly_setup, update_scope_units
from tests.test_import_concurrency import postgres_client as postgres_fixture
from tests.test_rota_compute_concurrency import simultaneous
from tests.test_rota_auto_fill import seed_auto_fill_context
from tests.test_template_compute import CONFIG
import pytest


@pytest.fixture
def postgres_client():
    yield from postgres_fixture.__wrapped__()


def seed(factory, completed=False):
    with factory() as db:
        seed_auto_fill_context(db)
        db.execute(delete(DutySlot))
        period, scope = monthly_setup(db, "2026-05")
        unit = db.scalar(select(Unit))
        update_scope_units(db, scope, [unit.id], [], True, True, "Concurrent generation fixture")
        user = db.scalar(select(UserAccount))
        if not completed:
            return user.id, None, None
        result = template.start(db, "2026-05", user, CONFIG, "server")
        job = db.get(RotaComputeJob, UUID(result["id"]))
        compute.advance(db, job, job.revision)
        assert job.status == "completed" and db.query(DutySlot).count() == 0
        return user.id, job.id, job.revision


def test_parallel_template_start_has_one_proposal(postgres_client):
    _, factory, _ = postgres_client
    uid, _, _ = seed(factory)

    def start():
        with factory() as db:
            try:
                return template.start(db, "2026-05", db.get(UserAccount, uid), CONFIG, "server")[
                    "id"
                ]
            except HTTPException as error:
                assert error.status_code == 409
                return "conflict"

    results = simultaneous([start, start])
    assert results.count("conflict") == 1
    with factory() as db:
        assert db.query(RotaComputeJob).count() == 1 and db.query(DutySlot).count() == 0


def test_template_double_apply_is_atomic_and_idempotent(postgres_client):
    _, factory, _ = postgres_client
    uid, jid, revision = seed(factory, True)

    def apply():
        with factory() as db:
            user = db.get(UserAccount, uid)
            return compute.apply_job(db, compute.owned_job(db, jid, user), revision, user)

    results = simultaneous([apply, apply])
    assert all(r["status"] == "applied" for r in results)
    with factory() as db:
        assert db.query(DutySlot).count() == 4 and db.query(DutyAssignment).count() == 0


def test_template_cancel_racing_apply_has_one_terminal_outcome(postgres_client):
    _, factory, _ = postgres_client
    uid, jid, revision = seed(factory, True)

    def apply():
        with factory() as db:
            user = db.get(UserAccount, uid)
            try:
                return compute.apply_job(db, compute.owned_job(db, jid, user), revision, user)[
                    "status"
                ]
            except HTTPException as error:
                assert error.status_code == 409
                return "conflict"

    def cancel():
        with factory() as db:
            user = db.get(UserAccount, uid)
            return compute.cancel(db, compute.owned_job(db, jid, user))["status"]

    simultaneous([apply, cancel])
    with factory() as db:
        job = db.get(RotaComputeJob, jid)
        assert job.status in {"applied", "cancelled"}
        assert db.query(DutySlot).count() == (4 if job.status == "applied" else 0)
        assert db.query(DutyAssignment).count() == 0


def test_parallel_template_reversal_removes_only_applied_duties(postgres_client):
    _, factory, _ = postgres_client
    uid, jid, revision = seed(factory, True)
    with factory() as db:
        user = db.get(UserAccount, uid)
        applied = compute.apply_job(db, compute.owned_job(db, jid, user), revision, user)
        revision = applied["revision"]

    def reverse():
        with factory() as db:
            user = db.get(UserAccount, uid)
            return revert(db, compute.owned_job(db, jid, user), revision, user)["status"]

    assert simultaneous([reverse, reverse]) == ["reverted", "reverted"]
    with factory() as db:
        assert db.query(DutySlot).count() == 0 and db.query(DutyAssignment).count() == 0
