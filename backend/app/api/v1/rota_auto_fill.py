from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_auto_fill import AutoFillOptions, auto_fill_month, run_safe_auto_fill

router = APIRouter()


class AutoFillPayload(BaseModel):
    limit_slots: int | None = Field(default=None, ge=1, le=500)
    strict_call_level: bool = True


class AutoFillMonthRead(BaseModel):
    month: str
    latest_run: dict[str, object] | None


@router.get("/rota-auto-fill/month")
def get_rota_auto_fill_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> AutoFillMonthRead:
    try:
        month_bounds(month)
        result = auto_fill_month(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AutoFillMonthRead(**result)


@router.post("/rota-auto-fill/draft")
def run_rota_auto_fill_draft(
    month: str,
    payload: AutoFillPayload | None = None,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        month_bounds(month)
        result = run_safe_auto_fill(
            db,
            month,
            AutoFillOptions(
                limit_slots=payload.limit_slots if payload else None,
                strict_call_level=payload.strict_call_level if payload else True,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result
