"""Shared reviewed edits for profile and section-level posting/leave forms."""

import hashlib
import json
from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    MemberActivity,
    Person,
    PersonPosting,
    Unit,
)
from app.services.operational_import import fingerprint, record_values
from app.services.reference_catalog import resolve_value
from app.services.reference_registry import audit, lock_namespace

SPECIAL = {"PAIN", "SICU", "DRP"}


def model_for(kind):
    if kind not in {"units", "leave"}:
        raise HTTPException(404, "Unknown record category")
    return PersonPosting if kind == "units" else LeaveRequest


def get_record(db, kind, identity):
    record = db.get(model_for(kind), identity)
    if record is None:
        raise HTTPException(404, "Record not found")
    return record


def inspect_record(db, kind, values, identity=None):
    model = model_for(kind)
    before = record_values(get_record(db, kind, identity), kind) if identity else None
    try:
        person = db.get(Person, UUID(str(values.get("person_id"))))
        if not person or person.active_status != "active":
            raise ValueError("Select an active department member")
        start = date.fromisoformat(values["starts_on"])
        end = date.fromisoformat(values["ends_on"]) if values.get("ends_on") else None
        if kind == "leave" and end is None:
            end = start
        if end and end < start:
            raise ValueError("End date precedes start date")
        after = {
            "person_id": str(person.id),
            "starts_on": str(start),
            "ends_on": str(end) if end else None,
            "notes": str(values.get("notes") or "").strip(),
        }
        if kind == "units":
            posting = resolve_value(db, "posting_type", values.get("posting_type", ""))[0]
            unit = (
                db.get(Unit, UUID(str(values["unit_id"])))
                if values.get("unit_id") and posting not in SPECIAL
                else None
            )
            if posting not in SPECIAL and (not unit or unit.active_status != "active"):
                raise ValueError("Select an active unit")
            after.update(posting_type=posting, unit_id=str(unit.id) if unit else None)
        else:
            for field, reference in [
                ("leave_type", "leave_type"),
                ("leave_slot", "leave_slot"),
                ("status", "leave_status"),
            ]:
                after[field] = resolve_value(db, reference, values.get(field, ""))[0]
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    overlaps = db.scalars(
        select(model).where(
            model.person_id == person.id,
            model.starts_on <= (end or date.max),
            (model.ends_on.is_(None)) | (model.ends_on >= start),
        )
    )
    for record in overlaps:
        if record.id == identity:
            continue
        if kind == "units":
            conflict = posting == record.posting_type or (
                posting not in SPECIAL and record.posting_type not in SPECIAL
            )
        else:
            slots = {after["leave_slot"], record.leave_slot}
            conflict = (
                after["status"] not in {"cancelled", "rejected"}
                and record.status not in {"cancelled", "rejected"}
                and (len(slots) == 1 or "FULL_DAY" in slots or "CUSTOM" in slots)
            )
        if conflict:
            raise HTTPException(
                409,
                "Overlapping posting or leave session exists; edit the existing record or correct the dates",
            )
    duties = []
    if kind == "leave" and after["status"] not in {"cancelled", "rejected"}:
        assignments = db.scalars(
            select(DutyAssignment)
            .join(DutySlot)
            .where(
                DutyAssignment.person_id == person.id,
                DutySlot.duty_date >= start,
                DutySlot.duty_date <= end,
            )
        )
        from app.services.rota_safety import slot_leave_blocks

        proposal = LeaveRequest(leave_slot=after["leave_slot"])
        duties = [
            {"id": str(a.id), "date": str(a.duty_slot.duty_date), "duty": a.duty_slot.slot_label}
            for a in assignments
            if slot_leave_blocks(proposal, a.duty_slot)
        ]
    token = hashlib.sha256(
        json.dumps(
            {"context": fingerprint(db), "after": after, "kind": kind, "identity": str(identity)},
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "before": before,
        "after": after,
        "duties": duties,
        "review_token": token,
        "availability": "Approved leave blocks availability; existing duties require review."
        if after.get("status") == "approved"
        else "Pending leave warns; cancelled or rejected leave does not block availability."
        if kind == "leave"
        else "Dated unit membership and call override; the department default remains separate.",
    }


def save_record(db, operator, kind, values, token, identity=None):
    lock_namespace(db, "operational-import")
    review = inspect_record(db, kind, values, identity)
    if token != review["review_token"]:
        raise HTTPException(409, "This record or its context changed; review the changes again")
    record = (
        get_record(db, kind, identity)
        if identity
        else model_for(kind)(source="unit_board" if kind == "units" else "manual")
    )
    for key, value in review["after"].items():
        if key in {"person_id", "unit_id"}:
            value = UUID(value) if value else None
        if key in {"starts_on", "ends_on"}:
            value = date.fromisoformat(value) if value else None
        setattr(record, key, value)
    if kind == "leave":
        record.raw_person_name = db.get(Person, record.person_id).canonical_name
    db.add(record)
    db.flush()
    details = {
        "before": review["before"],
        "after": review["after"],
        "affected_duties": review["duties"],
    }
    action = f"{'posting' if kind == 'units' else 'leave'}_{'updated' if identity else 'created'}"
    audit(db, operator, action, record.id, details)
    db.add(
        MemberActivity(
            person_id=record.person_id,
            operator_id=operator.id,
            operator_name=operator.display_name or operator.username,
            action=action,
            details=details,
        )
    )
    db.commit()
    return {"id": str(record.id), **review["after"]}
