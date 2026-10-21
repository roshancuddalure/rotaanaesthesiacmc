from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import create_app
from app.models import (
    DutyAssignment,
    LeaveRequest,
    MemberActivity,
    NormalizationEvent,
    Person,
    Unit,
    UserAccount,
)
from app.services.leave_approval import approve_month
from tests.test_rota_auto_fill import create_slot


@pytest.fixture
def environment():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = UserAccount(
            username="leave-admin",
            display_name="Leave Admin",
            password_hash="disposable-test",
            role="computer_admin",
        )
        person = Person(canonical_name="Pending Member")
        db.add_all([user, person])
        db.commit()
        app = create_app()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[current_user] = lambda: user
        with TestClient(app) as client:
            yield client, db, user, person
    engine.dispose()


def leave(db, person, start="2026-05-10", end=None, status="requested"):
    row = LeaveRequest(
        person=person,
        starts_on=date.fromisoformat(start),
        ends_on=date.fromisoformat(end or start),
        status=status,
        leave_type="ANNUAL_LEAVE",
        leave_slot="FULL_DAY",
        notes="Keep this note",
    )
    db.add(row)
    db.commit()
    return row


def preview(client, month="2026-05"):
    result = client.post("/api/v1/leave/approval-preview", json={"month": month})
    assert result.status_code == 200
    return result.json()


def apply(client, review, **extra):
    return client.post(
        "/api/v1/leave/approve-month",
        json={
            "month": review["month"],
            "review_token": review["review_token"],
            **extra,
        },
    )


def test_month_overlap_status_scope_audits_and_repeat(environment):
    client, db, user, person = environment
    pending = [
        leave(db, person),
        leave(db, person, "2026-04-30", "2026-05-02"),
        leave(db, person, "2026-05-31", "2026-06-02", "imported_pending_review"),
    ]
    untouched = [
        leave(db, person, status=status) for status in ["approved", "cancelled", "rejected"]
    ]
    untouched += [leave(db, person, "2026-04-29"), leave(db, person, "2026-06-03")]
    original = {row.id: (row.starts_on, row.ends_on, row.notes, row.status) for row in untouched}
    review = preview(client)
    assert review["pending_count"] == 3 and not review["affected_duties"]
    assert all(row.status != "approved" for row in pending)  # Preview does not write.
    result = apply(client, review)
    assert result.status_code == 200 and result.json()["approved_count"] == 3
    assert set(result.json()["approved_ids"]) == {str(row.id) for row in pending}
    assert all(row.status == "approved" and row.notes == "Keep this note" for row in pending)
    assert all(
        (row.starts_on, row.ends_on, row.notes, row.status) == original[row.id] for row in untouched
    )
    events = list(
        db.scalars(
            select(NormalizationEvent).where(NormalizationEvent.action == "leave_bulk_approved")
        )
    )
    assert len(events) == 3 and all(event.operator_id == user.id for event in events)
    assert db.query(MemberActivity).filter_by(action="leave_bulk_approved").count() == 3
    assert apply(client, review).json()["approved_count"] == 0
    assert preview(client)["pending_count"] == 0
    assert db.query(MemberActivity).filter_by(action="leave_bulk_approved").count() == 3


@pytest.mark.parametrize("role", ["rota_board_member", "hod"])
def test_both_endpoints_are_admin_only(environment, role):
    client, db, user, person = environment
    row = leave(db, person)
    review = preview(client)
    user.role = role
    assert (
        client.post("/api/v1/leave/approval-preview", json={"month": "2026-05"}).status_code == 403
    )
    assert apply(client, review).status_code == 403
    assert row.status == "requested"
    client.app.dependency_overrides.pop(current_user)
    assert (
        client.post("/api/v1/leave/approval-preview", json={"month": "2026-05"}).status_code == 401
    )
    assert apply(client, review).status_code == 401


@pytest.mark.parametrize("month", ["2026-13", "2026-1", "0000-01", "bad", "2026-05-01"])
def test_invalid_month_never_writes(environment, month):
    client, db, _, person = environment
    row = leave(db, person)
    assert client.post("/api/v1/leave/approval-preview", json={"month": month}).status_code == 422
    assert (
        client.post(
            "/api/v1/leave/approve-month", json={"month": month, "review_token": "0" * 64}
        ).status_code
        == 422
    )
    assert row.status == "requested"


def test_stale_review_rejects_entire_batch_and_refresh_recovers(environment):
    client, db, _, person = environment
    first = leave(db, person)
    review = preview(client)
    second = leave(db, person, "2026-05-12")
    assert apply(client, review).status_code == 409
    assert first.status == second.status == "requested"
    assert db.query(MemberActivity).count() == 0
    assert apply(client, preview(client)).json()["approved_count"] == 2


def test_affected_duties_require_acknowledgement_but_are_preserved(environment):
    client, db, _, person = environment
    row = leave(db, person, "2026-05-02")
    unit = Unit(code="TEST", name="Test Unit")
    db.add(unit)
    slot = create_slot(db, unit, date(2026, 5, 2))
    assignment = DutyAssignment(person=person, duty_slot=slot, status="assigned")
    db.add(assignment)
    db.commit()
    review = preview(client)
    assert len(review["affected_duties"]) == 1
    assert review["affected_duties"][0]["person_name"] == person.canonical_name
    assert apply(client, review).status_code == 409 and row.status == "requested"
    assert apply(client, review, acknowledge_duties=True).status_code == 200
    assert assignment.status == "assigned" and assignment.person_id == person.id
    assert row.status == "approved"


def test_cancelled_assignments_are_not_reported_as_conflicts(environment):
    client, db, _, person = environment
    leave(db, person, "2026-05-02")
    unit = Unit(code="TEST", name="Test Unit")
    db.add(unit)
    slot = create_slot(db, unit, date(2026, 5, 2))
    db.add(DutyAssignment(person=person, duty_slot=slot, status="cancelled"))
    db.commit()
    review = preview(client)
    assert review["affected_duties"] == []
    assert apply(client, review).json()["approved_count"] == 1


def test_preview_is_bound_to_admin_and_extra_payload_is_rejected(environment):
    client, db, user, person = environment
    leave(db, person)
    review = preview(client)
    other = UserAccount(id=uuid4(), username="another-admin", role="superadmin")
    client.app.dependency_overrides[current_user] = lambda: other
    assert apply(client, review).status_code == 409
    client.app.dependency_overrides[current_user] = lambda: user
    assert apply(client, review, unexpected=True).status_code == 422
    assert apply(client, review, acknowledge_duties="true").status_code == 422


def test_commit_failure_rolls_back_statuses_and_audits(environment, monkeypatch):
    client, db, user, person = environment
    rows = [leave(db, person), leave(db, person, "2026-05-12")]
    review = preview(client)

    def failure():
        db.flush()
        raise RuntimeError("Injected commit failure")

    monkeypatch.setattr(db, "commit", failure)
    with pytest.raises(RuntimeError, match="Injected commit failure"):
        approve_month(db, "2026-05", user, review["review_token"])
    assert all(row.status == "requested" for row in rows)
    assert db.query(MemberActivity).count() == 0
    assert db.query(NormalizationEvent).count() == 0
