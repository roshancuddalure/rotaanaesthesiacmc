from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template, template_month

router = APIRouter()


class TemplateGeneratePayload(BaseModel):
    duty_keys: list[str] | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    include_weekdays: bool = True
    include_weekends: bool = True
    replace_existing: bool = True

    @model_validator(mode="after")
    def validate_dates(self) -> "TemplateGeneratePayload":
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("Template end date cannot be before start date")
        return self


class RotaTemplateMonthRead(BaseModel):
    month: str
    rota_period: dict[str, object]
    scope: dict[str, object]
    rule_version: dict[str, object]
    duty_options: list[dict[str, object]]
    summary: dict[str, object]
    latest_run: dict[str, object] | None
    slots: list[dict[str, object]]


@router.get("/rota-template/month")
def get_rota_template_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaTemplateMonthRead:
    try:
        month_bounds(month)
        result = template_month(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaTemplateMonthRead(**result)


@router.post("/rota-template/generate")
def generate_rota_template(
    month: str,
    payload: TemplateGeneratePayload,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaTemplateMonthRead:
    try:
        month_bounds(month)
        result = generate_empty_template(
            db,
            month,
            TemplateGenerationOptions(
                duty_keys=payload.duty_keys,
                starts_on=payload.starts_on,
                ends_on=payload.ends_on,
                include_weekdays=payload.include_weekdays,
                include_weekends=payload.include_weekends,
                replace_existing=payload.replace_existing,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaTemplateMonthRead(**result)
