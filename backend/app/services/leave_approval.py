"""Reviewed, atomic approval of pending requests overlapping one calendar month."""

import hashlib
import hmac

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models import DutyAssignment, DutySlot, LeaveRequest, MemberActivity
from app.services.leave import month_bounds
from app.services.operational_import import fingerprint
from app.services.reference_registry import audit, lock_namespace
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES, slot_leave_blocks

PENDING_STATUSES = {"requested", "imported_pending_review"}


def pending_requests(db, month):
    start, end = month_bounds(month)
    return list(
        db.scalars(
            select(LeaveRequest)
            .where(
                LeaveRequest.starts_on <= end,
                LeaveRequest.ends_on >= start,
                func.lower(LeaveRequest.status).in_(PENDING_STATUSES),
            )
            .options(selectinload(LeaveRequest.person))
            .order_by(LeaveRequest.starts_on, LeaveRequest.id)
        )
    )


def preview(db, month, user):
    lock_namespace(db, "operational-import")
    leaves = pending_requests(db, month)
    duties = {}
    if leaves:
        assignments = db.scalars(
            select(DutyAssignment)
            .join(DutySlot)
            .where(
                DutyAssignment.person_id.in_({leave.person_id for leave in leaves}),
                func.lower(DutyAssignment.status).in_(ACTIVE_ASSIGNMENT_STATUSES),
                DutySlot.duty_date >= min(leave.starts_on for leave in leaves),
                DutySlot.duty_date <= max(leave.ends_on for leave in leaves),
            )
            .options(selectinload(DutyAssignment.duty_slot))
        )
        by_person = {}
        for leave in leaves:
            by_person.setdefault(leave.person_id, []).append(leave)
        for assignment in assignments:
            slot = assignment.duty_slot
            if any(
                leave.starts_on <= slot.duty_date <= leave.ends_on
                and slot_leave_blocks(leave, slot)
                for leave in by_person[assignment.person_id]
            ):
                duties[str(assignment.id)] = {
                    "id": str(assignment.id),
                    "person_id": str(assignment.person_id),
                    "person_name": by_person[assignment.person_id][0].person.canonical_name,
                    "date": str(slot.duty_date),
                    "duty": slot.slot_label,
                }
    token = hashlib.sha256(
        f"leave-approval-v1:{user.id}:{month}:{fingerprint(db)}".encode()
    ).hexdigest()
    return {
        "month": month,
        "pending_count": len(leaves),
        "review_token": token,
        "requests": [
            {
                "id": str(leave.id),
                "person_name": leave.person.canonical_name,
                "starts_on": str(leave.starts_on),
                "ends_on": str(leave.ends_on),
                "status": leave.status,
            }
            for leave in leaves
        ],
        "affected_duties": sorted(duties.values(), key=lambda duty: (duty["date"], duty["id"])),
    }


def approve_month(db, month, user, review_token, acknowledge_duties=False):
    lock_namespace(db, "operational-import")
    review = preview(db, month, user)
    if not review["pending_count"]:
        return {"month": month, "approved_count": 0, "approved_ids": []}
    if not hmac.compare_digest(review_token, review["review_token"]):
        raise HTTPException(
            409, "Leave or rota data changed. Refresh the approval review before approving."
        )
    if review["affected_duties"] and not acknowledge_duties:
        raise HTTPException(
            409, "Review and acknowledge the affected duties before approving leave."
        )
    leaves = pending_requests(db, month)
    try:
        for leave in leaves:
            details = {
                "month": month,
                "before": {"status": leave.status},
                "after": {"status": "approved"},
                "starts_on": str(leave.starts_on),
                "ends_on": str(leave.ends_on),
                "affected_duties": [
                    duty
                    for duty in review["affected_duties"]
                    if duty["person_id"] == str(leave.person_id)
                ],
            }
            leave.status = "approved"
            audit(db, user, "leave_bulk_approved", leave.id, details)
            db.add(
                MemberActivity(
                    person_id=leave.person_id,
                    operator_id=user.id,
                    operator_name=user.display_name or user.username,
                    action="leave_bulk_approved",
                    details=details,
                )
            )
        result = {
            "month": month,
            "approved_count": len(leaves),
            "approved_ids": [str(leave.id) for leave in leaves],
        }
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
