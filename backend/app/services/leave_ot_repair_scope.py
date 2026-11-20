"""Explicit possible repair scope for OT components touched by approved leave.

This does not select replacements or certify a repair. A candidate's duty/rest
can consume a person in a deficient reservation component; joint planning and
the existing final checker must still prove any selected replacement set.
"""

from datetime import timedelta
from time import perf_counter

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models import DutyAssignment, DutySlot, RotaPeriod
from app.services.history_fairness import OFFICIAL_STATUSES
from app.services.leave_projection import LeaveProjection
from app.services.leave_semantics import leave_intervals
from app.services.ot_assignment_context import load_assignment_guard
from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_availability import duty_windows
from app.services.ot_capacity import CapacityResourceLimit
from app.services.ot_guard_scope import reservation_components
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES
from app.services.rota_template import PHASE4_SLOT_SOURCE


BASIS = ("Possible duties consuming people in deficient OT/staffing components touched by selected approved leave. "
         "A shortage may predate that leave. Candidates are not proven repairs: explicitly select scope, preserve "
         "locks and protected periods, and validate the complete replacement plan. No assignment was changed.")


def _unknown(reason):
    return {"status": "not_evaluated", "basis": BASIS, "reasons": [reason],
            "components": [], "assignment_ids": []}


def candidate_components(current, without_selected_leave, assignments, leaves, rules, *, seconds=3.0):
    """Pure bounded evidence, using the existing joint checker and graph rules."""
    if not 0 < seconds <= 10:
        raise ValueError("OT repair scope budget must be between zero and ten seconds")
    deadline = perf_counter() + seconds
    guards = (current, without_selected_leave)
    if any(guard.unresolved or not guard.reviewed_complete for guard in guards):
        return _unknown("Complete reviewed OT calendars, rules and dated availability are required")
    demands = (*current.requirements, *current.reserves)
    baseline_demands = (*without_selected_leave.requirements, *without_selected_leave.reserves)
    if demands != baseline_demands:
        return _unknown("The compared OT reservation definitions differ")
    assignments, leaves = tuple(assignments), tuple(leaves)
    if len(assignments) > 5000 or len(leaves) > 100:
        return _unknown("OT repair evidence exceeds supported duty/leave limits")
    try:
        # Removing just the selected approved leave forms a conservative graph:
        # it retains other absences and captures shared-person competition even
        # when that leave has removed a connecting person's current eligibility.
        groups, prior_potentials = reservation_components(
            without_selected_leave.requirements, without_selected_leave.reserves,
            without_selected_leave.people)
        _, potentials = reservation_components(current.requirements, current.reserves, current.people)
        touched = set()
        for leave in leaves:
            spans = leave_intervals(leave, leave.starts_on, leave.ends_on)
            touched.update(index for index, demand in enumerate(demands)
                           if leave.person_id in prior_potentials[index]
                           and any(span.starts_at < demand.ends_at and span.ends_at > demand.starts_at
                                   for span in spans))
        affected = [group for group in groups if touched.intersection(group)]
        if len(affected) > 16 or len(assignments) * sum(map(len, affected)) > 200_000:
            return _unknown("OT repair component work exceeds supported limits; narrow the leave selection")
        reports, identities = [], set()
        for group in affected:
            remaining = deadline - perf_counter()
            if remaining <= 0:
                return _unknown("OT repair component review reached its time budget")
            guard = OtAssignmentGuard(
                tuple(demands[i] for i in group if i < len(current.requirements)), current.people,
                tuple(demands[i] for i in group if i >= len(current.requirements)), reviewed_complete=True)
            report = guard.check(assignments, rules, seconds=min(remaining, 1.0))
            if report['status'] == 'not_evaluated':
                return _unknown("A touched OT reservation component could not be verified")
            if report['status'] != 'infeasible':
                continue
            candidates = []
            for assignment in assignments:
                if assignment.status.lower() not in ACTIVE_ASSIGNMENT_STATUSES:
                    continue
                spans = duty_windows(assignment.duty_slot, rules)
                if any(assignment.person_id in potentials[i]
                       and any(span.starts_at < demands[i].ends_at and span.ends_at > demands[i].starts_at
                               for span in spans) for i in group):
                    candidates.append(str(assignment.id))
            identities.update(candidates)
            capacity = report.get('capacity')
            reports.append({"requirement_ids": sorted(demands[i].id for i in group),
                            "mandatory_required": capacity['mandatory_required'] if capacity else None,
                            "mandatory_covered": capacity['mandatory_covered'] if capacity else None,
                            "assignment_ids": sorted(candidates)})
        if perf_counter() > deadline:
            return _unknown("OT repair component review reached its time budget")
        if len(identities) > 2000:
            return _unknown("OT repair evidence exceeds 2000 candidate assignments; narrow the selection")
        return {"status": "evaluated", "basis": BASIS, "reasons": [], "components": reports,
                "assignment_ids": sorted(identities)}
    except (CapacityResourceLimit, ValueError) as exc:
        return _unknown(str(exc))


def review_scope(db, month, leaves):
    """Caller holds final input locks; return evidence plus canonical assignments."""
    if not settings.ot_calendar_enabled:
        return {"status": "disabled", "basis": BASIS, "reasons": ["OT calendar integration is disabled"],
                "components": [], "assignment_ids": []}, []
    with db.no_autoflush:
        rules = read_phase_one_rules(db)
        if rules is None:
            return _unknown("Saved Rota Rules are required"), []
        current = load_assignment_guard(db, month, rules)
        without = load_assignment_guard(db, month, rules, leave_projections=tuple(
            LeaveProjection(row.id, row.person_id, row.starts_on, row.ends_on, row.leave_slot, 'cancelled')
            for row in leaves))
        demands = (*current.requirements, *current.reserves)
        if current.unresolved or without.unresolved:
            return _unknown("Complete reviewed OT calendars and dated availability are required"), []
        assignments = []
        if demands:
            first, last = min(row.starts_at for row in demands), max(row.ends_at for row in demands)
            buffer = timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours + 48)
            assignments = list(db.scalars(select(DutyAssignment).join(DutyAssignment.duty_slot)
                .outerjoin(DutySlot.rota_period).where(
                    func.lower(DutyAssignment.status).in_(ACTIVE_ASSIGNMENT_STATUSES),
                    DutySlot.ends_at >= first-buffer, DutySlot.starts_at < last,
                    or_(DutySlot.source == PHASE4_SLOT_SOURCE, RotaPeriod.status.in_(OFFICIAL_STATUSES)))
                .options(selectinload(DutyAssignment.person),
                         selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.rota_period),
                         selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.assignments)).limit(5001)))
        result = candidate_components(current, without, assignments, leaves, rules)
        return result, [row for row in assignments if str(row.id) in result['assignment_ids']]
