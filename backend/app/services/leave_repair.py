"""Reviewed leave repair scopes using the existing intelligence proposal engine."""

import hashlib
import hmac
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models import LeaveRequest, MonthlyGenerationScope, RotaPeriod
from app.services import rota_compute as compute, rota_intelligence as intelligence
from app.services.leave import month_bounds
from app.services.leave_impact import affected_duties
from app.services.leave_ot_repair_scope import review_scope
from app.services.leave_semantics import BLOCKING_LEAVE_STATUSES, status_key
from app.services.reference_registry import lock_namespace
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES
from app.services.scheduling_inputs import lock_inputs
from app.services.scheduling_snapshot import capture


def _ids(values, maximum, label):
    try:
        values = tuple(values)
        result = sorted({str(UUID(str(value))) for value in values})
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, f"Invalid {label} identities") from exc
    if len(values) > maximum or len(result) != len(values):
        raise HTTPException(422, f"Use distinct {label} identities, at most {maximum}")
    return result


def preview(db, month, user, leave_ids, *, repair_slots=(), locked_slots=()):
    try:
        first, last = month_bounds(month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    identities = _ids(leave_ids, 100, "leave")
    selected = _ids(repair_slots, 5000, "repair slot")
    locked = _ids(locked_slots, 5000, "locked slot")
    if not identities:
        raise HTTPException(422, "Select at least one approved leave record")
    if set(selected) & set(locked):
        raise HTTPException(422, "A selected repair slot cannot also be locked")
    lock_namespace(db, "operational-import")
    lock_inputs(db)
    with db.no_autoflush:
        leaves = list(db.scalars(select(LeaveRequest).where(
            LeaveRequest.id.in_([UUID(value) for value in identities]))
            .options(selectinload(LeaveRequest.person))))
        if len(leaves) != len(identities):
            raise HTTPException(404, "An approved leave record was not found")
        if any(status_key(row.status) not in BLOCKING_LEAVE_STATUSES for row in leaves):
            raise HTTPException(409, "Only current approved leave can define a repair scope; refresh after approval")
        try:
            impacts = affected_duties(db, leaves)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        ot_scope, ot_assignments = review_scope(db, month, leaves)
        direct_ids = {row['id'] for row in impacts}
        ot_impacts = []
        for assignment in ot_assignments:
            if str(assignment.id) in direct_ids:
                continue
            slot = assignment.duty_slot
            period = slot.rota_period
            active = [row for row in slot.assignments if row.status.lower() in ACTIVE_ASSIGNMENT_STATUSES]
            protected = period is None or period.status.lower() != 'draft'
            candidate = not protected and slot.source == 'phase4_template' and len(active) == 1
            ot_impacts.append({
                'id': str(assignment.id), 'slot_id': str(slot.id), 'person_id': str(assignment.person_id),
                'person_name': assignment.person.canonical_name, 'date': slot.duty_date.isoformat(),
                'duty': slot.slot_label, 'starts_at': slot.starts_at.isoformat(), 'ends_at': slot.ends_at.isoformat(),
                'period_id': str(period.id) if period else None,
                'month': period.starts_on.strftime('%Y-%m') if period else slot.duty_date.strftime('%Y-%m'),
                'period_status': period.status if period else 'unscoped', 'protected_period': protected,
                'leave_ids': identities, 'reasons': ['ot_reservation_component'],
                'requires_authorized_resolution': protected or not candidate,
                'reviewed_repair_candidate': candidate, 'repair_basis': ot_scope['basis'],
            })
        periods = list(db.scalars(select(RotaPeriod).where(
            RotaPeriod.starts_on == first, RotaPeriod.ends_on == last).limit(2)))
        period = periods[0] if len(periods) == 1 else None
        generation_scope = db.scalar(select(MonthlyGenerationScope).where(
            MonthlyGenerationScope.rota_period_id == period.id)) if period else None
        draft = period is not None and period.status.lower() == "draft" and generation_scope is not None
        slots = {str(row.id): row for row in compute.open_slots_for_period(db, period.id)} if draft else {}
        if set(locked) - slots.keys():
            raise HTTPException(422, "Locked slots must belong to this draft month's reviewed template scope")
        eligible = sorted({row["slot_id"] for row in (*impacts, *ot_impacts)
                           if row["reviewed_repair_candidate"] and row["slot_id"] in slots
                           and row["slot_id"] not in locked})
        if set(selected) - set(eligible):
            raise HTTPException(422, "Select only affected, unlocked draft template slots in this month's scope")
        snapshot = capture(db)
        enabled = settings.rota_compute_enabled and settings.rota_intelligence_enabled
        scope = {"version": 1, "actor": str(user.id), "month": month, "leave_ids": identities,
                 "repair_slots": selected, "locked_slots": locked, "affected_duties": impacts,
                 "ot_repair_scope": ot_scope, "ot_affected_duties": ot_impacts,
                 "period_id": str(period.id) if period else None,
                 "context_digest": snapshot.digest, "proposal_enabled": enabled}
        token = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        return {"month": month, "leave_ids": identities, "review_token": token,
                "context_digest": snapshot.digest, "affected_duties": impacts,
                "ot_repair_scope": ot_scope, "ot_affected_duties": ot_impacts,
                "eligible_repair_slots": eligible, "repair_slots": selected, "locked_slots": locked,
                "preserved_slot_count": len(slots) - len(selected), "proposal_enabled": enabled,
                "scope_available": draft,
                "basis": "Only selected direct-impact or OT-component draft template duties may be repaired. All other slots, "
                         "including empty slots, are preserved. Protected or ambiguous months require authorized "
                         "resolution. This review neither generates nor applies a repair."}


def start_proposal(db, month, user, leave_ids, review_token, *, repair_slots=(), locked_slots=(), seconds=30):
    if not settings.rota_compute_enabled or not settings.rota_intelligence_enabled:
        raise HTTPException(503, "Reviewed intelligent planning is disabled")
    if type(seconds) is not int or not 1 <= seconds <= 120:
        raise HTTPException(422, "Repair search budget must be between 1 and 120 seconds")
    if not repair_slots:
        raise HTTPException(422, "Select at least one affected duty to repair")
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    # Bootstrap before the final review check. Any newly initialized context
    # deliberately invalidates an older review; no operational duties are saved.
    compute.prepare_planning_inputs(db, month)
    review = preview(db, month, user, leave_ids, repair_slots=repair_slots, locked_slots=locked_slots)
    if not hmac.compare_digest(review_token, review["review_token"]):
        raise HTTPException(409, "Leave, assignments, locks or planning inputs changed; refresh the repair review")
    period, _ = compute.writable_period(db, month)
    all_slots = {str(row.id) for row in compute.open_slots_for_period(db, period.id)}
    preserved = sorted(all_slots - set(review["repair_slots"]))
    return intelligence.start(db, month, user, {
        "mode": "repair", "engine": "server", "seconds": seconds,
        "repair_slots": review["repair_slots"], "locked_slots": preserved, "preferences": [],
    }, origin={"kind": "leave_repair", "leave_ids": review["leave_ids"],
               "review_token": review["review_token"], "context_digest": review["context_digest"]})
