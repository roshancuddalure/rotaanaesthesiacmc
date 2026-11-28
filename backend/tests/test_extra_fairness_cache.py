"""Ranking cache must preserve the entire reference proposal and ledger evidence."""
from datetime import date

import pytest

from app.services import extra_duty as ed
from tests.test_extra_duty import db as db  # noqa: F401
from tests.test_extra_duty import (MONTH,assign,edit_rules,ledger_record,leave,make_slot,
                                   make_unit,member,setup_month)


@pytest.mark.parametrize('mode',['standard','all_units'])
@pytest.mark.parametrize('policy',['availability','equal_counts'])
@pytest.mark.parametrize('ranking_cache',[False,True])
@pytest.mark.parametrize('temporal_cache',[False,True])
def test_cached_ranking_matches_reference_across_dated_availability_and_ledger(db,mode,policy,ranking_cache,temporal_cache):
    units=[make_unit(db,'CACHE_MAIN',campus='MAIN'),make_unit(db,'CACHE_OTHER',campus='RANI')]
    people=[member(db,f'Cache member {u}-{i}',unit,
                   starts_on=date(2026,5,10) if i==2 else date(2026,3,1))
            for u,unit in enumerate(units) for i in range(3)]
    setup_month(db,units)
    def configure(rules):
        rules.fairness_rules.allocation_mode=policy
    edit_rules(db,configure)
    assign(db,make_slot(db,units[0],date(2026,5,2)),people[0])
    leave(db,people[1],date(2026,5,8),date(2026,5,10))
    leave(db,people[4],date(2026,5,13),leave_slot='AM')
    leave(db,people[5],date(2026,6,1),leave_slot='AM')
    ledger_record(db,people[3],date(2026,4,12))
    for day in (4,5,6,7,8,10,12,13,15,16,18,31):
        for unit in units:
            make_slot(db,unit,date(2026,5,day))
    db.commit()
    cached=ed._build_plan(db,MONTH,mode,cache_justice=ranking_cache,cache_temporal=temporal_cache).result
    reference=ed._build_plan(db,MONTH,mode,cache_justice=False,snapshot_slot_fields=False,cache_temporal=False).result
    for key in ['decisions','plan_hash','summary','over_limit_people','unfilled_causes','diagnostics']:
        assert cached.get(key)==reference.get(key),key


def temporal_world(db, source_day, target_day):
    from types import SimpleNamespace
    from app.services.rota_rules import get_phase_one_rules
    unit=make_unit(db,'TEMPORAL')
    person=member(db,'Temporal candidate',unit)
    period,_=setup_month(db,[unit])
    source=make_slot(db,unit,source_day,label='source')
    target=make_slot(db,unit,target_day,label='target')
    db.commit()
    _,rules=get_phase_one_rules(db)
    ctx=ed.build_context(db,MONTH,period,rules)
    ctx._planner_temporal_cache={}
    snapshot=SimpleNamespace(**{name:getattr(target,name) for name in (
        'id','duty_date','duty_type','call_level','starts_at','ends_at','is_24hr','unit_id','max_assignees')})
    snapshot._temporal_conflict_cache=ctx._planner_temporal_cache
    return ctx,person,source,target,snapshot


@pytest.mark.parametrize('source_day,target_day,expected',[
    (date(2026,5,10),date(2026,5,10),'same_day_duty'),
    (date(2026,5,10),date(2026,5,11),'post_24hr_rest'),
    (date(2026,5,11),date(2026,5,10),'pre_24hr_rest'),
    (date(2026,6,1),date(2026,5,31),'pre_24hr_rest'),
])
def test_temporal_reuse_invalidates_after_assignment_including_month_edge(db,source_day,target_day,expected):
    ctx,person,source,target,snapshot=temporal_world(db,source_day,target_day)
    assert ed.strict_blockers(ctx,person.id,snapshot,target.unit_id)==[]
    assert person.id in ctx._planner_temporal_cache
    ctx.add_plan_assignment(source,person.id,source.unit_id)
    cached=ed.strict_blockers(ctx,person.id,snapshot,target.unit_id)
    reference=ed.strict_blockers(ctx,person.id,target,target.unit_id)
    assert cached==reference
    assert expected in {row['code'] for row in cached}


def test_temporal_reuse_keeps_live_leave_capacity_and_ot_checks(db,monkeypatch):
    from app.models import LeaveRequest
    import app.services.ot_assignment_validation as ot_validation
    ctx,person,_source,target,snapshot=temporal_world(db,date(2026,5,10),date(2026,5,10))
    row=LeaveRequest(person_id=person.id,starts_on=target.duty_date,ends_on=target.duty_date,
                     leave_type='ANNUAL_LEAVE',leave_slot='FULL_DAY',status='cancelled')
    snapshot._window_leaves={person.id:[row]}
    assert ed.strict_blockers(ctx,person.id,snapshot,target.unit_id)==[]
    row.status='approved'
    ctx.slot_active[target.id]=1
    ctx.ot_guard=object()
    monkeypatch.setattr(ot_validation,'check_ot_placement',lambda *a,**k:{'status':'infeasible'})
    codes={item['code'] for item in ed.strict_blockers(ctx,person.id,snapshot,target.unit_id)}
    assert {'leave','slot_full','ot_reservation_conflict'} <= codes


def test_temporal_reuse_does_not_confuse_own_row_with_overlapping_slot(db):
    ctx,person,source,target,snapshot=temporal_world(db,date(2026,5,10),date(2026,5,10))
    ctx.add_plan_assignment(target,person.id,target.unit_id)
    # A different slot with identical hours must see the duty; the own row is excluded.
    snapshot.id=source.id
    assert 'same_day_duty' in ed._planner_duty_time_codes(ctx,person.id,snapshot)
    snapshot.id=target.id
    assert ed._planner_duty_time_codes(ctx,person.id,snapshot)==frozenset()


@pytest.mark.parametrize('mode', ['standard', 'all_units'])
@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_equivalent_empty_windows_preserve_reference_with_filled_and_cancelled_rows(db,monkeypatch,mode,policy):
    from app.core.config import settings
    monkeypatch.setattr(settings,'ot_calendar_enabled',False)
    units=[make_unit(db,f'POOL_{i:02d}') for i in range(3)]
    people=[member(db,f'Pool member {u}-{i}',unit) for u,unit in enumerate(units) for i in range(4)]
    setup_month(db,units)
    edit_rules(db,lambda rules:setattr(rules.fairness_rules,'allocation_mode',policy))
    slots=[]
    for day in (4,5,8,10):
        for unit in units:
            for copy in range(2):
                slots.append(make_slot(db,unit,date(2026,5,day),label=f'{unit.code}/{day}/{copy}'))
    # A filled representative must not make other equal windows look full;
    # a cancelled own row remains a real row and must not be erased by reuse.
    slots[0].max_assignees=2
    assign(db,slots[0],people[0])
    assign(db,slots[-2],people[8],status='cancelled')
    leave(db,people[1],date(2026,5,8))
    db.commit()
    original=ed.strict_blockers
    phase=['optimized']
    calls={'optimized':0,'reference':0,'virtual':0}
    def count(ctx,pid,slot,*args,**kwargs):
        calls[phase[0]]+=1
        calls['virtual']+=int(phase[0]=='optimized' and slot.id is None)
        return original(ctx,pid,slot,*args,**kwargs)
    monkeypatch.setattr(ed,'strict_blockers',count)
    optimized=ed._build_plan(db,MONTH,mode,coalesce_empty_windows=True).result
    phase[0]='reference'
    reference=ed._build_plan(db,MONTH,mode,coalesce_empty_windows=False).result
    for key in ('decisions','plan_hash','summary','over_limit_people','unfilled_causes','diagnostics'):
        assert optimized[key]==reference[key],key
    assert calls['virtual']>0 and calls['optimized']<calls['reference']


def test_empty_window_reuse_is_disabled_with_an_ot_guard(db,monkeypatch):
    from app.core.config import settings
    import app.services.ot_assignment_validation as validation
    monkeypatch.setattr(settings,'ot_calendar_enabled',False)
    unit=make_unit(db,'OT_POOL')
    for i in range(4):member(db,f'OT pool member {i}',unit)
    setup_month(db,[unit])
    for copy in range(2):make_slot(db,unit,date(2026,5,10),label=f'ot/{copy}')
    db.commit()
    original_context=ed.build_context
    def guarded(*args,**kwargs):
        ctx=original_context(*args,**kwargs)
        ctx.ot_guard=object()
        return ctx
    seen=[]
    monkeypatch.setattr(ed,'build_context',guarded)
    monkeypatch.setattr(validation,'check_ot_placement',lambda guard,rows,slot,*a,**k:
                        (seen.append(slot.id) or {'status':'feasible'}))
    result=ed._build_plan(db,MONTH).result
    assert result['summary']['filled']==2
    assert seen and all(slot_id is not None for slot_id in seen)


def test_shared_candidate_is_rechecked_before_changed_leave_can_be_overridden(db,monkeypatch):
    from app.core.config import settings
    from app.models import LeaveRequest, DutyAssignment
    monkeypatch.setattr(settings,'ot_calendar_enabled',False)
    unit=make_unit(db,'CHANGING_POOL')
    person=member(db,'A changing candidate',unit)
    member(db,'Z other candidate',unit)
    setup_month(db,[unit])
    day=date(2026,5,10)
    for copy in range(2):make_slot(db,unit,day,label=f'changing/{copy}')
    db.commit()
    row=LeaveRequest(person_id=person.id,starts_on=day,ends_on=day,
                     leave_type='ANNUAL_LEAVE',leave_slot='FULL_DAY',status='cancelled')
    original_context=ed.build_context
    def changing_context(*args,**kwargs):
        ctx=original_context(*args,**kwargs)
        ctx.leaves={day:{person.id:[row]}}
        return ctx
    original=ed.strict_blockers
    switched=[]
    def approve_after_precheck(ctx,pid,slot,*args,**kwargs):
        result=original(ctx,pid,slot,*args,**kwargs)
        if slot.id is None and pid==person.id and not result and not switched:
            row.status='approved'
            switched.append(True)
        return result
    monkeypatch.setattr(ed,'build_context',changing_context)
    monkeypatch.setattr(ed,'strict_blockers',approve_after_precheck)
    before=db.query(DutyAssignment).count()
    with pytest.raises(ed.ExtraDutyError) as error:
        ed._build_plan(db,MONTH)
    assert switched and error.value.code=='stale_inputs' and error.value.status_code==409
    assert error.value.extra['strict_codes']==['leave']
    assert db.query(DutyAssignment).count()==before
