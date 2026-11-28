"""Experimental exchanges exercised through real planner and independent clinical checks."""
from datetime import date

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, LeaveRequest
from app.services import balance_duties as bd
from app.services.extra_duty_verify import load_month_state
from app.services.rota_rules import DutyRule
from app.services.allocation_hours import refine_hours
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month


def fixture(db, policy):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = policy
        rules.duty_rules.append(DutyRule(key='HOUR_DAY', label='Day', group='audit',
            duration_hours=8, end_time='16:00', allowed_call_levels=['1ST_CALL']))
    edit_rules(db, configure)
    unit = make_unit(db, 'HOUR_TEST')
    people = [member(db, name, unit) for name in ['Higher hours', 'Lower hours', 'Third person']]
    setup_month(db, [unit])
    return unit, people


def add(db, unit, person, day, hours, protected=False):
    return assign(db, make_slot(db, unit, date(2026, 5, day),
                               duty_type='MAIN_1ST_24HR' if hours == 24 else 'HOUR_DAY', hours=hours),
                  person, **({'source': 'manual_rota_board'} if protected else {}))


def independently_safe(db, state, original):
    check = load_month_state(db, '2026-05', rules=state.rules)
    removed = set(state.rows)
    for mapping in (check.duties_by_person, check.active_by_slot):
        for key, duties in mapping.items():
            mapping[key] = [duty for duty in duties if duty.key not in removed]
    for aid, row in state.rows.items():
        check.add_duty(row['person'], row['slot'], aid)
    for aid, row in state.rows.items():
        assert not check.blockers(row['person'], row['slot'], state.slot_unit[row['slot'].id], exclude_key=aid)
    assert {row.id: row.person_id for row in db.scalars(select(DutyAssignment))} == original
    assert not db.dirty and not db.new


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
@pytest.mark.parametrize('cache', [False, True])
def test_real_swap_equalizes_hours_and_preserves_counts_weekends_credits(db, policy, cache):
    unit, (a, b, _c) = fixture(db, policy)
    for day in (4, 10):
        add(db, unit, a, day, 24)
    for day in (7, 13):
        add(db, unit, b, day, 8)
    db.commit()
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    result = refine_hours(state, record_moves=False, cache_rejections=cache)
    assert result['swaps'] == 1
    group = next(g for g in result['levels'] if g['call_level'] == '1ST_CALL')
    # The third, zero-duty member remains included in fairness reporting.
    assert group['before_hour_gap'] == 48 and group['after_hour_gap'] == 32
    assert result['duty_counts_preserved'] and result['weekends_preserved'] and result['extra_credits_preserved']
    independently_safe(db, state, original)


@pytest.mark.parametrize('cache', [False, True])
def test_related_person_change_reopens_previously_rest_blocked_exchange(db, cache):
    unit, (a, b, c) = fixture(db, 'equal_counts')
    for day in (4, 11, 18, 25):
        add(db, unit, a, day, 24)
    add(db, unit, b, 3, 24)
    for day in (7, 14):
        add(db, unit, b, day, 8)
    for day in (10, 17):
        add(db, unit, c, day, 8)
    for day in (18, 25):
        db.add(LeaveRequest(person=b, leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY',
                            starts_on=date(2026, 5, day), ends_on=date(2026, 5, day), status='approved'))
    db.commit()
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    result = refine_hours(state, record_moves=False, max_trials=1000, cache_rejections=cache)
    assert result['swaps'] == 3
    assert sorted(sum(int((r['slot'].ends_at-r['slot'].starts_at).total_seconds()/3600)
                      for r in state.rows.values() if r['person'] == p.id) for p in (a, b, c)) == [32, 56, 64]
    independently_safe(db, state, original)


@pytest.mark.parametrize('limit', ['trials', 'inspections', 'protected'])
def test_bounds_and_protected_rows_never_force_an_exchange(db, limit):
    unit, (a, b, _c) = fixture(db, 'equal_counts')
    for day in (4, 10):
        add(db, unit, a, day, 24, protected=limit == 'protected')
    for day in (7, 13):
        add(db, unit, b, day, 8)
    db.commit()
    original = {row.id: row.person_id for row in db.scalars(select(DutyAssignment))}
    state = bd._load(db, '2026-05')
    result = refine_hours(state, record_moves=False, max_trials=0 if limit == 'trials' else 128,
                   max_inspections=0 if limit == 'inspections' else 20000)
    assert result['swaps'] == 0
    independently_safe(db, state, original)


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_reviewed_hours_only_plan_applies_verifies_and_undoes_exactly(db, user, policy):
    from app.services.extra_duty_verify import check_month

    unit, (a, b, c) = fixture(db, policy)
    c.active_status = 'inactive'
    for day in (4, 10):
        add(db, unit, a, day, 24)
    for day in (7, 13):
        add(db, unit, b, day, 8)
    db.commit()
    original = {row.id: (row.person_id, row.source, row.duty_slot.unit_id)
                for row in db.scalars(select(DutyAssignment))}
    proposal = bd.preview(db, '2026-05', user)
    assert proposal['summary']['hours_refinement']['swaps'] == 1
    assert len(proposal['moves']) == 2
    group = proposal['summary']['hours_refinement']['levels'][0]
    assert group['before_hour_gap'] == 32 and group['after_hour_gap'] == 0
    applied = bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)
    assert check_month(db, '2026-05')['ok']
    assert bd.undo(db, applied['batch_id'], user, dry_run=True)['conflicts'] == []
    bd.undo(db, applied['batch_id'], user)
    db.expire_all()
    assert {row.id: (row.person_id, row.source, row.duty_slot.unit_id)
            for row in db.scalars(select(DutyAssignment))} == original
