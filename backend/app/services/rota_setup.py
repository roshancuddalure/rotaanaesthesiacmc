from __future__ import annotations

import calendar
from collections import Counter
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MonthlyGenerationScope, MonthlyGenerationScopeUnit, PersonPosting, RotaPeriod, Unit
from app.services.leave import month_bounds
from app.services.unit_management import monthly_unit_assignments, unit_leave_summary, validate_unit_month

SCOPE_INCLUDED = "included"
SCOPE_EXCLUDED = "excluded"
VALID_SCOPE_STATUSES = {SCOPE_INCLUDED, SCOPE_EXCLUDED}


def month_label(month: str) -> str:
    starts_on, _ = month_bounds(month)
    return f"{calendar.month_name[starts_on.month]} {starts_on.year}"


def get_or_create_rota_period(db: Session, month: str) -> RotaPeriod:
    starts_on, ends_on = month_bounds(month)
    name = month_label(month)
    period = db.scalar(select(RotaPeriod).where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on))
    if period is not None:
        return period
    period = RotaPeriod(name=name, starts_on=starts_on, ends_on=ends_on, status="draft")
    db.add(period)
    db.commit()
    db.refresh(period)
    return period


def get_scope(db: Session, rota_period: RotaPeriod) -> MonthlyGenerationScope:
    scope = db.scalar(
        select(MonthlyGenerationScope)
        .where(MonthlyGenerationScope.rota_period_id == rota_period.id)
        .options(selectinload(MonthlyGenerationScope.units).selectinload(MonthlyGenerationScopeUnit.unit))
    )
    if scope is not None:
        return scope
    scope = MonthlyGenerationScope(
        rota_period=rota_period,
        include_excluded_units_in_safety=True,
        is_locked=False,
    )
    db.add(scope)
    db.commit()
    db.refresh(scope)
    return scope


def monthly_setup(db: Session, month: str) -> tuple[RotaPeriod, MonthlyGenerationScope]:
    period = get_or_create_rota_period(db, month)
    return period, get_scope(db, period)


def previous_month(month: str) -> str:
    starts_on, _ = month_bounds(month)
    year = starts_on.year
    month_number = starts_on.month - 1
    if month_number == 0:
        month_number = 12
        year -= 1
    return f"{year:04d}-{month_number:02d}"


def update_scope_units(
    db: Session,
    scope: MonthlyGenerationScope,
    included_unit_ids: list[UUID],
    excluded_unit_ids: list[UUID],
    include_excluded_units_in_safety: bool,
    lock_scope: bool,
    lock_reason: str | None = None,
) -> MonthlyGenerationScope:
    if scope.is_locked and not lock_scope:
        if not lock_reason or not lock_reason.strip():
            raise ValueError("Unlocking the generation scope requires a reason")
    if set(included_unit_ids) & set(excluded_unit_ids):
        raise ValueError("A unit cannot be both included and excluded")

    all_ids = set(included_unit_ids) | set(excluded_unit_ids)
    known_ids = set(db.scalars(select(Unit.id).where(Unit.id.in_(all_ids)))) if all_ids else set()
    missing = all_ids - known_ids
    if missing:
        raise ValueError("One or more units were not found")

    scope.include_excluded_units_in_safety = include_excluded_units_in_safety
    scope.is_locked = lock_scope
    scope.lock_reason = lock_reason.strip() if lock_reason else scope.lock_reason
    scope.updated_at = datetime.utcnow()

    for existing in list(scope.units):
        db.delete(existing)
    for unit_id in included_unit_ids:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit_id=unit_id, status=SCOPE_INCLUDED))
    for unit_id in excluded_unit_ids:
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit_id=unit_id, status=SCOPE_EXCLUDED))
    db.commit()
    db.refresh(scope)
    return get_scope(db, scope.rota_period)


def clone_previous_scope(db: Session, month: str) -> MonthlyGenerationScope:
    period, scope = monthly_setup(db, month)
    previous_period, previous_scope = monthly_setup(db, previous_month(month))
    included = [item.unit_id for item in previous_scope.units if item.status == SCOPE_INCLUDED]
    excluded = [item.unit_id for item in previous_scope.units if item.status == SCOPE_EXCLUDED]
    return update_scope_units(
        db,
        scope,
        included,
        excluded,
        previous_scope.include_excluded_units_in_safety,
        False,
        f"Cloned from {previous_period.name}",
    )


def unit_readiness(db: Session, month: str, scope: MonthlyGenerationScope) -> list[dict[str, object]]:
    assignments = monthly_unit_assignments(db, month)
    issues = validate_unit_month(assignments, month)
    summaries = unit_leave_summary(db, month, assignments)
    scope_status_by_unit = {item.unit_id: item.status for item in scope.units}
    assignments_by_unit: dict[UUID, list[PersonPosting]] = {}
    for assignment in assignments:
        if assignment.unit_id is None:
            continue
        assignments_by_unit.setdefault(assignment.unit_id, []).append(assignment)

    units = list(db.scalars(select(Unit).where(Unit.active_status == "active").order_by(Unit.name, Unit.code)))
    results: list[dict[str, object]] = []
    for unit in units:
        unit_assignments = assignments_by_unit.get(unit.id, [])
        call_counts = Counter(assignment.posting_type for assignment in unit_assignments)
        unit_issues = [
            issue
            for issue in issues
            if issue.get("unit_id") == str(unit.id)
        ]
        summary = summaries[unit.id]
        status = scope_status_by_unit.get(unit.id, "unselected")
        readiness = "ready"
        warnings: list[str] = []
        if status == SCOPE_INCLUDED and not unit_assignments:
            readiness = "needs_review"
            warnings.append("Included unit has no board-assigned members.")
        if status == SCOPE_INCLUDED and not call_counts:
            readiness = "needs_review"
            warnings.append("Included unit has no call-level distribution.")
        if unit_issues:
            readiness = "needs_review"
            warnings.extend(str(issue["message"]) for issue in unit_issues)
        if int(summary["people_with_leave"]) > 0:
            warnings.append(f"{summary['people_with_leave']} member(s) have active leave this month.")

        results.append(
            {
                "unit_id": str(unit.id),
                "unit_name": unit.name,
                "unit_code": unit.code,
                "campus": unit.campus,
                "scope_status": status,
                "readiness": readiness,
                "assigned_members": len({assignment.person_id for assignment in unit_assignments}),
                "call_level_counts": dict(call_counts),
                "people_with_leave": int(summary["people_with_leave"]),
                "leave_days": int(summary["leave_days"]),
                "warnings": warnings,
            }
        )
    return results
