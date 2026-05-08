from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot, clear_assignment

router = APIRouter()


class ManualAssignmentPayload(BaseModel):
    person_id: UUID
    replace_existing: bool = False
    override_reason: str | None = None


class ManualAssignmentResultRead(BaseModel):
    status: str
    assignment: dict[str, object] | None = None
    validation: dict[str, object] | None = None
    slot_safety: dict[str, object] | None = None


def assignment_http_error(exc: RotaAssignmentError) -> HTTPException:
    detail: str | dict[str, object]
    if exc.validation is None:
        detail = exc.message
    else:
        detail = {"message": exc.message, "validation": exc.validation}
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.post("/rota-assignments/slots/{slot_id}/assign")
def assign_rota_slot(
    slot_id: UUID,
    payload: ManualAssignmentPayload,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> ManualAssignmentResultRead:
    try:
        result = assign_person_to_slot(
            db,
            slot_id=slot_id,
            person_id=payload.person_id,
            replace_existing=payload.replace_existing,
            override_reason=payload.override_reason,
        )
    except RotaAssignmentError as exc:
        raise assignment_http_error(exc) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not save the assignment") from exc
    return ManualAssignmentResultRead(**result)


@router.delete("/rota-assignments/assignments/{assignment_id}")
def clear_rota_assignment(
    assignment_id: UUID,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> ManualAssignmentResultRead:
    try:
        result = clear_assignment(db, assignment_id)
    except RotaAssignmentError as exc:
        raise assignment_http_error(exc) from exc
    return ManualAssignmentResultRead(**result)
