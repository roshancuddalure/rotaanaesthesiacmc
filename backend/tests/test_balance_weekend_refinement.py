"""Reviewed weekend exchanges must preserve totals, safety and exact Undo."""
from collections import Counter
from datetime import date

import pytest

from app.services import allocation_objectives, balance_duties as bd
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, leave, make_slot, make_unit, member, relaxed, setup_month


def fixture(db, *, policy='equal_counts', blocked=False, protected=False, mixed_hours=False):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = policy
    edit_rules(db, configure)
    unit = make_unit(db, 'WEEKEND_REVIEW')
    a, b = member(db, 'Weekend-heavy', unit), member(db, 'Weekday-heavy', unit)
    setup_month(db, [unit])
    rows = []
    for person, days in [(a, (2, 9)), (b, (5, 12))]:
        for day in days:
            slot = make_slot(db, unit, date(2026, 5, day),
                             hours=8 if mixed_hours and person == b else 24)
            kwargs = {'source': 'manual_rota_board'} if protected and person == a else {}
            rows.append(assign(db, slot, person, **kwargs))
    if blocked:
        for day in (2, 9):
            leave(db, b, date(2026, 5, day))
    db.commit()
    return rows


def test_count_balanced_weekend_imbalance_has_review_apply_and_exact_undo(db, user):
    rows = fixture(db)
    before = {row.id: (row.person_id, row.duty_slot.unit_id, row.source) for row in rows}
    proposal = bd.preview(db, '2026-05', user)
    assert proposal['summary']['weekend_refinement']['swaps'] == 1
    assert proposal['summary']['swaps'] == 1 and proposal['summary']['moves'] == 0
    assert len(proposal['moves']) == 2
    assert all(move['kind'] == 'swap' and 'weekend' in move['reason'] for move in proposal['moves'])
    assert {row.id: (row.person_id, row.duty_slot.unit_id, row.source) for row in rows} == before
    result = bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)
    db.expire_all()
    weekends = Counter(row.person_id for row in rows if row.duty_slot.duty_date.weekday() >= 5)
    assert sorted(weekends.values()) == [1, 1]
    assert sorted(Counter(row.person_id for row in rows).values()) == [2, 2]
    assert check_month(db, '2026-05')['ok']
    bd.undo(db, result['batch_id'], user)
    db.expire_all()
    assert {row.id: (row.person_id, row.duty_slot.unit_id, row.source) for row in rows} == before


@pytest.mark.parametrize('kwargs', [dict(blocked=True), dict(protected=True),
                                    dict(mixed_hours=True), dict(policy='availability')])
def test_weekend_stage_respects_leave_protection_hours_and_policy(db, user, kwargs):
    rows = fixture(db, **kwargs)
    before = {row.id: row.person_id for row in rows}
    with pytest.raises(bd.BalanceError) as error:
        bd.preview(db, '2026-05', user)
    assert error.value.code == 'nothing_to_balance'
    assert {row.id: row.person_id for row in rows} == before


def test_pre_weekend_revision_balance_preview_is_stale(db, user, monkeypatch):
    rows = fixture(db)
    before = {row.id: row.person_id for row in rows}
    with monkeypatch.context() as old:
        old.setattr(allocation_objectives, 'OPTIMIZER_OBJECTIVE_REVISION', 10)
        proposal = bd.preview(db, '2026-05', user)
    with pytest.raises(bd.BalanceError) as error:
        bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)
    assert error.value.code == 'stale_preview'
    assert {row.id: row.person_id for row in rows} == before


def test_weekend_candidate_inspection_budget_stops_without_changes(db):
    from app.services.allocation_weekend import refine_weekends
    fixture(db)
    state = bd._load(db, '2026-05')
    before = {aid: row['person'] for aid, row in state.rows.items()}
    result = refine_weekends(state, max_inspections=0, record_moves=False)
    assert result['swaps'] == result['trials'] == result['inspections'] == 0
    assert result['limit_reached']
    assert {aid: row['person'] for aid, row in state.rows.items()} == before


def test_one_exchange_budget_reduces_worst_cohort_before_polishing_smaller_gap(db):
    from app.services.rota_rules import DutyRule
    from app.services.allocation_weekend import refine_weekends
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = 'equal_counts'
        for level in ('1ST_CALL','2ND_CALL'):
            rules.duty_rules.append(DutyRule(key=f'PRIORITY_{level}',label=level,
                group='audit',duration_hours=8,start_time='08:00',end_time='16:00',
                allowed_call_levels=[level]))
    edit_rules(db,configure)
    unit = make_unit(db,'WEEKEND_PRIORITY')
    people = [member(db,f'{level} {side}',unit,level=level)
              for level in ('1ST_CALL','2ND_CALL') for side in ('weekend','weekday')]
    setup_month(db,[unit])
    for person,days in zip(people,[(2,9),(5,12),(2,3,9,10),(5,6,12,13)]):
        for day in days:
            assign(db,make_slot(db,unit,date(2026,5,day),
                   duty_type=f'PRIORITY_{person.call_level}',level=person.call_level,hours=8),person)
    db.commit()
    state = bd._load(db,'2026-05')
    totals = dict(state.duties)
    result = refine_weekends(state,max_trials=1,record_moves=False)
    levels = {r['call_level']:r for r in result['levels']}
    assert result['swaps'] == 1
    assert levels['1ST_CALL']['before_gap'] == levels['1ST_CALL']['after_gap'] == 2
    assert levels['2ND_CALL']['before_gap'] == 4 and levels['2ND_CALL']['after_gap'] == 2
    assert dict(state.duties) == totals
