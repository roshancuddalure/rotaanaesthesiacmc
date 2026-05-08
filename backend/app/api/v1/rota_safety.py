from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_safety import month_safety

router = APIRouter()


class RotaSafetyMonthRead(BaseModel):
    month: str
    rota_period: dict[str, object]
    scope: dict[str, object]
    summary: dict[str, object]
    slots: list[dict[str, object]]
    unit_day_safety: list[dict[str, object]]


@router.get("/rota-safety/month")
def get_rota_safety_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaSafetyMonthRead:
    try:
        month_bounds(month)
        result = month_safety(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaSafetyMonthRead(**result)
