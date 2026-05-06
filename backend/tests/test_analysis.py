from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import AdminMapping, DutyAssignment, DutySlot, Person, PersonPosting, RotaPeriod, Unit
from app.services.analysis import analyze_dashboard, analyze_preflight


def test_analysis_dashboard_counts_approved_periods() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        person = Person(canonical_name="Dr Test")
        unit = Unit(code="UNIT_I", name="Unit I")
        period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
            status="approved",
        )
        ignored_period = RotaPeriod(
            name="June 2026",
            starts_on=date(2026, 6, 1),
            ends_on=date(2026, 6, 30),
            status="draft",
        )
        saturday = datetime(2026, 5, 2, 8)
        slot = DutySlot(
            rota_period=period,
            duty_date=saturday.date(),
            duty_type="MAIN_1ST_24HR",
            slot_label="Main 1st Call",
            starts_at=saturday,
            ends_at=saturday + timedelta(hours=24),
            is_24hr=True,
        )
        fifth_slot = DutySlot(
            rota_period=period,
            duty_date=date(2026, 5, 3),
            duty_type="FIFTH_CALL",
            slot_label="5th Call",
            starts_at=datetime(2026, 5, 3, 8),
            ends_at=datetime(2026, 5, 4, 8),
            is_24hr=True,
        )
        ignored_slot = DutySlot(
            rota_period=ignored_period,
            duty_date=date(2026, 6, 1),
            duty_type="MAIN_1ST_24HR",
            slot_label="Main 1st Call",
            starts_at=datetime(2026, 6, 1, 8),
            ends_at=datetime(2026, 6, 2, 8),
            is_24hr=True,
        )
        posting = PersonPosting(
            person=person,
            unit=unit,
            posting_type="1ST_CALL",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
        )
        session.add_all(
            [
                DutyAssignment(person=person, duty_slot=slot),
                DutyAssignment(person=person, duty_slot=fifth_slot),
                DutyAssignment(person=person, duty_slot=ignored_slot),
                posting,
            ]
        )
        session.commit()

        dashboard = analyze_dashboard(session)

        assert dashboard["summary"]["total_24hr"] == 1
        assert dashboard["summary"]["total_weekend_24hr"] == 1
        assert dashboard["duty_category_totals"]["fifth_call"] == 1
        assert dashboard["months"] == ["May_2026"]
        person_row = dashboard["people"][0]
        assert person_row["name"] == "Dr Test"
        assert person_row["call_levels"] == {"May_2026": "1ST_CALL"}
        assert person_row["units"] == {"May_2026": "Unit I"}


def test_analysis_preflight_reports_quality_blockers() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
            status="historical",
        )
        invalid = Person(canonical_name="DATE")
        first = Person(canonical_name="Abishek V J")
        second = Person(canonical_name="ABISHEK VJ")
        starts_at = datetime(2026, 5, 2, 8)
        unknown_slot = DutySlot(
            rota_period=period,
            duty_date=starts_at.date(),
            duty_type="UNKNOWN_DUTY",
            slot_label="Unknown",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=24),
            is_24hr=True,
        )
        session.add_all(
            [
                DutyAssignment(person=invalid, duty_slot=unknown_slot),
                first,
                second,
                AdminMapping(
                    mapping_type="duty_label",
                    source_label="JUNIOR-1",
                    status="needs_review",
                ),
            ]
        )
        session.commit()

        preflight = analyze_preflight(session)

        assert preflight["safe_to_publish"] is False
        assert preflight["status"] == "needs_review"
        assert preflight["counts"]["invalid_members"] == 1
        assert preflight["counts"]["duplicate_groups"] == 1
        assert preflight["counts"]["unresolved_duty_mappings"] == 1
        assert preflight["counts"]["unknown_duty_types"] == 1
        assert preflight["examples"]["invalid_members"] == ["DATE"]
        assert preflight["examples"]["unknown_duty_types"] == ["UNKNOWN_DUTY"]


def test_analysis_preflight_ready_when_data_is_clean() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
            status="historical",
        )
        person = Person(canonical_name="Valid Person")
        starts_at = datetime(2026, 5, 2, 8)
        slot = DutySlot(
            rota_period=period,
            duty_date=starts_at.date(),
            duty_type="MAIN_1ST_24HR",
            slot_label="Main 1st Call",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=24),
            is_24hr=True,
        )
        session.add(DutyAssignment(person=person, duty_slot=slot))
        session.commit()

        preflight = analyze_preflight(session)

        assert preflight["safe_to_publish"] is True
        assert preflight["status"] == "ready"
        assert preflight["issues"] == []
