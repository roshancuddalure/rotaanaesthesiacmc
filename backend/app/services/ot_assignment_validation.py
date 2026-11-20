"""OT adapter for shared ordinary assignment validation; no override authority."""

from datetime import timedelta
from types import SimpleNamespace

from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models import DutyAssignment, DutySlot, RotaPeriod
from app.services.history_fairness import OFFICIAL_STATUSES
from app.services.ot_assignment_context import load_assignment_guard
from app.services.rota_template import PHASE4_SLOT_SOURCE


def validate_ot_assignment(db, slot, person, rules, *, replace_existing, context=None):
    if not settings.ot_calendar_enabled:
        return None
    guard = getattr(context, "ot_guard", None) if context is not None else None
    if guard is None:
        guard = load_assignment_guard(db, str(slot.duty_date)[:7], rules, prospective_slots=(slot,))
        if context is not None:
            context.ot_guard = guard
    if guard.unresolved or not guard.reviewed_complete:
        return guard.check((), rules)
    if context is not None:
        assignments = [row for rows in context.nearby_assignments.values() for row in rows]
    else:
        demands = (*guard.requirements, *guard.reserves)
        if not demands:
            return guard.check((), rules)
        first = min(row.starts_at for row in demands)
        last = max(row.ends_at for row in demands)
        buffer = timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours + 48)
        assignments = list(db.scalars(select(DutyAssignment).join(DutyAssignment.duty_slot)
            .outerjoin(DutySlot.rota_period).where(DutySlot.ends_at >= first - buffer,
                DutySlot.starts_at < last,
                or_(DutySlot.source == PHASE4_SLOT_SOURCE, RotaPeriod.status.in_(OFFICIAL_STATUSES)))
            .options(selectinload(DutyAssignment.duty_slot))))
    return check_ot_placement(guard, assignments, slot, person.id, rules, replace_existing=replace_existing)


def check_ot_placement(guard, assignments, slot, person_id, rules, *, replace_existing=False):
    """Use a complete saved/provisional duty set from any existing planning context."""
    # Replace removes every previous holder of this slot, including provisional
    # choices. A non-replace proposal retains other holders but not its duplicate.
    final = [row for row in assignments if row.duty_slot_id != slot.id
             or (not replace_existing and row.person_id != person_id)]
    proposed = SimpleNamespace(person_id=person_id, duty_slot_id=slot.id, duty_slot=slot, status="assigned")
    final.append(proposed)
    return guard.check_affected(final, (proposed,), rules)
