from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import LeaveRequest, Person, PersonPosting

ACTIVE_LEAVE_STATUSES = {"approved", "requested", "imported_pending_review"}
BLOCKING_LEAVE_STATUSES = {"approved"}


def month_bounds(month: str) -> tuple[date, date]:
    try:
        year_str, month_str = month.split("-", 1)
        year = int(year_str)
        month_num = int(month_str)
        return date(year, month_num, 1), date(year, month_num, monthrange(year, month_num)[1])
    except (TypeError, ValueError) as exc:
        raise ValueError("Month must be in YYYY-MM format") from exc


def count_leave_days(starts_on: date, ends_on: date) -> int:
    return (ends_on - starts_on).days + 1


def overlaps_month(leave: LeaveRequest, starts_on: date, ends_on: date) -> bool:
    return leave.starts_on <= ends_on and leave.ends_on >= starts_on


def date_range(starts_on: date, ends_on: date) -> list[date]:
    days = count_leave_days(starts_on, ends_on)
    return [date.fromordinal(starts_on.toordinal() + offset) for offset in range(days)]


def leave_requests_for_month(db: Session, month: str) -> list[LeaveRequest]:
    starts_on, ends_on = month_bounds(month)
    statement = (
        select(LeaveRequest)
        .where(LeaveRequest.starts_on <= ends_on, LeaveRequest.ends_on >= starts_on)
        .options(selectinload(LeaveRequest.person))
        .order_by(LeaveRequest.starts_on, LeaveRequest.ends_on)
    )
    return list(db.scalars(statement))


def posting_context_for_month(db: Session, person_id: UUID, day: date) -> tuple[str | None, str | None]:
    statement = (
        select(PersonPosting)
        .where(
            PersonPosting.person_id == person_id,
            PersonPosting.starts_on <= day,
            (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= day),
        )
        .options(selectinload(PersonPosting.unit))
        .order_by(PersonPosting.starts_on.desc())
    )
    posting = db.scalars(statement).first()
    if posting is None:
        return None, None
    return posting.unit.name if posting.unit else None, posting.posting_type


def person_call_level(person: Person) -> str:
    return person.call_level or "Unassigned"


def leave_day_entries(db: Session, leaves: list[LeaveRequest], month: str) -> dict[str, list[dict[str, object]]]:
    starts_on, ends_on = month_bounds(month)
    entries: dict[str, list[dict[str, object]]] = defaultdict(list)
    for leave in leaves:
        if leave.status.lower() not in ACTIVE_LEAVE_STATUSES:
            continue
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        unit_name, posting_type = posting_context_for_month(db, leave.person_id, first)
        for day in date_range(first, last):
            entries[day.isoformat()].append(
                {
                    "leave_id": str(leave.id),
                    "person_id": str(leave.person_id),
                    "person_name": leave.person.canonical_name,
                    "leave_type": leave.leave_type,
                    "leave_slot": leave.leave_slot,
                    "status": leave.status,
                    "unit": unit_name,
                    "posting_type": posting_type,
                    "call_level": person_call_level(leave.person),
                }
            )
    return dict(entries)


def leave_summary(db: Session, month: str) -> dict[str, object]:
    starts_on, ends_on = month_bounds(month)
    leaves = leave_requests_for_month(db, month)
    active_leaves = [leave for leave in leaves if leave.status.lower() in ACTIVE_LEAVE_STATUSES]
    blocking_leaves = [leave for leave in leaves if leave.status.lower() in BLOCKING_LEAVE_STATUSES]
    people = {leave.person_id for leave in active_leaves}
    total_days = 0
    status_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    slot_counts: Counter[str] = Counter()
    unit_counts: Counter[str] = Counter()
    call_level_counts: Counter[str] = Counter()
    daily_counts: Counter[str] = Counter()

    for leave in active_leaves:
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        days = count_leave_days(first, last)
        total_days += days
        status_counts[leave.status] += 1
        type_counts[leave.leave_type] += days
        slot_counts[leave.leave_slot] += days
        unit_name, _posting_type = posting_context_for_month(db, leave.person_id, first)
        unit_counts[unit_name or "Unknown unit"] += days
        call_level_counts[person_call_level(leave.person)] += days
        for day in date_range(first, last):
            daily_counts[day.isoformat()] += 1

    busiest_day = None
    if daily_counts:
        day, count = daily_counts.most_common(1)[0]
        busiest_day = {"date": day, "count": count}

    return {
        "month": month,
        "starts_on": starts_on.isoformat(),
        "ends_on": ends_on.isoformat(),
        "total_requests": len(active_leaves),
        "blocking_requests": len(blocking_leaves),
        "people_on_leave": len(people),
        "total_leave_days": total_days,
        "busiest_day": busiest_day,
        "status_counts": dict(status_counts),
        "type_counts": dict(type_counts),
        "slot_counts": dict(slot_counts),
        "unit_counts": dict(unit_counts),
        "call_level_counts": dict(call_level_counts),
    }

