from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import floor
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutyAssignment, DutySlot, Person
from app.services.leave import month_bounds
from app.services.rota_assignment import (
    active_assignment,
    campus_for_slot,
    hydrate_slot,
    rule_group_for_slot,
    slot_month,
    validate_assignment,
)
from app.services.rota_rules import RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_safety import (
    SAFETY_HARD_BLOCK,
    SAFETY_WARNING,
    assignment_indexes,
    assignments_for_month,
    leaves_by_day_and_person,
    postings_for_month,
    slot_safety,
)
from app.services.rota_setup import monthly_setup
from app.services.rota_template import PHASE4_SLOT_SOURCE

CANDIDATE_ELIGIBLE = "eligible"
CANDIDATE_REVIEW = "needs_review"
CANDIDATE_BLOCKED = "blocked"


@dataclass
class CandidateContext:
    month: str
    starts_on: object
    ends_on: object
    rules: RotaPhaseOneRules
    postings: list
    leaves: dict
    assignments: list[DutyAssignment]
    same_day_assignments: dict
    previous_day_assignments: dict
    assignments_by_person: dict[UUID, list[DutyAssignment]]
    average_assignments: float


def candidate_context(db: Session, month: str) -> CandidateContext:
    starts_on, ends_on = month_bounds(month)
    _rule_version, rules = get_phase_one_rules(db)
    postings = postings_for_month(db, starts_on, ends_on)
    leaves = leaves_by_day_and_person(db, month)
    assignments = assignments_for_month(db, starts_on, ends_on)
    same_day_assignments, previous_day_assignments = assignment_indexes(assignments, rules)
    assignments_by_person: dict[UUID, list[DutyAssignment]] = defaultdict(list)
    for assignment in assignments:
        if active_assignment(assignment):
            assignments_by_person[assignment.person_id].append(assignment)
    average = (
        sum(len(items) for items in assignments_by_person.values()) / len(assignments_by_person)
        if assignments_by_person
        else 0.0
    )
    return CandidateContext(
        month=month,
        starts_on=starts_on,
        ends_on=ends_on,
        rules=rules,
        postings=postings,
        leaves=leaves,
        assignments=assignments,
        same_day_assignments=same_day_assignments,
        previous_day_assignments=previous_day_assignments,
        assignments_by_person=assignments_by_person,
        average_assignments=average,
    )


def candidate_pool_from_safety(safety: dict[str, object]) -> list[tuple[dict[str, object], str]]:
    rows: list[tuple[dict[str, object], str]] = []
    for row in safety.get("available_people", []):
        if isinstance(row, dict):
            rows.append((row, CANDIDATE_ELIGIBLE))
    for row in safety.get("warning_people", []):
        if isinstance(row, dict):
            rows.append((row, CANDIDATE_REVIEW))
    for row in safety.get("hard_blocked_people", []):
        if isinstance(row, dict):
            rows.append((row, CANDIDATE_BLOCKED))
    seen: set[str] = set()
    unique: list[tuple[dict[str, object], str]] = []
    rank = {CANDIDATE_ELIGIBLE: 0, CANDIDATE_REVIEW: 1, CANDIDATE_BLOCKED: 2}
    for row, status in sorted(rows, key=lambda item: rank[item[1]]):
        person_id = str(row.get("person_id", ""))
        if not person_id or person_id in seen:
            continue
        seen.add(person_id)
        unique.append((row, status))
    return unique


def active_slots_for_person(assignments: list[DutyAssignment], slot: DutySlot) -> list[DutySlot]:
    return [
        assignment.duty_slot
        for assignment in assignments
        if active_assignment(assignment) and assignment.duty_slot_id != slot.id
    ]


def duty_counts(slots: list[DutySlot], target_slot: DutySlot, rules: RotaPhaseOneRules) -> dict[str, int]:
    target_group = rule_group_for_slot(target_slot, rules)
    target_campus = campus_for_slot(target_slot)
    target_is_weekend = target_slot.duty_date.weekday() >= 5
    same_day_type = sum(1 for slot in slots if (slot.duty_date.weekday() >= 5) == target_is_weekend)
    return {
        "total_assignments": len(slots),
        "target_is_weekend": int(target_is_weekend),
        "same_day_type": same_day_type,
        "weekday_assignments": sum(1 for slot in slots if slot.duty_date.weekday() < 5),
        "weekend_assignments": sum(1 for slot in slots if slot.duty_date.weekday() >= 5),
        "total_24hr": sum(1 for slot in slots if slot.is_24hr),
        "weekend_24hr": sum(1 for slot in slots if slot.is_24hr and slot.duty_date.weekday() >= 5),
        "same_group": sum(1 for slot in slots if rule_group_for_slot(slot, rules) == target_group),
        "same_campus": sum(1 for slot in slots if target_campus and campus_for_slot(slot) == target_campus),
    }


def nearest_rest_gap_hours(slots: list[DutySlot], target_slot: DutySlot) -> float | None:
    gaps: list[float] = []
    for slot in slots:
        if slot.ends_at <= target_slot.starts_at:
            gaps.append((target_slot.starts_at - slot.ends_at).total_seconds() / 3600)
        elif slot.starts_at >= target_slot.ends_at:
            gaps.append((slot.starts_at - target_slot.ends_at).total_seconds() / 3600)
        else:
            gaps.append(0)
    return min(gaps) if gaps else None


def validation_status_for_pool(pool_status: str, validation: dict[str, object]) -> str:
    issue_rows = [
        issue
        for issue in validation.get("issues", [])
        if isinstance(issue, dict)
        and issue.get("code") not in {"unit_safety_review"}
    ]
    if any(issue.get("severity") in {"blocked", "error"} for issue in issue_rows):
        return CANDIDATE_BLOCKED
    if pool_status == CANDIDATE_BLOCKED:
        return CANDIDATE_BLOCKED
    if pool_status == CANDIDATE_REVIEW or any(issue.get("severity") == "warning" for issue in issue_rows):
        return CANDIDATE_REVIEW
    return CANDIDATE_ELIGIBLE


def candidate_score(
    *,
    status: str,
    counts: dict[str, int],
    rest_gap_hours: float | None,
    average_assignments: float,
    slot_safety_status: str,
    validation: dict[str, object],
    rules: RotaPhaseOneRules,
) -> tuple[int, dict[str, int]]:
    status_penalty = {CANDIDATE_ELIGIBLE: 0, CANDIDATE_REVIEW: 35, CANDIDATE_BLOCKED: 1000}[status]
    burden_penalty = (
        counts["same_day_type"] * 30
        + counts["total_assignments"] * 6
        + counts["total_24hr"] * 10
        + counts["weekend_24hr"] * 12
        + counts["same_group"] * 5
        + counts["same_campus"] * 2
    )
    fairness_penalty = max(0, counts["total_assignments"] - floor(average_assignments)) * 7
    rest_penalty = 0
    if rest_gap_hours is not None:
        minimum_rest = rules.rest_rules.minimum_gap_after_24hr_hours
        if rest_gap_hours < minimum_rest:
            rest_penalty = 80
        elif rest_gap_hours < minimum_rest + 12:
            rest_penalty = 15
    staffing_penalty = 0
    if slot_safety_status == SAFETY_WARNING:
        staffing_penalty = 10
    elif slot_safety_status == SAFETY_HARD_BLOCK:
        staffing_penalty = 25
    validation_penalty = 20 if validation.get("requires_override") else 0
    parts = {
        "status": status_penalty,
        "same_day_type": counts["same_day_type"] * 30,
        "burden": burden_penalty,
        "weekend": counts["weekend_24hr"] * 12,
        "rest": rest_penalty,
        "staffing": staffing_penalty,
        "fairness": fairness_penalty,
        "validation": validation_penalty,
    }
    return sum(parts.values()), parts


def candidate_reasons(
    *,
    status: str,
    safety_row: dict[str, object],
    counts: dict[str, int],
    rest_gap_hours: float | None,
    average_assignments: float,
    validation: dict[str, object],
    rules: RotaPhaseOneRules,
) -> list[str]:
    reasons: list[str] = []
    if status == CANDIDATE_ELIGIBLE:
        reasons.append("No person-specific leave or rest blocker was found.")
    elif status == CANDIDATE_REVIEW:
        reasons.append("This candidate can be considered, but needs board review before assignment.")
    else:
        reasons.append("This candidate has a hard blocker and should not be used without a deliberate override.")

    for blocker in safety_row.get("blockers", []):
        if isinstance(blocker, dict) and blocker.get("label"):
            reasons.append(str(blocker["label"]))

    reasons.append(
        f"Current month load: {counts['total_assignments']} duties, {counts['total_24hr']} 24-hour, {counts['weekend_24hr']} weekend 24-hour."
    )
    target_day_text = "weekend" if counts["target_is_weekend"] else "weekday"
    reasons.append(f"Same {target_day_text} load this month: {counts['same_day_type']} duties.")
    reasons.append(f"Same duty group already assigned this month: {counts['same_group']}.")

    if rest_gap_hours is None:
        reasons.append("No saved duty assignment found nearby in this month.")
    else:
        rest_text = f"Nearest saved duty gap is {round(rest_gap_hours, 1)} hour(s)."
        if rest_gap_hours < rules.rest_rules.minimum_gap_after_24hr_hours:
            rest_text += f" This is below the configured {rules.rest_rules.minimum_gap_after_24hr_hours}-hour rest rule."
        reasons.append(rest_text)

    if counts["total_assignments"] <= average_assignments:
        reasons.append("Duty load is at or below the current assigned-member average.")
    else:
        reasons.append("Duty load is above the current assigned-member average, so fairness score is lower.")

    for row in validation.get("issues", []):
        if isinstance(row, dict) and row.get("message"):
            message = str(row["message"])
            if message not in reasons:
                reasons.append(message)
    return reasons


def candidate_to_dict(
    db: Session,
    *,
    slot: DutySlot,
    safety_row: dict[str, object],
    pool_status: str,
    context: CandidateContext,
) -> dict[str, object] | None:
    person_id = UUID(str(safety_row["person_id"]))
    person = db.get(Person, person_id)
    if person is None:
        return None
    replace_existing = any(active_assignment(assignment) for assignment in slot.assignments)
    validation = validate_assignment(db, slot=slot, person=person, replace_existing=replace_existing)
    status = validation_status_for_pool(pool_status, validation)
    person_slots = active_slots_for_person(
        context.assignments_by_person.get(person_id, []),
        slot,
    )
    counts = duty_counts(person_slots, slot, context.rules)
    rest_gap_hours = nearest_rest_gap_hours(person_slots, slot)
    score, score_parts = candidate_score(
        status=status,
        counts=counts,
        rest_gap_hours=rest_gap_hours,
        average_assignments=context.average_assignments,
        slot_safety_status=str(validation["slot_safety"]["safety_status"]),
        validation=validation,
        rules=context.rules,
    )
    return {
        "person_id": str(person.id),
        "person_name": person.canonical_name,
        "call_level": safety_row.get("call_level") or person.call_level,
        "posting_type": safety_row.get("posting_type"),
        "candidate_status": status,
        "rank_score": score,
        "score_parts": score_parts,
        "requires_override": bool(validation.get("requires_override")),
        "validation_status": validation.get("status"),
        "validation_issues": validation.get("issues", []),
        "counts": counts,
        "rest_gap_hours": None if rest_gap_hours is None else round(rest_gap_hours, 1),
        "reasons": candidate_reasons(
            status=status,
            safety_row=safety_row,
            counts=counts,
            rest_gap_hours=rest_gap_hours,
            average_assignments=context.average_assignments,
            validation=validation,
            rules=context.rules,
        ),
    }


def slot_candidates_with_context(
    db: Session,
    *,
    slot: DutySlot,
    context: CandidateContext,
    limit: int | None = None,
) -> dict[str, object]:
    safety = slot_safety(
        slot=slot,
        rules=context.rules,
        postings=context.postings,
        leaves=context.leaves,
        same_day_assignments=context.same_day_assignments,
        previous_day_assignments=context.previous_day_assignments,
    )
    candidates = [
        candidate
        for safety_row, status in candidate_pool_from_safety(safety)
        if (
            candidate := candidate_to_dict(
                db,
                slot=slot,
                safety_row=safety_row,
                pool_status=status,
                context=context,
            )
        )
        is not None
    ]
    status_order = {CANDIDATE_ELIGIBLE: 0, CANDIDATE_REVIEW: 1, CANDIDATE_BLOCKED: 2}
    candidates.sort(key=lambda item: (status_order[str(item["candidate_status"])], int(item["rank_score"]), str(item["person_name"])))
    if limit is not None:
        candidates = candidates[:limit]
    return {
        "slot_id": str(slot.id),
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "safety_status": safety["safety_status"],
        "candidates": candidates,
    }


def slot_candidates(db: Session, slot_id: UUID, limit: int | None = None) -> dict[str, object]:
    slot = hydrate_slot(db, slot_id)
    context = candidate_context(db, slot_month(slot))
    return slot_candidates_with_context(db, slot=slot, context=context, limit=limit)


def month_candidate_slots(db: Session, month: str, limit_per_slot: int = 5) -> dict[str, object]:
    period, _scope = monthly_setup(db, month)
    context = candidate_context(db, month)
    slots = list(
        db.scalars(
            select(DutySlot)
            .where(
                DutySlot.rota_period_id == period.id,
                DutySlot.source == PHASE4_SLOT_SOURCE,
            )
            .options(
                selectinload(DutySlot.unit),
                selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
            )
            .order_by(DutySlot.duty_date, DutySlot.duty_type, DutySlot.slot_label)
        )
    )
    rows = [
        slot_candidates_with_context(db, slot=slot, context=context, limit=limit_per_slot)
        for slot in slots
    ]
    all_candidates = [candidate for row in rows for candidate in row["candidates"]]
    return {
        "month": month,
        "summary": {
            "slots_checked": len(rows),
            "slots_with_candidates": sum(1 for row in rows if row["candidates"]),
            "eligible_candidates": sum(1 for item in all_candidates if item["candidate_status"] == CANDIDATE_ELIGIBLE),
            "needs_review_candidates": sum(1 for item in all_candidates if item["candidate_status"] == CANDIDATE_REVIEW),
            "blocked_candidates": sum(1 for item in all_candidates if item["candidate_status"] == CANDIDATE_BLOCKED),
        },
        "slots": rows,
    }
