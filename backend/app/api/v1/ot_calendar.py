"""Administrator-only, feature-gated OT demand configuration and history."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.core.config import settings
from app.db.session import get_db
from app.models import UserAccount
from app.services import ot_calendar_store as service
from app.services.ot_capacity_preview import day_capacity
from app.services.ot_capacity import CapacityResourceLimit
from app.services import ot_calendar_transfer as transfer


def enabled():
    if not settings.ot_calendar_enabled:
        raise HTTPException(503, "OT calendar is disabled until migration and reviewed setup are complete")


router = APIRouter(prefix="/admin/ot-calendars", dependencies=[Depends(require_admin), Depends(enabled)])


@router.get("/{unit_id}")
def get_calendar(unit_id: UUID, db: Session = Depends(get_db)):
    return service.current(db, unit_id)


@router.put("/{unit_id}")
def save_calendar(unit_id: UUID, payload: service.SaveCalendar,
                  db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)):
    return service.save(db, unit_id, payload, operator)


@router.post("/{unit_id}/preview")
def preview_calendar(unit_id: UUID, payload: service.SaveCalendar, db: Session = Depends(get_db)):
    return service.preview(db, unit_id, payload)


@router.get("/{unit_id}/versions")
def get_versions(unit_id: UUID, db: Session = Depends(get_db)):
    return {"versions": service.versions(db, unit_id)}


@router.get("/{unit_id}/day")
def get_day(unit_id: UUID, day: date, db: Session = Depends(get_db)):
    return service.resolved(db, unit_id, day)


@router.get("/{unit_id}/assistant-reference")
def get_assistant_reference(unit_id: UUID, day: date, db: Session = Depends(get_db)):
    from app.services.assistant_ot_reference import ot_demand_reference

    return ot_demand_reference(db, unit_id, day)


@router.get("/{unit_id}/capacity")
def get_capacity(unit_id: UUID, day: date, include_pending: bool = False, db: Session = Depends(get_db)):
    try:
        return day_capacity(db, unit_id, day, include_pending=include_pending)
    except CapacityResourceLimit as exc:
        raise HTTPException(422, {"code": "ot_capacity_unresolved", "message": str(exc)}) from exc


@router.get("/{unit_id}/month-capacity")
def get_month_capacity(unit_id: UUID, month: str, include_pending: bool = False, db: Session = Depends(get_db)):
    from app.services.ot_month_capacity import month_capacity
    from app.services.rota_compute import lock_operational_inputs
    try:
        lock_operational_inputs(db)
        return month_capacity(db, unit_id, month, include_pending=include_pending)
    except (CapacityResourceLimit, ValueError) as exc:
        raise HTTPException(422, {"code": "ot_capacity_unresolved", "message": str(exc)}) from exc


@router.get("/{unit_id}/duty-capacity")
def get_duty_capacity(unit_id: UUID, day: date, include_pending: bool = False, db: Session = Depends(get_db)):
    from app.services.ot_duty_capacity import day_duty_capacity
    from app.services.rota_compute import lock_operational_inputs
    lock_operational_inputs(db)
    return day_duty_capacity(db, unit_id, day, include_pending=include_pending)


@router.get("/{unit_id}/transfer/export")
def export_monthly_calendar(unit_id: UUID, month: str, db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse
    from app.services.rota_compute import lock_operational_inputs
    lock_operational_inputs(db)
    try:
        exported = transfer.export_month(db, unit_id, month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return JSONResponse(exported, headers={"Content-Disposition": f'attachment; filename="ot-{unit_id}-{month}.json"'})


@router.post("/{unit_id}/transfer/preview")
def preview_monthly_import(unit_id: UUID, payload: transfer.TransferRequest,
                          db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)):
    from app.services.reference_registry import lock_namespace
    from app.services.rota_compute import lock_operational_inputs
    lock_namespace(db, "ot-month-import")
    lock_operational_inputs(db)
    return transfer.preview(db, unit_id, payload, operator)


@router.post("/{unit_id}/transfer/apply")
def apply_monthly_import(unit_id: UUID, payload: transfer.ApplyTransfer,
                        db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)):
    return transfer.apply(db, unit_id, payload, operator)
