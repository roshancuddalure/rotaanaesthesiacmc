from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutyAssignment, DutySlot, Person
from app.services.leave import month_bounds
from app.services.rota_rules import RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES,
    SAFETY_HARD_BLOCK,
    SAFETY_WARNING,
    assignment_indexes,
    assignments_for_month,
    leaves_by_day_and_person,
    member_call_level,
    member_contexts_for_day,
    normalize_call_level,
    postings_for_month,
    required_call_levels,
    rule_for_slot,
    slot_safety,
)

MANUAL_ASSIGNMENT_SOURCE = "manual_rota_board"


class RotaAssignmentError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        validation: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.validation = validation


def slot_month(slot: DutySlot) -> str:
    return slot.duty_date.isoformat()[:7]


def active_assignment(assignment: DutyAssignment) -> bool:
    return assignment.status.lower() in ACTIVE_ASSIGNMENT_STATUSES


def hydrate_slot(db: Session, slot_id: UUID) -> DutySlot:
    slot = db.scalars(
        select(DutySlot)
        .where(DutySlot.id == slot_id)
        .options(
            selectinload(DutySlot.unit),
            selectinload(DutySlot.rota_period),
            selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
        )
    ).first()
    if slot is None:
        raise RotaAssignmentError("Duty slot not found", status_code=404)
    return slot


def hydrate_assignment(db: Session, assignment_id: UUID) -> DutyAssignment:
    assignment = db.scalars(
        select(DutyAssignment)
        .where(DutyAssignment.id == assignment_id)
        .options(
            selectinload(DutyAssignment.person),
            selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.unit),
        )
    ).first()
    if assignment is None:
        raise RotaAssignmentError("Duty assignment not found", status_code=404)
    return assignment


def assignment_to_dict(assignment: DutyAssignment) -> dict[str, object]:
    return {
        "id": str(assignment.id),
        "slot_id": str(assignment.duty_slot_id),
        "person_id": str(assignment.person_id),
        "person_name": assignment.person.canonical_name,
        "call_level": assignment.person.call_level,
        "status": assignment.status,
        "source": assignment.source,
        "override_reason": assignment.override_reason,
        "created_at": assignment.created_at.isoformat(),
    }


def slot_safety_for_assignment(db: Session, slot: DutySlot) -> dict[str, object]:
    month = slot_month(slot)
    starts_on, ends_on = month_bounds(month)
    _rule_version, rules = get_phase_one_rules(db)
    postings = postings_for_month(db, starts_on, ends_on)
    leaves = leaves_by_day_and_person(db, month)
    assignments = assignments_for_month(db, starts_on, ends_on)
    same_day_assignments, previous_day_assignments = assignment_indexes(assignments, rules)
    return slot_safety(
        slot=slot,
        rules=rules,
        postings=postings,
        leaves=leaves,
        same_day_assignments=same_day_assignments,
        previous_day_assignments=previous_day_assignments,
    )


def selected_person_safety(
    safety: dict[str, object],
    person_id: UUID,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    target = str(person_id)
    hard_people = safety.get("hard_blocked_people", [])
    warning_people = safety.get("warning_people", [])
    hard = [
        person
        for person in hard_people
        if isinstance(person, dict) and person.get("person_id") == target
    ]
    warnings = [
        person
        for person in warning_people
        if isinstance(person, dict) and person.get("person_id") == target
    ]
    return hard, warnings


def issue(severity: str, code: str, message: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def person_month_assignments(
    db: Session,
    person_id: UUID,
    month: str,
) -> list[DutyAssignment]:
    starts_on, ends_on = month_bounds(month)
    return [
        assignment
        for assignment in db.scalars(
            select(DutyAssignment)
            .join(DutyAssignment.duty_slot)
            .where(
                DutyAssignment.person_id == person_id,
                DutySlot.duty_date >= starts_on,
                DutySlot.duty_date <= ends_on,
            )
            .options(
                selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.unit),
            )
        )
        if active_assignment(assignment)
    ]


def rule_group_for_slot(slot: DutySlot, rules: RotaPhaseOneRules) -> str:
    rule = rule_for_slot(slot, rules)
    return rule.group if rule else slot.duty_type


def campus_for_slot(slot: DutySlot) -> str | None:
    return slot.unit.campus if slot.unit else None


def duty_count_issues(
    *,
    db: Session,
    slot: DutySlot,
    person: Person,
    rules: RotaPhaseOneRules,
    replace_existing: bool,
) -> list[dict[str, str]]:
    limits = rules.duty_count_limits
    assignments = [
        assignment
        for assignment in person_month_assignments(db, person.id, slot_month(slot))
        if not (replace_existing and assignment.duty_slot_id == slot.id)
    ]
    month_issues: list[dict[str, str]] = []
    prospective_slots = [assignment.duty_slot for assignment in assignments] + [slot]

    total_24hr = sum(1 for duty_slot in prospective_slots if duty_slot.is_24hr)
    if limits.max_24hr_per_month is not None and total_24hr > limits.max_24hr_per_month:
        month_issues.append(
            issue(
                "error",
                "monthly_24hr_limit",
                f"This assignment would take the member to {total_24hr} 24-hour duties this month, above the limit of {limits.max_24hr_per_month}.",
            )
        )

    weekend_24hr = sum(
        1
        for duty_slot in prospective_slots
        if duty_slot.is_24hr and duty_slot.duty_date.weekday() >= 5
    )
    if limits.max_weekend_24hr_per_month is not None and weekend_24hr > limits.max_weekend_24hr_per_month:
        month_issues.append(
            issue(
                "error",
                "monthly_weekend_24hr_limit",
                f"This assignment would take the member to {weekend_24hr} weekend 24-hour duties this month, above the limit of {limits.max_weekend_24hr_per_month}.",
            )
        )

    slot_group = rule_group_for_slot(slot, rules)
    same_group = sum(1 for duty_slot in prospective_slots if rule_group_for_slot(duty_slot, rules) == slot_group)
    if limits.max_same_group_per_month is not None and same_group > limits.max_same_group_per_month:
        month_issues.append(
            issue(
                "error",
                "monthly_same_group_limit",
                f"This assignment would take the member to {same_group} duties in the {slot_group} group this month, above the limit of {limits.max_same_group_per_month}.",
            )
        )

    slot_campus = campus_for_slot(slot)
    if slot_campus:
        same_campus = sum(1 for duty_slot in prospective_slots if campus_for_slot(duty_slot) == slot_campus)
        if limits.max_same_campus_per_month is not None and same_campus > limits.max_same_campus_per_month:
            month_issues.append(
                issue(
                    "error",
                    "monthly_same_campus_limit",
                    f"This assignment would take the member to {same_campus} duties at {slot_campus}, above the limit of {limits.max_same_campus_per_month}.",
                )
            )
    return month_issues


def validate_assignment(
    db: Session,
    *,
    slot: DutySlot,
    person: Person,
    replace_existing: bool,
) -> dict[str, object]:
    month = slot_month(slot)
    starts_on, ends_on = month_bounds(month)
    _rule_version, rules = get_phase_one_rules(db)
    postings = postings_for_month(db, starts_on, ends_on)
    leaves = leaves_by_day_and_person(db, month)
    assignments = assignments_for_month(db, starts_on, ends_on)
    same_day_assignments, previous_day_assignments = assignment_indexes(assignments, rules)
    safety = slot_safety(
        slot=slot,
        rules=rules,
        postings=postings,
        leaves=leaves,
        same_day_assignments=same_day_assignments,
        previous_day_assignments=previous_day_assignments,
    )
    validation_issues: list[dict[str, str]] = []
    active_slot_assignments = [assignment for assignment in slot.assignments if active_assignment(assignment)]

    if active_slot_assignments and not replace_existing and len(active_slot_assignments) >= slot.max_assignees:
        validation_issues.append(
            issue(
                "blocked",
                "slot_full",
                "This slot is already filled. Use replace to change the assigned member.",
            )
        )

    if person.active_status != "active":
        validation_issues.append(
            issue("error", "inactive_member", "This department member is not marked active.")
        )

    rule = rule_for_slot(slot, rules)
    day_contexts = member_contexts_for_day(postings, slot.duty_date)
    person_contexts = [
        context
        for context in day_contexts
        if context.person.id == person.id and context.unit_id == slot.unit_id
    ]
    if not person_contexts:
        validation_issues.append(
            issue(
                "error",
                "not_in_unit",
                "This member is not assigned to this unit for the slot date.",
            )
        )
    else:
        required_calls = required_call_levels(slot, rule)
        if required_calls and not any(member_call_level(context) in required_calls for context in person_contexts):
            validation_issues.append(
                issue(
                    "error",
                    "call_level_mismatch",
                    f"This slot requires {', '.join(sorted(required_calls))}; the member is listed as {normalize_call_level(person.call_level)}.",
                )
            )

    hard_people, warning_people = selected_person_safety(safety, person.id)
    for person_row in hard_people:
        for blocker in person_row.get("blockers", []):
            if isinstance(blocker, dict):
                validation_issues.append(
                    issue(
                        "error",
                        str(blocker.get("type", "hard_blocker")),
                        str(blocker.get("label", "This member has a blocking conflict.")),
                    )
                )
    for person_row in warning_people:
        for blocker in person_row.get("blockers", []):
            if isinstance(blocker, dict):
                validation_issues.append(
                    issue(
                        "warning",
                        str(blocker.get("type", "review_blocker")),
                        str(blocker.get("label", "This member needs review before assignment.")),
                    )
                )

    if safety["safety_status"] == SAFETY_WARNING:
        validation_issues.append(
            issue("warning", "unit_safety_review", "This slot currently needs staffing review.")
        )
    elif safety["safety_status"] == SAFETY_HARD_BLOCK:
        validation_issues.append(
            issue("error", "unit_safety_hard_block", "This slot is currently hard blocked by staffing safety rules.")
        )

    validation_issues.extend(
        duty_count_issues(
            db=db,
            slot=slot,
            person=person,
            rules=rules,
            replace_existing=replace_existing,
        )
    )

    if any(item["severity"] == "blocked" for item in validation_issues):
        status = "blocked"
    elif any(item["severity"] in {"error", "warning"} for item in validation_issues):
        status = "needs_override"
    else:
        status = "clear"

    return {
        "status": status,
        "issues": validation_issues,
        "slot_safety": safety,
        "requires_override": status == "needs_override",
    }


def assign_person_to_slot(
    db: Session,
    *,
    slot_id: UUID,
    person_id: UUID,
    replace_existing: bool = False,
    override_reason: str | None = None,
    source: str = MANUAL_ASSIGNMENT_SOURCE,
) -> dict[str, object]:
    slot = hydrate_slot(db, slot_id)
    person = db.get(Person, person_id)
    if person is None:
        raise RotaAssignmentError("Department member not found", status_code=404)

    active_slot_assignments = [assignment for assignment in slot.assignments if active_assignment(assignment)]
    existing_for_person = next(
        (assignment for assignment in active_slot_assignments if assignment.person_id == person.id),
        None,
    )
    if existing_for_person and not replace_existing:
        return {
            "status": "unchanged",
            "assignment": assignment_to_dict(existing_for_person),
            "validation": validate_assignment(db, slot=slot, person=person, replace_existing=True),
            "slot_safety": slot_safety_for_assignment(db, slot),
        }

    validation = validate_assignment(db, slot=slot, person=person, replace_existing=replace_existing)
    if validation["status"] == "blocked":
        raise RotaAssignmentError(
            "This slot is already filled.",
            status_code=409,
            validation=validation,
        )

    clean_override = override_reason.strip() if override_reason else None
    if validation["requires_override"] and not clean_override:
        raise RotaAssignmentError(
            "Override reason is required for this assignment.",
            status_code=409,
            validation=validation,
        )

    if replace_existing:
        for assignment in active_slot_assignments:
            db.delete(assignment)
        db.flush()

    assignment = DutyAssignment(
        duty_slot=slot,
        person=person,
        status="assigned",
        source=source,
        override_reason=clean_override,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    assignment = hydrate_assignment(db, assignment.id)
    slot = hydrate_slot(db, slot.id)
    return {
        "status": "assigned",
        "assignment": assignment_to_dict(assignment),
        "validation": validation,
        "slot_safety": slot_safety_for_assignment(db, slot),
    }


def clear_assignment(db: Session, assignment_id: UUID) -> dict[str, object]:
    assignment = hydrate_assignment(db, assignment_id)
    slot_id = assignment.duty_slot_id
    cleared = assignment_to_dict(assignment)
    db.delete(assignment)
    db.commit()
    slot = hydrate_slot(db, slot_id)
    return {
        "status": "cleared",
        "assignment": cleared,
        "slot_safety": slot_safety_for_assignment(db, slot),
    }
