"""Admin-only Rota Rules API (docs/rota_rules_contract.md): read/check/update the rule set
(duty dictionary, monthly limits, rest rules, unit staffing thresholds), version history
with restore, and the eligibility-gaps diagnostic. Stored as one JSON ``RuleSetting`` row
plus ``RotaRuleVersion`` copies.
"""

import re
from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
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
    RotaRulesInvalid,
    UnitStaffingRules,
    get_phase_one_rules,
)
from app.services.rota_rules_admin import (
    StaleRules,
    check_rules,
    eligibility_gaps,
    get_version,
    group_summaries,
    list_versions,
    restore_version,
    rules_revision,
    save_rules_with_history,
    version_detail,
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


class RuleGroupRead(BaseModel):
    key: str
    name: str
    call_level: str
    active: bool
    members: int


class RotaPhaseOneRulesRead(BaseModel):
    rule_version: RuleVersionRead
    duty_rules: list[DutyRule]
    duty_count_limits: DutyCountLimits
    rest_rules: RestRules
    unit_staffing_rules: UnitStaffingRules
    notes: str | None
    revision: str
    groups: list[RuleGroupRead]


class RotaPhaseOneRulesWrite(RotaPhaseOneRules):
    base_revision: str | None = None

    def rules(self) -> RotaPhaseOneRules:
        return RotaPhaseOneRules.model_validate(self.model_dump(exclude={"base_revision"}))


class RestoreRequest(BaseModel):
    base_revision: str | None = None


def rules_to_read(db: Session, rule_version, rules: RotaPhaseOneRules) -> RotaPhaseOneRulesRead:
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
        revision=rules_revision(rules),
        groups=[RuleGroupRead(**row) for row in group_summaries(db)],
    )


def _stale(exc: StaleRules) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "stale_rules",
            "message": str(exc),
            "current_revision": exc.current_revision,
        },
    )


def _invalid(exc: RotaRulesInvalid) -> HTTPException:
    errors = sum(1 for p in exc.problems if p["severity"] == "error")
    return HTTPException(
        status_code=422,
        detail={
            "code": "invalid_rules",
            "message": f"{errors} problem(s) must be fixed before saving.",
            "problems": exc.problems,
        },
    )


@router.get("/admin/rota-rules/phase-one")
def get_phase_one_rota_rules(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RotaPhaseOneRulesRead:
    rule_version, rules = get_phase_one_rules(db)
    return rules_to_read(db, rule_version, rules)


@router.post("/admin/rota-rules/phase-one/check")
def check_phase_one_rota_rules(
    payload: RotaPhaseOneRulesWrite,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Problems and per-duty eligibility for an unsaved rule set. Never saves."""
    return check_rules(db, payload.rules())


@router.put("/admin/rota-rules/phase-one")
def update_phase_one_rota_rules(
    payload: RotaPhaseOneRulesWrite,
    admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RotaPhaseOneRulesRead:
    try:
        rule_version, rules = save_rules_with_history(
            db, payload.rules(), user=admin, base_revision=payload.base_revision
        )
    except StaleRules as exc:
        raise _stale(exc) from exc
    except RotaRulesInvalid as exc:
        db.rollback()
        raise _invalid(exc) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rules_to_read(db, rule_version, rules)


@router.get("/admin/rota-rules/phase-one/versions")
def list_phase_one_rule_versions(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return list_versions(db)


@router.get("/admin/rota-rules/phase-one/versions/{version_id}")
def get_phase_one_rule_version(
    version_id: UUID,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    version = get_version(db, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Rules version not found")
    return version_detail(version)


@router.post("/admin/rota-rules/phase-one/versions/{version_id}/restore")
def restore_phase_one_rule_version(
    version_id: UUID,
    payload: RestoreRequest,
    admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> RotaPhaseOneRulesRead:
    version = get_version(db, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Rules version not found")
    try:
        rule_version, rules = restore_version(
            db, version, user=admin, base_revision=payload.base_revision
        )
    except StaleRules as exc:
        raise _stale(exc) from exc
    except RotaRulesInvalid as exc:
        db.rollback()
        raise _invalid(exc) from exc
    return rules_to_read(db, rule_version, rules)


@router.get("/admin/rota-rules/eligibility-gaps")
def rota_rule_eligibility_gaps(
    month: str = Query(..., description="YYYY-MM"),
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    return eligibility_gaps(db, month)
