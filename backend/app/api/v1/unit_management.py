import json
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import Person, PersonPosting, Unit, UnitCallMinimum, UserAccount
from app.services.rota_call_levels import normalize_call_level
from app.services.leave import month_bounds
from app.services.unit_management import (
    UNIT_BOARD_SOURCE,
    active_units,
    is_special_unit_posting,
    monthly_unit_assignments,
    normalize_posting_type,
    unit_call_member_counts,
    unit_leave_summary,
    validate_unit_month,
)
from app.services.unit_assignment_import import (
    apply_unit_assignment_import,
    preview_unit_assignment_import,
)

router = APIRouter()


class UnitRead(BaseModel):
    id: UUID
    code: str
    name: str
    campus: str | None
    minimum_free_people: int
    active_status: str
    notes: str | None


class UnitCallMinimumRead(BaseModel):
    unit_id: UUID
    call_level: str
    assigned_members: int
    minimum_free_people: int
    max_allowed: int


class UnitPersonRead(BaseModel):
    id: UUID
    canonical_name: str
    active_status: str
    call_level: str | None


class UnitAssignmentRead(BaseModel):
    id: UUID
    person: UnitPersonRead
    unit: UnitRead | None
    posting_type: str
    starts_on: date
    ends_on: date | None
    source: str
    notes: str | None


class UnitSummaryRead(BaseModel):
    unit_id: UUID
    assigned_members: int
    people_with_leave: int
    leave_days: int
    leave_by_call_level: dict[str, int]


class UnitValidationIssueRead(BaseModel):
    severity: str
    code: str
    message: str
    person_id: str | None = None
    unit_id: str | None = None
    posting_id: str | None = None


class UnitManagementMonthRead(BaseModel):
    month: str
    starts_on: date
    ends_on: date
    units: list[UnitRead]
    assignments: list[UnitAssignmentRead]
    unit_summaries: list[UnitSummaryRead]
    unit_call_minimums: list[UnitCallMinimumRead]
    validation_issues: list[UnitValidationIssueRead]


class UnitAssignmentImportPreviewRead(BaseModel):
    filename: str
    month: str
    total_rows: int
    matched_rows: int
    auto_resolved_rows: int = 0
    auto_assignable_rows: int = 0
    needs_review_rows: int = 0
    review_suggested_rows: int = 0
    unresolved_rows: int
    invalid_rows: int
    sheets: list[str] = []
    source_formats: list[str] = []
    parser_warnings: list[str] = []
    rows: list[dict[str, object]]


class UnitAssignmentImportApplyRead(BaseModel):
    filename: str
    month: str
    created_rows: int
    auto_assigned_rows: int = 0
    learned_mappings: int = 0
    deleted_existing_rows: int
    skipped_rows: int
    skipped_preview_rows: list[dict[str, object]]
    preview: dict[str, object]


class UnitAssignmentPayload(BaseModel):
    person_id: UUID
    unit_id: UUID | None = None
    posting_type: str
    starts_on: date
    ends_on: date | None = None
    notes: str | None = None


class UnitCallMinimumPayload(BaseModel):
    call_level: str
    minimum_free_people: int


def parse_import_resolutions(raw: str | None) -> dict[str, dict[str, object]]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid import resolutions JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Import resolutions must be an object")
    resolutions: dict[str, dict[str, object]] = {}
    for key, value in parsed.items():
        if isinstance(key, str) and isinstance(value, dict):
            resolutions[key] = value
    return resolutions


class UnitSettingsPayload(BaseModel):
    minimum_free_people: int
    call_minimums: list[UnitCallMinimumPayload] = []


CALL_LEVEL_ORDER = ["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL", "Unassigned"]


def unit_call_minimum_rows(
    units: list[Unit],
    assignments: list[PersonPosting],
    month: str,
) -> list[UnitCallMinimumRead]:
    counts = unit_call_member_counts(assignments, month)
    rows: list[UnitCallMinimumRead] = []
    for unit in units:
        minimums = {normalize_call_level(item.call_level): item.minimum_free_people for item in unit.call_minimums}
        call_levels = sorted(
            {call for (unit_id, call), count in counts.items() if unit_id == unit.id and count > 0}.union(minimums),
            key=lambda call: (CALL_LEVEL_ORDER.index(call) if call in CALL_LEVEL_ORDER else 99, call),
        )
        for call_level in call_levels:
            assigned = counts.get((unit.id, call_level), 0)
            rows.append(
                UnitCallMinimumRead(
                    unit_id=unit.id,
                    call_level=call_level,
                    assigned_members=assigned,
                    minimum_free_people=int(minimums.get(call_level, 0)),
                    max_allowed=assigned,
                )
            )
    return rows


def unit_to_read(unit: Unit) -> UnitRead:
    return UnitRead(
        id=unit.id,
        code=unit.code,
        name=unit.name,
        campus=unit.campus,
        minimum_free_people=unit.minimum_free_people,
        active_status=unit.active_status,
        notes=unit.notes,
    )


def person_to_unit_read(person: Person) -> UnitPersonRead:
    return UnitPersonRead(
        id=person.id,
        canonical_name=person.canonical_name,
        active_status=person.active_status,
        call_level=person.call_level,
    )


def assignment_to_read(assignment: PersonPosting) -> UnitAssignmentRead:
    return UnitAssignmentRead(
        id=assignment.id,
        person=person_to_unit_read(assignment.person),
        unit=unit_to_read(assignment.unit) if assignment.unit else None,
        posting_type=assignment.posting_type,
        starts_on=assignment.starts_on,
        ends_on=assignment.ends_on,
        source=assignment.source,
        notes=assignment.notes,
    )


def get_person_or_404(db: Session, person_id: UUID) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="Department member not found")
    return person


def get_unit_or_404(db: Session, unit_id: UUID) -> Unit:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


def get_assignment_or_404(db: Session, assignment_id: UUID) -> PersonPosting:
    assignment = db.get(PersonPosting, assignment_id)
    if assignment is None or assignment.source != UNIT_BOARD_SOURCE:
        raise HTTPException(status_code=404, detail="Unit assignment not found")
    return assignment


def validate_payload_dates(payload: UnitAssignmentPayload) -> None:
    if payload.ends_on is not None and payload.ends_on < payload.starts_on:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")


def unit_for_assignment_payload(db: Session, payload: UnitAssignmentPayload) -> Unit | None:
    if is_special_unit_posting(payload.posting_type):
        return None
    if payload.unit_id is None:
        raise HTTPException(status_code=400, detail="Unit is required for this posting type")
    return get_unit_or_404(db, payload.unit_id)


@router.get("/units")
def list_units(
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[UnitRead]:
    return [unit_to_read(unit) for unit in active_units(db)]


@router.get("/unit-management/month")
def get_unit_management_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitManagementMonthRead:
    try:
        starts_on, ends_on = month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    units = active_units(db)
    assignments = monthly_unit_assignments(db, month)
    summaries = unit_leave_summary(db, month, assignments)
    return UnitManagementMonthRead(
        month=month,
        starts_on=starts_on,
        ends_on=ends_on,
        units=[unit_to_read(unit) for unit in units],
        assignments=[assignment_to_read(assignment) for assignment in assignments],
        unit_summaries=[
            UnitSummaryRead(
                unit_id=unit.id,
                assigned_members=int(summaries[unit.id]["assigned_members"]),
                people_with_leave=int(summaries[unit.id]["people_with_leave"]),
                leave_days=int(summaries[unit.id]["leave_days"]),
                leave_by_call_level=dict(summaries[unit.id]["leave_by_call_level"]),
            )
            for unit in units
        ],
        unit_call_minimums=unit_call_minimum_rows(units, assignments, month),
        validation_issues=[
            UnitValidationIssueRead(**issue) for issue in validate_unit_month(assignments, month)
        ],
    )


@router.put("/unit-management/units/{unit_id}/settings")
def update_unit_settings(
    unit_id: UUID,
    payload: UnitSettingsPayload,
    month: str | None = None,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitRead:
    if payload.minimum_free_people < 0:
        raise HTTPException(status_code=400, detail="Minimum free people cannot be negative")
    unit = get_unit_or_404(db, unit_id)
    if month:
        try:
            month_bounds(month)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        counts = unit_call_member_counts(monthly_unit_assignments(db, month), month)
        seen: set[str] = set()
        existing = {item.call_level: item for item in unit.call_minimums}
        for item in payload.call_minimums:
            call_level = normalize_call_level(item.call_level)
            if call_level in seen:
                raise HTTPException(status_code=400, detail=f"Duplicate call level rule: {call_level}")
            seen.add(call_level)
            if item.minimum_free_people < 0:
                raise HTTPException(status_code=400, detail="Call-wise minimum free people cannot be negative")
            assigned = counts.get((unit.id, call_level), 0)
            if item.minimum_free_people > assigned:
                raise HTTPException(
                    status_code=400,
                    detail=f"{call_level} minimum free people cannot exceed assigned members in this unit ({assigned})",
                )
            row = existing.get(call_level)
            if row is None:
                row = UnitCallMinimum(unit=unit, call_level=call_level)
                db.add(row)
            row.minimum_free_people = item.minimum_free_people
        for call_level, row in list(existing.items()):
            if call_level not in seen:
                db.delete(row)
    unit.minimum_free_people = payload.minimum_free_people
    db.commit()
    db.refresh(unit)
    return unit_to_read(unit)


@router.post("/unit-management/import-preview")
async def preview_unit_assignment_upload(
    month: str,
    replace_existing: bool = False,
    file: UploadFile = File(...),
    resolutions_json: str | None = Form(None),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitAssignmentImportPreviewRead:
    try:
        month_bounds(month)
        content = await file.read()
        result = preview_unit_assignment_import(
            db,
            file.filename or "unitwise-import",
            content,
            month,
            replace_existing=replace_existing,
            resolutions=parse_import_resolutions(resolutions_json),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UnitAssignmentImportPreviewRead(**result)


@router.post("/unit-management/import-apply")
async def apply_unit_assignment_upload(
    month: str,
    replace_existing: bool = False,
    file: UploadFile = File(...),
    resolutions_json: str | None = Form(None),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitAssignmentImportApplyRead:
    try:
        month_bounds(month)
        content = await file.read()
        result = apply_unit_assignment_import(
            db,
            file.filename or "unitwise-import",
            content,
            month,
            replace_existing=replace_existing,
            resolutions=parse_import_resolutions(resolutions_json),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UnitAssignmentImportApplyRead(**result)


@router.post("/unit-management/assignments")
def create_unit_assignment(
    payload: UnitAssignmentPayload,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitAssignmentRead:
    validate_payload_dates(payload)
    person = get_person_or_404(db, payload.person_id)
    unit = unit_for_assignment_payload(db, payload)
    assignment = PersonPosting(
        person=person,
        unit=unit,
        unit_id=unit.id if unit else None,
        posting_type=normalize_posting_type(payload.posting_type),
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        source=UNIT_BOARD_SOURCE,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create unit assignment") from exc
    db.refresh(assignment)
    return assignment_to_read(get_assignment_or_404(db, assignment.id))


@router.put("/unit-management/assignments/{assignment_id}")
def update_unit_assignment(
    assignment_id: UUID,
    payload: UnitAssignmentPayload,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitAssignmentRead:
    validate_payload_dates(payload)
    assignment = get_assignment_or_404(db, assignment_id)
    assignment.person = get_person_or_404(db, payload.person_id)
    assignment.unit = unit_for_assignment_payload(db, payload)
    assignment.unit_id = assignment.unit.id if assignment.unit else None
    assignment.posting_type = normalize_posting_type(payload.posting_type)
    assignment.starts_on = payload.starts_on
    assignment.ends_on = payload.ends_on
    assignment.notes = payload.notes.strip() if payload.notes else None
    db.commit()
    return assignment_to_read(get_assignment_or_404(db, assignment.id))


@router.delete("/unit-management/assignments/{assignment_id}")
def delete_unit_assignment(
    assignment_id: UUID,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    assignment = get_assignment_or_404(db, assignment_id)
    db.delete(assignment)
    db.commit()
    return {"status": "deleted"}
