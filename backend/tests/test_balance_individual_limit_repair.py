"""Existing excess must be repaired without inventing exceptions or unsafe Undo."""
from datetime import date

import pytest

from app.models import ExtraDutyBatch, ExtraDutyRecord, LeaveRequest
from app.services import balance_duties as bd
from app.services import extra_duty as ed
from app.services.extra_duty_verify import check_month
from app.services.rota_rules import read_phase_one_rules
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month


def setup(db, policy='equal_counts', *, protected=False):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = policy
        rules.duty_count_limits.max_weekend_24hr_per_month = 2
    edit_rules(db, configure)
    unit = make_unit(db, 'QUOTA_REPAIR')
    a, b = member(db, 'Weekend excess', unit), member(db, 'Eligible replacement', unit)
    setup_month(db, [unit])
    weekend = [assign(db, make_slot(db, unit, date(2026, 5, day)), a,
                       **({'source': 'manual_rota_board'} if protected else {})) for day in (2, 9, 16)]
    weekday = [assign(db, make_slot(db, unit, date(2026, 5, day)), b) for day in (5, 12, 19)]
    db.commit()
    return unit, a, b, weekend, weekday


def add_exception(db, row):
    row.source = ed.EXTRA_DUTY_SOURCE
    batch = ExtraDutyBatch(rota_period_id=row.duty_slot.rota_period_id, month='2026-05',
                          status='applied', plan_hash='fixture', context_hash='fixture')
    db.add(batch)
    db.flush()
    record = ExtraDutyRecord(batch_id=batch.id, person_id=row.person_id, assignment_id=row.id,
        slot_id=row.duty_slot_id, month='2026-05', duty_date=row.duty_slot.duty_date,
        duty_type=row.duty_slot.duty_type, home_unit_id=row.duty_slot.unit_id,
        assigned_unit_id=row.duty_slot.unit_id, overridden_rules=['monthly_weekend_24hr_limit'])
    db.add(record)
    db.commit()
    return record


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_repair_apply_independent_verify_and_refuse_unsafe_undo(db, user, policy):
    _unit, a, b, weekend, weekday = setup(db, policy)
    rows = weekend + weekday
    original = {row.id: row.person_id for row in rows}
    proposal = bd.preview(db, '2026-05', user)
    repaired = proposal['summary']['individual_limit_repair']
    assert repaired['invalid_before'] == 3 and repaired['affected_members'] == 1
    assert repaired['unresolved'] == 0 and repaired['reassigned'] == 1
    assert {row.id: row.person_id for row in rows} == original
    applied = bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)
    db.expire_all()
    assert check_month(db, '2026-05')['ok']
    assert not ed.individual_limit_breaches(db, '2026-05', read_phase_one_rules(db))
    assert len(rows) == 6 and {row.person_id for row in rows} == {a.id, b.id}
    safe = {row.id: row.person_id for row in rows}
    dry = bd.undo(db, applied['batch_id'], user, dry_run=True)
    assert dry['restored'] == 0
    assert any(row['code'] == 'monthly_weekend_24hr_limit' for row in dry['conflicts'])
    with pytest.raises(bd.BalanceError) as error:
        bd.undo(db, applied['batch_id'], user)
    assert error.value.code == 'undo_conflict'
    db.expire_all()
    assert {row.id: row.person_id for row in rows} == safe


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_protected_excess_refuses_without_changing_saved_rows(db, user, policy):
    _unit, _a, _b, weekend, weekday = setup(db, policy, protected=True)
    original = {row.id: row.person_id for row in weekend + weekday}
    with pytest.raises(bd.BalanceError) as error:
        bd.preview(db, '2026-05', user)
    assert error.value.code == 'individual_limit_repair_incomplete'
    assert error.value.extra['live_changes'] == 0
    assert {row.id: row.person_id for row in weekend + weekday} == original
    assert not db.dirty and not db.new


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_quota_repair_cannot_use_a_replacement_on_approved_leave(db, user, policy):
    _unit, _a, b, weekend, weekday = setup(db, policy)
    for row in weekend:
        day = row.duty_slot.duty_date
        db.add(LeaveRequest(person=b, leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY',
                            starts_on=day, ends_on=day, status='approved'))
    db.commit()
    before = {row.id: row.person_id for row in weekend + weekday}
    with pytest.raises(bd.BalanceError) as error:
        bd.preview(db, '2026-05', user)
    assert error.value.code == 'individual_limit_repair_incomplete'
    assert {row.id: row.person_id for row in weekend + weekday} == before


def test_zero_budget_refuses_excess_without_live_changes(db):
    setup(db)
    state = bd._load(db, '2026-05')
    before = {aid: row['person'] for aid, row in state.rows.items()}
    with pytest.raises(bd.BalanceError) as error:
        bd._Planner(state, 0).repair_individual_limit_conflicts()
    assert error.value.code == 'individual_limit_repair_incomplete'
    assert {aid: row['person'] for aid, row in state.rows.items()} == before


def test_one_recorded_exception_does_not_invalidate_two_ordinary_duties(db, user):
    _unit, _a, _b, weekend, weekday = setup(db)
    add_exception(db, weekend[-1])
    state = bd._load(db, '2026-05')
    assert all(not state.existing_quota_codes(row.id) for row in weekend + weekday)
    assert bd._Planner(state, 20000).repair_individual_limit_conflicts()['invalid_before'] == 0
    before = {row.id: row.person_id for row in weekend + weekday}
    proposal = bd.preview(db, '2026-05', user)
    result = bd.apply(db, '2026-05', proposal['token'], proposal['plan_hash'], user)
    assert not bd.undo(db, result['batch_id'], user, dry_run=True)['conflicts']
    bd.undo(db, result['batch_id'], user)
    db.expire_all()
    assert {row.id: row.person_id for row in weekend + weekday} == before


def test_recorded_exception_does_not_authorise_an_additional_unrecorded_excess(db):
    unit, a, _b, weekend, _weekday = setup(db)
    add_exception(db, weekend[-1])
    fourth = assign(db, make_slot(db, unit, date(2026, 5, 23)), a)
    db.commit()
    state = bd._load(db, '2026-05')
    assert state.existing_quota_codes(fourth.id) == ['monthly_weekend_24hr_limit']
    repaired = bd._Planner(state, 20000).repair_individual_limit_conflicts()
    assert repaired['reassigned'] == 1
    assert state.rows[weekend[-1].id]['person'] == a.id
    assert all(not state.existing_quota_codes(aid) for aid in state.rows)


@pytest.mark.parametrize('invalid_record', ['duplicate', 'wrong_holder'])
def test_invalid_ledger_attribution_never_grants_an_exception(db, invalid_record):
    _unit, _a, b, weekend, _weekday = setup(db)
    record = add_exception(db, weekend[-1])
    if invalid_record == 'duplicate':
        db.add(ExtraDutyRecord(batch_id=record.batch_id, person_id=record.person_id,
            assignment_id=record.assignment_id, slot_id=record.slot_id, month=record.month,
            duty_date=record.duty_date, duty_type=record.duty_type,
            assigned_unit_id=record.assigned_unit_id, overridden_rules=list(record.overridden_rules)))
    else:
        record.person_id = b.id
    db.commit()
    state = bd._load(db, '2026-05')
    assert state.existing_quota_codes(weekend[0].id) == ['monthly_weekend_24hr_limit']
