from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, Unit
from app.services.auth import seed_superadmin
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot, clear_assignment
from app.services.rota_setup import monthly_setup


def duty_bounds(day: date, hours: int = 24) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=hours)


def seed_manual_assignment_context(session: Session) -> tuple[Unit, Person, Person, DutySlot]:
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    blocked = Person(canonical_name="Blocked Member", call_level="1ST_CALL")
    available = Person(canonical_name="Available Member", call_level="1ST_CALL")
    cover_one = Person(canonical_name="Cover One", call_level="1ST_CALL")
    cover_two = Person(canonical_name="Cover Two", call_level="1ST_CALL")
    session.add_all([unit, blocked, available, cover_one, cover_two])
    session.flush()
    for person in [blocked, available, cover_one, cover_two]:
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
    starts_at, ends_at = duty_bounds(date(2026, 5, 2))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=date(2026, 5, 2),
        duty_type="MAIN_1ST_24HR",
        slot_label="UNIT_I:primary",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    session.add(
        LeaveRequest(
            person=blocked,
            leave_type="ANNUAL_LEAVE",
            leave_slot="FULL_DAY",
            starts_on=date(2026, 5, 2),
            ends_on=date(2026, 5, 2),
            status="approved",
        )
    )
    session.commit()
    return unit, blocked, available, slot


def test_manual_assignment_requires_override_for_approved_leave_conflict() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _unit, blocked, _available, slot = seed_manual_assignment_context(session)

        try:
            assign_person_to_slot(session, slot_id=slot.id, person_id=blocked.id)
        except RotaAssignmentError as exc:
            assert exc.status_code == 409
            assert exc.validation is not None
            assert exc.validation["requires_override"] is True
            assert any(issue["code"] == "leave" for issue in exc.validation["issues"])
        else:
            raise AssertionError("Approved leave conflict should require an override reason")


def test_manual_assignment_allows_override_and_recalculates_slot_safety() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _unit, blocked, _available, slot = seed_manual_assignment_context(session)

        result = assign_person_to_slot(
            session,
            slot_id=slot.id,
            person_id=blocked.id,
            override_reason="Board approved emergency cover",
        )

        assert result["status"] == "assigned"
        assert result["assignment"]["person_id"] == str(blocked.id)
        assert result["assignment"]["override_reason"] == "Board approved emergency cover"
        assert result["slot_safety"]["slot_id"] == str(slot.id)
        assert session.query(DutyAssignment).count() == 1


def test_manual_assignment_replace_and_clear() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        _unit, _blocked, available, slot = seed_manual_assignment_context(session)
        first = Person(canonical_name="First Assigned", call_level="1ST_CALL")
        session.add(first)
        session.flush()
        session.add(
            PersonPosting(
                person=first,
                unit=slot.unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
        session.add(DutyAssignment(duty_slot=slot, person=first, source="manual_rota_board"))
        session.commit()

        replaced = assign_person_to_slot(
            session,
            slot_id=slot.id,
            person_id=available.id,
            replace_existing=True,
        )
        assert replaced["assignment"]["person_id"] == str(available.id)
        assert session.query(DutyAssignment).count() == 1

        assignment_id = session.query(DutyAssignment.id).scalar()
        cleared = clear_assignment(session, assignment_id)
        assert cleared["status"] == "cleared"
        assert session.query(DutyAssignment).count() == 0


@contextmanager
def assignment_client() -> Generator[tuple[TestClient, str, str], None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        _unit, _blocked, available, slot = seed_manual_assignment_context(seed_session)
        slot_id = str(slot.id)
        available_id = str(available.id)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), slot_id, available_id
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_assignment_api_assigns_and_clears_slot() -> None:
    with assignment_client() as (client, slot_id, person_id):
        token = sign_in(client)
        response = client.post(
            f"/api/v1/rota-assignments/slots/{slot_id}/assign",
            headers={"Authorization": f"Bearer {token}"},
            json={"person_id": person_id},
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment"]["id"]

        clear_response = client.delete(
            f"/api/v1/rota-assignments/assignments/{assignment_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert clear_response.status_code == 200
        assert clear_response.json()["status"] == "cleared"
