"""Real canonical skills/leave/engine repair can free a different OT member."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models import (CallCluster, DutyAssignment, LeaveRequest, OtCalendar, Person,
                        PersonCallClusterMembership, RotaComputeJob)
from app.services import leave_repair, rota_compute as compute
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from tests.test_rota_compute import compute_db as compute_db


def setup_ot_only(db):
    compute.candidate_context(db, '2026-05')
    period, _ = compute.monthly_setup(db, '2026-05')
    slots = compute.open_slots_for_period(db, period.id)
    slot = next(row for row in slots if str(row.duty_date) == '2026-05-02')
    safe = db.scalar(select(Person).where(Person.canonical_name == 'Safe Member'))
    blocked = db.scalar(select(Person).where(Person.canonical_name == 'Blocked Member'))
    leave = db.scalar(select(LeaveRequest).where(LeaveRequest.person_id == blocked.id))
    group = CallCluster(key='ot_scope_skill', name='Fixture OT skill', call_level='1ST_CALL', active=True)
    db.add(group)
    db.flush()
    for person in (safe, blocked):
        db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026,5,1)))
    def band(minimum, skills=()):
        return {'key':'first','start_minute':480,'end_minute':960,'call_levels':['1ST_CALL'],
                'minimum':minimum,'target':minimum,'required_skills':list(skills)}
    value = canonical(CalendarConfiguration.model_validate({
        'reserve_mode':'included',
        'qualification_bindings':[{'skill_key':'fixture_skill','group_keys':[group.key]}],
        'weekly':[{'id':str(uuid4()),'unit_id':str(slot.unit_id),'area_key':'main','weekday':day,
                   'effective_from':'2026-04-01','bands':[band(0)]}
                  for day in ('MON','TUE','WED','THU','FRI','SAT','SUN')],
        'exceptions':[{'id':str(uuid4()),'unit_id':str(slot.unit_id),'area_key':'main','day':'2026-05-02',
                       'bands':[band(1,('fixture_skill',))]}]}))
    db.add(OtCalendar(unit_id=slot.unit_id, configuration=value, revision=revision(value)))
    assignment = DutyAssignment(duty_slot=slot, person=safe, status='assigned')
    db.add(assignment)
    db.commit()
    return period, slots, slot, leave, assignment


def test_canonical_ot_only_scope_reuses_engine_and_separate_apply(compute_db, monkeypatch):
    for flag in ('ot_calendar_enabled','rota_compute_enabled','rota_intelligence_enabled'):
        monkeypatch.setattr(settings, flag, True)
    db, user = compute_db
    _, slots, slot, leave, original = setup_ot_only(db)
    options = dict(leave_ids=[str(leave.id)], repair_slots=[str(slot.id)])
    review = leave_repair.preview(db,'2026-05',user,**options)
    assert review['affected_duties'] == []
    assert review['ot_repair_scope']['status'] == 'evaluated', review
    impact, = review['ot_affected_duties']
    assert impact['id'] == str(original.id) and original.person_id != leave.person_id
    assert impact['reasons'] == ['ot_reservation_component']
    assert review['eligible_repair_slots'] == [str(slot.id)]
    result = leave_repair.start_proposal(db,'2026-05',user,review_token=review['review_token'],seconds=5,**options)
    job = db.get(RotaComputeJob,UUID(result['id']))
    assert set(job.state['intelligence']['options']['locked_slots']) == {str(row.id) for row in slots if row.id!=slot.id}
    compute.advance(db,job,job.revision)
    assert job.status == 'completed'
    assert compute.apply_job(db,job,job.revision,user,dry_run=True)['validated']
    assert original.status == 'assigned'
    compute.apply_job(db,job,job.revision,user)
    assert original.status == 'cancelled'
    saved = list(db.scalars(select(DutyAssignment).where(DutyAssignment.status=='assigned')))
    assert len(saved)==1 and saved[0].duty_slot_id==slot.id
    assert saved[0].person.canonical_name in {'Spare One','Spare Two'}


def test_ot_only_locks_protection_unknown_and_stale_skill_input(compute_db,monkeypatch):
    monkeypatch.setattr(settings,'ot_calendar_enabled',True)
    monkeypatch.setattr(settings,'rota_compute_enabled',True)
    monkeypatch.setattr(settings,'rota_intelligence_enabled',True)
    db,user=compute_db
    period,_,slot,leave,original=setup_ot_only(db)
    options=dict(leave_ids=[str(leave.id)])
    review=leave_repair.preview(db,'2026-05',user,**options,repair_slots=[str(slot.id)])
    locked=leave_repair.preview(db,'2026-05',user,**options,locked_slots=[str(slot.id)])
    assert not locked['eligible_repair_slots']
    db.scalar(select(CallCluster).where(CallCluster.key=='ot_scope_skill')).active=False
    db.commit()
    with pytest.raises(HTTPException) as error:
        leave_repair.start_proposal(db,'2026-05',user,**options,repair_slots=[str(slot.id)],review_token=review['review_token'])
    assert error.value.status_code in {409,422}
    unknown=leave_repair.preview(db,'2026-05',user,**options)
    assert unknown['ot_repair_scope']['status']=='not_evaluated'
    assert not unknown['ot_affected_duties'] and not unknown['eligible_repair_slots']
    db.scalar(select(CallCluster).where(CallCluster.key=='ot_scope_skill')).active=True
    period.status='published'
    db.commit()
    protected=leave_repair.preview(db,'2026-05',user,**options)
    assert not protected['eligible_repair_slots']
    assert protected['ot_affected_duties'][0]['protected_period']
    assert original.status=='assigned' and db.query(RotaComputeJob).count()==0
