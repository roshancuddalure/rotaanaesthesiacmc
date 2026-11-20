"""Publish checklist, publish action (records a ``RotaPublishApproval``) and final Excel export.

Any signed-in user may publish (handbook S6). Publishing sets ``RotaPeriod.status`` to
``published`` but does not freeze the data (handbook B1); the export is rebuilt from
live tables each time it is downloaded.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user, require_publisher
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_publish import (
    RotaPublishError,
    final_rota_export,
    publish_rota_month,
    rota_publish_checklist,
)

router = APIRouter()


class PublishPayload(BaseModel):
    confirm_warnings: bool = False
    # Optional only with ``superadmin_override`` (the service requires it otherwise).
    approval_note: str = ""
    # docs/superadmin_override_contract.md section 2: superadmin only (403), reason 5-500 chars.
    superadmin_override: bool = False
    override_reason: str | None = None


class RotaPublishMonthRead(BaseModel):
    month: str
    rota_period: dict[str, object]
    rule_version: dict[str, object]
    summary: dict[str, object]
    can_publish: bool
    # True when blockers exist and the signed-in user is a superadmin (computed server-side).
    can_superadmin_override: bool = False
    requires_warning_confirmation: bool
    checks: list[dict[str, str]]
    blockers: list[dict[str, str]]
    warnings: list[dict[str, str]]
    over_limit_people: list[dict[str, object]] = []
    superadmin_allocations: list[dict[str, object]] = []
    call_level_spread: list[dict[str, object]] = []
    latest_publish: dict[str, object] | None


def publish_http_error(exc: RotaPublishError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/rota-publish/month")
def get_rota_publish_month(
    month: str,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaPublishMonthRead:
    try:
        month_bounds(month)
        result = rota_publish_checklist(db, month, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaPublishMonthRead(**result)


@router.post("/rota-publish/publish")
def publish_rota(
    month: str,
    payload: PublishPayload,
    user: UserAccount = Depends(require_publisher),
    db: Session = Depends(get_db),
) -> RotaPublishMonthRead:
    try:
        month_bounds(month)
        result = publish_rota_month(
            db,
            month=month,
            approved_by=user,
            confirm_warnings=payload.confirm_warnings,
            approval_note=payload.approval_note,
            superadmin_override=payload.superadmin_override,
            override_reason=payload.override_reason,
        )
    except RotaPublishError as exc:
        raise publish_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaPublishMonthRead(**result)


@router.get("/rota-publish/elective-members-export")
def export_elective_members(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    starts: str = Query(default="08:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$"),
    ends: str = Query(default="17:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$"),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    from app.services.elective_members_export import elective_members_export
    try:
        filename, payload = elective_members_export(db, month, starts, ends)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return StreamingResponse(iter([payload]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("/rota-publish/review-export")
def export_review_rota(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        month_bounds(month)
        filename, payload = final_rota_export(db, month, review_only=True)
    except RotaPublishError as exc:
        raise publish_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StreamingResponse(iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("/rota-publish/export")
def export_rota(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        month_bounds(month)
        filename, payload = final_rota_export(db, month)
    except RotaPublishError as exc:
        raise publish_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Excel export failed for month %s", month)
        raise HTTPException(status_code=500, detail="Unable to prepare the approved Excel workbook. Please retry the download.") from exc
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
