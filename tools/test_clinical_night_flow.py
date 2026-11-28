"""Real planner checks for the offline flow witness and fail-closed restoration."""
from datetime import date
from pathlib import Path
import sys

import pytest
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.models import DutyAssignment, LeaveRequest
from app.services import balance_duties as bd
from tests.test_balance_duties import db as db  # noqa: F401
from tests.test_balance_hour_refinement import add, independently_safe
from tests.test_balance_night_refinement import world
import study_clinical_night_flow as clinical


@pytest.mark.parametrize('provisional', [False, True])
def test_retained_flow_candidate_passes_actual_atomic_and_independent_checks(db, provisional):
    world(db, 'equal_counts')
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    if provisional:
        for aid, row in list(state.rows.items()):
            person, unit = row['person'], state.slot_unit[row['slot'].id]
            state.remove(aid)
            state.add(aid, person, unit)
        assert all(e.assignment_id is None for entries in state.ctx.entries_by_person.values() for e in entries)
    result = clinical.study(state, level='1ST_CALL', max_trials=8)
    assert result['accepted'] and result['changed_rows'] == 2
    assert result['before']['night']['gap'] == 3 and result['after']['night']['gap'] <= 2
    assert result['after']['duties'] == result['before']['duties']
    independently_safe(db, state, original)


def test_leave_and_protected_next_day_rest_block_structural_witness_without_changes(db):
    unit, _a, b = world(db, 'equal_counts')
    add(db, unit, b, 5, 8, protected=True)
    for day in (11, 18):
        db.add(LeaveRequest(person=b, starts_on=date(2026, 5, day), ends_on=date(2026, 5, day),
                           leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY', status='approved'))
    db.commit()
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    result = clinical.study(state, level='1ST_CALL', max_trials=8)
    assert not result['accepted'] and result['refusals'].get('temporal_guided_cut', 0) >= 1
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


def test_final_holder_refusal_restores_successful_atomic_candidate_exactly(db, monkeypatch):
    world(db, 'equal_counts')
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    monkeypatch.setattr(clinical, 'audit_holders', lambda state: 'test_final_refusal')
    result = clinical.study(state, level='1ST_CALL', max_trials=1)
    assert not result['accepted'] and result['refusals']['test_final_refusal'] == 1
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


def test_final_holder_exception_restores_candidate_before_propagating(db, monkeypatch):
    world(db, 'equal_counts')
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    def refuse(_state):
        raise RuntimeError('Final checker interrupted')
    monkeypatch.setattr(clinical, 'audit_holders', refuse)
    with pytest.raises(RuntimeError, match='interrupted'):
        clinical.study(state, level='1ST_CALL', max_trials=1)
    assert clinical.snapshot(state) == before
    independently_safe(db, state, original)


@pytest.mark.parametrize('limit', ['trials', 'changes'])
def test_limits_do_not_force_any_change(db, limit):
    world(db, 'equal_counts')
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    before = clinical.snapshot(state)
    result = clinical.study(state, level='1ST_CALL', max_trials=0 if limit == 'trials' else 8,
                            max_changed=0 if limit == 'changes' else 64)
    assert not result['accepted'] and clinical.snapshot(state) == before
    independently_safe(db, state, original)
