"""N24 duty evidence: midnight overlap, policy distinction and protected months."""

from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, LeaveRequest, RotaPeriod
from app.services.leave_impact import affected_duties
from tests.test_leave_approval import environment as environment, leave, preview, apply


def duty(db, person, *, day, start, end, period_status="draft", source="phase4_template", label="Fixture duty"):
    period = RotaPeriod(name=f"Impact {label}", starts_on=day.replace(day=1), ends_on=day,
                        status=period_status)
    slot = DutySlot(rota_period=period, duty_date=day, duty_type="MAIN_1ST_24HR", slot_label=label,
                    starts_at=start, ends_at=end, is_24hr=(end-start).total_seconds() >= 86400,
                    source=source)
    assignment = DutyAssignment(person=person, duty_slot=slot, status="assigned")
    db.add(assignment)
    db.commit()
    return assignment


def test_previous_month_overnight_is_visible_and_approval_never_reassigns_it(environment):
    client, db, _, person = environment
    row = leave(db, person, "2026-05-01")
    assignment = duty(db, person, day=date(2026,4,30), start=datetime(2026,4,30,20),
                      end=datetime(2026,5,1,8), period_status="published", label="April published overnight")
    before = (assignment.id, assignment.person_id, assignment.status, assignment.duty_slot_id)
    review = preview(client)
    impact, = review["affected_duties"]
    assert impact["reasons"] == ["physical_interval_overlap"]
    assert impact["month"] == "2026-04" and impact["protected_period"] is True
    assert impact["requires_authorized_resolution"] is True
    assert impact["reviewed_repair_candidate"] is False
    assert impact["leave_ids"] == [str(row.id)]
    assert apply(client, review).status_code == 409
    approved = apply(client, review, acknowledge_duties=True)
    assert approved.status_code == 200, approved.text
    db.refresh(assignment)
    assert (assignment.id, assignment.person_id, assignment.status, assignment.duty_slot_id) == before
    assert db.query(DutyAssignment).count() == 1
    assert db.get(LeaveRequest, row.id).status == "approved"


def test_legacy_start_hour_rule_and_physical_overlap_remain_distinct(environment):
    _, db, _, person = environment
    row = leave(db, person, "2026-05-10")
    row.leave_slot = "PM"
    db.commit()
    assignment = duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,11),
                      end=datetime(2026,5,10,15), label="Morning start into PM")
    from app.services.rota_safety import slot_leave_blocks
    assert slot_leave_blocks(row, assignment.duty_slot) is True
    impact, = affected_duties(db, [row])
    assert impact["reasons"] == ["physical_interval_overlap"]
    assert impact["reviewed_repair_candidate"] is True
    assert impact["slot_id"] == str(assignment.duty_slot_id)
    assert "No repair was generated" in impact["repair_basis"]


def test_half_open_boundary_cancelled_assignments_and_duplicate_leaves_do_not_multiply_impacts(environment):
    _, db, _, person = environment
    row = leave(db, person, "2026-05-10")
    row.leave_slot = "AM"
    db.commit()
    adjacent = duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,12),
                    end=datetime(2026,5,10,16), label="Adjacent PM")
    active = duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,8),
                  end=datetime(2026,5,10,11), label="Active morning")
    inactive = duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,8),
                    end=datetime(2026,5,10,11), label="Cancelled morning")
    inactive.status = "cancelled"
    db.commit()
    impact, = affected_duties(db, [row, row])
    assert impact["id"] == str(active.id)
    assert impact["leave_ids"] == [str(row.id)]
    assert impact["reasons"] == ["duty_date_policy_overlap", "physical_interval_overlap"]
    assert {a.id for a in db.scalars(select(DutyAssignment))} == {adjacent.id, active.id, inactive.id}


def test_manual_review_uses_prospective_values_without_creating_a_request(environment):
    client, db, _, person = environment
    assignment = duty(db, person, day=date(2026,4,30), start=datetime(2026,4,30,20),
                      end=datetime(2026,5,1,8), period_status="published")
    values = {"person_id": str(person.id), "starts_on": "2026-05-01", "ends_on": "2026-05-01",
              "leave_type": "ANNUAL_LEAVE", "leave_slot": "AM", "status": "approved"}
    response = client.post("/api/v1/normalization/records/leave/preview", json={"values": values})
    assert response.status_code == 200, response.text
    impact, = response.json()["duties"]
    assert impact["id"] == str(assignment.id)
    assert impact["reasons"] == ["physical_interval_overlap"]
    assert impact["protected_period"] is True
    assert db.query(LeaveRequest).count() == 0
    assert not db.new and not db.dirty
    rejected = client.post("/api/v1/leave/requests", json=values)
    assert rejected.status_code == 409, rejected.text
    assert db.query(LeaveRequest).count() == 0
    accepted = client.post("/api/v1/leave/requests", json={**values, "acknowledge_duties": True})
    assert accepted.status_code == 200, accepted.text
    db.refresh(assignment)
    assert assignment.person_id == person.id and assignment.status == "assigned"


@pytest.mark.parametrize("status", ["cancelled", "rejected"])
def test_cancelled_or_rejected_manual_proposal_does_not_claim_to_block_duties(environment, status):
    client, db, _, person = environment
    duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,8), end=datetime(2026,5,10,16))
    values = {"person_id": str(person.id), "starts_on": "2026-05-10", "ends_on": "2026-05-10",
              "leave_type": "ANNUAL_LEAVE", "leave_slot": "FULL_DAY", "status": status}
    response = client.post("/api/v1/normalization/records/leave/preview", json={"values": values})
    assert response.status_code == 200, response.text
    assert response.json()["duties"] == []
    assert db.query(LeaveRequest).count() == 0


def test_publishing_an_affected_period_invalidates_monthly_and_manual_reviews(environment):
    client, db, _, person = environment
    row = leave(db, person)
    assignment = duty(db, person, day=date(2026,5,10), start=datetime(2026,5,10,8), end=datetime(2026,5,10,16))
    values = {"person_id": str(person.id), "starts_on": "2026-05-10", "ends_on": "2026-05-10",
              "leave_type": "ANNUAL_LEAVE", "leave_slot": "FULL_DAY", "status": "approved"}
    # Use the service for an edit, preserving the existing authenticated monthly
    # API exercise while avoiding a new leave record that would overlap it.
    from app.services.operational_records import inspect_record
    manual = inspect_record(db, "leave", values, row.id)
    review = preview(client)
    assignment.duty_slot.rota_period.status = "published"
    db.commit()
    assert apply(client, review, acknowledge_duties=True).status_code == 409
    fresh = preview(client)
    assert fresh["affected_duties"][0]["protected_period"] is True
    assert inspect_record(db, "leave", values, row.id)["review_token"] != manual["review_token"]
    assert db.get(LeaveRequest, row.id).status == "requested"
