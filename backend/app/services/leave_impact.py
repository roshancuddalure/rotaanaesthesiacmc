"""Read-only affected-duty evidence; temporal warnings do not amend duty policy."""

from collections import defaultdict
from datetime import datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.models import DutyAssignment, DutySlot
from app.services.leave_semantics import duty_leave_blocks, leave_intervals
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES


def affected_duties(db, leaves):
    """Caller owns authorization/review transaction. No assignments are changed.

    Include existing date/start-hour blocking evidence AND actual time overlaps
    (including previous-month overnight duties). Preserve their distinct meaning.
    """
    if not leaves:
        return []
    if len(leaves) > 5000:
        raise ValueError("Leave impact exceeds 5000 records; review a smaller selection")
    first = min(row.starts_on for row in leaves)
    last = max(row.ends_on for row in leaves)
    if (last - first).days > 370:
        raise ValueError("Leave impact spans more than 371 dates; review a smaller selection")
    if last.year == 9999 and last.month == 12 and last.day == 31:
        raise ValueError("Leave impact needs an end date before 9999-12-31")
    start = datetime.combine(first, time.min)
    end = datetime.combine(last + timedelta(days=1), time.min)
    by_person = defaultdict(list)
    record_dates = sum(max(0, (row.ends_on-row.starts_on).days+1) for row in leaves)
    if record_dates > 100_000:
        raise ValueError("Leave impact exceeds 100000 record-dates; review a smaller selection")
    for row in leaves:
        by_person[row.person_id].append(row)
    with db.no_autoflush:
        assignments = list(db.scalars(select(DutyAssignment).join(DutySlot).where(
            DutyAssignment.person_id.in_(by_person),
            func.lower(DutyAssignment.status).in_(ACTIVE_ASSIGNMENT_STATUSES),
            or_(DutySlot.duty_date.between(first, last),
                (DutySlot.starts_at < end) & (DutySlot.ends_at > start)),
        ).options(selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.rota_period),
                  selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.assignments))
          .order_by(DutySlot.duty_date, DutyAssignment.id).limit(2001)))
        if len(assignments) > 2000:
            raise ValueError("Leave impact exceeds 2000 assignments; review a smaller selection")
        if sum(len(by_person[row.person_id]) for row in assignments) > 200_000:
            raise ValueError("Leave impact exceeds 200000 record/assignment comparisons; review a smaller selection")
        spans = {id(row): leave_intervals(row, first, last) for row in leaves}
        impacts = []
        for assignment in assignments:
            slot = assignment.duty_slot
            reasons, leave_ids = set(), set()
            for row in by_person[assignment.person_id]:
                # Keep the explanation's date-policy reason separate from the
                # physical overlap which now independently blocks allocation.
                legacy = (row.starts_on <= slot.duty_date <= row.ends_on
                          and duty_leave_blocks(row.leave_slot, is_24hr=slot.is_24hr,
                                                start_hour=slot.starts_at.hour))
                physical = any(span.starts_at < slot.ends_at and slot.starts_at < span.ends_at
                               for span in spans[id(row)])
                if legacy or physical:
                    leave_ids.add(str(row.id))
                if legacy:
                    reasons.add("duty_date_policy_overlap")
                if physical:
                    reasons.add("physical_interval_overlap")
            if not reasons:
                continue
            period = slot.rota_period
            # Only expose a possible review scope. The existing engine checks all
            # locks, eligibility, current revisions and final joint feasibility.
            active = [row for row in slot.assignments if row.status.lower() in ACTIVE_ASSIGNMENT_STATUSES]
            potentially_reviewable = bool(period and period.status.lower() == "draft"
                                          and slot.source == "phase4_template" and len(active) == 1)
            protected = period is None or period.status.lower() != "draft"
            impacts.append({
                "id": str(assignment.id), "slot_id": str(slot.id),
                "person_id": str(assignment.person_id),
                "person_name": by_person[assignment.person_id][0].person.canonical_name,
                "date": slot.duty_date.isoformat(), "duty": slot.slot_label,
                "starts_at": slot.starts_at.isoformat(), "ends_at": slot.ends_at.isoformat(),
                "period_id": str(period.id) if period else None,
                "month": period.starts_on.strftime("%Y-%m") if period else slot.duty_date.strftime("%Y-%m"),
                "period_status": period.status if period else "unscoped",
                "protected_period": protected, "leave_ids": sorted(leave_ids), "reasons": sorted(reasons),
                "requires_authorized_resolution": protected or not potentially_reviewable,
                "reviewed_repair_candidate": potentially_reviewable,
                "repair_basis": "Possible explicit draft repair scope only; current slot locks and full feasibility "
                                "must be checked by the existing reviewed repair engine. No repair was generated or applied.",
            })
        return impacts
