"""Static domain metadata (call levels and duty types) for the frontend. Unauthenticated, read-only."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.session import get_db
from app.models import ReferenceValue

from app.domain.call_levels import CALL_LEVELS
from app.domain.duty_types import DUTY_TYPES

router = APIRouter()


@router.get("/metadata")
def get_metadata(db: Session = Depends(get_db)) -> dict[str, object]:
    duties = {duty.key: duty.model_dump() for duty in DUTY_TYPES}
    for value in db.scalars(select(ReferenceValue).where(ReferenceValue.kind == "duty_type")):
        duties[value.key] = {
            "key": value.key,
            "label": value.label,
            "group": value.behavior["group"],
            "is_24hr": value.behavior["is_24hr"],
            "counts_in_main_24hr": value.behavior["counts_in_main_24hr"],
            "is_separate": not value.behavior["counts_in_main_24hr"],
        }
    return {
        "call_levels": [level.model_dump() for level in CALL_LEVELS],
        "duty_types": list(duties.values()),
    }
