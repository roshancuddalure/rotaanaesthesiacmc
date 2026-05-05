from fastapi import APIRouter

from app.domain.call_levels import CALL_LEVELS
from app.domain.duty_types import DUTY_TYPES

router = APIRouter()


@router.get("/metadata")
def get_metadata() -> dict[str, object]:
    return {
        "call_levels": [level.model_dump() for level in CALL_LEVELS],
        "duty_types": [duty_type.model_dump() for duty_type in DUTY_TYPES],
    }

