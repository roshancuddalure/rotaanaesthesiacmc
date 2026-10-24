"""Rota review aggregation, warning acceptance and exchange (swap) requests.

Review items per slot: open slot, template review, safety review/hard block, override
assignment. Warnings can be accepted with a note (``RotaReviewDecision``); hard blocks and
open slots cannot. Exchanges are validated at request time and re-validated on approval.

Note (handbook B8): approval replaces whoever currently holds the slot, without checking
that it is still the assignment the request was made against.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.services.member_profile import default_call_level_on
from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    PersonPosting,
    RotaExchangeRequest,
    RotaReviewDecision,
    UserAccount,
)
from app.services.leave import month_bounds
from app.services.rota_assignment import (
    RotaAssignmentError,
    active_assignment,
    assign_person_to_slot,
    assignment_to_dict,
    hydrate_assignment,
    hydrate_slot,
    validate_assignment,
)
from app.services.rota_call_levels import normalize_call_level
from app.services.rota_safety import SAFETY_HARD_BLOCK, SAFETY_WARNING, month_safety
from app.services.rota_setup import monthly_setup
from app.services.rota_template import NEEDS_REVIEW, slot_to_dict, template_slots_for_period
from app.services.unit_management import monthly_unit_assignments

EXCHANGE_SOURCE = "exchange_approved"
EXCHANGE_PENDING = "pending_approval"
EXCHANGE_NEEDS_OVERRIDE = "needs_override"
EXCHANGE_BLOCKED = "blocked"
EXCHANGE_APPROVED = "approved"
EXCHANGE_REJECTED = "rejected"

# docs/extra_duty_contract.md §5/§8: plain words for the rules the extra-duty layer may override.
EXTRA_DUTY_RULE_LABELS = {
    "unit_safety_hard_block": "Unit short-staffed (hard block)",
    "unit_safety_review": "Unit staffing warning",
    "monthly_24hr_limit": "Over monthly 24-hour limit",
    "monthly_weekend_24hr_limit": "Over weekend 24-hour limit",
    "monthly_same_group_limit": "Over monthly limit for this duty type",
    "monthly_same_campus_limit": "Over monthly limit for this campus",
    # docs/extra_duty_fill_all_contract.md §3/§6 (fill-all "all units" mode).
    "fallback_unit": "Covered a duty for another unit",
    "any_unit": "Covered from another unit",
    "outside_scope_unit": "Covered from a unit outside this month's scope",
    "unposted_member": "Member has no posting this month",
    "unit_rule": "Duty not allowed for this unit",
    # docs/superadmin_override_contract.md section 2.
    "superadmin_allocation": "Superadmin allocation",
}

# docs/superadmin_override_contract.md section 2: a superadmin allocation is reviewed as a
# warning ("Superadmin allocation by X: reason"), never as a hard block.
SUPERADMIN_SOURCE = "superadmin_allocation"
SUPERADMIN_REASON_PREFIX = "Superadmin allocation:"

OVER_LIMIT_DETAIL_NAMES = 5


class RotaReviewError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def active_slot_assignments(slot: DutySlot) -> list[DutyAssignment]:
    return [assignment for assignment in slot.assignments if active_assignment(assignment)]


def slot_identity(slot: DutySlot) -> dict[str, object]:
    return {
        "id": str(slot.id),
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "slot_label": slot.slot_label,
        "call_level": slot.call_level,
        "template_status": slot.template_status,
        "template_reason": slot.template_reason,
    }


def review_decision_to_dict(decision: RotaReviewDecision | None) -> dict[str, object] | None:
    if decision is None:
        return None
    return {
        "id": str(decision.id),
        "issue_code": decision.issue_code,
        "decision_type": decision.decision_type,
        "note": decision.note,
        "decided_by": decision.decided_by.display_name if decision.decided_by else None,
        "created_at": decision.created_at.isoformat(),
        "updated_at": decision.updated_at.isoformat(),
    }


def review_issue(
    severity: str,
    code: str,
    message: str,
    decision: RotaReviewDecision | None = None,
) -> dict[str, object]:
    return {
        "severity": severity,
        "code": code,
        "message": message,
        "decision": review_decision_to_dict(decision),
        "accepted": decision is not None,
    }


def compact_safety(row: dict[str, object] | None) -> dict[str, object] | None:
    if row is None:
        return None
    return {
        "slot_id": row.get("slot_id"),
        "safety_status": row.get("safety_status"),
        "reasons": row.get("reasons", []),
        "eligible_members": row.get("eligible_members", 0),
        "available_members": row.get("available_members", 0),
        "hard_blocked_members": row.get("hard_blocked_members", 0),
        "warning_members": row.get("warning_members", 0),
    }


def recommended_action(issues: list[dict[str, str]]) -> str:
    codes = {issue["code"] for issue in issues}
    if "call_level_changed" in codes:
        return "Replace this member with someone on the duty's call level before publishing."
    if "hard_blocked" in codes:
        return "Resolve blockers or document a deliberate board override before assigning."
    if "superadmin_allocation" in codes:
        return "Confirm the superadmin allocation before publishing."
    if "extra_duty_exception" in codes:
        return "Confirm the extra-duty layer's cover for this short-staffed slot before publishing."
    if "open_slot" in codes:
        return "Assign a safe suggestion or use manual assignment with an override reason if needed."
    if "override_assignment" in codes:
        return "Confirm the override reason is acceptable for final approval."
    return "Review the warning and decide whether to keep, change, or override this slot."


def review_decisions_for_slots(db: Session, slots: list[DutySlot]) -> dict[tuple[UUID, str], RotaReviewDecision]:
    slot_ids = [slot.id for slot in slots]
    if not slot_ids:
        return {}
    decisions = db.scalars(
        select(RotaReviewDecision)
        .where(RotaReviewDecision.duty_slot_id.in_(slot_ids))
        .options(selectinload(RotaReviewDecision.decided_by))
    )
    return {(decision.duty_slot_id, decision.issue_code): decision for decision in decisions}


def active_extra_duty_records(db: Session, slots: list[DutySlot]) -> dict[UUID, ExtraDutyRecord]:
    """Active ledger records keyed by assignment id, for the slots' active assignments."""
    assignment_ids = [a.id for slot in slots for a in active_slot_assignments(slot)]
    if not assignment_ids:
        return {}
    records: dict[UUID, ExtraDutyRecord] = {}
    for start in range(0, len(assignment_ids), 500):
        chunk = assignment_ids[start:start + 500]
        for record in db.scalars(
            select(ExtraDutyRecord).where(
                ExtraDutyRecord.assignment_id.in_(chunk), ExtraDutyRecord.status == "active"
            )
        ):
            records[record.assignment_id] = record
    return records


def superadmin_allocations(
    db: Session,
    slots: list[DutySlot],
    extra_duty_by_assignment: dict[UUID, ExtraDutyRecord],
) -> dict[UUID, dict[str, object]]:
    """Active superadmin allocations by assignment id, with who made them and why (from the
    allocation's ``ExtraDutyBatch`` summary; falls back to the assignment's override reason)."""
    pairs = [
        (slot, assignment)
        for slot in slots
        for assignment in active_slot_assignments(slot)
        if assignment.source == SUPERADMIN_SOURCE
    ]
    if not pairs:
        return {}
    batch_ids = {
        extra_duty_by_assignment[a.id].batch_id for _slot, a in pairs if a.id in extra_duty_by_assignment
    }
    batches = (
        {batch.id: batch for batch in db.scalars(select(ExtraDutyBatch).where(ExtraDutyBatch.id.in_(batch_ids)))}
        if batch_ids
        else {}
    )
    rows: dict[UUID, dict[str, object]] = {}
    for slot, assignment in pairs:
        record = extra_duty_by_assignment.get(assignment.id)
        batch = batches.get(record.batch_id) if record is not None else None
        summary = dict(batch.summary or {}) if batch is not None else {}
        reason = summary.get("reason")
        if not reason:
            reason = (assignment.override_reason or "").strip()
            if reason.startswith(SUPERADMIN_REASON_PREFIX):
                reason = reason[len(SUPERADMIN_REASON_PREFIX):].strip()
        created = batch.created_at if batch is not None else assignment.created_at
        rows[assignment.id] = {
            "assignment_id": str(assignment.id),
            "slot_id": str(slot.id),
            "duty_date": slot.duty_date.isoformat(),
            "duty_type": slot.duty_type,
            "slot_label": slot.slot_label,
            "unit_name": slot.unit.name if slot.unit else None,
            "person_id": str(assignment.person_id),
            "person_name": assignment.person.canonical_name if assignment.person else None,
            "by": summary.get("by") or (batch.created_by_name if batch is not None else None),
            "reason": reason or None,
            "post_publish": bool(summary.get("post_publish")),
            "overridden_rules": list(record.overridden_rules or []) if record is not None else [SUPERADMIN_SOURCE],
            "batch_id": str(batch.id) if batch is not None else None,
            "created_at": created.isoformat() if created else None,
        }
    return rows


def call_level_mismatches(db: Session, month: str, slots: list[DutySlot]) -> dict[UUID, dict[str, object]]:
    """Active assignments in ``month`` whose member's call level (on the duty date) is not in the
    duty's level set (a pool allows each of its levels), or whose duty has no level at all, by
    assignment id (docs/call_level_pool_and_balance_contract.md section 1). Typically appears
    after a promotion.

    ``{assignment_id: {assignment_id, slot_id, duty_date, duty_type, slot_label, unit_name,
    person_id, person_name, source, superadmin, required_call_level, required_call_levels,
    person_call_level, message}}``. ``required_call_level`` is the single level or ``None``
    (pool or unresolved), for display only.
    """
    from app.services.rota_eligibility import (
        describe_level,
        describe_levels,
        member_call_level,
        required_call_levels,
    )
    from app.services.rota_rules import get_phase_one_rules
    from app.services.rota_safety import (
        MemberContext,
        member_contexts_for_day,
        postings_for_month,
        rule_for_slot,
        rules_groups,
    )

    starts_on, ends_on = month_bounds(month)
    pairs = [
        (slot, assignment)
        for slot in slots
        if starts_on <= slot.duty_date <= ends_on
        for assignment in active_slot_assignments(slot)
    ]
    if not pairs:
        return {}
    _version, rules = get_phase_one_rules(db)
    postings = postings_for_month(db, starts_on, ends_on)
    contexts_by_day: dict = {}
    rows: dict[UUID, dict[str, object]] = {}
    for slot, assignment in pairs:
        person = assignment.person
        if person is None:
            continue
        day = slot.duty_date
        if day not in contexts_by_day:
            by_person: dict = defaultdict(list)
            for context in member_contexts_for_day(postings, day):
                by_person[context.person.id].append(context)
            contexts_by_day[day] = by_person
        contexts = contexts_by_day[day].get(person.id, [])
        context = next((c for c in contexts if c.unit_id == slot.unit_id), None) or (
            contexts[0] if contexts else MemberContext(person, slot.unit_id, person.call_level or "", day)
        )
        rule = rule_for_slot(slot, rules)
        required = required_call_levels(slot, rule, rules_groups(rules, slot))
        level = member_call_level(context)
        if level in required:
            continue
        name = person.canonical_name
        superadmin = assignment.source == SUPERADMIN_SOURCE
        if not required:
            detail = f"this duty has no call level (set one in Rota Rules); {name} is {describe_level(level)}"
        else:
            detail = f"{name} is now {describe_level(level)}; the duty needs {describe_levels(required)}"
        message = (
            f"Call level crossed by superadmin: {detail}"
            if superadmin
            else f"Call level no longer matches: {detail}"
        )
        rows[assignment.id] = {
            "assignment_id": str(assignment.id),
            "slot_id": str(slot.id),
            "duty_date": day.isoformat(),
            "duty_type": slot.duty_type,
            "slot_label": slot.slot_label,
            "unit_name": slot.unit.name if slot.unit else None,
            "person_id": str(person.id),
            "person_name": name,
            "source": assignment.source,
            "superadmin": superadmin,
            "required_call_level": next(iter(required)) if len(required) == 1 else None,
            "required_call_levels": sorted(required),
            "person_call_level": level,
            "message": message,
        }
    return rows


def superadmin_allocation_message(rows: list[dict[str, object]]) -> str:
    parts = []
    for row in rows:
        text = f"Superadmin allocation by {row.get('by') or 'a superadmin'}: {row.get('reason') or 'no reason recorded'}"
        if row.get("person_name"):
            text += f" ({row['person_name']})"
        parts.append(text)
    return "; ".join(parts) + "."


def extra_duty_exception_message(assignments: list[DutyAssignment], records: list[ExtraDutyRecord]) -> str:
    names = ", ".join(
        a.person.canonical_name if a.person else str(a.person_id)
        for a in assignments
        if any(r.assignment_id == a.id for r in records)
    )
    rules = list(dict.fromkeys(code for r in records for code in (r.overridden_rules or [])))
    overridden = ", ".join(EXTRA_DUTY_RULE_LABELS.get(code, code) for code in rules) or "none"
    return f"Covered by the extra-duty layer: {names}; rules overridden: {overridden}."


def extra_duty_pressure(slots: list[DutySlot], extra_duty_by_assignment: dict[UUID, ExtraDutyRecord]):
    """(unit, day) pairs whose staffing the extra-duty layer stretched: the day of each ledgered extra
    duty and, for its rest, the next day. A filled slot hard-blocked there is a consequence of
    the owner-approved staffing override, not an unsafe assignment of its own."""
    pressure: set[tuple[UUID | None, object]] = set()
    for slot in slots:
        if any(a.id in extra_duty_by_assignment for a in active_slot_assignments(slot)):
            pressure.add((slot.unit_id, slot.duty_date))
            pressure.add((slot.unit_id, slot.duty_date + timedelta(days=1)))
    return pressure


def individual_limit_breaches(db: Session, month: str, rules=None) -> list[dict[str, object]]:
    """Members above an individual duty limit in the saved month (fill-all contract §4/§6):
    the planner's shared helper, imported lazily (``extra_duty`` is a heavier module)."""
    from app.services.extra_duty import individual_limit_breaches as shared

    return list(shared(db, month, rules))


def over_limit_detail(people: list[dict[str, object]]) -> str:
    """Checklist text: "N member(s) above an individual duty limit: Name (24-hour 7/6), ...",
    at most five names then "and N more" (contract §6)."""
    parts = []
    for person in people[:OVER_LIMIT_DETAIL_NAMES]:
        limits = ", ".join(
            f"{item.get('label') or item.get('code')} {item.get('actual')}/{item.get('limit')}"
            for item in person.get("limits") or []
        )
        parts.append(f"{person.get('person_name')} ({limits})" if limits else str(person.get("person_name")))
    text = f"{len(people)} member(s) above an individual duty limit: " + ", ".join(parts)
    if len(people) > OVER_LIMIT_DETAIL_NAMES:
        text += f" and {len(people) - OVER_LIMIT_DETAIL_NAMES} more"
    return text


def review_items(
    slots: list[DutySlot],
    safety_by_slot: dict[str, dict[str, object]],
    candidates_by_slot: dict[str, dict[str, object]],
    decisions_by_slot_issue: dict[tuple[UUID, str], RotaReviewDecision] | None = None,
    extra_duty_by_assignment: dict[UUID, ExtraDutyRecord] | None = None,
    superadmin_by_assignment: dict[UUID, dict[str, object]] | None = None,
    call_level_by_assignment: dict[UUID, dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    """``extra_duty_by_assignment``: active ledger records by assignment id; a hard-blocked slot
    covered by such an assignment becomes an ``extra_duty_exception`` warning (contract §5).
    So does a filled slot hard-blocked only because extra duties stretched its unit that day.
    ``superadmin_by_assignment`` (``superadmin_allocations``): a slot held by a superadmin
    allocation gets a ``superadmin_allocation`` warning instead of ``hard_blocked``.
    ``call_level_by_assignment`` (``call_level_mismatches``): an assignment on a different call
    level is the error ``call_level_changed``, or the warning ``superadmin_cross_level`` when a
    superadmin allocation crossed the level on purpose."""
    rows: list[dict[str, object]] = []
    call_level_by_assignment = call_level_by_assignment or {}
    decisions_by_slot_issue = decisions_by_slot_issue or {}
    extra_duty_by_assignment = extra_duty_by_assignment or {}
    superadmin_by_assignment = superadmin_by_assignment or {}
    pressure = extra_duty_pressure(slots, extra_duty_by_assignment)
    for slot in slots:
        slot_id = str(slot.id)
        safety = safety_by_slot.get(slot_id)
        assignments = active_slot_assignments(slot)
        issues: list[dict[str, str]] = []

        if not assignments:
            issues.append(
                review_issue(
                    "warning",
                    "open_slot",
                    "This generated rota slot is still open.",
                    decisions_by_slot_issue.get((slot.id, "open_slot")),
                )
            )

        if slot.template_status == NEEDS_REVIEW:
            issues.append(
                review_issue(
                    "warning",
                    "template_review",
                    slot.template_reason or "This generated slot needs rota board review.",
                    decisions_by_slot_issue.get((slot.id, "template_review")),
                )
            )

        superadmin_rows = [
            superadmin_by_assignment.get(a.id)
            or {"by": None, "reason": None, "person_name": a.person.canonical_name if a.person else None}
            for a in assignments
            if a.source == SUPERADMIN_SOURCE
        ]
        if superadmin_rows:
            issues.append(
                review_issue(
                    "warning",
                    "superadmin_allocation",
                    superadmin_allocation_message(superadmin_rows),
                    decisions_by_slot_issue.get((slot.id, "superadmin_allocation")),
                )
            )

        if safety:
            safety_status = str(safety.get("safety_status"))
            reasons = [str(reason) for reason in safety.get("reasons", [])]
            extra_records = [
                extra_duty_by_assignment[a.id] for a in assignments if a.id in extra_duty_by_assignment
            ]
            if superadmin_rows:
                pass  # the superadmin_allocation warning covers this slot's safety state
            elif safety_status == SAFETY_HARD_BLOCK and extra_records:
                issues.append(
                    review_issue(
                        "warning",
                        "extra_duty_exception",
                        extra_duty_exception_message(assignments, extra_records),
                        decisions_by_slot_issue.get((slot.id, "extra_duty_exception")),
                    )
                )
            elif safety_status == SAFETY_HARD_BLOCK and assignments and (slot.unit_id, slot.duty_date) in pressure:
                issues.append(
                    review_issue(
                        "warning",
                        "extra_duty_exception",
                        "Unit staffing limit exceeded on this day because the extra-duty layer used "
                        "this unit's members (see the ledger). This duty's own member is not on leave "
                        "or resting. " + " ".join(reasons),
                        decisions_by_slot_issue.get((slot.id, "extra_duty_exception")),
                    )
                )
            elif safety_status == SAFETY_HARD_BLOCK:
                issues.append(
                    review_issue(
                        "error",
                        "hard_blocked",
                        " ".join(reasons) or "This slot is hard blocked by current safety rules.",
                    )
                )
            elif safety_status == SAFETY_WARNING:
                issues.append(
                    review_issue(
                        "warning",
                        "safety_review",
                        " ".join(reasons) or "This slot needs staffing review.",
                        decisions_by_slot_issue.get((slot.id, "safety_review")),
                    )
                )

        for assignment in assignments:
            mismatch = call_level_by_assignment.get(assignment.id)
            if mismatch is None:
                continue
            if mismatch["superadmin"]:
                issues.append(
                    review_issue(
                        "warning",
                        "superadmin_cross_level",
                        str(mismatch["message"]),
                        decisions_by_slot_issue.get((slot.id, "superadmin_cross_level")),
                    )
                )
            else:
                issues.append(review_issue("error", "call_level_changed", str(mismatch["message"])))

        for assignment in assignments:
            if assignment.override_reason and assignment.source != SUPERADMIN_SOURCE:
                issues.append(
                    review_issue(
                        "warning",
                        "override_assignment",
                        f"{assignment.person.canonical_name} was assigned with override: "
                        f"{assignment.override_reason}",
                        decisions_by_slot_issue.get((slot.id, "override_assignment")),
                    )
                )

        if not issues:
            continue

        severity = "error" if any(issue["severity"] == "error" for issue in issues) else "warning"
        rows.append(
            {
                "slot": slot_identity(slot),
                "severity": severity,
                "issues": issues,
                "accepted": severity != "error" and all(bool(issue.get("accepted")) for issue in issues),
                "safety": compact_safety(safety),
                "assignments": [assignment_to_dict(assignment) for assignment in assignments],
                "candidates": (candidates_by_slot.get(slot_id) or {}).get("candidates", []),
                "recommended_action": recommended_action(issues),
            }
        )
    return rows


def assignment_exchange_option(assignment: DutyAssignment) -> dict[str, object]:
    slot = assignment.duty_slot
    return {
        "assignment": assignment_to_dict(assignment),
        "slot": slot_identity(slot),
        "label": (
            f"{slot.duty_date.isoformat()} / {slot.unit.name if slot.unit else 'No unit'} / "
            f"{slot.duty_type} / {assignment.person.canonical_name}"
        ),
    }


def person_workload_rows(
    assignments: list[DutyAssignment],
    postings: list[PersonPosting],
) -> list[dict[str, object]]:
    grouped: dict[UUID, dict[str, object]] = {}
    for posting in postings:
        if posting.person.active_status != "active":
            continue
        grouped.setdefault(
            posting.person_id,
            {
                "person_id": str(posting.person_id),
                "person_name": posting.person.canonical_name,
                "call_level": normalize_call_level(posting.posting_type or default_call_level_on(posting.person, posting.starts_on)),
                "total_assignments": 0,
                "total_24hr": 0,
                "weekday_assignments": 0,
                "weekend_assignments": 0,
                "weekend_24hr": 0,
                "override_assignments": 0,
                "group_counts": {},
                "assignments": [],
            },
        )
    for assignment in assignments:
        if not active_assignment(assignment):
            continue
        row = grouped.setdefault(
            assignment.person_id,
            {
                "person_id": str(assignment.person_id),
                "person_name": assignment.person.canonical_name,
                "call_level": assignment.person.call_level,
                "total_assignments": 0,
                "total_24hr": 0,
                "weekday_assignments": 0,
                "weekend_assignments": 0,
                "weekend_24hr": 0,
                "override_assignments": 0,
                "group_counts": {},
                "assignments": [],
            },
        )
        slot = assignment.duty_slot
        # Family = first token of the duty key, not the rule's `group` (e.g. MAIN_PAC_* counts
        # as "main" here but "pac" elsewhere) - handbook B18.
        duty_group = slot.duty_type.split("_", 1)[0].lower()
        group_counts = row["group_counts"]
        assert isinstance(group_counts, dict)
        row["total_assignments"] = int(row["total_assignments"]) + 1
        row["total_24hr"] = int(row["total_24hr"]) + int(slot.is_24hr)
        row["weekday_assignments"] = int(row["weekday_assignments"]) + int(slot.duty_date.weekday() < 5)
        row["weekend_assignments"] = int(row["weekend_assignments"]) + int(slot.duty_date.weekday() >= 5)
        row["weekend_24hr"] = int(row["weekend_24hr"]) + int(slot.is_24hr and slot.duty_date.weekday() >= 5)
        row["override_assignments"] = int(row["override_assignments"]) + int(bool(assignment.override_reason))
        group_counts[duty_group] = int(group_counts.get(duty_group, 0)) + 1
        row["assignments"].append(
            {
                "assignment_id": str(assignment.id),
                "slot_id": str(slot.id),
                "duty_date": slot.duty_date.isoformat(),
                "duty_type": slot.duty_type,
                "unit_name": slot.unit.name if slot.unit else None,
                "override_reason": assignment.override_reason,
            }
        )
    return sorted(
        grouped.values(),
        key=lambda item: (
            str(item["call_level"]),
            -int(item["total_24hr"]),
            -int(item["total_assignments"]),
            -int(item["weekend_24hr"]),
            str(item["person_name"]),
        ),
    )


def call_level_fairness_rows(workload: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in workload:
        grouped[normalize_call_level(str(row.get("call_level") or ""))].append(row)
    fairness: list[dict[str, object]] = []
    for call_level, rows in grouped.items():
        if not rows:
            continue
        total_people = len(rows)
        total_assignments = sum(int(row["total_assignments"]) for row in rows)
        total_24hr = sum(int(row["total_24hr"]) for row in rows)
        weekend_24hr = sum(int(row["weekend_24hr"]) for row in rows)
        average = round(total_assignments / total_people, 2) if total_people else 0
        high_threshold = average + 1.5
        low_threshold = max(0, average - 1.5)
        over_assigned = [
            row
            for row in rows
            if int(row["total_assignments"]) > high_threshold and int(row["total_assignments"]) > 0
        ]
        under_assigned = [
            row
            for row in rows
            if int(row["total_assignments"]) < low_threshold
        ]
        group_totals: dict[str, int] = defaultdict(int)
        for row in rows:
            for group, count in dict(row.get("group_counts", {})).items():
                group_totals[str(group)] += int(count)
        fairness.append(
            {
                "call_level": call_level,
                "people": total_people,
                "total_assignments": total_assignments,
                "average_assignments": average,
                "total_24hr": total_24hr,
                "weekend_24hr": weekend_24hr,
                "over_assigned": [
                    {
                        "person_id": row["person_id"],
                        "person_name": row["person_name"],
                        "total_assignments": row["total_assignments"],
                        "total_24hr": row["total_24hr"],
                        "weekend_24hr": row["weekend_24hr"],
                    }
                    for row in sorted(over_assigned, key=lambda item: (-int(item["total_assignments"]), str(item["person_name"])))
                ],
                "under_assigned": [
                    {
                        "person_id": row["person_id"],
                        "person_name": row["person_name"],
                        "total_assignments": row["total_assignments"],
                        "total_24hr": row["total_24hr"],
                        "weekend_24hr": row["weekend_24hr"],
                    }
                    for row in sorted(under_assigned, key=lambda item: (int(item["total_assignments"]), str(item["person_name"])))
                ],
                "group_totals": dict(sorted(group_totals.items())),
            }
        )
    return sorted(fairness, key=lambda row: str(row["call_level"]))


def exchange_status_from_validation(validation: dict[str, object]) -> str:
    if validation.get("status") == "blocked":
        return EXCHANGE_BLOCKED
    if validation.get("requires_override"):
        return EXCHANGE_NEEDS_OVERRIDE
    return EXCHANGE_PENDING


def exchange_request_to_dict(exchange: RotaExchangeRequest) -> dict[str, object]:
    return {
        "id": str(exchange.id),
        "rota_period_id": str(exchange.rota_period_id),
        "from_assignment_id": str(exchange.from_assignment_id) if exchange.from_assignment_id else None,
        "from_slot": slot_identity(exchange.from_slot) if exchange.from_slot else None,
        "from_person": (
            {
                "id": str(exchange.from_person.id),
                "canonical_name": exchange.from_person.canonical_name,
                "call_level": exchange.from_person.call_level,
            }
            if exchange.from_person
            else None
        ),
        "to_person": (
            {
                "id": str(exchange.to_person.id),
                "canonical_name": exchange.to_person.canonical_name,
                "call_level": exchange.to_person.call_level,
            }
            if exchange.to_person
            else None
        ),
        "requested_by": exchange.requested_by.display_name if exchange.requested_by else None,
        "approved_by": exchange.approved_by.display_name if exchange.approved_by else None,
        "applied_assignment_id": str(exchange.applied_assignment_id) if exchange.applied_assignment_id else None,
        "status": exchange.status,
        "request_reason": exchange.request_reason,
        "decision_reason": exchange.decision_reason,
        "validation_status": exchange.validation_status,
        "validation_snapshot": exchange.validation_snapshot,
        "created_at": exchange.created_at.isoformat(),
        "decided_at": exchange.decided_at.isoformat() if exchange.decided_at else None,
    }


def exchange_requests_for_period(db: Session, rota_period_id: UUID) -> list[RotaExchangeRequest]:
    return list(
        db.scalars(
            select(RotaExchangeRequest)
            .where(RotaExchangeRequest.rota_period_id == rota_period_id)
            .options(
                selectinload(RotaExchangeRequest.from_slot).selectinload(DutySlot.unit),
                selectinload(RotaExchangeRequest.from_person),
                selectinload(RotaExchangeRequest.to_person),
                selectinload(RotaExchangeRequest.requested_by),
                selectinload(RotaExchangeRequest.approved_by),
            )
            .order_by(RotaExchangeRequest.created_at.desc())
        )
    )


def rota_review_month(db: Session, month: str) -> dict[str, object]:
    """Everything the Rota Review screen and the publish checklist need for one month."""
    starts_on, ends_on = month_bounds(month)
    period, scope = monthly_setup(db, month)
    slots = template_slots_for_period(db, period.id)
    safety = month_safety(db, month)
    active_assignments = [
        assignment
        for slot in slots
        for assignment in active_slot_assignments(slot)
        if starts_on <= slot.duty_date <= ends_on
    ]
    unit_postings = monthly_unit_assignments(db, month)
    workload = person_workload_rows(active_assignments, unit_postings)
    fairness = call_level_fairness_rows(workload)
    safety_by_slot = {str(row["slot_id"]): row for row in safety["slots"]}
    # Keep the review dashboard fast. Candidate scoring validates many people per slot and can
    # make this overview feel stuck on real months; detailed suggestions are loaded in the rota
    # day modal where the board is actively working on a specific day.
    candidates_by_slot: dict[str, dict[str, object]] = {}
    decisions_by_slot_issue = review_decisions_for_slots(db, slots)
    extra_duty_by_assignment = active_extra_duty_records(db, slots)
    superadmin_by_assignment = superadmin_allocations(db, slots, extra_duty_by_assignment)
    call_level_by_assignment = call_level_mismatches(db, month, slots)
    items = review_items(
        slots,
        safety_by_slot,
        candidates_by_slot,
        decisions_by_slot_issue,
        extra_duty_by_assignment,
        superadmin_by_assignment,
        call_level_by_assignment,
    )
    exchange_requests = exchange_requests_for_period(db, period.id)
    exchange_counts = defaultdict(int)
    for exchange in exchange_requests:
        exchange_counts[exchange.status] += 1
    assigned_slots = sum(1 for slot in slots if active_slot_assignments(slot))
    over_limit_people = individual_limit_breaches(db, month)
    unresolved_warning_items = sum(
        1
        for item in items
        if item["severity"] != "error" and not item.get("accepted")
    )

    return {
        "month": month,
        "rota_period": {
            "id": str(period.id),
            "name": period.name,
            "starts_on": period.starts_on.isoformat(),
            "ends_on": period.ends_on.isoformat(),
            "status": period.status,
        },
        "scope": {"id": str(scope.id), "is_locked": scope.is_locked},
        "summary": {
            "total_slots": len(slots),
            "assigned_slots": assigned_slots,
            "open_slots": max(0, len(slots) - assigned_slots),
            "review_items": len(items),
            "hard_blocked_items": sum(1 for item in items if item["severity"] == "error"),
            "accepted_review_items": sum(1 for item in items if item.get("accepted")),
            "unresolved_warning_items": unresolved_warning_items,
            "override_assignments": sum(1 for item in active_assignments if item.override_reason),
            "extra_duty_records": sum(1 for item in active_assignments if item.id in extra_duty_by_assignment),
            "extra_duty_exception_items": sum(
                1 for item in items if any(i["code"] == "extra_duty_exception" for i in item["issues"])
            ),
            "exchange_requests": len(exchange_requests),
            "pending_exchange_requests": exchange_counts[EXCHANGE_PENDING]
            + exchange_counts[EXCHANGE_NEEDS_OVERRIDE],
            "fairness_call_levels": len(fairness),
            "over_assigned_people": sum(len(row["over_assigned"]) for row in fairness),
            "under_assigned_people": sum(len(row["under_assigned"]) for row in fairness),
            "over_limit_members": len(over_limit_people),
            "superadmin_allocations": len(superadmin_by_assignment),
            # Strict call level (limits contract section 1); Agent 2's publish blocker reads it.
            "call_level_mismatch_items": sum(
                1 for item in items if any(i["code"] == "call_level_changed" for i in item["issues"])
            ),
            "superadmin_cross_level_items": sum(
                1 for row in call_level_by_assignment.values() if row["superadmin"]
            ),
        },
        "over_limit_people": over_limit_people,
        "superadmin_allocations": sorted(
            superadmin_by_assignment.values(),
            key=lambda row: (str(row["duty_date"]), str(row["duty_type"]), str(row["person_name"] or "")),
        ),
        "superadmin_cross_level": sorted(
            (row for row in call_level_by_assignment.values() if row["superadmin"]),
            key=lambda row: (str(row["duty_date"]), str(row["duty_type"]), str(row["person_name"] or "")),
        ),
        "review_items": items,
        "person_workload": workload,
        "call_level_fairness": fairness,
        "exchange_requests": [exchange_request_to_dict(exchange) for exchange in exchange_requests],
        "assignment_options": [assignment_exchange_option(assignment) for assignment in active_assignments],
    }


ACCEPTABLE_REVIEW_DECISION_CODES = {
    "template_review",
    "safety_review",
    "override_assignment",
    "extra_duty_exception",
    "superadmin_allocation",
    "superadmin_cross_level",
}


def accept_review_issue(
    db: Session,
    *,
    slot_id: UUID,
    issue_code: str,
    note: str,
    decided_by: UserAccount,
) -> dict[str, object]:
    clean_note = note.strip()
    clean_code = issue_code.strip()
    if not clean_note:
        raise RotaReviewError("Review decision note is required")
    if clean_code not in ACCEPTABLE_REVIEW_DECISION_CODES:
        raise RotaReviewError("Only warning/review issues can be accepted from Rota Review")
    slot = hydrate_slot(db, slot_id)
    if slot.rota_period_id is None:
        raise RotaReviewError("Review slot is not linked to a rota period")
    existing = db.scalars(
        select(RotaReviewDecision).where(
            RotaReviewDecision.duty_slot_id == slot.id,
            RotaReviewDecision.issue_code == clean_code,
        )
    ).first()
    decision_type = "confirmed_override" if clean_code == "override_assignment" else "accepted_warning"
    if existing is None:
        existing = RotaReviewDecision(
            rota_period_id=slot.rota_period_id,
            duty_slot_id=slot.id,
            issue_code=clean_code,
        )
        db.add(existing)
    existing.decision_type = decision_type
    existing.note = clean_note
    existing.decided_by_user_id = decided_by.id
    existing.updated_at = datetime.utcnow()
    db.commit()
    refreshed = db.scalars(
        select(RotaReviewDecision)
        .where(RotaReviewDecision.id == existing.id)
        .options(selectinload(RotaReviewDecision.decided_by))
    ).one()
    return review_decision_to_dict(refreshed) or {}


def create_exchange_request(
    db: Session,
    *,
    assignment_id: UUID,
    to_person_id: UUID,
    reason: str,
    requested_by: UserAccount,
) -> dict[str, object]:
    clean_reason = reason.strip()
    if not clean_reason:
        raise RotaReviewError("Exchange reason is required")
    assignment = hydrate_assignment(db, assignment_id)
    slot = hydrate_slot(db, assignment.duty_slot_id)
    to_person = db.get(Person, to_person_id)
    if to_person is None:
        raise RotaReviewError("Target member not found", status_code=404)
    if assignment.person_id == to_person.id:
        raise RotaReviewError("Choose a different member for the exchange")
    if slot.rota_period_id is None:
        raise RotaReviewError("Assignment is not linked to a rota period")

    validation = validate_assignment(db, slot=slot, person=to_person, replace_existing=True)
    exchange = RotaExchangeRequest(
        rota_period_id=slot.rota_period_id,
        from_assignment_id=assignment.id,
        from_slot_id=slot.id,
        from_person_id=assignment.person_id,
        to_person_id=to_person.id,
        requested_by_user_id=requested_by.id,
        status=exchange_status_from_validation(validation),
        request_reason=clean_reason,
        validation_status=str(validation.get("status", "clear")),
        validation_snapshot={
            "validation": validation,
            "from_assignment": assignment_to_dict(assignment),
            "slot": slot_to_dict(slot),
        },
    )
    db.add(exchange)
    db.commit()
    return exchange_request_to_dict(hydrate_exchange_request(db, exchange.id))


def hydrate_exchange_request(db: Session, exchange_id: UUID) -> RotaExchangeRequest:
    exchange = db.scalars(
        select(RotaExchangeRequest)
        .where(RotaExchangeRequest.id == exchange_id)
        .options(
            selectinload(RotaExchangeRequest.from_slot).selectinload(DutySlot.unit),
            selectinload(RotaExchangeRequest.from_person),
            selectinload(RotaExchangeRequest.to_person),
            selectinload(RotaExchangeRequest.requested_by),
            selectinload(RotaExchangeRequest.approved_by),
        )
    ).first()
    if exchange is None:
        raise RotaReviewError("Exchange request not found", status_code=404)
    return exchange


def approve_exchange_request(
    db: Session,
    *,
    exchange_id: UUID,
    approved_by: UserAccount,
    decision_reason: str | None = None,
) -> dict[str, object]:
    """Apply an exchange: re-validate and put ``to_person`` on the slot (replacing the holder).

    KNOWN ISSUE (handbook B8): does not check that ``from_assignment_id`` is still the slot's
    active assignment, so a stale request replaces whoever holds the slot now; the requester
    may also approve their own request.
    """
    exchange = hydrate_exchange_request(db, exchange_id)
    if exchange.status in {EXCHANGE_APPROVED, EXCHANGE_REJECTED}:
        raise RotaReviewError("Exchange request is already closed", status_code=409)
    if exchange.status == EXCHANGE_BLOCKED:
        raise RotaReviewError("Blocked exchange requests cannot be approved", status_code=409)
    if not exchange.from_slot_id or not exchange.to_person_id:
        raise RotaReviewError("Exchange request is missing slot or target member", status_code=409)

    reason = decision_reason.strip() if decision_reason else None
    if exchange.status == EXCHANGE_NEEDS_OVERRIDE and not reason:
        raise RotaReviewError("Approval reason is required because this exchange needs an override")

    try:
        assignment_result = assign_person_to_slot(
            db,
            slot_id=exchange.from_slot_id,
            person_id=exchange.to_person_id,
            replace_existing=True,
            override_reason=reason if exchange.status == EXCHANGE_NEEDS_OVERRIDE else None,
            source=EXCHANGE_SOURCE,
        )
    except RotaAssignmentError as exc:
        raise RotaReviewError(exc.message, status_code=exc.status_code) from exc

    exchange = hydrate_exchange_request(db, exchange_id)
    assignment = assignment_result.get("assignment")
    exchange.status = EXCHANGE_APPROVED
    exchange.approved_by_user_id = approved_by.id
    exchange.decision_reason = reason
    exchange.decided_at = datetime.utcnow()
    if isinstance(assignment, dict) and assignment.get("id"):
        exchange.applied_assignment_id = UUID(str(assignment["id"]))
    exchange.validation_snapshot = {
        **exchange.validation_snapshot,
        "approval_validation": assignment_result.get("validation"),
        "applied_assignment": assignment,
    }
    db.commit()
    return exchange_request_to_dict(hydrate_exchange_request(db, exchange_id))


def reject_exchange_request(
    db: Session,
    *,
    exchange_id: UUID,
    rejected_by: UserAccount,
    decision_reason: str | None = None,
) -> dict[str, object]:
    exchange = hydrate_exchange_request(db, exchange_id)
    if exchange.status in {EXCHANGE_APPROVED, EXCHANGE_REJECTED}:
        raise RotaReviewError("Exchange request is already closed", status_code=409)
    exchange.status = EXCHANGE_REJECTED
    exchange.approved_by_user_id = rejected_by.id
    exchange.decision_reason = decision_reason.strip() if decision_reason else None
    exchange.decided_at = datetime.utcnow()
    db.commit()
    return exchange_request_to_dict(hydrate_exchange_request(db, exchange_id))
