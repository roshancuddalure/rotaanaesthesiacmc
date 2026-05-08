from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    MonthlyGenerationScope,
    PersonPosting,
    RotaTemplateGenerationEvent,
    RotaTemplateGenerationRun,
    Unit,
)
from app.services.leave import ACTIVE_LEAVE_STATUSES, date_range, leave_requests_for_month, month_bounds
from app.services.rota_rules import DutyRule, RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_setup import SCOPE_INCLUDED, monthly_setup

PHASE4_SLOT_SOURCE = "phase4_template"
READY = "ready"
NEEDS_REVIEW = "needs_review"
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


def active_unit_member_ids(postings: list[PersonPosting], unit_id: UUID, day: date) -> set[UUID]:
    return {
        posting.person_id
        for posting in postings
        if posting.unit_id == unit_id
        and posting.starts_on <= day
        and (posting.ends_on is None or posting.ends_on >= day)
        and posting.person.active_status == "active"
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
) -> dict[str, object]:
    unavailable = {
        person_id
        for person_id in unit_member_ids
        for leave in day_leaves.get(person_id, [])
        if leave_blocks_rule(leave.leave_slot, rule)
    }
    total = len(unit_member_ids)
    unavailable_count = len(unavailable)
    available_count = total - unavailable_count
    unavailable_percent = 100 if total == 0 else round((unavailable_count / total) * 100)
    staffing = rules.unit_staffing_rules
    status = READY
    severity = "info"
    reasons: list[str] = []

    if total == 0:
        status = "hard_block"
        severity = "error"
        reasons.append("Unit has no active assigned members for this date.")
    elif staffing.small_unit_uses_absolute_minimum and available_count < staffing.minimum_available_count:
        status = "hard_block"
        severity = "error"
        reasons.append(
            f"Available members would fall to {available_count}, below minimum {staffing.minimum_available_count}."
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
        "available_members": available_count,
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
    existing_keys = {
        (slot.duty_date, slot.duty_type, slot.slot_label)
        for slot in db.scalars(select(DutySlot).where(DutySlot.rota_period_id == period.id))
    }
    created_slots: list[DutySlot] = []
    events: list[RotaTemplateGenerationEvent] = []

    for unit in units:
        for day in days:
            unit_members = active_unit_member_ids(postings, unit.id, day)
            day_leaves = leaves.get(day, {})
            for rule in duties:
                if not rule_applies_to_unit(rule, unit):
                    events.append(
                        create_event(
                            run=run,
                            unit=unit,
                            day=day,
                            rule=rule,
                            action=ACTION_SKIPPED,
                            severity="info",
                            reason="Duty rule is not enabled for this unit.",
                            details={"unit_code": unit.code, "duty_label": rule.label},
                        )
                    )
                    continue
                label = slot_label(unit)
                unique_key = (day, rule.key, label)
                if unique_key in existing_keys:
                    events.append(
                        create_event(
                            run=run,
                            unit=unit,
                            day=day,
                            rule=rule,
                            action=ACTION_SKIPPED,
                            severity="warning",
                            reason="A matching duty slot already exists.",
                            details={"slot_label": label},
                        )
                    )
                    continue

                pressure = pressure_for_slot(
                    unit_member_ids=unit_members,
                    day_leaves=day_leaves,
                    rule=rule,
                    rules=rules,
                )
                hard_block = pressure["status"] == "hard_block"
                warning = pressure["status"] == "warning"
                if hard_block and rule.is_adjustable and not rule.is_mandatory:
                    events.append(
                        create_event(
                            run=run,
                            unit=unit,
                            day=day,
                            rule=rule,
                            action=ACTION_BLOCKED,
                            severity="error",
                            reason=f"Adjustable slot skipped. {pressure['reason']}",
                            details=pressure,
                        )
                    )
                    continue

                starts_at, ends_at = slot_bounds(day, rule)
                status = NEEDS_REVIEW if hard_block or warning else READY
                reason = str(pressure["reason"])
                slot = DutySlot(
                    rota_period=period,
                    unit=unit,
                    duty_date=day,
                    duty_type=rule.key,
                    call_level=rule.allowed_call_levels[0] if len(rule.allowed_call_levels) == 1 else None,
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
                existing_keys.add(unique_key)
                events.append(
                    create_event(
                        run=run,
                        unit=unit,
                        day=day,
                        rule=rule,
                        action=ACTION_CREATED,
                        severity=str(pressure["severity"]),
                        reason=reason,
                        details={**pressure, "template_status": status},
                    )
                )

    for event in events:
        db.add(event)
    run.created_slots = len(created_slots)
    run.needs_review_slots = sum(1 for slot in created_slots if slot.template_status == NEEDS_REVIEW)
    run.skipped_slots = sum(1 for event in events if event.action == ACTION_SKIPPED)
    run.blocked_slots = sum(1 for event in events if event.action == ACTION_BLOCKED)
    run.summary = {
        **run.summary,
        "created_slots": run.created_slots,
        "needs_review_slots": run.needs_review_slots,
        "skipped_slots": run.skipped_slots,
        "blocked_slots": run.blocked_slots,
    }
    db.commit()
    db.refresh(run)
    return template_month(db, month, run.id)


def template_slots_for_period(db: Session, rota_period_id: UUID) -> list[DutySlot]:
    return list(
        db.scalars(
            select(DutySlot)
            .where(DutySlot.rota_period_id == rota_period_id)
            .options(
                selectinload(DutySlot.unit),
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
