from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, Person, PersonPosting, RotaExchangeRequest, Unit
from app.services.auth import seed_superadmin
from app.services.rota_review import (
    EXCHANGE_APPROVED,
    EXCHANGE_PENDING,
    EXCHANGE_SOURCE,
    approve_exchange_request,
    create_exchange_request,
    rota_review_month,
)
from app.services.rota_setup import monthly_setup
from app.services.rota_template import NEEDS_REVIEW


def duty_bounds(day: date) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=24)


def seed_review_context(session: Session) -> dict[str, str]:
    user = seed_superadmin(session)
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    assigned = Person(canonical_name="Assigned Member", call_level="1ST_CALL")
    replacement = Person(canonical_name="Replacement Member", call_level="1ST_CALL")
    spare = Person(canonical_name="Spare Member", call_level="1ST_CALL")
    session.add_all([unit, assigned, replacement, spare])
    session.flush()
    for person in [assigned, replacement, spare]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    period, _scope = monthly_setup(session, "2026-05")
    first_start, first_end = duty_bounds(date(2026, 5, 2))
    assigned_slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 2),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary",
        starts_at=first_start,
        ends_at=first_end,
        is_24hr=True,
        source="phase4_template",
    )
    second_start, second_end = duty_bounds(date(2026, 5, 3))
    open_slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 3),
        duty_type="MAIN_1ST_24HR",
        call_level="1ST_CALL",
        slot_label="UNIT_I:primary-extra",
        starts_at=second_start,
        ends_at=second_end,
        is_24hr=True,
        source="phase4_template",
        template_status=NEEDS_REVIEW,
        template_reason="Board review requested for staffing pressure.",
    )
    session.add_all([assigned_slot, open_slot])
    session.flush()
    assignment = DutyAssignment(
        duty_slot=assigned_slot,
        person=assigned,
        source="safe_auto_fill_draft",
    )
    session.add(assignment)
    session.commit()
    return {
        "user_id": str(user.id),
        "assignment_id": str(assignment.id),
        "replacement_id": str(replacement.id),
    }


def test_rota_review_dashboard_lists_review_items_and_workload() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        ids = seed_review_context(session)
        result = rota_review_month(session, "2026-05")

        assert result["summary"]["total_slots"] == 2
        assert result["summary"]["assigned_slots"] == 1
        assert result["summary"]["open_slots"] == 1
        assert result["summary"]["review_items"] >= 1
        assert result["assignment_options"][0]["assignment"]["id"] == ids["assignment_id"]
        assert result["person_workload"][0]["person_name"] == "Assigned Member"
        assert result["person_workload"][0]["total_24hr"] == 1
        assert any(
            issue["code"] == "open_slot"
            for item in result["review_items"]
            for issue in item["issues"]
        )


def test_exchange_request_approval_replaces_assignment_and_keeps_audit() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        ids = seed_review_context(session)
        replacement = session.get(Person, UUID(ids["replacement_id"]))
        approver = seed_superadmin(session)
        assert replacement is not None

        exchange = create_exchange_request(
            session,
            assignment_id=UUID(ids["assignment_id"]),
            to_person_id=replacement.id,
            reason="Approved member swap",
            requested_by=approver,
        )
        assert exchange["status"] == EXCHANGE_PENDING

        approved = approve_exchange_request(
            session,
            exchange_id=UUID(str(exchange["id"])),
            approved_by=approver,
            decision_reason="Board approved the swap.",
        )

        assignment = session.scalars(select(DutyAssignment)).one()
        audit = session.scalars(select(RotaExchangeRequest)).one()
        assert approved["status"] == EXCHANGE_APPROVED
        assert assignment.person_id == replacement.id
        assert assignment.source == EXCHANGE_SOURCE
        assert audit.applied_assignment_id == assignment.id


@contextmanager
def review_client() -> Generator[tuple[TestClient, str, str], None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        ids = seed_review_context(seed_session)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), ids["assignment_id"], ids["replacement_id"]
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_review_api_dashboard_and_exchange_request() -> None:
    with review_client() as (client, assignment_id, replacement_id):
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        review_response = client.get("/api/v1/rota-review/month?month=2026-05", headers=headers)
        assert review_response.status_code == 200
        assert review_response.json()["summary"]["open_slots"] == 1

        exchange_response = client.post(
            "/api/v1/rota-review/exchanges",
            headers=headers,
            json={
                "assignment_id": assignment_id,
                "to_person_id": replacement_id,
                "reason": "API requested swap",
            },
        )
        assert exchange_response.status_code == 200
        assert exchange_response.json()["status"] == EXCHANGE_PENDING
