from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_assignment import RotaAssignmentError
from app.services.rota_candidates import month_candidate_slots, slot_candidates

router = APIRouter()


class RotaSlotCandidatesRead(BaseModel):
    slot_id: str
    duty_date: str
    duty_type: str
    unit_id: str | None
    unit_name: str | None
    unit_code: str | None
    safety_status: str
    candidates: list[dict[str, object]]


class RotaCandidateMonthRead(BaseModel):
    month: str
    summary: dict[str, object]
    slots: list[RotaSlotCandidatesRead]


@router.get("/rota-candidates/slots/{slot_id}")
def get_rota_slot_candidates(
    slot_id: UUID,
    limit: int = Query(default=10, ge=1, le=50),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaSlotCandidatesRead:
    try:
        result = slot_candidates(db, slot_id, limit=limit)
    except RotaAssignmentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return RotaSlotCandidatesRead(**result)


@router.get("/rota-candidates/month")
def get_rota_candidate_month(
    month: str,
    limit_per_slot: int = Query(default=5, ge=1, le=20),
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaCandidateMonthRead:
    try:
        month_bounds(month)
        result = month_candidate_slots(db, month, limit_per_slot=limit_per_slot)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaCandidateMonthRead(**result)
