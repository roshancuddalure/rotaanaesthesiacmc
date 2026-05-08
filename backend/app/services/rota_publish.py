from __future__ import annotations

from io import BytesIO
from typing import Any

import xlsxwriter
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DutySlot, RotaPublishApproval, UserAccount
from app.services.rota_review import rota_review_month
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_safety import month_safety
from app.services.rota_setup import monthly_setup
from app.services.rota_template import template_slots_for_period

PUBLISHED_STATUS = "published"


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
    return {
        "id": str(approval.id),
        "rota_period_id": str(approval.rota_period_id),
        "approved_by": approval.approved_by.display_name if approval.approved_by else None,
        "status": approval.status,
        "confirmed_warnings": approval.confirmed_warnings,
        "approval_note": approval.approval_note,
        "summary": approval.summary,
        "created_at": approval.created_at.isoformat(),
    }


def checklist_item(status: str, title: str, detail: str) -> dict[str, str]:
    return {"status": status, "title": title, "detail": detail}


def rota_publish_checklist(db: Session, month: str) -> dict[str, object]:
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

    warning_items = max(0, int(summary["review_items"]) - int(summary["hard_blocked_items"]))
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
        "requires_warning_confirmation": bool(warnings),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "latest_publish": publish_approval_to_dict(approval),
    }


def publish_rota_month(
    db: Session,
    *,
    month: str,
    approved_by: UserAccount,
    confirm_warnings: bool,
    approval_note: str,
) -> dict[str, object]:
    note = approval_note.strip()
    if not note:
        raise RotaPublishError("Approval note is required")
    checklist = rota_publish_checklist(db, month)
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
        },
    )
    period.status = PUBLISHED_STATUS
    db.add(approval)
    db.commit()
    return rota_publish_checklist(db, month)


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
                    "",
                    "",
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
                    assignment.person.canonical_name,
                    assignment.person.call_level,
                    assignment.source,
                    assignment.override_reason,
                    slot.template_status,
                    slot.template_reason,
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


def final_rota_export(db: Session, month: str) -> tuple[str, bytes]:
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
        ["Total slots", checklist["summary"]["total_slots"]],
        ["Assigned slots", checklist["summary"]["assigned_slots"]],
        ["Open slots", checklist["summary"]["open_slots"]],
        ["Review items", checklist["summary"]["review_items"]],
        ["Override assignments", checklist["summary"]["override_assignments"]],
    ]
    write_rows(workbook, "Summary", ["Field", "Value"], summary_rows)
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
        "Duty Counts",
        ["Member", "Call Level", "Total Assignments", "24hr", "Weekend 24hr", "Overrides"],
        [
            [
                row["person_name"],
                row["call_level"],
                row["total_assignments"],
                row["total_24hr"],
                row["weekend_24hr"],
                row["override_assignments"],
            ]
            for row in review["person_workload"]
        ],
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
        ["Date", "Unit", "Duty", "Severity", "Issue", "Recommended Action"],
        [
            [
                item["slot"]["duty_date"],
                item["slot"]["unit_name"],
                item["slot"]["duty_type"],
                item["severity"],
                issue["message"],
                item["recommended_action"],
            ]
            for item in review["review_items"]
            for issue in item["issues"]
        ],
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
        ["Status", "Date", "Unit", "From", "To", "Requested By", "Approved By", "Reason", "Decision", "Created At"],
        [
            [
                exchange["status"],
                (exchange["from_slot"] or {}).get("duty_date"),
                (exchange["from_slot"] or {}).get("unit_name"),
                (exchange["from_person"] or {}).get("canonical_name"),
                (exchange["to_person"] or {}).get("canonical_name"),
                exchange["requested_by"],
                exchange["approved_by"],
                exchange["request_reason"],
                exchange["decision_reason"],
                exchange["created_at"],
            ]
            for exchange in review["exchange_requests"]
        ],
    )
    workbook.close()
    return f"final-rota-{month}.xlsx", output.getvalue()
