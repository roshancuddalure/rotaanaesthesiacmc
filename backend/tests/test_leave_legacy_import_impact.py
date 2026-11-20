"""Retained legacy import cannot bypass current duty/OT review evidence."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import select

from app.models import DutyAssignment, LeaveRequest, OtCalendar, Person
from tests.test_leave_impact import duty
from tests.test_leave_import_ot_api import setup
from tests.test_normalization_registry import registry as registry


def preview(client, content):
    response = client.post(
        "/api/v1/leave/import-preview?month=2026-11",
        files={"file": ("leave.csv", content, "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, content, token, **data):
    return client.post(
        "/api/v1/leave/import-apply?month=2026-11",
        files={"file": ("leave.csv", content, "text/csv")},
        data={"preview_hash": token, **data},
    )


def test_legacy_protected_overnight_ack_and_replay_preserve_duties(registry, monkeypatch):
    client, factory, person_id = setup(registry, monkeypatch)
    with factory() as db:
        assignment = duty(
            db,
            db.get(Person, UUID(person_id)),
            day=date(2026, 10, 31),
            start=datetime(2026, 10, 31, 20),
            end=datetime(2026, 11, 1, 8),
            period_status="published",
        )
        identity = assignment.id
    content = (
        b"name,starts_on,ends_on,leave_slot,status\nAsha AJ,2026-11-01,2026-11-01,AM,approved\n"
    )
    review = preview(client, content)
    (impact,) = review["affected_duties"]
    assert impact["id"] == str(identity) and impact["protected_period"]
    assert impact["reasons"] == ["physical_interval_overlap"]
    assert review["ot_impact"]["status"] == "evaluated"
    assert apply(client, content, review["preview_hash"]).status_code == 422
    result = apply(client, content, review["preview_hash"], acknowledge_duties="true")
    assert result.status_code == 200, result.text
    assert result.json()["created_rows"] == 1
    assert result.json()["preview"]["affected_duties"] == review["affected_duties"]
    assert apply(client, content, review["preview_hash"]).json()["replayed"]
    with factory() as db:
        assignment = db.get(DutyAssignment, identity)
        assert assignment.status == "assigned" and assignment.person_id == UUID(person_id)
        assert db.query(DutyAssignment).count() == 1 and db.query(LeaveRequest).count() == 1


def test_legacy_calendar_and_assignment_changes_invalidate_review(registry, monkeypatch):
    client, factory, person_id = setup(registry, monkeypatch)
    content = b"name,starts_on,ends_on,status\nAsha AJ,2026-11-19,2026-11-19,approved\n"
    review = preview(client, content)
    with factory() as db:
        db.scalar(select(OtCalendar)).revision = "d" * 64
        db.commit()
    assert apply(client, content, review["preview_hash"]).status_code == 409
    review = preview(client, content)
    with factory() as db:
        duty(
            db,
            db.get(Person, UUID(person_id)),
            day=date(2026, 11, 19),
            start=datetime(2026, 11, 19, 8),
            end=datetime(2026, 11, 19, 12),
        )
    assert (
        apply(client, content, review["preview_hash"], acknowledge_duties="true").status_code == 409
    )
    with factory() as db:
        assert db.query(LeaveRequest).count() == 0


def test_legacy_ot_compares_only_the_safe_subset_it_actually_applies(registry, monkeypatch):
    client, factory, _ = setup(registry, monkeypatch)
    content = b"name,starts_on,ends_on,status\nAsha AJ,2026-11-19,2026-11-19,approved\nMissing,2026-11-20,2026-11-20,approved\n"
    review = preview(client, content)
    assert review["matched_rows"] == 1 and review["unresolved_rows"] == 1
    assert "only 1 safe matched rows; 1 other rows remain skipped" in review["ot_impact"]["basis"]
    (month,) = review["ot_impact"]["months"]
    assert month["before"]["mandatory_covered"] - month["after"]["mandatory_covered"] == 1
    result = apply(client, content, review["preview_hash"])
    assert result.status_code == 200, result.text
    assert result.json()["created_rows"] == result.json()["skipped_rows"] == 1
    with factory() as db:
        assert db.query(LeaveRequest).count() == 1
