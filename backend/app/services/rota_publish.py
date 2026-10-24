"""Publish checklist, publish action and the final rota Excel export.

Blockers: scope not locked, no slots, open slots, hard-blocked items, pending exchanges, call
level mismatches. Warnings (unaccepted review items, overrides, uneven duty totals within a
call level) require ``confirm_warnings``.
A superadmin may publish anyway (docs/superadmin_override_contract.md section 2): blockers and
warning confirmation are skipped, a reason is required and recorded in the approval summary.
Open slots are always listed as "Unfilled" in the export.
Note (handbook B1): publishing does not lock the month or snapshot the rota.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import xlsxwriter
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutySlot, RotaPublishApproval, UserAccount
from app.services.fairness_targets import call_level_spread
from app.services.rota_review import over_limit_detail, rota_review_month
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_safety import month_safety
from app.services.rota_setup import monthly_setup
from app.services.rota_template import template_slots_for_period

PUBLISHED_STATUS = "published"
SUPERADMIN_ROLE = "superadmin"
UNFILLED_LABEL = "Unfilled"
OVERRIDE_REASON_MIN = 5
OVERRIDE_REASON_MAX = 500
SUPERADMIN_DETAIL_NAMES = 5


class RotaPublishError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def latest_publish_approval(db: Session, rota_period_id: object) -> RotaPublishApproval | None:
    return db.scalars(
        select(RotaPublishApproval)
        .where(RotaPublishApproval.rota_period_id == rota_period_id)
        .options(selectinload(RotaPublishApproval.approved_by))
        .order_by(RotaPublishApproval.created_at.desc())
    ).first()


def publish_approval_to_dict(approval: RotaPublishApproval | None) -> dict[str, object] | None:
    if approval is None:
        return None
    summary = approval.summary if isinstance(approval.summary, dict) else {}
    return {
        "id": str(approval.id),
        "rota_period_id": str(approval.rota_period_id),
        "approved_by": approval.approved_by.display_name if approval.approved_by else None,
        "status": approval.status,
        "confirmed_warnings": approval.confirmed_warnings,
        "approval_note": approval.approval_note,
        "summary": approval.summary,
        "created_at": approval.created_at.isoformat(),
        "published_with_override": bool(summary.get("published_with_override")),
        "override_reason": summary.get("override_reason"),
        "override_by": summary.get("override_by"),
    }


def checklist_item(status: str, title: str, detail: str) -> dict[str, str]:
    return {"status": status, "title": title, "detail": detail}


def superadmin_allocation_detail(rows: list[dict[str, object]]) -> str:
    """Checklist text for the superadmin allocations, at most five then "and N more"."""
    parts = []
    for row in rows[:SUPERADMIN_DETAIL_NAMES]:
        text = f"{row.get('duty_date')} {row.get('duty_type')}: {row.get('person_name')}"
        if row.get("by"):
            text += f" (by {row['by']})"
        parts.append(text)
    detail = f"{len(rows)} slot(s) allocated by a superadmin, overriding rota rules: " + ", ".join(parts)
    if len(rows) > SUPERADMIN_DETAIL_NAMES:
        detail += f" and {len(rows) - SUPERADMIN_DETAIL_NAMES} more"
    return detail


def uneven_spread_detail(rows: list[dict[str, object]]) -> str:
    """Checklist text for call levels whose duty totals differ by more than the allowed gap."""
    parts = []
    for row in rows:
        target = row.get("target")
        text = (
            f"{row.get('label')}: {row.get('min')} to {row.get('max')} duties "
            f"(gap {row.get('gap')}, allowed {row.get('allowed_gap')}"
            + (f", target {target:.2f}" if isinstance(target, (int, float)) else "")
            + ")"
        )
        if row.get("reason"):
            text += f" - {row['reason']}"
        parts.append(text)
    return "; ".join(parts)


def is_superadmin(user: UserAccount | None) -> bool:
    return user is not None and getattr(user, "role", None) == SUPERADMIN_ROLE


def rota_publish_checklist(db: Session, month: str, user: UserAccount | None = None) -> dict[str, object]:
    """``user`` (optional) only sets ``can_superadmin_override``: true when blockers exist and
    the user is a superadmin (superadmin contract section 2)."""
    period, scope = monthly_setup(db, month)
    rule_version, _rules = get_phase_one_rules(db)
    review = rota_review_month(db, month)
    summary = review["summary"]
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    checks: list[dict[str, str]] = []

    if not scope.is_locked:
        blockers.append(checklist_item("blocked", "Monthly unit scope", "Lock the monthly unit scope before publishing."))
    else:
        checks.append(checklist_item("clear", "Monthly unit scope", "Monthly unit scope is locked."))

    if int(summary["total_slots"]) == 0:
        blockers.append(checklist_item("blocked", "Generated slots", "Generate the rota template before publishing."))
    else:
        checks.append(checklist_item("clear", "Generated slots", f"{summary['total_slots']} slot(s) generated."))

    if int(summary["open_slots"]) > 0:
        blockers.append(checklist_item("blocked", "Open slots", f"{summary['open_slots']} slot(s) still need assignment."))
    else:
        checks.append(checklist_item("clear", "Open slots", "All generated slots have assignments."))

    if int(summary["hard_blocked_items"]) > 0:
        blockers.append(
            checklist_item(
                "blocked",
                "Hard safety blockers",
                f"{summary['hard_blocked_items']} hard-blocked review item(s) must be resolved.",
            )
        )
    else:
        checks.append(checklist_item("clear", "Hard safety blockers", "No hard-blocked review items remain."))

    if int(summary["pending_exchange_requests"]) > 0:
        blockers.append(
            checklist_item(
                "blocked",
                "Exchange requests",
                f"{summary['pending_exchange_requests']} exchange request(s) still need a decision.",
            )
        )
    else:
        checks.append(checklist_item("clear", "Exchange requests", "No pending exchange approvals remain."))

    # docs/limits_callevel_fairness_contract.md 2: a member whose call level no longer matches
    # the duty (review issue ``call_level_changed``) blocks publishing.
    mismatches = int(summary.get("call_level_mismatch_items", 0) or 0)
    if mismatches > 0:
        blockers.append(
            checklist_item(
                "blocked",
                "Call level mismatches",
                f"{mismatches} assignment(s) are held by a member whose call level no longer matches "
                "the duty. Reassign them in Review.",
            )
        )
    else:
        checks.append(checklist_item("clear", "Call level mismatches", "Every duty is held at its call level."))

    warning_items = int(summary.get("unresolved_warning_items", max(0, int(summary["review_items"]) - int(summary["hard_blocked_items"]))))
    if warning_items:
        warnings.append(
            checklist_item(
                "warning",
                "Warnings needing confirmation",
                f"{warning_items} warning/review item(s) remain and need board confirmation.",
            )
        )
    if int(summary["override_assignments"]) > 0:
        warnings.append(
            checklist_item(
                "warning",
                "Override assignments",
                f"{summary['override_assignments']} assignment(s) contain override reasons.",
            )
        )

    extra_duties = int(summary.get("extra_duty_records", 0))
    if extra_duties > 0:
        warnings.append(
            checklist_item(
                "warning",
                "Extra duties (ledger)",
                f"Extra duties (ledger): {extra_duties}. Assigned by the extra-duty layer; see the audit report.",
            )
        )

    # docs/superadmin_override_contract.md section 2: a warning, never a blocker.
    superadmin_rows = list(review.get("superadmin_allocations") or [])
    if superadmin_rows:
        warnings.append(
            checklist_item("warning", "Superadmin allocations", superadmin_allocation_detail(superadmin_rows))
        )

    # docs/extra_duty_fill_all_contract.md §6: a warning, never a blocker.
    over_limit_people = list(review.get("over_limit_people") or [])
    if over_limit_people:
        warnings.append(
            checklist_item("warning", "Members over their individual limit", over_limit_detail(over_limit_people))
        )

    # docs/limits_callevel_fairness_contract.md 2: a warning, never a blocker.
    spread = call_level_spread(db, month, _rules)
    uneven = [row for row in spread if not row["ok"]]
    if uneven:
        detail = uneven_spread_detail(uneven)
        # docs/call_level_pool_and_balance_contract.md section 2: point at Balance duties when it can help.
        try:
            from app.services.balance_duties import movable_count

            if movable_count(db, month) > 0:
                detail += ". Run Balance duties on Rota Template."
        except Exception:  # noqa: BLE001 - the hint is optional; never block the checklist
            pass
        warnings.append(
            checklist_item("warning", "Duty totals uneven within a call level", detail)
        )
    elif spread:
        checks.append(
            checklist_item(
                "clear",
                "Duty totals within a call level",
                "Every call level is within the allowed gap.",
            )
        )

    approval = latest_publish_approval(db, period.id)
    return {
        "month": month,
        "rota_period": {
            "id": str(period.id),
            "name": period.name,
            "starts_on": period.starts_on.isoformat(),
            "ends_on": period.ends_on.isoformat(),
            "status": period.status,
        },
        "rule_version": {"id": str(rule_version.id), "name": rule_version.name},
        "summary": summary,
        "can_publish": not blockers,
        "can_superadmin_override": bool(blockers) and is_superadmin(user),
        "requires_warning_confirmation": bool(warnings),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "over_limit_people": over_limit_people,
        "superadmin_allocations": superadmin_rows,
        "call_level_spread": spread,
        "latest_publish": publish_approval_to_dict(approval),
    }


def publish_rota_month(
    db: Session,
    *,
    month: str,
    approved_by: UserAccount,
    confirm_warnings: bool,
    approval_note: str | None,
    superadmin_override: bool = False,
    override_reason: str | None = None,
) -> dict[str, object]:
    """Record a publish approval after the checklist passes.

    ``superadmin_override`` (superadmin contract section 2): a superadmin may publish with
    blockers and unconfirmed warnings; ``override_reason`` (5-500 characters) is required and the
    approval summary records ``published_with_override``, the reason, who, the open slots, the
    blockers and the number of unconfirmed warnings. 403 for anyone else.

    KNOWN ISSUES (handbook B1, B11): only the checklist is stored - not the assignments or the
    rule set - and nothing prevents later edits, regeneration or clearing of a published month.
    """
    note = (approval_note or "").strip()
    if superadmin_override:
        if not is_superadmin(approved_by):
            raise RotaPublishError("Only a superadmin can publish anyway", status_code=403)
        reason = (override_reason or "").strip()
        if not OVERRIDE_REASON_MIN <= len(reason) <= OVERRIDE_REASON_MAX:
            raise RotaPublishError(
                f"A reason of {OVERRIDE_REASON_MIN}-{OVERRIDE_REASON_MAX} characters is required to publish anyway",
                status_code=422,
            )
    elif not note:
        raise RotaPublishError("Approval note is required")
    checklist = rota_publish_checklist(db, month, approved_by)
    override_summary: dict[str, object] = {}
    if superadmin_override:
        blockers = [
            {"title": item.get("title"), "detail": item.get("detail")} for item in checklist["blockers"]
        ]
        warnings_unconfirmed = 0 if confirm_warnings else len(checklist["warnings"])
        open_slots = int(checklist["summary"].get("open_slots") or 0)
        by = approved_by.display_name
        override_summary = {
            "published_with_override": True,
            "override_reason": reason,
            "override_by": by,
            "override_by_user_id": str(approved_by.id),
            "open_slots": open_slots,
            "blockers": blockers,
            "warnings_unconfirmed": warnings_unconfirmed,
        }
        sentence = (
            f"Published with superadmin override by {by}: {reason}. "
            f"{open_slots} open slot(s) listed as Unfilled; {len(blockers)} blocker(s) and "
            f"{warnings_unconfirmed} unconfirmed warning(s) at publish."
        )
        note = f"{note}\n\n{sentence}" if note else sentence
    else:
        if checklist["blockers"]:
            raise RotaPublishError("Cannot publish until checklist blockers are resolved", status_code=409)
        if checklist["requires_warning_confirmation"] and not confirm_warnings:
            raise RotaPublishError("Confirm remaining warnings and overrides before publishing", status_code=409)

    period, _scope = monthly_setup(db, month)
    approval = RotaPublishApproval(
        rota_period=period,
        approved_by_user_id=approved_by.id,
        status=PUBLISHED_STATUS,
        confirmed_warnings=confirm_warnings,
        approval_note=note,
        summary={
            "checklist": checklist,
            "approved_by": approved_by.display_name,
            "approved_by_user_id": str(approved_by.id),
            **override_summary,
        },
    )
    period.status = PUBLISHED_STATUS
    db.add(approval)
    db.commit()
    return rota_publish_checklist(db, month, approved_by)


def safe_cell(value: Any) -> str | int | float | bool | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def write_rows(
    workbook: xlsxwriter.Workbook,
    name: str,
    headers: list[str],
    rows: list[list[Any]],
) -> None:
    worksheet = workbook.add_worksheet(name[:31])
    header_format = workbook.add_format({"bold": True, "bg_color": "#D9EAF7", "border": 1})
    for col, header in enumerate(headers):
        worksheet.write(0, col, header, header_format)
    for row_index, row in enumerate(rows, start=1):
        for col, value in enumerate(row):
            worksheet.write(row_index, col, safe_cell(value))
    for col, header in enumerate(headers):
        width = max(len(header) + 2, 14)
        worksheet.set_column(col, col, min(width, 32))
    worksheet.freeze_panes(1, 0)


def assignment_rows(slots: list[DutySlot]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for slot in slots:
        active_assignments = [
            assignment
            for assignment in slot.assignments
            if assignment.status.lower() in {"assigned", "draft", "confirmed"}
        ]
        if not active_assignments:
            rows.append(
                [
                    slot.duty_date.isoformat(),
                    slot.duty_date.strftime("%A"),
                    slot.unit.name if slot.unit else "",
                    slot.unit.code if slot.unit else "",
                    slot.duty_type,
                    slot.slot_label,
                    UNFILLED_LABEL,
                    slot.call_level,
                    "",
                    "",
                    slot.template_status,
                    slot.template_reason,
                ]
            )
            continue
        for assignment in active_assignments:
            rows.append(
                [
                    slot.duty_date.isoformat(),
                    slot.duty_date.strftime("%A"),
                    slot.unit.name if slot.unit else "",
                    slot.unit.code if slot.unit else "",
                    slot.duty_type,
                    slot.slot_label,
                    assignment.person.canonical_name if assignment.person else str(assignment.person_id),
                    assignment.person.call_level if assignment.person else None,
                    assignment.source,
                    assignment.override_reason,
                    slot.template_status,
                    slot.template_reason,
                ]
            )
    return rows


def unfilled_rows(slots: list[DutySlot]) -> list[list[Any]]:
    """Open slots (no active assignment), listed so a published rota never hides them."""
    rows: list[list[Any]] = []
    for slot in slots:
        if any(a.status.lower() in {"assigned", "draft", "confirmed"} for a in slot.assignments):
            continue
        rows.append(
            [
                slot.duty_date.isoformat(),
                slot.duty_date.strftime("%A"),
                slot.unit.name if slot.unit else "",
                slot.duty_type,
                slot.slot_label,
                slot.call_level,
                UNFILLED_LABEL,
            ]
        )
    return rows


def safety_conflict_rows(safety: dict[str, object]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for slot in safety["slots"]:
        for status, people_key in [
            ("hard_blocked", "hard_blocked_people"),
            ("needs_review", "warning_people"),
        ]:
            for person in slot.get(people_key, []):
                blockers = person.get("blockers", []) if isinstance(person, dict) else []
                if not blockers:
                    rows.append(
                        [
                            slot["duty_date"],
                            slot["unit_name"],
                            slot["duty_type"],
                            person.get("person_name"),
                            status,
                            "",
                            "",
                            "",
                        ]
                    )
                for blocker in blockers:
                    rows.append(
                        [
                            slot["duty_date"],
                            slot["unit_name"],
                            slot["duty_type"],
                            person.get("person_name"),
                            status,
                            blocker.get("type"),
                            blocker.get("label"),
                            blocker.get("status"),
                        ]
                    )
    return rows


def publish_readiness_rows(checklist: dict[str, object]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for group_name in ["blockers", "warnings", "checks"]:
        for item in checklist.get(group_name, []):
            if not isinstance(item, dict):
                continue
            rows.append(
                [
                    group_name,
                    item.get("status"),
                    item.get("title"),
                    item.get("detail"),
                ]
            )
    return rows


def review_item_rows(review: dict[str, object]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for item in review["review_items"]:
        for issue in item["issues"]:
            decision = issue.get("decision") if isinstance(issue, dict) else None
            decision = decision if isinstance(decision, dict) else {}
            rows.append(
                [
                    item["slot"]["duty_date"],
                    item["slot"]["unit_name"],
                    item["slot"]["duty_type"],
                    item["severity"],
                    issue["code"],
                    issue["message"],
                    "yes" if issue.get("accepted") else "no",
                    decision.get("decision_type"),
                    decision.get("note"),
                    decision.get("decided_by"),
                    decision.get("updated_at"),
                    item["recommended_action"],
                ]
            )
    return rows


def review_decision_rows(review: dict[str, object]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for item in review["review_items"]:
        for issue in item["issues"]:
            decision = issue.get("decision") if isinstance(issue, dict) else None
            if not isinstance(decision, dict):
                continue
            rows.append(
                [
                    item["slot"]["duty_date"],
                    item["slot"]["unit_name"],
                    item["slot"]["duty_type"],
                    issue.get("code"),
                    decision.get("decision_type"),
                    decision.get("note"),
                    decision.get("decided_by"),
                    decision.get("created_at"),
                    decision.get("updated_at"),
                ]
            )
    return rows


def fairness_rows(review: dict[str, object]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for row in review.get("call_level_fairness", []):
        group_totals = row.get("group_totals", {})
        over_assigned = row.get("over_assigned", [])
        under_assigned = row.get("under_assigned", [])
        rows.append(
            [
                row.get("call_level"),
                row.get("people"),
                row.get("average_assignments"),
                row.get("total_assignments"),
                row.get("total_24hr"),
                row.get("weekend_24hr"),
                ", ".join(f"{key}: {value}" for key, value in dict(group_totals).items()),
                ", ".join(
                    f"{person.get('person_name')} ({person.get('total_assignments')})"
                    for person in over_assigned
                    if isinstance(person, dict)
                ),
                ", ".join(
                    f"{person.get('person_name')} ({person.get('total_assignments')})"
                    for person in under_assigned
                    if isinstance(person, dict)
                ),
            ]
        )
    return rows


def final_rota_export(db: Session, month: str) -> tuple[str, bytes]:
    """Build the final Excel workbook (summary, rota, counts, fairness, safety, review, exchanges).

    Generated from the live tables at download time, so it can differ from what was approved
    if the month changed after publishing (handbook B1).
    """
    checklist = rota_publish_checklist(db, month)
    if checklist["latest_publish"] is None:
        raise RotaPublishError("Publish the rota before downloading the final export", status_code=409)
    period, _scope = monthly_setup(db, month)
    slots = template_slots_for_period(db, period.id)
    safety = month_safety(db, month)
    review = rota_review_month(db, month)
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})

    summary_rows = [
        ["Month", month],
        ["Rota period", checklist["rota_period"]["name"]],
        ["Period status", checklist["rota_period"]["status"]],
        ["Starts on", checklist["rota_period"]["starts_on"]],
        ["Ends on", checklist["rota_period"]["ends_on"]],
        ["Rule version", checklist["rule_version"]["name"]],
        ["Published by", checklist["latest_publish"]["approved_by"]],
        ["Published at", checklist["latest_publish"]["created_at"]],
        ["Approval note", checklist["latest_publish"]["approval_note"]],
        [
            "Published with superadmin override",
            "Yes" if checklist["latest_publish"].get("published_with_override") else "No",
        ],
        ["Override reason", checklist["latest_publish"].get("override_reason")],
        ["Override by", checklist["latest_publish"].get("override_by")],
        ["Superadmin allocations", checklist["summary"].get("superadmin_allocations", 0)],
        ["Total slots", checklist["summary"]["total_slots"]],
        ["Assigned slots", checklist["summary"]["assigned_slots"]],
        ["Open slots", checklist["summary"]["open_slots"]],
        ["Review items", checklist["summary"]["review_items"]],
        ["Hard blocked items", checklist["summary"].get("hard_blocked_items")],
        ["Accepted review items", checklist["summary"].get("accepted_review_items")],
        ["Unresolved warnings", checklist["summary"].get("unresolved_warning_items")],
        ["Override assignments", checklist["summary"]["override_assignments"]],
        ["Pending exchanges", checklist["summary"].get("pending_exchange_requests")],
        ["Over-assigned fairness flags", checklist["summary"].get("over_assigned_people")],
        ["Under-assigned fairness flags", checklist["summary"].get("under_assigned_people")],
    ]
    write_rows(workbook, "Summary", ["Field", "Value"], summary_rows)
    write_rows(
        workbook,
        "Publish Readiness",
        ["Group", "Status", "Title", "Detail"],
        publish_readiness_rows(checklist),
    )
    write_rows(
        workbook,
        "Final Rota",
        [
            "Date",
            "Day",
            "Unit",
            "Unit Code",
            "Duty",
            "Slot Label",
            "Assigned Member",
            "Call Level",
            "Assignment Source",
            "Override Reason",
            "Template Status",
            "Template Reason",
        ],
        assignment_rows(slots),
    )
    write_rows(
        workbook,
        "Unfilled",
        ["Date", "Day", "Unit", "Duty", "Slot Label", "Call Level", "Status"],
        unfilled_rows(slots),
    )
    write_rows(
        workbook,
        "Duty Counts",
        [
            "Member",
            "Call Level",
            "Total Assignments",
            "24hr",
            "Weekday Assignments",
            "Weekend Assignments",
            "Weekend 24hr",
            "Duty Groups",
            "Overrides",
        ],
        [
            [
                row["person_name"],
                row["call_level"],
                row["total_assignments"],
                row["total_24hr"],
                row.get("weekday_assignments"),
                row.get("weekend_assignments"),
                row["weekend_24hr"],
                ", ".join(f"{key}: {value}" for key, value in dict(row.get("group_counts", {})).items()),
                row["override_assignments"],
            ]
            for row in review["person_workload"]
        ],
    )
    write_rows(
        workbook,
        "Call Fairness",
        [
            "Call Level",
            "People",
            "Average Assignments",
            "Total Assignments",
            "24hr",
            "Weekend 24hr",
            "Duty Group Totals",
            "High Load People",
            "Low Load People",
        ],
        fairness_rows(review),
    )
    write_rows(
        workbook,
        "Unit Safety",
        ["Date", "Unit", "Unit Code", "Safety", "Slots", "Safe", "Review", "Hard Blocked", "Minimum Available"],
        [
            [
                row["date"],
                row["unit_name"],
                row["unit_code"],
                row["safety_status"],
                row["slots"],
                row["safe_slots"],
                row["needs_review_slots"],
                row["hard_blocked_slots"],
                row["minimum_available_members"],
            ]
            for row in safety["unit_day_safety"]
        ],
    )
    write_rows(
        workbook,
        "Review Items",
        [
            "Date",
            "Unit",
            "Duty",
            "Severity",
            "Issue Code",
            "Issue",
            "Accepted",
            "Decision Type",
            "Decision Note",
            "Decided By",
            "Decided At",
            "Recommended Action",
        ],
        review_item_rows(review),
    )
    write_rows(
        workbook,
        "Review Decisions",
        ["Date", "Unit", "Duty", "Issue Code", "Decision Type", "Decision Note", "Decided By", "Created At", "Updated At"],
        review_decision_rows(review),
    )
    write_rows(
        workbook,
        "Leave Safety Conflicts",
        ["Date", "Unit", "Duty", "Member", "Status", "Blocker Type", "Blocker Label", "Leave Status"],
        safety_conflict_rows(safety),
    )
    write_rows(
        workbook,
        "Exchange Audit",
        [
            "Status",
            "Validation Status",
            "Requires Override",
            "Date",
            "Unit",
            "From",
            "To",
            "Requested By",
            "Approved By",
            "Reason",
            "Decision",
            "Created At",
            "Decided At",
        ],
        [
            [
                exchange["status"],
                exchange["validation_status"],
                (exchange.get("validation_snapshot") or {}).get("validation", {}).get("requires_override")
                if isinstance(exchange.get("validation_snapshot"), dict)
                else "",
                (exchange["from_slot"] or {}).get("duty_date"),
                (exchange["from_slot"] or {}).get("unit_name"),
                (exchange["from_person"] or {}).get("canonical_name"),
                (exchange["to_person"] or {}).get("canonical_name"),
                exchange["requested_by"],
                exchange["approved_by"],
                exchange["request_reason"],
                exchange["decision_reason"],
                exchange["created_at"],
                exchange["decided_at"],
            ]
            for exchange in review["exchange_requests"]
        ],
    )
    workbook.close()
    return f"final-rota-{month}.xlsx", output.getvalue()
