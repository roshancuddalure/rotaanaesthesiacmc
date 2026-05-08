from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import UserAccount
from app.services.rota_rules import (
    DutyCountLimits,
    DutyRule,
    RestRules,
    RotaPhaseOneRules,
    UnitStaffingRules,
    get_phase_one_rules,
    save_phase_one_rules,
)

router = APIRouter()


class RuleVersionRead(BaseModel):
    id: UUID
    name: str
    description: str | None
    effective_from: date
    effective_to: date | None
    is_active: bool
    created_at: datetime


class RotaPhaseOneRulesRead(BaseModel):
    rule_version: RuleVersionRead
    duty_rules: list[DutyRule]
    duty_count_limits: DutyCountLimits
    rest_rules: RestRules
    unit_staffing_rules: UnitStaffingRules
    notes: str | None


def rules_to_read(rule_version, rules: RotaPhaseOneRules) -> RotaPhaseOneRulesRead:
    return RotaPhaseOneRulesRead(
        rule_version=RuleVersionRead(
            id=rule_version.id,
            name=rule_version.name,
            description=rule_version.description,
            effective_from=rule_version.effective_from,
            effective_to=rule_version.effective_to,
            is_active=rule_version.is_active,
            created_at=rule_version.created_at,
        ),
        duty_rules=rules.duty_rules,
        duty_count_limits=rules.duty_count_limits,
        rest_rules=rules.rest_rules,
        unit_staffing_rules=rules.unit_staffing_rules,
        notes=rules.notes,
    )


@router.get("/admin/rota-rules/phase-one")
def get_phase_one_rota_rules(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RotaPhaseOneRulesRead:
    rule_version, rules = get_phase_one_rules(db)
    return rules_to_read(rule_version, rules)


@router.put("/admin/rota-rules/phase-one")
def update_phase_one_rota_rules(
    payload: RotaPhaseOneRules,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RotaPhaseOneRulesRead:
    try:
        rule_version, rules = save_phase_one_rules(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rules_to_read(rule_version, rules)
