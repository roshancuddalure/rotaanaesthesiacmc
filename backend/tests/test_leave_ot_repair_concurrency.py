"""Real PostgreSQL OT-only repair preserves exact scope on concurrent apply."""

from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.models import DutyAssignment, RotaComputeJob, UserAccount
from app.services import leave_repair, rota_compute as compute
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_leave_ot_repair_api import setup_ot_only
from tests.test_rota_compute_concurrency import seed, simultaneous


def test_ot_only_double_apply_replaces_other_member_once(postgres_client,monkeypatch):
    _,factory,_=postgres_client
    for flag in ('ot_calendar_enabled','rota_compute_enabled','rota_intelligence_enabled'):
        monkeypatch.setattr(settings,flag,True)
    user_id=seed(factory)
    with factory() as db:
        _,slots,slot,leave,original=setup_ot_only(db)
        user=db.get(UserAccount,user_id)
        options=dict(leave_ids=[str(leave.id)],repair_slots=[str(slot.id)])
        review=leave_repair.preview(db,'2026-05',user,**options)
        assert not review['affected_duties'] and review['ot_affected_duties'][0]['id']==str(original.id)
        result=leave_repair.start_proposal(db,'2026-05',user,review_token=review['review_token'],seconds=5,**options)
        job=db.get(RotaComputeJob,UUID(result['id']))
        assert len(job.state['intelligence']['options']['locked_slots'])==len(slots)-1
        compute.advance(db,job,job.revision)
        assert job.status=='completed'
        job_id,revision,original_id,slot_id=job.id,job.revision,original.id,slot.id
    def apply():
        with factory() as db:
            user=db.get(UserAccount,user_id)
            return compute.apply_job(db,compute.owned_job(db,job_id,user),revision,user)
    assert all(result['status']=='applied' for result in simultaneous([apply,apply]))
    with factory() as db:
        assert db.get(DutyAssignment,original_id).status=='cancelled'
        active=list(db.scalars(select(DutyAssignment).where(DutyAssignment.status=='assigned')))
        assert len(active)==1 and active[0].duty_slot_id==slot_id
        assert active[0].person.canonical_name in {'Spare One','Spare Two'}
        assert db.query(DutyAssignment).count()==2
