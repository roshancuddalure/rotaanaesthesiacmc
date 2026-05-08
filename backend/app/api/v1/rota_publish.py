from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
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
    approval_note: str


class RotaPublishMonthRead(BaseModel):
    month: str
    rota_period: dict[str, object]
    rule_version: dict[str, object]
    summary: dict[str, object]
    can_publish: bool
    requires_warning_confirmation: bool
    checks: list[dict[str, str]]
    blockers: list[dict[str, str]]
    warnings: list[dict[str, str]]
    latest_publish: dict[str, object] | None


def publish_http_error(exc: RotaPublishError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/rota-publish/month")
def get_rota_publish_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaPublishMonthRead:
    try:
        month_bounds(month)
        result = rota_publish_checklist(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaPublishMonthRead(**result)


@router.post("/rota-publish/publish")
def publish_rota(
    month: str,
    payload: PublishPayload,
    user: UserAccount = Depends(current_user),
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
        )
    except RotaPublishError as exc:
        raise publish_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaPublishMonthRead(**result)


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
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
