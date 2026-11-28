"""Real night refinement, composed draft effects, clinical refusal and exact Undo."""
from datetime import date
import pytest
from sqlalchemy import select

from app.models import DutyAssignment, LeaveRequest
from app.services import balance_duties as bd
from app.services.allocation_nights import refine_nights
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_hour_refinement import fixture, add, independently_safe


def world(db, policy, protected=False):
    unit,(a,b,c)=fixture(db,policy)
    c.active_status='inactive'
    for day in (4,11,18):add(db,unit,a,day,24,protected=protected)
    for day in (7,14,21):add(db,unit,b,day,8)
    db.commit()
    return unit,a,b


@pytest.mark.parametrize('policy',['equal_counts','availability'])
def test_night_stage_reduces_extreme_gap_and_preserves_clinical_constraints(db,policy):
    world(db,policy)
    original={row.id:row.person_id for row in db.scalars(select(DutyAssignment))}
    state=bd._load(db,'2026-05');planner=bd._Planner(state,bd.MAX_WORK)
    result=refine_nights(state,planner=planner)
    assert result['swaps']==1
    level=result['levels'][0]
    assert (level['before_night_gap'],level['after_night_gap'])==(3,1)
    assert (level['before_hour_gap'],level['after_hour_gap'])==(48,16)
    assert result['duty_counts_preserved'] and result['extra_credits_preserved'] and result['weekends_preserved']
    assert len(planner.moves)==len({m['assignment_id'] for m in planner.moves})==2
    independently_safe(db,state,original)


@pytest.mark.parametrize('block',['protected','leave','budget','inspections'])
def test_unavailable_or_exhausted_refinement_never_forces_swap(db,block):
    _unit,_a,b=world(db,'equal_counts',protected=block=='protected')
    if block=='leave':
        for day in (4,11,18):
            db.add(LeaveRequest(person=b,starts_on=date(2026,5,day),ends_on=date(2026,5,day),
                               leave_type='ANNUAL_LEAVE',leave_slot='FULL_DAY',status='approved'))
        db.commit()
    original={row.id:row.person_id for row in db.scalars(select(DutyAssignment))}
    state=bd._load(db,'2026-05');planner=bd._Planner(state,0 if block=='budget' else bd.MAX_WORK)
    result=refine_nights(state,planner=planner,max_inspections=0 if block=='inspections' else 20000)
    assert result['swaps']==0 and not planner.moves
    independently_safe(db,state,original)


@pytest.mark.parametrize('policy',['equal_counts','availability'])
def test_real_preview_apply_independent_verify_and_exact_undo_for_night_stage(db,user,policy,monkeypatch):
    # Isolate the night fallback: ordinary hour search may stop without finding
    # a swap. The night stage must still produce a real reviewed atomic batch.
    import app.services.allocation_hours as hours
    monkeypatch.setattr(hours,'refine_hours',lambda *a,**k:None)
    world(db,policy)
    original={row.id:(row.person_id,row.source,row.duty_slot.unit_id) for row in db.scalars(select(DutyAssignment))}
    proposal=bd.preview(db,'2026-05',user)
    assert proposal['summary']['night_refinement']['swaps']==1
    assert len(proposal['moves'])==2
    applied=bd.apply(db,'2026-05',proposal['token'],proposal['plan_hash'],user)
    verified=check_month(db,'2026-05')
    assert verified['ok'] and verified['checked']==6
    undo=bd.undo(db,applied['batch_id'],user,dry_run=True)
    assert not undo['conflicts'] and undo['would_restore']==2
    bd.undo(db,applied['batch_id'],user)
    assert {row.id:(row.person_id,row.source,row.duty_slot.unit_id) for row in db.scalars(select(DutyAssignment))}==original


def test_revisited_base_move_composes_to_original_holder(db):
    world(db,'equal_counts')
    state=bd._load(db,'2026-05');planner=bd._Planner(state,bd.MAX_WORK)
    aid=next(aid for aid,row in state.rows.items() if row['slot'].is_24hr)
    row=state.rows[aid];person=row['person'];unit=state.slot_unit[row['slot'].id]
    # An earlier draft stage's before image is preserved when the same row is
    # used by the night stage. The fictional original is never persisted.
    from uuid import uuid4
    original_holder=uuid4()
    planner.record('move',[(aid,original_holder,unit,person,unit)])
    # Only this night row is movable, forcing the composed chain witness.
    for other,data in state.rows.items():
        if data['slot'].is_24hr and other!=aid:data['movable']=False
    result=refine_nights(state,planner=planner)
    assert result['swaps']==1
    composed=[m for m in planner.moves if m['assignment_id']==str(aid)]
    assert len(composed)==1 and composed[0]['from_person_id']==str(original_holder)
    assert composed[0]['to_person_id']!=str(person)
