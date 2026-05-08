from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session, selectinload

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import LeaveRequest, Person, UserAccount
from app.services.leave import leave_day_entries, leave_pressure, leave_requests_for_month, leave_summary, month_bounds
from app.services.leave_import import apply_leave_import, preview_leave_import

router = APIRouter()


class LeavePersonRead(BaseModel):
    id: UUID
    canonical_name: str
    active_status: str
    call_level: str | None


class LeaveRequestRead(BaseModel):
    id: UUID
    person: LeavePersonRead
    leave_type: str
    leave_slot: str
    starts_on: date
    ends_on: date
    status: str
    source: str
    raw_person_name: str | None
    notes: str | None
    days: int


class LeaveRequestCreate(BaseModel):
    person_id: UUID
    leave_type: str = "ANNUAL_LEAVE"
    leave_slot: str = "FULL_DAY"
    starts_on: date
    ends_on: date
    status: str = "approved"
    notes: str | None = None

    @field_validator("leave_type", "leave_slot", "status")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Value is required")
        return cleaned.upper() if value != "approved" else value


class LeaveRequestUpdate(BaseModel):
    person_id: UUID
    leave_type: str
    leave_slot: str
    starts_on: date
    ends_on: date
    status: str
    notes: str | None = None


class LeaveCalendarRead(BaseModel):
    month: str
    summary: dict[str, object]
    days: dict[str, list[dict[str, object]]]


class LeaveImportPreviewRead(BaseModel):
    filename: str
    month: str
    total_rows: int
    matched_rows: int
    unresolved_rows: int
    invalid_rows: int
    sheets: list[str] = []
    source_formats: list[str] = []
    parser_warnings: list[str] = []
    rows: list[dict[str, object]]


class LeaveImportApplyRead(BaseModel):
    filename: str
    month: str
    created_rows: int
    skipped_rows: int
    skipped_preview_rows: list[dict[str, object]]
    preview: dict[str, object]


def leave_to_read(leave: LeaveRequest) -> LeaveRequestRead:
    return LeaveRequestRead(
        id=leave.id,
        person=LeavePersonRead(
            id=leave.person.id,
            canonical_name=leave.person.canonical_name,
            active_status=leave.person.active_status,
            call_level=leave.person.call_level,
        ),
        leave_type=leave.leave_type,
        leave_slot=leave.leave_slot,
        starts_on=leave.starts_on,
        ends_on=leave.ends_on,
        status=leave.status,
        source=leave.source,
        raw_person_name=leave.raw_person_name,
        notes=leave.notes,
        days=(leave.ends_on - leave.starts_on).days + 1,
    )


def get_person_or_404(db: Session, person_id: UUID) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="Department member not found")
    return person


def get_leave_or_404(db: Session, leave_id: UUID) -> LeaveRequest:
    leave = db.get(LeaveRequest, leave_id, options=[selectinload(LeaveRequest.person)])
    if leave is None:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return leave


def validate_dates(starts_on: date, ends_on: date) -> None:
    if ends_on < starts_on:
        raise HTTPException(status_code=400, detail="Leave end date cannot be before start date")


@router.get("/leave/requests")
def list_leave_requests(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[LeaveRequestRead]:
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [leave_to_read(leave) for leave in leave_requests_for_month(db, month)]


@router.post("/leave/requests")
def create_leave_request(
    payload: LeaveRequestCreate,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveRequestRead:
    validate_dates(payload.starts_on, payload.ends_on)
    person = get_person_or_404(db, payload.person_id)
    leave = LeaveRequest(
        person=person,
        leave_type=payload.leave_type.strip().upper(),
        leave_slot=payload.leave_slot.strip().upper(),
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        status=payload.status.strip().lower(),
        source="manual",
        raw_person_name=person.canonical_name,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave_to_read(get_leave_or_404(db, leave.id))


@router.put("/leave/requests/{leave_id}")
def update_leave_request(
    leave_id: UUID,
    payload: LeaveRequestUpdate,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveRequestRead:
    validate_dates(payload.starts_on, payload.ends_on)
    leave = get_leave_or_404(db, leave_id)
    person = get_person_or_404(db, payload.person_id)
    leave.person = person
    leave.leave_type = payload.leave_type.strip().upper()
    leave.leave_slot = payload.leave_slot.strip().upper()
    leave.starts_on = payload.starts_on
    leave.ends_on = payload.ends_on
    leave.status = payload.status.strip().lower()
    leave.raw_person_name = person.canonical_name
    leave.notes = payload.notes.strip() if payload.notes else None
    db.commit()
    return leave_to_read(get_leave_or_404(db, leave.id))


@router.post("/leave/requests/{leave_id}/cancel")
def cancel_leave_request(
    leave_id: UUID,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveRequestRead:
    leave = get_leave_or_404(db, leave_id)
    leave.status = "cancelled"
    db.commit()
    return leave_to_read(get_leave_or_404(db, leave.id))


@router.get("/leave/calendar")
def get_leave_calendar(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveCalendarRead:
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    leaves = leave_requests_for_month(db, month)
    return LeaveCalendarRead(
        month=month,
        summary=leave_summary(db, month),
        days=leave_day_entries(db, leaves, month),
    )


@router.get("/leave/pressure")
def get_leave_pressure(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return leave_pressure(db, month)


@router.post("/leave/import-preview")
async def preview_leave_upload(
    month: str,
    file: UploadFile = File(...),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveImportPreviewRead:
    try:
        month_bounds(month)
        content = await file.read()
        result = preview_leave_import(db, file.filename or "leave-import", content, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LeaveImportPreviewRead(**result)


@router.post("/leave/import-apply")
async def apply_leave_upload(
    month: str,
    file: UploadFile = File(...),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveImportApplyRead:
    try:
        month_bounds(month)
        content = await file.read()
        result = apply_leave_import(db, file.filename or "leave-import", content, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LeaveImportApplyRead(**result)
