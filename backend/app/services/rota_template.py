from __future__ import annotations

from collections import Counter
from io import BytesIO
from typing import Any
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID

import xlsxwriter
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    MonthlyGenerationScope,
    PersonPosting,
    RotaTemplateGenerationEvent,
    RotaTemplateGenerationRun,
    RotaAutoFillEvent,
    Unit,
)
from app.services.leave import ACTIVE_LEAVE_STATUSES, date_range, leave_requests_for_month, month_bounds
from app.services.rota_call_levels import inferred_call_levels_from_duty_type, normalize_call_level
from app.services.rota_rules import DutyRule, RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_setup import SCOPE_INCLUDED, monthly_setup

PHASE4_SLOT_SOURCE = "phase4_template"
READY = "ready"
NEEDS_REVIEW = "needs_review"
UNRESOLVED = "unresolved"
ACTION_CREATED = "created"
ACTION_SKIPPED = "skipped"
ACTION_BLOCKED = "blocked"


@dataclass
class TemplateGenerationOptions:
    duty_keys: list[str] | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    include_weekdays: bool = True
    include_weekends: bool = True
    replace_existing: bool = True


@dataclass
class UnitAllocation:
    unit: Unit
    pressure: dict[str, object]
    score: int
    hard_blocked: bool
    warning: bool
    reason: str


def month_dates(month: str, options: TemplateGenerationOptions) -> list[date]:
    month_start, month_end = month_bounds(month)
    starts_on = max(options.starts_on or month_start, month_start)
    ends_on = min(options.ends_on or month_end, month_end)
    if ends_on < starts_on:
        raise ValueError("Template end date cannot be before start date")
    if not options.include_weekdays and not options.include_weekends:
        raise ValueError("At least one of weekdays or weekends must be included")
    days = []
    for day in date_range(starts_on, ends_on):
        is_weekend = day.weekday() >= 5
        if is_weekend and not options.include_weekends:
            continue
        if not is_weekend and not options.include_weekdays:
            continue
        days.append(day)
    return days


def selected_duty_rules(rules: RotaPhaseOneRules, options: TemplateGenerationOptions) -> list[DutyRule]:
    active_rules = [rule for rule in rules.duty_rules if rule.active]
    if options.duty_keys is None:
        return [rule for rule in active_rules if rule.is_mandatory]
    requested = set(options.duty_keys)
    unknown = requested - {rule.key for rule in active_rules}
    if unknown:
        raise ValueError(f"Unknown or inactive duty rule(s): {', '.join(sorted(unknown))}")
    return [rule for rule in active_rules if rule.key in requested]


def included_scope_units(scope: MonthlyGenerationScope) -> list[Unit]:
    return [
        item.unit
        for item in sorted(scope.units, key=lambda scope_unit: scope_unit.unit.name)
        if item.status == SCOPE_INCLUDED
    ]


def token_matches_unit(token: str, unit: Unit) -> bool:
    cleaned = token.strip().lower()
    return cleaned in {
        str(unit.id).lower(),
        unit.code.lower(),
        unit.name.lower(),
    }


def rule_applies_to_unit(rule: DutyRule, unit: Unit) -> bool:
    if any(token_matches_unit(token, unit) for token in rule.excluded_units):
        return False
    if not rule.allowed_units:
        return True
    return any(token_matches_unit(token, unit) for token in rule.allowed_units)


def parse_rule_time(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid rule time value: {value}") from exc


def slot_bounds(day: date, rule: DutyRule) -> tuple[datetime, datetime]:
    starts_at = datetime.combine(day, parse_rule_time(rule.start_time))
    if rule.duration_hours > 0:
        return starts_at, starts_at + timedelta(hours=rule.duration_hours)
    if rule.is_24hr:
        return starts_at, starts_at + timedelta(hours=24)
    ends_at = datetime.combine(day, parse_rule_time(rule.end_time))
    if ends_at <= starts_at:
        ends_at += timedelta(days=1)
    if ends_at == starts_at:
        ends_at = starts_at + timedelta(hours=8)
    return starts_at, ends_at


def leave_blocks_rule(leave_slot: str, rule: DutyRule) -> bool:
    slot = leave_slot.upper()
    if rule.is_24hr:
        return slot in {"FULL_DAY", "AM", "PM", "NIGHT"}
    start_hour = parse_rule_time(rule.start_time).hour
    if slot == "FULL_DAY":
        return True
    if slot == "AM":
        return start_hour < 12
    if slot == "PM":
        return start_hour >= 12
    if slot == "NIGHT":
        return start_hour >= 18 or start_hour < 8
    return True


def postings_for_month(db: Session, starts_on: date, ends_on: date) -> list[PersonPosting]:
    statement = (
        select(PersonPosting)
        .where(
            PersonPosting.starts_on <= ends_on,
            (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
        )
        .options(selectinload(PersonPosting.person), selectinload(PersonPosting.unit))
    )
    return list(db.scalars(statement))


def active_unit_member_ids(
    postings: list[PersonPosting],
    unit_id: UUID,
    day: date,
    call_level: str | None = None,
) -> set[UUID]:
    return {
        posting.person_id
        for posting in postings
        if posting.unit_id == unit_id
        and posting.starts_on <= day
        and (posting.ends_on is None or posting.ends_on >= day)
        and posting.person.active_status == "active"
        and (call_level is None or normalize_call_level(posting.posting_type or posting.person.call_level) == call_level)
    }


def leave_by_day_and_person(db: Session, month: str) -> dict[date, dict[UUID, list[LeaveRequest]]]:
    leaves_by_day: dict[date, dict[UUID, list[LeaveRequest]]] = {}
    starts_on, ends_on = month_bounds(month)
    for leave in leave_requests_for_month(db, month):
        if leave.status.lower() not in ACTIVE_LEAVE_STATUSES:
            continue
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        for day in date_range(first, last):
            leaves_by_day.setdefault(day, {}).setdefault(leave.person_id, []).append(leave)
    return leaves_by_day


def pressure_for_slot(
    *,
    unit_member_ids: set[UUID],
    day_leaves: dict[UUID, list[LeaveRequest]],
    rule: DutyRule,
    rules: RotaPhaseOneRules,
    provisional_unit_day_duties: int = 0,
    provisional_post_24hr_duties: int = 0,
    minimum_free_people: int | None = None,
) -> dict[str, object]:
    unavailable = {
        person_id
        for person_id in unit_member_ids
        for leave in day_leaves.get(person_id, [])
        if leave_blocks_rule(leave.leave_slot, rule)
    }
    total = len(unit_member_ids)
    unavailable_count = len(unavailable)
    available_before_slot = (
        total - unavailable_count - provisional_unit_day_duties - provisional_post_24hr_duties
    )
    available_after_slot = available_before_slot - 1
    blocked_count = unavailable_count + provisional_unit_day_duties + provisional_post_24hr_duties + 1
    unavailable_percent = 100 if total == 0 else round((blocked_count / total) * 100)
    staffing = rules.unit_staffing_rules
    minimum = staffing.minimum_available_count if minimum_free_people is None else minimum_free_people
    status = READY
    severity = "info"
    reasons: list[str] = []

    if total == 0:
        status = "hard_block"
        severity = "error"
        reasons.append("Unit has no active assigned members for this date.")
    elif staffing.small_unit_uses_absolute_minimum and available_after_slot < minimum:
        status = "hard_block"
        severity = "error"
        reasons.append(
            f"Available members would fall to {available_after_slot}, below unit minimum {minimum}."
        )
    elif unavailable_percent >= staffing.hard_block_unavailable_percent:
        status = "hard_block"
        severity = "error"
        reasons.append(
            f"{unavailable_percent}% of the unit is unavailable, meeting hard block threshold {staffing.hard_block_unavailable_percent}%."
        )
    elif unavailable_percent >= staffing.warning_unavailable_percent:
        status = "warning"
        severity = "warning"
        reasons.append(
            f"{unavailable_percent}% of the unit is unavailable, meeting warning threshold {staffing.warning_unavailable_percent}%."
        )

    if not reasons:
        reasons.append("Unit leave pressure is within configured limits.")

    return {
        "status": status,
        "severity": severity,
        "reason": " ".join(reasons),
        "assigned_members": total,
        "unavailable_members": unavailable_count,
        "provisional_unit_day_duties": provisional_unit_day_duties,
        "provisional_post_24hr_duties": provisional_post_24hr_duties,
        "minimum_free_people": minimum,
        "available_members": max(0, available_after_slot),
        "available_before_slot": max(0, available_before_slot),
        "available_after_slot": available_after_slot,
        "unavailable_percent": unavailable_percent,
    }


def slot_label(unit: Unit) -> str:
    return f"{unit.code}:primary"


def remove_existing_template_slots(db: Session, rota_period_id: UUID) -> int:
    existing = list(
        db.scalars(
            select(DutySlot)
            .where(DutySlot.rota_period_id == rota_period_id, DutySlot.source == PHASE4_SLOT_SOURCE)
            .options(selectinload(DutySlot.assignments))
        )
    )
    assigned = [slot for slot in existing if slot.assignments]
    if assigned:
        raise ValueError("Existing generated template slots already have assignments and cannot be replaced")
    for slot in existing:
        db.delete(slot)
    return len(existing)


def latest_generation_run(db: Session, rota_period_id: UUID) -> RotaTemplateGenerationRun | None:
    return db.scalars(
        select(RotaTemplateGenerationRun)
        .where(RotaTemplateGenerationRun.rota_period_id == rota_period_id)
        .options(selectinload(RotaTemplateGenerationRun.events))
        .order_by(RotaTemplateGenerationRun.created_at.desc())
    ).first()


def create_event(
    *,
    run: RotaTemplateGenerationRun,
    unit: Unit,
    day: date,
    rule: DutyRule,
    action: str,
    severity: str,
    reason: str,
    details: dict[str, object],
) -> RotaTemplateGenerationEvent:
    return RotaTemplateGenerationEvent(
        generation_run=run,
        rota_period_id=run.rota_period_id,
        unit_id=unit.id,
        duty_date=day,
        duty_type=rule.key,
        action=action,
        severity=severity,
        reason=reason,
        details=details,
    )


def week_key(day: date) -> tuple[int, int]:
    iso = day.isocalendar()
    return iso.year, iso.week


def unit_minimum_free_people(unit: Unit, rules: RotaPhaseOneRules) -> int:
    value = getattr(unit, "minimum_free_people", None)
    if value is None:
        return rules.unit_staffing_rules.minimum_available_count
    return max(0, int(value))


def required_call_for_rule(rule: DutyRule) -> str | None:
    allowed = {normalize_call_level(item) for item in rule.allowed_call_levels}
    allowed.discard("Unassigned")
    if len(allowed) == 1:
        return next(iter(allowed))
    inferred = inferred_call_levels_from_duty_type(rule.key)
    return next(iter(inferred)) if len(inferred) == 1 else None


def unit_minimum_free_people_for_call(unit: Unit, call_level: str | None, rules: RotaPhaseOneRules) -> int:
    fallback = unit_minimum_free_people(unit, rules)
    if call_level is None:
        return fallback
    for row in getattr(unit, "call_minimums", []):
        if normalize_call_level(row.call_level) == call_level:
            return max(0, int(row.minimum_free_people))
    return fallback


def post_24hr_rest_count(
    counts: dict[tuple[UUID, date, str | None], int],
    unit_id: UUID,
    day: date,
    call_level: str | None,
) -> int:
    if call_level is not None:
        return counts.get((unit_id, day, call_level), 0)
    return sum(
        count
        for (count_unit_id, count_day, _count_call), count in counts.items()
        if count_unit_id == unit_id and count_day == day
    )


def allocation_score(
    *,
    unit: Unit,
    day: date,
    rule: DutyRule,
    pressure: dict[str, object],
    unit_month_counts: dict[UUID, int],
    unit_duty_counts: dict[tuple[UUID, str], int],
    unit_week_counts: dict[tuple[UUID, tuple[int, int]], int],
    unit_weekend_counts: dict[UUID, int],
    provisional_unit_day_counts: dict[tuple[UUID, date], int],
) -> int:
    available_after = int(pressure["available_after_slot"])
    minimum = int(pressure["minimum_free_people"])
    near_minimum_penalty = max(0, minimum + 1 - available_after) * 30
    return (
        unit_month_counts.get(unit.id, 0) * 100
        + unit_duty_counts.get((unit.id, rule.key), 0) * 60
        + unit_week_counts.get((unit.id, week_key(day)), 0) * 25
        + unit_weekend_counts.get(unit.id, 0) * (20 if day.weekday() >= 5 else 0)
        + provisional_unit_day_counts.get((unit.id, day), 0) * 80
        + int(pressure["unavailable_percent"])
        + near_minimum_penalty
    )


def choose_balanced_unit(
    *,
    units: list[Unit],
    day: date,
    rule: DutyRule,
    rules: RotaPhaseOneRules,
    postings: list[PersonPosting],
    day_leaves: dict[UUID, list[LeaveRequest]],
    existing_keys: set[tuple[date, str, str]],
    unit_month_counts: dict[UUID, int],
    unit_duty_counts: dict[tuple[UUID, str], int],
    unit_week_counts: dict[tuple[UUID, tuple[int, int]], int],
    unit_weekend_counts: dict[UUID, int],
    unit_weekend_day_counts: dict[tuple[UUID, int], int],
    provisional_unit_day_counts: dict[tuple[UUID, date], int],
    provisional_post_24hr_counts: dict[tuple[UUID, date, str | None], int],
) -> tuple[UnitAllocation | None, list[UnitAllocation]]:
    allocations: list[UnitAllocation] = []
    required_call = required_call_for_rule(rule)
    for unit in units:
        if not rule_applies_to_unit(rule, unit):
            continue
        label = slot_label(unit)
        if (day, rule.key, label) in existing_keys:
            continue
        pressure = pressure_for_slot(
            unit_member_ids=active_unit_member_ids(postings, unit.id, day, call_level=required_call),
            day_leaves=day_leaves,
            rule=rule,
            rules=rules,
            provisional_unit_day_duties=provisional_unit_day_counts.get((unit.id, day), 0),
            provisional_post_24hr_duties=post_24hr_rest_count(
                provisional_post_24hr_counts,
                unit.id,
                day,
                required_call,
            ),
            minimum_free_people=unit_minimum_free_people_for_call(unit, required_call, rules),
        )
        hard_blocked = pressure["status"] == "hard_block"
        warning = pressure["status"] == "warning"
        allocations.append(
            UnitAllocation(
                unit=unit,
                pressure=pressure,
                score=allocation_score(
                    unit=unit,
                    day=day,
                    rule=rule,
                    pressure=pressure,
                    unit_month_counts=unit_month_counts,
                    unit_duty_counts=unit_duty_counts,
                    unit_week_counts=unit_week_counts,
                    unit_weekend_counts=unit_weekend_counts,
                    provisional_unit_day_counts=provisional_unit_day_counts,
                ),
                hard_blocked=hard_blocked,
                warning=warning,
                reason=str(pressure["reason"]),
            )
        )
    if not allocations:
        return None, []
    safe_allocations = [allocation for allocation in allocations if not allocation.hard_blocked]
    pool = safe_allocations if safe_allocations else allocations
    is_weekend = day.weekday() >= 5
    selected = min(
        pool,
        key=lambda allocation: (
            unit_weekend_day_counts.get((allocation.unit.id, day.weekday()), 0) if is_weekend else 0,
            unit_weekend_counts.get(allocation.unit.id, 0) if is_weekend else 0,
            allocation.score,
            unit_duty_counts.get((allocation.unit.id, rule.key), 0),
            unit_month_counts.get(allocation.unit.id, 0),
            allocation.unit.name,
        ),
    )
    return selected, allocations


def generate_empty_template(
    db: Session,
    month: str,
    options: TemplateGenerationOptions | None = None,
) -> dict[str, object]:
    options = options or TemplateGenerationOptions()
    period, scope = monthly_setup(db, month)
    if not scope.is_locked:
        raise ValueError("Monthly unit scope must be locked before template generation")

    rule_version, rules = get_phase_one_rules(db)
    duties = selected_duty_rules(rules, options)
    units = included_scope_units(scope)
    days = month_dates(month, options)
    if not units:
        raise ValueError("Select at least one included unit before generating a template")
    if not duties:
        raise ValueError("Select at least one active duty rule before generating a template")
    if options.replace_existing:
        remove_existing_template_slots(db, period.id)
        db.flush()

    run = RotaTemplateGenerationRun(
        rota_period=period,
        rule_version=rule_version,
        status="completed",
        included_units=len(units),
        summary={
            "month": month,
            "duty_keys": [rule.key for rule in duties],
            "starts_on": days[0].isoformat() if days else None,
            "ends_on": days[-1].isoformat() if days else None,
            "include_weekdays": options.include_weekdays,
            "include_weekends": options.include_weekends,
            "replace_existing": options.replace_existing,
        },
    )
    db.add(run)
    db.flush()

    starts_on, ends_on = month_bounds(month)
    postings = postings_for_month(db, starts_on, ends_on)
    leaves = leave_by_day_and_person(db, month)
    existing_slots = list(
        db.scalars(
            select(DutySlot).where(
                DutySlot.rota_period_id == period.id,
                DutySlot.source == PHASE4_SLOT_SOURCE,
            )
        )
    )
    existing_keys = {(slot.duty_date, slot.duty_type, slot.slot_label) for slot in existing_slots}
    unit_month_counts: dict[UUID, int] = {}
    unit_duty_counts: dict[tuple[UUID, str], int] = {}
    unit_week_counts: dict[tuple[UUID, tuple[int, int]], int] = {}
    unit_weekend_counts: dict[UUID, int] = {}
    unit_weekend_day_counts: dict[tuple[UUID, int], int] = {}
    provisional_unit_day_counts: dict[tuple[UUID, date], int] = {}
    provisional_post_24hr_counts: dict[tuple[UUID, date, str | None], int] = {}
    for slot in existing_slots:
        if slot.unit_id is None:
            continue
        unit_month_counts[slot.unit_id] = unit_month_counts.get(slot.unit_id, 0) + 1
        unit_duty_counts[(slot.unit_id, slot.duty_type)] = (
            unit_duty_counts.get((slot.unit_id, slot.duty_type), 0) + 1
        )
        unit_week_counts[(slot.unit_id, week_key(slot.duty_date))] = (
            unit_week_counts.get((slot.unit_id, week_key(slot.duty_date)), 0) + 1
        )
        if slot.duty_date.weekday() >= 5:
            unit_weekend_counts[slot.unit_id] = unit_weekend_counts.get(slot.unit_id, 0) + 1
            weekend_day_key = (slot.unit_id, slot.duty_date.weekday())
            unit_weekend_day_counts[weekend_day_key] = (
                unit_weekend_day_counts.get(weekend_day_key, 0) + 1
            )
        provisional_key = (slot.unit_id, slot.duty_date)
        provisional_unit_day_counts[provisional_key] = (
            provisional_unit_day_counts.get(provisional_key, 0) + 1
        )
        if slot.is_24hr:
            rest_key = (
                slot.unit_id,
                slot.duty_date + timedelta(days=1),
                normalize_call_level(slot.call_level) if slot.call_level else None,
            )
            provisional_post_24hr_counts[rest_key] = (
                provisional_post_24hr_counts.get(rest_key, 0) + 1
            )
    created_slots: list[DutySlot] = []
    events: list[RotaTemplateGenerationEvent] = []

    for day in days:
        day_leaves = leaves.get(day, {})
        for rule in duties:
            selected, allocations = choose_balanced_unit(
                units=units,
                day=day,
                rule=rule,
                rules=rules,
                postings=postings,
                day_leaves=day_leaves,
                existing_keys=existing_keys,
                unit_month_counts=unit_month_counts,
                unit_duty_counts=unit_duty_counts,
                unit_week_counts=unit_week_counts,
                unit_weekend_counts=unit_weekend_counts,
                unit_weekend_day_counts=unit_weekend_day_counts,
                provisional_unit_day_counts=provisional_unit_day_counts,
                provisional_post_24hr_counts=provisional_post_24hr_counts,
            )
            if selected is None:
                for unit in units:
                    reason = "Duty rule is not enabled for this unit."
                    if rule_applies_to_unit(rule, unit):
                        reason = "A matching duty slot already exists."
                    events.append(
                        create_event(
                            run=run,
                            unit=unit,
                            day=day,
                            rule=rule,
                            action=ACTION_SKIPPED,
                            severity="warning",
                            reason=reason,
                            details={"unit_code": unit.code, "duty_label": rule.label},
                        )
                    )
                continue
            hard_block = selected.hard_blocked
            warning = selected.warning
            if hard_block:
                if rule.is_adjustable and not rule.is_mandatory:
                    for allocation in allocations:
                        events.append(
                            create_event(
                                run=run,
                                unit=allocation.unit,
                                day=day,
                                rule=rule,
                                action=ACTION_BLOCKED,
                                severity="error" if allocation.hard_blocked else "warning",
                                reason=f"Adjustable slot skipped. {allocation.reason}",
                                details={
                                    **allocation.pressure,
                                    "allocation_score": allocation.score,
                                    "selected_unit": str(selected.unit.id),
                                },
                            )
                        )
                    continue

                unresolved_label = "unresolved"
                if (day, rule.key, unresolved_label) in existing_keys:
                    events.append(
                        create_event(
                            run=run,
                            unit=selected.unit,
                            day=day,
                            rule=rule,
                            action=ACTION_SKIPPED,
                            severity="warning",
                            reason="An unresolved slot already exists for this date and duty.",
                            details={"slot_label": unresolved_label, "duty_label": rule.label},
                        )
                    )
                    continue

                starts_at, ends_at = slot_bounds(day, rule)
                inferred_call_levels = sorted(inferred_call_levels_from_duty_type(rule.key))
                slot_call_level = (
                    rule.allowed_call_levels[0]
                    if len(rule.allowed_call_levels) == 1
                    else inferred_call_levels[0] if len(inferred_call_levels) == 1 else None
                )
                reason = (
                    "No safe unit allocation found. All candidate units are hard blocked "
                    "after leave, same-day duties, and previous-day 24-hour post-duty "
                    "availability were considered."
                )
                slot = DutySlot(
                    rota_period=period,
                    unit=None,
                    duty_date=day,
                    duty_type=rule.key,
                    call_level=slot_call_level,
                    slot_label=unresolved_label,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    is_24hr=rule.is_24hr,
                    max_assignees=1,
                    source=PHASE4_SLOT_SOURCE,
                    template_status=UNRESOLVED,
                    template_reason=reason,
                    generation_run=run,
                    notes=f"{rule.label} requires manual unit allocation. {reason}",
                )
                db.add(slot)
                created_slots.append(slot)
                existing_keys.add((day, rule.key, unresolved_label))
                for allocation in allocations:
                    events.append(
                        create_event(
                            run=run,
                            unit=allocation.unit,
                            day=day,
                            rule=rule,
                            action=ACTION_BLOCKED,
                            severity="error",
                            reason=f"Mandatory slot left unresolved. {allocation.reason}",
                            details={
                                **allocation.pressure,
                                "template_status": UNRESOLVED,
                                "allocation_score": allocation.score,
                            },
                        )
                    )
                continue

            unit = selected.unit
            label = slot_label(unit)
            starts_at, ends_at = slot_bounds(day, rule)
            status = NEEDS_REVIEW if hard_block or warning else READY
            reason = selected.reason
            inferred_call_levels = sorted(inferred_call_levels_from_duty_type(rule.key))
            slot_call_level = (
                rule.allowed_call_levels[0]
                if len(rule.allowed_call_levels) == 1
                else inferred_call_levels[0] if len(inferred_call_levels) == 1 else None
            )
            slot = DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=day,
                duty_type=rule.key,
                call_level=slot_call_level,
                slot_label=label,
                starts_at=starts_at,
                ends_at=ends_at,
                is_24hr=rule.is_24hr,
                max_assignees=1,
                source=PHASE4_SLOT_SOURCE,
                template_status=status,
                template_reason=reason,
                generation_run=run,
                notes=f"{rule.label} generated for {unit.name}. {reason}",
            )
            db.add(slot)
            created_slots.append(slot)
            existing_keys.add((day, rule.key, label))
            unit_month_counts[unit.id] = unit_month_counts.get(unit.id, 0) + 1
            unit_duty_counts[(unit.id, rule.key)] = (
                unit_duty_counts.get((unit.id, rule.key), 0) + 1
            )
            unit_week_counts[(unit.id, week_key(day))] = (
                unit_week_counts.get((unit.id, week_key(day)), 0) + 1
            )
            if day.weekday() >= 5:
                unit_weekend_counts[unit.id] = unit_weekend_counts.get(unit.id, 0) + 1
                weekend_day_key = (unit.id, day.weekday())
                unit_weekend_day_counts[weekend_day_key] = (
                    unit_weekend_day_counts.get(weekend_day_key, 0) + 1
                )
            provisional_key = (unit.id, day)
            provisional_unit_day_counts[provisional_key] = (
                provisional_unit_day_counts.get(provisional_key, 0) + 1
            )
            if slot.is_24hr:
                rest_key = (
                    unit.id,
                    day + timedelta(days=1),
                    normalize_call_level(slot.call_level) if slot.call_level else None,
                )
                provisional_post_24hr_counts[rest_key] = (
                    provisional_post_24hr_counts.get(rest_key, 0) + 1
                )
            events.append(
                create_event(
                    run=run,
                    unit=unit,
                    day=day,
                    rule=rule,
                    action=ACTION_CREATED,
                    severity=str(selected.pressure["severity"]),
                    reason=reason,
                    details={
                        **selected.pressure,
                        "template_status": status,
                        "allocation_mode": "balanced",
                        "allocation_score": selected.score,
                        "weekend_day_count_after": (
                            unit_weekend_day_counts.get((unit.id, day.weekday()), 0)
                            if day.weekday() >= 5
                            else None
                        ),
                        "weekend_total_count_after": (
                            unit_weekend_counts.get(unit.id, 0)
                            if day.weekday() >= 5
                            else None
                        ),
                        "unit_month_count_after": unit_month_counts[unit.id],
                        "unit_duty_count_after": unit_duty_counts[(unit.id, rule.key)],
                    },
                )
            )
            for allocation in allocations:
                if allocation.unit.id == unit.id:
                    continue
                events.append(
                    create_event(
                        run=run,
                        unit=allocation.unit,
                        day=day,
                        rule=rule,
                        action=ACTION_SKIPPED,
                        severity=(
                            "warning" if allocation.hard_blocked or allocation.warning else "info"
                        ),
                        reason=(
                            allocation.reason
                            if allocation.hard_blocked
                            else (
                                "Another unit had a lower balanced allocation score "
                                f"({selected.score} vs {allocation.score})."
                            )
                        ),
                        details={
                            **allocation.pressure,
                            "allocation_mode": "balanced",
                            "allocation_score": allocation.score,
                            "weekend_day_count": (
                                unit_weekend_day_counts.get(
                                    (allocation.unit.id, day.weekday()),
                                    0,
                                )
                                if day.weekday() >= 5
                                else None
                            ),
                            "weekend_total_count": (
                                unit_weekend_counts.get(allocation.unit.id, 0)
                                if day.weekday() >= 5
                                else None
                            ),
                            "selected_unit": str(unit.id),
                            "selected_unit_name": unit.name,
                        },
                    )
                )

    for event in events:
        db.add(event)
    run.created_slots = len(created_slots)
    run.needs_review_slots = sum(1 for slot in created_slots if slot.template_status == NEEDS_REVIEW)
    unresolved_slots = sum(1 for slot in created_slots if slot.template_status == UNRESOLVED)
    run.skipped_slots = sum(1 for event in events if event.action == ACTION_SKIPPED)
    run.blocked_slots = sum(1 for event in events if event.action == ACTION_BLOCKED)
    run.summary = {
        **run.summary,
        "created_slots": run.created_slots,
        "needs_review_slots": run.needs_review_slots,
        "unresolved_slots": unresolved_slots,
        "skipped_slots": run.skipped_slots,
        "blocked_slots": run.blocked_slots,
    }
    db.commit()
    db.refresh(run)
    return template_month(db, month, run.id)


def clear_template_cache(db: Session, month: str, *, clear_assignments: bool = False) -> dict[str, object]:
    period, _scope = monthly_setup(db, month)
    slots = list(
        db.scalars(
            select(DutySlot)
            .where(DutySlot.rota_period_id == period.id, DutySlot.source == PHASE4_SLOT_SOURCE)
            .options(selectinload(DutySlot.assignments))
        )
    )
    assigned_slots = [slot for slot in slots if slot.assignments]
    if assigned_slots and not clear_assignments:
        raise ValueError("Generated template slots already have assignments and cannot be cleared")

    assignment_count = sum(len(slot.assignments) for slot in slots)
    if clear_assignments and assignment_count:
        slot_ids = [slot.id for slot in slots]
        assignment_ids = [assignment.id for slot in slots for assignment in slot.assignments]
        db.execute(
            update(RotaAutoFillEvent)
            .where(RotaAutoFillEvent.assignment_id.in_(assignment_ids))
            .values(assignment_id=None)
        )
        db.execute(
            update(RotaAutoFillEvent)
            .where(RotaAutoFillEvent.duty_slot_id.in_(slot_ids))
            .values(duty_slot_id=None)
        )
        db.execute(delete(DutyAssignment).where(DutyAssignment.id.in_(assignment_ids)))
        db.flush()

    slot_count = len(slots)
    for slot in slots:
        db.delete(slot)
    db.flush()

    run_ids = list(
        db.scalars(
            select(RotaTemplateGenerationRun.id).where(RotaTemplateGenerationRun.rota_period_id == period.id)
        )
    )
    event_count = 0
    run_count = 0
    if run_ids:
        event_result = db.execute(
            delete(RotaTemplateGenerationEvent).where(
                RotaTemplateGenerationEvent.generation_run_id.in_(run_ids)
            )
        )
        run_result = db.execute(
            delete(RotaTemplateGenerationRun).where(RotaTemplateGenerationRun.id.in_(run_ids))
        )
        event_count = event_result.rowcount or 0
        run_count = run_result.rowcount or 0
    db.commit()
    return {
        "month": month,
        "cleared_slots": slot_count,
        "cleared_assignments": assignment_count if clear_assignments else 0,
        "cleared_runs": run_count,
        "cleared_events": event_count,
    }


def template_slots_for_period(db: Session, rota_period_id: UUID) -> list[DutySlot]:
    return list(
        db.scalars(
            select(DutySlot)
            .where(
                DutySlot.rota_period_id == rota_period_id,
                DutySlot.source == PHASE4_SLOT_SOURCE,
            )
            .options(
                selectinload(DutySlot.unit).selectinload(Unit.call_minimums),
                selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
            )
            .order_by(DutySlot.duty_date, DutySlot.duty_type, DutySlot.slot_label)
        )
    )


def template_month(db: Session, month: str, run_id: UUID | None = None) -> dict[str, object]:
    period, scope = monthly_setup(db, month)
    rule_version, rules = get_phase_one_rules(db)
    run = db.get(RotaTemplateGenerationRun, run_id, options=[selectinload(RotaTemplateGenerationRun.events)]) if run_id else latest_generation_run(db, period.id)
    slots = template_slots_for_period(db, period.id)
    included_units = included_scope_units(scope)
    status_counts: dict[str, int] = {}
    for slot in slots:
        status_counts[slot.template_status] = status_counts.get(slot.template_status, 0) + 1

    return {
        "month": month,
        "rota_period": {
            "id": str(period.id),
            "name": period.name,
            "starts_on": period.starts_on.isoformat(),
            "ends_on": period.ends_on.isoformat(),
            "status": period.status,
        },
        "scope": {
            "id": str(scope.id),
            "is_locked": scope.is_locked,
            "included_units": [
                {"id": str(unit.id), "code": unit.code, "name": unit.name, "campus": unit.campus}
                for unit in included_units
            ],
        },
        "rule_version": {
            "id": str(rule_version.id),
            "name": rule_version.name,
        },
        "duty_options": [
            {
                "key": rule.key,
                "label": rule.label,
                "group": rule.group,
                "is_mandatory": rule.is_mandatory,
                "is_adjustable": rule.is_adjustable,
                "active": rule.active,
            }
            for rule in rules.duty_rules
            if rule.active
        ],
        "summary": {
            "total_slots": len(slots),
            "ready_slots": status_counts.get(READY, 0),
            "needs_review_slots": status_counts.get(NEEDS_REVIEW, 0),
            "status_counts": status_counts,
        },
        "latest_run": run_to_dict(run) if run else None,
        "slots": [slot_to_dict(slot) for slot in slots],
    }


def slot_unit_key(slot: DutySlot) -> tuple[str, str, str | None, bool]:
    if slot.unit_id is None:
        return "unresolved", "Unresolved", None, True
    label = slot.unit.name if slot.unit else str(slot.unit_id)
    return str(slot.unit_id), label, slot.unit.campus if slot.unit else None, False


def allocation_statistics(db: Session, month: str) -> dict[str, object]:
    period, scope = monthly_setup(db, month)
    _rule_version, rules = get_phase_one_rules(db)
    run = latest_generation_run(db, period.id)
    slots = template_slots_for_period(db, period.id)
    included_units = included_scope_units(scope)
    rule_by_key = rules.duty_rules_by_key

    unit_rows: dict[str, dict[str, object]] = {
        str(unit.id): {
            "unit_id": str(unit.id),
            "unit_name": unit.name,
            "unit_code": unit.code,
            "campus": unit.campus,
            "is_unresolved": False,
            "total_slots": 0,
            "ready_slots": 0,
            "needs_review_slots": 0,
            "unresolved_slots": 0,
            "weekday_slots": 0,
            "saturday_slots": 0,
            "sunday_slots": 0,
            "weekend_slots": 0,
            "twenty_four_hour_slots": 0,
            "non_24hr_slots": 0,
        }
        for unit in included_units
    }
    unit_rows["unresolved"] = {
        "unit_id": None,
        "unit_name": "Unresolved",
        "unit_code": None,
        "campus": None,
        "is_unresolved": True,
        "total_slots": 0,
        "ready_slots": 0,
        "needs_review_slots": 0,
        "unresolved_slots": 0,
        "weekday_slots": 0,
        "saturday_slots": 0,
        "sunday_slots": 0,
        "weekend_slots": 0,
        "twenty_four_hour_slots": 0,
        "non_24hr_slots": 0,
    }

    duty_keys = sorted(
        {slot.duty_type for slot in slots},
        key=lambda key: (
            {rule.key: index for index, rule in enumerate(rules.duty_rules)}.get(key, 9999),
            key,
        ),
    )
    unit_duty_counts: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    call_level_counts: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    date_rows: dict[date, dict[str, object]] = {}

    for slot in slots:
        unit_key, unit_name, _campus, _is_unresolved = slot_unit_key(slot)
        if unit_key not in unit_rows:
            unit_rows[unit_key] = {
                "unit_id": str(slot.unit_id) if slot.unit_id else None,
                "unit_name": unit_name,
                "unit_code": slot.unit.code if slot.unit else None,
                "campus": slot.unit.campus if slot.unit else None,
                "is_unresolved": slot.unit_id is None,
                "total_slots": 0,
                "ready_slots": 0,
                "needs_review_slots": 0,
                "unresolved_slots": 0,
                "weekday_slots": 0,
                "saturday_slots": 0,
                "sunday_slots": 0,
                "weekend_slots": 0,
                "twenty_four_hour_slots": 0,
                "non_24hr_slots": 0,
            }
            unit_duty_counts[unit_key] = Counter()
            call_level_counts[unit_key] = Counter()

        row = unit_rows[unit_key]
        row["total_slots"] = int(row["total_slots"]) + 1
        if slot.template_status == READY:
            row["ready_slots"] = int(row["ready_slots"]) + 1
        elif slot.template_status == NEEDS_REVIEW:
            row["needs_review_slots"] = int(row["needs_review_slots"]) + 1
        elif slot.template_status == UNRESOLVED:
            row["unresolved_slots"] = int(row["unresolved_slots"]) + 1
        if slot.duty_date.weekday() == 5:
            row["saturday_slots"] = int(row["saturday_slots"]) + 1
            row["weekend_slots"] = int(row["weekend_slots"]) + 1
        elif slot.duty_date.weekday() == 6:
            row["sunday_slots"] = int(row["sunday_slots"]) + 1
            row["weekend_slots"] = int(row["weekend_slots"]) + 1
        else:
            row["weekday_slots"] = int(row["weekday_slots"]) + 1
        if slot.is_24hr:
            row["twenty_four_hour_slots"] = int(row["twenty_four_hour_slots"]) + 1
        else:
            row["non_24hr_slots"] = int(row["non_24hr_slots"]) + 1

        unit_duty_counts[unit_key][slot.duty_type] += 1
        call_level = slot.call_level or next(iter(call_levels_for_export_rule(rule_by_key.get(slot.duty_type), slot.duty_type)))
        call_level_counts[unit_key][call_level] += 1

        date_row = date_rows.setdefault(
            slot.duty_date,
            {
                "date": slot.duty_date.isoformat(),
                "day_name": slot.duty_date.strftime("%A"),
                "total_slots": 0,
                "ready_slots": 0,
                "needs_review_slots": 0,
                "unresolved_slots": 0,
                "unit_counts": {},
            },
        )
        date_row["total_slots"] = int(date_row["total_slots"]) + 1
        if slot.template_status == READY:
            date_row["ready_slots"] = int(date_row["ready_slots"]) + 1
        elif slot.template_status == NEEDS_REVIEW:
            date_row["needs_review_slots"] = int(date_row["needs_review_slots"]) + 1
        elif slot.template_status == UNRESOLVED:
            date_row["unresolved_slots"] = int(date_row["unresolved_slots"]) + 1
        unit_counts = date_row["unit_counts"]
        if isinstance(unit_counts, dict):
            unit_counts[unit_key] = int(unit_counts.get(unit_key, 0)) + 1

    event_rows = []
    if run:
        for event in sorted(run.events, key=lambda item: item.created_at):
            if event.action in {ACTION_BLOCKED, ACTION_SKIPPED} or str(event.details.get("template_status")) == UNRESOLVED:
                event_rows.append(event_to_dict(event))

    return {
        "month": month,
        "rota_period": {
            "id": str(period.id),
            "name": period.name,
            "starts_on": period.starts_on.isoformat(),
            "ends_on": period.ends_on.isoformat(),
            "status": period.status,
        },
        "summary": {
            "total_slots": len(slots),
            "ready_slots": sum(1 for slot in slots if slot.template_status == READY),
            "needs_review_slots": sum(1 for slot in slots if slot.template_status == NEEDS_REVIEW),
            "unresolved_slots": sum(1 for slot in slots if slot.template_status == UNRESOLVED),
            "included_units": len(included_units),
            "units_used": sum(1 for row in unit_rows.values() if int(row["total_slots"]) > 0 and not row["is_unresolved"]),
            "blocked_or_skipped_events": len(event_rows),
        },
        "duty_keys": [
            {"key": key, "label": rule_by_key[key].label if key in rule_by_key else key}
            for key in duty_keys
        ],
        "unit_tallies": sorted(
            unit_rows.values(),
            key=lambda row: (bool(row["is_unresolved"]), str(row["unit_name"])),
        ),
        "unit_duty_matrix": [
            {
                "unit_id": None if unit_key == "unresolved" else unit_key,
                "unit_name": str(unit_rows[unit_key]["unit_name"]),
                "is_unresolved": bool(unit_rows[unit_key]["is_unresolved"]),
                "counts": {key: unit_duty_counts.get(unit_key, Counter()).get(key, 0) for key in duty_keys},
                "total_slots": int(unit_rows[unit_key]["total_slots"]),
            }
            for unit_key in sorted(unit_rows, key=lambda key: (key == "unresolved", str(unit_rows[key]["unit_name"])))
        ],
        "date_distribution": [date_rows[key] for key in sorted(date_rows)],
        "call_level_distribution": [
            {
                "unit_id": None if unit_key == "unresolved" else unit_key,
                "unit_name": str(unit_rows[unit_key]["unit_name"]),
                "is_unresolved": bool(unit_rows[unit_key]["is_unresolved"]),
                "counts": dict(call_level_counts.get(unit_key, Counter())),
                "total_slots": int(unit_rows[unit_key]["total_slots"]),
            }
            for unit_key in sorted(unit_rows, key=lambda key: (key == "unresolved", str(unit_rows[key]["unit_name"])))
        ],
        "blocked_or_skipped_events": event_rows[:200],
    }


def slot_to_dict(slot: DutySlot) -> dict[str, object]:
    return {
        "id": str(slot.id),
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "call_level": slot.call_level,
        "slot_label": slot.slot_label,
        "starts_at": slot.starts_at.isoformat(),
        "ends_at": slot.ends_at.isoformat(),
        "is_24hr": slot.is_24hr,
        "max_assignees": slot.max_assignees,
        "source": slot.source,
        "template_status": slot.template_status,
        "template_reason": slot.template_reason,
        "assignments": [
            {
                "id": str(assignment.id),
                "person_id": str(assignment.person_id),
                "person_name": assignment.person.canonical_name,
                "call_level": assignment.person.call_level,
                "status": assignment.status,
                "source": assignment.source,
                "override_reason": assignment.override_reason,
                "created_at": assignment.created_at.isoformat(),
            }
            for assignment in sorted(slot.assignments, key=lambda item: item.created_at)
        ],
        "notes": slot.notes,
    }


def excel_safe_cell(value: Any) -> str | int | float | bool | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


ROMAN_UNIT_NUMBERS = {
    "I": "1",
    "II": "2",
    "III": "3",
    "IV": "4",
    "V": "5",
    "VI": "6",
    "VII": "7",
    "VIII": "8",
    "IX": "9",
    "X": "10",
}

EAGLE_EYE_GROUP_LABELS = {
    "main": "MAIN CALLS",
    "cb": "CB CALLS",
    "caesar": "CAESAR CALLS",
    "rc": "RC CALLS",
    "schell": "SCHELL",
    "floating": "FLOATING",
    "fifth_call": "5TH CALL",
    "cart": "CART",
    "pac": "PAC",
    "shift": "SHIFTS",
    "chad": "CHAD",
    "ruhsa": "RUHSA",
    "paeds": "PAEDS",
    "neuro": "NEURO",
}


def display_unit_for_eagle_eye(unit: Unit | None) -> str:
    if unit is None:
        return ""
    value = (unit.name or unit.code or "").replace("_", " ").strip()
    parts = value.split()
    if len(parts) >= 2 and parts[0].lower() == "unit":
        suffix = parts[1].upper()
        if suffix in ROMAN_UNIT_NUMBERS:
            return f"Unit {ROMAN_UNIT_NUMBERS[suffix]}"
    if value.upper().startswith("UNIT "):
        suffix = value.split(maxsplit=1)[1].upper()
        if suffix in ROMAN_UNIT_NUMBERS:
            return f"Unit {ROMAN_UNIT_NUMBERS[suffix]}"
    return value.replace("UNIT", "Unit")


def eagle_eye_group_label(rule: DutyRule | None, duty_key: str) -> str:
    if rule is None:
        return "OTHER DUTIES"
    return EAGLE_EYE_GROUP_LABELS.get(rule.group, rule.group.replace("_", " ").upper() or duty_key)


CALL_WISE_SHEET_LABELS = {
    "1ST_CALL": "1st Call",
    "2ND_CALL": "2nd Call",
    "3RD_CALL": "3rd Call",
    "4TH_CALL": "4th Call",
    "CO_4TH_CALL": "Co-4th Call",
    "5TH_CALL": "5th Call",
    "Unassigned": "Unassigned",
}


CALL_WISE_ORDER = ["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL", "Unassigned"]


def call_wise_sheet_name(call_level: str) -> str:
    return CALL_WISE_SHEET_LABELS.get(call_level, call_level.replace("_", " ").title())[:31]


def call_levels_for_export_rule(rule: DutyRule | None, duty_key: str) -> set[str]:
    if rule and rule.allowed_call_levels:
        values = {normalize_call_level(item) for item in rule.allowed_call_levels}
        values.discard("Unassigned")
        if values:
            return values
    inferred = inferred_call_levels_from_duty_type(duty_key)
    return inferred or {"Unassigned"}


def assigned_member_text(slot: DutySlot) -> str:
    assignments = [
        assignment
        for assignment in slot.assignments
        if assignment.status.lower() in {"assigned", "draft", "confirmed"}
    ]
    return ", ".join(sorted(assignment.person.canonical_name for assignment in assignments)) or "Open"


def write_call_wise_template_export(
    workbook: xlsxwriter.Workbook,
    slots: list[DutySlot],
    rules: RotaPhaseOneRules,
) -> None:
    rule_order = {rule.key: index for index, rule in enumerate(rules.duty_rules)}
    rule_by_key = {rule.key: rule for rule in rules.duty_rules}
    slots_by_call: dict[str, list[DutySlot]] = {}
    for slot in slots:
        rule = rule_by_key.get(slot.duty_type)
        for call_level in call_levels_for_export_rule(rule, slot.duty_type):
            slots_by_call.setdefault(call_level, []).append(slot)

    normal_header = workbook.add_format(
        {"bold": True, "bg_color": "#0F172A", "font_color": "#FFFFFF", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}
    )
    weekend_header = workbook.add_format(
        {"bold": True, "bg_color": "#FFE699", "font_color": "#111827", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}
    )
    duty_format = workbook.add_format({"bold": True, "bg_color": "#F8FAFC", "border": 1})
    normal_cell = workbook.add_format({"border": 1, "align": "center", "valign": "vcenter", "text_wrap": True})
    weekend_cell = workbook.add_format({"border": 1, "align": "center", "valign": "vcenter", "text_wrap": True, "bg_color": "#FFF2CC"})
    calls = sorted(
        slots_by_call,
        key=lambda call: (CALL_WISE_ORDER.index(call) if call in CALL_WISE_ORDER else 99, call),
    )
    if not calls:
        calls = ["Unassigned"]
        slots_by_call["Unassigned"] = []

    for call_level in calls:
        worksheet = workbook.add_worksheet(call_wise_sheet_name(call_level))
        call_slots = sorted(
            slots_by_call[call_level],
            key=lambda slot: (
                slot.duty_date,
                rule_order.get(slot.duty_type, 9999),
                rule_by_key.get(slot.duty_type).label if rule_by_key.get(slot.duty_type) else slot.duty_type,
                display_unit_for_eagle_eye(slot.unit),
                slot.slot_label,
            ),
        )
        dates = sorted({slot.duty_date for slot in call_slots})
        duty_keys = sorted(
            {slot.duty_type for slot in call_slots},
            key=lambda key: (rule_order.get(key, 9999), rule_by_key.get(key).label if rule_by_key.get(key) else key),
        )

        worksheet.write(0, 0, "Duty", normal_header)
        for col, day in enumerate(dates, start=1):
            worksheet.write(
                0,
                col,
                f"{day.isoformat()}\n{day.strftime('%A')}",
                weekend_header if day.weekday() >= 5 else normal_header,
            )

        units_by_duty_day: dict[tuple[str, date], list[str]] = {}
        for slot in call_slots:
            unit_name = display_unit_for_eagle_eye(slot.unit)
            if unit_name:
                units_by_duty_day.setdefault((slot.duty_type, slot.duty_date), []).append(unit_name)

        for row, duty_key in enumerate(duty_keys, start=1):
            rule = rule_by_key.get(duty_key)
            worksheet.write(row, 0, rule.label if rule else duty_key, duty_format)
            for col, day in enumerate(dates, start=1):
                units = sorted(set(units_by_duty_day.get((duty_key, day), [])))
                worksheet.write(row, col, ", ".join(units), weekend_cell if day.weekday() >= 5 else normal_cell)

        if not duty_keys:
            worksheet.write(1, 0, "No duties", duty_format)
        worksheet.set_column(0, 0, 24)
        for col, day in enumerate(dates, start=1):
            worksheet.set_column(col, col, 13, weekend_cell if day.weekday() >= 5 else normal_cell)
        worksheet.set_row(0, 34)
        worksheet.freeze_panes(1, 1)


def write_eagle_eye_matrix(
    workbook: xlsxwriter.Workbook,
    slots: list[DutySlot],
    rules: RotaPhaseOneRules,
) -> None:
    worksheet = workbook.add_worksheet("Eagle Eye")
    normal_header = workbook.add_format(
        {"bold": True, "bg_color": "#0F172A", "font_color": "#FFFFFF", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}
    )
    weekend_header = workbook.add_format(
        {"bold": True, "bg_color": "#FFE699", "font_color": "#111827", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}
    )
    duty_format = workbook.add_format({"bold": True, "bg_color": "#F8FAFC", "border": 1})
    normal_cell = workbook.add_format({"border": 1, "align": "center", "valign": "vcenter", "text_wrap": True})
    weekend_cell = workbook.add_format({"border": 1, "align": "center", "valign": "vcenter", "text_wrap": True, "bg_color": "#FFF2CC"})
    group_divider = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#D9EAF7",
            "font_color": "#0F172A",
            "border": 1,
            "align": "left",
            "valign": "vcenter",
        }
    )
    rule_order = {rule.key: index for index, rule in enumerate(rules.duty_rules)}
    rule_by_key = {rule.key: rule for rule in rules.duty_rules}
    dates = sorted({slot.duty_date for slot in slots})
    duty_keys = sorted(
        {slot.duty_type for slot in slots},
        key=lambda key: (rule_order.get(key, 9999), rule_by_key.get(key).label if rule_by_key.get(key) else key),
    )

    worksheet.write(0, 0, "Duty", normal_header)
    for col, day in enumerate(dates, start=1):
        worksheet.write(
            0,
            col,
            f"{day.isoformat()}\n{day.strftime('%A')}",
            weekend_header if day.weekday() >= 5 else normal_header,
        )

    units_by_duty_day: dict[tuple[str, date], list[str]] = {}
    for slot in slots:
        unit_name = display_unit_for_eagle_eye(slot.unit)
        if unit_name:
            units_by_duty_day.setdefault((slot.duty_type, slot.duty_date), []).append(unit_name)

    row = 1
    previous_group_label: str | None = None
    for duty_key in duty_keys:
        rule = rule_by_key.get(duty_key)
        group_label = eagle_eye_group_label(rule, duty_key)
        if group_label != previous_group_label:
            if dates:
                worksheet.merge_range(row, 0, row, len(dates), group_label, group_divider)
            else:
                worksheet.write(row, 0, group_label, group_divider)
            worksheet.set_row(row, 20)
            row += 1
            previous_group_label = group_label
        worksheet.write(row, 0, rule.label if rule else duty_key, duty_format)
        for col, day in enumerate(dates, start=1):
            units = sorted(set(units_by_duty_day.get((duty_key, day), [])))
            worksheet.write(row, col, ", ".join(units), weekend_cell if day.weekday() >= 5 else normal_cell)
        row += 1

    worksheet.set_column(0, 0, 24)
    for col, day in enumerate(dates, start=1):
        worksheet.set_column(col, col, 13, weekend_cell if day.weekday() >= 5 else normal_cell)
    worksheet.set_row(0, 34)
    worksheet.freeze_panes(1, 1)


def eagle_eye_export(db: Session, month: str) -> tuple[str, bytes]:
    period, _scope = monthly_setup(db, month)
    _rule_version, rules = get_phase_one_rules(db)
    slots = template_slots_for_period(db, period.id)
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    write_eagle_eye_matrix(workbook, slots, rules)
    workbook.close()
    return f"eagle-eye-rota-template-{month}.xlsx", output.getvalue()


def call_wise_template_export(db: Session, month: str) -> tuple[str, bytes]:
    period, _scope = monthly_setup(db, month)
    _rule_version, rules = get_phase_one_rules(db)
    slots = template_slots_for_period(db, period.id)
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    write_call_wise_template_export(workbook, slots, rules)
    workbook.close()
    return f"call-wise-rota-template-{month}.xlsx", output.getvalue()


def run_to_dict(run: RotaTemplateGenerationRun) -> dict[str, object]:
    return {
        "id": str(run.id),
        "status": run.status,
        "included_units": run.included_units,
        "created_slots": run.created_slots,
        "needs_review_slots": run.needs_review_slots,
        "skipped_slots": run.skipped_slots,
        "blocked_slots": run.blocked_slots,
        "summary": run.summary,
        "created_at": run.created_at.isoformat(),
        "events": [event_to_dict(event) for event in sorted(run.events, key=lambda item: item.created_at)],
    }


def event_to_dict(event: RotaTemplateGenerationEvent) -> dict[str, object]:
    return {
        "id": str(event.id),
        "unit_id": str(event.unit_id) if event.unit_id else None,
        "unit_name": event.unit.name if event.unit else None,
        "unit_code": event.unit.code if event.unit else None,
        "duty_date": event.duty_date.isoformat() if event.duty_date else None,
        "duty_type": event.duty_type,
        "action": event.action,
        "severity": event.severity,
        "reason": event.reason,
        "details": event.details,
        "created_at": event.created_at.isoformat(),
    }
