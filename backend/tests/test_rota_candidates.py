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
from app.services.rota_candidates import slot_candidates
from app.services.rota_setup import monthly_setup


def duty_bounds(day: date, hours: int = 24) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, time(hour=8))
    return starts_at, starts_at + timedelta(hours=hours)


def create_slot(
    session: Session,
    unit: Unit,
    duty_date: date,
    duty_type: str = "MAIN_1ST_24HR",
    call_level: str | None = None,
) -> DutySlot:
    period, _scope = monthly_setup(session, "2026-05")
    starts_at, ends_at = duty_bounds(duty_date)
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=duty_date,
        duty_type=duty_type,
        call_level=call_level,
        slot_label=f"{unit.code}:primary:{duty_date.isoformat()}",
        starts_at=starts_at,
        ends_at=ends_at,
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    session.flush()
    return slot


def seed_candidate_context(session: Session) -> tuple[DutySlot, Person]:
    unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    best = Person(canonical_name="Available Member", call_level="1ST_CALL")
    busy = Person(canonical_name="Busy Member", call_level="1ST_CALL")
    blocked = Person(canonical_name="Blocked Member", call_level="1ST_CALL")
    session.add_all([unit, best, busy, blocked])
    session.flush()
    for person in [best, busy, blocked]:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    busy_slot = create_slot(session, unit, date(2026, 5, 1))
    target_slot = create_slot(session, unit, date(2026, 5, 5))
    session.add(DutyAssignment(duty_slot=busy_slot, person=busy, source="manual_rota_board"))
    session.add(
        LeaveRequest(
            person=blocked,
            leave_type="ANNUAL_LEAVE",
            leave_slot="FULL_DAY",
            starts_on=date(2026, 5, 5),
            ends_on=date(2026, 5, 5),
            status="approved",
        )
    )
    session.commit()
    return target_slot, best


def test_slot_candidates_rank_low_burden_person_and_explain_blockers() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        target_slot, _best = seed_candidate_context(session)

        result = slot_candidates(session, target_slot.id)

        candidates = result["candidates"]
        assert candidates[0]["person_name"] == "Available Member"
        assert candidates[0]["candidate_status"] == "eligible"
        assert candidates[0]["counts"]["total_assignments"] == 0
        blocked = next(item for item in candidates if item["person_name"] == "Blocked Member")
        assert blocked["candidate_status"] == "blocked"
        assert any("Approved leave" in reason for reason in blocked["reasons"])


def test_shift_slot_with_unassigned_call_level_uses_unit_member_pool() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_III", name="Unit III", campus="MAIN")
        first = Person(canonical_name="First Call", call_level="1ST_CALL")
        third = Person(canonical_name="Third Call", call_level="3RD_CALL")
        session.add_all([unit, first, third])
        session.flush()
        for person in [first, third]:
            session.add(
                PersonPosting(
                    person=person,
                    unit=unit,
                    posting_type=person.call_level,
                    starts_on=date(2026, 5, 1),
                    source="unit_board",
                )
            )
        slot = create_slot(session, unit, date(2026, 5, 16), duty_type="MAIN_SHIFT", call_level="Unassigned")
        session.commit()

        result = slot_candidates(session, slot.id)

        names = {candidate["person_name"] for candidate in result["candidates"]}
        assert names == {"First Call", "Third Call"}
        assert all(candidate["candidate_status"] == "eligible" for candidate in result["candidates"])


def test_weekend_slot_prefers_member_with_fewer_weekend_duties() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        weekday_loaded = Person(canonical_name="Weekday Loaded", call_level="1ST_CALL")
        weekend_loaded = Person(canonical_name="Weekend Loaded", call_level="1ST_CALL")
        session.add_all([unit, weekday_loaded, weekend_loaded])
        session.flush()
        for person in [weekday_loaded, weekend_loaded]:
            session.add(
                PersonPosting(
                    person=person,
                    unit=unit,
                    posting_type="1ST_CALL",
                    starts_on=date(2026, 5, 1),
                    source="unit_board",
                )
            )
        weekday_slot = create_slot(session, unit, date(2026, 5, 4))
        weekend_slot = create_slot(session, unit, date(2026, 5, 3))
        target_slot = create_slot(session, unit, date(2026, 5, 10))
        session.add(DutyAssignment(duty_slot=weekday_slot, person=weekday_loaded, source="manual_rota_board"))
        session.add(DutyAssignment(duty_slot=weekend_slot, person=weekend_loaded, source="manual_rota_board"))
        session.commit()

        result = slot_candidates(session, target_slot.id)

        assert result["candidates"][0]["person_name"] == "Weekday Loaded"
        assert result["candidates"][0]["counts"]["same_day_type"] == 0
        second = next(candidate for candidate in result["candidates"] if candidate["person_name"] == "Weekend Loaded")
        assert second["counts"]["same_day_type"] == 1


@contextmanager
def candidate_client() -> Generator[tuple[TestClient, str], None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        slot, _best = seed_candidate_context(seed_session)
        slot_id = str(slot.id)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), slot_id
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_candidate_month_api_returns_ranked_candidates() -> None:
    with candidate_client() as (client, slot_id):
        token = sign_in(client)
        response = client.get(
            "/api/v1/rota-candidates/month?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        row = next(item for item in payload["slots"] if item["slot_id"] == slot_id)
        assert row["candidates"][0]["person_name"] == "Available Member"
        assert payload["summary"]["slots_with_candidates"] >= 1
