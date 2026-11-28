"""Approved fractional fairness and compatible half-day duty regression."""
from datetime import date
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.models import LeaveRequest
from app.services import allocation_day_capacity as capacity, balance_duties as bd
from app.services.rota_candidates import candidate_context, context_targets, slot_candidates_with_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_rules import DutyRule
from app.services.leave_semantics import leave_intervals
from tests.test_balance_duties import db as db  # noqa: F401
from tests.test_balance_duties import assign, edit_rules, make_slot, make_unit, member, relaxed, setup_month


@pytest.mark.parametrize('slots,expected', [(['AM'],.5),(['PM'],.5),(['NIGHT'],10/24),
    (['AM','PM'],0),(['AM','AM'],.5),(['AM','NIGHT'],.25),(['PM','NIGHT'],4/24),
    (['FULL_DAY'],0),(['unknown'],0)])
def test_existing_leave_bands_are_unioned_without_double_counting(slots,expected):
    day=date(2026,5,3)
    person=UUID(int=1)
    rows=[SimpleNamespace(leave_slot=slot,status='approved',starts_on=day,ends_on=day) for slot in slots]
    actual=capacity.posted_capacity(person,{day},{day:{person:rows}})
    assert actual==pytest.approx(expected)


@pytest.mark.parametrize('status,expected',[('requested',.5),('imported_pending_review',.5),('cancelled',1),('rejected',1)])
def test_existing_active_status_policy_is_preserved(status,expected):
    day=date(2026,5,3)
    person=UUID(int=1)
    row=SimpleNamespace(leave_slot='AM',status=status,starts_on=day,ends_on=day)
    assert capacity.posted_capacity(person,{day},{day:{person:[row]}})==expected


@pytest.mark.parametrize('policy',['availability','equal_counts'])
def test_compatible_pm_worker_remains_in_targets_optimizer_and_balance(db,policy):
    def configure(rules):
        relaxed(rules)
        rules.fairness_rules.allocation_mode=policy
        rules.duty_rules.append(DutyRule(key='PARTIAL_PM_STUDY',label='PM study',group='audit',
            duration_hours=8,start_time='13:00',end_time='21:00',allowed_call_levels=['1ST_CALL']))
    edit_rules(db,configure)
    unit=make_unit(db,'PARTIAL_POLICY_STUDY')
    a,b=member(db,'Synthetic full day',unit),member(db,'Synthetic AM leave',unit)
    setup_month(db,[unit])
    leave=LeaveRequest(person=b,leave_type='ANNUAL_LEAVE',leave_slot='AM',
        starts_on=date(2026,5,1),ends_on=date(2026,5,31),status='approved')
    db.add(leave)
    rows=[make_slot(db,unit,date(2026,5,d),duty_type='PARTIAL_PM_STUDY',hours=8,start_hour=13)
          for d in (3,6,9,12,15,18)]
    db.commit()
    bands=leave_intervals(leave,date(2026,5,1),date(2026,5,31))
    assert not any(row.starts_at<span.ends_at and row.ends_at>span.starts_at for row in rows for span in bands)
    context=candidate_context(db,'2026-05')
    context_targets(db,context)
    expected=(4,2) if policy=='availability' else (3,3)
    assert set(context.fairness_member_levels)=={a.id,b.id}
    assert context.fairness_person_targets[a.id]==(0 if policy=='availability' else expected[0])
    assert context.fairness_person_targets[b.id]==(0 if policy=='availability' else expected[1])
    candidates=slot_candidates_with_context(db,slot=rows[0],context=context)['candidates']
    assert {c['person_id'] for c in candidates if c['validation_status']=='clear'}=={str(a.id),str(b.id)}
    slots={str(row.id):row for row in rows}
    result=solve_month(db,context,slots,seconds=8)
    assert len(result['choices'])==6
    assert tuple(list(result['choices'].values()).count(str(p.id)) for p in (a,b))==expected
    assert validate_plan(db,context,slots,result['choices'])==[]
    for row in rows:
        assign(db,row,a)
    db.commit()
    _,state=bd._plan(db,'2026-05')
    assert (state.duties[a.id],state.duties[b.id])==expected
    assert not db.new and not db.dirty
