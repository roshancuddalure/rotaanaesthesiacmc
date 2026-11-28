"""Existing leave conflicts cannot survive an otherwise count-balanced proposal."""
from datetime import date

import pytest

from app.models import LeaveRequest
from app.services import balance_duties as bd
from app.services.extra_duty_verify import check_month
from app.services.rota_rules import DutyRule
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month


def setup(db, policy, *, protected=False, swap=False):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = policy
        if swap:
            rules.duty_count_limits.max_same_group_per_month = 1
        rules.duty_rules.append(DutyRule(key='LEAVE_REPAIR_TEST', label='Leave repair test',
            group='audit', duration_hours=8, start_time='18:00', end_time='02:00',
            allowed_call_levels=['1ST_CALL']))
    edit_rules(db, configure)
    unit = make_unit(db, 'LEAVE_REPAIR_TEST')
    a, b = member(db, 'Conflicting original holder', unit), member(db, 'Safe replacement', unit)
    setup_month(db, [unit])
    row = assign(db, make_slot(db, unit, date(2026,5,31), duty_type='LEAVE_REPAIR_TEST',
                              hours=8, start_hour=18), a,
                 **({'source':'manual_rota_board'} if protected else {}))
    other = assign(db, make_slot(db, unit, date(2026,5,27), duty_type='LEAVE_REPAIR_TEST',
                                hours=8, start_hour=18), b)
    db.add(LeaveRequest(person=a, leave_type='ANNUAL_LEAVE', leave_slot='AM',
                       starts_on=date(2026,6,1), ends_on=date(2026,6,1), status='approved'))
    db.commit()
    return row, other, a, b


@pytest.mark.parametrize('policy',['availability','equal_counts'])
@pytest.mark.parametrize('swap',[False,True])
def test_reviewed_repair_preserves_coverage_and_blocks_unsafe_undo(db,user,policy,swap):
    row,other,a,b = setup(db,policy,swap=swap)
    before = {r.id:r.person_id for r in (row,other)}
    proposal = bd.preview(db,'2026-05',user)
    assert proposal['summary']['clinical_repair']['invalid_before'] == 1
    assert proposal['summary']['clinical_repair']['repaired'] == 1
    assert {r.id:r.person_id for r in (row,other)} == before
    if swap:
        assert proposal['summary']['swaps'] == 1
    result = bd.apply(db,'2026-05',proposal['token'],proposal['plan_hash'],user)
    db.expire_all()
    assert row.person_id == b.id and other.person_id == a.id
    assert check_month(db,'2026-05')['ok']
    after = {r.id:r.person_id for r in (row,other)}
    dry = bd.undo(db,result['batch_id'],user,dry_run=True)
    assert dry['restored'] == 0 and any(c['code'] == 'leave' for c in dry['conflicts'])
    assert {r.id:r.person_id for r in (row,other)} == after
    assert not db.dirty and not db.new
    with pytest.raises(bd.BalanceError) as error:
        bd.undo(db,result['batch_id'],user)
    assert error.value.code == 'undo_conflict'
    db.expire_all()
    assert {r.id:r.person_id for r in (row,other)} == after


@pytest.mark.parametrize('policy',['availability','equal_counts'])
def test_protected_leave_conflict_refuses_proposal_without_live_changes(db,user,policy):
    row,other,a,b = setup(db,policy,protected=True)
    before = {r.id:r.person_id for r in (row,other)}
    with pytest.raises(bd.BalanceError) as error:
        bd.preview(db,'2026-05',user)
    assert error.value.code == 'leave_repair_incomplete'
    assert error.value.extra['live_changes'] == 0
    assert {r.id:r.person_id for r in (row,other)} == before


@pytest.mark.parametrize('policy',['availability','equal_counts'])
@pytest.mark.parametrize('side',['before','after'])
@pytest.mark.parametrize('protected',[False,True])
def test_existing_rest_conflict_at_month_boundary_is_repaired_or_refused(db,user,policy,side,protected):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode = policy
        rules.duty_rules.append(DutyRule(key='REST_SHORT', label='Day duty', group='audit',
            duration_hours=8, end_time='16:00', allowed_call_levels=['1ST_CALL']))
    edit_rules(db,configure)
    unit = make_unit(db,'REST_REPAIR')
    a,b = member(db,'Original',unit),member(db,'Replacement',unit)
    setup_month(db,[unit])
    if side == 'before':
        assign(db,make_slot(db,unit,date(2026,4,30)),a)
        target = make_slot(db,unit,date(2026,5,1),duty_type='REST_SHORT',hours=8)
    else:
        target = make_slot(db,unit,date(2026,5,31))
        assign(db,make_slot(db,unit,date(2026,6,1),duty_type='REST_SHORT',hours=8),a)
    row = assign(db,target,a,**({'source':'manual_rota_board'} if protected else {}))
    other = assign(db,make_slot(db,unit,date(2026,5,5),duty_type='REST_SHORT',hours=8),b)
    db.commit()
    assert not check_month(db,'2026-05')['ok']
    original = {r.id:r.person_id for r in (row,other)}
    if protected:
        with pytest.raises(bd.BalanceError) as error:
            bd.preview(db,'2026-05',user)
        assert error.value.code == 'clinical_repair_incomplete'
        assert {r.id:r.person_id for r in (row,other)} == original
        return
    proposal = bd.preview(db,'2026-05',user)
    assert proposal['summary']['clinical_repair']['invalid_before'] == 1
    assert proposal['summary']['clinical_repair']['repaired'] == 1
    assert {r.id:r.person_id for r in (row,other)} == original
    applied = bd.apply(db,'2026-05',proposal['token'],proposal['plan_hash'],user)
    assert check_month(db,'2026-05')['ok']
    dry = bd.undo(db,applied['batch_id'],user,dry_run=True)
    assert dry['restored'] == 0
    assert any(c['code'] in {'post_24hr_rest','pre_24hr_rest','rest_gap'} for c in dry['conflicts'])
