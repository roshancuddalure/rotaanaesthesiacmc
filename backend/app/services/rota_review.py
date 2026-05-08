from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutyAssignment, DutySlot, Person, RotaExchangeRequest, UserAccount
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
from app.services.rota_candidates import month_candidate_slots
from app.services.rota_safety import SAFETY_HARD_BLOCK, SAFETY_WARNING, month_safety
from app.services.rota_setup import monthly_setup
from app.services.rota_template import NEEDS_REVIEW, slot_to_dict, template_slots_for_period

EXCHANGE_SOURCE = "exchange_approved"
EXCHANGE_PENDING = "pending_approval"
EXCHANGE_NEEDS_OVERRIDE = "needs_override"
EXCHANGE_BLOCKED = "blocked"
EXCHANGE_APPROVED = "approved"
EXCHANGE_REJECTED = "rejected"


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


def review_issue(severity: str, code: str, message: str) -> dict[str, str]:
    return {"severity": severity, "code": code, "message": message}


def recommended_action(issues: list[dict[str, str]]) -> str:
    codes = {issue["code"] for issue in issues}
    if "hard_blocked" in codes:
        return "Resolve blockers or document a deliberate board override before assigning."
    if "open_slot" in codes:
        return "Assign a safe suggestion or use manual assignment with an override reason if needed."
    if "override_assignment" in codes:
        return "Confirm the override reason is acceptable for final approval."
    return "Review the warning and decide whether to keep, change, or override this slot."


def review_items(
    slots: list[DutySlot],
    safety_by_slot: dict[str, dict[str, object]],
    candidates_by_slot: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for slot in slots:
        slot_id = str(slot.id)
        safety = safety_by_slot.get(slot_id)
        assignments = active_slot_assignments(slot)
        issues: list[dict[str, str]] = []

        if not assignments:
            issues.append(review_issue("warning", "open_slot", "This generated rota slot is still open."))

        if slot.template_status == NEEDS_REVIEW:
            issues.append(
                review_issue(
                    "warning",
                    "template_review",
                    slot.template_reason or "This generated slot needs rota board review.",
                )
            )

        if safety:
            safety_status = str(safety.get("safety_status"))
            reasons = [str(reason) for reason in safety.get("reasons", [])]
            if safety_status == SAFETY_HARD_BLOCK:
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
                    )
                )

        for assignment in assignments:
            if assignment.override_reason:
                issues.append(
                    review_issue(
                        "warning",
                        "override_assignment",
                        f"{assignment.person.canonical_name} was assigned with override: "
                        f"{assignment.override_reason}",
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
                "safety": safety,
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


def person_workload_rows(assignments: list[DutyAssignment]) -> list[dict[str, object]]:
    grouped: dict[UUID, dict[str, object]] = {}
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
                "weekend_24hr": 0,
                "override_assignments": 0,
                "assignments": [],
            },
        )
        slot = assignment.duty_slot
        row["total_assignments"] = int(row["total_assignments"]) + 1
        row["total_24hr"] = int(row["total_24hr"]) + int(slot.is_24hr)
        row["weekend_24hr"] = int(row["weekend_24hr"]) + int(slot.is_24hr and slot.duty_date.weekday() >= 5)
        row["override_assignments"] = int(row["override_assignments"]) + int(bool(assignment.override_reason))
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
            -int(item["total_24hr"]),
            -int(item["weekend_24hr"]),
            str(item["person_name"]),
        ),
    )


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
    starts_on, ends_on = month_bounds(month)
    period, scope = monthly_setup(db, month)
    slots = template_slots_for_period(db, period.id)
    safety = month_safety(db, month)
    candidates = month_candidate_slots(db, month, limit_per_slot=3)
    active_assignments = [
        assignment
        for slot in slots
        for assignment in active_slot_assignments(slot)
        if starts_on <= slot.duty_date <= ends_on
    ]
    safety_by_slot = {str(row["slot_id"]): row for row in safety["slots"]}
    candidates_by_slot = {str(row["slot_id"]): row for row in candidates["slots"]}
    items = review_items(slots, safety_by_slot, candidates_by_slot)
    exchange_requests = exchange_requests_for_period(db, period.id)
    exchange_counts = defaultdict(int)
    for exchange in exchange_requests:
        exchange_counts[exchange.status] += 1
    assigned_slots = sum(1 for slot in slots if active_slot_assignments(slot))

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
            "override_assignments": sum(1 for item in active_assignments if item.override_reason),
            "exchange_requests": len(exchange_requests),
            "pending_exchange_requests": exchange_counts[EXCHANGE_PENDING]
            + exchange_counts[EXCHANGE_NEEDS_OVERRIDE],
        },
        "review_items": items,
        "person_workload": person_workload_rows(active_assignments),
        "exchange_requests": [exchange_request_to_dict(exchange) for exchange in exchange_requests],
        "assignment_options": [assignment_exchange_option(assignment) for assignment in active_assignments],
    }


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
