"""Extra-duty layer API (docs/extra_duty_contract.md §4). Admin only.

Preview -> apply (token + plan_hash, optional ``mode``: "standard" | "all_units", see
docs/extra_duty_fill_all_contract.md) -> undo per batch, the month's verification, the
justice ledger, per-unit fallback order and the 360° audit report download.
The planner/report services are imported inside the handlers so this router loads even
while they are unavailable. Errors are ``{detail: {code, message, ...}}``.
"""

from __future__ import annotations

import logging
import re
from io import BytesIO
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.core.config import settings
from app.db.session import get_db
from app.models import DutySlot, ExtraDutyBatch, RotaPeriod, Unit, UnitFallback, UserAccount
from app.services.leave import month_bounds
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES

logger = logging.getLogger(__name__)

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
MAX_FALLBACKS = 20
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def require_enabled(user: UserAccount = Depends(require_admin)) -> UserAccount:
    """Admin first (403), then the feature flag (503 ``disabled``)."""
    if not settings.extra_duty_layer_enabled:
        raise HTTPException(503, {"code": "disabled", "message": "The extra-duty layer is turned off by the administrator."})
    return user


router = APIRouter(prefix="/extra-duty", dependencies=[Depends(require_admin), Depends(require_enabled)])


FillMode = Literal["standard", "all_units"]


class MonthRequest(BaseModel):
    month: str
    # docs/extra_duty_fill_all_contract.md §2: "standard" (default) or "all_units" (fill-all).
    mode: FillMode = "standard"


class ApplyRequest(BaseModel):
    month: str
    token: str
    plan_hash: str
    mode: FillMode = "standard"


class UndoRequest(BaseModel):
    dry_run: bool = False


class FallbacksWrite(BaseModel):
    fallback_unit_ids: list[UUID]


def _error(code: str, message: str, status_code: int, **extra) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message, **extra})


def _check_month(month: str) -> str:
    if not re.match(MONTH_PATTERN, month or ""):
        raise _error("invalid_month", "Month must be YYYY-MM.", 422)
    return month


def _service():
    from app.services import extra_duty

    return extra_duty


def _call(fn, *args, **kwargs):
    """Run a service function, mapping ``ExtraDutyError`` to the contract's error shape."""
    service = _service()
    try:
        return fn(*args, **kwargs)
    except service.ExtraDutyError as exc:
        extra = dict(getattr(exc, "extra", None) or {})
        raise _error(getattr(exc, "code", "error"), getattr(exc, "message", str(exc)),
                     int(getattr(exc, "status_code", 400)), **extra) from exc


# -- planner ---------------------------------------------------------------------------------------

def _open_slot_count(db: Session, month: str) -> int:
    starts_on, ends_on = month_bounds(month)
    period = db.scalar(select(RotaPeriod).where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on))
    if period is None:
        return 0
    from app.services.rota_template import template_slots_for_period

    return sum(
        1
        for slot in template_slots_for_period(db, period.id)
        if slot.template_status != "excluded"
        and not any(a.status in ACTIVE_ASSIGNMENT_STATUSES for a in slot.assignments)
    )


def _batch_row(batch: ExtraDutyBatch) -> dict:
    return {
        "id": str(batch.id),
        "status": batch.status,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "created_by_name": batch.created_by_name,
        "undone_at": batch.undone_at.isoformat() if batch.undone_at else None,
        "undone_by_name": batch.undone_by_name,
        "summary": batch.summary or {},
    }


@router.get("/status")
def extra_duty_status(month: str = Query(...), db: Session = Depends(get_db)) -> dict:
    _check_month(month)
    batches = db.scalars(
        select(ExtraDutyBatch).where(ExtraDutyBatch.month == month).order_by(ExtraDutyBatch.created_at.desc())
    )
    return {
        "enabled": True,
        "month": month,
        "open_slots": _open_slot_count(db, month),
        "batches": [_batch_row(batch) for batch in batches],
    }


@router.post("/preview")
def extra_duty_preview(payload: MonthRequest, db: Session = Depends(get_db),
                       user: UserAccount = Depends(require_admin)) -> dict:
    month = _check_month(payload.month)
    return _call(_service().preview, db, month, user, mode=payload.mode)


@router.post("/apply")
def extra_duty_apply(payload: ApplyRequest, db: Session = Depends(get_db),
                     user: UserAccount = Depends(require_admin)) -> dict:
    month = _check_month(payload.month)
    return _call(_service().apply, db, month, payload.token, payload.plan_hash, user, mode=payload.mode)


@router.post("/batches/{batch_id}/undo")
def extra_duty_undo(batch_id: UUID, payload: UndoRequest | None = None, db: Session = Depends(get_db),
                    user: UserAccount = Depends(require_admin)) -> dict:
    dry_run = bool(payload and payload.dry_run)
    return _call(_service().undo, db, batch_id, user, dry_run=dry_run)


@router.get("/verify")
def extra_duty_verify(month: str = Query(...), db: Session = Depends(get_db)) -> dict:
    _check_month(month)
    return _call(_service().verify_month, db, month)


@router.get("/ledger")
def extra_duty_ledger(month: str | None = Query(None), person_id: UUID | None = Query(None),
                      db: Session = Depends(get_db)) -> list[dict]:
    if person_id is not None:
        return _call(_service().person_ledger, db, person_id)
    if month is not None:
        return _call(_service().month_ledger, db, _check_month(month))
    raise _error("invalid_query", "Give month or person_id.", 422)


# -- report ----------------------------------------------------------------------------------------

@router.get("/report")
def extra_duty_report(month: str = Query(...), format: Literal["html", "xlsx"] = Query("html"),
                      db: Session = Depends(get_db), user: UserAccount = Depends(require_admin)):
    _check_month(month)
    try:
        from app.services import rota_report_360 as report

        data = report.build_report_data(db, month, generated_by=user.display_name or user.username)
        if format == "html":
            content: bytes | str = report.render_html(data)
        else:
            content = report.render_xlsx(data)
    except HTTPException:
        raise
    except Exception as exc:
        service = None
        try:
            service = _service()
        except Exception:  # noqa: BLE001 - service module may be unavailable
            pass
        if service is not None and isinstance(exc, service.ExtraDutyError):
            raise _error(exc.code, exc.message, exc.status_code, **(exc.extra or {})) from exc
        logger.exception("Audit report (%s) failed for %s", format, month)
        raise _error("report_failed", f"The {format.upper()} audit report could not be produced.", 500) from exc
    filename = f"audit-report-{month}.{format}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if format == "html":
        return Response(content=content, media_type="text/html; charset=utf-8", headers=headers)
    return StreamingResponse(BytesIO(content), media_type=XLSX_MEDIA_TYPE, headers=headers)


# -- unit fallbacks --------------------------------------------------------------------------------

def _fallback_row(db: Session, unit: Unit, names: dict[UUID, str] | None = None) -> dict:
    rows = db.scalars(
        select(UnitFallback).where(UnitFallback.unit_id == unit.id)
        .order_by(UnitFallback.position, UnitFallback.id)
    ).all()
    if names is None:
        ids = [row.fallback_unit_id for row in rows]
        names = dict(db.execute(select(Unit.id, Unit.name).where(Unit.id.in_(ids))).all()) if ids else {}
    return {
        "unit_id": str(unit.id),
        "unit_name": unit.name,
        "fallbacks": [
            {"unit_id": str(row.fallback_unit_id), "unit_name": names.get(row.fallback_unit_id)}
            for row in rows
        ],
    }


@router.get("/unit-fallbacks")
def list_unit_fallbacks(db: Session = Depends(get_db)) -> list[dict]:
    units = db.scalars(select(Unit).order_by(Unit.name, Unit.code)).all()
    names = {unit.id: unit.name for unit in units}
    return [_fallback_row(db, unit, names) for unit in units]


@router.put("/unit-fallbacks/{unit_id}")
def put_unit_fallbacks(unit_id: UUID, payload: FallbacksWrite, db: Session = Depends(get_db)) -> dict:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise _error("unit_not_found", "Unit not found.", 404)
    ids = list(payload.fallback_unit_ids)
    if len(ids) > MAX_FALLBACKS:
        raise _error("invalid_fallbacks", f"At most {MAX_FALLBACKS} fallback units.", 422)
    if unit_id in ids:
        raise _error("invalid_fallbacks", "A unit cannot be its own fallback.", 422)
    if len(set(ids)) != len(ids):
        raise _error("invalid_fallbacks", "Each fallback unit can be listed only once.", 422)
    found = set(db.scalars(select(Unit.id).where(Unit.id.in_(ids)))) if ids else set()
    missing = [str(item) for item in ids if item not in found]
    if missing:
        raise _error("invalid_fallbacks", "Some fallback units do not exist.", 422, missing_unit_ids=missing)
    try:
        db.execute(delete(UnitFallback).where(UnitFallback.unit_id == unit_id))
        db.flush()
        for position, fallback_id in enumerate(ids):
            db.add(UnitFallback(unit_id=unit_id, fallback_unit_id=fallback_id, position=position))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _fallback_row(db, unit)
