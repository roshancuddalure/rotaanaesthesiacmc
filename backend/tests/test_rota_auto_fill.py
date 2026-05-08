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
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, RotaAutoFillEvent, Unit
from app.services.auth import seed_superadmin
from app.services.rota_auto_fill import run_safe_auto_fill
from app.services.rota_setup import monthly_setup


def duty_bounds(day: date) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=24)


def create_slot(
    session: Session,
    unit: Unit,
    duty_date: date,
    call_level: str = "1ST_CALL",
) -> DutySlot:
    period, _scope = monthly_setup(session, "2026-05")
    starts_at, ends_at = duty_bounds(duty_date)
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=duty_date,
        duty_type="MAIN_1ST_24HR",
        call_level=call_level,
        slot_label=f"{unit.code}:{call_level}:{duty_date.isoformat()}",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    session.flush()
    return slot


def seed_auto_fill_context(session: Session) -> tuple[DutySlot, DutySlot]:
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    safe = Person(canonical_name="Safe Member", call_level="1ST_CALL")
    spare_one = Person(canonical_name="Spare One", call_level="1ST_CALL")
    spare_two = Person(canonical_name="Spare Two", call_level="1ST_CALL")
    blocked = Person(canonical_name="Blocked Member", call_level="1ST_CALL")
    session.add_all([unit, safe, spare_one, spare_two, blocked])
    session.flush()
    for person in [safe, spare_one, spare_two, blocked]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    fillable = create_slot(session, unit, date(2026, 5, 2), "1ST_CALL")
    no_candidate = create_slot(session, unit, date(2026, 5, 3), "2ND_CALL")
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
    return fillable, no_candidate


def test_safe_auto_fill_assigns_only_clear_slots_and_records_events() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        fillable, no_candidate = seed_auto_fill_context(session)

        result = run_safe_auto_fill(session, "2026-05")

        assert result["assigned_slots"] == 1
        assert result["skipped_slots"] == 1
        assert session.query(DutyAssignment).count() == 1
        assignment = session.query(DutyAssignment).one()
        assert assignment.duty_slot_id == fillable.id
        assert assignment.source == "safe_auto_fill_draft"
        events = session.query(RotaAutoFillEvent).all()
        assert {event.action for event in events} == {"assigned", "blocked"}
        assert any(event.duty_slot_id == no_candidate.id for event in events)


@contextmanager
def auto_fill_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        seed_auto_fill_context(seed_session)

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


def test_rota_auto_fill_api_runs_and_returns_latest_report() -> None:
    with auto_fill_client() as client:
        token = sign_in(client)
        response = client.post(
            "/api/v1/rota-auto-fill/draft?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert response.status_code == 200
        assert response.json()["assigned_slots"] == 1

        month_response = client.get(
            "/api/v1/rota-auto-fill/month?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert month_response.status_code == 200
        assert month_response.json()["latest_run"]["assigned_slots"] == 1
