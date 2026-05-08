from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import MonthlyGenerationScope, RotaPeriod, UserAccount
from app.services.leave import month_bounds
from app.services.rota_setup import clone_previous_scope, monthly_setup, unit_readiness, update_scope_units

router = APIRouter()


class RotaPeriodRead(BaseModel):
    id: UUID
    name: str
    starts_on: date
    ends_on: date
    status: str


class ScopeUnitRead(BaseModel):
    unit_id: UUID
    status: str
    notes: str | None


class MonthlyScopeRead(BaseModel):
    id: UUID
    include_excluded_units_in_safety: bool
    is_locked: bool
    lock_reason: str | None
    units: list[ScopeUnitRead]


class UnitReadinessRead(BaseModel):
    unit_id: UUID
    unit_name: str
    unit_code: str
    campus: str | None
    scope_status: str
    readiness: str
    assigned_members: int
    call_level_counts: dict[str, int]
    people_with_leave: int
    leave_days: int
    warnings: list[str]


class RotaSetupRead(BaseModel):
    month: str
    rota_period: RotaPeriodRead
    scope: MonthlyScopeRead
    unit_readiness: list[UnitReadinessRead]


class ScopeUpdate(BaseModel):
    included_unit_ids: list[UUID]
    excluded_unit_ids: list[UUID] = []
    include_excluded_units_in_safety: bool = True
    is_locked: bool = False
    lock_reason: str | None = None


def period_to_read(period: RotaPeriod) -> RotaPeriodRead:
    return RotaPeriodRead(
        id=period.id,
        name=period.name,
        starts_on=period.starts_on,
        ends_on=period.ends_on,
        status=period.status,
    )


def scope_to_read(scope: MonthlyGenerationScope) -> MonthlyScopeRead:
    return MonthlyScopeRead(
        id=scope.id,
        include_excluded_units_in_safety=scope.include_excluded_units_in_safety,
        is_locked=scope.is_locked,
        lock_reason=scope.lock_reason,
        units=[
            ScopeUnitRead(unit_id=item.unit_id, status=item.status, notes=item.notes)
            for item in sorted(scope.units, key=lambda scope_unit: scope_unit.status)
        ],
    )


def setup_to_read(db: Session, month: str, period: RotaPeriod, scope: MonthlyGenerationScope) -> RotaSetupRead:
    return RotaSetupRead(
        month=month,
        rota_period=period_to_read(period),
        scope=scope_to_read(scope),
        unit_readiness=[
            UnitReadinessRead(**item) for item in unit_readiness(db, month, scope)
        ],
    )


@router.get("/rota-setup/month")
def get_rota_setup_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaSetupRead:
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    period, scope = monthly_setup(db, month)
    return setup_to_read(db, month, period, scope)


@router.put("/rota-setup/month/scope")
def update_rota_setup_scope(
    month: str,
    payload: ScopeUpdate,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaSetupRead:
    try:
        month_bounds(month)
        period, scope = monthly_setup(db, month)
        updated_scope = update_scope_units(
            db,
            scope,
            payload.included_unit_ids,
            payload.excluded_unit_ids,
            payload.include_excluded_units_in_safety,
            payload.is_locked,
            payload.lock_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return setup_to_read(db, month, period, updated_scope)


@router.post("/rota-setup/month/clone-previous")
def clone_previous_rota_setup_scope(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaSetupRead:
    try:
        month_bounds(month)
        period, _scope = monthly_setup(db, month)
        updated_scope = clone_previous_scope(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return setup_to_read(db, month, period, updated_scope)
