"""Phase 4 template generation: create the month's duty slots and allocate each to a unit.

Algorithm (``generate_empty_template``):
1. Requires a locked scope; loads rules, included units, postings and leave.
2. For each day, duty families are rotated so no family is always processed first.
3. For each (day, duty) ``choose_balanced_unit`` scores every included unit:
   - staffing pressure (``pressure_for_slot``): leave, other same-day slots already given
     to the unit, previous-day 24h slots, against the unit/call minimum and % thresholds;
   - fairness targets per unit (total, duty family, family+call, exact duty, call bucket),
     weighted by the selected policy (equal_unit / equal_people / hybrid);
   - weekend spread and weekly clustering.
   The best non-hard-blocked unit wins; if every unit is hard-blocked the least-damaging
   unit is chosen and the slot is marked as a "forced allocation" needing review.
4. ``optimize_template_slot_layout`` then performs conservative pairwise "vertical
   shuffle" swaps that reduce same-unit clustering without worsening safety.
5. Every decision is logged as a ``RotaTemplateGenerationEvent``.

People are NOT assigned here - that is manual assignment / auto-fill.
Also contains allocation statistics and the Eagle Eye / call-wise Excel exports.
"""

from __future__ import annotations
from app.services.member_profiles import call_level_on

from collections import Counter
from io import BytesIO
from typing import Any
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID
from time import perf_counter

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
from app.services.rota_eligibility import effective_call_levels
from app.services.rota_rules import DutyRule, RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_setup import SCOPE_INCLUDED, monthly_setup

PHASE4_SLOT_SOURCE = "phase4_template"
READY = "ready"
NEEDS_REVIEW = "needs_review"
UNRESOLVED = "unresolved"
ACTION_CREATED = "created"
ACTION_FORCED = "forced_allocation"
ACTION_SHUFFLED = "vertical_shuffle"
ACTION_SKIPPED = "skipped"
ACTION_BLOCKED = "blocked"
FORCED_ALLOCATION_MODE = "forced_minimal_damage"
FORCED_ALLOCATION_REASON_PREFIX = "Forced minimal-damage allocation"
FAIRNESS_EQUAL_UNIT = "equal_unit"
FAIRNESS_EQUAL_PEOPLE = "equal_people"
FAIRNESS_HYBRID = "hybrid"
ALLOCATION_FAIRNESS_POLICIES = {
    FAIRNESS_EQUAL_UNIT,
    FAIRNESS_EQUAL_PEOPLE,
    FAIRNESS_HYBRID,
}


def is_forced_allocation_slot(slot: DutySlot) -> bool:
    return str(slot.template_reason or "").startswith(FORCED_ALLOCATION_REASON_PREFIX)


@dataclass
class TemplateGenerationOptions:
    duty_keys: list[str] | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    include_weekdays: bool = True
    include_weekends: bool = True
    replace_existing: bool = True
    allocation_fairness_policy: str = FAIRNESS_HYBRID


@dataclass
class UnitAllocation:
    unit: Unit
    pressure: dict[str, object]
    score: int
    hard_blocked: bool
    warning: bool
    reason: str
    fairness: dict[str, object]


def normalize_allocation_fairness_policy(value: str | None) -> str:
    if not value:
        return FAIRNESS_HYBRID
    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
    if normalized not in ALLOCATION_FAIRNESS_POLICIES:
        raise ValueError(
            "Allocation fairness policy must be one of: "
            + ", ".join(sorted(ALLOCATION_FAIRNESS_POLICIES))
        )
    return normalized


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


def duty_rules_for_day(duties: list[DutyRule], day: date, first_day: date) -> list[DutyRule]:
    """Rotate duty-family processing order by day so late families (e.g. CHAD/RUHSA) are not
    always allocated after earlier families have used up small units."""
    group_order: list[str] = []
    for rule in duties:
        if rule.group not in group_order:
            group_order.append(rule.group)
    if len(group_order) <= 1:
        return duties
    offset = (day - first_day).days % len(group_order)
    rotated_groups = group_order[offset:] + group_order[:offset]
    group_rank = {group: index for index, group in enumerate(rotated_groups)}
    return [
        rule
        for _index, rule in sorted(
            enumerate(duties),
            key=lambda item: (group_rank.get(item[1].group, len(group_rank)), item[0]),
        )
    ]


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
    """Slot start/end datetimes from the rule's start time and duration (or end time).

    KNOWN ISSUE (handbook B9): default rules for non-24h, non-12h duties (PAC, shifts, CHAD,
    RUHSA, ...) have ``duration_hours=0`` and start == end == 08:00, so they fall through to
    the "end <= start -> next day" branch and become 24-hour windows.
    """
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
        return True
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
    call_level: str | set[str] | frozenset[str] | None = None,
) -> set[UUID]:
    """Active members of ``unit_id`` on ``day``; ``call_level`` may be one level or a set
    (multi-level duties), ``None`` for everyone."""
    levels = as_level_set(call_level)
    return {
        posting.person_id
        for posting in postings
        if posting.unit_id == unit_id
        and posting.starts_on <= day
        and (posting.ends_on is None or posting.ends_on >= day)
        and posting.person.active_status == "active"
        and (not levels or normalize_call_level(call_level_on(posting.person, day) or posting.posting_type) in levels)
    }


def as_level_set(call_level: str | set[str] | frozenset[str] | None) -> set[str]:
    if call_level is None:
        return set()
    if isinstance(call_level, str):
        return {call_level}
    return set(call_level)


def allocation_target_weights(
    *,
    policy: str,
    unit_ids: list[UUID],
    capacity_counts: dict[UUID, int],
) -> dict[UUID, int]:
    """Relative target share per unit for the chosen fairness policy.

    equal_unit: every unit weight 1. equal_people: weight = active eligible people.
    hybrid: ``total_capacity + unit_count * capacity`` - roughly half equal-share, half
    proportional to people.
    """
    if not unit_ids:
        return {}
    policy = normalize_allocation_fairness_policy(policy)
    if policy == FAIRNESS_EQUAL_UNIT:
        return {unit_id: 1 for unit_id in unit_ids}

    total_capacity = sum(max(0, capacity_counts.get(unit_id, 0)) for unit_id in unit_ids)
    if total_capacity <= 0:
        return {unit_id: 1 for unit_id in unit_ids}

    if policy == FAIRNESS_EQUAL_PEOPLE:
        return {unit_id: max(0, capacity_counts.get(unit_id, 0)) for unit_id in unit_ids}

    unit_count = len(unit_ids)
    return {
        unit_id: total_capacity + unit_count * max(0, capacity_counts.get(unit_id, 0))
        for unit_id in unit_ids
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
    """Unit staffing pressure if this slot were given to the unit.

    Unavailable = members on overlapping leave + slots the unit already holds that day +
    members resting after a previous-day 24h slot (counts are per slot, not per person).
    ``hard_block`` if no members, if fewer than ``minimum`` remain after this slot, or if the
    unavailable percentage reaches the hard threshold; ``warning`` at the warning threshold.
    """
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


def required_calls_for_rule(rule: DutyRule) -> set[str]:
    """The duty's effective call levels (rota_eligibility): rule levels or key-inferred,
    plus each active allowed group's level."""
    return effective_call_levels(rule)


def required_call_for_rule(rule: DutyRule) -> str | None:
    """The single effective call level, or ``None`` for multi-level (or unknown) duties."""
    levels = required_calls_for_rule(rule)
    return next(iter(levels)) if len(levels) == 1 else None


def unit_minimum_free_people_for_call(
    unit: Unit, call_level: str | set[str] | frozenset[str] | None, rules: RotaPhaseOneRules
) -> int:
    """Unit minimum for one level or a set of levels. For a set, the per-level minimums
    found are added up (each level keeps its own minimum free); the unit fallback is used
    when none of the levels has its own minimum."""
    fallback = unit_minimum_free_people(unit, rules)
    levels = as_level_set(call_level)
    if not levels:
        return fallback
    found = [
        max(0, int(row.minimum_free_people))
        for row in getattr(unit, "call_minimums", [])
        if normalize_call_level(row.call_level) in levels
    ]
    return sum(found) if found else fallback


def duty_group_for_rule(rule: DutyRule | None, duty_key: str) -> str:
    return rule.group if rule is not None else duty_key


def required_call_bucket_for_rule(rule: DutyRule | None, duty_key: str) -> str:
    """Fairness bucket: the single level, ``"3RD_CALL+4TH_CALL"`` for multi-level duties,
    or ``"Unassigned"``."""
    levels = (
        required_calls_for_rule(rule)
        if rule is not None
        else inferred_call_levels_from_duty_type(duty_key)
    )
    if not levels:
        return "Unassigned"
    return "+".join(sorted(levels))


def required_call_bucket_for_slot(slot: DutySlot, rule: DutyRule | None) -> str:
    if slot.call_level:
        normalized = normalize_call_level(slot.call_level)
        if normalized != "Unassigned":
            return normalized
    return required_call_bucket_for_rule(rule, slot.duty_type)


def group_call_bucket(group: str, call_level: str) -> str:
    return f"{group}:{call_level}"


def overage_after_assignment(
    *,
    current_count: int,
    total_bucket_count: int,
    candidate_units: int,
) -> int:
    if candidate_units <= 0:
        return 0
    expected_floor_after = (total_bucket_count + 1) // candidate_units
    return max(0, current_count + 1 - expected_floor_after)


def target_deficit_before_assignment(
    *,
    current_count: int,
    total_bucket_count: int,
    candidate_units: int,
) -> int:
    if candidate_units <= 0:
        return 0
    expected_ceiling_after = (total_bucket_count + candidate_units) // candidate_units
    return max(0, expected_ceiling_after - current_count)


def weighted_expected_floor_after_assignment(
    *,
    total_bucket_count: int,
    unit_weight: int,
    total_weight: int,
) -> int:
    if unit_weight <= 0 or total_weight <= 0:
        return 0
    return ((total_bucket_count + 1) * unit_weight) // total_weight


def weighted_expected_ceiling_after_assignment(
    *,
    total_bucket_count: int,
    unit_weight: int,
    total_weight: int,
) -> int:
    if unit_weight <= 0 or total_weight <= 0:
        return 0
    numerator = (total_bucket_count + 1) * unit_weight
    return (numerator + total_weight - 1) // total_weight


def weighted_overage_after_assignment(
    *,
    current_count: int,
    total_bucket_count: int,
    unit_weight: int,
    total_weight: int,
) -> int:
    expected_floor_after = weighted_expected_floor_after_assignment(
        total_bucket_count=total_bucket_count,
        unit_weight=unit_weight,
        total_weight=total_weight,
    )
    return max(0, current_count + 1 - expected_floor_after)


def weighted_target_deficit_before_assignment(
    *,
    current_count: int,
    total_bucket_count: int,
    unit_weight: int,
    total_weight: int,
) -> int:
    expected_ceiling_after = weighted_expected_ceiling_after_assignment(
        total_bucket_count=total_bucket_count,
        unit_weight=unit_weight,
        total_weight=total_weight,
    )
    return max(0, expected_ceiling_after - current_count)


def count_for_unit_bucket(counter: dict[tuple[UUID, str], int], unit_id: UUID, bucket: str) -> int:
    return counter.get((unit_id, bucket), 0)


def total_for_bucket(counter: dict[tuple[UUID, str], int], bucket: str) -> int:
    return sum(count for (_unit_id, key), count in counter.items() if key == bucket)


def post_24hr_rest_count(
    counts: dict[tuple[UUID, date, str | None], int],
    unit_id: UUID,
    day: date,
    call_level: str | set[str] | frozenset[str] | None,
) -> int:
    if isinstance(call_level, str):
        return counts.get((unit_id, day, call_level), 0)
    if call_level:
        # Multi-level duty: rests of any of its levels, plus unstamped (multi-level) slots.
        return sum(
            count
            for (count_unit_id, count_day, count_call), count in counts.items()
            if count_unit_id == unit_id
            and count_day == day
            and (count_call is None or count_call in call_level)
        )
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


def forced_damage_score(allocation: UnitAllocation) -> tuple[int, int, int, int, int, int, int]:
    pressure = allocation.pressure
    assigned_members = int(pressure["assigned_members"])
    available_after = int(pressure["available_after_slot"])
    minimum = int(pressure["minimum_free_people"])
    shortage = max(0, minimum - available_after)
    unavailable_members = int(pressure["unavailable_members"])
    post_24hr_duties = int(pressure["provisional_post_24hr_duties"])
    same_day_duties = int(pressure["provisional_unit_day_duties"])
    unavailable_percent = int(pressure["unavailable_percent"])
    return (
        1 if assigned_members == 0 else 0,
        shortage,
        unavailable_members + post_24hr_duties,
        same_day_duties,
        post_24hr_duties,
        unavailable_percent,
        allocation.score,
    )


def template_pattern_score(slots: list[DutySlot], rules_by_key: dict[str, DutyRule]) -> int:
    score = 0
    by_day_group_unit: dict[tuple[date, str, UUID], int] = {}
    by_duty_unit: dict[tuple[str, UUID], list[date]] = {}

    for slot in slots:
        if slot.unit_id is None:
            continue
        rule = rules_by_key.get(slot.duty_type)
        group = rule.group if rule is not None else slot.duty_type
        by_day_group_unit[(slot.duty_date, group, slot.unit_id)] = (
            by_day_group_unit.get((slot.duty_date, group, slot.unit_id), 0) + 1
        )
        by_duty_unit.setdefault((slot.duty_type, slot.unit_id), []).append(slot.duty_date)

    for count in by_day_group_unit.values():
        if count > 1:
            score += (count * (count - 1) // 2) * 100

    for dates in by_duty_unit.values():
        ordered_dates = sorted(set(dates))
        for index, current in enumerate(ordered_dates):
            for later in ordered_dates[index + 1 :]:
                gap = (later - current).days
                if gap == 1:
                    score += 40
                elif gap <= 3:
                    score += 10
                else:
                    break
    return score


def slot_pressure_in_layout(
    *,
    slot: DutySlot,
    unit: Unit,
    all_slots: list[DutySlot],
    rules: RotaPhaseOneRules,
    rules_by_key: dict[str, DutyRule],
    postings: list[PersonPosting],
    leaves: dict[date, dict[UUID, list[LeaveRequest]]],
    proposed_units: dict[UUID, Unit] | None = None,
) -> dict[str, object] | None:
    rule = rules_by_key.get(slot.duty_type)
    if rule is None or not rule_applies_to_unit(rule, unit):
        return None
    required_calls = (
        {normalize_call_level(slot.call_level)} if slot.call_level else required_calls_for_rule(rule)
    )
    same_day_count = 0
    previous_24hr_count = 0
    for other in all_slots:
        if other.id == slot.id:
            continue
        other_unit = proposed_units.get(other.id, other.unit) if proposed_units is not None else other.unit
        if other_unit is None or other_unit.id != unit.id:
            continue
        if other.duty_date == slot.duty_date:
            same_day_count += 1
        if other.is_24hr and other.duty_date + timedelta(days=1) == slot.duty_date:
            other_call = normalize_call_level(other.call_level) if other.call_level else None
            if not required_calls or other_call is None or other_call in required_calls:
                previous_24hr_count += 1
    return pressure_for_slot(
        unit_member_ids=active_unit_member_ids(
            postings, unit.id, slot.duty_date, call_level=required_calls or None
        ),
        day_leaves=leaves.get(slot.duty_date, {}),
        rule=rule,
        rules=rules,
        provisional_unit_day_duties=same_day_count,
        provisional_post_24hr_duties=previous_24hr_count,
        minimum_free_people=unit_minimum_free_people_for_call(unit, required_calls or None, rules),
    )


def optimize_template_slot_layout(
    *,
    run: RotaTemplateGenerationRun,
    created_slots: list[DutySlot],
    existing_slots: list[DutySlot],
    units: list[Unit],
    rules: RotaPhaseOneRules,
    postings: list[PersonPosting],
    leaves: dict[date, dict[UUID, list[LeaveRequest]]],
) -> tuple[int, list[RotaTemplateGenerationEvent]]:
    """Greedy "vertical shuffle": repeatedly apply the best swap of units between two slots of
    the same duty on different days that lowers ``template_pattern_score`` (same-unit
    clustering) without making either slot's staffing worse. Forced slots are never moved.

    Cost is roughly O(swaps x slots^2 x slots) - acceptable for one month (handbook P3).
    """
    rules_by_key = rules.duty_rules_by_key
    units_by_id = {unit.id: unit for unit in units}
    all_slots = [*existing_slots, *created_slots]
    movable_slots = [
        slot
        for slot in created_slots
        if slot.unit_id is not None and not is_forced_allocation_slot(slot)
    ]
    if len(movable_slots) < 2:
        return 0, []

    applied = 0
    events: list[RotaTemplateGenerationEvent] = []
    max_swaps = min(200, len(movable_slots) * 2)
    current_score = template_pattern_score(all_slots, rules_by_key)
    comparisons = 0

    for _ in range(max_swaps):
        best_swap: tuple[int, DutySlot, DutySlot, dict[str, object], dict[str, object]] | None = None
        for index, first in enumerate(movable_slots):
            first_unit = units_by_id.get(first.unit_id)
            if first_unit is None:
                continue
            for second in movable_slots[index + 1 :]:
                comparisons += 1
                if comparisons > 20000:
                    run.summary={**run.summary,"shuffle_comparisons":comparisons-1,"shuffle_budget_limited":True}
                    return applied,events
                if first.duty_type != second.duty_type or first.duty_date == second.duty_date:
                    continue
                second_unit = units_by_id.get(second.unit_id)
                if second_unit is None or first_unit.id == second_unit.id:
                    continue

                before_first = slot_pressure_in_layout(
                    slot=first,
                    unit=first_unit,
                    all_slots=all_slots,
                    rules=rules,
                    rules_by_key=rules_by_key,
                    postings=postings,
                    leaves=leaves,
                )
                before_second = slot_pressure_in_layout(
                    slot=second,
                    unit=second_unit,
                    all_slots=all_slots,
                    rules=rules,
                    rules_by_key=rules_by_key,
                    postings=postings,
                    leaves=leaves,
                )
                proposed_units = {first.id: second_unit, second.id: first_unit}
                after_first = slot_pressure_in_layout(
                    slot=first,
                    unit=second_unit,
                    all_slots=all_slots,
                    rules=rules,
                    rules_by_key=rules_by_key,
                    postings=postings,
                    leaves=leaves,
                    proposed_units=proposed_units,
                )
                after_second = slot_pressure_in_layout(
                    slot=second,
                    unit=first_unit,
                    all_slots=all_slots,
                    rules=rules,
                    rules_by_key=rules_by_key,
                    postings=postings,
                    leaves=leaves,
                    proposed_units=proposed_units,
                )
                if any(
                    item is None
                    for item in [before_first, before_second, after_first, after_second]
                ):
                    continue
                first_new_label = slot_label(second_unit)
                second_new_label = slot_label(first_unit)
                if any(
                    other.id != first.id
                    and other.duty_date == first.duty_date
                    and other.duty_type == first.duty_type
                    and other.slot_label == first_new_label
                    for other in all_slots
                ):
                    continue
                if any(
                    other.id != second.id
                    and other.duty_date == second.duty_date
                    and other.duty_type == second.duty_type
                    and other.slot_label == second_new_label
                    for other in all_slots
                ):
                    continue
                if after_first["status"] == "hard_block" or after_second["status"] == "hard_block":
                    continue
                if int(after_first["available_after_slot"]) < int(before_first["available_after_slot"]):
                    continue
                if int(after_second["available_after_slot"]) < int(before_second["available_after_slot"]):
                    continue
                if int(after_first["unavailable_percent"]) > int(before_first["unavailable_percent"]):
                    continue
                if int(after_second["unavailable_percent"]) > int(before_second["unavailable_percent"]):
                    continue

                original_first_unit = first.unit
                original_second_unit = second.unit
                first.unit = second_unit
                first.unit_id = second_unit.id
                second.unit = first_unit
                second.unit_id = first_unit.id
                candidate_score = template_pattern_score(all_slots, rules_by_key)
                first.unit = original_first_unit
                first.unit_id = first_unit.id
                second.unit = original_second_unit
                second.unit_id = second_unit.id

                improvement = current_score - candidate_score
                if improvement <= 0:
                    continue
                if best_swap is None or improvement > best_swap[0]:
                    best_swap = (improvement, first, second, after_first, after_second)

        if best_swap is None:
            break

        improvement, first, second, after_first, after_second = best_swap
        first_unit = units_by_id[first.unit_id]
        second_unit = units_by_id[second.unit_id]
        first.unit = second_unit
        first.unit_id = second_unit.id
        first.slot_label = slot_label(second_unit)
        second.unit = first_unit
        second.unit_id = first_unit.id
        second.slot_label = slot_label(first_unit)
        note = (
            f"Vertical shuffle swapped with {second.duty_date.isoformat()} "
            f"{second.duty_type} to reduce same-unit clustering."
        )
        first.notes = f"{first.notes or ''} {note}".strip()
        second.notes = (
            f"{second.notes or ''} Vertical shuffle swapped with {first.duty_date.isoformat()} "
            f"{first.duty_type} to reduce same-unit clustering."
        ).strip()
        events.append(
            create_event(
                run=run,
                unit=second_unit,
                day=first.duty_date,
                rule=rules_by_key[first.duty_type],
                action=ACTION_SHUFFLED,
                severity="info",
                reason="Conservative vertical shuffle applied without reducing available-member safety.",
                details={
                    "swapped_with_date": second.duty_date.isoformat(),
                    "swapped_with_unit": str(first_unit.id),
                    "pattern_score_improvement": improvement,
                    "available_after_slot": after_first["available_after_slot"],
                    "unavailable_percent": after_first["unavailable_percent"],
                },
            )
        )
        events.append(
            create_event(
                run=run,
                unit=first_unit,
                day=second.duty_date,
                rule=rules_by_key[second.duty_type],
                action=ACTION_SHUFFLED,
                severity="info",
                reason="Conservative vertical shuffle applied without reducing available-member safety.",
                details={
                    "swapped_with_date": first.duty_date.isoformat(),
                    "swapped_with_unit": str(second_unit.id),
                    "pattern_score_improvement": improvement,
                    "available_after_slot": after_second["available_after_slot"],
                    "unavailable_percent": after_second["unavailable_percent"],
                },
            )
        )
        applied += 1
        current_score -= improvement

    return applied, events


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
    unit_group_counts: dict[tuple[UUID, str], int],
    unit_call_counts: dict[tuple[UUID, str], int],
    unit_group_call_counts: dict[tuple[UUID, str], int],
    unit_week_counts: dict[tuple[UUID, tuple[int, int]], int],
    unit_week_group_counts: dict[tuple[UUID, tuple[int, int], str], int],
    unit_weekend_counts: dict[UUID, int],
    unit_weekend_day_counts: dict[tuple[UUID, int], int],
    unit_weekend_group_counts: dict[tuple[UUID, str], int],
    unit_forced_counts: dict[UUID, int],
    provisional_unit_day_counts: dict[tuple[UUID, date], int],
    provisional_post_24hr_counts: dict[tuple[UUID, date, str | None], int],
    allocation_fairness_policy: str,
    numeric_selector=None,
) -> tuple[UnitAllocation | None, list[UnitAllocation]]:
    """Pick the unit that should own one (day, duty) slot.

    Every applicable unit gets a pressure assessment and a fairness snapshot. Selection is
    lexicographic: weekend spread first (on weekends), then the largest target deficits
    (total -> family+call -> family -> exact duty -> call), then the smallest overages, then
    week/weekend clustering, then the legacy ``allocation_score``. Hard-blocked units are only
    used when every unit is hard-blocked ("forced minimal-damage allocation").

    Returns ``(selected, all_candidates)``; ``selected`` is None when no unit applies.
    """
    allocations: list[UnitAllocation] = []
    allocation_fairness_policy = normalize_allocation_fairness_policy(allocation_fairness_policy)
    required_calls = required_calls_for_rule(rule) or None
    group = duty_group_for_rule(rule, rule.key)
    call_bucket = required_call_bucket_for_rule(rule, rule.key)
    group_call = group_call_bucket(group, call_bucket)
    unit_total_active_counts: dict[UUID, int] = {}
    unit_bucket_active_counts: dict[UUID, int] = {}
    for unit in units:
        if not rule_applies_to_unit(rule, unit):
            continue
        label = slot_label(unit)
        if (day, rule.key, label) in existing_keys:
            continue
        total_member_ids = active_unit_member_ids(postings, unit.id, day)
        bucket_member_ids = (
            active_unit_member_ids(postings, unit.id, day, call_level=required_calls)
            if required_calls
            else total_member_ids
        )
        unit_total_active_counts[unit.id] = len(total_member_ids)
        unit_bucket_active_counts[unit.id] = len(bucket_member_ids)
        pressure = pressure_for_slot(
            unit_member_ids=bucket_member_ids,
            day_leaves=day_leaves,
            rule=rule,
            rules=rules,
            provisional_unit_day_duties=provisional_unit_day_counts.get((unit.id, day), 0),
            provisional_post_24hr_duties=post_24hr_rest_count(
                provisional_post_24hr_counts,
                unit.id,
                day,
                required_calls,
            ),
            minimum_free_people=unit_minimum_free_people_for_call(unit, required_calls, rules),
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
                fairness={},
            )
        )
    if not allocations:
        return None, []
    safe_allocations = [allocation for allocation in allocations if not allocation.hard_blocked]
    is_weekend = day.weekday() >= 5
    comparison_allocations = safe_allocations if safe_allocations else allocations
    comparison_unit_ids = [allocation.unit.id for allocation in comparison_allocations]
    comparison_units = len(comparison_unit_ids)
    total_target_weights = allocation_target_weights(
        policy=allocation_fairness_policy,
        unit_ids=comparison_unit_ids,
        capacity_counts=unit_total_active_counts,
    )
    bucket_target_weights = allocation_target_weights(
        policy=allocation_fairness_policy,
        unit_ids=comparison_unit_ids,
        capacity_counts=unit_bucket_active_counts,
    )
    total_target_weight = sum(total_target_weights.values())
    bucket_target_weight = sum(bucket_target_weights.values())
    total_group_count = total_for_bucket(unit_group_counts, group)
    total_call_count = total_for_bucket(unit_call_counts, call_bucket)
    total_group_call_count = total_for_bucket(unit_group_call_counts, group_call)
    total_duty_count = total_for_bucket(unit_duty_counts, rule.key)
    total_month_count = sum(unit_month_counts.values())

    def fairness_snapshot(allocation: UnitAllocation) -> dict[str, object]:
        unit_id = allocation.unit.id
        unit_group_call_count = count_for_unit_bucket(unit_group_call_counts, unit_id, group_call)
        unit_group_count = count_for_unit_bucket(unit_group_counts, unit_id, group)
        unit_duty_count = count_for_unit_bucket(unit_duty_counts, unit_id, rule.key)
        unit_call_count = count_for_unit_bucket(unit_call_counts, unit_id, call_bucket)
        unit_total_count = unit_month_counts.get(unit_id, 0)
        unit_total_weight = total_target_weights.get(unit_id, 0)
        unit_bucket_weight = bucket_target_weights.get(unit_id, 0)
        group_call_overage = weighted_overage_after_assignment(
            current_count=unit_group_call_count,
            total_bucket_count=total_group_call_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        group_overage = weighted_overage_after_assignment(
            current_count=unit_group_count,
            total_bucket_count=total_group_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        exact_duty_overage = weighted_overage_after_assignment(
            current_count=unit_duty_count,
            total_bucket_count=total_duty_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        call_overage = weighted_overage_after_assignment(
            current_count=unit_call_count,
            total_bucket_count=total_call_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        total_overage = weighted_overage_after_assignment(
            current_count=unit_total_count,
            total_bucket_count=total_month_count,
            unit_weight=unit_total_weight,
            total_weight=total_target_weight,
        )
        group_call_deficit = weighted_target_deficit_before_assignment(
            current_count=unit_group_call_count,
            total_bucket_count=total_group_call_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        group_deficit = weighted_target_deficit_before_assignment(
            current_count=unit_group_count,
            total_bucket_count=total_group_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        exact_duty_deficit = weighted_target_deficit_before_assignment(
            current_count=unit_duty_count,
            total_bucket_count=total_duty_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        call_deficit = weighted_target_deficit_before_assignment(
            current_count=unit_call_count,
            total_bucket_count=total_call_count,
            unit_weight=unit_bucket_weight,
            total_weight=bucket_target_weight,
        )
        total_deficit = weighted_target_deficit_before_assignment(
            current_count=unit_total_count,
            total_bucket_count=total_month_count,
            unit_weight=unit_total_weight,
            total_weight=total_target_weight,
        )
        week_group_count = unit_week_group_counts.get((unit_id, week_key(day), group), 0)
        weekend_group_count = unit_weekend_group_counts.get((unit_id, group), 0) if is_weekend else 0
        return {
            "duty_group": group,
            "call_bucket": call_bucket,
            "group_call_bucket": group_call,
            "comparison_units": comparison_units,
            "allocation_fairness_policy": allocation_fairness_policy,
            "unit_total_active_people": unit_total_active_counts.get(unit_id, 0),
            "unit_bucket_active_people": unit_bucket_active_counts.get(unit_id, 0),
            "unit_total_target_weight": unit_total_weight,
            "unit_bucket_target_weight": unit_bucket_weight,
            "total_target_weight": total_target_weight,
            "bucket_target_weight": bucket_target_weight,
            "unit_group_call_count": unit_group_call_count,
            "unit_group_count": unit_group_count,
            "unit_duty_count": unit_duty_count,
            "unit_call_count": unit_call_count,
            "unit_total_count": unit_total_count,
            "group_call_target_deficit": group_call_deficit,
            "group_target_deficit": group_deficit,
            "exact_duty_target_deficit": exact_duty_deficit,
            "call_target_deficit": call_deficit,
            "total_target_deficit": total_deficit,
            "group_call_overage": group_call_overage,
            "group_overage": group_overage,
            "exact_duty_overage": exact_duty_overage,
            "call_overage": call_overage,
            "total_overage": total_overage,
            "week_group_count": week_group_count,
            "weekend_group_count": weekend_group_count,
            "starvation_rescue_candidate": bool(
                (unit_group_count == 0 and total_group_count >= comparison_units)
                or (unit_group_call_count == 0 and total_group_call_count >= comparison_units)
            ),
        }

    for allocation in allocations:
        allocation.fairness = fairness_snapshot(allocation)

    def fairness_key(allocation: UnitAllocation) -> tuple[int, int, int, int, int, int, int, int, int, int, int, int, int]:
        fairness = allocation.fairness
        return (
            -int(fairness["total_target_deficit"]),
            -int(fairness["group_call_target_deficit"]),
            -int(fairness["group_target_deficit"]),
            -int(fairness["exact_duty_target_deficit"]),
            -int(fairness["call_target_deficit"]),
            int(fairness["total_overage"]),
            int(fairness["group_call_overage"]),
            int(fairness["group_overage"]),
            int(fairness["exact_duty_overage"]),
            int(fairness["call_overage"]),
            int(fairness["weekend_group_count"]),
            int(fairness["week_group_count"]),
            allocation.score,
        )

    def numeric_choice(pool, key):
        ordered = sorted(pool, key=lambda allocation: (allocation.unit.name, str(allocation.unit.id)))
        keys = [key(allocation) for allocation in ordered]
        expected = min(range(len(ordered)), key=lambda i: (keys[i], i))
        if numeric_selector is None:
            return ordered[expected]
        selected_index = numeric_selector([list(k) for k in keys], list(range(len(ordered))))
        if type(selected_index) is not int or selected_index != expected:
            raise ValueError("Numeric allocation disagreed with canonical template fairness")
        return ordered[selected_index]

    if safe_allocations:
        selected = min(
            safe_allocations,
            key=lambda allocation: (
                unit_weekend_day_counts.get((allocation.unit.id, day.weekday()), 0) if is_weekend else 0,
                unit_weekend_counts.get(allocation.unit.id, 0) if is_weekend else 0,
                *fairness_key(allocation),
                allocation.unit.name,
            ),
        )
        selected = numeric_choice(safe_allocations, lambda allocation: (
                unit_weekend_day_counts.get((allocation.unit.id, day.weekday()), 0) if is_weekend else 0,
                unit_weekend_counts.get(allocation.unit.id, 0) if is_weekend else 0,
                *fairness_key(allocation),
        ))
        return selected, allocations

    selected = min(
        allocations,
        key=lambda allocation: (
            forced_damage_score(allocation)[0],
            unit_weekend_day_counts.get((allocation.unit.id, day.weekday()), 0) if is_weekend else 0,
            unit_weekend_counts.get(allocation.unit.id, 0) if is_weekend else 0,
            unit_forced_counts.get(allocation.unit.id, 0),
            *fairness_key(allocation),
            forced_damage_score(allocation)[1:],
            allocation.unit.name,
        ),
    )
    selected = numeric_choice(allocations, lambda allocation: (
            forced_damage_score(allocation)[0],
            unit_weekend_day_counts.get((allocation.unit.id, day.weekday()), 0) if is_weekend else 0,
            unit_weekend_counts.get(allocation.unit.id, 0) if is_weekend else 0,
            unit_forced_counts.get(allocation.unit.id, 0), *fairness_key(allocation),
            *forced_damage_score(allocation)[1:],
    ))
    return selected, allocations


def generate_empty_template(
    db: Session,
    month: str,
    options: TemplateGenerationOptions | None = None,
    *, commit: bool = True, numeric_selector=None,
) -> dict[str, object]:
    """Create (and unit-allocate) the month's template slots; see the module docstring.

    KNOWN ISSUES: there is no check that the period is already published (handbook B1);
    with ``replace_existing=False`` a second run can add another slot for the same day and
    duty in a different unit, because existing slots are matched per unit label (B7).
    """
    options = options or TemplateGenerationOptions()
    planning_started = perf_counter()
    options.allocation_fairness_policy = normalize_allocation_fairness_policy(
        options.allocation_fairness_policy
    )
    period, scope = monthly_setup(db, month)
    if period.status.lower() != "draft":
        raise ValueError("Only an unpublished draft month can generate a template")
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
            "duty_ordering": "rotated_by_family_per_day",
            "allocation_fairness_policy": options.allocation_fairness_policy,
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
    unit_group_counts: dict[tuple[UUID, str], int] = {}
    unit_call_counts: dict[tuple[UUID, str], int] = {}
    unit_group_call_counts: dict[tuple[UUID, str], int] = {}
    unit_week_counts: dict[tuple[UUID, tuple[int, int]], int] = {}
    unit_week_group_counts: dict[tuple[UUID, tuple[int, int], str], int] = {}
    unit_weekend_counts: dict[UUID, int] = {}
    unit_weekend_day_counts: dict[tuple[UUID, int], int] = {}
    unit_weekend_group_counts: dict[tuple[UUID, str], int] = {}
    unit_forced_counts: dict[UUID, int] = {}
    provisional_unit_day_counts: dict[tuple[UUID, date], int] = {}
    provisional_post_24hr_counts: dict[tuple[UUID, date, str | None], int] = {}
    for slot in existing_slots:
        if slot.unit_id is None:
            continue
        slot_rule = rules.duty_rules_by_key.get(slot.duty_type)
        slot_group = duty_group_for_rule(slot_rule, slot.duty_type)
        slot_call = required_call_bucket_for_slot(slot, slot_rule)
        slot_group_call = group_call_bucket(slot_group, slot_call)
        if is_forced_allocation_slot(slot):
            unit_forced_counts[slot.unit_id] = unit_forced_counts.get(slot.unit_id, 0) + 1
        unit_month_counts[slot.unit_id] = unit_month_counts.get(slot.unit_id, 0) + 1
        unit_duty_counts[(slot.unit_id, slot.duty_type)] = (
            unit_duty_counts.get((slot.unit_id, slot.duty_type), 0) + 1
        )
        unit_group_counts[(slot.unit_id, slot_group)] = (
            unit_group_counts.get((slot.unit_id, slot_group), 0) + 1
        )
        unit_call_counts[(slot.unit_id, slot_call)] = (
            unit_call_counts.get((slot.unit_id, slot_call), 0) + 1
        )
        unit_group_call_counts[(slot.unit_id, slot_group_call)] = (
            unit_group_call_counts.get((slot.unit_id, slot_group_call), 0) + 1
        )
        unit_week_counts[(slot.unit_id, week_key(slot.duty_date))] = (
            unit_week_counts.get((slot.unit_id, week_key(slot.duty_date)), 0) + 1
        )
        unit_week_group_counts[(slot.unit_id, week_key(slot.duty_date), slot_group)] = (
            unit_week_group_counts.get((slot.unit_id, week_key(slot.duty_date), slot_group), 0) + 1
        )
        if slot.duty_date.weekday() >= 5:
            unit_weekend_counts[slot.unit_id] = unit_weekend_counts.get(slot.unit_id, 0) + 1
            weekend_day_key = (slot.unit_id, slot.duty_date.weekday())
            unit_weekend_day_counts[weekend_day_key] = (
                unit_weekend_day_counts.get(weekend_day_key, 0) + 1
            )
            unit_weekend_group_counts[(slot.unit_id, slot_group)] = (
                unit_weekend_group_counts.get((slot.unit_id, slot_group), 0) + 1
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
    existing_duties={(slot.duty_date,slot.duty_type) for slot in existing_slots}

    for day in days:
        day_leaves = leaves.get(day, {})
        for rule in duty_rules_for_day(duties, day, days[0]):
            if (day,rule.key) in existing_duties:
                continue
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
                unit_group_counts=unit_group_counts,
                unit_call_counts=unit_call_counts,
                unit_group_call_counts=unit_group_call_counts,
                unit_week_counts=unit_week_counts,
                unit_week_group_counts=unit_week_group_counts,
                unit_weekend_counts=unit_weekend_counts,
                unit_weekend_day_counts=unit_weekend_day_counts,
                unit_weekend_group_counts=unit_weekend_group_counts,
                unit_forced_counts=unit_forced_counts,
                provisional_unit_day_counts=provisional_unit_day_counts,
                provisional_post_24hr_counts=provisional_post_24hr_counts,
                allocation_fairness_policy=options.allocation_fairness_policy,
                numeric_selector=numeric_selector,
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
            forced_allocation = hard_block

            unit = selected.unit
            label = slot_label(unit)
            starts_at, ends_at = slot_bounds(day, rule)
            status = NEEDS_REVIEW if hard_block or warning else READY
            reason = (
                f"{FORCED_ALLOCATION_REASON_PREFIX}: all candidate units were hard blocked; "
                f"{unit.name} was selected as the least damaging and fairest unit. {selected.reason}"
                if forced_allocation
                else selected.reason
            )
            # New templates only (contract 21 Oct 2026): stamp the slot with the duty's single
            # effective call level; a multi-level duty (e.g. groups of 3rd and 4th call) gets
            # no call level, so eligibility follows the rule rather than the duty's name.
            slot_call_level = required_call_for_rule(rule)
            slot_group = duty_group_for_rule(rule, rule.key)
            slot_call = slot_call_level or required_call_bucket_for_rule(rule, rule.key)
            slot_group_call = group_call_bucket(slot_group, slot_call)
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
                notes=(
                    f"{rule.label} forced to {unit.name}. {reason}"
                    if forced_allocation
                    else f"{rule.label} generated for {unit.name}. {reason}"
                ),
            )
            db.add(slot)
            created_slots.append(slot)
            existing_keys.add((day, rule.key, label))
            unit_month_counts[unit.id] = unit_month_counts.get(unit.id, 0) + 1
            unit_duty_counts[(unit.id, rule.key)] = (
                unit_duty_counts.get((unit.id, rule.key), 0) + 1
            )
            unit_group_counts[(unit.id, slot_group)] = (
                unit_group_counts.get((unit.id, slot_group), 0) + 1
            )
            unit_call_counts[(unit.id, slot_call)] = (
                unit_call_counts.get((unit.id, slot_call), 0) + 1
            )
            unit_group_call_counts[(unit.id, slot_group_call)] = (
                unit_group_call_counts.get((unit.id, slot_group_call), 0) + 1
            )
            unit_week_counts[(unit.id, week_key(day))] = (
                unit_week_counts.get((unit.id, week_key(day)), 0) + 1
            )
            unit_week_group_counts[(unit.id, week_key(day), slot_group)] = (
                unit_week_group_counts.get((unit.id, week_key(day), slot_group), 0) + 1
            )
            if day.weekday() >= 5:
                unit_weekend_counts[unit.id] = unit_weekend_counts.get(unit.id, 0) + 1
                weekend_day_key = (unit.id, day.weekday())
                unit_weekend_day_counts[weekend_day_key] = (
                    unit_weekend_day_counts.get(weekend_day_key, 0) + 1
                )
                unit_weekend_group_counts[(unit.id, slot_group)] = (
                    unit_weekend_group_counts.get((unit.id, slot_group), 0) + 1
                )
            if forced_allocation:
                unit_forced_counts[unit.id] = unit_forced_counts.get(unit.id, 0) + 1
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
                    action=ACTION_FORCED if forced_allocation else ACTION_CREATED,
                    severity="warning" if forced_allocation else str(selected.pressure["severity"]),
                    reason=reason,
                    details={
                        **selected.pressure,
                        **selected.fairness,
                        "template_status": status,
                        "allocation_mode": FORCED_ALLOCATION_MODE if forced_allocation else "balanced",
                        "allocation_score": selected.score,
                        "forced_damage_score": list(forced_damage_score(selected)) if forced_allocation else None,
                        "forced_count_after": unit_forced_counts.get(unit.id, 0),
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
                        "unit_group_count_after": unit_group_counts[(unit.id, slot_group)],
                        "unit_call_count_after": unit_call_counts[(unit.id, slot_call)],
                        "unit_group_call_count_after": unit_group_call_counts[(unit.id, slot_group_call)],
                    },
                )
            )
            if forced_allocation:
                for allocation in allocations:
                    events.append(
                        create_event(
                            run=run,
                            unit=allocation.unit,
                            day=day,
                            rule=rule,
                            action=ACTION_BLOCKED,
                            severity="error",
                            reason=(
                                "Forced allocation audit: this unit was hard blocked before "
                                f"least-damage fallback was applied. {allocation.reason}"
                            ),
                            details={
                                **allocation.pressure,
                                **allocation.fairness,
                                "template_status": status,
                                "allocation_mode": FORCED_ALLOCATION_MODE,
                                "allocation_score": allocation.score,
                                "forced_damage_score": list(forced_damage_score(allocation)),
                                "selected_unit": str(unit.id),
                                "selected_unit_name": unit.name,
                            },
                        )
                    )
                continue
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
                            **allocation.fairness,
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
    db.flush()
    allocation_finished = perf_counter()
    vertical_shuffle_swaps, shuffle_events = optimize_template_slot_layout(
        run=run,
        created_slots=created_slots,
        existing_slots=existing_slots,
        units=units,
        rules=rules,
        postings=postings,
        leaves=leaves,
    )
    for event in shuffle_events:
        db.add(event)
    events.extend(shuffle_events)
    run.created_slots = len(created_slots)
    run.needs_review_slots = sum(1 for slot in created_slots if slot.template_status == NEEDS_REVIEW)
    unresolved_slots = sum(1 for slot in created_slots if slot.template_status == UNRESOLVED)
    forced_slots = sum(1 for slot in created_slots if is_forced_allocation_slot(slot))
    run.skipped_slots = sum(1 for event in events if event.action == ACTION_SKIPPED)
    run.blocked_slots = sum(1 for event in events if event.action == ACTION_BLOCKED)
    run.summary = {
        **run.summary,
        "created_slots": run.created_slots,
        "needs_review_slots": run.needs_review_slots,
        "unresolved_slots": unresolved_slots,
        "forced_review_slots": forced_slots,
        "skipped_slots": run.skipped_slots,
        "blocked_slots": run.blocked_slots,
        "vertical_shuffle_swaps": vertical_shuffle_swaps,
        "stage_timings_ms":{"allocation":round((allocation_finished-planning_started)*1000,2),
                            "layout_refinement":round((perf_counter()-allocation_finished)*1000,2)},
        "layout_engine":"server: stateful safety checks; bounded conservative swaps",
    }
    if commit:
        db.commit()
    else:
        db.flush()
    db.refresh(run)
    return template_month(db, month, run.id)


def clear_template_cache(db: Session, month: str, *, clear_assignments: bool = False) -> dict[str, object]:
    """Delete the month's generated slots and generation history (and, if requested, their
    assignments). Not blocked for published months (handbook B1)."""
    period, _scope = monthly_setup(db, month)
    if period.status.lower() != "draft":
        raise ValueError("Only an unpublished draft month can clear a template")
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
            "forced_review_slots": sum(1 for slot in slots if is_forced_allocation_slot(slot)),
            "status_counts": status_counts,
        },
        "latest_run": run_to_dict(run) if run else None,
        "slots": [slot_to_dict(slot, rules.duty_rules_by_key.get(slot.duty_type)) for slot in slots],
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
            "forced_review_slots": 0,
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
        "forced_review_slots": 0,
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
    unit_group_counts: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    unit_group_call_counts: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    call_level_counts: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    active_people_by_unit: dict[str, set[UUID]] = {unit_key: set() for unit_key in unit_rows}
    active_call_counts_by_unit: dict[str, Counter[str]] = {unit_key: Counter() for unit_key in unit_rows}
    date_rows: dict[date, dict[str, object]] = {}
    duty_group_labels: dict[str, str] = {}
    group_call_labels: dict[str, dict[str, str]] = {}

    for posting in postings_for_month(db, period.starts_on, period.ends_on):
        if posting.unit_id is None or posting.person.active_status != "active":
            continue
        unit_key = str(posting.unit_id)
        if unit_key not in active_people_by_unit:
            continue
        active_people_by_unit[unit_key].add(posting.person_id)
        active_call_counts_by_unit[unit_key][normalize_call_level(posting.posting_type)] += 1

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
                "forced_review_slots": 0,
                "unresolved_slots": 0,
                "weekday_slots": 0,
                "saturday_slots": 0,
                "sunday_slots": 0,
                "weekend_slots": 0,
                "twenty_four_hour_slots": 0,
                "non_24hr_slots": 0,
            }
            unit_duty_counts[unit_key] = Counter()
            unit_group_counts[unit_key] = Counter()
            unit_group_call_counts[unit_key] = Counter()
            call_level_counts[unit_key] = Counter()
            active_people_by_unit[unit_key] = set()
            active_call_counts_by_unit[unit_key] = Counter()

        row = unit_rows[unit_key]
        row["total_slots"] = int(row["total_slots"]) + 1
        forced_slot = is_forced_allocation_slot(slot)
        if slot.template_status == READY:
            row["ready_slots"] = int(row["ready_slots"]) + 1
        elif slot.template_status == NEEDS_REVIEW:
            row["needs_review_slots"] = int(row["needs_review_slots"]) + 1
            if forced_slot:
                row["forced_review_slots"] = int(row["forced_review_slots"]) + 1
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
        rule = rule_by_key.get(slot.duty_type)
        group = duty_group_for_rule(rule, slot.duty_type)
        call_level = required_call_bucket_for_slot(slot, rule)
        group_call = group_call_bucket(group, call_level)
        duty_group_labels.setdefault(group, group.replace("_", " ").title())
        group_call_labels.setdefault(
            group_call,
            {
                "key": group_call,
                "group": group,
                "call_level": call_level,
                "label": f"{duty_group_labels[group]} / {CALL_WISE_SHEET_LABELS.get(call_level, call_level.replace('_', ' ').title())}",
            },
        )
        unit_group_counts[unit_key][group] += 1
        unit_group_call_counts[unit_key][group_call] += 1
        call_level_counts[unit_key][call_level] += 1

        date_row = date_rows.setdefault(
            slot.duty_date,
            {
                "date": slot.duty_date.isoformat(),
                "day_name": slot.duty_date.strftime("%A"),
                "total_slots": 0,
                "ready_slots": 0,
                "needs_review_slots": 0,
                "forced_review_slots": 0,
                "unresolved_slots": 0,
                "unit_counts": {},
            },
        )
        date_row["total_slots"] = int(date_row["total_slots"]) + 1
        if slot.template_status == READY:
            date_row["ready_slots"] = int(date_row["ready_slots"]) + 1
        elif slot.template_status == NEEDS_REVIEW:
            date_row["needs_review_slots"] = int(date_row["needs_review_slots"]) + 1
            if forced_slot:
                date_row["forced_review_slots"] = int(date_row["forced_review_slots"]) + 1
        elif slot.template_status == UNRESOLVED:
            date_row["unresolved_slots"] = int(date_row["unresolved_slots"]) + 1
        unit_counts = date_row["unit_counts"]
        if isinstance(unit_counts, dict):
            unit_counts[unit_key] = int(unit_counts.get(unit_key, 0)) + 1

    unit_event_diagnostics: dict[str, dict[str, object]] = {
        unit_key: {
            "unit_id": None if unit_key == "unresolved" else unit_key,
            "unit_name": str(row["unit_name"]),
            "is_unresolved": bool(row["is_unresolved"]),
            "active_people": len(active_people_by_unit.get(unit_key, set())),
            "active_call_counts": dict(active_call_counts_by_unit.get(unit_key, Counter())),
            "created_events": 0,
            "forced_events": 0,
            "blocked_events": 0,
            "skipped_warning_events": 0,
            "skipped_info_events": 0,
            "blocked_by_group": {},
            "skipped_by_group": {},
        }
        for unit_key, row in unit_rows.items()
    }
    event_rows = []
    if run:
        for event in sorted(run.events, key=lambda item: item.created_at):
            unit_key = str(event.unit_id) if event.unit_id else "unresolved"
            if unit_key in unit_event_diagnostics:
                diagnostic = unit_event_diagnostics[unit_key]
                duty_group = "unknown"
                if event.duty_type:
                    duty_group = duty_group_for_rule(rule_by_key.get(event.duty_type), event.duty_type)
                if event.action == ACTION_CREATED:
                    diagnostic["created_events"] = int(diagnostic["created_events"]) + 1
                elif event.action == ACTION_FORCED:
                    diagnostic["forced_events"] = int(diagnostic["forced_events"]) + 1
                elif event.action == ACTION_BLOCKED:
                    diagnostic["blocked_events"] = int(diagnostic["blocked_events"]) + 1
                    blocked_by_group = diagnostic["blocked_by_group"]
                    if isinstance(blocked_by_group, dict):
                        blocked_by_group[duty_group] = int(blocked_by_group.get(duty_group, 0)) + 1
                elif event.action == ACTION_SKIPPED:
                    if event.severity == "warning":
                        diagnostic["skipped_warning_events"] = int(diagnostic["skipped_warning_events"]) + 1
                    else:
                        diagnostic["skipped_info_events"] = int(diagnostic["skipped_info_events"]) + 1
                    skipped_by_group = diagnostic["skipped_by_group"]
                    if isinstance(skipped_by_group, dict):
                        skipped_by_group[duty_group] = int(skipped_by_group.get(duty_group, 0)) + 1
            if event.action in {ACTION_BLOCKED, ACTION_SKIPPED, ACTION_FORCED} or str(event.details.get("template_status")) == UNRESOLVED:
                event_rows.append(event_to_dict(event))

    raw_allocation_policy = (run.summary or {}).get("allocation_fairness_policy") if run else None
    allocation_policy = normalize_allocation_fairness_policy(
        raw_allocation_policy if isinstance(raw_allocation_policy, str) else None
    )
    target_unit_keys = [
        key for key, row in unit_rows.items() if not bool(row["is_unresolved"])
    ]
    target_unit_ids = [UUID(key) for key in target_unit_keys]
    active_people_counts = {
        UUID(key): len(active_people_by_unit.get(key, set()))
        for key in target_unit_keys
    }
    total_target_weights = allocation_target_weights(
        policy=allocation_policy,
        unit_ids=target_unit_ids,
        capacity_counts=active_people_counts,
    )
    total_weight = sum(total_target_weights.values())
    total_slots = len(slots)

    def target_slots_for_unit(unit_key: str) -> float:
        if total_weight <= 0 or unit_key == "unresolved":
            return 0.0
        return round(total_slots * total_target_weights.get(UUID(unit_key), 0) / total_weight, 1)

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
            "forced_review_slots": sum(1 for slot in slots if is_forced_allocation_slot(slot)),
            "unresolved_slots": sum(1 for slot in slots if slot.template_status == UNRESOLVED),
            "included_units": len(included_units),
            "units_used": sum(1 for row in unit_rows.values() if int(row["total_slots"]) > 0 and not row["is_unresolved"]),
            "blocked_or_skipped_events": len(event_rows),
        },
        "duty_keys": [
            {"key": key, "label": rule_by_key[key].label if key in rule_by_key else key}
            for key in duty_keys
        ],
        "duty_groups": [
            {"key": key, "label": duty_group_labels[key]}
            for key in sorted(duty_group_labels)
        ],
        "group_call_buckets": [
            group_call_labels[key]
            for key in sorted(
                group_call_labels,
                key=lambda item: (
                    str(group_call_labels[item]["group"]),
                    rota_call_sort_key(str(group_call_labels[item]["call_level"])),
                    item,
                ),
            )
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
        "unit_group_matrix": [
            {
                "unit_id": None if unit_key == "unresolved" else unit_key,
                "unit_name": str(unit_rows[unit_key]["unit_name"]),
                "is_unresolved": bool(unit_rows[unit_key]["is_unresolved"]),
                "counts": {key: unit_group_counts.get(unit_key, Counter()).get(key, 0) for key in sorted(duty_group_labels)},
                "total_slots": int(unit_rows[unit_key]["total_slots"]),
            }
            for unit_key in sorted(unit_rows, key=lambda key: (key == "unresolved", str(unit_rows[key]["unit_name"])))
        ],
        "unit_group_call_matrix": [
            {
                "unit_id": None if unit_key == "unresolved" else unit_key,
                "unit_name": str(unit_rows[unit_key]["unit_name"]),
                "is_unresolved": bool(unit_rows[unit_key]["is_unresolved"]),
                "counts": {key: unit_group_call_counts.get(unit_key, Counter()).get(key, 0) for key in sorted(group_call_labels)},
                "total_slots": int(unit_rows[unit_key]["total_slots"]),
            }
            for unit_key in sorted(unit_rows, key=lambda key: (key == "unresolved", str(unit_rows[key]["unit_name"])))
        ],
        "unit_target_tallies": [
            {
                "unit_id": None if unit_key == "unresolved" else unit_key,
                "unit_name": str(unit_rows[unit_key]["unit_name"]),
                "is_unresolved": bool(unit_rows[unit_key]["is_unresolved"]),
                "allocation_fairness_policy": allocation_policy,
                "active_people": len(active_people_by_unit.get(unit_key, set())),
                "target_weight": 0 if unit_key == "unresolved" else total_target_weights.get(UUID(unit_key), 0),
                "target_slots": target_slots_for_unit(unit_key),
                "actual_slots": int(unit_rows[unit_key]["total_slots"]),
                "difference": round(int(unit_rows[unit_key]["total_slots"]) - target_slots_for_unit(unit_key), 1),
            }
            for unit_key in sorted(unit_rows, key=lambda key: (key == "unresolved", str(unit_rows[key]["unit_name"])))
        ],
        "unit_generation_diagnostics": [
            unit_event_diagnostics[unit_key]
            for unit_key in sorted(unit_event_diagnostics, key=lambda key: (key == "unresolved", str(unit_event_diagnostics[key]["unit_name"])))
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


def slot_to_dict(slot: DutySlot, rule: DutyRule | None = None) -> dict[str, object]:
    unit_assignment_label = display_unit_for_slot(slot.unit, rule)
    return {
        "id": str(slot.id),
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "unit_assignment_label": unit_assignment_label or None,
        "unit_cluster_suffix": cluster_suffix_for_rule(rule),
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
        "is_forced_allocation": is_forced_allocation_slot(slot),
        "template_reason": slot.template_reason,
        "assignments": [
            {
                "id": str(assignment.id),
                "person_id": str(assignment.person_id),
                "person_name": assignment.person.canonical_name,
                "call_level": call_level_on(assignment.person, slot.duty_date),
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


CLUSTER_UNIT_SUFFIXES = {
    "3rd_call_a": "3A",
    "3rd_call_b": "3B",
    "3rd_call_c": "3C",
}


def cluster_suffix_for_rule(rule: DutyRule | None) -> str | None:
    if rule is None or len(rule.allowed_cluster_keys) != 1:
        return None
    return CLUSTER_UNIT_SUFFIXES.get(rule.allowed_cluster_keys[0])


def display_unit_for_slot(unit: Unit | None, rule: DutyRule | None = None) -> str:
    unit_label = display_unit_for_eagle_eye(unit)
    suffix = cluster_suffix_for_rule(rule)
    if unit_label and suffix:
        return f"{unit_label} ({suffix})"
    return unit_label


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


def rota_call_sort_key(call_level: str) -> int:
    return CALL_WISE_ORDER.index(call_level) if call_level in CALL_WISE_ORDER else 99


def call_wise_sheet_name(call_level: str) -> str:
    return CALL_WISE_SHEET_LABELS.get(call_level, call_level.replace("_", " ").title())[:31]


def call_levels_for_export_rule(rule: DutyRule | None, duty_key: str) -> set[str]:
    if rule is not None:
        values = effective_call_levels(rule)
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
                display_unit_for_slot(slot.unit, rule_by_key.get(slot.duty_type)),
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
            unit_name = display_unit_for_slot(slot.unit, rule_by_key.get(slot.duty_type))
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
        unit_name = display_unit_for_slot(slot.unit, rule_by_key.get(slot.duty_type))
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
