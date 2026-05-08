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
from app.services.rota_safety import month_safety
from app.services.rota_setup import monthly_setup


def duty_bounds(day: date, hours: int = 24) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=hours)


def seed_safety_context(session: Session) -> tuple[Unit, Person, Person]:
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    first = Person(canonical_name="Leave Person", call_level="1ST_CALL")
    second = Person(canonical_name="Rest Person", call_level="1ST_CALL")
    session.add_all([unit, first, second])
    session.flush()
    for person in [first, second]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    session.commit()
    return unit, first, second


def create_slot(session: Session, unit: Unit, duty_date: date, duty_type: str, is_24hr: bool) -> DutySlot:
    period, _scope = monthly_setup(session, "2026-05")
    starts_at, ends_at = duty_bounds(duty_date, 24 if is_24hr else 8)
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=duty_date,
        duty_type=duty_type,
        slot_label=f"{unit.code}:{duty_type}:{duty_date.isoformat()}",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=is_24hr,
        source="test",
    )
    session.add(slot)
    session.flush()
    return slot


def test_month_safety_subtracts_approved_leave_and_previous_24hr_rest() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit, leave_person, rest_person = seed_safety_context(session)
        previous_slot = create_slot(session, unit, date(2026, 5, 1), "MAIN_1ST_24HR", True)
        target_slot = create_slot(session, unit, date(2026, 5, 2), "PAC", False)
        session.add(
            DutyAssignment(
                duty_slot=previous_slot,
                person=rest_person,
                status="assigned",
                source="manual",
            )
        )
        session.add(
            LeaveRequest(
                person=leave_person,
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 2),
                ends_on=date(2026, 5, 2),
                status="approved",
            )
        )
        session.commit()

        safety = month_safety(session, "2026-05")
        target = next(row for row in safety["slots"] if row["slot_id"] == str(target_slot.id))

        assert target["eligible_members"] == 2
        assert target["available_members"] == 0
        assert target["hard_blocked_members"] == 2
        assert target["safety_status"] == "hard_blocked"
        blockers = {
            blocker["type"]
            for person in target["hard_blocked_people"]
            for blocker in person["blockers"]
        }
        assert blockers == {"leave", "post_24hr_rest"}


def test_month_safety_warns_for_review_pending_leave_without_subtracting_person() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit, leave_person, _second = seed_safety_context(session)
        slot = create_slot(session, unit, date(2026, 5, 3), "PAC", False)
        session.add(
            LeaveRequest(
                person=leave_person,
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 3),
                ends_on=date(2026, 5, 3),
                status="imported_pending_review",
            )
        )
        session.commit()

        safety = month_safety(session, "2026-05")
        target = next(row for row in safety["slots"] if row["slot_id"] == str(slot.id))

        assert target["eligible_members"] == 2
        assert target["available_members"] == 2
        assert target["warning_members"] == 1
        assert target["safety_status"] == "needs_review"


@contextmanager
def safety_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        unit, _first, _second = seed_safety_context(seed_session)
        create_slot(seed_session, unit, date(2026, 5, 4), "PAC", False)
        seed_session.commit()

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_safety_api_returns_slot_safety() -> None:
    with safety_client() as client:
        token = sign_in(client)
        response = client.get(
            "/api/v1/rota-safety/month?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"]["total_slots"] == 1
        assert payload["summary"]["safe_slots"] == 1
        assert payload["slots"][0]["available_members"] == 2
