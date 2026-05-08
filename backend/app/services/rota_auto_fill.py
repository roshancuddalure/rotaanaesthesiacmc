from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutyAssignment, DutySlot, RotaAutoFillEvent, RotaAutoFillRun
from app.services.rota_assignment import RotaAssignmentError, active_assignment, assign_person_to_slot
from app.services.rota_candidates import (
    CANDIDATE_ELIGIBLE,
    candidate_context,
    slot_candidates_with_context,
)
from app.services.rota_setup import monthly_setup

AUTO_FILL_ASSIGNMENT_SOURCE = "safe_auto_fill_draft"
ACTION_ASSIGNED = "assigned"
ACTION_SKIPPED = "skipped"
ACTION_BLOCKED = "blocked"


@dataclass
class AutoFillOptions:
    limit_slots: int | None = None


def open_slots_for_period(db: Session, rota_period_id: UUID) -> list[DutySlot]:
    return list(
        db.scalars(
            select(DutySlot)
            .where(DutySlot.rota_period_id == rota_period_id)
            .options(
                selectinload(DutySlot.unit),
                selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
            )
            .order_by(DutySlot.duty_date, DutySlot.duty_type, DutySlot.slot_label)
        )
    )


def active_slot_assignments(slot: DutySlot) -> list[DutyAssignment]:
    return [assignment for assignment in slot.assignments if active_assignment(assignment)]


def safe_candidate(candidates: list[dict[str, object]]) -> dict[str, object] | None:
    for candidate in candidates:
        if (
            candidate["candidate_status"] == CANDIDATE_ELIGIBLE
            and candidate.get("validation_status") == "clear"
            and not candidate.get("requires_override")
        ):
            return candidate
    return None


def first_risky_reason(candidates: list[dict[str, object]]) -> str:
    if not candidates:
        return "No candidate was available from Unit Management for this slot."
    candidate = candidates[0]
    reasons = candidate.get("reasons", [])
    if isinstance(reasons, list) and reasons:
        return str(reasons[0])
    return "Best candidate still needs review, so auto-fill left this slot open."


def add_event(
    db: Session,
    *,
    run: RotaAutoFillRun,
    slot: DutySlot,
    action: str,
    severity: str,
    reason: str,
    details: dict[str, object],
    person_id: str | None = None,
    assignment_id: str | None = None,
) -> RotaAutoFillEvent:
    event_details = {
        "slot_id": str(slot.id),
        "unit_name": slot.unit.name if slot.unit else None,
        "unit_code": slot.unit.code if slot.unit else None,
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        **details,
    }
    event = RotaAutoFillEvent(
        run=run,
        rota_period_id=run.rota_period_id,
        duty_slot_id=slot.id,
        person_id=UUID(person_id) if person_id else None,
        assignment_id=UUID(assignment_id) if assignment_id else None,
        action=action,
        severity=severity,
        reason=reason,
        details=event_details,
    )
    db.add(event)
    return event


def run_safe_auto_fill(
    db: Session,
    month: str,
    options: AutoFillOptions | None = None,
) -> dict[str, object]:
    options = options or AutoFillOptions()
    period, _scope = monthly_setup(db, month)
    slots = open_slots_for_period(db, period.id)
    if options.limit_slots is not None:
        slots = slots[: options.limit_slots]

    run = RotaAutoFillRun(
        rota_period=period,
        status="completed",
        total_slots=len(slots),
        summary={"month": month, "mode": "safe_auto_fill_draft"},
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    assigned = 0
    skipped = 0
    review = 0
    blocked = 0

    for slot in slots:
        slot = db.merge(slot)
        if active_slot_assignments(slot):
            skipped += 1
            add_event(
                db,
                run=run,
                slot=slot,
                action=ACTION_SKIPPED,
                severity="info",
                reason="Slot already has an assignment, so auto-fill left it unchanged.",
                details={"slot_id": str(slot.id), "existing_assignments": len(active_slot_assignments(slot))},
            )
            continue

        context = candidate_context(db, month)
        candidate_row = slot_candidates_with_context(db, slot=slot, context=context, limit=None)
        candidates = list(candidate_row["candidates"])
        candidate = safe_candidate(candidates)
        if candidate is None:
            skipped += 1
            if candidates:
                best_status = str(candidates[0].get("candidate_status"))
                if best_status == "blocked":
                    blocked += 1
                else:
                    review += 1
            else:
                blocked += 1
            add_event(
                db,
                run=run,
                slot=slot,
                action=ACTION_BLOCKED if not candidates or str(candidates[0].get("candidate_status")) == "blocked" else ACTION_SKIPPED,
                severity="warning" if candidates else "error",
                reason=first_risky_reason(candidates),
                details={
                    "slot_id": str(slot.id),
                    "candidate_count": len(candidates),
                    "best_candidate": candidates[0] if candidates else None,
                },
            )
            continue

        reason = "Auto-filled with the top safe suggestion. " + " ".join(str(item) for item in candidate["reasons"][:2])
        try:
            assignment_result = assign_person_to_slot(
                db,
                slot_id=slot.id,
                person_id=UUID(str(candidate["person_id"])),
                source=AUTO_FILL_ASSIGNMENT_SOURCE,
            )
        except RotaAssignmentError as exc:
            skipped += 1
            review += 1
            slot = db.get(DutySlot, slot.id, options=[selectinload(DutySlot.unit)])
            if slot is None:
                continue
            add_event(
                db,
                run=run,
                slot=slot,
                action=ACTION_SKIPPED,
                severity="warning",
                reason=exc.message,
                details={"candidate": candidate, "validation": exc.validation},
            )
            continue

        assigned += 1
        slot = db.get(DutySlot, slot.id, options=[selectinload(DutySlot.unit)])
        if slot is None:
            continue
        assignment = assignment_result["assignment"]
        add_event(
            db,
            run=run,
            slot=slot,
            action=ACTION_ASSIGNED,
            severity="info",
            reason=reason,
            details={"candidate": candidate, "validation": assignment_result.get("validation")},
            person_id=str(candidate["person_id"]),
            assignment_id=str(assignment["id"]) if isinstance(assignment, dict) else None,
        )

    run.assigned_slots = assigned
    run.skipped_slots = skipped
    run.review_slots = review
    run.blocked_slots = blocked
    run.summary = {
        **run.summary,
        "assigned_slots": assigned,
        "skipped_slots": skipped,
        "review_slots": review,
        "blocked_slots": blocked,
    }
    db.commit()
    return auto_fill_run_to_dict(hydrate_auto_fill_run(db, run.id))


def hydrate_auto_fill_run(db: Session, run_id: UUID) -> RotaAutoFillRun:
    run = db.scalars(
        select(RotaAutoFillRun)
        .where(RotaAutoFillRun.id == run_id)
        .options(
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.duty_slot).selectinload(DutySlot.unit),
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.person),
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.assignment),
        )
    ).one()
    return run


def latest_auto_fill_run(db: Session, rota_period_id: UUID) -> RotaAutoFillRun | None:
    return db.scalars(
        select(RotaAutoFillRun)
        .where(RotaAutoFillRun.rota_period_id == rota_period_id)
        .options(
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.duty_slot).selectinload(DutySlot.unit),
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.person),
            selectinload(RotaAutoFillRun.events).selectinload(RotaAutoFillEvent.assignment),
        )
        .order_by(RotaAutoFillRun.created_at.desc())
    ).first()


def auto_fill_month(db: Session, month: str) -> dict[str, object]:
    period, _scope = monthly_setup(db, month)
    run = latest_auto_fill_run(db, period.id)
    return {
        "month": month,
        "latest_run": auto_fill_run_to_dict(run) if run else None,
    }


def auto_fill_run_to_dict(run: RotaAutoFillRun) -> dict[str, object]:
    return {
        "id": str(run.id),
        "status": run.status,
        "total_slots": run.total_slots,
        "assigned_slots": run.assigned_slots,
        "skipped_slots": run.skipped_slots,
        "review_slots": run.review_slots,
        "blocked_slots": run.blocked_slots,
        "summary": run.summary,
        "created_at": run.created_at.isoformat(),
        "events": [
            auto_fill_event_to_dict(event)
            for event in sorted(run.events, key=lambda item: item.created_at)
        ],
    }


def auto_fill_event_to_dict(event: RotaAutoFillEvent) -> dict[str, object]:
    details = event.details or {}
    return {
        "id": str(event.id),
        "slot_id": str(event.duty_slot_id) if event.duty_slot_id else None,
        "assignment_id": str(event.assignment_id) if event.assignment_id else None,
        "person_id": str(event.person_id) if event.person_id else None,
        "person_name": event.person.canonical_name if event.person else None,
        "unit_name": event.duty_slot.unit.name if event.duty_slot and event.duty_slot.unit else details.get("unit_name"),
        "unit_code": event.duty_slot.unit.code if event.duty_slot and event.duty_slot.unit else details.get("unit_code"),
        "duty_date": event.duty_slot.duty_date.isoformat() if event.duty_slot else details.get("duty_date"),
        "duty_type": event.duty_slot.duty_type if event.duty_slot else details.get("duty_type"),
        "action": event.action,
        "severity": event.severity,
        "reason": event.reason,
        "details": event.details,
        "created_at": event.created_at.isoformat(),
    }
