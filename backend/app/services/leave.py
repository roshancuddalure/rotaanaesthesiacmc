"""Leave queries and aggregations shared by the leave views, unit management and rota safety.

Defines the status semantics used everywhere:
- ``ACTIVE_LEAVE_STATUSES``   - shown on calendars and considered by safety checks.
- ``BLOCKING_LEAVE_STATUSES`` - hard-blocks a duty (only ``approved``).
Also hosts ``month_bounds`` which every month-scoped endpoint uses to validate ``YYYY-MM``.
"""

from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import LeaveRequest, Person
from app.services.leave_accounting import interval_coverage
from app.services.leave_attribution import LeaveAttribution

from app.services.leave_semantics import (
    ACTIVE_LEAVE_STATUSES as ACTIVE_LEAVE_STATUSES,
    BLOCKING_LEAVE_STATUSES as BLOCKING_LEAVE_STATUSES,
    count_leave_days, date_range, is_active, is_approved,
)


def month_bounds(month: str) -> tuple[date, date]:
    try:
        year_str, month_str = month.split("-", 1)
        year = int(year_str)
        month_num = int(month_str)
        return date(year, month_num, 1), date(year, month_num, monthrange(year, month_num)[1])
    except (TypeError, ValueError) as exc:
        raise ValueError("Month must be in YYYY-MM format") from exc


def overlaps_month(leave: LeaveRequest, starts_on: date, ends_on: date) -> bool:
    return leave.starts_on <= ends_on and leave.ends_on >= starts_on


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
    """Compatibility single-date wrapper; reports use one batched context instead."""
    attribution = LeaveAttribution(db, [person_id], day, day).resolve(person_id, day)
    return attribution.unit_name, attribution.posting_type


def person_call_level(person: Person) -> str:
    from app.services.member_profiles import call_level_on
    return call_level_on(person) or "Unassigned"


def leave_day_entries(db: Session, leaves: list[LeaveRequest], month: str) -> dict[str, list[dict[str, object]]]:
    starts_on, ends_on = month_bounds(month)
    entries: dict[str, list[dict[str, object]]] = defaultdict(list)
    context = LeaveAttribution(db, {row.person_id for row in leaves if is_active(row.status)}, starts_on, ends_on)
    for leave in leaves:
        if not is_active(leave.status):
            continue
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        for day in date_range(first, last):
            attribution = context.resolve(leave.person_id, day)
            entries[day.isoformat()].append(
                {
                    "leave_id": str(leave.id),
                    "person_id": str(leave.person_id),
                    "person_name": leave.person.canonical_name,
                    "leave_type": leave.leave_type,
                    "leave_slot": leave.leave_slot,
                    "status": leave.status,
                    "unit": attribution.unit_name,
                    "posting_type": attribution.posting_type,
                    "call_level": attribution.call_level,
                    "attribution_warnings": list(attribution.warnings),
                }
            )
    return dict(entries)


def leave_summary(db: Session, month: str) -> dict[str, object]:
    starts_on, ends_on = month_bounds(month)
    leaves = leave_requests_for_month(db, month)
    active_leaves = [leave for leave in leaves if is_active(leave.status)]
    blocking_leaves = [leave for leave in leaves if is_approved(leave.status)]
    people = {leave.person_id for leave in active_leaves}
    total_days = 0
    status_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    slot_counts: Counter[str] = Counter()
    unit_counts: Counter[str] = Counter()
    call_level_counts: Counter[str] = Counter()
    daily_people: dict[str, set[UUID]] = defaultdict(set)
    context = LeaveAttribution(db, {row.person_id for row in active_leaves}, starts_on, ends_on)
    attribution_warnings = []

    for leave in active_leaves:
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        days = count_leave_days(first, last)
        total_days += days
        status_counts[leave.status] += 1
        type_counts[leave.leave_type] += days
        slot_counts[leave.leave_slot] += days
        for day in date_range(first, last):
            attribution = context.resolve(leave.person_id, day)
            unit_counts[attribution.unit_name or "Unknown unit"] += 1
            call_level_counts[attribution.call_level] += 1
            if attribution.warnings:
                attribution_warnings.append({"leave_id": str(leave.id), "date": day.isoformat(),
                                             "codes": list(attribution.warnings)})
            daily_people[day.isoformat()].add(leave.person_id)

    busiest_day = None
    if daily_people:
        day = min(daily_people, key=lambda key: (-len(daily_people[key]), key))
        busiest_day = {"date": day, "count": len(daily_people[day])}

    return {
        "month": month,
        "starts_on": starts_on.isoformat(),
        "ends_on": ends_on.isoformat(),
        "total_requests": len(active_leaves),
        "blocking_requests": len(blocking_leaves),
        "people_on_leave": len(people),
        "total_leave_days": total_days,
        "total_leave_days_basis": "Inclusive active request-days; overlapping and partial requests "
                                  "are separate records, not a leave-taken total.",
        "interval_coverage": interval_coverage(leaves, starts_on, ends_on),
        "busiest_day": busiest_day,
        "status_counts": dict(status_counts),
        "type_counts": dict(type_counts),
        "slot_counts": dict(slot_counts),
        "unit_counts": dict(unit_counts),
        "call_level_counts": dict(call_level_counts),
        "attribution_warnings": attribution_warnings,
        "attribution_basis": "Dated postings and canonical dated call precedence; request-day breakdowns. "
                             "All posting sources considered; conflicting units/calls remain unresolved.",
    }


def leave_pressure(db: Session, month: str) -> dict[str, object]:
    starts_on, ends_on = month_bounds(month)
    leaves = [
        leave
        for leave in leave_requests_for_month(db, month)
        if is_active(leave.status)
    ]
    daily: dict[str, dict[str, object]] = {}
    unit_totals: Counter[str] = Counter()
    call_level_totals: Counter[str] = Counter()
    blockers: list[dict[str, object]] = []
    daily_people: dict[str, set[UUID]] = defaultdict(set)
    daily_approved: dict[str, set[UUID]] = defaultdict(set)
    unit_people: dict[tuple[str, str], set[UUID]] = defaultdict(set)
    call_people: dict[tuple[str, str], set[UUID]] = defaultdict(set)
    context = LeaveAttribution(db, {row.person_id for row in leaves}, starts_on, ends_on)

    for leave in leaves:
        first = max(leave.starts_on, starts_on)
        last = min(leave.ends_on, ends_on)
        for day in date_range(first, last):
            attribution = context.resolve(leave.person_id, day)
            unit_name, posting_type = attribution.unit_name, attribution.posting_type
            unit_key, call_level = unit_name or "Unknown unit", attribution.call_level
            day_key = day.isoformat()
            if day_key not in daily:
                daily[day_key] = {
                    "date": day_key,
                    "total_people": 0,
                    "blocking_people": 0,
                    "unit_counts": Counter(),
                    "call_level_counts": Counter(),
                    "entries": [],
                }
            day_bucket = daily[day_key]
            daily_people[day_key].add(leave.person_id)
            day_bucket["total_people"] = len(daily_people[day_key])
            if is_approved(leave.status):
                daily_approved[day_key].add(leave.person_id)
            day_bucket["blocking_people"] = len(daily_approved[day_key])
            if leave.person_id not in unit_people[day_key, unit_key]:
                unit_people[day_key, unit_key].add(leave.person_id)
                day_bucket["unit_counts"][unit_key] += 1  # type: ignore[index]
                unit_totals[unit_key] += 1
            if leave.person_id not in call_people[day_key, call_level]:
                call_people[day_key, call_level].add(leave.person_id)
                day_bucket["call_level_counts"][call_level] += 1  # type: ignore[index]
                call_level_totals[call_level] += 1
            day_bucket["entries"].append(  # type: ignore[union-attr]
                {
                    "leave_id": str(leave.id),
                    "person_id": str(leave.person_id),
                    "person_name": leave.person.canonical_name,
                    "status": leave.status,
                    "leave_type": leave.leave_type,
                    "leave_slot": leave.leave_slot,
                    "unit": unit_name,
                    "posting_type": posting_type,
                    "call_level": call_level,
                    "attribution_warnings": list(attribution.warnings),
                }
            )
            blockers.append(
                {
                    "date": day_key,
                    "person_id": str(leave.person_id),
                    "person_name": leave.person.canonical_name,
                    "status": leave.status,
                    "is_blocking": is_approved(leave.status),
                    "unit": unit_name,
                    "posting_type": posting_type,
                    "call_level": call_level,
                    "leave_type": leave.leave_type,
                    "leave_slot": leave.leave_slot,
                    "attribution_warnings": list(attribution.warnings),
                }
            )

    serialized_days = []
    for day in sorted(daily.values(), key=lambda item: str(item["date"])):
        serialized_days.append(
            {
                **day,
                "unit_counts": dict(day["unit_counts"]),  # type: ignore[arg-type]
                "call_level_counts": dict(day["call_level_counts"]),  # type: ignore[arg-type]
            }
        )

    return {
        "month": month,
        "starts_on": starts_on.isoformat(),
        "ends_on": ends_on.isoformat(),
        "days": serialized_days,
        "unit_totals": dict(unit_totals),
        "call_level_totals": dict(call_level_totals),
        "blockers": blockers,
        "counting_basis": "Distinct active people per calendar date; blocking means at least one "
                          "approved record on that date, not unavailability for every duty. "
                          "Unit/call totals count person-dates; entries retain individual requests.",
    }
