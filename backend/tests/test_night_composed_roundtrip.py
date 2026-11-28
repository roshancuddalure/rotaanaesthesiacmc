"""Actual three-row net cycle through Preview, Apply, independent Verify and Undo."""
from datetime import date
import pytest
from sqlalchemy import select

from app.models import DutyAssignment
from app.services import balance_duties as bd
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import db as db, user as user  # noqa: F401
from tests.test_balance_hour_refinement import fixture, add


@pytest.mark.parametrize('policy',['equal_counts','availability'])
def test_composed_three_row_cycle_has_exact_original_undo(db,user,policy,monkeypatch):
    import app.services.allocation_hours as hours
    unit,(a,b,c)=fixture(db,policy)
    for day in (4,11,18):add(db,unit,a,day,24)
    for day in (7,14,21):add(db,unit,b,day,8)
    c_night=add(db,unit,c,25,24)
    for day in (8,15):add(db,unit,c,day,8)
    db.commit()
    original={row.id:(row.person_id,row.source,row.duty_slot.unit_id) for row in db.scalars(select(DutyAssignment))}
    a_night=next(row for row in db.scalars(select(DutyAssignment))
                 if row.person_id==a.id and row.duty_slot.duty_date==date(2026,5,4))
    def earlier_draft_stage(state,*,planner):
        ok,code,placed=planner.transfer([(a_night.id,c.id),(c_night.id,a.id)])
        assert ok,code
        planner.record('swap',placed);planner.swaps+=1
        # Reproduce a constrained search in which only the already-changed night
        # row offers the improvement. Protected saved rows are never modified.
        available=state.movable_rows
        state.movable_rows=lambda person,touched:[aid for aid in available(person,touched)
            if not state.rows[aid]['slot'].is_24hr or aid==c_night.id]
        return None
    monkeypatch.setattr(hours,'refine_hours',earlier_draft_stage)
    proposal=bd.preview(db,'2026-05',user)
    assert proposal['summary']['night_refinement']['swaps']==1
    moves=proposal['moves']
    assert len(moves)==len({m['assignment_id'] for m in moves})==3
    cycled=next(m for m in moves if m['assignment_id']==str(c_night.id))
    assert cycled['from_person_id']==str(c.id) and cycled['to_person_id']==str(b.id)
    assert all(m['kind']=='move' and not m['swap_with'] for m in moves)
    result=bd.apply(db,'2026-05',proposal['token'],proposal['plan_hash'],user)
    check=check_month(db,'2026-05')
    assert check['ok'] and check['checked']==9
    preview=bd.undo(db,result['batch_id'],user,dry_run=True)
    assert not preview['conflicts'] and preview['would_restore']==3
    bd.undo(db,result['batch_id'],user)
    assert {row.id:(row.person_id,row.source,row.duty_slot.unit_id)
            for row in db.scalars(select(DutyAssignment))}==original
