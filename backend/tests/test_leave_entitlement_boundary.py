"""N23: reporting never manufactures a leave balance, charge or disciplinary score."""

import json
from datetime import date

from sqlalchemy import select

from app.models import LeaveRequest, Person
from tests.test_normalization_registry import registry as registry


def test_reading_elapsed_leave_never_changes_records_or_invents_chargeable_days(registry):
    client, sessions, _ = registry
    with sessions() as db:
        person = Person(canonical_name="Disposable boundary member")
        db.add(person)
        db.flush()
        person_id = person.id
        for day, slot, status, kind in [
            (10, "AM", "approved", "ON_DUTY"),
            (10, "AM", "approved", "ANNUAL_LEAVE"),
            (11, "NIGHT", "approved", "CONFERENCE"),
            (20, "FULL_DAY", "approved", "ANNUAL_LEAVE"),
            (9, "FULL_DAY", "requested", "ANNUAL_LEAVE"),
            (8, "FULL_DAY", "cancelled", "ANNUAL_LEAVE"),
        ]:
            db.add(LeaveRequest(person=person, starts_on=date(2026, 11, day), ends_on=date(2026, 11, day),
                                leave_slot=slot, status=status, leave_type=kind, notes="PRIVATE clinical detail"))
        db.commit()

    def image():
        with sessions() as db:
            return sorted((str(row.id), row.leave_type, row.leave_slot, row.status, row.starts_on,
                           row.ends_on, row.notes, row.updated_at)
                          for row in db.scalars(select(LeaveRequest)))

    before = image()
    url = f"/api/v1/admin/member-workspace/{person_id}/leave-statistics"
    params = {"year": 2026, "month": 11, "as_of": "2026-11-14T12:00:00"}
    first = client.get(url, params=params)
    second = client.get(url, params=params)
    assert first.status_code == second.status_code == 200
    body = first.json()
    assert body == second.json()
    assert image() == before
    assert body["approved"]["elapsed"]["clock_hours"] == 26  # AM12 + NIGHT14; no entitlement conversion.
    assert body["approved"]["future"]["clock_hours"] == 24
    assert body["pending"]["elapsed"]["clock_hours"] == 24  # Separate; never approved elapsed.
    assert body["approved"]["elapsed"]["calendar_dates"] == 2
    assert body["entitlement_balance"] is None
    assert body["working_days"] is None
    assert body["historical_coverage_complete"] is False
    assert body["attendance_verified"] is False
    forbidden = {"chargeable_days", "deduction", "carry_forward", "remaining_balance", "disciplinary_score"}

    def inspect(value):
        if isinstance(value, dict):
            assert forbidden.isdisjoint(value)
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(body)
    assert "PRIVATE" not in json.dumps(body)
    assert {row["type"] for row in body["by_type"]} == {"ON_DUTY", "CONFERENCE", "ANNUAL_LEAVE"}
