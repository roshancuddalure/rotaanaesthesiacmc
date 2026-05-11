from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import LeaveRequest, Person, PersonPosting, Unit
from app.services.rota_setup import (
    clone_previous_scope,
    monthly_setup,
    unit_readiness,
    update_scope_units,
)


def test_monthly_setup_creates_period_and_scope() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        period, scope = monthly_setup(session, "2026-05")

        assert period.name == "May 2026"
        assert period.starts_on == date(2026, 5, 1)
        assert period.ends_on == date(2026, 5, 31)
        assert scope.rota_period_id == period.id
        assert scope.include_excluded_units_in_safety is True
        assert scope.is_locked is False


def test_update_scope_units_and_readiness() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        excluded = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
        person = Person(canonical_name="Dr Unit Member", call_level="1ST_CALL")
        session.add_all([unit, excluded, person])
        session.flush()
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
        session.add(
            LeaveRequest(
                person=person,
                leave_type="ANNUAL_LEAVE",
                starts_on=date(2026, 5, 10),
                ends_on=date(2026, 5, 11),
                status="approved",
            )
        )
        session.commit()

        _period, scope = monthly_setup(session, "2026-05")
        updated = update_scope_units(
            session,
            scope,
            [unit.id],
            [excluded.id],
            True,
            True,
            "Ready for generation",
        )
        readiness = unit_readiness(session, "2026-05", updated)
        included = next(item for item in readiness if item["unit_id"] == str(unit.id))
        excluded_row = next(item for item in readiness if item["unit_id"] == str(excluded.id))

        assert updated.is_locked is True
        assert {item.status for item in updated.units} == {"included", "excluded"}
        assert included["scope_status"] == "included"
        assert included["assigned_members"] == 1
        assert included["people_with_leave"] == 1
        assert excluded_row["scope_status"] == "excluded"


def test_update_scope_units_can_save_same_scope_again() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        excluded = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
        session.add_all([unit, excluded])
        session.commit()
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [unit.id], [excluded.id], True, True, "Ready")

        _period, scope = monthly_setup(session, "2026-05")
        updated = update_scope_units(session, scope, [unit.id], [excluded.id], True, True, "Ready")

        assert [(item.unit_id, item.status) for item in updated.units] == [
            (unit.id, "included"),
            (excluded.id, "excluded"),
        ]


def test_clone_previous_scope() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        session.add(unit)
        session.commit()
        _previous_period, previous_scope = monthly_setup(session, "2026-04")
        update_scope_units(session, previous_scope, [unit.id], [], True, True, "April locked")

        cloned = clone_previous_scope(session, "2026-05")

        assert cloned.is_locked is False
        assert [(item.unit_id, item.status) for item in cloned.units] == [(unit.id, "included")]
