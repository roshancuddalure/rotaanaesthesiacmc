from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import Person, PersonPosting, Unit, UserAccount
from app.services.leave import month_bounds
from app.services.unit_management import (
    UNIT_BOARD_SOURCE,
    active_units,
    monthly_unit_assignments,
    normalize_posting_type,
    unit_leave_summary,
    validate_unit_month,
)

router = APIRouter()


class UnitRead(BaseModel):
    id: UUID
    code: str
    name: str
    campus: str | None
    active_status: str
    notes: str | None


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
    validation_issues: list[UnitValidationIssueRead]


class UnitAssignmentPayload(BaseModel):
    person_id: UUID
    unit_id: UUID
    posting_type: str
    starts_on: date
    ends_on: date | None = None
    notes: str | None = None


def unit_to_read(unit: Unit) -> UnitRead:
    return UnitRead(
        id=unit.id,
        code=unit.code,
        name=unit.name,
        campus=unit.campus,
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
        validation_issues=[
            UnitValidationIssueRead(**issue) for issue in validate_unit_month(assignments, month)
        ],
    )


@router.post("/unit-management/assignments")
def create_unit_assignment(
    payload: UnitAssignmentPayload,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UnitAssignmentRead:
    validate_payload_dates(payload)
    person = get_person_or_404(db, payload.person_id)
    unit = get_unit_or_404(db, payload.unit_id)
    assignment = PersonPosting(
        person=person,
        unit=unit,
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
    assignment.unit = get_unit_or_404(db, payload.unit_id)
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
