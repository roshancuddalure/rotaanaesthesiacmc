from collections.abc import Generator
from contextlib import contextmanager
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutySlot, LeaveRequest, Person, PersonPosting, Unit
from app.services.auth import seed_superadmin
from app.services.rota_setup import monthly_setup, update_scope_units
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template


def seed_template_context(session: Session) -> tuple[Unit, Unit, Person]:
    included = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    excluded = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
    person = Person(canonical_name="Template Member", call_level="1ST_CALL")
    session.add_all([included, excluded, person])
    session.flush()
    session.add(
        PersonPosting(
            person=person,
            unit=included,
            posting_type="1ST_CALL",
            starts_on=date(2026, 5, 1),
            source="unit_board",
        )
    )
    session.add(
        LeaveRequest(
            person=person,
            leave_type="ANNUAL_LEAVE",
            leave_slot="FULL_DAY",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 1),
            status="approved",
        )
    )
    session.commit()
    return included, excluded, person


def lock_month_scope(session: Session, included: Unit, excluded: Unit) -> None:
    _period, scope = monthly_setup(session, "2026-05")
    update_scope_units(
        session,
        scope,
        [included.id],
        [excluded.id],
        True,
        True,
        "Ready for template generation",
    )


def test_generate_empty_template_preserves_mandatory_and_blocks_adjustable_slots() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, _person = seed_template_context(session)
        lock_month_scope(session, included, excluded)

        result = generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR", "PAC"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        slots = session.query(DutySlot).all()
        assert result["latest_run"]["created_slots"] == 1
        assert result["latest_run"]["needs_review_slots"] == 1
        assert result["latest_run"]["blocked_slots"] == 1
        assert len(slots) == 1
        assert slots[0].unit_id == included.id
        assert slots[0].duty_type == "MAIN_1ST_24HR"
        assert slots[0].template_status == "needs_review"
        assert excluded.id not in {slot.unit_id for slot in slots}


def test_generate_empty_template_requires_locked_scope() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, _excluded, _person = seed_template_context(session)
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [included.id], [], True, False)

        try:
            generate_empty_template(
                session,
                "2026-05",
                TemplateGenerationOptions(duty_keys=["MAIN_1ST_24HR"]),
            )
        except ValueError as exc:
            assert "scope must be locked" in str(exc)
        else:
            raise AssertionError("Unlocked generation scope should block template generation")


@contextmanager
def template_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        included, excluded, _person = seed_template_context(seed_session)
        lock_month_scope(seed_session, included, excluded)

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


def test_rota_template_api_generates_and_returns_template_month() -> None:
    with template_client() as client:
        token = sign_in(client)
        response = client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "duty_keys": ["MAIN_1ST_24HR", "PAC"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-01",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["latest_run"]["created_slots"] == 1
        assert payload["latest_run"]["blocked_slots"] == 1
        assert payload["summary"]["needs_review_slots"] == 1
        assert payload["slots"][0]["unit_code"] == "UNIT_I"
