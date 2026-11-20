"""Leave repair provenance and retained originals on real disposable PostgreSQL."""

from datetime import date
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models import DutyAssignment, LeaveRequest, Person, RotaComputeJob, UserAccount
from app.services import leave_repair, rota_compute as compute
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_rota_compute_concurrency import seed, simultaneous


def proposal(factory, *, unavailable=False):
    user_id = seed(factory)
    with factory() as db:
        compute.candidate_context(db, "2026-05")
        slots = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)
        slot = next(row for row in slots if row.duty_date == date(2026,5,2))
        person = db.scalar(select(Person).where(Person.canonical_name == "Blocked Member"))
        leave = db.scalar(select(LeaveRequest).where(LeaveRequest.person_id == person.id))
        original = DutyAssignment(person=person, duty_slot=slot, status="assigned")
        db.add(original)
        if unavailable:
            for other in db.scalars(select(Person).where(Person.id != person.id)):
                db.add(LeaveRequest(person=other, starts_on=date(2026,5,2), ends_on=date(2026,5,2),
                                    leave_slot="FULL_DAY", leave_type="CASUAL_LEAVE", status="approved"))
        db.commit()
        user = db.get(UserAccount, user_id)
        scope = {"leave_ids": [leave.id], "repair_slots": [slot.id]}
        review = leave_repair.preview(db, "2026-05", user, **scope)
        response = leave_repair.start_proposal(db, "2026-05", user, review_token=review["review_token"], seconds=3, **scope)
        job = db.get(RotaComputeJob, UUID(response["id"]))
        compute.advance(db, job, job.revision)
        assert job.status == "completed" and original.status == "assigned"
        return user_id, job.id, job.revision, original.id, slot.id, leave.id


def test_leave_scoped_proposal_double_apply_preserves_provenance_and_scope(postgres_client, monkeypatch):
    _, factory, _ = postgres_client
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    user_id, job_id, revision, original_id, slot_id, leave_id = proposal(factory)
    def apply():
        with factory() as db:
            user = db.get(UserAccount, user_id)
            return compute.apply_job(db, compute.owned_job(db, job_id, user), revision, user)
    assert all(row["status"] == "applied" for row in simultaneous([apply, apply]))
    with factory() as db:
        assert db.get(DutyAssignment, original_id).status == "cancelled"
        assignments = list(db.scalars(select(DutyAssignment).where(DutyAssignment.status == "assigned")))
        assert len(assignments) == 1 and assignments[0].duty_slot_id == slot_id
        assert db.query(DutyAssignment).count() == 2
        assert db.get(RotaComputeJob, job_id).state["origin"]["leave_ids"] == [str(leave_id)]


def test_unresolved_leave_repair_keeps_original_on_real_apply(postgres_client, monkeypatch):
    _, factory, _ = postgres_client
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    user_id, job_id, revision, original_id, _, _ = proposal(factory, unavailable=True)
    with factory() as db:
        user = db.get(UserAccount, user_id)
        job = compute.owned_job(db, job_id, user)
        with pytest.raises(HTTPException) as error:
            compute.apply_job(db, job, revision, user)
        assert error.value.status_code == 409 and "retained" in error.value.detail
    with factory() as db:
        assert db.get(DutyAssignment, original_id).status == "assigned"
        assert db.query(DutyAssignment).count() == 1
