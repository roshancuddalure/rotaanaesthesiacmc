from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AdminMapping,
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportSourceRecord,
    ImportWarning,
    Person,
    PersonAlias,
    PersonPosting,
    RotaPeriod,
    Unit,
)
from app.services.imports import (
    ParsedRotaAssignment,
    ParsedUnitPosting,
    clean_person_name,
    parse_rota_workbook,
    parse_unitwise_workbook,
)


@dataclass(frozen=True)
class HistoricalImportSummary:
    rota_files: int
    unitwise_files: int
    periods_created: int
    people_created: int
    aliases_created: int
    units_created: int
    duty_slots_created: int
    duty_assignments_created: int
    postings_created: int
    source_records_created: int
    warnings_created: int
    skipped_assignments: int


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def load_mapping_lookup(db: Session, mapping_type: str) -> dict[str, AdminMapping]:
    mappings = db.scalars(
        select(AdminMapping).where(AdminMapping.mapping_type == mapping_type)
    ).all()
    return {mapping.source_label: mapping for mapping in mappings}


def get_or_create_person(db: Session, name: str, summary: dict[str, int]) -> Person:
    person = db.scalar(select(Person).where(Person.canonical_name == name))
    if person is not None:
        return person

    person = Person(canonical_name=name)
    db.add(person)
    db.flush()
    summary["people_created"] += 1
    return person


def ensure_alias(db: Session, person: Person, raw_name: str, summary: dict[str, int]) -> None:
    alias = clean_person_name(raw_name)
    if not alias or alias == person.canonical_name:
        return
    existing = db.scalar(select(PersonAlias).where(PersonAlias.alias == alias))
    if existing is not None:
        return

    db.add(PersonAlias(person=person, alias=alias, source="historical_import"))
    summary["aliases_created"] += 1


def get_or_create_period(db: Session, year: int, month: int, summary: dict[str, int]) -> RotaPeriod:
    name = f"{year}-{month:02d}"
    period = db.scalar(select(RotaPeriod).where(RotaPeriod.name == name))
    if period is not None:
        return period

    starts_on, ends_on = month_bounds(year, month)
    period = RotaPeriod(name=name, starts_on=starts_on, ends_on=ends_on, status="historical")
    db.add(period)
    db.flush()
    summary["periods_created"] += 1
    return period


def get_or_create_unit(
    db: Session,
    source_label: str,
    mapping: AdminMapping | None,
    summary: dict[str, int],
) -> Unit:
    code = mapping.target_key if mapping and mapping.target_key else source_label.upper().replace(" ", "_")
    name = mapping.target_label if mapping and mapping.target_label else source_label
    unit = db.scalar(select(Unit).where(Unit.code == code))
    if unit is not None:
        return unit

    unit = Unit(code=code, name=name, notes=f"Imported from source unit label: {source_label}")
    db.add(unit)
    db.flush()
    summary["units_created"] += 1
    return unit


def get_or_create_duty_slot(
    db: Session,
    period: RotaPeriod,
    assignment: ParsedRotaAssignment,
    duty_type: str,
    summary: dict[str, int],
) -> DutySlot:
    slot_label = assignment.duty_label
    slot = db.scalar(
        select(DutySlot).where(
            DutySlot.rota_period_id == period.id,
            DutySlot.duty_date == assignment.duty_date,
            DutySlot.duty_type == duty_type,
            DutySlot.slot_label == slot_label,
        )
    )
    if slot is not None:
        return slot

    slot = DutySlot(
        rota_period=period,
        duty_date=assignment.duty_date,
        duty_type=duty_type,
        slot_label=slot_label,
        starts_at=assignment.starts_at,
        ends_at=assignment.ends_at,
        is_24hr=assignment.is_24hr,
        source="historical_import",
        notes=f"Source duty label: {assignment.duty_label}",
    )
    db.add(slot)
    db.flush()
    summary["duty_slots_created"] += 1
    return slot


def ensure_assignment(
    db: Session,
    slot: DutySlot,
    person: Person,
    summary: dict[str, int],
) -> None:
    existing = db.scalar(
        select(DutyAssignment).where(
            DutyAssignment.duty_slot_id == slot.id,
            DutyAssignment.person_id == person.id,
        )
    )
    if existing is not None:
        return

    db.add(DutyAssignment(duty_slot=slot, person=person, source="historical_import"))
    summary["duty_assignments_created"] += 1


def ensure_posting(
    db: Session,
    person: Person,
    unit: Unit,
    posting_type: str,
    starts_on: date,
    ends_on: date,
    summary: dict[str, int],
) -> None:
    existing = db.scalar(
        select(PersonPosting).where(
            PersonPosting.person_id == person.id,
            PersonPosting.unit_id == unit.id,
            PersonPosting.posting_type == posting_type,
            PersonPosting.starts_on == starts_on,
        )
    )
    if existing is not None:
        return

    db.add(
        PersonPosting(
            person=person,
            unit=unit,
            posting_type=posting_type,
            starts_on=starts_on,
            ends_on=ends_on,
            source="historical_import",
        )
    )
    summary["postings_created"] += 1


def add_source_record(
    db: Session,
    batch: ImportBatch,
    parsed: ParsedRotaAssignment | ParsedUnitPosting,
    record_type: str,
    normalized_table: str | None,
    normalized_id,
    rule_key: str | None,
    raw_value: str,
    cleaned_value: str,
    summary: dict[str, int],
) -> ImportSourceRecord:
    record = ImportSourceRecord(
        batch=batch,
        sheet_name=parsed.sheet_name,
        row_index=parsed.row_index,
        column_index=parsed.column_index,
        column_label=parsed.column_label,
        raw_value=raw_value,
        cleaned_value=cleaned_value,
        record_type=record_type,
        normalized_table=normalized_table,
        normalized_id=normalized_id,
        rule_key=rule_key,
    )
    db.add(record)
    summary["source_records_created"] += 1
    return record


def add_warning(
    db: Session,
    batch: ImportBatch,
    code: str,
    message: str,
    summary: dict[str, int],
    record: ImportSourceRecord | None = None,
) -> None:
    db.add(
        ImportWarning(
            batch=batch,
            source_record=record,
            code=code,
            message=message,
            severity="warning",
        )
    )
    summary["warnings_created"] += 1


def create_batch(db: Session, path: Path, import_kind: str) -> ImportBatch:
    batch = ImportBatch(
        source_filename=path.name,
        source_path=str(path),
        import_kind=import_kind,
        status="running",
        source_metadata={"path": str(path)},
    )
    db.add(batch)
    db.flush()
    return batch


def import_rota_file(
    db: Session,
    path: Path,
    duty_mappings: dict[str, AdminMapping],
    summary: dict[str, int],
) -> None:
    parsed = parse_rota_workbook(path)
    period = get_or_create_period(db, parsed.month.year, parsed.month.month, summary)
    batch = create_batch(db, path, "historical_rota")

    for warning in parsed.warnings:
        add_warning(db, batch, warning.code, warning.message, summary)

    for assignment in parsed.assignments:
        mapping = duty_mappings.get(assignment.duty_label)
        duty_type = mapping.target_key if mapping and mapping.target_key else None
        source_record = add_source_record(
            db,
            batch,
            assignment,
            "duty_assignment_cell",
            None,
            None,
            "admin_mappings.duty_label",
            assignment.raw_person_name,
            assignment.person_name,
            summary,
        )
        if duty_type is None:
            summary["skipped_assignments"] += 1
            add_warning(
                db,
                batch,
                "UNMAPPED_DUTY_LABEL",
                f"No admin mapping target for duty label: {assignment.duty_label}",
                summary,
                source_record,
            )
            continue

        person = get_or_create_person(db, assignment.person_name, summary)
        ensure_alias(db, person, assignment.raw_person_name, summary)
        slot = get_or_create_duty_slot(db, period, assignment, duty_type, summary)
        source_record.normalized_table = "duty_assignments"
        ensure_assignment(db, slot, person, summary)

    batch.status = "completed"


def import_unitwise_file(
    db: Session,
    path: Path,
    unit_mappings: dict[str, AdminMapping],
    posting_mappings: dict[str, AdminMapping],
    summary: dict[str, int],
) -> None:
    parsed = parse_unitwise_workbook(path)
    starts_on, ends_on = month_bounds(parsed.month.year, parsed.month.month)
    batch = create_batch(db, path, "historical_unitwise")

    for warning in parsed.warnings:
        add_warning(db, batch, warning.code, warning.message, summary)

    for posting in parsed.postings:
        unit_mapping = unit_mappings.get(posting.unit_label)
        posting_mapping = posting_mappings.get(posting.posting_label)
        posting_type = (
            posting_mapping.target_key
            if posting_mapping and posting_mapping.target_key
            else posting.posting_label.upper().replace(" ", "_")
        )
        unit = get_or_create_unit(db, posting.unit_label, unit_mapping, summary)
        person = get_or_create_person(db, posting.person_name, summary)
        ensure_alias(db, person, posting.raw_person_name, summary)
        ensure_posting(db, person, unit, posting_type, starts_on, ends_on, summary)
        add_source_record(
            db,
            batch,
            posting,
            "unitwise_posting_cell",
            "person_postings",
            None,
            "admin_mappings.unit_label/posting_label",
            posting.raw_person_name,
            posting.person_name,
            summary,
        )

    batch.status = "completed"


def import_historical_sources(db: Session, historical_dir: Path) -> HistoricalImportSummary:
    counters = {
        "periods_created": 0,
        "people_created": 0,
        "aliases_created": 0,
        "units_created": 0,
        "duty_slots_created": 0,
        "duty_assignments_created": 0,
        "postings_created": 0,
        "source_records_created": 0,
        "warnings_created": 0,
        "skipped_assignments": 0,
    }
    duty_mappings = load_mapping_lookup(db, "duty_label")
    unit_mappings = load_mapping_lookup(db, "unit_label")
    posting_mappings = load_mapping_lookup(db, "posting_label")

    rota_files = sorted(historical_dir.glob("*.xlsx"))
    unitwise_files = sorted((historical_dir / "unitwise").glob("*.xlsx"))

    for path in rota_files:
        import_rota_file(db, path, duty_mappings, counters)

    for path in unitwise_files:
        import_unitwise_file(db, path, unit_mappings, posting_mappings, counters)

    db.commit()
    return HistoricalImportSummary(
        rota_files=len(rota_files),
        unitwise_files=len(unitwise_files),
        **counters,
    )
