"""Balance duties API (docs/call_level_pool_and_balance_contract.md section 2). Admin only.

Status -> preview -> apply (token + plan_hash) -> undo per batch. Errors are
``{detail: {code, message, ...}}`` with the same codes as the extra-duty layer plus
``nothing_to_balance``.
"""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import UserAccount

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

router = APIRouter(prefix="/balance-duties", dependencies=[Depends(require_admin)])


class MonthRequest(BaseModel):
    month: str


class ApplyRequest(BaseModel):
    month: str
    token: str
    plan_hash: str


class UndoRequest(BaseModel):
    dry_run: bool = False


def _error(code: str, message: str, status_code: int, **extra) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message, **extra})


def _check_month(month: str) -> str:
    if not re.match(MONTH_PATTERN, month or ""):
        raise _error("invalid_month", "Month must be YYYY-MM.", 422)
    return month


def _service():
    from app.services import balance_duties

    return balance_duties


def _call(fn, *args, **kwargs):
    from app.services.extra_duty import ExtraDutyError

    try:
        return fn(*args, **kwargs)
    except ExtraDutyError as exc:
        raise _error(exc.code, exc.message, int(exc.status_code), **dict(exc.extra or {})) from exc


def _require_enabled() -> None:
    if not _service().enabled():
        raise _error("disabled", "Balance duties is turned off by the administrator.", 503)


@router.get("/status")
def balance_status(month: str = Query(...), db: Session = Depends(get_db)) -> dict:
    return _call(_service().status, db, _check_month(month))


@router.post("/preview")
def balance_preview(payload: MonthRequest, db: Session = Depends(get_db),
                    user: UserAccount = Depends(require_admin)) -> dict:
    _require_enabled()
    return _call(_service().preview, db, _check_month(payload.month), user)


@router.post("/apply")
def balance_apply(payload: ApplyRequest, db: Session = Depends(get_db),
                  user: UserAccount = Depends(require_admin)) -> dict:
    _require_enabled()
    return _call(_service().apply, db, _check_month(payload.month), payload.token, payload.plan_hash, user)


@router.post("/batches/{batch_id}/undo")
def balance_undo(batch_id: UUID, payload: UndoRequest | None = None, db: Session = Depends(get_db),
                 user: UserAccount = Depends(require_admin)) -> dict:
    _require_enabled()
    return _call(_service().undo, db, batch_id, user, dry_run=bool(payload and payload.dry_run))
