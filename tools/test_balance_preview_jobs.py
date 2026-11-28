"""Durable review-only Balance lifecycle over real isolated database records."""
from datetime import date
from pathlib import Path
import sys
from uuid import UUID
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.models import DutyAssignment, LeaveRequest, UserAccount
from app.db.session import Base
from app.services import balance_duties as bd, balance_preview_jobs as jobs, rota_compute as compute
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_night_refinement import world


def setup(db, user, monkeypatch):
    _unit, a, b = world(db, 'equal_counts')
    import app.services.allocation_hours as hours
    import app.services.allocation_nights as nights
    monkeypatch.setattr(hours, 'refine_hours', lambda *a, **k: None)
    monkeypatch.setattr(nights, 'refine_nights', lambda *a, **k: None)
    original = {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))}
    started = jobs.start(db, '2026-05', user)
    assert started['status'] == 'queued'
    assert jobs.start(db, '2026-05', user)['id'] == started['id']
    jobs.run(started['id'], engine=db.get_bind())
    job = jobs.owned(db, started['id'], user)
    assert job.status == 'completed', job.state
    assert {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))} == original
    return job, original, a, b


def test_durable_preview_apply_is_atomic_idempotent_and_undo_restores_exactly(db, user, monkeypatch):
    job, original, _a, _b = setup(db, user, monkeypatch)
    preview = jobs.public(job, user)['preview']
    import app.services.allocation_joint_nights as joint
    monkeypatch.setattr(joint, 'study', lambda *a, **k: pytest.fail('Apply repeated long solver search'))
    result = jobs.apply(db, job.id, '2026-05', preview['token'], preview['plan_hash'], user)
    assert jobs.owned(db, job.id, user).status == 'applied'
    assert check_month(db, '2026-05')['ok']
    again = jobs.apply(db, job.id, '2026-05', preview['token'], preview['plan_hash'], user)
    assert again['already_applied'] and again['batch_id'] == result['batch_id']
    bd.undo(db, UUID(result['batch_id']), user)
    assert {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))} == original


def test_cancelled_job_token_cannot_use_job_apply_or_legacy_apply(db, user, monkeypatch):
    job, original, _a, _b = setup(db, user, monkeypatch)
    preview = jobs.public(job, user)['preview']
    assert jobs.cancel(db, job.id, user)['status'] == 'cancelled'
    with pytest.raises(bd.BalanceError, match='Complete and review'):
        jobs.apply(db, job.id, '2026-05', preview['token'], preview['plan_hash'], user)
    with pytest.raises(bd.BalanceError) as denied:
        bd.apply(db, '2026-05', preview['token'], preview['plan_hash'], user)
    assert denied.value.code == 'bad_token'
    jobs.run(job.id, engine=db.get_bind())
    assert jobs.owned(db, job.id, user).status == 'cancelled'
    assert {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))} == original


def test_changed_leave_refuses_stored_witness_without_writes(db, user, monkeypatch):
    job, original, _a, b = setup(db, user, monkeypatch)
    preview = jobs.public(job, user)['preview']
    db.add(LeaveRequest(person=b, starts_on=date(2026, 5, 4), ends_on=date(2026, 5, 4),
                       leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY', status='approved'))
    db.commit()
    with pytest.raises(bd.BalanceError) as stale:
        jobs.apply(db, job.id, '2026-05', preview['token'], preview['plan_hash'], user)
    assert stale.value.code == 'stale_preview'
    db.rollback()
    assert {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))} == original


def test_job_owner_and_generic_compute_routes_cannot_bypass_review(db, user, monkeypatch):
    job, original, _a, _b = setup(db, user, monkeypatch)
    other = UserAccount(username='other-job-admin', display_name='Other', role='computer_admin', password_hash='x')
    db.add(other)
    db.commit()
    with pytest.raises(HTTPException) as denied:
        jobs.owned(db, job.id, other)
    assert denied.value.status_code == 403
    for function in (lambda: compute.advance(db, job, job.revision),
                     lambda: compute.apply_job(db, job, job.revision, operator=user)):
        with pytest.raises(HTTPException) as blocked:
            function()
        assert blocked.value.status_code == 409
    assert {r.id: (r.person_id, r.source) for r in db.scalars(select(DutyAssignment))} == original


def test_interrupted_running_job_resumes_and_completed_job_is_not_recomputed(db, user, monkeypatch):
    world(db, 'equal_counts')
    started = jobs.start(db, '2026-05', user)
    job = jobs.owned(db, started['id'], user)
    job.status = 'running'
    job.state = {**job.state, 'balance_preview': {'version': 1, 'attempt': 'dead-worker'}}
    db.commit()
    jobs.run(job.id, engine=db.get_bind())
    completed = jobs.owned(db, job.id, user)
    assert completed.status == 'completed', completed.state
    revision = completed.revision
    monkeypatch.setattr(bd, '_plan', lambda *a, **k: pytest.fail('Ready job recomputed'))
    jobs.run(job.id, engine=db.get_bind())
    assert jobs.owned(db, job.id, user).revision == revision


def test_real_background_owner_excludes_duplicate_worker_and_cancel_never_publishes(tmp_path, monkeypatch):
    engine = create_engine('sqlite+pysqlite:///'+str(tmp_path/'isolated-background.db'),
                           connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        world(db, 'equal_counts')
        user = UserAccount(username='background-admin', display_name='Background', role='superadmin', password_hash='x')
        db.add(user)
        db.commit()
        user_id = user.id
        started = jobs.start(db, '2026-05', user)
        original = {r.id: r.person_id for r in db.scalars(select(DutyAssignment))}
    entered, release = Event(), Event()
    calls = []
    original_plan = bd._plan
    def paused(*args, **kwargs):
        calls.append(1)
        entered.set()
        assert release.wait(15)
        return original_plan(*args, **kwargs)
    monkeypatch.setattr(bd, '_plan', paused)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(jobs.run, started['id'], engine=engine)
            try:
                assert entered.wait(10)
                duplicate = pool.submit(jobs.run, started['id'], engine=engine)
                duplicate.result(timeout=5)
                with Session(engine) as db:
                    user = db.get(UserAccount, user_id)
                    assert jobs.public(jobs.owned(db, started['id'], user), user)['status'] == 'running'
                    assert jobs.cancel(db, started['id'], user)['status'] == 'cancelled'
            finally:
                release.set()
            first.result(timeout=30)
        assert calls == [1]
        with Session(engine) as db:
            assert db.get(jobs.RotaComputeJob, UUID(started['id'])).status == 'cancelled'
            assert {r.id: r.person_id for r in db.scalars(select(DutyAssignment))} == original
    finally:
        engine.dispose()


def test_revoked_owner_cannot_receive_a_ready_preview(db, user):
    world(db, 'equal_counts')
    started = jobs.start(db, '2026-05', user)
    user.active_status = 'inactive'
    db.commit()
    jobs.run(started['id'], engine=db.get_bind())
    job = db.get(jobs.RotaComputeJob, UUID(started['id']), populate_existing=True)
    assert job.status == 'failed' and job.state['error_code'] == 'permission_changed'
    assert 'plan' not in job.state['balance_preview']
