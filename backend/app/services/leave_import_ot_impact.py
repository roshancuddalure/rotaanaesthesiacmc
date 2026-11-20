"""One canonical before/after OT review for a frozen leave-import selection."""

from datetime import date, timedelta
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models import LeaveRequest, Person
from app.services.leave import month_bounds
from app.services.leave_ot_impact import compare_month, review_impacts
from app.services.leave_projection import LeaveProjection, indexed_projections
from app.services.leave_impact import affected_duties
from app.services.leave_semantics import status_key
from app.services.scheduling_snapshot import capture


BASIS = (
    "Before and after this exact included import selection, retaining saved duties. "
    "Manual leave and outside-month remnants are preserved. Pending leave stays a separate warning. "
    "This evidence neither reassigns duties nor changes leave approval authority."
)


def projection(identity, values):
    return LeaveProjection(
        identity,
        UUID(str(values["person_id"])),
        date.fromisoformat(values["starts_on"]),
        date.fromisoformat(values["ends_on"]),
        values["leave_slot"],
        values["status"],
    )


def proposed_set(db, month, mode, selected):
    """Mirror apply's append/update/replacement semantics without mutating rows."""
    if not selected or any(row["issues"] for row in selected):
        raise ValueError("Resolve all included rows before OT impact can be evaluated")
    first, last = month_bounds(month)
    projections, previous = [], []
    if mode == "replace_month":
        records = db.scalars(
            select(LeaveRequest)
            .where(
                LeaveRequest.starts_on <= last,
                LeaveRequest.ends_on >= first,
                LeaveRequest.source.in_(["import", "normalized_import"]),
            )
            .limit(5001)
        )
        for row in records:
            if len(projections) >= 5000:
                raise ValueError(
                    "Import OT projection exceeds 5000 values including preserved remnants"
                )
            # Cancel the original virtual identity, then retain exact left/right
            # values. Simply cancelling it would invent extra boundary capacity.
            projections.append(
                LeaveProjection(
                    row.id, row.person_id, row.starts_on, row.ends_on, row.leave_slot, "cancelled"
                )
            )
            if row.starts_on < first:
                projections.append(
                    LeaveProjection(
                        f"import-remnant:{row.id}:left",
                        row.person_id,
                        row.starts_on,
                        first - timedelta(days=1),
                        row.leave_slot,
                        row.status,
                    )
                )
            if row.ends_on > last:
                projections.append(
                    LeaveProjection(
                        f"import-remnant:{row.id}:right",
                        row.person_id,
                        last + timedelta(days=1),
                        row.ends_on,
                        row.leave_slot,
                        row.status,
                    )
                )
    for row in selected:
        target = db.get(LeaveRequest, UUID(row["target_id"])) if row.get("target_id") else None
        retained_manual = target is not None and target.source not in {
            "import",
            "normalized_import",
        }
        unchanged = row["action"] == "unchanged" and (mode != "replace_month" or retained_manual)
        if unchanged:
            continue
        identity = (
            target.id
            if target is not None and mode == "update_matching"
            else f"import-row:{row['key']}"
        )
        projections.append(projection(identity, row["after"]))
        if target is not None and mode == "update_matching":
            previous.append(
                LeaveProjection(
                    target.id,
                    target.person_id,
                    target.starts_on,
                    target.ends_on,
                    target.leave_slot,
                    target.status,
                )
            )
    return tuple(indexed_projections(projections).values()), tuple(previous)


def review_import(db, month, mode, rows, excluded):
    selected = [row for row in rows if row["key"] not in excluded]
    enabled = settings.ot_calendar_enabled
    authority = {
        "version": 1,
        "enabled": enabled,
        "selected_keys": sorted(row["key"] for row in selected),
        "context_digest": capture(db).digest if enabled else None,
    }
    if not enabled:
        return review_impacts(db, ()), authority
    with db.no_autoflush:
        try:
            projections, previous = proposed_set(db, month, mode, selected)
            if mode == "replace_month" or not projections:
                # The changed interval is exactly the month. Virtual remnants
                # still cover the guard's full overnight/rest boundary horizon.
                report = compare_month(db, month, projections)
                impact = {
                    "status": "evaluated" if report["changed"] is not None else "not_evaluated",
                    "context_digest": authority["context_digest"],
                    "months": [report],
                    "basis": BASIS,
                }
            else:
                impact = review_impacts(db, projections, previous=previous)
                impact["basis"] = BASIS + " " + impact["basis"]
            return impact, authority
        except ValueError as exc:
            return {
                "status": "not_evaluated",
                "context_digest": authority["context_digest"],
                "months": [],
                "basis": f"{BASIS} OT impact unknown: {exc}.",
            }, authority


def validate_review(db, batch, selected):
    """No re-solve on apply. Input locks and exact selection bind the evidence."""
    authority = batch.settings.get("ot_review")
    enabled = settings.ot_calendar_enabled
    if not authority:
        if enabled:
            raise HTTPException(409, "Refresh this legacy import preview to review OT impact")
        return
    if (
        authority.get("version") != 1
        or authority.get("enabled") != enabled
        or enabled
        and (
            authority.get("selected_keys") != sorted(row["key"] for row in selected)
            or authority.get("context_digest") != capture(db).digest
        )
    ):
        raise HTTPException(
            409, "Import selection or OT planning inputs changed; refresh the normalized preview"
        )


def legacy_review(db, month, preview):
    """The retained legacy API applies safe rows only; disclose that exact subset."""
    from app.services.leave_import import row_is_safe_to_apply

    safe = [row for row in preview["rows"] if row_is_safe_to_apply(row)]
    rows = [
        {
            "key": f"legacy:{index}",
            "issues": [],
            "target_id": None,
            "action": "create",
            "after": {
                key: row[key]
                for key in ("person_id", "starts_on", "ends_on", "leave_slot", "status")
            },
        }
        for index, row in enumerate(safe)
    ]
    report, authority = review_import(db, month, "append", rows, ())
    report["basis"] = (
        f"Legacy import applies only {len(safe)} safe matched rows; "
        f"{len(preview['rows']) - len(safe)} other rows remain skipped. " + report["basis"]
    )
    people = (
        {
            row.id: row
            for row in db.scalars(
                select(Person).where(Person.id.in_([UUID(str(row["person_id"])) for row in safe]))
            )
        }
        if safe
        else {}
    )
    proposals = [
        SimpleNamespace(
            id=row["key"],
            person_id=UUID(str(row["after"]["person_id"])),
            person=people[UUID(str(row["after"]["person_id"]))],
            starts_on=date.fromisoformat(row["after"]["starts_on"]),
            ends_on=date.fromisoformat(row["after"]["ends_on"]),
            leave_slot=row["after"]["leave_slot"],
        )
        for row in rows
        if status_key(row["after"]["status"]) not in {"cancelled", "rejected"}
    ]
    duties = affected_duties(db, proposals)
    options = {
        "impact_version": 1,
        "context_digest": capture(db).digest,
        "ot_enabled": authority["enabled"],
        "affected_duties": duties,
    }
    return {"ot_impact": report, "affected_duties": duties}, options
