"""One bounded monthly OT snapshot, including rest effects beyond month end.

Read only: no rule initialization, calendar initialization or assignment writes.
This adapter does not activate the guard or grant allocation exceptions.
"""

from datetime import datetime, time, timedelta

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models import CallCluster, DutySlot, OtCalendar, Unit
from app.services.leave import date_range, month_bounds
from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_availability import canonical_availability, duty_windows
from app.services.ot_calendar import resolve_day
from app.services.ot_calendar_store import CalendarConfiguration
from app.services.ot_capacity import CapacityReserve, CapacityResourceLimit
from app.services.rota_safety import unit_minimum_for_required_calls


def load_assignment_guard(db, month, rules, *, prospective_slots=(), leave_projections=(), include_pending=False):
    """Freeze all active/configured units and the full potential duty/rest horizon.

    The previous date covers overnight demand crossing into the first day. The
    latest configured slot's real end plus maximum rest covers future demand;
    calendar-day elective exclusions need at least the next two midnights.
    Oversized or incomplete context returns unresolved instead of truncating it.
    Availability is loaded without duties so replacements and provisional plans
    can overlay their actual final assignment set without stale saved blocks.
    """
    first, last = month_bounds(month)
    latest_end = db.scalar(select(func.max(DutySlot.ends_at)).where(
        DutySlot.duty_date >= first, DutySlot.duty_date <= last))
    day_after = datetime.combine(last + timedelta(days=1), time.min)
    latest_end = max(latest_end or day_after, day_after)
    ending = max(latest_end + timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours),
                 datetime.combine(last + timedelta(days=2), time.min))
    beginning = datetime.combine(first - timedelta(days=1), time.min)
    prospective_slots = tuple(prospective_slots)
    if len(prospective_slots) > 512:
        return OtAssignmentGuard((), (), unresolved=("Prospective duty count exceeds bounded OT context",))
    try:
        spans = tuple(span for slot in prospective_slots for span in duty_windows(slot, rules))
    except ValidationError:
        return OtAssignmentGuard((), (), unresolved=("Invalid prospective duty/rest interval",))
    if spans:
        beginning = min(beginning, min(span.starts_at for span in spans))
        ending = max(ending, max(span.ends_at for span in spans))
    if ending - beginning > timedelta(days=44):
        return OtAssignmentGuard((), (), unresolved=("Duty/rest horizon exceeds bounded monthly OT context",))
    final_day = (ending - timedelta(microseconds=1)).date()
    calendars = {row.unit_id: row for row in db.scalars(select(OtCalendar))}
    units = {unit.id: unit for unit in db.scalars(select(Unit).options(selectinload(Unit.call_minimums)))
             if unit.active_status == "active" or unit.id in calendars}
    requirements, reserves, reasons, mappings = [], [], [], {}
    for unit_id, unit in units.items():
        saved = calendars.get(unit_id)
        if saved is None:
            reasons.append(f"No reviewed OT calendar for unit {unit_id}")
            continue
        try:
            configuration = CalendarConfiguration.model_validate(saved.configuration)
        except ValidationError:
            reasons.append(f"Invalid saved OT calendar for unit {unit_id}")
            continue
        if any(row.unit_id != unit_id for row in (*configuration.weekly, *configuration.exceptions)):
            reasons.append(f"OT calendar contains definitions for another unit: {unit_id}")
            continue
        mappings[unit_id] = {row.skill_key: row.group_keys for row in configuration.qualification_bindings}
        for day in date_range(beginning.date(), final_day):
            effective = resolve_day(configuration.weekly, configuration.exceptions, day=day, unit_id=unit_id)
            if not effective["configured"]:
                reasons.append(f"Unreviewed OT demand for unit {unit_id} on {day}")
            for row in effective["requirements"]:
                if row.starts_at >= ending or row.ends_at <= beginning:
                    continue
                requirements.append(row.model_copy(update={"target": row.minimum}))
                reserves.append(CapacityReserve(id=f"minimum:{row.id}", unit_id=unit_id,
                    starts_at=row.starts_at, ends_at=row.ends_at, call_levels=row.call_levels,
                    minimum=unit_minimum_for_required_calls(unit, set(row.call_levels), rules),
                    mode=configuration.reserve_mode))
    if reasons:
        return OtAssignmentGuard(tuple(requirements), (), tuple(reserves), unresolved=tuple(reasons))
    skills = {(row.unit_id, skill) for row in requirements if row.minimum for skill in row.required_skills}
    source_keys = {key for unit_id, skill in skills for key in mappings.get(unit_id, {}).get(skill, ())}
    active = set(db.scalars(select(CallCluster.key).where(
        CallCluster.key.in_(source_keys), CallCluster.active.is_(True)))) if source_keys else set()
    if source_keys - active:
        reasons.append("Required OT qualification sources are no longer active")
    try:
        availability = canonical_availability(db, requirements, rules, assignments=(),
            qualification_groups_by_unit=mappings, horizon_days=45,
            leave_projections=leave_projections, include_pending=include_pending)
    except (CapacityResourceLimit, ValueError) as exc:
        return OtAssignmentGuard(tuple(requirements), (), tuple(reserves), unresolved=(str(exc),))
    reasons.extend(warning["code"] for warning in availability["warnings"])
    return OtAssignmentGuard(tuple(requirements), availability["people"], tuple(reserves),
                             unresolved=tuple(sorted(set(reasons))), reviewed_complete=not reasons,
                             horizon_start=beginning, horizon_end=ending)
