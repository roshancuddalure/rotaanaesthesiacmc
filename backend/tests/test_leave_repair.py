"""Leave-scoped repairs reuse reviewed jobs and cannot grow into autofill."""

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import DutyAssignment, LeaveRequest, Person, RotaComputeJob
from app.services import leave_repair, rota_compute as compute
from datetime import date
from tests.test_rota_compute import compute_db as compute_db


def setup(db):
    compute.candidate_context(db, "2026-05")
    period, _ = compute.monthly_setup(db, "2026-05")
    slots = compute.open_slots_for_period(db, period.id)
    slot = next(row for row in slots if str(row.duty_date) == "2026-05-02")
    person = db.scalar(select(Person).where(Person.canonical_name == "Blocked Member"))
    leave = db.scalar(select(LeaveRequest).where(LeaveRequest.person_id == person.id))
    assignment = DutyAssignment(duty_slot=slot, person=person, status="assigned")
    db.add(assignment)
    db.commit()
    return period, slots, slot, leave, assignment


def scope(leave, slot=None):
    return {"leave_ids": [str(leave.id)], "repair_slots": [str(slot.id)] if slot else []}


@pytest.fixture
def api(compute_db):
    db, user = compute_db
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[current_user] = lambda: user
    with TestClient(app) as client:
        yield client, db, user, app


def test_review_is_read_only_and_exposes_explicit_selection_and_locks(compute_db):
    db, user = compute_db
    _, slots, slot, leave, assignment = setup(db)
    statements = []
    def observe(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lstrip().split(None,1)[0].upper())
    event.listen(db.get_bind(), "before_cursor_execute", observe)
    try:
        review = leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", observe)
    assert review["eligible_repair_slots"] == [str(slot.id)]
    assert review["preserved_slot_count"] == len(slots)-1
    assert review["repair_slots"] == [str(slot.id)]
    assert not {"INSERT", "UPDATE", "DELETE"}.intersection(statements)
    assert assignment.status == "assigned" and db.query(RotaComputeJob).count() == 0
    locked = leave_repair.preview(db, "2026-05", user, **scope(leave), locked_slots=[str(slot.id)])
    assert locked["eligible_repair_slots"] == []
    with pytest.raises(HTTPException) as error:
        leave_repair.preview(db, "2026-05", user, **scope(leave, slot), locked_slots=[str(slot.id)])
    assert error.value.status_code == 422


def test_only_selected_duty_changes_after_separate_reviewed_apply(compute_db, monkeypatch):
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    db, user = compute_db
    _, slots, slot, leave, assignment = setup(db)
    review = leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    result = leave_repair.start_proposal(db, "2026-05", user, review_token=review["review_token"],
                                        seconds=3, **scope(leave, slot))
    job = db.get(RotaComputeJob, UUID(result["id"]))
    options = job.state["intelligence"]["options"]
    assert set(options["locked_slots"]) == {str(row.id) for row in slots if row.id != slot.id}
    assert options["repair_slots"] == [str(slot.id)]
    assert job.state["origin"]["kind"] == "leave_repair"
    assert job.state["origin"]["leave_ids"] == [str(leave.id)]
    assert assignment.status == "assigned" and db.query(DutyAssignment).count() == 1
    compute.advance(db, job, job.revision)
    assert job.status == "completed"
    assert not any(row.get("person_id") for row in job.state["decisions"] if row["slot_id"] != str(slot.id))
    assert compute.apply_job(db, job, job.revision, user, dry_run=True)["validated"]
    assert assignment.status == "assigned"
    compute.apply_job(db, job, job.revision, user)
    assert assignment.status == "cancelled"
    active = list(db.scalars(select(DutyAssignment).where(DutyAssignment.status == "assigned")))
    assert len(active) == 1 and active[0].duty_slot_id == slot.id
    assert active[0].person_id != assignment.person_id


def test_changed_input_requires_fresh_review_before_creating_job(compute_db, monkeypatch):
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    db, user = compute_db
    _, _, slot, leave, assignment = setup(db)
    review = leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    slot.unit.minimum_free_people += 1
    db.commit()
    with pytest.raises(HTTPException) as error:
        leave_repair.start_proposal(db, "2026-05", user, review_token=review["review_token"], **scope(leave, slot))
    assert error.value.status_code == 409
    assert db.query(RotaComputeJob).count() == 0 and assignment.status == "assigned"


def test_unresolved_repair_cannot_cancel_the_original_assignment(compute_db, monkeypatch):
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    db, user = compute_db
    _, _, slot, leave, assignment = setup(db)
    # Every possible replacement is on approved leave. The existing unit and
    # individual rules stay unchanged; an unresolved outcome is required.
    for person in db.scalars(select(Person).where(Person.id != assignment.person_id)):
        db.add(LeaveRequest(person=person, starts_on=date(2026,5,2), ends_on=date(2026,5,2),
                            leave_slot="FULL_DAY", leave_type="CASUAL_LEAVE", status="approved"))
    db.commit()
    review = leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    result = leave_repair.start_proposal(db, "2026-05", user, review_token=review["review_token"],
                                        seconds=3, **scope(leave, slot))
    job = db.get(RotaComputeJob, UUID(result["id"]))
    compute.advance(db, job, job.revision)
    assert job.status == "completed"
    selected = next(row for row in job.state["decisions"] if row["slot_id"] == str(slot.id))
    assert selected["person_id"] is None and selected["action"] == "unresolved"
    assert job.state["intelligence"]["alternatives"][0]["changed"] == 0
    for dry_run in (True, False):
        with pytest.raises(HTTPException) as error:
            compute.apply_job(db, job, job.revision, user, dry_run=dry_run)
        assert error.value.status_code == 409 and "retained" in error.value.detail
        db.refresh(assignment)
        assert assignment.status == "assigned" and db.query(DutyAssignment).count() == 1


@pytest.mark.parametrize("status", ["published", "archived"])
def test_protected_periods_are_visible_but_never_selected(compute_db, status):
    db, user = compute_db
    period, _, slot, leave, assignment = setup(db)
    period.status = status
    db.commit()
    review = leave_repair.preview(db, "2026-05", user, **scope(leave))
    assert review["scope_available"] is False and review["eligible_repair_slots"] == []
    assert review["affected_duties"][0]["requires_authorized_resolution"] is True
    with pytest.raises(HTTPException) as error:
        leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    assert error.value.status_code == 422
    assert assignment.status == "assigned"


def test_pending_leave_and_unaffected_slots_cannot_define_repair(compute_db):
    db, user = compute_db
    _, slots, slot, leave, _ = setup(db)
    other = next(row for row in slots if row.id != slot.id)
    with pytest.raises(HTTPException) as error:
        leave_repair.preview(db, "2026-05", user, **scope(leave, other))
    assert error.value.status_code == 422
    leave.status = "requested"
    db.commit()
    with pytest.raises(HTTPException) as error:
        leave_repair.preview(db, "2026-05", user, **scope(leave, slot))
    assert error.value.status_code == 409


def test_api_roles_unknown_ids_duplicate_ids_and_feature_gate(api, monkeypatch):
    client, db, user, app = api
    _, _, slot, leave, _ = setup(db)
    payload = {"month": "2026-05", **scope(leave, slot)}
    response = client.post("/api/v1/leave/repair-preview", json=payload)
    assert response.status_code == 200, response.text
    monkeypatch.setattr(settings, "rota_intelligence_enabled", False)
    assert client.post("/api/v1/leave/repair-proposal", json={**payload, "review_token": response.json()["review_token"]}).status_code == 503
    assert client.post("/api/v1/leave/repair-preview", json={**payload, "leave_ids": [str(uuid4())]}).status_code == 404
    assert client.post("/api/v1/leave/repair-preview", json={**payload, "leave_ids": [str(leave.id)]*2}).status_code == 422
    user.role = "viewer"
    assert client.post("/api/v1/leave/repair-preview", json=payload).status_code == 403
    app.dependency_overrides.pop(current_user)
    assert client.post("/api/v1/leave/repair-preview", json=payload).status_code == 401


def test_api_proposal_uses_existing_validate_and_apply_workflow(api, monkeypatch):
    client, db, _, _ = api
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    _, _, slot, leave, assignment = setup(db)
    payload = {"month": "2026-05", **scope(leave, slot)}
    review = client.post("/api/v1/leave/repair-preview", json=payload)
    assert review.status_code == 200, review.text
    response = client.post("/api/v1/leave/repair-proposal", json={
        **payload, "review_token": review.json()["review_token"], "seconds": 3})
    assert response.status_code == 200, response.text
    job = response.json()
    assert assignment.status == "assigned"
    job_url = f"/api/v1/rota-compute/jobs/{job['id']}"
    stepped = client.post(job_url+"/step", json={"revision": job["revision"]})
    assert stepped.status_code == 200, stepped.text
    revision = stepped.json()["revision"]
    validated = client.post(job_url+"/validate", json={"revision": revision})
    assert validated.status_code == 200, validated.text
    assert assignment.status == "assigned"
    applied = client.post(job_url+"/apply", json={"revision": revision})
    assert applied.status_code == 200, applied.text
    assert assignment.status == "cancelled"
