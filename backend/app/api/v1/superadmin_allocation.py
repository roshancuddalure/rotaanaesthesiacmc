"""Superadmin allocation API (docs/superadmin_override_contract.md §1). Superadmin only.

GET  /superadmin-allocation/options?slot_id=   -> every active member, available or blocked
POST /superadmin-allocation                    -> allocate a member to the slot (409 strict_blocked;
                                                  409 cross_level_confirmation_required unless
                                                  confirm_cross_level for a different call level)
POST /superadmin-allocation/{batch_id}/undo    -> undo it, restoring the replaced holders

Errors are ``{detail: {code, message, ...}}``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.auth import require_superadmin
from app.db.session import get_db
from app.models import UserAccount
from app.services import superadmin_allocation as service

router = APIRouter(prefix="/superadmin-allocation", dependencies=[Depends(require_superadmin)])


class AllocateRequest(BaseModel):
    slot_id: UUID
    person_id: UUID
    reason: str = Field(min_length=1, max_length=2000)
    replace_existing: bool = True
    # Required (true) when the person is on a different call level than the duty needs;
    # otherwise 409 cross_level_confirmation_required.
    confirm_cross_level: bool = False


class UndoRequest(BaseModel):
    dry_run: bool = False


def _http(exc: service.SuperadminAllocationError) -> HTTPException:
    return HTTPException(exc.status_code, {"code": exc.code, "message": exc.message, **exc.extra})


@router.get("/options")
def allocation_options(
    slot_id: UUID = Query(...),
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_superadmin),
) -> dict:
    try:
        return service.options(db, slot_id)
    except service.SuperadminAllocationError as exc:
        raise _http(exc) from exc


@router.post("")
def allocate(
    payload: AllocateRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_superadmin),
) -> dict:
    try:
        return service.allocate(
            db,
            slot_id=payload.slot_id,
            person_id=payload.person_id,
            reason=payload.reason,
            user=user,
            replace_existing=payload.replace_existing,
            confirm_cross_level=payload.confirm_cross_level,
        )
    except service.SuperadminAllocationError as exc:
        raise _http(exc) from exc


@router.post("/{batch_id}/undo")
def undo_allocation(
    batch_id: UUID,
    payload: UndoRequest | None = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_superadmin),
) -> dict:
    try:
        return service.undo(db, batch_id, user, dry_run=bool(payload and payload.dry_run))
    except service.SuperadminAllocationError as exc:
        raise _http(exc) from exc
