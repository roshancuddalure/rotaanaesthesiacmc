from collections import Counter, defaultdict
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import LeaveRequest, PersonPosting, Unit
from app.services.rota_call_levels import normalize_call_level
from app.services.leave import ACTIVE_LEAVE_STATUSES, count_leave_days, month_bounds

UNIT_BOARD_SOURCE = "unit_board"

PRIMARY_POSTING_TYPES = {
    "CO_1ST_CALL",
    "1ST_CALL",
    "2ND_CALL",
    "3RD_CALL",
    "CO_4TH_CALL",
    "4TH_CALL",
    "5TH_CALL",
}

SPECIAL_UNIT_POSTING_TYPES = {"DRP", "SICU", "PAIN"}


def normalize_posting_type(value: str) -> str:
    return value.strip().upper().replace(" ", "_").replace("-", "_")


def is_special_unit_posting(value: str | None) -> bool:
    if not value:
        return False
    return normalize_posting_type(value) in SPECIAL_UNIT_POSTING_TYPES


def overlaps_range(
    first_start: date,
    first_end: date | None,
    second_start: date,
    second_end: date | None,
) -> bool:
    first_last = first_end or date.max
    second_last = second_end or date.max
    return first_start <= second_last and second_start <= first_last


def monthly_unit_assignments(db: Session, month: str) -> list[PersonPosting]:
    starts_on, ends_on = month_bounds(month)
    statement = (
        select(PersonPosting)
        .where(
            PersonPosting.starts_on <= ends_on,
            (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
            PersonPosting.source == UNIT_BOARD_SOURCE,
        )
        .options(
            selectinload(PersonPosting.person),
            selectinload(PersonPosting.unit),
        )
        .order_by(PersonPosting.starts_on, PersonPosting.posting_type)
    )
    return list(db.scalars(statement))


def active_units(db: Session) -> list[Unit]:
    return list(
        db.scalars(
            select(Unit)
            .where(Unit.active_status == "active")
            .options(selectinload(Unit.call_minimums))
            .order_by(Unit.name, Unit.code)
        )
    )


def unit_call_member_counts(assignments: list[PersonPosting], month: str) -> dict[tuple[UUID, str], int]:
    starts_on, ends_on = month_bounds(month)
    people: dict[tuple[UUID, str], set[UUID]] = defaultdict(set)
    for assignment in assignments:
        if assignment.unit_id is None:
            continue
        if assignment.starts_on > ends_on or (assignment.ends_on is not None and assignment.ends_on < starts_on):
            continue
        call_level = normalize_call_level(assignment.posting_type or assignment.person.call_level)
        people[(assignment.unit_id, call_level)].add(assignment.person_id)
    return {key: len(value) for key, value in people.items()}


def active_leaves_for_month(db: Session, month: str) -> list[LeaveRequest]:
    starts_on, ends_on = month_bounds(month)
    statement = (
        select(LeaveRequest)
        .where(
            LeaveRequest.starts_on <= ends_on,
            LeaveRequest.ends_on >= starts_on,
        )
        .options(selectinload(LeaveRequest.person))
    )
    return [
        leave
        for leave in db.scalars(statement)
        if leave.status.lower() in ACTIVE_LEAVE_STATUSES
    ]


def unit_leave_summary(
    db: Session,
    month: str,
    assignments: list[PersonPosting] | None = None,
) -> dict[UUID, dict[str, object]]:
    starts_on, ends_on = month_bounds(month)
    assignment_list = assignments if assignments is not None else monthly_unit_assignments(db, month)
    person_to_units: dict[UUID, set[UUID]] = defaultdict(set)
    for assignment in assignment_list:
        if assignment.unit_id is not None:
            person_to_units[assignment.person_id].add(assignment.unit_id)

    summaries: dict[UUID, dict[str, object]] = defaultdict(
        lambda: {
            "assigned_members": 0,
            "people_with_leave": 0,
            "leave_days": 0,
            "leave_by_call_level": Counter(),
        }
    )

    assigned_people_by_unit: dict[UUID, set[UUID]] = defaultdict(set)
    for assignment in assignment_list:
        if assignment.unit_id is None:
            continue
        assigned_people_by_unit[assignment.unit_id].add(assignment.person_id)

    for unit_id, people in assigned_people_by_unit.items():
        summaries[unit_id]["assigned_members"] = len(people)

    leave_people_by_unit: dict[UUID, set[UUID]] = defaultdict(set)
    for leave in active_leaves_for_month(db, month):
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        days = count_leave_days(first, last)
        for unit_id in person_to_units.get(leave.person_id, set()):
            leave_people_by_unit[unit_id].add(leave.person_id)
            summaries[unit_id]["leave_days"] = int(summaries[unit_id]["leave_days"]) + days
            call_level = leave.person.call_level or "Unassigned"
            summaries[unit_id]["leave_by_call_level"][call_level] += days  # type: ignore[index]

    for unit_id, people in leave_people_by_unit.items():
        summaries[unit_id]["people_with_leave"] = len(people)

    return summaries


def validate_unit_month(assignments: list[PersonPosting], month: str) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    starts_on, ends_on = month_bounds(month)
    by_person: dict[UUID, list[PersonPosting]] = defaultdict(list)
    units_by_person: dict[UUID, dict[UUID, PersonPosting]] = defaultdict(dict)

    for assignment in assignments:
        if assignment.person.active_status != "active":
            issues.append(
                {
                    "severity": "warning",
                    "code": "INACTIVE_MEMBER_ASSIGNED",
                    "message": f"{assignment.person.canonical_name} is not active.",
                    "person_id": str(assignment.person_id),
                    "unit_id": str(assignment.unit_id) if assignment.unit_id else None,
                    "posting_id": str(assignment.id),
                }
            )
        if assignment.unit_id is None:
            if not is_special_unit_posting(assignment.posting_type):
                issues.append(
                    {
                        "severity": "error",
                        "code": "MISSING_UNIT",
                        "message": f"{assignment.person.canonical_name} has no unit selected.",
                        "person_id": str(assignment.person_id),
                        "posting_id": str(assignment.id),
                    }
                )
        else:
            units_by_person[assignment.person_id].setdefault(assignment.unit_id, assignment)
        if not assignment.posting_type.strip():
            issues.append(
                {
                    "severity": "error",
                    "code": "MISSING_POSTING_TYPE",
                    "message": f"{assignment.person.canonical_name} has no call level/posting type.",
                    "person_id": str(assignment.person_id),
                    "unit_id": str(assignment.unit_id) if assignment.unit_id else None,
                    "posting_id": str(assignment.id),
                }
            )
        if normalize_posting_type(assignment.posting_type) in PRIMARY_POSTING_TYPES:
            by_person[assignment.person_id].append(assignment)

    for unit_assignments in units_by_person.values():
        if len(unit_assignments) <= 1:
            continue
        first_assignment = next(iter(unit_assignments.values()))
        unit_names = sorted(
            {
                assignment.unit.name if assignment.unit is not None else "No unit"
                for assignment in unit_assignments.values()
            }
        )
        issues.append(
            {
                "severity": "error",
                "code": "MULTIPLE_UNITS_IN_MONTH",
                "message": (
                    f"{first_assignment.person.canonical_name} is assigned to more than one unit "
                    f"in {month}: {', '.join(unit_names)}."
                ),
                "person_id": str(first_assignment.person_id),
                "unit_id": str(first_assignment.unit_id) if first_assignment.unit_id else None,
                "posting_id": str(first_assignment.id),
            }
        )

    for person_assignments in by_person.values():
        relevant = [
            assignment
            for assignment in person_assignments
            if overlaps_range(
                max(assignment.starts_on, starts_on),
                min(assignment.ends_on or ends_on, ends_on),
                starts_on,
                ends_on,
            )
        ]
        for index, assignment in enumerate(relevant):
            for other in relevant[index + 1 :]:
                if overlaps_range(assignment.starts_on, assignment.ends_on, other.starts_on, other.ends_on):
                    issues.append(
                        {
                            "severity": "error",
                            "code": "OVERLAPPING_PRIMARY_ASSIGNMENT",
                            "message": (
                                f"{assignment.person.canonical_name} has overlapping primary unit "
                                "assignments."
                            ),
                            "person_id": str(assignment.person_id),
                            "unit_id": str(assignment.unit_id) if assignment.unit_id else None,
                            "posting_id": str(assignment.id),
                        }
                    )
                    break

    return issues
