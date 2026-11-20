"""Canonical import evidence and acknowledgement never rewrite saved duties."""

from datetime import date, datetime
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, LeaveRequest
from tests.test_leave_impact import duty
from tests.test_normalization_registry import registry as registry
from tests.test_operational_import import preview, seed


def import_leave(client, day="2026-10-01", session="AM", status="approved"):
    response = preview(client, f"member_name,starts_on,leave_slot,status\nAsha AJ,{day},{session},{status}\n")
    assert response.status_code == 200, response.text
    return response.json()


def test_previous_month_protected_overnight_requires_ack_and_retains_assignment(registry):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    from app.models import Person
    with sessions() as db:
        assignment = duty(db, db.get(Person, UUID(person_id)), day=date(2026,9,30),
                          start=datetime(2026,9,30,20), end=datetime(2026,10,1,8),
                          period_status="published", label="Protected overnight")
        identity = assignment.id
    review = import_leave(client)
    row, = review["rows"]
    impact, = row["affected_duties"]
    assert impact["id"] == str(identity)
    assert impact["protected_period"] is True
    assert impact["reasons"] == ["physical_interval_overlap"]
    assert any("protected published" in warning for warning in row["warnings"])
    endpoint = f"/api/v1/import-review/{review['id']}/apply"
    assert client.post(endpoint, json={}).status_code == 422
    applied = client.post(endpoint, json={"acknowledge_warnings": True})
    assert applied.status_code == 200, applied.text
    assert client.post(endpoint, json={"acknowledge_warnings": True}).json() == applied.json()
    with sessions() as db:
        assignment = db.get(DutyAssignment, identity)
        assert assignment.person_id == UUID(person_id) and assignment.status == "assigned"
        assert len(list(db.scalars(select(DutyAssignment)))) == 1
        assert len(list(db.scalars(select(LeaveRequest)))) == 1


@pytest.mark.parametrize("status", ["cancelled", "rejected", "approved", "imported_pending_review"])
def test_import_half_open_boundaries_and_cancelled_assignments(registry, status):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    from app.models import Person
    with sessions() as db:
        person = db.get(Person, UUID(person_id))
        duty(db, person, day=date(2026,10,1), start=datetime(2026,10,1,12),
             end=datetime(2026,10,1,16), label="Adjacent PM")
        cancelled = duty(db, person, day=date(2026,10,1), start=datetime(2026,10,1,8),
                         end=datetime(2026,10,1,11), label="Cancelled morning")
        cancelled.status = "cancelled"
        db.commit()
    row, = import_leave(client, status=status)["rows"]
    assert not row["issues"], row
    assert row["affected_duties"] == [] and not row["warnings"]


def test_period_publication_invalidates_import_review(registry):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    from app.models import Person
    with sessions() as db:
        assignment = duty(db, db.get(Person, UUID(person_id)), day=date(2026,10,1),
                          start=datetime(2026,10,1,8), end=datetime(2026,10,1,11))
        identity = assignment.id
    review = import_leave(client)
    assert review["rows"][0]["affected_duties"][0]["protected_period"] is False
    with sessions() as db:
        db.get(DutyAssignment, identity).duty_slot.rota_period.status = "published"
        db.commit()
    response = client.post(f"/api/v1/import-review/{review['id']}/apply",
                           json={"acknowledge_warnings": True})
    assert response.status_code == 409, response.text
    assert import_leave(client)["rows"][0]["affected_duties"][0]["protected_period"] is True
    with sessions() as db:
        assert not list(db.scalars(select(LeaveRequest)))


@pytest.mark.parametrize("status", ["approved", "imported_pending_review", "cancelled", "rejected"])
def test_import_physical_overlap_is_distinct_from_date_policy_and_matches_manual(registry, status):
    client, sessions, _ = registry
    person_id, _ = seed(sessions)
    from app.models import Person
    with sessions() as db:
        assignment = duty(db, db.get(Person, UUID(person_id)), day=date(2026,10,1),
                          start=datetime(2026,10,1,11), end=datetime(2026,10,1,15))
        identity = assignment.id
    row, = import_leave(client, session="PM", status=status)["rows"]
    values = {**row["after"]}
    manual = client.post('/api/v1/normalization/records/leave/preview', json={'values': values})
    assert manual.status_code == 200, manual.text
    if status in {"cancelled", "rejected"}:
        assert not row["affected_duties"] and not manual.json()["duties"]
    else:
        impact, = row["affected_duties"]
        counterpart, = manual.json()["duties"]
        assert impact["id"] == counterpart["id"] == str(identity)
        assert impact["reasons"] == counterpart["reasons"] == ["physical_interval_overlap"]
    with sessions() as db:
        assert not list(db.scalars(select(LeaveRequest)))


def test_import_impact_limit_is_blocking_instead_of_silent_omission(registry):
    client, sessions, _ = registry
    seed(sessions)
    response = preview(client, "member_name,starts_on,ends_on,status\nAsha AJ,2026-01-01,2027-10-01,approved\n")
    assert response.status_code == 200, response.text
    review = response.json()
    row, = review["rows"]
    assert any("371 dates" in issue for issue in row["issues"])
    assert row["action"] == "needs_review"
    assert client.post(f"/api/v1/import-review/{review['id']}/apply",
                       json={"acknowledge_warnings": True}).status_code == 422
