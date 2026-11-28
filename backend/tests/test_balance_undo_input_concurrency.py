"""Real PostgreSQL ordering: Undo and quota edits serialize with OT switched off."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from queue import Queue
from threading import Event

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models import DutyAssignment, UserAccount
from app.services import balance_duties as bd, rota_assignment as assignment_service
from app.services.extra_duty import individual_limit_breaches
from app.services.rota_compute import lock_operational_inputs
from app.services.rota_rules import read_phase_one_rules
from tests.test_balance_duties import assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_leave_allocation_concurrency import assert_waiting


@pytest.mark.parametrize('winner', ['external', 'undo'])
def test_undo_waits_before_quota_validation_in_both_commit_orders(postgres_client, monkeypatch, winner):
    _client, factory, _headers = postgres_client
    monkeypatch.setattr(settings, 'ot_calendar_enabled', False)
    with factory() as db:
        def configure(rules):
            relaxed(rules)
            rules.fairness_rules.allocation_mode = 'equal_counts'
            rules.duty_count_limits.max_24hr_per_month = 2
        edit_rules(db, configure)
        unit = make_unit(db, 'UNIT_I')
        a, _b = member(db, 'Original holder', unit), member(db, 'Replacement', unit)
        setup_month(db, [unit])
        for day in (5, 12):
            assign(db, make_slot(db, unit, date(2026, 5, day)), a)
        db.commit()
        user = db.scalar(select(UserAccount))
        proposal = bd.preview(db, '2026-05', user)
        batch_id = bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)['batch_id']
        extra = make_slot(db, unit, date(2026, 5, 19))
        db.commit()
        user_id, person_id, slot_id = user.id, a.id, extra.id

    quota_seen, manual_seen = Event(), Event()
    original_load, original_validation = bd._load, assignment_service.validate_assignment

    def quota_load(*args, **kwargs):
        quota_seen.set()
        return original_load(*args, **kwargs)

    def manual_validation(*args, **kwargs):
        manual_seen.set()
        return original_validation(*args, **kwargs)

    monkeypatch.setattr(bd, '_load', quota_load)
    monkeypatch.setattr(assignment_service, 'validate_assignment', manual_validation)
    pids = Queue()

    def undo():
        with factory() as db:
            pids.put(db.scalar(text('SELECT pg_backend_pid()')))
            try:
                bd.undo(db, batch_id, db.get(UserAccount, user_id))
                return 'undone'
            except bd.BalanceError as error:
                db.rollback()
                assert error.code == 'undo_conflict'
                assert any(row['code'] == 'monthly_24hr_limit' for row in error.extra['conflicts'])
                return 'refused'

    def manual():
        with factory() as db:
            pids.put(db.scalar(text('SELECT pg_backend_pid()')))
            try:
                assignment_service.assign_person_to_slot(db, slot_id=slot_id, person_id=person_id)
                return 'assigned'
            except assignment_service.RotaAssignmentError as error:
                db.rollback()
                assert error.status_code == 409
                assert any(row['code'] == 'monthly_24hr_limit' for row in error.validation['issues'])
                return 'refused'

    with factory() as holder:
        holder_pid = holder.scalar(text('SELECT pg_backend_pid()'))
        if winner == 'external':
            lock_operational_inputs(holder)
            assignment_service.assign_person_to_slot(holder, slot_id=slot_id, person_id=person_id, commit=False)
        else:
            preview = bd.undo(holder, batch_id, holder.get(UserAccount, user_id), dry_run=True)
            assert not preview['conflicts']
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(undo if winner == 'external' else manual)
            try:
                assert_waiting(factory, pids.get(timeout=10), holder_pid, future)
                # A wait at the final UPDATE is too late: evidence must not be
                # validated before acquiring the shared scheduling lock.
                assert not (quota_seen.is_set() if winner == 'external' else manual_seen.is_set())
                if winner == 'external':
                    holder.commit()
                else:
                    bd.undo(holder, batch_id, holder.get(UserAccount, user_id))
            finally:
                holder.rollback()
            assert future.result(timeout=20) == 'refused'
    with factory() as db:
        assert not individual_limit_breaches(db, '2026-05', read_phase_one_rules(db))
        assert len(list(db.scalars(select(DutyAssignment)))) == (3 if winner == 'external' else 2)
