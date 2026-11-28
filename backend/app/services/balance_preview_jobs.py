"""Durable Balance previews; background work never applies operational duties.

Existing member/template compute remains cooperative. This separate workload
uses the existing job table/month exclusion and a PostgreSQL session advisory
lock, so a lost worker can be resumed without two workers owning the same job.
SQLite's in-process guard is for local single-process development and tests.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
from threading import Lock, BoundedSemaphore
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import RotaComputeJob, UserAccount
from app.services import balance_duties as bd, extra_duty as ed, rota_compute as compute
from app.services.auth import ADMIN_ROLES

EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix='balance-preview')
ADMISSION = BoundedSemaphore(2)
LOCAL_GUARD = Lock()
LOCAL_LOCKS = {}


def owned(db, identity, user, *, locked=False):
    statement = select(RotaComputeJob).where(RotaComputeJob.id == UUID(str(identity))).execution_options(populate_existing=True)
    job = db.scalar(statement.with_for_update() if locked else statement)
    if job is None or not job.state.get('balance_preview'):
        raise HTTPException(404, 'Balance preview job not found')
    if user.role not in ADMIN_ROLES or user.active_status != 'active' or (job.operator_id != user.id and user.role != 'superadmin'):
        raise HTTPException(403, 'This Balance preview belongs to another operator')
    return job


def public(job, user):
    value = dict(id=str(job.id), month=job.month, status=job.status, revision=job.revision,
                 error=job.state.get('error'), error_code=job.state.get('error_code'))
    plan = job.state['balance_preview'].get('plan')
    if job.status == 'completed' and plan:
        plan = deepcopy(plan)
        plan['preview_job_id'] = str(job.id)
        plan['token'] = ed.make_token(plan['plan_hash'], plan['context_hash'], job.month, user,
                                      'balance-job:' + str(job.id))
        value['preview'] = plan
    if job.status == 'applied':
        value['result'] = job.state.get('result')
    return value


def start(db, month, user):
    bd._ensure_enabled()
    bd._draft(db, month)
    compute.prepare_planning_inputs(db, month)
    existing = db.scalar(select(RotaComputeJob).where(
        RotaComputeJob.month == month, RotaComputeJob.status.in_(compute.ACTIVE)))
    if (existing is not None and existing.state.get('balance_preview')
            and datetime.utcnow()-existing.created_at > timedelta(hours=2)):
        owned(db, existing.id, user)
        existing.status = 'failed'
        existing.state = {**existing.state, 'error_code': 'stale_preview', 'error': 'This preview expired. Start a fresh preview.'}
        db.flush()
        existing = None
    if existing is not None and existing.state.get('balance_preview'):
        job = owned(db, existing.id, user)
        db.commit()
        return public(job, user)
    bd._refuse_active_proposal(db, month, user)
    data = compute.create_job(db, month, user, commit=False)
    job = db.get(RotaComputeJob, UUID(data['id']))
    job.state = {**job.state, 'balance_preview': {'version': 1}}
    db.commit()
    return public(job, user)


@contextmanager
def worker_ownership(connection, identity):
    if connection.dialect.name == 'postgresql':
        key = int.from_bytes(hashlib.sha256(('balance-preview:'+str(identity)).encode()).digest()[:8],
                             'big', signed=True)
        acquired = bool(connection.scalar(text('SELECT pg_try_advisory_lock(:key)'), {'key': key}))
        connection.commit()
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    connection.rollback()
                    connection.execute(text('SELECT pg_advisory_unlock(:key)'), {'key': key})
                    connection.commit()
                except Exception:
                    connection.invalidate()
    else:
        with LOCAL_GUARD:
            lock = LOCAL_LOCKS.setdefault((str(connection.engine.url), str(identity)), Lock())
        acquired = lock.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()


def run(identity, *, engine=None):
    """One claimed hypothetical computation; completed/cancelled jobs never rerun."""
    if engine is None:
        from app.db.session import engine
    identity = UUID(str(identity))
    with engine.connect() as connection, worker_ownership(connection, identity) as acquired:
        if not acquired:
            return
        with Session(bind=connection, autoflush=False, expire_on_commit=False) as db:
            # Lock before reading/claiming: otherwise a cancelled queued job
            # could be resurrected by a worker's later stale UPDATE.
            job = db.scalar(select(RotaComputeJob).where(RotaComputeJob.id == identity)
                            .with_for_update().execution_options(populate_existing=True))
            if job is None or not job.state.get('balance_preview') or job.status not in {'queued', 'running'}:
                return
            nonce = str(uuid4())
            job.status = 'running'
            job.state = {**job.state, 'balance_preview': {**job.state['balance_preview'], 'attempt': nonce}}
            job.revision += 1
            job.updated_at = datetime.utcnow()
            db.commit()
            try:
                bd._ensure_enabled()
                compute.prepare_planning_inputs(db, job.month)
                if compute.context_hash(db) != job.context_hash or datetime.utcnow()-job.created_at > timedelta(hours=2):
                    raise bd.BalanceError('stale_preview', 'The rota changed or the preview expired. Start again.', 409)
                plan, _state = bd._plan(db, job.month)
                db.expire_all()
                job = db.scalar(select(RotaComputeJob).where(RotaComputeJob.id == identity)
                                .with_for_update().execution_options(populate_existing=True))
                user = db.get(UserAccount, job.operator_id, populate_existing=True)
                if job.status != 'running' or job.state['balance_preview'].get('attempt') != nonce:
                    db.rollback()
                    return
                if user is None or user.role not in ADMIN_ROLES or user.active_status != 'active':
                    raise bd.BalanceError('permission_changed', 'The preview owner no longer has allocation permission.', 403)
                if plan['context_hash'] != job.context_hash or compute.context_hash(db) != job.context_hash:
                    raise bd.BalanceError('stale_preview', 'The rota changed during planning. Start again.', 409)
                job.status = 'completed'
                job.state = {**job.state, 'balance_preview': {'version': 1, 'attempt': nonce, 'plan': plan}}
                job.revision += 1
                job.updated_at = datetime.utcnow()
                db.commit()
            except Exception as exc:
                db.rollback()
                job = db.scalar(select(RotaComputeJob).where(RotaComputeJob.id == identity)
                                .with_for_update().execution_options(populate_existing=True))
                if job is not None and job.status == 'running' and job.state['balance_preview'].get('attempt') == nonce:
                    job.status = 'failed'
                    job.state = {**job.state,
                        'error_type': type(exc).__name__,
                        'error_code': exc.code if isinstance(exc, bd.BalanceError) else 'preview_failed',
                        'error': exc.message if isinstance(exc, bd.BalanceError) else 'The preview was interrupted. Start a fresh preview; no duties were changed.'}
                    job.revision += 1
                    job.updated_at = datetime.utcnow()
                    db.commit()


def launch(identity):
    if not ADMISSION.acquire(blocking=False):
        return False  # Remains durable/queued; explicit Resume can retry.
    def work():
        try:
            run(identity)
        finally:
            ADMISSION.release()
    try:
        EXECUTOR.submit(work)
    except Exception:
        ADMISSION.release()
        raise
    return True


def cancel(db, identity, user):
    job = owned(db, identity, user, locked=True)
    if job.status != 'applied':
        job.status = 'cancelled'
        job.revision += 1
        job.updated_at = datetime.utcnow()
        db.commit()
    return public(job, user)


def apply(db, identity, month, token, plan_hash, user):
    job = owned(db, identity, user)
    if job.month != month or not ed._token_valid(token, plan_hash, month, user, 'balance-job:'+str(job.id)):
        raise bd.BalanceError('bad_token', 'This reviewed job token does not match.', 403)
    if job.status == 'applied':
        return {**job.state['result'], 'already_applied': True}
    if job.status != 'completed':
        raise bd.BalanceError('stale_preview', 'Complete and review a current Balance preview first.', 409)
    if datetime.utcnow()-job.created_at > timedelta(hours=2):
        raise bd.BalanceError('stale_preview', 'This Balance preview expired. Start a fresh preview.', 409)
    plan = job.state['balance_preview']['plan']
    if plan['plan_hash'] != plan_hash or plan['context_hash'] != token.partition('.')[0]:
        raise bd.BalanceError('bad_token', 'This preview does not match the completed job.', 403)
    internal_token = ed.make_token(plan_hash, plan['context_hash'], month, user, bd.BALANCE_MODE)
    result = bd.apply(db, month, internal_token, plan_hash, user,
                      reviewed_plan=plan, reviewed_job_id=job.id)
    return result
