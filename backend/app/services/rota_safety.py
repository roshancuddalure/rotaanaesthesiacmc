from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session, selectinload

from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, Unit
from app.services.leave import ACTIVE_LEAVE_STATUSES, BLOCKING_LEAVE_STATUSES, date_range, leave_requests_for_month, month_bounds
from app.services.call_clusters import active_cluster_keys_for_person
from app.services.rota_call_levels import inferred_call_levels_from_duty_type, normalize_call_level
from app.services.rota_rules import DutyRule, RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.rota_template import PHASE4_SLOT_SOURCE

SAFETY_SAFE = "safe"
SAFETY_WARNING = "needs_review"
SAFETY_HARD_BLOCK = "hard_blocked"
ACTIVE_ASSIGNMENT_STATUSES = {"assigned", "draft", "confirmed"}


@dataclass(frozen=True)
class MemberContext:
    person: Person
    unit_id: UUID
    posting_type: str


def member_call_level(member: MemberContext) -> str:
    return normalize_call_level(member.person.call_level or member.posting_type)


def rule_for_slot(slot: DutySlot, rules: RotaPhaseOneRules) -> DutyRule | None:
    return rules.duty_rules_by_key.get(slot.duty_type)


def required_call_levels(slot: DutySlot, rule: DutyRule | None) -> set[str]:
    if slot.call_level:
        normalized = normalize_call_level(slot.call_level)
        if normalized != "Unassigned":
            return {normalized}
    if rule and rule.allowed_call_levels:
        return {
            normalized
            for item in rule.allowed_call_levels
            if (normalized := normalize_call_level(item)) != "Unassigned"
        }
    return inferred_call_levels_from_duty_type(slot.duty_type)


def unit_minimum_for_required_calls(
    unit: Unit | None,
    required_calls: set[str],
    rules: RotaPhaseOneRules,
) -> int:
    fallback = (
        int(getattr(unit, "minimum_free_people", rules.unit_staffing_rules.minimum_available_count))
        if unit
        else rules.unit_staffing_rules.minimum_available_count
    )
    if unit is None or len(required_calls) != 1:
        return max(0, fallback)
    call_level = next(iter(required_calls))
    for row in getattr(unit, "call_minimums", []):
        if normalize_call_level(row.call_level) == call_level:
            return max(0, int(row.minimum_free_people))
    return max(0, fallback)


def member_matches_cluster_rules(db: Session | None, context: MemberContext, slot: DutySlot, rule: DutyRule | None) -> bool:
    if rule is None:
        return True
    if db is None:
        return not rule.allowed_cluster_keys
    active_keys = active_cluster_keys_for_person(db, context.person.id, slot.duty_date)
    allowed = set(rule.allowed_cluster_keys)
    excluded = set(rule.excluded_cluster_keys)
    if allowed and not active_keys.intersection(allowed):
        return False
    if excluded and active_keys.intersection(excluded):
        return False
    return True


def slot_leave_blocks(leave: LeaveRequest, slot: DutySlot) -> bool:
    leave_slot = leave.leave_slot.upper()
    if slot.is_24hr:
        return leave_slot in {"FULL_DAY", "AM", "PM", "NIGHT"}
    start_hour = slot.starts_at.hour
    if leave_slot == "FULL_DAY":
        return True
    if leave_slot == "AM":
        return start_hour < 12
    if leave_slot == "PM":
        return start_hour >= 12
    if leave_slot == "NIGHT":
        return start_hour >= 18 or start_hour < 8
    return True


def postings_for_month(db: Session, starts_on: date, ends_on: date) -> list[PersonPosting]:
    return list(
        db.scalars(
            select(PersonPosting)
            .where(
                PersonPosting.starts_on <= ends_on,
                (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
            )
            .options(selectinload(PersonPosting.person), selectinload(PersonPosting.unit))
        )
    )


def member_contexts_for_day(postings: list[PersonPosting], day: date) -> list[MemberContext]:
    contexts: list[MemberContext] = []
    seen: set[tuple[UUID, UUID]] = set()
    for posting in postings:
        if posting.unit_id is None:
            continue
        if posting.starts_on > day or (posting.ends_on is not None and posting.ends_on < day):
            continue
        if posting.person.active_status != "active":
            continue
        key = (posting.person_id, posting.unit_id)
        if key in seen:
            continue
        seen.add(key)
        contexts.append(
            MemberContext(
                person=posting.person,
                unit_id=posting.unit_id,
                posting_type=posting.posting_type,
            )
        )
    return contexts


def leaves_by_day_and_person(db: Session, month: str) -> dict[date, dict[UUID, list[LeaveRequest]]]:
    starts_on, ends_on = month_bounds(month)
    indexed: dict[date, dict[UUID, list[LeaveRequest]]] = {}
    for leave in leave_requests_for_month(db, month):
        if leave.status.lower() not in ACTIVE_LEAVE_STATUSES:
            continue
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        for day in date_range(first, last):
            indexed.setdefault(day, {}).setdefault(leave.person_id, []).append(leave)
    return indexed


def assignments_for_month(db: Session, starts_on: date, ends_on: date) -> list[DutyAssignment]:
    return list(
        db.scalars(
            select(DutyAssignment)
            .join(DutyAssignment.duty_slot)
            .where(
                DutySlot.duty_date >= starts_on,
                DutySlot.duty_date <= ends_on,
                DutySlot.source == PHASE4_SLOT_SOURCE,
            )
            .options(
                selectinload(DutyAssignment.person),
                selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.unit).selectinload(Unit.call_minimums),
            )
        )
    )


def duty_blocks_same_day(slot: DutySlot, rules: RotaPhaseOneRules) -> bool:
    rule = rule_for_slot(slot, rules)
    if rule is None:
        return slot.is_24hr
    return slot.is_24hr or rule.blocks_elective_same_day


def previous_day_24hr_blocks(slot: DutySlot, rules: RotaPhaseOneRules) -> bool:
    rule = rule_for_slot(slot, rules)
    if rule is None:
        return slot.is_24hr
    return slot.is_24hr or rule.blocks_elective_next_day


def assignment_indexes(
    assignments: list[DutyAssignment],
    rules: RotaPhaseOneRules,
) -> tuple[dict[date, dict[UUID, list[DutyAssignment]]], dict[date, dict[UUID, list[DutyAssignment]]]]:
    same_day: dict[date, dict[UUID, list[DutyAssignment]]] = {}
    previous_day: dict[date, dict[UUID, list[DutyAssignment]]] = {}
    for assignment in assignments:
        if assignment.status.lower() not in ACTIVE_ASSIGNMENT_STATUSES:
            continue
        slot = assignment.duty_slot
        if duty_blocks_same_day(slot, rules):
            same_day.setdefault(slot.duty_date, {}).setdefault(assignment.person_id, []).append(assignment)
        if previous_day_24hr_blocks(slot, rules):
            blocked_day = slot.duty_date + timedelta(days=1)
            previous_day.setdefault(blocked_day, {}).setdefault(assignment.person_id, []).append(assignment)
    return same_day, previous_day


def safety_status(
    *,
    eligible_members: int,
    available_members: int,
    hard_blocked_members: int,
    warning_members: int,
    rules: RotaPhaseOneRules,
    minimum_available_count: int | None = None,
) -> tuple[str, list[str]]:
    staffing = rules.unit_staffing_rules
    minimum = staffing.minimum_available_count if minimum_available_count is None else minimum_available_count
    hard_percent = 100 if eligible_members == 0 else round((hard_blocked_members / eligible_members) * 100)
    warning_percent = 100 if eligible_members == 0 else round(((hard_blocked_members + warning_members) / eligible_members) * 100)
    reasons: list[str] = []
    status = SAFETY_SAFE

    if eligible_members == 0:
        status = SAFETY_HARD_BLOCK
        reasons.append("No eligible active members are assigned to this unit/call level for this date.")
    elif staffing.small_unit_uses_absolute_minimum and available_members < minimum:
        status = SAFETY_HARD_BLOCK
        reasons.append(
            f"Only {available_members} eligible member(s) remain available, below the unit minimum of {minimum}."
        )
    elif hard_percent >= staffing.hard_block_unavailable_percent:
        status = SAFETY_HARD_BLOCK
        reasons.append(
            f"{hard_percent}% of eligible members are unavailable, meeting the hard block threshold of {staffing.hard_block_unavailable_percent}%."
        )
    elif hard_percent >= staffing.warning_unavailable_percent:
        status = SAFETY_WARNING
        reasons.append(
            f"{hard_percent}% of eligible members are unavailable, meeting the warning threshold of {staffing.warning_unavailable_percent}%."
        )
    elif warning_members > 0:
        status = SAFETY_WARNING
        reasons.append(f"{warning_members} member(s) have requested or imported leave needing review.")
    elif warning_percent >= staffing.warning_unavailable_percent:
        status = SAFETY_WARNING
        reasons.append(
            f"{warning_percent}% of eligible members have confirmed or review-pending blockers."
        )

    if not reasons:
        reasons.append("Enough eligible members remain available under the current rules.")
    return status, reasons


def person_blockers(
    *,
    person_id: UUID,
    slot: DutySlot,
    day_leaves: dict[UUID, list[LeaveRequest]],
    same_day_assignments: dict[UUID, list[DutyAssignment]],
    previous_day_assignments: dict[UUID, list[DutyAssignment]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    hard: list[dict[str, object]] = []
    warnings: list[dict[str, object]] = []
    for leave in day_leaves.get(person_id, []):
        if not slot_leave_blocks(leave, slot):
            continue
        entry = {
            "type": "leave",
            "label": "Approved leave" if leave.status.lower() in BLOCKING_LEAVE_STATUSES else "Leave pending review",
            "leave_type": leave.leave_type,
            "leave_slot": leave.leave_slot,
            "status": leave.status,
        }
        if leave.status.lower() in BLOCKING_LEAVE_STATUSES:
            hard.append(entry)
        else:
            warnings.append(entry)
    for assignment in same_day_assignments.get(person_id, []):
        if assignment.duty_slot_id == slot.id:
            continue
        hard.append(
            {
                "type": "same_day_duty",
                "label": "Already assigned to another same-day duty",
                "duty_type": assignment.duty_slot.duty_type,
                "slot_id": str(assignment.duty_slot_id),
            }
        )
    for assignment in previous_day_assignments.get(person_id, []):
        hard.append(
            {
                "type": "post_24hr_rest",
                "label": "Rest blocked after previous-day 24-hour duty",
                "duty_type": assignment.duty_slot.duty_type,
                "slot_id": str(assignment.duty_slot_id),
            }
        )
    return hard, warnings


def slot_safety(
    *,
    slot: DutySlot,
    rules: RotaPhaseOneRules,
    postings: list[PersonPosting],
    leaves: dict[date, dict[UUID, list[LeaveRequest]]],
    same_day_assignments: dict[date, dict[UUID, list[DutyAssignment]]],
    previous_day_assignments: dict[date, dict[UUID, list[DutyAssignment]]],
) -> dict[str, object]:
    rule = rule_for_slot(slot, rules)
    day_contexts = member_contexts_for_day(postings, slot.duty_date)
    unit_contexts = [context for context in day_contexts if context.unit_id == slot.unit_id]
    required_calls = required_call_levels(slot, rule)
    eligible = [
        context
        for context in unit_contexts
        if not required_calls or member_call_level(context) in required_calls
    ]
    eligible = [
        context
        for context in eligible
        if member_matches_cluster_rules(object_session(context.person), context, slot, rule)
    ]
    day_leaves = leaves.get(slot.duty_date, {})
    same_day = same_day_assignments.get(slot.duty_date, {})
    previous_day = previous_day_assignments.get(slot.duty_date, {})
    hard_people: list[dict[str, object]] = []
    warning_people: list[dict[str, object]] = []
    available_people: list[dict[str, object]] = []

    for context in eligible:
        hard, warnings = person_blockers(
            person_id=context.person.id,
            slot=slot,
            day_leaves=day_leaves,
            same_day_assignments=same_day,
            previous_day_assignments=previous_day,
        )
        person_payload = {
            "person_id": str(context.person.id),
            "person_name": context.person.canonical_name,
            "call_level": member_call_level(context),
            "posting_type": context.posting_type,
        }
        if hard:
            hard_people.append({**person_payload, "blockers": hard})
        elif warnings:
            warning_people.append({**person_payload, "blockers": warnings})
            available_people.append(person_payload)
        else:
            available_people.append(person_payload)

    status, reasons = safety_status(
        eligible_members=len(eligible),
        available_members=len(available_people),
        hard_blocked_members=len(hard_people),
        warning_members=len(warning_people),
        rules=rules,
        minimum_available_count=unit_minimum_for_required_calls(slot.unit, required_calls, rules),
    )
    return {
        "slot_id": str(slot.id),
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "slot_label": slot.slot_label,
        "required_call_levels": sorted(required_calls),
        "safety_status": status,
        "reasons": reasons,
        "total_unit_members": len(unit_contexts),
        "eligible_members": len(eligible),
        "available_members": len(available_people),
        "hard_blocked_members": len(hard_people),
        "warning_members": len(warning_people),
        "available_people": available_people,
        "hard_blocked_people": hard_people,
        "warning_people": warning_people,
    }


def slots_for_month(db: Session, rota_period_id: UUID) -> list[DutySlot]:
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


def unit_day_safety_rows(slot_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[tuple[object, object], list[dict[str, object]]] = {}
    for row in slot_rows:
        grouped.setdefault((row["unit_id"], row["duty_date"]), []).append(row)
    results = []
    for (_unit_id, _day), rows in sorted(grouped.items(), key=lambda item: (str(item[0][1]), str(item[0][0]))):
        worst = SAFETY_SAFE
        if any(row["safety_status"] == SAFETY_HARD_BLOCK for row in rows):
            worst = SAFETY_HARD_BLOCK
        elif any(row["safety_status"] == SAFETY_WARNING for row in rows):
            worst = SAFETY_WARNING
        results.append(
            {
                "unit_id": rows[0]["unit_id"],
                "unit_name": rows[0]["unit_name"],
                "unit_code": rows[0]["unit_code"],
                "date": rows[0]["duty_date"],
                "safety_status": worst,
                "slots": len(rows),
                "safe_slots": sum(1 for row in rows if row["safety_status"] == SAFETY_SAFE),
                "needs_review_slots": sum(1 for row in rows if row["safety_status"] == SAFETY_WARNING),
                "hard_blocked_slots": sum(1 for row in rows if row["safety_status"] == SAFETY_HARD_BLOCK),
                "minimum_available_members": min((int(row["available_members"]) for row in rows), default=0),
            }
        )
    return results


def month_safety(db: Session, month: str) -> dict[str, object]:
    starts_on, ends_on = month_bounds(month)
    period, scope = monthly_setup(db, month)
    _rule_version, rules = get_phase_one_rules(db)
    slots = slots_for_month(db, period.id)
    postings = postings_for_month(db, starts_on, ends_on)
    leaves = leaves_by_day_and_person(db, month)
    assignments = assignments_for_month(db, starts_on, ends_on)
    same_day_assignments, previous_day_assignments = assignment_indexes(assignments, rules)
    rows = [
        slot_safety(
            slot=slot,
            rules=rules,
            postings=postings,
            leaves=leaves,
            same_day_assignments=same_day_assignments,
            previous_day_assignments=previous_day_assignments,
        )
        for slot in slots
    ]
    counts = Counter(str(row["safety_status"]) for row in rows)
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
        },
        "summary": {
            "total_slots": len(rows),
            "safe_slots": counts.get(SAFETY_SAFE, 0),
            "needs_review_slots": counts.get(SAFETY_WARNING, 0),
            "hard_blocked_slots": counts.get(SAFETY_HARD_BLOCK, 0),
            "status_counts": dict(counts),
        },
        "slots": rows,
        "unit_day_safety": unit_day_safety_rows(rows),
    }
