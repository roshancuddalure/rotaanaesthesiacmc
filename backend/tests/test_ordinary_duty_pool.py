"""Owner clarification: dated included-unit postings precede every duty."""
from datetime import date
import pytest
from app.models import PersonPosting, UnitFallback
from app.services import balance_duties as bd, extra_duty as ed
from app.services.extra_duty_verify import check_month
from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from tests.test_balance_duties import (
    MONTH, _manual_extra, _unposted_member, assign, days, edit_rules, leave,
    make_slot, make_unit, member, relaxed, setup_month,
)
from tests.test_balance_duties import db as db  # noqa: F401


def fixture(db):
    edit_rules(db, relaxed)
    unit = make_unit(db, 'UNIT_I')
    alpha = member(db, 'Alpha', unit)
    uma = _unposted_member(db, 'Uma')
    setup_month(db, [unit])
    target = make_slot(db, unit, days(4)[0])
    for d in days(1, 7, 10, 13):
        assign(db, make_slot(db, unit, d), alpha)
    db.commit()
    return unit, alpha, uma, target


@pytest.mark.parametrize('kind', ['missing', 'excluded', 'before_posting', 'after_posting'])
@pytest.mark.parametrize('cached', [False, True])
def test_no_dated_included_posting_blocks_ordinary_extra_and_override(db, kind, cached):
    unit, alpha, uma, target = fixture(db)
    if kind != 'missing':
        posted_unit = make_unit(db, 'CARDIAC') if kind == 'excluded' else unit
        db.add(PersonPosting(person=uma, unit=posted_unit, posting_type='1ST_CALL',
            starts_on=date(2026, 5, 15) if kind == 'before_posting' else date(2026, 5, 1),
            ends_on=date(2026, 5, 3) if kind == 'after_posting' else None, source='unit_board'))
        db.commit()
    context = candidate_context(db, MONTH) if cached else None
    result = validate_assignment(db, slot=target, person=uma, replace_existing=False, context=context)
    assert result['status'] == 'blocked'
    assert 'scope_member_excluded' in {i['code'] for i in result['issues']}
    from app.services.extra_duty_verify import load_month_state
    from app.services.superadmin_allocation import strict_blocks
    verified = load_month_state(db, MONTH)
    assert 'scope_member_excluded' in {b['code'] for b in strict_blocks(verified, uma.id, target)}
    period, _ = ed._period_and_scope(db, MONTH)
    strict = ed.build_context(db, MONTH, period, ed.get_phase_one_rules(db)[1])
    for allow_unposted in (False, True):
        blockers = ed.strict_blockers(strict, uma.id, target, unit.id, allow_unposted=allow_unposted)
        assert 'scope_member_excluded' in {b['code'] for b in blockers}


@pytest.mark.parametrize('source', ['ordinary', 'legacy_extra', 'superadmin'])
def test_independent_checker_does_not_waive_missing_posting(db, source):
    unit, alpha, uma, target = fixture(db)
    if source == 'legacy_extra':
        _manual_extra(db, target, uma, ['unposted_member'])
    else:
        row = assign(db, target, uma)
        if source == 'superadmin':
            row.source = 'superadmin_allocation'
    db.commit()
    result = check_month(db, MONTH)
    assert not result['ok']
    assert 'scope_member_excluded' in {i['code'] for i in result['violations']}
    assert result['unposted_exempt'] == 0
    assert result['ordinary_roster_fallback'] == 0


def test_missing_posting_does_not_join_candidates_targets_or_balance(db):
    unit, alpha, uma, target = fixture(db)
    _manual_extra(db, make_slot(db, unit, days(20)[0]), uma, ['unposted_member'])
    db.commit()
    context = candidate_context(db, MONTH)
    for optimized in (False, True):
        rows = slot_candidates_with_context(db, slot=target, context=context, optimized=optimized)['candidates']
        assert str(uma.id) not in {r['person_id'] for r in rows}
    assert uma.id not in bd._load(db, MONTH).level
    assert all(r['person_id'] != str(uma.id) for level in bd.shares(db, MONTH) for r in level['members_detail'])


def test_real_dated_posting_admits_zero_duty_person_without_ledger(db):
    unit, alpha, uma, target = fixture(db)
    db.add(PersonPosting(person=uma, unit=unit, posting_type='1ST_CALL',
                         starts_on=target.duty_date, ends_on=target.duty_date, source='unit_board'))
    db.commit()
    context = candidate_context(db, MONTH)
    result = validate_assignment(db, slot=target, person=uma, replace_existing=False, context=context)
    assert result['status'] == 'clear', result['issues']
    rows = slot_candidates_with_context(db, slot=target, context=context)['candidates']
    assert next(r for r in rows if r['person_id'] == str(uma.id))['validation_status'] == 'clear'
    assert bd._load(db, MONTH).avail[uma.id] == 1


def test_unlocking_configured_scope_cannot_admit_excluded_member(db):
    unit, alpha, uma, target = fixture(db)
    outside = make_unit(db, 'CARDIAC')
    db.add(PersonPosting(person=uma, unit=outside, posting_type='1ST_CALL',
                         starts_on=date(2026, 5, 1), source='unit_board'))
    period, scope = ed._period_and_scope(db, MONTH)
    scope.is_locked = False
    db.commit()
    result = validate_assignment(db, slot=target, person=uma, replace_existing=False)
    assert result['status'] == 'blocked'
    assert 'scope_member_excluded' in {i['code'] for i in result['issues']}


@pytest.mark.parametrize('block', ['leave', 'pending_leave', 'rest', 'quota', 'level', 'inactive'])
def test_real_posting_never_waives_other_rules(db, block):
    unit, alpha, uma, target = fixture(db)
    posting = PersonPosting(person=uma, unit=unit, posting_type='1ST_CALL',
                         starts_on=date(2026, 5, 1), source='unit_board')
    db.add(posting)
    if block in {'leave', 'pending_leave'}:
        leave(db, uma, target.duty_date, status='approved' if block == 'leave' else 'requested')
    elif block == 'rest':
        assign(db, make_slot(db, unit, date(2026, 5, 3)), uma)
    elif block == 'quota':
        assign(db, make_slot(db, unit, days(20)[0]), uma)
        edit_rules(db, lambda r: setattr(r.duty_count_limits, 'max_24hr_per_month', 1))
    elif block == 'level':
        uma.call_level = '3RD_CALL'
        posting.posting_type = '3RD_CALL'
    else:
        uma.active_status = 'archived'
    db.commit()
    result = validate_assignment(db, slot=target, person=uma, replace_existing=False)
    assert result['status'] != 'clear', result


@pytest.mark.parametrize('mode', [ed.MODE_STANDARD, ed.MODE_ALL_UNITS])
def test_extra_cannot_use_missing_or_excluded_people_even_explicit_fallback(db, mode):
    unit, alpha, uma, target = fixture(db)
    outside = make_unit(db, 'CARDIAC')
    member(db, 'Excluded person', outside)
    db.add(UnitFallback(unit_id=unit.id, fallback_unit_id=outside.id, position=0))
    leave(db, alpha, target.duty_date)
    db.commit()
    result = ed.plan_extra_duties(db, MONTH, mode=mode)
    decision = next(d for d in result['decisions'] if d['slot_id'] == str(target.id))
    assert decision['action'] == 'unfilled'
    assert result['summary']['unposted_used'] == 0
