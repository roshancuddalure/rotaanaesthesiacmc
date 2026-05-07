from collections import Counter, defaultdict
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import LeaveRequest, PersonPosting, Unit
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


def normalize_posting_type(value: str) -> str:
    return value.strip().upper().replace(" ", "_").replace("-", "_")


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
            .order_by(Unit.name, Unit.code)
        )
    )


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
            issues.append(
                {
                    "severity": "error",
                    "code": "MISSING_UNIT",
                    "message": f"{assignment.person.canonical_name} has no unit selected.",
                    "person_id": str(assignment.person_id),
                    "posting_id": str(assignment.id),
                }
            )
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
