from datetime import date, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import (
    AdminMapping,
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportSourceRecord,
    ImportWarning,
    LeaveRequest,
    Person,
    PersonPosting,
    RotaPeriod,
    RuleSetting,
    RuleVersion,
    Unit,
)


def test_domain_models_create_and_link_records() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        person = Person(canonical_name="Dr Test")
        unit = Unit(code="MAIN", name="Main Theatre", campus="CMC")
        rota_period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
        )
        rule_version = RuleVersion(
            name="MVP default rules",
            effective_from=date(2026, 5, 1),
        )
        rule_setting = RuleSetting(
            rule_version=rule_version,
            key="minimum_gap_between_24hr_duties",
            value={"hours": 24},
            value_type="duration",
        )
        posting = PersonPosting(
            person=person,
            unit=unit,
            posting_type="MAIN",
            starts_on=date(2026, 5, 1),
        )
        leave_request = LeaveRequest(
            person=person,
            leave_type="annual",
            starts_on=date(2026, 5, 10),
            ends_on=date(2026, 5, 12),
        )
        starts_at = datetime(2026, 5, 3, 8)
        duty_slot = DutySlot(
            rota_period=rota_period,
            unit=unit,
            duty_date=starts_at.date(),
            duty_type="MAIN_1ST_24HR",
            call_level="1ST_CALL",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=24),
            is_24hr=True,
        )
        assignment = DutyAssignment(duty_slot=duty_slot, person=person)
        import_batch = ImportBatch(
            source_filename="May 2026 rota.xlsx",
            source_path="data/source/historical/May 2026 rota.xlsx",
            import_kind="excel",
            source_metadata={"sheets": ["May 2026"]},
        )
        import_record = ImportSourceRecord(
            batch=import_batch,
            sheet_name="May 2026",
            row_index=2,
            column_index=2,
            column_label="B",
            raw_value="Dr Test",
            cleaned_value="Test",
            record_type="duty_assignment_cell",
        )
        import_warning = ImportWarning(
            batch=import_batch,
            source_record=import_record,
            code="UNMAPPED_ALIAS",
            message="Alias needs review",
        )
        admin_mapping = AdminMapping(
            mapping_type="duty_label",
            source_label="Cesar call A",
            target_key="CAESAR_A_12HR",
            target_label="Caesar A",
            status="reviewed",
        )

        session.add_all(
            [
                person,
                unit,
                rota_period,
                rule_setting,
                posting,
                leave_request,
                assignment,
                import_warning,
                admin_mapping,
            ]
        )
        session.commit()

        saved = session.scalars(select(Person).where(Person.canonical_name == "Dr Test")).one()

        assert saved.postings[0].unit.code == "MAIN"
        assert saved.leave_requests[0].leave_type == "annual"
        assert saved.duty_assignments[0].duty_slot.duty_type == "MAIN_1ST_24HR"
        assert rule_version.settings[0].value == {"hours": 24}
        assert import_batch.source_records[0].cleaned_value == "Test"
        assert import_batch.warnings[0].code == "UNMAPPED_ALIAS"
        assert admin_mapping.target_key == "CAESAR_A_12HR"
