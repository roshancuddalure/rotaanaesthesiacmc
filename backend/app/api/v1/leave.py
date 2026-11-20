"""Leave requests: monthly listing, manual create/update/cancel, calendar and pressure views,
and spreadsheet import (preview first, then apply only the rows that matched cleanly).

Only ``approved`` leave hard-blocks duties; ``requested`` and ``imported_pending_review``
are shown as warnings (see ``app.services.leave``). Any signed-in user may edit leave.
"""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session, selectinload

from app.api.v1.auth import current_user, require_admin
from app.api.v1.rota_compute import limit_start as limit_repair_start
from app.db.session import get_db
from app.services.member_profiles import call_level_on
from app.services.reference_catalog import resolve_value
from app.services.reference_registry import audit, lock_namespace
from app.models import LeaveRequest, MemberActivity, Person, UserAccount
from app.services.leave import (
    leave_day_entries,
    leave_pressure,
    leave_requests_for_month,
    leave_summary,
    month_bounds,
)
from app.services.leave_import import apply_leave_import, preview_leave_import
from app.services.upload_limits import read_bounded_upload
from app.services.reviewed_import import acquire_import_lock, reviewed_hash, verify_reviewed_hash, StalePreviewError, replayed_result, record_workflow_batch

router = APIRouter()


class LeaveRepairScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", min_length=7, max_length=7)
    leave_ids: list[UUID] = Field(min_length=1, max_length=100)
    repair_slots: list[UUID] = Field(default_factory=list, max_length=5000)
    locked_slots: list[UUID] = Field(default_factory=list, max_length=5000)


class LeaveRepairProposal(LeaveRepairScope):
    review_token: str = Field(pattern=r"^[a-f0-9]{64}$", min_length=64, max_length=64)
    seconds: int = Field(default=30, ge=1, le=120, strict=True)


@router.post("/leave/repair-preview")
def preview_leave_repair(payload: LeaveRepairScope, user=Depends(require_admin), db=Depends(get_db)):
    from app.services.leave_repair import preview
    return preview(db, payload.month, user, payload.leave_ids,
                   repair_slots=payload.repair_slots, locked_slots=payload.locked_slots)


@router.post("/leave/repair-proposal", dependencies=[Depends(limit_repair_start)])
def propose_leave_repair(payload: LeaveRepairProposal, user=Depends(require_admin), db=Depends(get_db)):
    from app.services.leave_repair import start_proposal
    return start_proposal(db, payload.month, user, payload.leave_ids, payload.review_token,
                          repair_slots=payload.repair_slots, locked_slots=payload.locked_slots,
                          seconds=payload.seconds)


class LeaveApprovalScope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", min_length=7, max_length=7)


class LeaveApprovalApply(LeaveApprovalScope):
    review_token: str = Field(pattern=r"^[a-f0-9]{64}$", min_length=64, max_length=64)
    acknowledge_duties: bool = False
    reason: str | None = Field(default=None, max_length=2000)


class LeaveCancellation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str | None = Field(default=None, max_length=2000)


@router.post("/leave/approval-preview")
def preview_monthly_approval(payload: LeaveApprovalScope, user=Depends(require_admin), db=Depends(get_db)):
    from app.services.leave_approval import preview

    try:
        month_bounds(payload.month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return preview(db, payload.month, user)


@router.post("/leave/approve-month")
def approve_monthly_leave(payload: LeaveApprovalApply, user=Depends(require_admin), db=Depends(get_db)):
    from app.services.leave_approval import approve_month

    try:
        month_bounds(payload.month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return approve_month(db, payload.month, user, payload.review_token, payload.acknowledge_duties,
                         reason=payload.reason)


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
    acknowledge_duties: bool = False

    # Values are free text (no allowed-value list). Only status "approved" blocks duties, so a
    # typo such as "aproved" silently creates non-blocking leave (handbook B13). The endpoint
    # lower-cases status again after this validator upper-cases it.
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
    acknowledge_duties: bool = False
    change_reason: str | None = Field(default=None, max_length=2000)


class LeaveCalendarRead(BaseModel):
    month: str
    summary: dict[str, object]
    days: dict[str, list[dict[str, object]]]


class LeaveImportPreviewRead(BaseModel):
    preview_hash: str = ""
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
    affected_duties: list[dict[str, object]] = []
    ot_impact: dict[str, object] | None = None


class LeaveImportApplyRead(BaseModel):
    batch_id: UUID | None = None
    replayed: bool = False
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
            call_level=call_level_on(leave.person, leave.starts_on),
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


def get_active_person_or_404(db: Session, person_id: UUID) -> Person:
    person = get_person_or_404(db, person_id)
    if person.active_status != "active":
        raise HTTPException(status_code=400, detail="Leave can only be assigned to active members")
    return person


def get_leave_or_404(db: Session, leave_id: UUID) -> LeaveRequest:
    leave = db.get(LeaveRequest, leave_id, options=[selectinload(LeaveRequest.person)])
    if leave is None:
        raise HTTPException(status_code=404, detail="Leave request not found")
    return leave


def validate_dates(starts_on: date, ends_on: date) -> None:
    if ends_on < starts_on:
        raise HTTPException(status_code=400, detail="Leave end date cannot be before start date")


def validated_leave_values(db: Session, payload) -> dict:
    try:
        return {
            "leave_type": resolve_value(db, "leave_type", payload.leave_type)[0],
            "leave_slot": resolve_value(db, "leave_slot", payload.leave_slot)[0],
            "status": resolve_value(db, "leave_status", payload.status)[0],
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


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
    from app.services.operational_records import inspect_record
    lock_namespace(db,"operational-import")
    get_active_person_or_404(db,payload.person_id)
    review = inspect_record(db,"leave",payload.model_dump(mode="json"))
    if review["duties"] and not payload.acknowledge_duties:
        raise HTTPException(409, {"message":"Review affected duties before saving leave", "duties":review["duties"]})
    validate_dates(payload.starts_on, payload.ends_on)
    normalized = validated_leave_values(db, payload)
    person = get_active_person_or_404(db, payload.person_id)
    leave = LeaveRequest(
        person=person,
        leave_type=normalized["leave_type"],
        leave_slot=normalized["leave_slot"],
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        status=normalized["status"],
        source="manual",
        raw_person_name=person.canonical_name,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(leave)
    db.flush()
    details = {"before":None,"after":review["after"],"affected_duties":review["duties"]}
    audit(db,_user,"leave_created",leave.id,details)
    db.add(MemberActivity(person_id=person.id,operator_id=_user.id,operator_name=_user.display_name or _user.username,
                          action="leave_created",details=details))
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
    from app.services.operational_records import inspect_record
    lock_namespace(db,"operational-import")
    get_active_person_or_404(db,payload.person_id)
    review = inspect_record(db,"leave",payload.model_dump(mode="json"),leave_id)
    if review["duties"] and not payload.acknowledge_duties:
        raise HTTPException(409, {"message":"Review affected duties before saving leave", "duties":review["duties"]})
    validate_dates(payload.starts_on, payload.ends_on)
    normalized = validated_leave_values(db, payload)
    leave = get_leave_or_404(db, leave_id)
    person = get_active_person_or_404(db, payload.person_id)
    leave.person = person
    leave.leave_type = normalized["leave_type"]
    leave.leave_slot = normalized["leave_slot"]
    leave.starts_on = payload.starts_on
    leave.ends_on = payload.ends_on
    leave.status = normalized["status"]
    leave.raw_person_name = person.canonical_name
    leave.notes = payload.notes.strip() if payload.notes else None
    details = {"before":review["before"],"after":review["after"],"affected_duties":review["duties"],
               "reason": payload.change_reason.strip() or None if payload.change_reason else None}
    audit(db,_user,"leave_updated",leave.id,details)
    db.add(MemberActivity(person_id=person.id,operator_id=_user.id,operator_name=_user.display_name or _user.username,
                          action="leave_updated",details=details))
    db.commit()
    return leave_to_read(get_leave_or_404(db, leave.id))


@router.post("/leave/requests/{leave_id}/cancel")
def cancel_leave_request(
    leave_id: UUID,
    payload: LeaveCancellation | None = Body(default=None),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveRequestRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    leave = get_leave_or_404(db, leave_id)
    before = {
        "status": leave.status,
        "starts_on": str(leave.starts_on),
        "ends_on": str(leave.ends_on),
    }
    leave.status = "cancelled"
    details = {
        "before": before,
        "after": {"status": "cancelled"},
        "reason": payload.reason.strip() or None if payload and payload.reason else None,
        "availability": "This leave no longer blocks availability. Existing duty assignments remain unchanged.",
    }
    audit(db, _user, "leave_cancelled", leave.id, details)
    db.add(
        MemberActivity(
            person_id=leave.person_id,
            operator_id=_user.id,
            operator_name=_user.display_name or _user.username,
            action="leave_cancelled",
            details=details,
        )
    )
    db.commit()
    return leave_to_read(get_leave_or_404(db, leave.id))


@router.get("/leave/requests/{leave_id}/history")
def get_leave_history(
    leave_id: UUID,
    _user: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.leave_history import history

    # Reuse the existing write namespace for a coherent canonical/audit read.
    lock_namespace(db, "normalization-edit")
    result = history(db, leave_id)
    if result is None:
        raise HTTPException(404, "Leave record or retained history not found")
    return result


@router.get("/leave/requests/{leave_id}/history/page")
def get_leave_history_page(
    leave_id: UUID,
    category: Literal["audit", "imports", "recycle", "merges"],
    cursor: str | None = Query(default=None, max_length=2048),
    limit: int = Query(default=200, ge=1, le=200),
    _user: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    from app.services.leave_history import history

    lock_namespace(db, "normalization-edit")
    try:
        return history(db, leave_id, category=category, cursor=cursor, limit=limit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


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
        content = await read_bounded_upload(file)
        acquire_import_lock(db)
        from app.services.scheduling_inputs import lock_inputs
        from app.services.leave_import_ot_impact import legacy_review
        lock_inputs(db)
        result = preview_leave_import(db, file.filename or "leave-import", content, month)
        impacts, options = legacy_review(db, month, result)
        result.update(impacts)
        result["preview_hash"] = reviewed_hash(db, "leave", file.filename or "leave-import", content, month, options, result["rows"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LeaveImportPreviewRead(**result)


@router.post("/leave/import-apply")
async def apply_leave_upload(
    month: str,
    file: UploadFile = File(...),
    preview_hash: str = Form(""),
    acknowledge_duties: bool = Form(False),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> LeaveImportApplyRead:
    try:
        month_bounds(month)
        content = await read_bounded_upload(file)
        acquire_import_lock(db)
        existing = replayed_result(db, "leave_upload", preview_hash, str(_user.id), file.filename or "leave-import", content, {"month": month})
        if existing is not None:
            return LeaveImportApplyRead(**existing)
        from app.services.scheduling_inputs import lock_inputs
        from app.services.leave_import_ot_impact import legacy_review
        lock_inputs(db)
        preview = preview_leave_import(db, file.filename or "leave-import", content, month)
        impacts, options = legacy_review(db, month, preview)
        verify_reviewed_hash(preview_hash, reviewed_hash(db, "leave", file.filename or "leave-import", content, month, options, preview["rows"]))
        if impacts['affected_duties'] and not acknowledge_duties:
            raise HTTPException(422, 'Review and acknowledge affected duties before applying leave')
        result = apply_leave_import(db, file.filename or "leave-import", content, month, commit=False)
        result['preview'].update(impacts)
        result['preview']['preview_hash'] = preview_hash
        record_workflow_batch(db, "leave_upload", file.filename or "leave-import", content, month,
                              {"month": month}, str(_user.id), preview_hash, result)
        db.commit()
    except StalePreviewError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LeaveImportApplyRead(**result)
