"""Final-set OT checks for undo/restore; archived historical records remain facts."""

from datetime import datetime, time, timedelta
from types import SimpleNamespace

from sqlalchemy import or_, select

from app.core.config import settings
from app.models import DutyAssignment, DutySlot, RotaPeriod
from app.services.history_fairness import OFFICIAL_STATUSES
from app.services.member_profiles import local_today
from app.services.ot_assignment_context import load_assignment_guard
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES
from app.services.rota_template import PHASE4_SLOT_SOURCE


def check_restored_duties(db, restored, *, removed_ids=()):
    """Read-only final-set proof; never flush a caller's unrelated pending edits."""
    with db.no_autoflush:
        return _check_restored_duties(db, restored, removed_ids=removed_ids)


def _check_restored_duties(db, restored, *, removed_ids=()):
    """Return a failure report, or None; caller owns locks and transaction outcome.

    Check all restored active operational duties together, not individually against
    the old schedule. Explicitly historical records and elapsed duties remain facts.
    Recent operational duties are included while their possible rest still extends
    into today. No ordinary undo obtains an OT exception from its original source.
    """
    if not settings.ot_calendar_enabled:
        return None
    today = datetime.combine(local_today(), time.min)
    restored = tuple(row for row in restored if row.status.lower() in ACTIVE_ASSIGNMENT_STATUSES)
    operational = tuple(row for row in restored if (
        getattr(row.duty_slot, "rota_period", None) is None
        or row.duty_slot.rota_period.status.lower() not in {"historical", "archived"})
        and (row.duty_slot.source == PHASE4_SLOT_SOURCE
             or (getattr(row.duty_slot, "rota_period", None) is not None
                 and row.duty_slot.rota_period.status.lower() in {"draft", "approved", "published", "finalized"})))
    if not operational:
        return None
    operational = tuple(row for row in operational if row.duty_slot.ends_at + timedelta(hours=216) > today)
    if not operational:
        return None
    rules = read_phase_one_rules(db)
    if rules is None:
        return {"status": "not_evaluated", "code": "ot_context_unresolved",
                "reasons": ["Saved Rota Rules are required before restoring operational duties"]}
    buffer = timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours + 48)
    operational = tuple(row for row in operational if row.duty_slot.ends_at + buffer > today)
    if not operational:
        return None
    if len(operational) > 512:
        return {"status": "not_evaluated", "code": "ot_capacity_unresolved",
                "reasons": ["Restoration exceeds the supported duty count"]}
    removed = {str(key) for key in removed_ids} | {str(row.id) for row in operational if getattr(row, "id", None)}
    # A reload must not overwrite proposed attributes on a reused ORM instance.
    operational = tuple(SimpleNamespace(id=getattr(row, "id", None), person_id=row.person_id,
        duty_slot_id=row.duty_slot.id, status=row.status, duty_slot=SimpleNamespace(**{
            key: getattr(row.duty_slot, key) for key in
            ("id", "duty_date", "duty_type", "starts_at", "ends_at", "is_24hr")})) for row in operational)
    for month in sorted({str(row.duty_slot.duty_date)[:7] for row in operational}):
        guard = load_assignment_guard(db, month, rules, prospective_slots=(
            row.duty_slot for row in operational if str(row.duty_slot.duty_date)[:7] == month))
        if guard.unresolved or not guard.reviewed_complete:
            return guard.check((), rules)
        demand = (*guard.requirements, *guard.reserves)
        if not demand:
            continue
        first, last = min(row.starts_at for row in demand), max(row.ends_at for row in demand)
        saved_rows = db.execute(select(DutyAssignment.id, DutyAssignment.person_id, DutyAssignment.status,
            DutySlot.id.label("slot_id"), DutySlot.duty_date, DutySlot.duty_type,
            DutySlot.starts_at, DutySlot.ends_at, DutySlot.is_24hr).join(DutySlot, DutySlot.id == DutyAssignment.duty_slot_id)
            .outerjoin(DutySlot.rota_period).where(DutySlot.ends_at >= first - buffer,
                DutySlot.starts_at < last,
                or_(DutySlot.source == PHASE4_SLOT_SOURCE, RotaPeriod.status.in_(OFFICIAL_STATUSES))))
        saved = [SimpleNamespace(id=row.id, person_id=row.person_id, status=row.status,
            duty_slot=SimpleNamespace(id=row.slot_id, duty_date=row.duty_date, duty_type=row.duty_type,
                starts_at=row.starts_at, ends_at=row.ends_at, is_24hr=row.is_24hr)) for row in saved_rows]
        final = [row for row in saved if str(row.id) not in removed] + list(operational)
        report = guard.check_affected(final, operational, rules)
        if report["status"] != "feasible":
            return report
    return None


def restoration_failure_message(report):
    return ("Restoring these duties would leave mandatory OT or staffing reserves uncovered."
            if report["status"] == "infeasible" else
            "OT capacity cannot be verified for these restored duties; review demand and dated availability.")
