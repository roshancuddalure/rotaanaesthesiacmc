"""Read-only before/after month-wide OT evidence for proposed leave values.

Caller owns authorization and transaction consistency. This is evidence, not a
leave rejection policy, assignment application or permission to repair a rota.
"""

from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.models import DutyAssignment, DutySlot, RotaPeriod
from app.core.config import settings
from app.services.history_fairness import OFFICIAL_STATUSES
from app.services.leave import month_bounds
from app.services.leave_projection import indexed_projections
from app.services.ot_assignment_context import load_assignment_guard
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES
from app.services.rota_template import PHASE4_SLOT_SOURCE


def review_impacts(db, projections, *, previous=()):
    """Bounded review adapter. Former dates are included when editing a request.

    The context digest covers canonical scheduling inputs, not solver timings or
    interchangeable witness choices. Callers include it in their review tokens.
    """
    if not settings.ot_calendar_enabled:
        return {"status": "disabled", "context_digest": None, "months": [],
                "basis": "OT calendar integration is disabled; OT impact was not evaluated."}
    from app.services.scheduling_snapshot import capture

    projections = tuple(indexed_projections(projections).values())
    previous = tuple(indexed_projections(previous).values())
    digest = capture(db).digest
    months = set()
    for row in (*projections, *previous):
        start = row.starts_on.replace(day=1)
        while start <= row.ends_on:
            months.add(start.strftime("%Y-%m"))
            if len(months) > 4:
                return {"status": "not_evaluated", "context_digest": digest, "months": [],
                        "basis": "OT leave review spans more than four months; no partial impact proof is presented."}
            if start.year == 9999 and start.month == 12:
                return {"status": "not_evaluated", "context_digest": digest, "months": [],
                        "basis": "OT impact requires dates before December 9999."}
            start = start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1)
    reports = [compare_month(db, month, projections) for month in sorted(months)]
    return {"status": "evaluated" if all(report["changed"] is not None for report in reports) else "not_evaluated",
            "context_digest": digest, "months": reports,
            "basis": "Official approved-leave scenario; pending requests stay warnings until proposed as approved. "
                     "All units share identities. Incomplete contexts remain unknown; this does not reassign duties."}


def _summary(report):
    capacity = report.get("capacity")
    return {
        "status": report["status"], "code": report.get("code"),
        "reasons": report.get("reasons", []),
        "mandatory_required": capacity["mandatory_required"] if capacity else None,
        "mandatory_covered": capacity["mandatory_covered"] if capacity else None,
        "requirements": [{key: row[key] for key in
                          ("id", "minimum_shortage", "eligible_person_ids")}
                         for row in capacity["requirements"]] if capacity else [],
        "reserves": [{"id": row["id"], "minimum_shortage": row["minimum_shortage"]}
                     for row in capacity["reserves"]] if capacity else [],
    }


def compare_month(db, month, projections, *, include_pending=False, seconds=1.0):
    """Compare complete shared-unit contexts, retaining saved duties unchanged.

    `seconds` is the budget for each of two bounded solver checks, not a claimed
    total request deadline. Loading is bounded by the existing monthly context.
    Unknown configuration/timeouts never become an assertion of no impact.
    """
    month_bounds(month)
    projections = tuple(indexed_projections(projections).values())
    with db.no_autoflush:
        rules = read_phase_one_rules(db)
        basis = {"month": month, "scope": "all_units_month_and_boundary_rest",
                 "pending_stress": include_pending, "assignments_changed": False,
                 "basis": "Saved duties are retained; only specified leave identities are replaced. "
                          "This compares modeled OT minima and staffing reserves, not leave approval authority."}
        if rules is None:
            unknown = {"status": "not_evaluated", "code": "rota_rules_unconfigured",
                       "reasons": ["Configure Rota Rules before evaluating OT leave impact"],
                       "mandatory_required": None, "mandatory_covered": None, "requirements": [], "reserves": []}
            return {**basis, "before": dict(unknown), "after": dict(unknown), "changed": None}
        before_guard = load_assignment_guard(db, month, rules, include_pending=include_pending)
        after_guard = load_assignment_guard(db, month, rules, leave_projections=projections,
                                            include_pending=include_pending)
        guards = (before_guard, after_guard)
        demands = tuple(row for guard in guards for row in (*guard.requirements, *guard.reserves))
        assignments = []
        # Incomplete contexts cannot certify coverage. Their checker reports
        # unresolved immediately, so do not load an arbitrary partial duty set.
        if demands and any(guard.reviewed_complete and not guard.unresolved for guard in guards):
            first, last = min(row.starts_at for row in demands), max(row.ends_at for row in demands)
            buffer = timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours + 48)
            assignments = list(db.scalars(select(DutyAssignment).join(DutyAssignment.duty_slot)
                .outerjoin(DutySlot.rota_period).where(
                    func.lower(DutyAssignment.status).in_(ACTIVE_ASSIGNMENT_STATUSES),
                    DutySlot.ends_at >= first - buffer, DutySlot.starts_at < last,
                    or_(DutySlot.source == PHASE4_SLOT_SOURCE, RotaPeriod.status.in_(OFFICIAL_STATUSES)),
                ).options(selectinload(DutyAssignment.duty_slot)).limit(5001)))
            if len(assignments) > 5000:
                unknown = {"status": "not_evaluated", "code": "ot_impact_resource_limit",
                           "reasons": ["OT leave impact exceeds 5000 saved assignments"],
                           "mandatory_required": None, "mandatory_covered": None, "requirements": [], "reserves": []}
                return {**basis, "before": dict(unknown), "after": dict(unknown), "changed": None}
        before, after = (_summary(guard.check(assignments, rules, seconds=seconds)) for guard in guards)
        comparable = all(row["status"] in {"feasible", "infeasible"} for row in (before, after))
        return {**basis, "before": before, "after": after,
                # Solver witnesses can distribute an existing shortage among
                # interchangeable roles differently. Do not treat that choice
                # as a deterministic change caused by the proposed leave.
                "changed": before_guard.people != after_guard.people if comparable else None,
                "change_basis": "Change in canonical leave availability; compare coverage separately. "
                                "A changed leave interval can be redundant with an existing duty/rest block."}
