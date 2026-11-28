"""Actual PostgreSQL worker ownership and Apply/cancel atomicity."""
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Event
from threading import current_thread
from uuid import UUID

from sqlalchemy import event, select, text

from app.models import DutyAssignment, UserAccount, RotaComputeJob
from app.services import balance_duties as bd, balance_preview_jobs as jobs
from app.services import extra_duty_verify
from tests.test_balance_night_refinement import world
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_leave_allocation_concurrency import assert_waiting


def create(factory):
    with factory() as db:
        world(db, 'equal_counts')
        user = db.scalar(select(UserAccount))
        result = jobs.start(db, '2026-05', user)
        original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
        return UUID(result['id']), user.id, db.get_bind(), original


def test_pg_worker_lock_rejects_duplicate_and_concurrent_cancel_never_publishes(postgres_client, monkeypatch):
    _client, factory, _headers = postgres_client
    identity, user_id, engine, original = create(factory)
    entered, release = Event(), Event()
    calls = []
    original_plan = bd._plan
    def paused(*args, **kwargs):
        calls.append(1)
        entered.set()
        assert release.wait(20)
        return original_plan(*args, **kwargs)
    monkeypatch.setattr(bd, '_plan', paused)
    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(jobs.run, identity, engine=engine)
        try:
            assert entered.wait(15)
            duplicate = pool.submit(jobs.run, identity, engine=engine)
            duplicate.result(timeout=10)
            with factory() as db:
                user = db.get(UserAccount, user_id)
                assert jobs.owned(db, identity, user).status == 'running'
                assert jobs.cancel(db, identity, user)['status'] == 'cancelled'
        finally:
            release.set()
        first.result(timeout=30)
    assert calls == [1]
    with factory() as db:
        assert db.get(RotaComputeJob, identity).status == 'cancelled'
        assert {r.id: r.person_id for r in db.scalars(select(DutyAssignment))} == original
    # The session-level worker lock was released, not leaked into a pooled connection.
    with engine.connect() as connection, jobs.worker_ownership(connection, identity) as acquired:
        assert acquired


def test_pg_cancel_waits_for_apply_and_cannot_erase_its_committed_job_result(postgres_client, monkeypatch):
    _client, factory, _headers = postgres_client
    identity, user_id, engine, _original = create(factory)
    jobs.run(identity, engine=engine)
    with factory() as db:
        user = db.get(UserAccount, user_id)
        job = jobs.owned(db, identity, user)
        assert job.status == 'completed', job.state
        preview = jobs.public(job, user)['preview']
    verified, release = Event(), Event()
    original_verify = extra_duty_verify.check_month
    def paused_verification(*args, **kwargs):
        result = original_verify(*args, **kwargs)
        verified.set()
        assert release.wait(20)
        return result
    monkeypatch.setattr(extra_duty_verify, 'check_month', paused_verification)
    apply_pid, cancel_pid = Queue(), Queue()
    def apply():
        with factory() as db:
            apply_pid.put(db.scalar(text('SELECT pg_backend_pid()')))
            return jobs.apply(db, identity, '2026-05', preview['token'], preview['plan_hash'], db.get(UserAccount, user_id))
    def cancel():
        with factory() as db:
            cancel_pid.put(db.scalar(text('SELECT pg_backend_pid()')))
            return jobs.cancel(db, identity, db.get(UserAccount, user_id))
    with ThreadPoolExecutor(max_workers=2) as pool:
        applying = pool.submit(apply)
        try:
            assert verified.wait(15)
            cancelling = pool.submit(cancel)
            assert_waiting(factory, cancel_pid.get(timeout=10), apply_pid.get(timeout=10), cancelling)
        finally:
            release.set()
        result = applying.result(timeout=30)
        cancelled = cancelling.result(timeout=30)
    assert result['batch_id'] and cancelled['status'] == 'applied'
    with factory() as db:
        job = db.get(RotaComputeJob, identity)
        assert job.status == 'applied' and job.state['result']['batch_id'] == result['batch_id']
        assert original_verify(db, '2026-05')['ok']


def test_pg_initial_worker_claim_locks_before_concurrent_cancellation(postgres_client, monkeypatch):
    _client, factory, _headers = postgres_client
    identity, user_id, engine, original = create(factory)
    claim_seen, release_claim, release_plan = Event(), Event(), Event()
    owner_pid, cancel_pid = Queue(), Queue()
    original_plan = bd._plan
    def paused_plan(*args, **kwargs):
        assert release_plan.wait(20)
        return original_plan(*args, **kwargs)
    monkeypatch.setattr(bd, '_plan', paused_plan)
    def observe_claim(connection, cursor, statement, params, context, many):
        if (current_thread().name.startswith('balance-claim-owner') and not claim_seen.is_set()
                and statement.lstrip().upper().startswith('SELECT') and 'rota_compute_jobs' in statement):
            owner_pid.put(connection.connection.driver_connection.info.backend_pid)
            claim_seen.set()
            assert release_claim.wait(20)
    event.listen(engine, 'after_cursor_execute', observe_claim)
    def cancel():
        with factory() as db:
            cancel_pid.put(db.scalar(text('SELECT pg_backend_pid()')))
            return jobs.cancel(db, identity, db.get(UserAccount, user_id))
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='balance-claim-owner') as owner_pool:
            worker = owner_pool.submit(jobs.run, identity, engine=engine)
            try:
                assert claim_seen.wait(15)
                with ThreadPoolExecutor(max_workers=1) as cancel_pool:
                    cancelling = cancel_pool.submit(cancel)
                    try:
                        # Cancellation must wait for the initial claim transaction,
                        # never commit and then be overwritten by a stale worker read.
                        assert_waiting(factory, cancel_pid.get(timeout=10), owner_pid.get(timeout=10), cancelling)
                    finally:
                        release_claim.set()
                    assert cancelling.result(timeout=10)['status'] == 'cancelled'
            finally:
                release_claim.set()
                release_plan.set()
            worker.result(timeout=30)
        with factory() as db:
            assert db.get(RotaComputeJob, identity).status == 'cancelled'
            assert {r.id: r.person_id for r in db.scalars(select(DutyAssignment))} == original
    finally:
        release_claim.set()
        release_plan.set()
        event.remove(engine, 'after_cursor_execute', observe_claim)
