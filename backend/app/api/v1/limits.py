"""Limits API (docs/limits_callevel_fairness_contract.md section 3).

Superadmin edits; computer admin and rota board members may read (``can_edit=false``); any
other role gets 403 and an anonymous caller 401. Service: ``app.services.limits``.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user, require_superadmin
from app.db.session import get_db
from app.models import UserAccount
from app.services.limits import (
    READ_ROLES,
    LimitsError,
    check_month,
    limits_history,
    limits_state,
    preview_limits,
    restore_limits,
    save_limits,
)

router = APIRouter()


class LimitsPreviewRequest(BaseModel):
    limits: Any = None
    month: str | None = None


class LimitsSaveRequest(BaseModel):
    limits: Any = None
    base_version_id: str | None = None
    note: str | None = None
    month: str | None = None


class LimitsRestoreRequest(BaseModel):
    version_id: str
    note: str | None = None
    base_version_id: str | None = None
    month: str | None = None


def require_limits_reader(user: UserAccount = Depends(current_user)) -> UserAccount:
    if user.role not in READ_ROLES:
        raise HTTPException(status_code=403, detail={
            "code": "limits_forbidden",
            "message": "Only a superadmin, computer admin or rota board member can view limits.",
        })
    return user


def _http(exc: LimitsError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.detail())


@router.get("/admin/limits")
def get_limits(
    month: str | None = Query(None, description="YYYY-MM; defaults to this month"),
    user: UserAccount = Depends(require_limits_reader),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return limits_state(db, month, user)
    except LimitsError as exc:
        raise _http(exc) from exc


@router.post("/admin/limits/preview")
def preview(
    payload: LimitsPreviewRequest,
    _user: UserAccount = Depends(require_superadmin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return preview_limits(db, payload.limits, payload.month)
    except LimitsError as exc:
        raise _http(exc) from exc


@router.put("/admin/limits")
def put_limits(
    payload: LimitsSaveRequest,
    user: UserAccount = Depends(require_superadmin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        check_month(payload.month)
        save_limits(db, payload.limits, payload.base_version_id, payload.note, user)
        return limits_state(db, payload.month, user)
    except LimitsError as exc:
        raise _http(exc) from exc


@router.get("/admin/limits/history")
def get_history(
    _user: UserAccount = Depends(require_limits_reader),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return limits_history(db)


@router.post("/admin/limits/restore")
def restore(
    payload: LimitsRestoreRequest,
    user: UserAccount = Depends(require_superadmin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        check_month(payload.month)
        restore_limits(db, payload.version_id, payload.note, user, payload.base_version_id)
        return limits_state(db, payload.month, user)
    except LimitsError as exc:
        raise _http(exc) from exc
