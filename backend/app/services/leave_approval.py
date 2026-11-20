"""Reviewed, atomic approval of pending requests overlapping one calendar month."""

import hashlib
import hmac
import json

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models import LeaveRequest, MemberActivity
from app.services.leave import month_bounds
from app.services.leave_semantics import PENDING_LEAVE_STATUSES as PENDING_STATUSES
from app.services.leave_impact import affected_duties
from app.services.leave_projection import LeaveProjection
from app.services.leave_ot_impact import review_impacts
from app.services.operational_import import fingerprint
from app.services.reference_registry import audit, lock_namespace
from app.services.scheduling_inputs import lock_inputs

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
    lock_inputs(db)
    leaves = pending_requests(db, month)
    try:
        duties = affected_duties(db, leaves)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    ot_impact = review_impacts(db, tuple(LeaveProjection(
        row.id, row.person_id, row.starts_on, row.ends_on, row.leave_slot, "approved") for row in leaves))
    token = hashlib.sha256(
        json.dumps({"version": "leave-approval-v2", "user": str(user.id), "month": month,
                    "context": fingerprint(db), "affected_duties": duties,
                    "ot_context": ot_impact["context_digest"]}, sort_keys=True).encode()
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
        "affected_duties": duties,
        "ot_impact": ot_impact,
        "impact_basis": "Existing duty-date policy and actual interval overlap are shown separately. "
                        "Acknowledging an impact does not reassign duties or waive a validator.",
    }


def approve_month(db, month, user, review_token, acknowledge_duties=False, *, reason=None):
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
                "reason": reason.strip() or None if reason else None,
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
