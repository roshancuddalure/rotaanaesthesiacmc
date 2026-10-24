"""360° duty rota audit report (docs/extra_duty_contract.md, section 6).

Three public functions:

``build_report_data(db, month)``
    Reads the month once and returns plain, JSON-serialisable data (dates as ISO strings).
    Read-only: nothing is added, flushed or committed (rules are read through
    ``get_phase_one_rules`` only when they have already been saved, so its first-run writes
    never happen from here). Every section is built independently; a failing section is
    replaced by an empty value and its reason is recorded in ``section_errors``.
``render_html(data)``
    One self-contained HTML file: inline CSS, inline SVG charts drawn here (no JavaScript,
    no fonts or images from the network), A4 print layout with a page per section.
``render_xlsx(data)``
    The same sections as xlsxwriter sheets, in the same order.

Definitions used by the metrics (also printed in the report):
- *Filled slot*: a slot with at least one active assignment (``assigned``/``draft``/``confirmed``).
- *Weekend*: Saturday or Sunday. *Night*: a duty that is not 24-hour and starts at or after
  18:00 or before 08:00.
- *Holiday*: a date in the reviewed holiday calendar (``allocation.intelligence.holidays``).
- *Extra*: an active row of the extra-duty ledger for the month (void rows are listed but
  not counted).
- *Deviation*: a member's total duties minus the mean of the members of the same call level.
- *Gini*: mean absolute difference / (2 x mean) over the members of a call level (0 = equal).
- *data_fingerprint*: sha256 of the sorted ``slot_id|person_id|status`` lines of the active
  assignments, so two reports with the same fingerprint describe the same rota.
"""

from __future__ import annotations

import calendar as _calendar
import hashlib
import html
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    PersonPosting,
    RotaAutoFillRun,
    RotaPeriod,
    RotaPublishApproval,
    RotaTemplateGenerationRun,
    RuleSetting,
    Unit,
)
from app.services.leave import month_bounds
from app.services.rota_call_levels import normalize_call_level

DEPARTMENT_NAME = "Department of Anaesthesia, CMC"
REPORT_TITLE = "Duty Rota Audit Report"
ACTIVE_STATUSES = {"assigned", "draft", "confirmed"}
UNIT_BOARD_SOURCE = "unit_board"
HOLIDAY_SETTING_KEY = "allocation.intelligence.holidays"
TREND_MONTHS = 5
TREND_LOOKBACK = 12
NIGHT_STARTS_AT_HOUR = 18
NIGHT_ENDS_BEFORE_HOUR = 8

CALL_LEVEL_ORDER = ["1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL"]

OVERRIDE_LABELS = {
    "unit_safety_hard_block": "Unit short-staffed (hard block)",
    "unit_safety_review": "Unit staffing warning",
    "monthly_24hr_limit": "Over monthly 24-hour limit",
    "monthly_weekend_24hr_limit": "Over weekend 24-hour limit",
    "monthly_same_group_limit": "Over monthly limit for this duty type",
    "monthly_same_campus_limit": "Over monthly limit for this campus",
    "fairness": "Fairness (equal duties)",
    "fallback_unit": "Covered a duty for another unit",
    # docs/extra_duty_fill_all_contract.md §3/§6 (fill-all "all units" mode).
    "any_unit": "Covered from another unit",
    "outside_scope_unit": "Covered from a unit outside this month's scope",
    "unposted_member": "Member has no posting this month",
    "unit_rule": "Duty not allowed for this unit",
    # docs/superadmin_override_contract.md: a superadmin allocation and the rules it overrode.
    "superadmin_allocation": "Superadmin allocation",
    "superadmin_cross_level": "Call level crossed by superadmin",
    "call_level_mismatch": "Call level does not match the duty",
    "not_in_group": "Not in the duty's eligibility group",
    "excluded_group": "In a group excluded from this duty",
    "not_posted": "Not posted to the duty's unit",
    # docs/balance_extra_duties_contract.md 2: an extra duty Balance duties passed on.
    "rebalanced_extra_duty": "Extra duty passed on by Balance duties",
}

BATCH_MODE_LABELS = {"standard": "standard", "all_units": "all units", "superadmin_allocation": "superadmin allocation"}
SUPERADMIN_MODE = "superadmin_allocation"
SUPERADMIN_SOURCE = "superadmin_allocation"

LIMIT_SETTINGS = [
    ("max_24hr_per_month", "24-hour duties a month"),
    ("max_weekend_24hr_per_month", "Weekend 24-hour duties a month"),
    ("max_same_group_per_month", "Duties of one duty type a month"),
    ("max_same_campus_per_month", "Duties at one campus a month"),
]

SECTIONS: list[tuple[str, str]] = [
    ("cover", "Cover & sign-off"),
    ("summary", "Executive summary"),
    ("coverage", "Coverage"),
    ("workload", "Member workload"),
    ("fairness", "Fairness"),
    ("individual_limits", "Individual limits exceeded"),
    ("units", "Units"),
    ("calendar", "Rota calendar"),
    ("extra_duties", "Extra duties (ledger)"),
    ("superadmin", "Superadmin actions"),
    ("compliance", "Compliance"),
    ("trend", "Trend"),
    ("audit_trail", "Audit trail"),
]

XLSX_SHEETS = [
    "Cover",
    "Executive summary",
    "Coverage",
    "Member workload",
    "Fairness",
    "Over limit",
    "Units",
    "Rota calendar",
    "Extra duties",
    "Superadmin",
    "Compliance",
    "Trend",
    "Audit trail",
]

DEFINITIONS = [
    ("Filled slot", "A duty slot with at least one active assignment (assigned, draft or confirmed)."),
    ("Weekend", "A duty dated Saturday or Sunday."),
    ("Night", "A duty that is not 24-hour and starts at or after 18:00 or before 08:00."),
    ("24-hour", "A slot marked as a 24-hour duty."),
    ("Holiday", "A duty on a date in the reviewed holiday calendar."),
    ("Extra", "An active extra-duty ledger record this month. Void records are listed but not counted."),
    ("Deviation", "Total duties minus the mean of members with the same call level."),
    ("Gini", "Inequality of total duties within a call level: 0 = everyone equal, 1 = one person does all."),
    ("Spread", "Highest minus lowest total duties within a call level."),
    ("Individual limit", "A member's monthly duty limit from the saved rules (24-hour, weekend 24-hour, one duty type, one campus), "
                         "counted across all units. The extra-duty layer may exceed it; every member above it is listed."),
    ("Data fingerprint", "sha256 of the sorted slot, person and status of every active assignment."),
    ("Report fingerprint", "sha256 of this report's data, excluding when and by whom it was generated."),
]


# =========================================================================== small helpers


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _is_active(assignment: DutyAssignment) -> bool:
    return (assignment.status or "").lower() in ACTIVE_STATUSES


def _month_shift(month: str, delta: int) -> str:
    start, _ = month_bounds(month)
    index = start.year * 12 + (start.month - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _month_label(month: str) -> str:
    start, _ = month_bounds(month)
    return f"{_calendar.month_name[start.month]} {start.year}"


def call_level_label(value: str | None) -> str:
    if not value or value == "Unassigned":
        return "Unassigned"
    labels = {
        "1ST_CALL": "1st call",
        "2ND_CALL": "2nd call",
        "3RD_CALL": "3rd call",
        "CO_4TH_CALL": "Co-4th call",
        "4TH_CALL": "4th call",
        "5TH_CALL": "5th call",
    }
    return labels.get(value, value.replace("_", " ").title())


def _call_level_sort(value: str) -> tuple[int, str]:
    return (CALL_LEVEL_ORDER.index(value) if value in CALL_LEVEL_ORDER else len(CALL_LEVEL_ORDER), value)


def override_label(code: str) -> str:
    return OVERRIDE_LABELS.get(code, code.replace("_", " ").capitalize())


def gini(values: list[float]) -> float:
    """Gini coefficient (mean absolute difference / 2 x mean); 0 for empty or all-zero input."""
    n = len(values)
    if n == 0:
        return 0.0
    mean = sum(values) / n
    if mean == 0:
        return 0.0
    ordered = sorted(values)
    # sum_i sum_j |x_i - x_j| = 2 * sum_i (2i - n + 1) x_(i) for sorted values (0-based i)
    total = sum((2 * i - n + 1) * x for i, x in enumerate(ordered))
    return round((2 * total) / (2 * n * n * mean), 4)


def std_dev(values: list[float]) -> float:
    """Population standard deviation."""
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return round(math.sqrt(sum((x - mean) ** 2 for x in values) / len(values)), 4)


def distribution_stats(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"members": 0, "total": 0, "mean": 0.0, "min": 0, "max": 0, "std": 0.0, "gini": 0.0, "spread": 0}
    return {
        "members": len(values),
        "total": int(sum(values)),
        "mean": round(sum(values) / len(values), 2),
        "min": int(min(values)),
        "max": int(max(values)),
        "std": round(std_dev(values), 2),
        "gini": round(gini(values), 3),
        "spread": int(max(values) - min(values)),
    }


def is_night(slot: Any) -> bool:
    if slot.is_24hr or slot.starts_at is None:
        return False
    hour = slot.starts_at.hour
    return hour >= NIGHT_STARTS_AT_HOUR or hour < NIGHT_ENDS_BEFORE_HOUR


def _slot_hours(slot: Any) -> float:
    try:
        return round((slot.ends_at - slot.starts_at).total_seconds() / 3600, 1)
    except Exception:  # noqa: BLE001 - bad timestamps must not break the report
        return 24.0 if slot.is_24hr else 0.0


def assignment_fingerprint(triples: list[tuple[str, str, str]]) -> str:
    lines = sorted(f"{slot}|{person}|{status}" for slot, person, status in triples)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def _reason(exc: BaseException) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {text}"[:300] if text != exc.__class__.__name__ else text


# =========================================================================== loading


@dataclass
class MonthCore:
    month: str
    starts_on: date
    ends_on: date
    period: RotaPeriod | None
    slots: list[DutySlot]
    active: list[DutyAssignment]
    postings: list[PersonPosting]


@dataclass
class ReportContext:
    db: Session
    core: MonthCore
    units: dict[UUID, Unit]
    persons: dict[UUID, Person]
    duty_labels: dict[str, str]
    holidays: set[str]
    holiday_calendar: bool
    ledger: list[ExtraDutyRecord]
    batches: list[ExtraDutyBatch]
    rules_revision: str | None
    rules_source: str
    cache: dict[str, Any] = field(default_factory=dict)


def _choose_period(db: Session, starts_on: date, ends_on: date) -> RotaPeriod | None:
    periods = list(
        db.scalars(
            select(RotaPeriod)
            .where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on)
            .order_by(RotaPeriod.created_at)
        )
    )
    if not periods:
        return None
    # Prefer the working (non-historical) period: handbook B3, historical imports add their own.
    working = [period for period in periods if period.status != "historical"]
    return (working or periods)[0]


def load_month_core(db: Session, month: str) -> MonthCore:
    starts_on, ends_on = month_bounds(month)
    period = _choose_period(db, starts_on, ends_on)
    slots: list[DutySlot] = []
    if period is not None:
        slots = list(
            db.scalars(
                select(DutySlot)
                .where(
                    DutySlot.rota_period_id == period.id,
                    DutySlot.duty_date >= starts_on,
                    DutySlot.duty_date <= ends_on,
                )
                .options(
                    selectinload(DutySlot.unit),
                    selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
                )
                .order_by(DutySlot.duty_date, DutySlot.starts_at, DutySlot.duty_type, DutySlot.slot_label)
            )
        )
        slots = [slot for slot in slots if (slot.template_status or "") != "excluded"]
    active = [assignment for slot in slots for assignment in slot.assignments if _is_active(assignment)]
    postings = list(
        db.scalars(
            select(PersonPosting)
            .where(
                PersonPosting.starts_on <= ends_on,
                (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
                PersonPosting.source == UNIT_BOARD_SOURCE,
            )
            .options(selectinload(PersonPosting.person), selectinload(PersonPosting.unit))
            .order_by(PersonPosting.starts_on, PersonPosting.posting_type)
        )
    )
    return MonthCore(month, starts_on, ends_on, period, slots, active, postings)


def _duty_labels_and_revision(db: Session) -> tuple[dict[str, str], str | None, str]:
    from app.domain.duty_types import DUTY_TYPES

    labels = {item.key: item.label for item in DUTY_TYPES}
    try:
        from app.services.rota_rules import PHASE_ONE_SETTING_KEY, default_phase_one_rules, get_phase_one_rules
        from app.services.rota_rules_admin import rules_revision

        saved = db.scalar(select(RuleSetting.id).where(RuleSetting.key == PHASE_ONE_SETTING_KEY).limit(1))
        if saved is None:
            # Never saved: describe the defaults without get_phase_one_rules' first-run writes.
            rules = default_phase_one_rules()
            source = "defaults (rules never saved)"
        else:
            _version, rules = get_phase_one_rules(db)
            source = "saved rules"
        labels.update({rule.key: rule.label for rule in rules.duty_rules})
        return labels, rules_revision(rules), source
    except Exception as exc:  # noqa: BLE001
        return labels, None, f"unavailable ({_reason(exc)})"


def _holidays(db: Session) -> tuple[set[str], bool]:
    row = db.scalar(
        select(RuleSetting).where(RuleSetting.key == HOLIDAY_SETTING_KEY).order_by(RuleSetting.created_at.desc())
    )
    if row is None or not isinstance(row.value, dict):
        return set(), False
    return {str(item) for item in row.value.get("dates", []) or []}, True


def load_context(db: Session, month: str) -> ReportContext:
    with db.no_autoflush:
        core = load_month_core(db, month)
        units = {unit.id: unit for unit in db.scalars(select(Unit))}
        ledger = list(
            db.scalars(
                select(ExtraDutyRecord)
                .where(ExtraDutyRecord.month == month)
                .order_by(ExtraDutyRecord.duty_date, ExtraDutyRecord.created_at, ExtraDutyRecord.id)
            )
        )
        batches = list(
            db.scalars(select(ExtraDutyBatch).where(ExtraDutyBatch.month == month).order_by(ExtraDutyBatch.created_at))
        )
        person_ids = {a.person_id for a in core.active} | {p.person_id for p in core.postings} | {r.person_id for r in ledger}
        persons = (
            {person.id: person for person in db.scalars(select(Person).where(Person.id.in_(person_ids)))}
            if person_ids
            else {}
        )
        labels, revision, rules_source = _duty_labels_and_revision(db)
        holidays, has_calendar = _holidays(db)
    return ReportContext(
        db=db,
        core=core,
        units=units,
        persons=persons,
        duty_labels=labels,
        holidays=holidays,
        holiday_calendar=has_calendar,
        ledger=ledger,
        batches=batches,
        rules_revision=revision,
        rules_source=rules_source,
    )


def _unit_name(ctx: ReportContext, unit_id: UUID | None) -> str | None:
    if unit_id is None:
        return None
    unit = ctx.units.get(unit_id)
    return unit.name if unit else str(unit_id)


def _person_name(ctx: ReportContext, person_id: UUID | None) -> str | None:
    if person_id is None:
        return None
    person = ctx.persons.get(person_id)
    return person.canonical_name if person else str(person_id)


def _active_ledger(ctx: ReportContext) -> list[ExtraDutyRecord]:
    return [record for record in ctx.ledger if record.status == "active"]


def _filled(slot: DutySlot) -> bool:
    return any(_is_active(assignment) for assignment in slot.assignments)


# =========================================================================== metrics


def workload_rows(core: MonthCore, holidays: set[str], ledger: list[ExtraDutyRecord] | None = None,
                  units: dict[UUID, Unit] | None = None) -> list[dict[str, Any]]:
    """One row per member: posted (active, unit board) this month or holding an active duty."""
    units = units or {}
    overlap: dict[UUID, Counter] = defaultdict(Counter)
    level_of: dict[UUID, str] = {}
    people: dict[UUID, Person] = {}
    for posting in core.postings:
        person = posting.person
        if person is None or person.active_status != "active":
            continue
        people[person.id] = person
        start = max(posting.starts_on, core.starts_on)
        end = min(posting.ends_on or core.ends_on, core.ends_on)
        days = max(0, (end - start).days + 1)
        if posting.unit_id is not None:
            overlap[person.id][posting.unit_id] += days
        if person.id not in level_of or days > 15:
            level_of[person.id] = normalize_call_level(posting.posting_type or person.call_level)
    for assignment in core.active:
        if assignment.person is not None:
            people.setdefault(assignment.person_id, assignment.person)
    extra_by_person = Counter(record.person_id for record in (ledger or []) if record.status == "active")
    rows: dict[UUID, dict[str, Any]] = {}
    for person_id, person in people.items():
        unit_counter = overlap.get(person_id)
        unit_id = unit_counter.most_common(1)[0][0] if unit_counter else None
        unit = units.get(unit_id) if unit_id else None
        rows[person_id] = {
            "person_id": str(person_id),
            "name": person.canonical_name,
            "call_level": level_of.get(person_id) or normalize_call_level(person.call_level),
            "unit": unit.name if unit else None,
            "total": 0,
            "hours24": 0,
            "hours": 0.0,
            "weekend": 0,
            "weekend24": 0,
            "nights": 0,
            "holidays": 0,
            "extra": int(extra_by_person.get(person_id, 0)),
            "overrides": 0,
            "deviation_from_mean": 0.0,
        }
    for assignment in core.active:
        row = rows.get(assignment.person_id)
        if row is None:
            continue
        slot = assignment.duty_slot
        weekend = slot.duty_date.weekday() >= 5
        row["total"] += 1
        row["hours24"] += int(bool(slot.is_24hr))
        row["hours"] = round(row["hours"] + _slot_hours(slot), 1)
        row["weekend"] += int(weekend)
        row["weekend24"] += int(weekend and bool(slot.is_24hr))
        row["nights"] += int(is_night(slot))
        row["holidays"] += int(slot.duty_date.isoformat() in holidays)
        row["overrides"] += int(bool(assignment.override_reason))
    by_level: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows.values():
        by_level[row["call_level"]].append(row)
    for level_rows in by_level.values():
        mean = sum(r["total"] for r in level_rows) / len(level_rows)
        for r in level_rows:
            r["deviation_from_mean"] = round(r["total"] - mean, 2)
    return sorted(rows.values(), key=lambda r: (_call_level_sort(r["call_level"]), -r["total"], r["name"].lower()))


def _ctx_workload(ctx: ReportContext) -> list[dict[str, Any]]:
    if "workload" not in ctx.cache:
        ctx.cache["workload"] = workload_rows(ctx.core, ctx.holidays, ctx.ledger, ctx.units)
    return ctx.cache["workload"]


def fairness_from_workload(rows: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["call_level"]].append(row)
    by_level = []
    for level in sorted(grouped, key=_call_level_sort):
        level_rows = grouped[level]
        totals = [float(r["total"]) for r in level_rows]
        stats = distribution_stats(totals)
        h24 = [float(r["hours24"]) for r in level_rows]
        by_level.append(
            {
                "call_level": level,
                "label": call_level_label(level),
                **stats,
                "mean_24hr": round(sum(h24) / len(h24), 2) if h24 else 0.0,
                "gini_24hr": round(gini(h24), 3),
                "values": sorted(
                    ({"name": r["name"], "total": r["total"]} for r in level_rows),
                    key=lambda item: (item["total"], item["name"].lower()),
                ),
            }
        )
    overall = distribution_stats([float(r["total"]) for r in rows])
    members = sum(item["members"] for item in by_level)
    overall["gini_within_levels"] = (
        round(sum(item["gini"] * item["members"] for item in by_level) / members, 3) if members else 0.0
    )
    return {"by_call_level": by_level, "overall": overall}


# =========================================================================== section builders


def _approval_summary(approval: RotaPublishApproval | None) -> dict[str, Any]:
    summary = approval.summary if approval is not None else None
    return summary if isinstance(summary, dict) else {}


def _build_meta(ctx: ReportContext, month: str, generated_by: str | None, now: datetime) -> dict[str, Any]:
    core = ctx.core
    triples = [(str(a.duty_slot_id), str(a.person_id), (a.status or "").lower()) for a in core.active]
    approval = None
    if core.period is not None:
        approval = ctx.db.scalars(
            select(RotaPublishApproval)
            .where(RotaPublishApproval.rota_period_id == core.period.id)
            .options(selectinload(RotaPublishApproval.approved_by))
            .order_by(RotaPublishApproval.created_at.desc())
        ).first()
    return {
        "title": REPORT_TITLE,
        "department": DEPARTMENT_NAME,
        "month": month,
        "month_label": _month_label(month),
        "period_name": core.period.name if core.period else None,
        "period_status": core.period.status if core.period else "not created",
        "starts_on": core.starts_on.isoformat(),
        "ends_on": core.ends_on.isoformat(),
        "generated_at": now.replace(microsecond=0).isoformat(),
        "generated_by": generated_by or "System",
        "rules_revision": ctx.rules_revision,
        "rules_source": ctx.rules_source,
        "data_fingerprint": assignment_fingerprint(triples),
        "assignments_fingerprinted": len(triples),
        "published_at": _iso(approval.created_at) if approval else None,
        "published_by": (approval.approved_by.display_name if approval and approval.approved_by else None),
        "published_with_override": bool(_approval_summary(approval).get("published_with_override")),
        "override_reason": _approval_summary(approval).get("override_reason"),
        "holiday_calendar": ctx.holiday_calendar,
        "holidays_in_month": sorted(d for d in ctx.holidays if core.starts_on.isoformat() <= d <= core.ends_on.isoformat()),
        "night_definition": DEFINITIONS[2][1],
    }


def _build_summary(ctx: ReportContext) -> dict[str, Any]:
    core = ctx.core
    filled = sum(1 for slot in core.slots if _filled(slot))
    active_ids = {a.id for a in core.active}
    active_ledger = _active_ledger(ctx)
    workload = _ctx_workload(ctx)
    return {
        "slots": len(core.slots),
        "filled": filled,
        "open": len(core.slots) - filled,
        "coverage_pct": round(100.0 * filled / len(core.slots), 1) if core.slots else 0.0,
        "members": len(workload),
        "members_on_duty": sum(1 for row in workload if row["total"] > 0),
        "duties_total": len(core.active),
        "duties_24hr": sum(1 for a in core.active if a.duty_slot.is_24hr),
        "weekend_duties": sum(1 for a in core.active if a.duty_slot.duty_date.weekday() >= 5),
        "night_duties": sum(1 for a in core.active if is_night(a.duty_slot)),
        "extra_duties": len(active_ledger),
        "extra_void": sum(1 for record in ctx.ledger if record.status != "active"),
        "fallback_duties": sum(1 for record in active_ledger if record.fallback_used),
        "override_assignments": sum(1 for a in core.active if a.override_reason),
        "hard_blocked_covered": sum(
            1
            for record in active_ledger
            if "unit_safety_hard_block" in (record.overridden_rules or []) and record.assignment_id in active_ids
        ),
        "extra_batches": len(ctx.batches),
        "superadmin_allocations": sum(1 for a in core.active if a.source == SUPERADMIN_SOURCE),
        # docs/balance_extra_duties_contract.md 2: active extra duties Balance duties passed on.
        "extra_passed_on": sum(1 for record in active_ledger if _ledger_transfers(record.justice)),
    }


def _build_coverage(ctx: ReportContext) -> dict[str, Any]:
    core = ctx.core
    per_day: dict[str, list[int]] = {}
    day = core.starts_on
    while day <= core.ends_on:
        per_day[day.isoformat()] = [0, 0]
        day += timedelta(days=1)
    by_unit: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_duty: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for slot in core.slots:
        f = int(_filled(slot))
        key = slot.duty_date.isoformat()
        per_day.setdefault(key, [0, 0])
        per_day[key][0] += 1
        per_day[key][1] += f
        unit_name = slot.unit.name if slot.unit else "No unit"
        by_unit[unit_name][0] += 1
        by_unit[unit_name][1] += f
        by_duty[slot.duty_type][0] += 1
        by_duty[slot.duty_type][1] += f
    return {
        "by_day": [
            {
                "date": key,
                "weekday": date.fromisoformat(key).strftime("%a"),
                "weekend": date.fromisoformat(key).weekday() >= 5,
                "holiday": key in ctx.holidays,
                "slots": slots,
                "filled": filled,
            }
            for key, (slots, filled) in sorted(per_day.items())
        ],
        "by_unit": [
            {"unit": name, "slots": slots, "filled": filled, "open": slots - filled}
            for name, (slots, filled) in sorted(by_unit.items(), key=lambda item: item[0].lower())
        ],
        "by_duty": [
            {
                "duty_type": key,
                "label": ctx.duty_labels.get(key, key),
                "slots": slots,
                "filled": filled,
                "open": slots - filled,
            }
            for key, (slots, filled) in sorted(by_duty.items(), key=lambda item: ctx.duty_labels.get(item[0], item[0]).lower())
        ],
    }


def _build_workload(ctx: ReportContext) -> list[dict[str, Any]]:
    return [dict(row) for row in _ctx_workload(ctx)]


def _build_fairness(ctx: ReportContext) -> dict[str, Any]:
    result = fairness_from_workload(_ctx_workload(ctx))
    result["targets"], result["targets_error"] = _call_level_targets(ctx)
    result["balancing"] = _balancing(ctx)
    return result


def _balancing(ctx: ReportContext) -> list[dict[str, Any]]:
    """docs/call_level_pool_and_balance_contract.md section 2: the month's Balance duties batches
    (``summary.mode == "balance"``), their moves (cross-unit flagged) and the before/after gap
    per call level. Undone batches are listed with their status."""
    rows = []
    for batch in sorted(ctx.batches, key=lambda b: (b.created_at or datetime.min, str(b.id))):
        summary = batch.summary or {}
        if summary.get("mode") != "balance":
            continue
        rows.append({
            "batch_id": str(batch.id),
            "status": batch.status,
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
            "created_by_name": batch.created_by_name,
            "moves_count": summary.get("moves", 0),
            "swaps": summary.get("swaps", 0),
            "cross_unit": summary.get("cross_unit", 0),
            "extra_moves": summary.get("extra_moves", sum(1 for move in batch.decisions or [] if move.get("extra_duty"))),
            "levels": [
                {
                    "label": level.get("label") or level.get("call_level"),
                    "before_gap": (level.get("before") or {}).get("gap"),
                    "after_gap": (level.get("after") or {}).get("gap"),
                    "ok_after": bool(level.get("ok_after")),
                }
                for level in summary.get("levels_detail") or []
            ],
            "moves": [
                {
                    "kind": move.get("kind"),
                    "duty_date": move.get("duty_date"),
                    "duty_label": move.get("duty_label"),
                    "from_person": move.get("from_person"),
                    "to_person": move.get("to_person"),
                    "from_unit": move.get("from_unit"),
                    "to_unit": move.get("to_unit"),
                    "cross_unit": bool(move.get("cross_unit")),
                    # docs/balance_extra_duties_contract.md 1/2: an extra duty moved with its ledger record.
                    "extra_duty": bool(move.get("extra_duty")),
                    "ledger_from": _ledger_party(move.get("ledger_from"), move.get("from_person")),
                    "ledger_to": _ledger_party(move.get("ledger_to"), move.get("to_person")),
                    "new_overridden_rules": [str(c) for c in (move.get("new_overridden_rules") or [])],
                    "new_overridden_labels": [override_label(str(c)) for c in (move.get("new_overridden_rules") or [])],
                }
                for move in batch.decisions or []
            ],
        })
    return rows


def _ledger_party(value: Any, fallback: Any) -> str | None:
    """A balance move's ``ledger_from``/``ledger_to`` as a name (a dict, a plain name, or the move's person)."""
    if isinstance(value, dict):
        value = value.get("person_name") or value.get("name") or value.get("canonical_name")
    return str(value) if value else (str(fallback) if fallback else None)


def _ledger_transfers(justice: Any) -> list[dict[str, Any]]:
    """docs/balance_extra_duties_contract.md 2: ``justice.transfers`` in display form, oldest first."""
    raw = justice.get("transfers") if isinstance(justice, dict) else None
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            when = datetime.fromisoformat(str(item["at"])) if item.get("at") else None
        except ValueError:
            when = None
        name = item.get("from_person_name") or "another member"
        out.append({
            "from_person_id": item.get("from_person_id"),
            "from_person_name": item.get("from_person_name"),
            "to_person_id": item.get("to_person_id"),
            "to_person_name": item.get("to_person_name"),
            "balance_batch_id": item.get("balance_batch_id"),
            "at": item.get("at"),
            "old_overridden_rules": [str(c) for c in (item.get("old_overridden_rules") or [])],
            "text": f"Passed on from {name} by Balance duties" + (f" on {when.day} {when:%b}" if when else ""),
        })
    return out


def _call_level_targets(ctx: ReportContext) -> tuple[list[dict[str, Any]], str | None]:
    """docs/limits_callevel_fairness_contract.md 2: per call level the target (slots / members),
    min, max and gap of month duties (all campuses) against the allowed gap, and the members off
    target (below ``floor(target)`` or above ``ceil(target)``)."""
    from app.services.fairness_targets import call_level_spread

    try:
        from app.services.rota_rules import default_phase_one_rules

        # The report never writes: saved rules when present, else the defaults.
        rules = _saved_rules(ctx.db) or default_phase_one_rules()
        spread = call_level_spread(ctx.db, ctx.core.month, rules)
    except Exception as exc:  # noqa: BLE001 - the rest of the fairness section still renders
        return [], _reason(exc)
    rows = []
    for level in spread:
        target = level.get("target")
        low = math.floor(target) if target is not None else None
        high = math.ceil(target) if target is not None else None
        off = [
            {
                "person_id": m["person_id"],
                "name": m["name"],
                "duties": m["duties"],
                "extra_duties": m["extra_duties"],
                "diff_from_target": m["diff_from_target"],
                "leave_days": m.get("leave_days", 0),
            }
            for m in level.get("members", [])
            if target is not None and (m["duties"] < low or m["duties"] > high)
        ]
        rows.append({
            "call_level": level["call_level"],
            "label": level["label"],
            "slots": level["slots"],
            "members": level["member_count"],
            "target": target,
            "min": level["min"],
            "max": level["max"],
            "gap": level["gap"],
            "allowed_gap": level["allowed_gap"],
            "ok": level["ok"],
            "explained": level["explained"],
            "reason": level["reason"],
            "off_target": off,
        })
    return rows, None


def _build_units(ctx: ReportContext) -> list[dict[str, Any]]:
    core = ctx.core
    rows: dict[UUID, dict[str, Any]] = {}

    def row_for(unit_id: UUID) -> dict[str, Any]:
        if unit_id not in rows:
            unit = ctx.units.get(unit_id)
            rows[unit_id] = {
                "unit": unit.name if unit else str(unit_id),
                "code": unit.code if unit else None,
                "campus": unit.campus if unit else None,
                "members": set(),
                "slots": 0,
                "filled": 0,
                "open": 0,
                "extra_received": 0,
                "fallback_received": 0,
                "fallback_given": 0,
            }
        return rows[unit_id]

    for posting in core.postings:
        if posting.unit_id is not None and posting.person and posting.person.active_status == "active":
            row_for(posting.unit_id)["members"].add(posting.person_id)
    for slot in core.slots:
        if slot.unit_id is None:
            continue
        row = row_for(slot.unit_id)
        row["slots"] += 1
        if _filled(slot):
            row["filled"] += 1
        else:
            row["open"] += 1
    for record in _active_ledger(ctx):
        if record.assigned_unit_id is not None:
            row = row_for(record.assigned_unit_id)
            row["extra_received"] += 1
            row["fallback_received"] += int(bool(record.fallback_used))
        if record.fallback_used and record.home_unit_id is not None:
            row_for(record.home_unit_id)["fallback_given"] += 1
    result = []
    for row in rows.values():
        row["members"] = len(row["members"])
        row["coverage_pct"] = round(100.0 * row["filled"] / row["slots"], 1) if row["slots"] else 0.0
        result.append(row)
    return sorted(result, key=lambda r: r["unit"].lower())


def _build_calendar(ctx: ReportContext) -> list[dict[str, Any]]:
    extra_slots = {record.slot_id: record for record in _active_ledger(ctx)}
    rows = []
    for slot in ctx.core.slots:
        people = sorted(
            (a.person.canonical_name if a.person else str(a.person_id)) for a in slot.assignments if _is_active(a)
        )
        record = extra_slots.get(slot.id)
        rows.append(
            {
                "slot_id": str(slot.id),
                "date": slot.duty_date.isoformat(),
                "weekday": slot.duty_date.strftime("%a"),
                "unit": slot.unit.name if slot.unit else None,
                "unit_code": slot.unit.code if slot.unit else None,
                "duty_type": slot.duty_type,
                "label": ctx.duty_labels.get(slot.duty_type, slot.duty_type),
                "is_24hr": bool(slot.is_24hr),
                "person": "; ".join(people) if people else None,
                "status": "filled" if people else "open",
                "extra": record is not None,
                "fallback": bool(record and record.fallback_used),
            }
        )
    return rows


def _build_extra_duties(ctx: ReportContext) -> list[dict[str, Any]]:
    rows = []
    for record in ctx.ledger:
        codes = [str(code) for code in (record.overridden_rules or [])]
        justice = record.justice if isinstance(record.justice, dict) else {}
        transfers = _ledger_transfers(justice)
        rows.append(
            {
                "id": str(record.id),
                "batch_id": str(record.batch_id),
                "slot_id": str(record.slot_id),
                "assignment_id": str(record.assignment_id),
                "person_id": str(record.person_id),
                "person_name": _person_name(ctx, record.person_id),
                "duty_date": record.duty_date.isoformat(),
                "duty_type": record.duty_type,
                "label": ctx.duty_labels.get(record.duty_type, record.duty_type),
                "home_unit": _unit_name(ctx, record.home_unit_id),
                "assigned_unit": _unit_name(ctx, record.assigned_unit_id),
                "fallback_used": bool(record.fallback_used),
                "overridden_rules": codes,
                "overridden_labels": [override_label(code) for code in codes],
                "justice": json.loads(json.dumps(justice, default=str)),
                "reason": record.reason,
                "status": record.status,
                "void_reason": record.void_reason,
                "voided_at": _iso(record.voided_at),
                "created_at": _iso(record.created_at),
                # docs/balance_extra_duties_contract.md 2: earlier holders when Balance duties passed it on.
                "transfers": transfers,
                "passed_on_from": ", ".join(t["from_person_name"] or "?" for t in transfers) or None,
                "rebalanced": bool(transfers) or "rebalanced_extra_duty" in codes,
            }
        )
    return rows


def _report_checks(ctx: ReportContext) -> list[dict[str, Any]]:
    """Reconciliation checks computed by the report itself (not rule checks)."""
    core = ctx.core
    workload_total = sum(row["total"] for row in _ctx_workload(ctx))
    active_ids = {a.id for a in core.active}
    dangling = [r for r in _active_ledger(ctx) if r.assignment_id not in active_ids]
    over = [s for s in core.slots if sum(1 for a in s.assignments if _is_active(a)) > (s.max_assignees or 1)]
    return [
        {
            "name": "Member totals reconcile with assignments",
            "source": "report",
            "passed": workload_total == len(core.active),
            "checked": len(core.active),
            "violations": abs(workload_total - len(core.active)),
        },
        {
            "name": "Every active ledger record has its active duty",
            "source": "report",
            "passed": not dangling,
            "checked": len(_active_ledger(ctx)),
            "violations": len(dangling),
        },
        {
            "name": "No slot above its capacity",
            "source": "report",
            "passed": not over,
            "checked": len(core.slots),
            "violations": len(over),
        },
    ]


def _independent_check(db: Session, month: str) -> dict[str, Any]:
    """Run ``extra_duty_verify.check_month``; never raises."""
    try:
        from app.services.extra_duty_verify import check_month  # lazy: written independently
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "error": f"Independent check unavailable: {_reason(exc)}"}
    try:
        result = check_month(db, month)
        if not isinstance(result, dict):
            raise TypeError("check_month did not return a dict")
        return {"available": True, "error": None, "result": result}
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return {"available": False, "error": f"Independent check unavailable: {_reason(exc)}"}


def _build_compliance(ctx: ReportContext, month: str) -> dict[str, Any]:
    outcome = _independent_check(ctx.db, month)
    slots = {str(slot.id): slot for slot in ctx.core.slots}
    checks: list[dict[str, Any]] = []
    violations: list[dict[str, Any]] = []
    checked = 0
    if outcome["available"]:
        result = outcome["result"]
        checked = int(result.get("checked") or 0)
        for check in result.get("checks") or []:
            v = check.get("violations")
            checks.append(
                {
                    "name": str(check.get("name")),
                    "source": "independent",
                    "passed": bool(check.get("passed")),
                    "checked": int(check.get("checked") or 0),
                    "violations": len(v) if isinstance(v, list) else int(v or 0),
                }
            )
        for item in result.get("violations") or []:
            slot = slots.get(str(item.get("slot_id")))
            person_id = item.get("person_id")
            try:
                name = _person_name(ctx, UUID(str(person_id))) if person_id else None
            except ValueError:
                name = str(person_id)
            violations.append(
                {
                    "slot_id": str(item.get("slot_id")),
                    "person_id": str(person_id) if person_id else None,
                    "person_name": name,
                    "date": slot.duty_date.isoformat() if slot else None,
                    "duty": ctx.duty_labels.get(slot.duty_type, slot.duty_type) if slot else None,
                    "unit": slot.unit.name if slot and slot.unit else None,
                    "code": str(item.get("code")),
                    "message": str(item.get("message")),
                }
            )
    report_checks = _report_checks(ctx)
    all_checks = checks + report_checks
    return {
        "available": outcome["available"],
        "error": outcome["error"],
        "checked": checked,
        "checks": all_checks,
        "violations": violations,
        "all_passed": bool(outcome["available"]) and all(check["passed"] for check in all_checks),
    }


def _build_trend(ctx: ReportContext, month: str) -> list[dict[str, Any]]:
    trend: list[dict[str, Any]] = []
    for back in range(1, TREND_LOOKBACK + 1):
        if len(trend) >= TREND_MONTHS:
            break
        prev = _month_shift(month, -back)
        core = load_month_core(ctx.db, prev)
        if not core.slots:
            continue
        rows = workload_rows(core, ctx.holidays)
        fairness = fairness_from_workload(rows)
        extra = ctx.db.scalars(
            select(ExtraDutyRecord.id).where(ExtraDutyRecord.month == prev, ExtraDutyRecord.status == "active")
        ).all()
        filled = sum(1 for slot in core.slots if _filled(slot))
        trend.append(
            {
                "month": prev,
                "month_label": _month_label(prev),
                "slots": len(core.slots),
                "filled": filled,
                "duties": len(core.active),
                "coverage_pct": round(100.0 * filled / len(core.slots), 1),
                "extra": len(extra),
                "gini": fairness["overall"]["gini_within_levels"],
            }
        )
    return list(reversed(trend))


def _saved_rules(db: Session):
    """The saved rules, or None when they were never saved (keeps the report read-only)."""
    from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules

    saved = db.scalar(select(RuleSetting.id).where(RuleSetting.key == PHASE_ONE_SETTING_KEY).limit(1))
    if saved is None:
        return None
    _version, rules = get_phase_one_rules(db)
    return rules


def _build_individual_limits(ctx: ReportContext, month: str) -> dict[str, Any]:
    """Members above an individual duty limit (docs/extra_duty_fill_all_contract.md §6), using the
    same helper as the publish checklist."""
    rules = _saved_rules(ctx.db)
    if rules is None:
        return {"configured": False, "limits": [], "people": []}
    limits = rules.duty_count_limits
    configured = [
        {"key": key, "label": label, "limit": getattr(limits, key)}
        for key, label in LIMIT_SETTINGS
        if getattr(limits, key) is not None
    ]
    if not configured:
        return {"configured": False, "limits": [], "people": []}
    from app.services.rota_review import individual_limit_breaches

    people = []
    for row in individual_limit_breaches(ctx.db, month, rules):
        people.append(
            {
                "person_id": str(row.get("person_id")),
                "person_name": str(row.get("person_name") or ""),
                "call_level": row.get("call_level"),
                "call_level_label": call_level_label(row.get("call_level")),
                "home_unit_name": row.get("home_unit_name"),
                "month_duties": int(row.get("month_duties") or 0),
                "month_24hr": int(row.get("month_24hr") or 0),
                "limits": [
                    {
                        "code": str(item.get("code")),
                        "label": str(item.get("label") or item.get("code")),
                        "limit": item.get("limit"),
                        "actual": item.get("actual"),
                    }
                    for item in row.get("limits") or []
                ],
            }
        )
    people.sort(key=lambda r: (r["person_name"].lower(), r["person_id"]))
    return {"configured": True, "limits": configured, "people": people}


def _build_superadmin(ctx: ReportContext) -> dict[str, Any]:
    """Superadmin actions (docs/superadmin_override_contract.md section 2): every superadmin
    allocation batch of the month (active, void or undone) and every publish made with the
    superadmin override."""
    records_by_batch: dict[UUID, list[ExtraDutyRecord]] = {}
    for record in ctx.ledger:
        records_by_batch.setdefault(record.batch_id, []).append(record)
    active_ids = {a.id for a in ctx.core.active}
    allocations: list[dict[str, Any]] = []
    seen_assignments: set[str] = set()
    for batch in ctx.batches:
        summary = batch.summary if isinstance(batch.summary, dict) else {}
        if summary.get("mode") != SUPERADMIN_MODE:
            continue
        decisions = [d for d in (batch.decisions or []) if isinstance(d, dict)]
        records = records_by_batch.get(batch.id, [])
        for index, decision in enumerate(decisions or [{}]):
            record = records[index] if index < len(records) else None
            codes = [str(c) for c in (record.overridden_rules if record is not None else decision.get("overridden_rules") or [])]
            duty_type = decision.get("duty_type") or (record.duty_type if record is not None else None)
            duty_date = decision.get("duty_date") or (record.duty_date.isoformat() if record is not None else None)
            person_id = decision.get("person_id") or (str(record.person_id) if record is not None else None)
            if batch.status == "undone":
                status = "undone"
            elif record is not None:
                status = "active" if record.status == "active" and record.assignment_id in active_ids else (record.status or "void")
            else:
                status = "active"
            if record is not None:
                seen_assignments.add(str(record.assignment_id))
            allocations.append(
                {
                    "batch_id": str(batch.id),
                    "duty_date": duty_date,
                    "duty_type": duty_type,
                    "label": decision.get("duty_label") or ctx.duty_labels.get(str(duty_type), duty_type),
                    "unit": decision.get("unit_name")
                    or (_unit_name(ctx, record.assigned_unit_id) if record is not None else None),
                    "person_id": person_id,
                    "person_name": decision.get("person_name")
                    or (_person_name(ctx, record.person_id) if record is not None else None),
                    "overridden_rules": codes,
                    "overridden_labels": [override_label(c) for c in codes if c != "superadmin_allocation"],
                    "reason": summary.get("reason") or decision.get("reason"),
                    "by": summary.get("by") or batch.created_by_name,
                    "at": _iso(batch.created_at),
                    "post_publish": bool(summary.get("post_publish") or decision.get("post_publish")),
                    "replaced": len(decision.get("replaced") or []) if isinstance(decision.get("replaced"), list)
                    else int(summary.get("replaced") or 0),
                    "status": status,
                }
            )
    # Active superadmin assignments without a batch (should not happen; never hide them).
    for assignment in ctx.core.active:
        if assignment.source != SUPERADMIN_SOURCE or str(assignment.id) in seen_assignments:
            continue
        slot = assignment.duty_slot
        reason = (assignment.override_reason or "").removeprefix("Superadmin allocation:").strip()
        allocations.append(
            {
                "batch_id": None, "duty_date": slot.duty_date.isoformat(), "duty_type": slot.duty_type,
                "label": ctx.duty_labels.get(slot.duty_type, slot.duty_type), "unit": _unit_name(ctx, slot.unit_id),
                "person_id": str(assignment.person_id), "person_name": _person_name(ctx, assignment.person_id),
                "overridden_rules": [], "overridden_labels": [], "reason": reason or None, "by": None,
                "at": _iso(assignment.created_at), "post_publish": False, "replaced": 0, "status": "active",
            }
        )
    allocations.sort(key=lambda r: (str(r["duty_date"] or ""), str(r["duty_type"] or ""), str(r["at"] or "")))

    overrides: list[dict[str, Any]] = []
    if ctx.core.period is not None:
        for approval in ctx.db.scalars(
            select(RotaPublishApproval)
            .where(RotaPublishApproval.rota_period_id == ctx.core.period.id)
            .options(selectinload(RotaPublishApproval.approved_by))
            .order_by(RotaPublishApproval.created_at)
        ):
            summary = _approval_summary(approval)
            if not summary.get("published_with_override"):
                continue
            blockers = [
                {"title": str(b.get("title") or ""), "detail": str(b.get("detail") or "")}
                for b in summary.get("blockers") or []
                if isinstance(b, dict)
            ]
            overrides.append(
                {
                    "at": _iso(approval.created_at),
                    "by": summary.get("override_by")
                    or (approval.approved_by.display_name if approval.approved_by else None),
                    "reason": summary.get("override_reason"),
                    "open_slots": int(summary.get("open_slots") or 0),
                    "blockers": blockers,
                    "warnings_unconfirmed": int(summary.get("warnings_unconfirmed") or 0),
                }
            )
    return {
        "allocations": allocations,
        "active_allocations": sum(1 for r in allocations if r["status"] == "active"),
        "post_publish_allocations": sum(1 for r in allocations if r["status"] == "active" and r["post_publish"]),
        "publish_overrides": overrides,
    }


def _batch_mode_text(summary: dict[str, Any]) -> str:
    mode = summary.get("mode")
    if not mode:
        return ""
    parts = [f"mode {BATCH_MODE_LABELS.get(str(mode), str(mode))}"]
    for key, label in (("cross_unit", "from another unit"), ("unposted_used", "unposted member(s)"),
                       ("over_limit_people", "member(s) over an individual limit")):
        value = summary.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value:
            parts.append(f"{int(value)} {label}")
    return "; " + ", ".join(parts)


def _build_audit_trail(ctx: ReportContext) -> list[dict[str, Any]]:
    db, period = ctx.db, ctx.core.period
    events: list[dict[str, Any]] = []
    if period is not None:
        for run in db.scalars(select(RotaTemplateGenerationRun).where(RotaTemplateGenerationRun.rota_period_id == period.id)):
            summary = run.summary or {}
            events.append(
                {
                    "at": _iso(run.created_at),
                    "actor": summary.get("operator_name") or "Rota board",
                    "action": "Template built",
                    "detail": (
                        f"{run.created_slots} slots created, {run.needs_review_slots} need review, "
                        f"{run.skipped_slots} skipped, {run.blocked_slots} blocked; {run.included_units} units; status {run.status}"
                    ),
                }
            )
        for run in db.scalars(select(RotaAutoFillRun).where(RotaAutoFillRun.rota_period_id == period.id)):
            summary = run.summary or {}
            events.append(
                {
                    "at": _iso(run.created_at),
                    "actor": summary.get("operator_name") or "Rota board",
                    "action": "Members auto-assigned",
                    "detail": (
                        f"{run.assigned_slots} of {run.total_slots} slots assigned, {run.review_slots} for review, "
                        f"{run.skipped_slots} skipped, {run.blocked_slots} blocked; status {run.status}"
                    ),
                }
            )
        for approval in db.scalars(
            select(RotaPublishApproval)
            .where(RotaPublishApproval.rota_period_id == period.id)
            .options(selectinload(RotaPublishApproval.approved_by))
        ):
            events.append(
                {
                    "at": _iso(approval.created_at),
                    "actor": approval.approved_by.display_name if approval.approved_by else "Unknown",
                    "action": (
                        ("Rota published (superadmin override)"
                         if _approval_summary(approval).get("published_with_override") else "Rota published")
                        if approval.status == "published" else f"Publish: {approval.status}"
                    ),
                    "detail": (approval.approval_note or "")
                    + (" (warnings confirmed)" if approval.confirmed_warnings else ""),
                }
            )
    for batch in ctx.batches:
        summary = batch.summary or {}
        if summary.get("mode") == SUPERADMIN_MODE:
            decision = next((d for d in (batch.decisions or []) if isinstance(d, dict)), {})
            events.append(
                {
                    "at": _iso(batch.created_at),
                    "actor": summary.get("by") or batch.created_by_name or "Unknown",
                    "action": "Superadmin allocation",
                    "detail": (
                        f"{decision.get('person_name') or 'member'} on {decision.get('duty_date') or '?'} "
                        f"{decision.get('duty_label') or decision.get('duty_type') or ''}"
                        f"{' (after publishing)' if summary.get('post_publish') else ''}: {summary.get('reason') or ''}; "
                        f"batch {str(batch.id)[:8]}"
                    ),
                }
            )
            if batch.status == "undone" or batch.undone_at is not None:
                events.append(
                    {
                        "at": _iso(batch.undone_at or batch.created_at),
                        "actor": batch.undone_by_name or "Unknown",
                        "action": "Superadmin allocation undone",
                        "detail": f"batch {str(batch.id)[:8]}",
                    }
                )
            continue
        events.append(
            {
                "at": _iso(batch.created_at),
                "actor": batch.created_by_name or "Unknown",
                "action": "Extra-duty layer applied",
                "detail": (
                    f"{summary.get('filled', 0)} filled, {summary.get('fallback', 0)} with fallback unit, "
                    f"{summary.get('ledger_records', 0)} ledger records, {summary.get('unfilled', 0)} could not be filled; "
                    f"batch {str(batch.id)[:8]}, plan {str(batch.plan_hash)[:12]}"
                    + _batch_mode_text(summary)
                ),
            }
        )
        if batch.status == "undone" or batch.undone_at is not None:
            events.append(
                {
                    "at": _iso(batch.undone_at or batch.created_at),
                    "actor": batch.undone_by_name or "Unknown",
                    "action": "Extra-duty batch undone",
                    "detail": f"batch {str(batch.id)[:8]}; its assignments were removed and ledger records voided",
                }
            )
    return sorted(events, key=lambda e: (e["at"] or "", e["action"]))


EMPTY_SECTIONS: dict[str, Callable[[], Any]] = {
    "summary": dict,
    "coverage": lambda: {"by_day": [], "by_unit": [], "by_duty": []},
    "workload": list,
    "fairness": lambda: {"by_call_level": [], "overall": {}},
    "individual_limits": lambda: {"configured": False, "limits": [], "people": []},
    "units": list,
    "calendar": list,
    "extra_duties": list,
    "superadmin": lambda: {"allocations": [], "active_allocations": 0, "post_publish_allocations": 0, "publish_overrides": []},
    "compliance": lambda: {"available": False, "error": None, "checked": 0, "checks": [], "violations": [], "all_passed": False},
    "trend": list,
    "audit_trail": list,
}


def _canonical_hash(data: dict[str, Any]) -> str:
    clone = dict(data)
    clone["meta"] = {k: v for k, v in data.get("meta", {}).items() if k not in {"generated_at", "generated_by", "report_fingerprint"}}
    return hashlib.sha256(json.dumps(clone, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def build_report_data(
    db: Session,
    month: str,
    *,
    generated_by: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Assemble the whole report for ``YYYY-MM`` as JSON-serialisable data (section 6 shape).

    Extra keys beyond the contract: ``meta.title``/``period_name``/``rules_source``/
    ``holiday_calendar``/``holidays_in_month``/``report_fingerprint``, ``sections`` (ids and
    titles in order), ``definitions`` and ``section_errors`` ({section: reason}).
    """
    month_bounds(month)  # validates the format (ValueError)
    now = now or datetime.now()
    errors: dict[str, str] = {}
    data: dict[str, Any] = {}
    try:
        ctx: ReportContext | None = load_context(db, month)
    except Exception as exc:  # noqa: BLE001
        ctx = None
        load_error = _reason(exc)
    if ctx is None:
        data["meta"] = {
            "title": REPORT_TITLE,
            "department": DEPARTMENT_NAME,
            "month": month,
            "month_label": _month_label(month),
            "period_status": "unknown",
            "generated_at": now.replace(microsecond=0).isoformat(),
            "generated_by": generated_by or "System",
            "rules_revision": None,
            "data_fingerprint": None,
            "published_at": None,
            "published_by": None,
        }
        for key, empty in EMPTY_SECTIONS.items():
            data[key] = empty()
            errors[key] = f"Could not read the month: {load_error}"
    else:
        try:
            data["meta"] = _build_meta(ctx, month, generated_by, now)
        except Exception as exc:  # noqa: BLE001
            errors["meta"] = _reason(exc)
            data["meta"] = {
                "title": REPORT_TITLE, "department": DEPARTMENT_NAME, "month": month,
                "month_label": _month_label(month), "period_status": "unknown",
                "generated_at": now.replace(microsecond=0).isoformat(), "generated_by": generated_by or "System",
                "rules_revision": None, "data_fingerprint": None, "published_at": None, "published_by": None,
            }
        builders: list[tuple[str, Callable[[], Any]]] = [
            ("summary", lambda: _build_summary(ctx)),
            ("coverage", lambda: _build_coverage(ctx)),
            ("workload", lambda: _build_workload(ctx)),
            ("fairness", lambda: _build_fairness(ctx)),
            ("individual_limits", lambda: _build_individual_limits(ctx, month)),
            ("units", lambda: _build_units(ctx)),
            ("calendar", lambda: _build_calendar(ctx)),
            ("extra_duties", lambda: _build_extra_duties(ctx)),
            ("superadmin", lambda: _build_superadmin(ctx)),
            ("compliance", lambda: _build_compliance(ctx, month)),
            ("trend", lambda: _build_trend(ctx, month)),
            ("audit_trail", lambda: _build_audit_trail(ctx)),
        ]
        for key, builder in builders:
            try:
                with db.no_autoflush:
                    value = builder()
                # Fail here (not in the API) if a section produced something JSON cannot hold.
                json.dumps(value)
                data[key] = value
            except Exception as exc:  # noqa: BLE001
                errors[key] = _reason(exc)
                data[key] = EMPTY_SECTIONS[key]()
    data["sections"] = [{"id": key, "title": title} for key, title in SECTIONS]
    data["definitions"] = [{"term": term, "meaning": meaning} for term, meaning in DEFINITIONS]
    data["section_errors"] = errors
    data["meta"]["report_fingerprint"] = _canonical_hash(data)
    return data


# =========================================================================== HTML rendering


def e(value: Any) -> str:
    """Escape any dynamic value for HTML text and attributes."""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def fmt_num(value: Any, dp: int = 0) -> str:
    if value is None or value == "":
        return "–"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return e(value)
    if dp == 0:
        return f"{int(round(number)):,}"
    return f"{number:,.{dp}f}"


def fmt_signed(value: Any, dp: int = 2) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "–"
    if abs(number) < 0.005:
        return "0.00"
    return f"{'+' if number > 0 else '−'}{abs(number):.{dp}f}"


def fmt_date(value: Any) -> str:
    if not value:
        return "–"
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%a %d %b %Y")
    except ValueError:
        return e(value)


def fmt_datetime(value: Any) -> str:
    if not value:
        return "–"
    try:
        return datetime.fromisoformat(str(value)).strftime("%d %b %Y, %H:%M")
    except ValueError:
        return e(value)


def fmt_day(value: Any) -> str:
    if not value:
        return "–"
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%a %d %b")
    except ValueError:
        return e(value)


def short_date(value: Any) -> str:
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d %b")
    except ValueError:
        return e(value)


CSS = """
:root{
  --ink:#0f1e36;--ink-2:#2b3a55;--muted:#5a6578;--faint:#8a94a6;--line:#dfe3ea;--line-2:#eceff4;
  --paper:#ffffff;--bg:#eef1f5;--soft:#f6f7fa;--zebra:#f8f9fb;
  --accent:#b42335;--accent-ink:#8f1b2a;--accent-soft:#f9eaec;
  --ok:#1d6b43;--ok-soft:#e6f3ec;--warn:#8a5a00;--warn-soft:#fcf3df;
  --n1:#eef2f8;--n2:#d3ddeb;--n3:#a8bad5;--n4:#6f8cb8;--n5:#3d5e94;--n6:#1c3a6b;
  --mono:"Cascadia Mono","Consolas","SFMono-Regular",Menlo,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:var(--ink-2)}
.layout{display:grid;grid-template-columns:252px minmax(0,1fr);max-width:1360px;margin:0 auto}
.toc{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:28px 18px 28px 22px;border-right:1px solid var(--line);background:var(--paper)}
.toc .brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 4px}
.toc .brand-sub{font-size:13px;color:var(--ink);font-weight:600;margin:0 0 18px;line-height:1.35}
.toc ol{list-style:none;margin:0;padding:0;counter-reset:toc}
.toc li{counter-increment:toc}
.toc a{display:flex;gap:10px;align-items:baseline;padding:6px 10px;border-radius:6px;text-decoration:none;color:var(--ink-2);font-size:13px}
.toc a::before{content:counter(toc,decimal-leading-zero);font:600 11px var(--mono);color:var(--faint);min-width:18px}
.toc a:hover,.toc a:focus-visible{background:var(--soft);color:var(--ink);outline:none}
.toc a:focus-visible{box-shadow:0 0 0 2px var(--n4)}
.toc .err{color:var(--accent);font-size:11px;margin-left:auto}
.toc .foot{margin-top:22px;padding-top:14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted)}
main{padding:28px 28px 72px;min-width:0}
.sheet{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:30px 32px 32px;margin:0 0 26px;box-shadow:0 1px 2px rgba(15,30,54,.04),0 8px 24px -16px rgba(15,30,54,.18)}
.sec-head{display:flex;align-items:flex-end;gap:14px;border-bottom:2px solid var(--ink);padding-bottom:10px;margin:0 0 22px}
.sec-num{font:700 12px var(--mono);color:var(--accent);letter-spacing:.06em;padding-bottom:5px}
h2{font-size:22px;line-height:1.2;margin:0;font-weight:650;letter-spacing:-.01em}
.sec-head .lede{margin-left:auto;color:var(--muted);font-size:12.5px;padding-bottom:3px;text-align:right}
h3{font-size:14.5px;margin:26px 0 10px;font-weight:650;color:var(--ink)}
h3 .h3-note{font-weight:400;color:var(--muted);font-size:12.5px;margin-left:6px}
p{margin:0 0 10px}
.muted{color:var(--muted)}
.small{font-size:12px}
.mono{font-family:var(--mono);font-size:12px;word-break:break-all}
/* cover */
.cover{padding:0;overflow:hidden}
.cover-band{background:var(--ink);color:#fff;padding:44px 48px 40px;position:relative}
.cover-band::after{content:"";position:absolute;left:48px;bottom:0;width:84px;height:5px;background:var(--accent)}
.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:#c9d3e4;margin:0 0 18px}
.cover h1{font-size:40px;line-height:1.08;margin:0 0 10px;letter-spacing:-.02em;font-weight:700}
.cover .dept{font-size:16px;color:#dce3ef;margin:0}
.cover .month{font-size:26px;font-weight:300;margin:22px 0 0;color:#fff}
.cover-body{padding:30px 48px 40px}
.status{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:650;letter-spacing:.02em;border:1px solid}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.st-published{color:var(--ok);background:var(--ok-soft);border-color:#b9dcc8}
.st-draft{color:var(--warn);background:var(--warn-soft);border-color:#ecd7a6}
.st-other{color:var(--ink-2);background:var(--soft);border-color:var(--line)}
.meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 36px;margin:20px 0 6px}
.meta-grid dl{margin:0}
.kv{display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px 14px;padding:9px 0;border-bottom:1px solid var(--line-2);font-size:13px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;color:var(--ink);font-weight:500;min-width:0}
.fp{margin:18px 0 0;padding:14px 16px;background:var(--soft);border:1px solid var(--line);border-radius:8px}
.fp .kv{grid-template-columns:150px minmax(0,1fr);border-color:var(--line)}
.fp .kv:last-child{border-bottom:0}
.contents{columns:2;column-gap:36px;margin:8px 0 0;padding:0;list-style:none;font-size:13px}
.contents li{display:flex;gap:10px;padding:4px 0;border-bottom:1px dotted var(--line);break-inside:avoid}
.contents .n{font:600 11.5px var(--mono);color:var(--accent);min-width:20px;padding-top:1px}
.signoff{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin:14px 0 0}
.sign{border:1px solid var(--line);border-radius:8px;padding:14px 16px 16px}
.sign .role{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 14px}
.sign .line{display:flex;align-items:flex-end;gap:8px;font-size:12px;color:var(--muted);margin:16px 0 0}
.sign .line span{flex:1;border-bottom:1px solid var(--ink-2);height:18px}
.confidential{margin-top:22px;font-size:11.5px;color:var(--muted)}
/* KPI */
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 8px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:14px 16px 13px;background:var(--paper);position:relative}
.kpi.lead{background:var(--ink);border-color:var(--ink);color:#fff}
.kpi.lead .k-label,.kpi.lead .k-sub{color:#c9d3e4}
.kpi.alert{border-color:#e3b3ba;background:var(--accent-soft)}
.kpi.alert .k-value{color:var(--accent-ink)}
.k-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:650}
.k-value{font-size:28px;font-weight:650;line-height:1.15;margin:6px 0 2px;letter-spacing:-.01em}
.k-value small{font-size:14px;font-weight:500;color:inherit;opacity:.75;margin-left:2px}
.k-sub{font-size:12px;color:var(--muted)}
.meter{height:5px;background:rgba(255,255,255,.18);border-radius:3px;margin-top:9px;overflow:hidden}
.meter i{display:block;height:100%;background:#fff;border-radius:3px}
.findings{margin:18px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.findings li{display:flex;gap:12px;align-items:flex-start;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--soft);font-size:13.5px}
.findings .dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:6px;background:var(--n5)}
.findings .dot.bad{background:var(--accent)}
.findings .dot.good{background:var(--ok)}
.defs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px;margin:6px 0 0;font-size:12.5px}
.defs div{padding:7px 0;border-bottom:1px solid var(--line-2)}
.defs dt{font-weight:650;display:inline}
.defs dd{display:inline;margin:0;color:var(--ink-2)}
/* tables */
.tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:0 0 6px}
table.tbl{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--paper)}
.tbl caption{caption-side:top;text-align:left;font-size:12px;color:var(--muted);padding:9px 12px;background:var(--soft);border-bottom:1px solid var(--line)}
.tbl caption b{color:var(--ink);font-weight:650;margin-right:6px}
.tbl th,.tbl td{padding:7px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line-2);white-space:nowrap}
.tbl td.wrap,.tbl th.wrap{white-space:normal;min-width:160px}
.tbl td.wide{min-width:230px}
.tbl td.wrap-s,.tbl th.wrap-s{white-space:normal;min-width:96px}
.tbl td.wrap .tag{white-space:normal}
.tbl thead th{background:#f1f3f7;color:var(--ink-2);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;border-bottom:1px solid var(--line);white-space:normal;vertical-align:bottom}
.tbl tbody tr:nth-child(even){background:var(--zebra)}
.tbl tbody tr:hover{background:#eef2f8}
.tbl tfoot td,.tbl tfoot th{font-weight:700;border-top:2px solid var(--ink-2);background:var(--soft);border-bottom:0}
.tbl .num{text-align:right;white-space:nowrap}
.tbl .unit{color:var(--faint);font-weight:400;font-size:11px;margin-left:2px}
.tbl td.name{font-weight:550}
.tbl .void td{color:var(--faint)}
.tbl .void td.name{text-decoration:line-through}
.tbl .grp th{background:var(--n1);color:var(--ink);font-size:11.5px;letter-spacing:.04em;text-transform:none;font-weight:700}
.bar{display:inline-block;vertical-align:middle;height:7px;border-radius:2px;background:var(--n4);margin-left:8px}
.bar.ac{background:var(--accent)}
.barcell{display:flex;align-items:center;justify-content:flex-end;gap:0}
.barcell .track{width:56px;height:7px;background:var(--line-2);border-radius:2px;margin-left:9px;overflow:hidden;flex:none}
.barcell .track i{display:block;height:100%;background:var(--n5);border-radius:2px}
.dev{display:inline-block;min-width:52px;text-align:right;padding:1px 6px;border-radius:4px}
.dev.hi{background:var(--accent-soft);color:var(--accent-ink)}
.dev.lo{background:var(--n1);color:var(--n6)}
.tag{display:inline-block;font-size:11px;font-weight:650;padding:1px 7px;border-radius:4px;border:1px solid var(--line);color:var(--ink-2);background:var(--paper);white-space:nowrap;margin:1px 3px 1px 0}
.tag.ac{color:var(--accent-ink);background:var(--accent-soft);border-color:#e9c1c7}
.tag.ok{color:var(--ok);background:var(--ok-soft);border-color:#bfdcca}
.tag.void{color:var(--muted);background:var(--soft)}
.pf{display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:12px;padding:2px 9px;border-radius:999px}
.pf.pass{color:var(--ok);background:var(--ok-soft)}
.pf.fail{color:var(--accent-ink);background:var(--accent-soft)}
.pf.na{color:var(--muted);background:var(--soft)}
.callout{border:1px solid var(--line);border-left:4px solid var(--n5);border-radius:6px;padding:11px 14px;background:var(--soft);font-size:13px;margin:0 0 16px}
.callout.bad{border-left-color:var(--accent);background:var(--accent-soft)}
.callout.good{border-left-color:var(--ok);background:var(--ok-soft)}
.unavailable{border:1px dashed #d9a9b0;background:var(--accent-soft);color:var(--accent-ink);border-radius:8px;padding:16px 18px;font-size:13.5px}
.empty{border:1px dashed var(--line);border-radius:8px;padding:22px;text-align:center;color:var(--muted);background:var(--soft);font-size:13px}
.verdict{display:flex;align-items:center;gap:16px;padding:16px 20px;border-radius:10px;margin:0 0 18px;border:1px solid}
.verdict.pass{background:var(--ok-soft);border-color:#bfdcca;color:var(--ok)}
.verdict.fail{background:var(--accent-soft);border-color:#e9c1c7;color:var(--accent-ink)}
.verdict.na{background:var(--soft);border-color:var(--line);color:var(--ink-2)}
.verdict .big{font-size:20px;font-weight:700}
.verdict .sub{color:var(--ink-2);font-size:13px}
/* figures */
figure{margin:6px 0 18px;padding:16px 18px 12px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
figcaption{font-size:13px;font-weight:650;color:var(--ink);margin:0 0 4px}
figcaption span{display:block;font-weight:400;color:var(--muted);font-size:12px;margin-top:1px}
figure svg{display:block;width:100%;height:auto;max-width:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--ink-2);margin:8px 0 2px}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
details.data{margin-top:8px;font-size:12.5px}
details.data summary{cursor:pointer;color:var(--ink-2);font-weight:600;padding:4px 0}
details.data .tbl-wrap{margin-top:8px}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
/* rota calendar grid */
.cal{font-size:11px}
.cal th,.cal td{padding:5px 7px}
.cal td{white-space:normal}
.cal thead th{font-size:10px;letter-spacing:.04em;text-transform:none;white-space:normal;min-width:84px;vertical-align:bottom}
.cal th[scope=row]{white-space:nowrap;font-weight:650;position:sticky;left:0;background:inherit;z-index:1;min-width:86px}
.cal tbody tr{background:var(--paper)}
.cal tbody tr.we{background:#f4f6fa}
.cal tbody tr.hol th[scope=row]{color:var(--accent-ink)}
.cal td.open{color:var(--accent-ink);font-weight:650;background:repeating-linear-gradient(135deg,transparent 0 5px,rgba(180,35,53,.07) 5px 8px)}
.cal td .x{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:4px;vertical-align:1px}
.cal td .who{display:block;line-height:1.35}
.cal td .uc{color:var(--faint);font-size:9.5px;margin-right:3px}
.footer{margin:26px 0 0;color:var(--muted);font-size:11.5px;text-align:center}
@media screen and (max-width:980px){
  .layout{display:block}
  .toc{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:16px}
  .toc ol{display:flex;flex-wrap:wrap;gap:2px}
  .toc .foot{display:none}
  main{padding:16px}
  .sheet{padding:22px 18px}
  .sheet.cover{padding:0}
  .cover-band,.cover-body{padding-left:22px;padding-right:22px}
  .cover-band::after{left:22px}
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .meta-grid,.grid2,.defs,.signoff{grid-template-columns:minmax(0,1fr)}
  .contents{columns:1}
  .sec-head{flex-wrap:wrap}
  .sec-head .lede{margin-left:0;text-align:left;width:100%}
  .kv{grid-template-columns:120px minmax(0,1fr)}
}
@page{size:A4;margin:15mm 13mm 17mm 13mm;
  @bottom-left{content:"__FOOTER__";font:8pt "Segoe UI",Arial,sans-serif;color:#5a6578}
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt "Segoe UI",Arial,sans-serif;color:#5a6578}}
@page wide{size:A4 landscape;margin:12mm 11mm 15mm 11mm}
@page coverpage{margin:0;@bottom-left{content:none}@bottom-right{content:none}}
@media print{
  body{background:#fff;font-size:9.5pt}
  .layout{display:block;max-width:none}
  .toc,.no-print,details.data{display:none!important}
  main{padding:0}
  .sheet{border:0;border-radius:0;box-shadow:none;padding:0;margin:0;break-before:page;page-break-before:always}
  .sheet.cover{break-before:auto;page-break-before:auto;page:coverpage;height:296mm;overflow:hidden;display:flex;flex-direction:column}
  .cover-band{padding:24mm 18mm 11mm}
  .cover-band::after{left:18mm}
  .cover h1{font-size:30pt}
  .cover .month{font-size:19pt;margin-top:12px}
  .cover-body{padding:7mm 18mm 8mm;flex:1}
  .cover-body h3{margin:12px 0 6px}
  .meta-grid{margin:6px 0 0}
  .kv{padding:5px 0;font-size:9pt}
  .fp{margin:10px 0 0;padding:6px 12px}
  .contents{font-size:9pt}
  .contents li{padding:2px 0}
  .sign{padding:9px 12px 11px}
  .sign .role{margin:0 0 4px}
  .sign .line{margin:12px 0 0}
  .confidential{margin-top:10px;font-size:8pt}
  .sheet.wide{page:wide}
  .tbl-wrap{overflow:visible;border:0;border-radius:0}
  table.tbl{font-size:8.5pt}
  .tbl th,.tbl td{padding:4px 7px}
  .tbl caption{border:1px solid var(--line);border-bottom:0}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  tr,figure,.kpi,.sign,.callout,.verdict{break-inside:avoid;page-break-inside:avoid}
  h2,h3{break-after:avoid;page-break-after:avoid}
  .tbl tbody tr:hover{background:inherit}
  .tbl tbody tr:nth-child(even){background:var(--zebra)}
  figure{border-color:var(--line)}
  .cal{font-size:7pt}
  .cal th,.cal td{padding:1.5px 4px;line-height:1.2}
  .cal td .who{line-height:1.2}
  .cal thead th{min-width:0}
  .cal th[scope=row]{position:static;min-width:0}
  .footer{display:none}
  a{text-decoration:none;color:inherit}
}
"""


# --------------------------------------------------------------------------- SVG charts


def _nice_step(raw: float, integer: bool = True) -> float:
    if raw <= 0:
        return 1.0
    exp = 10 ** math.floor(math.log10(raw))
    for mult in (1, 2, 5, 10):
        step = mult * exp
        if step >= raw:
            return max(1.0, step) if integer else step
    return 10 * exp


def _ticks(maximum: float, count: int = 4) -> list[float]:
    """Round, integer tick values from 0 to at least ``maximum`` (about ``count`` intervals)."""
    step = _nice_step(max(maximum, 1) / count)
    top = step * max(1, math.ceil(max(maximum, 1) / step))
    return [step * i for i in range(int(round(top / step)) + 1)]


def _nice_max(value: float) -> float:
    return _ticks(value)[-1]


def _svg_open(width: int, height: int, label: str) -> str:
    # No xmlns attribute: inline SVG in HTML does not need it, and the file stays free of URLs.
    return (
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{e(label)}" '
        'font-family="Segoe UI, system-ui, Arial, sans-serif" preserveAspectRatio="xMidYMid meet">'
        f"<title>{e(label)}</title>"
    )


def _bar_path(x: float, y: float, w: float, h: float, r: float = 3.0, top: bool = True) -> str:
    """Rect with rounded top corners only (data end), square at the baseline."""
    if h <= 0 or w <= 0:
        return ""
    r = min(r, w / 2, h)
    if not top:
        return f'M{x:.1f},{y:.1f}h{w:.1f}v{h:.1f}h{-w:.1f}z'
    return (
        f'M{x:.1f},{y + h:.1f}V{y + r:.1f}Q{x:.1f},{y:.1f} {x + r:.1f},{y:.1f}'
        f'H{x + w - r:.1f}Q{x + w:.1f},{y:.1f} {x + w:.1f},{y + r:.1f}V{y + h:.1f}z'
    )


def _hbar_path(x: float, y: float, w: float, h: float, r: float = 3.0, end: bool = True) -> str:
    if h <= 0 or w <= 0:
        return ""
    r = min(r, h / 2, w)
    if not end:
        return f'M{x:.1f},{y:.1f}h{w:.1f}v{h:.1f}h{-w:.1f}z'
    return (
        f'M{x:.1f},{y:.1f}H{x + w - r:.1f}Q{x + w:.1f},{y:.1f} {x + w:.1f},{y + r:.1f}'
        f'V{y + h - r:.1f}Q{x + w:.1f},{y + h:.1f} {x + w - r:.1f},{y + h:.1f}H{x:.1f}z'
    )


def svg_coverage_by_day(by_day: list[dict[str, Any]]) -> str:
    if not by_day:
        raise ValueError("no days")
    width, height = 900, 250
    left, right, top, bottom = 40, 10, 14, 44
    plot_w, plot_h = width - left - right, height - top - bottom
    maximum = max((d["slots"] for d in by_day), default=0)
    ticks = _ticks(maximum or 1)
    top_value = ticks[-1]
    step = plot_w / len(by_day)
    bar_w = max(2.0, step * 0.68)
    parts = [_svg_open(width, height, "Slots filled and open per day of the month")]
    for t in ticks:
        y = top + plot_h - plot_h * t / top_value
        parts.append(f'<line x1="{left}" x2="{width - right}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e6e9ef" stroke-width="1"/>')
        parts.append(f'<text x="{left - 8}" y="{y + 4:.1f}" font-size="11" fill="#5a6578" text-anchor="end">{fmt_num(t)}</text>')
    for i, d in enumerate(by_day):
        x = left + i * step + (step - bar_w) / 2
        filled_h = plot_h * d["filled"] / top_value
        open_h = plot_h * (d["slots"] - d["filled"]) / top_value
        base = top + plot_h
        if d["weekend"]:
            parts.append(f'<rect x="{left + i * step:.1f}" y="{top}" width="{step:.1f}" height="{plot_h}" fill="#f3f5f9"/>')
        tip = f'{fmt_date(d["date"])}: {d["filled"]} of {d["slots"]} slots filled'
        parts.append(f'<g><title>{e(tip)}</title>')
        if open_h > 0:
            parts.append(f'<path d="{_bar_path(x, base - filled_h - open_h, bar_w, open_h, 3, True)}" fill="#b42335"/>')
            if filled_h > 0:
                parts.append(f'<path d="{_bar_path(x, base - filled_h, bar_w, max(0, filled_h - 1.5), 0, False)}" fill="#1c3a6b"/>')
        elif filled_h > 0:
            parts.append(f'<path d="{_bar_path(x, base - filled_h, bar_w, filled_h, 3, True)}" fill="#1c3a6b"/>')
        parts.append(f'<rect x="{left + i * step:.1f}" y="{top}" width="{step:.1f}" height="{plot_h}" fill="transparent"/></g>')
        label_color = "#b42335" if d.get("holiday") else ("#2b3a55" if d["weekend"] else "#5a6578")
        weight = ' font-weight="700"' if d["weekend"] or d.get("holiday") else ""
        day_num = int(d["date"][8:10])
        parts.append(
            f'<text x="{x + bar_w / 2:.1f}" y="{base + 15}" font-size="10.5" fill="{label_color}" text-anchor="middle"{weight}>{day_num}</text>'
        )
        parts.append(
            f'<text x="{x + bar_w / 2:.1f}" y="{base + 28}" font-size="9" fill="#8a94a6" text-anchor="middle">{e(d["weekday"][:1])}</text>'
        )
    parts.append(f'<line x1="{left}" x2="{width - right}" y1="{top + plot_h}" y2="{top + plot_h}" stroke="#2b3a55" stroke-width="1"/>')
    parts.append("</svg>")
    return "".join(parts)


HEAT_BINS = [
    (100.0, "#1c3a6b", "#ffffff", "100%"),
    (95.0, "#3d5e94", "#ffffff", "95–99%"),
    (80.0, "#6f8cb8", "#ffffff", "80–94%"),
    (50.0, "#a8bad5", "#0f1e36", "50–79%"),
    (0.0, "#d3ddeb", "#0f1e36", "Below 50%"),
]


def _heat_bin(pct: float) -> tuple[str, str]:
    for threshold, fill, text, _label in HEAT_BINS:
        if pct >= threshold:
            return fill, text
    return HEAT_BINS[-1][1], HEAT_BINS[-1][2]


def svg_calendar_heatmap(by_day: list[dict[str, Any]], month_label: str) -> str:
    if not by_day:
        raise ValueError("no days")
    first = date.fromisoformat(by_day[0]["date"])
    offset = first.weekday()
    weeks = (offset + len(by_day) + 6) // 7
    cell_w, cell_h, gap = 92, 54, 4
    left, top = 4, 26
    width = left + 7 * (cell_w + gap)
    height = top + weeks * (cell_h + gap) + 4
    parts = [_svg_open(width, height, f"Calendar heatmap of slot coverage for {month_label}")]
    for i, name in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]):
        x = left + i * (cell_w + gap) + 8
        weight = ' font-weight="700"' if i >= 5 else ""
        parts.append(f'<text x="{x}" y="16" font-size="11.5" fill="#5a6578"{weight}>{name}</text>')
    for index, d in enumerate(by_day):
        pos = offset + index
        col, row = pos % 7, pos // 7
        x = left + col * (cell_w + gap)
        y = top + row * (cell_h + gap)
        day_num = int(d["date"][8:10])
        open_slots = d["slots"] - d["filled"]
        if d["slots"] == 0:
            fill, text = "#f6f7fa", "#8a94a6"
            body = "No slots"
            pct = None
        else:
            pct = 100.0 * d["filled"] / d["slots"]
            fill, text = _heat_bin(pct)
            body = f'{d["filled"]}/{d["slots"]} filled'
        tip = f'{fmt_date(d["date"])}: ' + (body if pct is None else f'{body} ({pct:.0f}%)') + (
            " · holiday" if d.get("holiday") else ""
        )
        stroke = ' stroke="#b42335" stroke-width="2.5"' if open_slots > 0 else ' stroke="#ffffff" stroke-width="1"'
        parts.append(f'<g><title>{e(tip)}</title>')
        parts.append(f'<rect x="{x + 1}" y="{y + 1}" width="{cell_w - 2}" height="{cell_h - 2}" rx="5" fill="{fill}"{stroke}/>')
        parts.append(f'<text x="{x + 9}" y="{y + 19}" font-size="13" font-weight="700" fill="{text}">{day_num}</text>')
        if d.get("holiday"):
            parts.append(f'<text x="{x + cell_w - 9}" y="{y + 18}" font-size="9.5" font-weight="700" fill="{text}" text-anchor="end">HOL</text>')
        parts.append(f'<text x="{x + 9}" y="{y + 40}" font-size="11" fill="{text}">{e(body)}</text>')
        if open_slots > 0:
            parts.append(
                f'<circle cx="{x + cell_w - 14}" cy="{y + cell_h - 15}" r="8.5" fill="#b42335" stroke="#ffffff" stroke-width="1.5"/>'
                f'<text x="{x + cell_w - 14}" y="{y + cell_h - 11.3}" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">{open_slots}</text>'
            )
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


def svg_unit_bars(units: list[dict[str, Any]]) -> str:
    rows = [u for u in units if u["slots"] > 0]
    if not rows:
        raise ValueError("no unit slots")
    label_w, right = 170, 96
    width = 900
    bar_h, gap, top = 20, 12, 8
    height = top + len(rows) * (bar_h + gap) + 26
    plot_w = width - label_w - right
    maximum = max(u["slots"] for u in rows)
    ticks = _ticks(maximum)
    scale = plot_w / ticks[-1]
    parts = [_svg_open(width, height, "Slots per unit split into roster duties, extra-duty layer and open slots")]
    for t in ticks:
        x = label_w + t * scale
        parts.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top - 4}" y2="{height - 22}" stroke="#e6e9ef"/>')
        parts.append(f'<text x="{x:.1f}" y="{height - 6}" font-size="11" fill="#5a6578" text-anchor="middle">{fmt_num(t)}</text>')
    for i, u in enumerate(rows):
        y = top + i * (bar_h + gap)
        extra = min(u.get("extra_received", 0), u["filled"])
        roster = u["filled"] - extra
        segments = [(roster, "#1c3a6b", "roster"), (extra, "#b42335", "extra-duty layer"), (u["open"], "#c4ccd8", "open")]
        name = u["unit"] if len(u["unit"]) <= 24 else u["unit"][:23] + "…"
        parts.append(f'<text x="{label_w - 12}" y="{y + bar_h / 2 + 4}" font-size="12.5" fill="#0f1e36" text-anchor="end">{e(name)}</text>')
        tip = f'{u["unit"]}: {u["filled"]} of {u["slots"]} filled ({roster} roster, {extra} extra-duty layer), {u["open"]} open'
        parts.append(f"<g><title>{e(tip)}</title>")
        x = label_w
        visible = [s for s in segments if s[0] > 0]
        for j, (value, color, _name) in enumerate(visible):
            w = value * scale
            last = j == len(visible) - 1
            draw_w = w if last else max(0.0, w - 2)
            parts.append(f'<path d="{_hbar_path(x, y, draw_w, bar_h, 3, last)}" fill="{color}"/>')
            x += w
        parts.append("</g>")
        parts.append(
            f'<text x="{x + 8:.1f}" y="{y + bar_h / 2 + 4}" font-size="12" fill="#2b3a55">{u["filled"]}/{u["slots"]} · {u["coverage_pct"]:.0f}%</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def svg_distribution(by_level: list[dict[str, Any]]) -> str:
    levels = [lvl for lvl in by_level if lvl.get("values")]
    if not levels:
        raise ValueError("no members")
    maximum = max(max(v["total"] for v in lvl["values"]) for lvl in levels)
    top_value = _ticks(maximum + 0.5, 5)[-1]
    label_w, right = 120, 30
    width = 900
    plot_w = width - label_w - right
    r = 5.0
    rows_meta = []
    for lvl in levels:
        stacks = Counter(v["total"] for v in lvl["values"])
        rows_meta.append(max(stacks.values()))
    row_heights = [max(48.0, 2 * r * 1.15 * n + 34) for n in rows_meta]
    top = 6
    height = int(top + sum(row_heights) + 28)
    scale = plot_w / top_value
    parts = [_svg_open(width, height, "Distribution of total duties per member, one row per call level, with the mean marked")]
    for t in _ticks(top_value, 5):
        x = label_w + t * scale
        parts.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{height - 22}" stroke="#eceff4"/>')
        parts.append(f'<text x="{x:.1f}" y="{height - 6}" font-size="11" fill="#5a6578" text-anchor="middle">{fmt_num(t, 1 if t % 1 else 0)}</text>')
    y0 = top
    for lvl, row_h in zip(levels, row_heights):
        base = y0 + row_h - 12
        parts.append(f'<line x1="{label_w}" x2="{width - right}" y1="{base + 6:.1f}" y2="{base + 6:.1f}" stroke="#dfe3ea"/>')
        parts.append(f'<text x="{label_w - 12}" y="{y0 + row_h / 2 + 2:.1f}" font-size="12.5" font-weight="600" fill="#0f1e36" text-anchor="end">{e(lvl["label"])}</text>')
        parts.append(f'<text x="{label_w - 12}" y="{y0 + row_h / 2 + 16:.1f}" font-size="10.5" fill="#5a6578" text-anchor="end">n={lvl["members"]} · Gini {lvl["gini"]:.2f}</text>')
        # min–max range
        x_min, x_max = label_w + lvl["min"] * scale, label_w + lvl["max"] * scale
        parts.append(f'<line x1="{x_min:.1f}" x2="{x_max:.1f}" y1="{base + 6:.1f}" y2="{base + 6:.1f}" stroke="#6f8cb8" stroke-width="3" stroke-linecap="round"/>')
        seen: Counter = Counter()
        for v in lvl["values"]:
            k = seen[v["total"]]
            seen[v["total"]] += 1
            cx = label_w + v["total"] * scale
            cy = base - k * (2 * r * 1.15)
            parts.append(
                f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="#1c3a6b" stroke="#ffffff" stroke-width="1.5">'
                f'<title>{e(v["name"])}: {v["total"]} duties</title></circle>'
            )
        mx = label_w + lvl["mean"] * scale
        parts.append(f'<line x1="{mx:.1f}" x2="{mx:.1f}" y1="{y0 + 4:.1f}" y2="{base + 10:.1f}" stroke="#b42335" stroke-width="2"/>')
        parts.append(f'<text x="{mx + 5:.1f}" y="{y0 + 13:.1f}" font-size="10.5" font-weight="600" fill="#8f1b2a">mean {lvl["mean"]:.1f}</text>')
        y0 += row_h
    parts.append("</svg>")
    return "".join(parts)


def svg_trend(points: list[dict[str, Any]]) -> str:
    if not points:
        raise ValueError("no trend data")
    width, height = 900, 240
    left, right, top, bottom = 44, 12, 22, 40
    plot_w, plot_h = width - left - right, height - top - bottom
    maximum = max(p["filled"] for p in points)
    ticks = _ticks(maximum or 1)
    top_value = ticks[-1]
    step = plot_w / len(points)
    bar_w = min(86.0, step * 0.5)
    parts = [_svg_open(width, height, "Filled slots per month for recent months, split into roster and extra-duty layer")]
    for t in ticks:
        y = top + plot_h - plot_h * t / top_value
        parts.append(f'<line x1="{left}" x2="{width - right}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e6e9ef"/>')
        parts.append(f'<text x="{left - 8}" y="{y + 4:.1f}" font-size="11" fill="#5a6578" text-anchor="end">{fmt_num(t)}</text>')
    base = top + plot_h
    for i, p in enumerate(points):
        x = left + i * step + (step - bar_w) / 2
        extra = min(p.get("extra", 0), p["filled"])
        roster = p["filled"] - extra
        rh = plot_h * roster / top_value
        eh = plot_h * extra / top_value
        tip = f'{p["month_label"]}: {p["filled"]} of {p["slots"]} filled ({p["coverage_pct"]:.1f}%), {extra} by the extra-duty layer'
        parts.append(f"<g><title>{e(tip)}</title>")
        colour = "#1c3a6b" if p.get("current") else "#6f8cb8"
        if eh > 0:
            parts.append(f'<path d="{_bar_path(x, base - rh - eh, bar_w, eh, 3, True)}" fill="#b42335"/>')
            if rh > 0:
                parts.append(f'<path d="{_bar_path(x, base - rh, bar_w, max(0, rh - 2), 0, False)}" fill="{colour}"/>')
        elif rh > 0:
            parts.append(f'<path d="{_bar_path(x, base - rh, bar_w, rh, 3, True)}" fill="{colour}"/>')
        parts.append("</g>")
        parts.append(f'<text x="{x + bar_w / 2:.1f}" y="{base - rh - eh - 7:.1f}" font-size="12" font-weight="600" fill="#0f1e36" text-anchor="middle">{p["filled"]}</text>')
        weight = ' font-weight="700"' if p.get("current") else ""
        parts.append(f'<text x="{x + bar_w / 2:.1f}" y="{base + 17}" font-size="11.5" fill="#2b3a55" text-anchor="middle"{weight}>{e(p["month_label"])}</text>')
        if p.get("current"):
            parts.append(f'<text x="{x + bar_w / 2:.1f}" y="{base + 31}" font-size="10" fill="#b42335" text-anchor="middle" font-weight="700">THIS REPORT</text>')
    parts.append(f'<line x1="{left}" x2="{width - right}" y1="{base}" y2="{base}" stroke="#2b3a55"/>')
    parts.append("</svg>")
    return "".join(parts)


# --------------------------------------------------------------------------- HTML pieces


def _table(
    headers: list[tuple[str, str]],
    rows: list[list[str]],
    caption: str | None = None,
    caption_note: str | None = None,
    foot: list[str] | None = None,
    cls: str = "tbl",
    row_classes: list[str] | None = None,
    row_headers: bool = False,
) -> str:
    """``headers``: (label_html, css_class). Cells are already-escaped HTML."""
    out = ['<div class="tbl-wrap">', f'<table class="{cls}">']
    if caption:
        out.append(f"<caption><b>{e(caption)}</b>{e(caption_note) if caption_note else ''}</caption>")
    out.append("<thead><tr>" + "".join(f'<th scope="col" class="{c}">{h}</th>' for h, c in headers) + "</tr></thead><tbody>")
    for index, row in enumerate(rows):
        rc = f' class="{row_classes[index]}"' if row_classes and row_classes[index] else ""
        cells = []
        for col, cell in enumerate(row):
            klass = headers[col][1] if col < len(headers) else ""
            attr = f' class="{klass}"' if klass else ""
            if row_headers and col == 0:
                cells.append(f'<th scope="row"{attr}>{cell}</th>')
            else:
                cells.append(f"<td{attr}>{cell}</td>")
        out.append(f"<tr{rc}>" + "".join(cells) + "</tr>")
    out.append("</tbody>")
    if foot:
        out.append("<tfoot><tr>" + "".join(
            f'<td class="{headers[i][1] if i < len(headers) else ""}">{cell}</td>' for i, cell in enumerate(foot)
        ) + "</tr></tfoot>")
    out.append("</table></div>")
    return "".join(out)


def _figure(title: str, subtitle: str, chart: Callable[[], str], table_html: str, legend: str = "") -> str:
    """Chart with a data-table fallback; if drawing fails the table is shown instead."""
    try:
        svg = chart()
    except Exception as exc:  # noqa: BLE001
        return (
            f'<figure><figcaption>{e(title)}<span>Chart unavailable ({e(_reason(exc))}); the data is shown as a table.</span></figcaption>'
            f"{table_html}</figure>"
        )
    return (
        f"<figure><figcaption>{e(title)}<span>{e(subtitle)}</span></figcaption>{svg}{legend}"
        f'<details class="data"><summary>Show the data as a table</summary>{table_html}</details></figure>'
    )


def _legend(items: list[tuple[str, str]]) -> str:
    return '<div class="legend" aria-hidden="true">' + "".join(
        f'<span><i style="background:{color}"></i>{e(label)}</span>' for color, label in items
    ) + "</div>"


def _empty(text: str) -> str:
    return f'<div class="empty">{e(text)}</div>'


def _unit(value: str, unit: str) -> str:
    return f'{value}<span class="unit">{e(unit)}</span>'


def _status_badge(status: Any) -> str:
    s = str(status or "unknown").lower()
    klass = "st-published" if s == "published" else ("st-draft" if s == "draft" else "st-other")
    return f'<span class="status {klass}">{e(str(status or "unknown").capitalize())}</span>'


def _pf(passed: Any) -> str:
    if passed is None:
        return '<span class="pf na">Not run</span>'
    return '<span class="pf pass">&#10003; Pass</span>' if passed else '<span class="pf fail">&#10007; Fail</span>'


def justice_words(justice: dict[str, Any]) -> str:
    if not justice:
        return "–"
    parts = []
    count = justice.get("ledger_count")
    if count is not None:
        parts.append(f"{count} extra dut{'y' if count == 1 else 'ies'} in the last 12 months")
    last = justice.get("last_extra_date")
    parts.append(f"last extra on {short_date(last)}" if last else "never did an extra duty before")
    duties = justice.get("month_duties")
    if duties is not None:
        parts.append(f"{duties} dut{'y' if duties == 1 else 'ies'} this month")
    h24 = justice.get("month_24hr")
    if h24 is not None:
        parts.append(f"{h24} × 24-hour")
    rest = justice.get("rest_hours")
    if rest is None or rest == "inf" or (isinstance(rest, (int, float)) and math.isinf(rest)):
        parts.append("no earlier duty (rest not limited)")
    else:
        try:
            parts.append(f"{float(rest):.0f} h rest before")
        except (TypeError, ValueError):
            parts.append(f"rest {rest}")
    return " · ".join(parts)


# --------------------------------------------------------------------------- HTML sections


def _html_cover(data: dict[str, Any]) -> str:
    m = data["meta"]
    published = (
        f"{fmt_datetime(m.get('published_at'))} by {e(m.get('published_by') or 'Unknown')}" if m.get("published_at") else "Not published"
    )
    override_badge = (
        '<div class="kv"><dt>Override</dt><dd><span class="tag ac">Published with superadmin override</span>'
        f'<br><span class="small">{e(m.get("override_reason") or "")}</span></dd></div>'
        if m.get("published_with_override")
        else ""
    )
    errors = data.get("section_errors", {})
    contents = "".join(
        f'<li><span class="n">{i:02d}</span><span>{e(s["title"])}{" — unavailable" if s["id"] in errors else ""}</span></li>'
        for i, s in enumerate(data["sections"][1:], start=2)
    )
    signers = "".join(
        f'<div class="sign"><p class="role">{role}</p>'
        '<div class="line">Name <span></span></div><div class="line">Signature <span></span></div>'
        '<div class="line">Date <span></span></div></div>'
        for role in ("Prepared by", "Reviewed by", "Approved by")
    )
    return f"""
<section class="sheet cover" id="cover" aria-labelledby="cover-title">
  <div class="cover-band">
    <p class="eyebrow">Confidential · Prepared for audit</p>
    <h1 id="cover-title">{e(m.get("title") or REPORT_TITLE)}</h1>
    <p class="dept">{e(m.get("department"))}</p>
    <p class="month">{e(m.get("month_label"))}</p>
  </div>
  <div class="cover-body">
    <div class="meta-grid">
      <dl>
        <div class="kv"><dt>Rota status</dt><dd>{_status_badge(m.get("period_status"))}</dd></div>
        <div class="kv"><dt>Period</dt><dd>{fmt_date(m.get("starts_on"))} – {fmt_date(m.get("ends_on"))}</dd></div>
        <div class="kv"><dt>Published</dt><dd>{published}</dd></div>{override_badge}
      </dl>
      <dl>
        <div class="kv"><dt>Generated</dt><dd>{fmt_datetime(m.get("generated_at"))}</dd></div>
        <div class="kv"><dt>Generated by</dt><dd>{e(m.get("generated_by"))}</dd></div>
        <div class="kv"><dt>Rules</dt><dd>{e(m.get("rules_source") or "–")}</dd></div>
      </dl>
    </div>
    <dl class="fp" aria-label="Fingerprints">
      <div class="kv"><dt>Data fingerprint</dt><dd class="mono">{e(m.get("data_fingerprint") or "–")}</dd></div>
      <div class="kv"><dt>Report fingerprint</dt><dd class="mono">{e(m.get("report_fingerprint") or "–")}</dd></div>
      <div class="kv"><dt>Rules revision</dt><dd class="mono">{e(m.get("rules_revision") or "–")}</dd></div>
    </dl>
    <h3>Contents</h3>
    <ol class="contents">{contents}</ol>
    <h3>Sign-off</h3>
    <div class="signoff">{signers}</div>
    <p class="confidential">This report was generated from the live rota tables at the time shown. The data fingerprint identifies the exact set of active assignments; a later report with a different fingerprint describes a changed rota.</p>
  </div>
</section>"""


def _sec(index: int, sid: str, title: str, lede: str, body: str, wide: bool = False) -> str:
    return (
        f'<section class="sheet{" wide" if wide else ""}" id="{sid}" aria-labelledby="{sid}-h">'
        f'<header class="sec-head"><span class="sec-num">{index:02d}</span><h2 id="{sid}-h">{e(title)}</h2>'
        f'<span class="lede">{lede}</span></header>{body}</section>'
    )


def _html_summary(data: dict[str, Any]) -> str:
    s = data["summary"]
    if not s:
        return _empty("No summary is available.")
    comp = data.get("compliance") or {}
    cov = float(s.get("coverage_pct") or 0)
    kpis = [
        f'<div class="kpi lead"><div class="k-label">Coverage</div><div class="k-value">{cov:.1f}<small>%</small></div>'
        f'<div class="k-sub">{fmt_num(s.get("filled"))} of {fmt_num(s.get("slots"))} slots filled</div>'
        f'<div class="meter"><i style="width:{max(0.0, min(100.0, cov)):.1f}%"></i></div></div>',
        f'<div class="kpi{" alert" if s.get("open") else ""}"><div class="k-label">Open slots</div><div class="k-value">{fmt_num(s.get("open"))}</div>'
        f'<div class="k-sub">{"needs attention before publishing" if s.get("open") else "every slot is covered"}</div></div>',
        f'<div class="kpi"><div class="k-label">Duties assigned</div><div class="k-value">{fmt_num(s.get("duties_total"))}</div>'
        f'<div class="k-sub">{fmt_num(s.get("duties_24hr"))} × 24-hour · {fmt_num(s.get("night_duties"))} nights</div></div>',
        f'<div class="kpi"><div class="k-label">Members</div><div class="k-value">{fmt_num(s.get("members"))}</div>'
        f'<div class="k-sub">{fmt_num(s.get("members_on_duty"))} with at least one duty</div></div>',
        f'<div class="kpi"><div class="k-label">Extra duties</div><div class="k-value">{fmt_num(s.get("extra_duties"))}</div>'
        f'<div class="k-sub">active ledger records · {fmt_num(s.get("extra_void"))} void</div></div>',
        f'<div class="kpi"><div class="k-label">Fallback unit used</div><div class="k-value">{fmt_num(s.get("fallback_duties"))}</div>'
        f'<div class="k-sub">duties covered from another unit</div></div>',
        f'<div class="kpi"><div class="k-label">Override assignments</div><div class="k-value">{fmt_num(s.get("override_assignments"))}</div>'
        f'<div class="k-sub">{fmt_num(s.get("hard_blocked_covered"))} hard-blocked slots covered</div></div>',
    ]
    if comp.get("available"):
        failing = sum(1 for c in comp.get("checks", []) if not c.get("passed"))
        kpis.append(
            f'<div class="kpi{" alert" if failing else ""}"><div class="k-label">Compliance</div>'
            f'<div class="k-value">{"All pass" if not failing else f"{failing} fail"}</div>'
            f'<div class="k-sub">{len(comp.get("checks", []))} checks · {fmt_num(len(comp.get("violations", [])))} violations</div></div>'
        )
    else:
        kpis.append('<div class="kpi"><div class="k-label">Compliance</div><div class="k-value">Not verified</div>'
                    '<div class="k-sub">independent check unavailable</div></div>')
    findings = []
    if s.get("slots"):
        findings.append(("good" if not s.get("open") else "bad",
                         f"{fmt_num(s.get('filled'))} of {fmt_num(s.get('slots'))} slots are filled ({cov:.1f}%)"
                         + (f"; {fmt_num(s.get('open'))} remain open." if s.get("open") else ".")))
    else:
        findings.append(("bad", "This month has no duty slots yet."))
    if s.get("extra_duties"):
        findings.append(("", f"The extra-duty layer covered {fmt_num(s.get('extra_duties'))} duties, "
                             f"{fmt_num(s.get('fallback_duties'))} of them from a fallback unit; each is listed in the ledger section with the rules it broke."))
    if s.get("extra_passed_on"):
        findings.append(("", f"{fmt_num(s.get('extra_passed_on'))} extra duties were passed on by Balance duties to even out totals; "
                             "the justice-ledger credit moved with each duty (see the ledger and Balancing)."))
    targets = (data.get("fairness") or {}).get("targets") or []
    uneven = [t for t in targets if not t.get("ok")]
    if uneven:
        findings.append(("bad", "Duty totals uneven within a call level: " + "; ".join(
            f"{e(t['label'])} {t['min']} to {t['max']} duties (target {fmt_num(t['target'], 2)}, gap {t['gap']}, "
            f"allowed {t['allowed_gap']})" + (f" - {e(t['reason'])}" if t.get("reason") else "")
            for t in uneven) + ". See Fairness."))
    elif targets:
        findings.append(("good", f"Duty totals are within the allowed gap in every call level "
                                 f"(allowed {targets[0]['allowed_gap']})."))
    fair = (data.get("fairness") or {}).get("by_call_level") or []
    if fair:
        widest = max(fair, key=lambda r: (r.get("spread", 0), r.get("gini", 0)))
        findings.append(("", f"Largest workload spread: {e(widest['label'])} — {widest['min']} to {widest['max']} duties "
                             f"(mean {widest['mean']:.1f}, Gini {widest['gini']:.2f})."))
    sa = data.get("superadmin") or {}
    sa_active = int(sa.get("active_allocations") or 0)
    if sa_active:
        findings.append(("bad", f"{fmt_num(sa_active)} duty slot(s) were allocated by a superadmin, overriding rota rules"
                                + (f" ({fmt_num(sa.get('post_publish_allocations'))} after publishing)" if sa.get("post_publish_allocations") else "")
                                + ". See Superadmin actions."))
    for item in sa.get("publish_overrides") or []:
        findings.append(("bad", f"Published with superadmin override by {e(item.get('by') or 'Unknown')} on {fmt_datetime(item.get('at'))} "
                                f"with {fmt_num(item.get('open_slots'))} open slot(s): {e(item.get('reason') or '')}."))
    over = data.get("individual_limits") or {}
    over_people = over.get("people") or []
    if over_people:
        names = ", ".join(e(p["person_name"]) for p in over_people[:5])
        more = f" and {len(over_people) - 5} more" if len(over_people) > 5 else ""
        findings.append(("bad", f"{fmt_num(len(over_people))} member(s) are above an individual duty limit: {names}{more}. "
                                "See Individual limits exceeded."))
    elif over.get("configured"):
        findings.append(("good", "No member is above an individual duty limit."))
    if comp.get("available"):
        bad = [c for c in comp.get("checks", []) if not c.get("passed")]
        findings.append(("good" if not bad else "bad",
                         "Every compliance check passed." if not bad else
                         f"{len(bad)} compliance check(s) failed: " + ", ".join(e(c["name"]) for c in bad) + "."))
    else:
        findings.append(("bad", e(comp.get("error") or "Independent check unavailable.")))
    errors = data.get("section_errors") or {}
    if errors:
        findings.append(("bad", "Some sections could not be produced: " + ", ".join(e(k) for k in errors) + "."))
    meta = data["meta"]
    holiday_note = (
        f"{len(meta.get('holidays_in_month') or [])} holiday date(s) this month from the reviewed holiday calendar."
        if meta.get("holiday_calendar")
        else "No holiday calendar is configured, so holiday counts are 0."
    )
    defs = "".join(f"<div><dt>{e(d['term'])}.</dt> <dd>{e(d['meaning'])}</dd></div>" for d in data.get("definitions", []))
    return (
        f'<div class="kpis">{"".join(kpis)}</div>'
        '<h3>Key findings</h3><ul class="findings">'
        + "".join(f'<li><span class="dot {k}"></span><span>{t}</span></li>' for k, t in findings)
        + "</ul>"
        f'<h3>Method and definitions <span class="h3-note">{e(holiday_note)}</span></h3><dl class="defs">{defs}</dl>'
    )


def _html_coverage(data: dict[str, Any]) -> str:
    c = data["coverage"]
    if not c.get("by_day") and not c.get("by_unit"):
        return _empty("No coverage data.")
    if not any(d["slots"] for d in c["by_day"]):
        return _empty("This month has no duty slots, so there is no coverage to show.")
    day_table = _table(
        [("Date", ""), ("Day", ""), ("Slots", "num"), ("Filled", "num"), ("Open", "num")],
        [[fmt_date(d["date"]), e(d["weekday"]) + (" <span class='tag ac'>Holiday</span>" if d.get("holiday") else ""),
          fmt_num(d["slots"]), fmt_num(d["filled"]), fmt_num(d["slots"] - d["filled"])] for d in c["by_day"]],
        caption="Coverage by day",
    )
    meta = data["meta"]
    heat_legend = _legend([(fill, label) for _t, fill, _x, label in HEAT_BINS] + [("#ffffff;border:2px solid #b42335", "Day with open slots")])
    out = [
        _figure(
            "Calendar heatmap",
            "Share of the day's slots that are filled. A crimson outline and badge mark days with open slots.",
            lambda: svg_calendar_heatmap(c["by_day"], meta.get("month_label", "")),
            day_table,
            heat_legend,
        ),
        _figure(
            "Slots per day",
            "Filled slots, with any open slots stacked on top. Weekends are shaded.",
            lambda: svg_coverage_by_day(c["by_day"]),
            day_table,
            _legend([("#1c3a6b", "Filled"), ("#b42335", "Open")]),
        ),
    ]

    def cov_rows(items: list[dict[str, Any]], key: str, extra_label: str | None = None) -> list[list[str]]:
        rows = []
        for r in items:
            pct = 100.0 * r["filled"] / r["slots"] if r["slots"] else 0
            label = e(r[key]) + (f' <span class="muted small">{e(r["duty_type"])}</span>' if extra_label else "")
            rows.append([label, fmt_num(r["slots"]), fmt_num(r["filled"]), fmt_num(r["open"]),
                         f'<span class="barcell">{pct:.1f}%<span class="track"><i style="width:{pct:.1f}%"></i></span></span>'])
        return rows

    totals = [sum(r["slots"] for r in c["by_unit"]), sum(r["filled"] for r in c["by_unit"])]
    foot_pct = 100.0 * totals[1] / totals[0] if totals[0] else 0
    head = [("Unit", ""), ("Slots", "num"), ("Filled", "num"), ("Open", "num"), ("Coverage", "num")]
    out.append(_table(head, cov_rows(c["by_unit"], "unit"), caption="Coverage by unit",
                      foot=["Total", fmt_num(totals[0]), fmt_num(totals[1]), fmt_num(totals[0] - totals[1]), f"{foot_pct:.1f}%"]))
    out.append("<div style='height:14px'></div>")
    out.append(_table([("Duty", ""), ("Slots", "num"), ("Filled", "num"), ("Open", "num"), ("Coverage", "num")],
                      cov_rows(c["by_duty"], "label", "duty_type"), caption="Coverage by duty type"))
    return "".join(out)


def _dev_html(value: float) -> str:
    klass = "hi" if value >= 1.5 else ("lo" if value <= -1.5 else "")
    return f'<span class="dev {klass}">{fmt_signed(value)}</span>'


def _html_workload(data: dict[str, Any]) -> str:
    rows = data["workload"]
    if not rows:
        return _empty("No members are posted to a unit or on duty this month.")
    maximum = max((r["total"] for r in rows), default=0) or 1
    head = [("Member", ""), ("Unit", ""), ("Total", "num"), ("24-hour", "num"), ("Weekend", "num"), ("Weekend 24h", "num"),
            ("Nights", "num"), ("Holidays", "num"), ("Extra", "num"), ("Hours", "num"), ("vs level mean", "num")]
    out = ['<p class="muted small">Counts are duties this month. Deviation compares each member with the mean of the same call level; '
           'highlighted when 1.5 duties or more away from it. Nights: not 24-hour and starting at or after 18:00 or before 08:00.</p>']
    out.append('<div class="tbl-wrap"><table class="tbl"><caption><b>Duties per member</b>grouped by call level</caption><thead><tr>')
    out.append("".join(f'<th scope="col" class="{c}">{h}</th>' for h, c in head) + "</tr></thead>")
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[r["call_level"]].append(r)
    for level in sorted(grouped, key=_call_level_sort):
        level_rows = grouped[level]
        mean = sum(r["total"] for r in level_rows) / len(level_rows)
        out.append(f'<tbody><tr class="grp"><th scope="colgroup" colspan="{len(head)}">{e(call_level_label(level))} '
                   f'<span class="muted small" style="font-weight:400">· {len(level_rows)} members · mean {mean:.2f}</span></th></tr>')
        for r in level_rows:
            width = 100.0 * r["total"] / maximum
            extra_cell = (f'<td class="num"><span class="tag ac">{fmt_num(r["extra"])}</span></td>'
                          if r["extra"] else '<td class="num">0</td>')
            out.append(
                "<tr>"
                f'<td class="name">{e(r["name"])}</td><td>{e(r["unit"] or "–")}</td>'
                f'<td class="num"><span class="barcell">{fmt_num(r["total"])}<span class="track"><i style="width:{width:.1f}%"></i></span></span></td>'
                f'<td class="num">{fmt_num(r["hours24"])}</td><td class="num">{fmt_num(r["weekend"])}</td>'
                f'<td class="num">{fmt_num(r["weekend24"])}</td><td class="num">{fmt_num(r["nights"])}</td>'
                f'<td class="num">{fmt_num(r["holidays"])}</td>'
                f'{extra_cell}'
                f'<td class="num">{_unit(fmt_num(r.get("hours", 0)), " h")}</td>'
                f'<td class="num">{_dev_html(r["deviation_from_mean"])}</td>'
                "</tr>"
            )
        out.append("</tbody>")
    tot = lambda k: sum(r.get(k, 0) for r in rows)  # noqa: E731
    out.append(
        "<tfoot><tr>"
        f'<td>All members ({len(rows)})</td><td></td><td class="num">{fmt_num(tot("total"))}</td><td class="num">{fmt_num(tot("hours24"))}</td>'
        f'<td class="num">{fmt_num(tot("weekend"))}</td><td class="num">{fmt_num(tot("weekend24"))}</td><td class="num">{fmt_num(tot("nights"))}</td>'
        f'<td class="num">{fmt_num(tot("holidays"))}</td><td class="num">{fmt_num(tot("extra"))}</td>'
        f'<td class="num">{_unit(fmt_num(tot("hours")), " h")}</td><td></td></tr></tfoot></table></div>'
    )
    return "".join(out)


def _html_fairness(data: dict[str, Any]) -> str:
    f = data["fairness"]
    levels = f.get("by_call_level") or []
    if not levels:
        return _empty("No members, so fairness cannot be measured.")
    head = [("Call level", ""), ("Members", "num"), ("Duties", "num"), ("Mean", "num"), ("Min", "num"), ("Max", "num"),
            ("Std dev", "num"), ("Gini", "num"), ("Spread", "num"), ("Mean 24h", "num")]
    rows = [[e(r["label"]), fmt_num(r["members"]), fmt_num(r["total"]), fmt_num(r["mean"], 2), fmt_num(r["min"]),
             fmt_num(r["max"]), fmt_num(r["std"], 2), fmt_num(r["gini"], 3), fmt_num(r["spread"]), fmt_num(r["mean_24hr"], 2)]
            for r in levels]
    o = f.get("overall") or {}
    foot = ["All members", fmt_num(o.get("members")), fmt_num(o.get("total")), fmt_num(o.get("mean"), 2), fmt_num(o.get("min")),
            fmt_num(o.get("max")), fmt_num(o.get("std"), 2), fmt_num(o.get("gini_within_levels"), 3) + "<sup>*</sup>", fmt_num(o.get("spread")), ""]
    table = _table(head, rows, caption="Workload fairness by call level", foot=foot, row_headers=True)
    dist_table = _table(
        [("Call level", ""), ("Member", ""), ("Duties", "num")],
        [[e(lvl["label"]), e(v["name"]), fmt_num(v["total"])] for lvl in levels for v in lvl.get("values", [])],
        caption="Duties per member",
    )
    fig = _figure(
        "Distribution of duties within each call level",
        "Each dot is one member; members with the same total are stacked. The bar spans min–max; the crimson line is the mean.",
        lambda: svg_distribution(levels),
        dist_table,
        _legend([("#1c3a6b", "Member"), ("#6f8cb8", "Range (min–max)"), ("#b42335", "Mean")]),
    )
    return (
        '<p class="muted small">Fairness is measured within a call level, because levels carry different duty loads by design. '
        'Gini 0 means every member of the level did the same number of duties.</p>'
        + _html_call_level_targets(f)
        + _html_balancing(f)
        + fig + table
        + '<p class="muted small"><sup>*</sup> Overall Gini is the member-weighted mean of the call-level Ginis '
        f'(across all members regardless of level it is {fmt_num(o.get("gini"), 3)}).</p>'
    )


def _html_balancing(f: dict[str, Any]) -> str:
    """The "Balancing" subsection: Balance duties batches, gaps before/after and their moves."""
    batches = f.get("balancing") or []
    if not batches:
        return ""
    parts = ['<h3>Balancing</h3>']
    for b in batches:
        status = "applied" if b["status"] == "applied" else "undone"
        parts.append(
            f'<p class="muted small">Balance duties by {e(b.get("created_by_name") or "unknown")} '
            f'({e(b.get("created_at") or "")}, {status}): {fmt_num(b["moves_count"])} moves, '
            f'{fmt_num(b["swaps"])} swaps, {fmt_num(b["cross_unit"])} across units'
            + (f', {fmt_num(b.get("extra_moves"))} extra duties passed on' if b.get("extra_moves") else "")
            + '.</p>'
        )
        if b["levels"]:
            parts.append(_table(
                [("Call level", ""), ("Gap before", "num"), ("Gap after", "num"), ("Balanced", "")],
                [[e(level["label"]), fmt_num(level["before_gap"]), fmt_num(level["after_gap"]),
                  "Yes" if level["ok_after"] else "No"] for level in b["levels"]],
                caption="Gap per call level, before and after balancing", row_headers=True,
            ))
        if b["moves"]:
            parts.append(_table(
                [("Date", ""), ("Duty", ""), ("From", ""), ("To", ""), ("Unit", ""), ("Kind", "")],
                [[e(m["duty_date"]), e(m["duty_label"]), e(m["from_person"]), e(m["to_person"]),
                  e(f"{m['from_unit']} → {m['to_unit']} (cross-unit)" if m["cross_unit"] else (m["to_unit"] or "")),
                  e(m["kind"])] for m in b["moves"]],
                caption="Balancing moves",
            ))
        extra_moves = [m for m in b["moves"] if m.get("extra_duty")]
        if extra_moves:
            parts.append(_table(
                [("Date", ""), ("Duty", ""), ("From", ""), ("To", ""), ("Ledger transfer", "wrap"), ("Rules for new holder", "wrap")],
                [[e(m["duty_date"]), e(m["duty_label"]), e(m["from_person"]), e(m["to_person"]),
                  e(f"Ledger credit moves from {m.get('ledger_from') or '?'} to {m.get('ledger_to') or '?'}"),
                  "".join(f'<span class="tag">{e(label)}</span>' for label in m.get("new_overridden_labels") or [])
                  or '<span class="muted">None</span>'] for m in extra_moves],
                caption="Extra duties passed on (ledger transfer)",
            ))
    return "".join(parts)


def _html_call_level_targets(f: dict[str, Any]) -> str:
    """Equal duties within a call level: target, min, max, gap and the members off target."""
    targets = f.get("targets") or []
    if f.get("targets_error"):
        return f'<p class="muted small">Call-level targets unavailable: {e(f["targets_error"])}</p>'
    if not targets:
        return ""
    head = [("Call level", ""), ("Slots", "num"), ("Members", "num"), ("Target", "num"), ("Min", "num"),
            ("Max", "num"), ("Gap", "num"), ("Allowed", "num"), ("Within gap", ""), ("Off target", "num")]
    rows = [[e(t["label"]), fmt_num(t["slots"]), fmt_num(t["members"]), fmt_num(t["target"], 2), fmt_num(t["min"]),
             fmt_num(t["max"]), fmt_num(t["gap"]), fmt_num(t["allowed_gap"]), "Yes" if t["ok"] else "No",
             fmt_num(len(t["off_target"]))] for t in targets]
    table = _table(head, rows, caption="Equal duties within a call level (target = slots / members, all campuses)",
                   row_headers=True)
    off = [(t, m) for t in targets for m in t["off_target"]]
    off_table = _table(
        [("Call level", ""), ("Member", ""), ("Duties", "num"), ("Extra duties", "num"), ("From target", "num"),
         ("Leave days", "num")],
        [[e(t["label"]), e(m["name"]), fmt_num(m["duties"]), fmt_num(m["extra_duties"]),
          f"{m['diff_from_target']:+.2f}", fmt_num(m["leave_days"])] for t, m in off],
        caption="Members off target",
    ) if off else '<p class="muted small">Every member is on target (within one duty).</p>'
    reasons = "".join(
        f'<p class="muted small">{e(t["label"])}: {e(t["reason"])}</p>'
        for t in targets if not t["ok"] and t.get("reason")
    )
    return table + reasons + off_table


def _limit_text(item: dict[str, Any]) -> str:
    return f"{item.get('label')} {item.get('actual')}/{item.get('limit')}"


def _html_individual_limits(data: dict[str, Any]) -> str:
    section = data.get("individual_limits") or {}
    limits = section.get("limits") or []
    people = section.get("people") or []
    if not section.get("configured"):
        return _empty("No individual duty limits are set in the saved rules, so none can be exceeded.")
    settings = "; ".join(f"{e(item['label'])}: {fmt_num(item['limit'])}" for item in limits)
    intro = (
        f'<div class="callout">Limits in the saved rules, counted per member across all units: {settings}. '
        "The extra-duty layer may exceed them (owner decision); each member above a limit is listed here, "
        "shown as actual/limit.</div>"
    )
    if not people:
        return intro + _empty("No member is above an individual duty limit this month.")
    head = [("Member", ""), ("Call level", ""), ("Unit", ""), ("Duties", "num"), ("24-hour", "num"),
            ("Limits exceeded (actual/limit)", "wrap")]
    rows = [
        [e(p["person_name"]), e(p.get("call_level_label") or "–"), e(p.get("home_unit_name") or "–"),
         fmt_num(p.get("month_duties")), fmt_num(p.get("month_24hr")),
         "".join(f'<span class="tag">{e(_limit_text(item))}</span>' for item in p.get("limits") or [])]
        for p in people
    ]
    return intro + _table(head, rows, caption="Members above an individual limit",
                          caption_note=f"{len(people)} member(s)", row_headers=True)


def _html_units(data: dict[str, Any]) -> str:
    units = data["units"]
    if not units:
        return _empty("No units have slots or postings this month.")
    head = [("Unit", ""), ("Campus", ""), ("Members", "num"), ("Slots", "num"), ("Filled", "num"), ("Open", "num"),
            ("Coverage", "num"), ("Extra received", "num"), ("Fallback received", "num"), ("Fallback given", "num")]
    rows = [[e(u["unit"]) + (f' <span class="muted small">{e(u["code"])}</span>' if u.get("code") else ""), e(u.get("campus") or "–"),
             fmt_num(u["members"]), fmt_num(u["slots"]), fmt_num(u["filled"]), fmt_num(u["open"]), f'{u["coverage_pct"]:.1f}%',
             fmt_num(u["extra_received"]), fmt_num(u["fallback_received"]), fmt_num(u["fallback_given"])] for u in units]
    foot_keys = ["members", "slots", "filled", "open"]
    tsum = {k: sum(u[k] for u in units) for k in foot_keys + ["extra_received", "fallback_received", "fallback_given"]}
    foot = ["Total", "", *(fmt_num(tsum[k]) for k in foot_keys),
            f'{(100.0 * tsum["filled"] / tsum["slots"] if tsum["slots"] else 0):.1f}%',
            fmt_num(tsum["extra_received"]), fmt_num(tsum["fallback_received"]), fmt_num(tsum["fallback_given"])]
    table = _table(head, rows, caption="Units", caption_note="extra received = duties placed in the unit by the extra-duty layer; fallback = covered by another unit's members", foot=foot)
    fig = _figure(
        "Slots per unit",
        "Each bar is the unit's slots: filled by the roster, filled by the extra-duty layer, and still open.",
        lambda: svg_unit_bars(units),
        table,
        _legend([("#1c3a6b", "Roster"), ("#b42335", "Extra-duty layer"), ("#c4ccd8", "Open")]),
    )
    return fig + table


def _html_calendar(data: dict[str, Any]) -> str:
    rows = data["calendar"]
    if not rows:
        return _empty("No duty slots this month.")
    duty_order: dict[str, str] = {}
    for r in rows:
        duty_order.setdefault(r["duty_type"], r["label"])
    duties = sorted(duty_order, key=lambda k: duty_order[k].lower())
    by_cell: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    dates: dict[str, str] = {}
    for r in rows:
        by_cell[(r["date"], r["duty_type"])].append(r)
        dates[r["date"]] = r["weekday"]
    holidays = set((data["meta"].get("holidays_in_month") or []))
    out = ['<p class="muted small">One row per day, one column per duty. Unit codes precede names when a duty has several units. '
           '<span class="tag ac">●</span> marks an extra-duty layer assignment; hatched cells are open.</p>',
           '<div class="tbl-wrap"><table class="tbl cal"><caption><b>Rota calendar</b>'
           f'{e(data["meta"].get("month_label"))}</caption><thead><tr><th scope="col">Date</th>']
    out.append("".join(f'<th scope="col">{e(duty_order[d])}</th>' for d in duties) + "</tr></thead><tbody>")
    for day in sorted(dates):
        dt = date.fromisoformat(day)
        klass = " ".join(k for k in ("we" if dt.weekday() >= 5 else "", "hol" if day in holidays else "") if k)
        out.append(f'<tr{f" class={chr(34)}{klass}{chr(34)}" if klass else ""}><th scope="row">{dt.strftime("%a %d")}</th>')
        for duty in duties:
            cell = by_cell.get((day, duty), [])
            if not cell:
                out.append('<td class="muted">·</td>')
                continue
            open_cell = all(c["status"] == "open" for c in cell)
            pieces = []
            for c in cell:
                code = f'<span class="uc">{e(c.get("unit_code") or "")}</span>' if len(cell) > 1 and c.get("unit_code") else ""
                who = e(c["person"]) if c["person"] else "Open"
                mark = '<span class="x" title="Extra-duty layer"></span>' if c.get("extra") else ""
                pieces.append(f'<span class="who">{code}{who}{mark}</span>')
            out.append(f'<td{" class=open" if open_cell else ""}>{"".join(pieces)}</td>')
        out.append("</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def _html_extra(data: dict[str, Any]) -> str:
    rows = data["extra_duties"]
    if not rows:
        return _empty("The extra-duty layer made no ledger records this month.")
    active = [r for r in rows if r["status"] == "active"]
    void = [r for r in rows if r["status"] != "active"]
    head = [("Date", ""), ("Duty", ""), ("Member", ""), ("Passed on from", "wrap-s"), ("Unit", ""), ("Rules overridden", "wrap"),
            ("Why this member (justice key)", "wrap wide"), ("Status", "wrap-s")]
    body = []
    classes = []
    for r in rows:
        assigned = e(r["assigned_unit"] or "–") + (
            f'<br><span class="tag ac">Fallback from {e(r["home_unit"] or "?")}</span>' if r["fallback_used"] else "")
        rules = "".join(f'<span class="tag">{e(label)}</span>' for label in r["overridden_labels"]) or '<span class="muted">None</span>'
        status = (
            '<span class="tag ok">Active</span>' if r["status"] == "active"
            else f'<span class="tag void">Void</span><br><span class="small muted">{e(r.get("void_reason") or "")}</span>'
        )
        justice = "<br>".join(e(part) for part in justice_words(r.get("justice") or {}).split(" · "))
        passed = "<br>".join(f'<span class="small">{e(t["text"])}</span>' for t in r.get("transfers") or []) or '<span class="muted">–</span>'
        body.append([fmt_day(r["duty_date"]), e(r["label"]), e(r["person_name"]), passed, assigned, rules,
                     f'<span class="small">{justice}</span>', status])
        classes.append("void" if r["status"] != "active" else "")
    rule_counts = Counter(label for r in active for label in r["overridden_labels"])
    summary_rows = [[e(label), fmt_num(n)] for label, n in rule_counts.most_common()]
    intro = (
        f'<div class="callout">{fmt_num(len(active))} active ledger record(s), {fmt_num(sum(1 for r in active if r["fallback_used"]))} with a fallback unit. '
        f'{fmt_num(len(void))} void record(s) are listed for the audit trail but are not counted anywhere in this report. '
        'The justice key is the order used to pick the member: fewest extra duties in the last 12 months first, then the oldest last extra duty, '
        'then fewest duties and 24-hour duties this month, then the longest rest.</div>'
    )
    out = [intro]
    if summary_rows:
        out.append(_table([("Rule overridden", ""), ("Active records", "num")], summary_rows, caption="Rules overridden"))
        out.append("<div style='height:14px'></div>")
    out.append(_table(head, body, caption="Extra-duty ledger", caption_note=f"{len(rows)} record(s)", row_classes=classes))
    return "".join(out)


def _html_superadmin(data: dict[str, Any]) -> str:
    section = data.get("superadmin") or {}
    allocations = section.get("allocations") or []
    overrides = section.get("publish_overrides") or []
    out = [
        '<div class="callout">Actions only a superadmin can take: allocating any department member to a duty '
        "(overriding call level, groups, unit rules, posting, limits, staffing and fairness, but never leave, rest or "
        "double duty) and publishing with blockers. Each allocation also counts in the extra-duty ledger.</div>"
    ]
    if allocations:
        head = [("Date", ""), ("Duty", ""), ("Unit", ""), ("Member", ""), ("Rules overridden", "wrap"),
                ("Reason", "wrap"), ("By", ""), ("When", ""), ("Post-publish", ""), ("Status", "")]
        body, classes = [], []
        for r in allocations:
            rules = "".join(f'<span class="tag">{e(label)}</span>' for label in r.get("overridden_labels") or []) \
                or '<span class="muted">None</span>'
            status = r.get("status") or "active"
            body.append([
                fmt_day(r.get("duty_date")), e(r.get("label") or r.get("duty_type") or "–"), e(r.get("unit") or "–"),
                e(r.get("person_name") or "–"), rules, e(r.get("reason") or "–"), e(r.get("by") or "–"),
                fmt_datetime(r.get("at")), "Yes" if r.get("post_publish") else "No",
                '<span class="tag ok">Active</span>' if status == "active" else f'<span class="tag void">{e(status.capitalize())}</span>',
            ])
            classes.append("" if status == "active" else "void")
        out.append(_table(head, body, caption="Superadmin allocations", caption_note=f"{len(allocations)} allocation(s)",
                          row_classes=classes))
    else:
        out.append(_empty("No superadmin allocations this month."))
    out.append("<div style='height:14px'></div>")
    if overrides:
        rows = [
            [fmt_datetime(o.get("at")), e(o.get("by") or "–"), e(o.get("reason") or "–"), fmt_num(o.get("open_slots")),
             "<br>".join(e(f"{b['title']}: {b['detail']}") for b in o.get("blockers") or []) or "–",
             fmt_num(o.get("warnings_unconfirmed"))]
            for o in overrides
        ]
        out.append(_table([("When", ""), ("Who", ""), ("Reason", "wrap"), ("Open slots", "num"), ("Blockers at publish", "wrap"),
                           ("Unconfirmed warnings", "num")], rows, caption="Published with superadmin override"))
    else:
        out.append(_empty("The rota was not published with a superadmin override."))
    return "".join(out)


def _html_compliance(data: dict[str, Any]) -> str:
    c = data["compliance"]
    out = []
    if not c.get("available"):
        out.append(f'<div class="verdict na"><div><div class="big">Not verified</div><div class="sub">{e(c.get("error") or "Independent check unavailable")}</div></div></div>')
    elif c.get("all_passed"):
        out.append(f'<div class="verdict pass"><div><div class="big">&#10003; All checks passed</div>'
                   f'<div class="sub">{fmt_num(c.get("checked"))} active assignments checked against the strict rules by an independent checker.</div></div></div>')
    else:
        failing = sum(1 for x in c.get("checks", []) if not x.get("passed"))
        out.append(f'<div class="verdict fail"><div><div class="big">&#10007; {failing} check(s) failed</div>'
                   f'<div class="sub">{fmt_num(len(c.get("violations", [])))} violation(s) in {fmt_num(c.get("checked"))} active assignments.</div></div></div>')
    checks = c.get("checks") or []
    if checks:
        source_label = {"independent": "Independent checker", "report": "Report reconciliation"}
        out.append(_table(
            [("Check", ""), ("Source", ""), ("Result", ""), ("Checked", "num"), ("Violations", "num")],
            [[e(x["name"]), e(source_label.get(x.get("source"), x.get("source") or "")), _pf(x.get("passed")),
              fmt_num(x.get("checked")), fmt_num(x.get("violations"))] for x in checks],
            caption="Checks", caption_note="strict rules from the extra-duty contract (section 1.1) and the report's own reconciliation",
            row_headers=True,
        ))
    violations = c.get("violations") or []
    if violations:
        shown = violations[:500]
        out.append("<div style='height:14px'></div>")
        out.append(_table(
            [("Date", ""), ("Duty", ""), ("Unit", ""), ("Member", ""), ("Rule", ""), ("Detail", "wrap")],
            [[fmt_day(v.get("date")), e(v.get("duty") or "–"), e(v.get("unit") or "–"), e(v.get("person_name") or "–"),
              f'<span class="tag ac">{e(v.get("code"))}</span>', e(v.get("message"))] for v in shown],
            caption="Violations", caption_note=(f"first {len(shown)} of {len(violations)}" if len(violations) > len(shown) else f"{len(violations)}"),
        ))
    return "".join(out)


def _html_trend(data: dict[str, Any]) -> str:
    trend = list(data["trend"])
    s = data.get("summary") or {}
    fair = (data.get("fairness") or {}).get("overall") or {}
    current = None
    if s:
        current = {
            "month": data["meta"]["month"], "month_label": data["meta"]["month_label"], "slots": s.get("slots", 0),
            "filled": s.get("filled", 0), "duties": s.get("duties_total", 0), "coverage_pct": s.get("coverage_pct", 0.0),
            "extra": s.get("extra_duties", 0), "gini": fair.get("gini_within_levels", 0.0), "current": True,
        }
    points = trend + ([current] if current else [])
    if not trend:
        return _empty("No earlier months with rota data, so there is no trend yet.") if not current else (
            '<p class="muted small">No earlier months with rota data were found; only this month is shown.</p>'
            + _trend_table(points)
        )
    table = _trend_table(points)
    fig = _figure(
        "Filled slots per month",
        f"The {len(trend)} most recent earlier month(s) with rota data, and this month.",
        lambda: svg_trend(points),
        table,
        _legend([("#6f8cb8", "Earlier months"), ("#1c3a6b", "This month"), ("#b42335", "Extra-duty layer")]),
    )
    return fig + table


def _trend_table(points: list[dict[str, Any]]) -> str:
    return _table(
        [("Month", ""), ("Slots", "num"), ("Filled", "num"), ("Coverage", "num"), ("Duties", "num"), ("Extra duties", "num"), ("Gini (within level)", "num")],
        [[e(p["month_label"]) + (' <span class="tag ac">This report</span>' if p.get("current") else ""), fmt_num(p["slots"]),
          fmt_num(p["filled"]), f'{float(p["coverage_pct"]):.1f}%', fmt_num(p.get("duties")), fmt_num(p["extra"]), fmt_num(p["gini"], 3)]
         for p in points],
        caption="Month-on-month",
        row_headers=True,
    )


def _html_audit(data: dict[str, Any]) -> str:
    events = data["audit_trail"]
    if not events:
        return _empty("No recorded actions for this month.")
    return _table(
        [("When", ""), ("Who", ""), ("Action", ""), ("Detail", "wrap")],
        [[fmt_datetime(ev["at"]), e(ev["actor"]), f"<b>{e(ev['action'])}</b>", e(ev["detail"])] for ev in events],
        caption="Audit trail", caption_note="template runs, auto-assign runs, extra-duty batches (including undone) and publish approvals, oldest first",
    )


HTML_SECTIONS: dict[str, tuple[Callable[[dict[str, Any]], str], str]] = {
    "summary": (_html_summary, "The month at a glance"),
    "coverage": (_html_coverage, "Are all duties covered?"),
    "workload": (_html_workload, "Who did how much"),
    "fairness": (_html_fairness, "How evenly duties were shared"),
    "individual_limits": (_html_individual_limits, "Members above their own duty limits"),
    "units": (_html_units, "Slots, extra and fallback per unit"),
    "calendar": (_html_calendar, "The rota, day by day"),
    "extra_duties": (_html_extra, "Ledger of the extra-duty layer"),
    "superadmin": (_html_superadmin, "Allocations and publishing that overrode the rules"),
    "compliance": (_html_compliance, "Strict rules, independently checked"),
    "trend": (_html_trend, "Recent months"),
    "audit_trail": (_html_audit, "Who did what, when"),
}


def _footer_text(meta: dict[str, Any]) -> str:
    text = f"{REPORT_TITLE} · {meta.get('department') or ''} · {meta.get('month_label') or ''}"
    return "".join(ch for ch in text if ch not in '"\\<>{}\n\r')


def render_html(data: dict[str, Any]) -> str:
    """Render the report as one self-contained HTML document (no network, no JavaScript)."""
    meta = data.get("meta") or {}
    errors = data.get("section_errors") or {}
    sections_html = []
    try:
        sections_html.append(_html_cover(data))
    except Exception as exc:  # noqa: BLE001
        sections_html.append(f'<section class="sheet" id="cover"><h1>{e(REPORT_TITLE)}</h1><div class="unavailable">Section unavailable: {e(_reason(exc))}</div></section>')
    index = 1
    for sid, title in SECTIONS[1:]:
        index += 1
        renderer, lede = HTML_SECTIONS[sid]
        if sid in errors:
            body = f'<div class="unavailable" role="note">Section unavailable: {e(errors[sid])}</div>'
        else:
            try:
                body = renderer(data)
            except Exception as exc:  # noqa: BLE001
                body = f'<div class="unavailable" role="note">Section unavailable: {e(_reason(exc))}</div>'
        sections_html.append(_sec(index, sid, title, e(lede), body, wide=sid == "calendar"))
    toc = "".join(
        f'<li><a href="#{sid}">{e(title)}{"<span class=err>unavailable</span>" if sid in errors else ""}</a></li>'
        for sid, title in SECTIONS
    )
    css = CSS.replace("__FOOTER__", _footer_text(meta))
    return (
        "<!doctype html>\n"
        '<html lang="en-GB"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light">'
        f'<meta name="generator" content="Duty Rota software · rota_report_360">'
        f"<title>{e(REPORT_TITLE)} · {e(meta.get('month_label'))}</title>"
        f"<style>{css}</style></head><body>"
        '<div class="layout">'
        '<nav class="toc" aria-label="Report contents">'
        f'<p class="brand">Audit report</p><p class="brand-sub">{e(meta.get("month_label"))}<br>'
        f'<span class="muted small" style="font-weight:400">{e(meta.get("department"))}</span></p>'
        f"<ol>{toc}</ol>"
        f'<div class="foot">Status: {e(str(meta.get("period_status") or "").capitalize())}<br>Generated {fmt_datetime(meta.get("generated_at"))}<br>'
        f'<span class="mono" title="Data fingerprint">{e((meta.get("data_fingerprint") or "")[:16])}…</span></div>'
        "</nav>"
        f'<main id="report">{"".join(sections_html)}'
        f'<p class="footer">{e(REPORT_TITLE)} · {e(meta.get("department"))} · {e(meta.get("month_label"))} · '
        f'data fingerprint <span class="mono">{e(meta.get("data_fingerprint") or "–")}</span></p>'
        "</main></div></body></html>"
    )


# =========================================================================== XLSX rendering


def render_xlsx(data: dict[str, Any]) -> bytes:
    """Render the report as an Excel workbook (sheets in contract order)."""
    import xlsxwriter

    output = BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True, "strings_to_formulas": False, "strings_to_urls": False})
    wb.set_properties({"title": f"{REPORT_TITLE} {data['meta'].get('month', '')}", "company": DEPARTMENT_NAME,
                       "comments": f"data fingerprint {data['meta'].get('data_fingerprint')}"})
    NAVY, CRIMSON = "#0F1E36", "#B42335"
    F = {
        "title": wb.add_format({"bold": True, "font_size": 20, "font_color": NAVY}),
        "subtitle": wb.add_format({"font_size": 12, "font_color": "#2B3A55"}),
        "eyebrow": wb.add_format({"bold": True, "font_size": 9, "font_color": CRIMSON}),
        "h": wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": NAVY, "border": 1, "border_color": NAVY,
                            "text_wrap": True, "valign": "vcenter"}),
        "hnum": wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": NAVY, "border": 1, "border_color": NAVY,
                               "text_wrap": True, "valign": "vcenter", "align": "right"}),
        "sec": wb.add_format({"bold": True, "font_size": 13, "font_color": NAVY, "bottom": 2, "bottom_color": NAVY}),
        "label": wb.add_format({"font_color": "#5A6578", "valign": "top"}),
        "value": wb.add_format({"bold": True, "font_color": NAVY, "valign": "top", "text_wrap": True}),
        "mono": wb.add_format({"font_name": "Consolas", "font_size": 9, "font_color": NAVY}),
        "text": wb.add_format({"valign": "top"}),
        "wrap": wb.add_format({"valign": "top", "text_wrap": True}),
        "int": wb.add_format({"num_format": "#,##0", "valign": "top"}),
        "dec": wb.add_format({"num_format": "0.00", "valign": "top"}),
        "dec3": wb.add_format({"num_format": "0.000", "valign": "top"}),
        "signed": wb.add_format({"num_format": "+0.00;-0.00;0.00", "valign": "top"}),
        "pct": wb.add_format({"num_format": "0.0%", "valign": "top"}),
        "date": wb.add_format({"num_format": "ddd dd mmm yyyy", "valign": "top", "align": "left"}),
        "dt": wb.add_format({"num_format": "dd mmm yyyy hh:mm", "valign": "top", "align": "left"}),
        "total": wb.add_format({"bold": True, "top": 2, "top_color": NAVY, "num_format": "#,##0"}),
        "totalpct": wb.add_format({"bold": True, "top": 2, "top_color": NAVY, "num_format": "0.0%"}),
        "zebra": wb.add_format({"bg_color": "#F5F7FA"}),
        "pass": wb.add_format({"bold": True, "font_color": "#1D6B43", "bg_color": "#E6F3EC"}),
        "fail": wb.add_format({"bold": True, "font_color": "#8F1B2A", "bg_color": "#F9EAEC"}),
        "void": wb.add_format({"font_color": "#8A94A6", "italic": True}),
        "unavailable": wb.add_format({"bold": True, "font_color": "#8F1B2A", "bg_color": "#F9EAEC", "border": 1, "border_color": "#E9C1C7"}),
        "line": wb.add_format({"bottom": 1, "bottom_color": "#2B3A55"}),
        "role": wb.add_format({"bold": True, "font_color": CRIMSON, "font_size": 9}),
        "note": wb.add_format({"italic": True, "font_color": "#5A6578", "text_wrap": True, "valign": "top"}),
    }
    errors = data.get("section_errors") or {}
    meta = data["meta"]

    def parse_date(value: Any) -> date | None:
        try:
            return date.fromisoformat(str(value)[:10]) if value else None
        except ValueError:
            return None

    def parse_dt(value: Any) -> datetime | None:
        try:
            return datetime.fromisoformat(str(value)) if value else None
        except ValueError:
            return None

    def put(ws: Any, r: int, c: int, value: Any, kind: str = "text") -> None:
        if value is None or value == "":
            ws.write_blank(r, c, None, F.get(kind if kind not in {"date", "dt"} else "text"))
            return
        if kind == "date":
            d = parse_date(value)
            if d:
                ws.write_datetime(r, c, datetime(d.year, d.month, d.day), F["date"])
                return
        if kind == "dt":
            d = parse_dt(value)
            if d:
                ws.write_datetime(r, c, d, F["dt"])
                return
        if kind in {"int", "dec", "dec3", "signed", "pct"} and isinstance(value, (int, float)) and not isinstance(value, bool):
            ws.write_number(r, c, value, F[kind])
            return
        ws.write_string(r, c, str(value), F.get(kind, F["text"]) if kind not in {"date", "dt"} else F["text"])

    def table(ws: Any, top: int, left: int, columns: list[tuple[str, str, int]], rows: list[list[Any]],
              filt: bool = True, freeze: bool = True, zebra: bool = True) -> tuple[int, int]:
        """columns: (header, kind, width). Returns (first_data_row, last_data_row)."""
        for j, (header, kind, width) in enumerate(columns):
            ws.write_string(top, left + j, header, F["hnum"] if kind in {"int", "dec", "dec3", "signed", "pct"} else F["h"])
            ws.set_column(left + j, left + j, width)
        ws.set_row(top, 30)
        for i, row in enumerate(rows, start=1):
            for j, value in enumerate(row):
                put(ws, top + i, left + j, value, columns[j][1])
        last = top + max(1, len(rows))
        if filt and rows:
            ws.autofilter(top, left, top + len(rows), left + len(columns) - 1)
        if freeze:
            ws.freeze_panes(top + 1, 0)
        if zebra and len(rows) > 1:
            ws.conditional_format(top + 1, left, top + len(rows), left + len(columns) - 1,
                                  {"type": "formula", "criteria": "=MOD(ROW(),2)=0", "format": F["zebra"]})
        return top + 1, last

    def heading(ws: Any, title: str, note: str | None = None) -> int:
        ws.write_string(0, 0, f"{REPORT_TITLE} · {meta.get('month_label', '')}", F["eyebrow"])
        ws.write_string(1, 0, title, F["title"])
        if note:
            ws.write_string(2, 0, note, F["note"])
        ws.set_row(1, 28)
        ws.hide_gridlines(2)
        ws.set_landscape()
        ws.set_paper(9)
        ws.fit_to_pages(1, 0)
        ws.set_footer(f"&L&8{_footer_text(meta).replace('&', '&&')}&R&8Page &P of &N")
        return 4

    def unavailable(ws: Any, key: str, row: int) -> bool:
        if key in errors:
            ws.set_column(0, 0, 90)
            ws.write_string(row, 0, f"Section unavailable: {errors[key]}", F["unavailable"])
            return True
        return False

    def guarded(name: str, key: str | None, fn: Callable[[Any], None]) -> None:
        ws = wb.add_worksheet(name)
        try:
            fn(ws)
        except Exception as exc:  # noqa: BLE001
            ws.write_string(5, 0, f"Section unavailable: {_reason(exc)}", F["unavailable"])

    # ------------------------------------------------------------------ Cover
    def cover(ws: Any) -> None:
        ws.hide_gridlines(2)
        ws.set_column(0, 0, 3)
        ws.set_column(1, 1, 24)
        ws.set_column(2, 2, 72)
        ws.set_column(3, 4, 22)
        ws.write_string(1, 1, "CONFIDENTIAL · PREPARED FOR AUDIT", F["eyebrow"])
        ws.write_string(2, 1, meta.get("title") or REPORT_TITLE, F["title"])
        ws.set_row(2, 32)
        ws.write_string(3, 1, str(meta.get("department") or ""), F["subtitle"])
        ws.write_string(4, 1, str(meta.get("month_label") or ""), F["subtitle"])
        items = [
            ("Month", meta.get("month"), "text"),
            ("Rota status", str(meta.get("period_status") or "").capitalize(), "text"),
            ("Period", f"{meta.get('starts_on', '')} to {meta.get('ends_on', '')}", "text"),
            ("Published at", meta.get("published_at"), "dt"),
            ("Published by", meta.get("published_by") or ("–" if not meta.get("published_at") else "Unknown"), "text"),
            ("Superadmin override", ("Published with superadmin override: " + str(meta.get("override_reason") or ""))
             if meta.get("published_with_override") else "No", "text"),
            ("Generated at", meta.get("generated_at"), "dt"),
            ("Generated by", meta.get("generated_by"), "text"),
            ("Rules", meta.get("rules_source"), "text"),
            ("Rules revision", meta.get("rules_revision"), "mono"),
            ("Data fingerprint", meta.get("data_fingerprint"), "mono"),
            ("Report fingerprint", meta.get("report_fingerprint"), "mono"),
        ]
        r = 6
        for label, value, kind in items:
            ws.write_string(r, 1, label, F["label"])
            if kind == "dt" and parse_dt(value):
                ws.write_datetime(r, 2, parse_dt(value), wb.add_format({"num_format": "dd mmm yyyy hh:mm", "bold": True, "font_color": NAVY, "align": "left"}))
            else:
                ws.write_string(r, 2, str(value) if value not in (None, "") else "–", F["mono"] if kind == "mono" else F["value"])
            r += 1
        r += 1
        ws.write_string(r, 1, "Sign-off", F["sec"])
        ws.write_blank(r, 2, None, F["sec"])
        r += 2
        for role in ("Prepared by", "Reviewed by", "Approved by"):
            ws.write_string(r, 1, role.upper(), F["role"])
            r += 1
            for field_name in ("Name", "Signature", "Date"):
                ws.write_string(r, 1, field_name, F["label"])
                ws.write_blank(r, 2, None, F["line"])
                ws.set_row(r, 22)
                r += 1
            r += 1
        ws.write_string(r, 1, "Sheets", F["sec"])
        ws.write_blank(r, 2, None, F["sec"])
        r += 1
        for i, name in enumerate(XLSX_SHEETS[1:], start=2):
            ws.write_string(r, 1, f"{i:02d}", F["label"])
            ws.write_string(r, 2, name + ("  (unavailable)" if SECTIONS[i - 1][0] in errors else ""), F["text"])
            r += 1
        ws.set_paper(9)
        ws.fit_to_pages(1, 1)

    # ------------------------------------------------------------------ Summary
    def summary(ws: Any) -> None:
        r = heading(ws, "Executive summary")
        if unavailable(ws, "summary", r):
            return
        s = data["summary"]
        comp = data.get("compliance") or {}
        rows = [
            ["Slots", s.get("slots"), "int"], ["Filled slots", s.get("filled"), "int"], ["Open slots", s.get("open"), "int"],
            ["Coverage", (s.get("coverage_pct") or 0) / 100, "pct"], ["Members", s.get("members"), "int"],
            ["Members with a duty", s.get("members_on_duty"), "int"], ["Duties assigned", s.get("duties_total"), "int"],
            ["24-hour duties", s.get("duties_24hr"), "int"], ["Weekend duties", s.get("weekend_duties"), "int"],
            ["Night duties", s.get("night_duties"), "int"], ["Extra duties (active ledger)", s.get("extra_duties"), "int"],
            ["Void ledger records (not counted)", s.get("extra_void"), "int"], ["Fallback-unit duties", s.get("fallback_duties"), "int"],
            ["Override assignments", s.get("override_assignments"), "int"], ["Hard-blocked slots covered", s.get("hard_blocked_covered"), "int"],
            ["Members over an individual limit", len((data.get("individual_limits") or {}).get("people") or []), "int"],
            ["Superadmin allocations (active)", (data.get("superadmin") or {}).get("active_allocations", 0), "int"],
            ["Extra duties passed on by Balance duties", s.get("extra_passed_on", 0), "int"],
            ["Compliance", ("All checks passed" if comp.get("all_passed") else ("Not verified" if not comp.get("available") else "Checks failed")), "text"],
        ]
        ws.write_string(r, 0, "Measure", F["h"])
        ws.write_string(r, 1, "Value", F["hnum"])
        ws.set_column(0, 0, 38)
        ws.set_column(1, 1, 18)
        ws.set_column(3, 3, 22)
        ws.set_column(4, 4, 90)
        for i, (label, value, kind) in enumerate(rows, start=1):
            ws.write_string(r + i, 0, label, F["text"])
            put(ws, r + i, 1, value, kind)
        ws.conditional_format(r + 1, 1, r + len(rows), 1, {"type": "text", "criteria": "containing", "value": "passed", "format": F["pass"]})
        ws.conditional_format(r + 1, 1, r + len(rows), 1, {"type": "text", "criteria": "containing", "value": "failed", "format": F["fail"]})
        ws.write_string(r, 3, "Term", F["h"])
        ws.write_string(r, 4, "Definition", F["h"])
        for i, d in enumerate(data.get("definitions", []), start=1):
            ws.write_string(r + i, 3, d["term"], F["value"])
            ws.write_string(r + i, 4, d["meaning"], F["wrap"])
        note_row = r + max(len(rows), len(data.get("definitions", []))) + 2
        ws.write_string(note_row, 0, ("Holiday dates this month: " + ", ".join(meta.get("holidays_in_month") or []))
                        if meta.get("holiday_calendar") else "No holiday calendar is configured, so holiday counts are 0.", F["note"])
        ws.freeze_panes(r + 1, 0)

    # ------------------------------------------------------------------ Coverage
    def coverage(ws: Any) -> None:
        r = heading(ws, "Coverage", "Filled = at least one active assignment.")
        if unavailable(ws, "coverage", r):
            return
        c = data["coverage"]
        days = c.get("by_day") or []
        table(ws, r, 0, [("Date", "date", 16), ("Day", "text", 7), ("Holiday", "text", 9), ("Slots", "int", 8), ("Filled", "int", 8),
                         ("Open", "int", 8), ("Coverage", "pct", 10)],
              [[d["date"], d["weekday"], "Yes" if d.get("holiday") else "", d["slots"], d["filled"], d["slots"] - d["filled"],
                (d["filled"] / d["slots"]) if d["slots"] else None] for d in days])
        if days:
            ws.conditional_format(r + 1, 6, r + len(days), 6, {"type": "3_color_scale", "min_color": "#F9EAEC", "mid_color": "#D3DDEB", "max_color": "#6F8CB8",
                                                               "min_type": "num", "min_value": 0.5, "mid_type": "num", "mid_value": 0.9, "max_type": "num", "max_value": 1})
            ws.conditional_format(r + 1, 5, r + len(days), 5, {"type": "cell", "criteria": ">", "value": 0, "format": F["fail"]})
        units = c.get("by_unit") or []
        table(ws, r, 8, [("Unit", "text", 24), ("Slots", "int", 8), ("Filled", "int", 8), ("Open", "int", 8)],
              [[u["unit"], u["slots"], u["filled"], u["open"]] for u in units], filt=False, freeze=False)
        duties = c.get("by_duty") or []
        table(ws, r, 13, [("Duty", "text", 28), ("Duty key", "text", 20), ("Slots", "int", 8), ("Filled", "int", 8), ("Open", "int", 8)],
              [[d["label"], d["duty_type"], d["slots"], d["filled"], d["open"]] for d in duties], filt=False, freeze=False)
        ws.set_column(7, 7, 3)
        ws.set_column(12, 12, 3)

    # ------------------------------------------------------------------ Workload
    def workload(ws: Any) -> None:
        r = heading(ws, "Member workload", DEFINITIONS[2][1] + " Deviation = total minus the mean of the same call level.")
        if unavailable(ws, "workload", r):
            return
        rows = data["workload"]
        first, last = table(ws, r, 0, [
            ("Member", "text", 30), ("Call level", "text", 12), ("Unit", "text", 22), ("Total", "int", 9), ("24-hour", "int", 9),
            ("Weekend", "int", 9), ("Weekend 24h", "int", 10), ("Nights", "int", 8), ("Holidays", "int", 9), ("Extra", "int", 8),
            ("Hours", "dec", 9), ("Deviation from level mean", "signed", 14), ("Overrides", "int", 10)],
            [[w["name"], call_level_label(w["call_level"]), w["unit"], w["total"], w["hours24"], w["weekend"], w["weekend24"],
              w["nights"], w["holidays"], w["extra"], w.get("hours"), w["deviation_from_mean"], w.get("overrides", 0)] for w in rows])
        if rows:
            ws.conditional_format(first, 3, last, 3, {"type": "data_bar", "bar_color": "#3D5E94", "bar_solid": True})
            ws.conditional_format(first, 11, last, 11, {"type": "3_color_scale", "min_color": "#6F8CB8", "mid_color": "#FFFFFF", "max_color": "#D9727F",
                                                        "mid_type": "num", "mid_value": 0})
            n = len(rows)
            ws.write_string(r + n + 1, 0, "Total", F["total"])
            for col in (3, 4, 5, 6, 7, 8, 9):
                letter = xlsxwriter.utility.xl_col_to_name(col)
                total = sum(int(w[k]) for w in rows for k in [["total", "hours24", "weekend", "weekend24", "nights", "holidays", "extra"][col - 3]])
                ws.write_formula(r + n + 1, col, f"=SUBTOTAL(9,{letter}{first + 1}:{letter}{last + 1})", F["total"], total)
            ws.freeze_panes(r + 1, 1)

    # ------------------------------------------------------------------ Fairness
    def fairness(ws: Any) -> None:
        r = heading(ws, "Fairness", "Within each call level. Gini 0 = equal; spread = max - min.")
        if unavailable(ws, "fairness", r):
            return
        levels = data["fairness"].get("by_call_level") or []
        first, last = table(ws, r, 0, [
            ("Call level", "text", 14), ("Members", "int", 9), ("Duties", "int", 9), ("Mean", "dec", 9), ("Min", "int", 8), ("Max", "int", 8),
            ("Std dev", "dec", 9), ("Gini", "dec3", 9), ("Spread", "int", 9), ("Mean 24h", "dec", 10), ("Gini 24h", "dec3", 10)],
            [[lvl["label"], lvl["members"], lvl["total"], lvl["mean"], lvl["min"], lvl["max"], lvl["std"], lvl["gini"], lvl["spread"],
              lvl["mean_24hr"], lvl["gini_24hr"]] for lvl in levels])
        if levels:
            ws.conditional_format(first, 7, last, 7, {"type": "2_color_scale", "min_color": "#FFFFFF", "max_color": "#D9727F",
                                                      "min_type": "num", "min_value": 0, "max_type": "num", "max_value": 0.4})
            o = data["fairness"].get("overall") or {}
            rr = r + len(levels) + 1
            ws.write_string(rr, 0, "All members", F["total"])
            for col, key, kind in [(1, "members", "int"), (2, "total", "int"), (3, "mean", "dec"), (4, "min", "int"), (5, "max", "int"),
                                   (6, "std", "dec"), (7, "gini_within_levels", "dec3"), (8, "spread", "int")]:
                if o.get(key) is not None:
                    ws.write_number(rr, col, o[key], wb.add_format({"bold": True, "top": 2, "top_color": NAVY, "num_format": "0.000" if kind == "dec3" else ("0.00" if kind == "dec" else "#,##0")}))
            ws.write_string(rr + 2, 0, f"Overall Gini is the member-weighted mean of call-level Ginis; across all members regardless of level it is {o.get('gini', 0)}.", F["note"])
        targets = data["fairness"].get("targets") or []
        if targets:
            tr = r + len(levels) + 5
            ws.write_string(tr - 1, 0, "Equal duties within a call level (target = slots / members, all campuses)", F["note"])
            table(ws, tr, 0, [
                ("Call level", "text", 14), ("Slots", "int", 9), ("Members", "int", 9), ("Target", "dec", 9), ("Min", "int", 8),
                ("Max", "int", 8), ("Gap", "int", 9), ("Allowed", "int", 9), ("Within gap", "text", 10), ("Off target", "int", 10)],
                [[t["label"], t["slots"], t["members"], t["target"] if t["target"] is not None else 0, t["min"], t["max"],
                  t["gap"], t["allowed_gap"], "Yes" if t["ok"] else "No", len(t["off_target"])] for t in targets],
                filt=False, freeze=False)
            off = [(t, m) for t in targets for m in t["off_target"]]
            if off:
                orow = tr + len(targets) + 2
                ws.write_string(orow - 1, 0, "Members off target", F["note"])
                table(ws, orow, 0, [("Call level", "text", 14), ("Member", "text", 28), ("Duties", "int", 9),
                                    ("Extra duties", "int", 11), ("From target", "dec", 11), ("Leave days", "int", 10)],
                      [[t["label"], m["name"], m["duties"], m["extra_duties"], m["diff_from_target"], m["leave_days"]]
                       for t, m in off], filt=False, freeze=False)
        # Balancing (docs/call_level_pool_and_balance_contract.md section 2), below everything above.
        balancing = data["fairness"].get("balancing") or []
        if balancing:
            br = r + len(levels) + len(targets) + sum(len(t["off_target"]) for t in targets) + 12
            ws.write_string(br - 1, 0, "Balancing: Balance duties moves (gap before -> after per call level)", F["note"])
            rows_b = []
            for b in balancing:
                gaps = "; ".join(f"{lv['label']} {lv['before_gap']}->{lv['after_gap']}" for lv in b["levels"])
                for m in b["moves"]:
                    rows_b.append([b["status"], m["duty_date"] or "", m["duty_label"] or "", m["from_person"] or "",
                                   m["to_person"] or "", m["from_unit"] or "", m["to_unit"] or "",
                                   "Yes" if m["cross_unit"] else "No", m["kind"] or "", gaps,
                                   "Yes" if m.get("extra_duty") else "",
                                   (f"{m.get('ledger_from') or '?'} -> {m.get('ledger_to') or '?'}" if m.get("extra_duty") else ""),
                                   "; ".join(m.get("new_overridden_labels") or [])])
            table(ws, br, 0, [("Batch", "text", 10), ("Date", "text", 11), ("Duty", "text", 22), ("From", "text", 22),
                              ("To", "text", 22), ("From unit", "text", 14), ("To unit", "text", 14),
                              ("Cross-unit", "text", 10), ("Kind", "text", 8), ("Gaps", "text", 40),
                              ("Extra duty", "text", 10), ("Ledger transfer", "text", 30), ("Rules for new holder", "wrap", 36)],
                  rows_b or [[""] * 13], filt=False, freeze=False)
            passed_on = sum(b.get("extra_moves") or 0 for b in balancing if b["status"] == "applied")
            if passed_on:
                ws.write_string(br + max(len(rows_b), 1) + 2, 0,
                                f"{passed_on} extra duties were passed on by Balance duties to even out totals; "
                                "the justice-ledger credit moved with each duty.", F["note"])

    # ------------------------------------------------------------------ Individual limits
    def over_limit(ws: Any) -> None:
        r = heading(ws, "Individual limits exceeded", "One row per limit a member is above, counted across all units.")
        if unavailable(ws, "individual_limits", r):
            return
        section = data.get("individual_limits") or {}
        if not section.get("configured"):
            ws.set_column(0, 0, 90)
            ws.write_string(r, 0, "No individual duty limits are set in the saved rules.", F["note"])
            return
        rows = [
            [p["person_name"], p.get("call_level_label"), p.get("home_unit_name"), p.get("month_duties"), p.get("month_24hr"),
             item.get("label"), item.get("code"), item.get("actual"), item.get("limit"),
             (item.get("actual") - item.get("limit"))
             if isinstance(item.get("actual"), (int, float)) and isinstance(item.get("limit"), (int, float)) else None]
            for p in section.get("people") or []
            for item in p.get("limits") or []
        ]
        first, last = table(ws, r, 0, [
            ("Member", "text", 30), ("Call level", "text", 12), ("Unit", "text", 22), ("Duties", "int", 9), ("24-hour", "int", 9),
            ("Limit", "text", 26), ("Code", "text", 26), ("Actual", "int", 9), ("Allowed", "int", 9), ("Over by", "int", 9)], rows)
        if rows:
            ws.conditional_format(first, 9, last, 9, {"type": "cell", "criteria": ">", "value": 0, "format": F["fail"]})
        else:
            ws.write_string(r + 2, 0, "No member is above an individual duty limit this month.", F["note"])

    # ------------------------------------------------------------------ Units
    def units(ws: Any) -> None:
        r = heading(ws, "Units", "Extra received = duties placed in the unit by the extra-duty layer. Fallback = covered by another unit's members.")
        if unavailable(ws, "units", r):
            return
        rows = data["units"]
        first, last = table(ws, r, 0, [
            ("Unit", "text", 26), ("Code", "text", 10), ("Campus", "text", 12), ("Members", "int", 10), ("Slots", "int", 8), ("Filled", "int", 8),
            ("Open", "int", 8), ("Coverage", "pct", 10), ("Extra received", "int", 10), ("Fallback received", "int", 10), ("Fallback given", "int", 10)],
            [[u["unit"], u.get("code"), u.get("campus"), u["members"], u["slots"], u["filled"], u["open"], u["coverage_pct"] / 100,
              u["extra_received"], u["fallback_received"], u["fallback_given"]] for u in rows])
        if rows:
            ws.conditional_format(first, 4, last, 4, {"type": "data_bar", "bar_color": "#3D5E94", "bar_solid": True})
            ws.conditional_format(first, 8, last, 8, {"type": "data_bar", "bar_color": "#B42335", "bar_solid": True})
            ws.conditional_format(first, 6, last, 6, {"type": "cell", "criteria": ">", "value": 0, "format": F["fail"]})

    # ------------------------------------------------------------------ Calendar
    def cal(ws: Any) -> None:
        r = heading(ws, "Rota calendar", "One row per slot. Extra = placed by the extra-duty layer.")
        if unavailable(ws, "calendar", r):
            return
        rows = data["calendar"]
        first, last = table(ws, r, 0, [
            ("Date", "date", 16), ("Day", "text", 6), ("Unit", "text", 22), ("Duty", "text", 26), ("Duty key", "text", 18), ("24-hour", "text", 8),
            ("Member", "text", 30), ("Status", "text", 9), ("Extra", "text", 7), ("Fallback", "text", 9)],
            [[c["date"], c["weekday"], c["unit"], c["label"], c["duty_type"], "Yes" if c["is_24hr"] else "", c["person"] or "", c["status"],
              "Yes" if c["extra"] else "", "Yes" if c["fallback"] else ""] for c in rows])
        if rows:
            ws.conditional_format(first, 7, last, 7, {"type": "cell", "criteria": "==", "value": '"open"', "format": F["fail"]})
            ws.conditional_format(first, 8, last, 8, {"type": "cell", "criteria": "==", "value": '"Yes"', "format": wb.add_format({"font_color": "#8F1B2A", "bold": True})})

    # ------------------------------------------------------------------ Extra duties
    def extra(ws: Any) -> None:
        r = heading(ws, "Extra duties (ledger)", "Void records are listed (greyed) but not counted anywhere in the report.")
        if unavailable(ws, "extra_duties", r):
            return
        rows = data["extra_duties"]
        first, last = table(ws, r, 0, [
            ("Date", "date", 16), ("Duty", "text", 24), ("Member", "text", 26), ("Home unit", "text", 18), ("Assigned unit", "text", 18),
            ("Fallback", "text", 9), ("Rules overridden", "wrap", 40), ("Justice key", "wrap", 56), ("Status", "text", 8),
            ("Void reason", "text", 24), ("Ledger count (12 mo)", "int", 11), ("Duties this month", "int", 11), ("Batch", "text", 12), ("Record id", "text", 38),
            ("Passed on from", "wrap", 40)],
            [[x["duty_date"], x["label"], x["person_name"], x["home_unit"], x["assigned_unit"], "Yes" if x["fallback_used"] else "",
              "; ".join(x["overridden_labels"]) or "None", justice_words(x.get("justice") or {}), x["status"], x.get("void_reason"),
              (x.get("justice") or {}).get("ledger_count"), (x.get("justice") or {}).get("month_duties"), x["batch_id"][:8], x["id"],
              "; ".join(t["text"] for t in x.get("transfers") or [])]
             for x in rows])
        if rows:
            ws.conditional_format(first, 0, last, 14, {"type": "formula", "criteria": f'=$I{first + 1}<>"active"', "format": F["void"]})
            ws.conditional_format(first, 8, last, 8, {"type": "cell", "criteria": "==", "value": '"active"', "format": F["pass"]})

    # ------------------------------------------------------------------ Superadmin
    def superadmin(ws: Any) -> None:
        r = heading(ws, "Superadmin actions", "Allocations that overrode rota rules (never leave, rest or double duty) and publishing with blockers.")
        if unavailable(ws, "superadmin", r):
            return
        section = data.get("superadmin") or {}
        rows = section.get("allocations") or []
        table(ws, r, 0, [
            ("Date", "date", 16), ("Duty", "text", 24), ("Unit", "text", 18), ("Member", "text", 26), ("Rules overridden", "wrap", 44),
            ("Reason", "wrap", 40), ("By", "text", 18), ("When", "dt", 18), ("Post-publish", "text", 11), ("Status", "text", 9)],
            [[x.get("duty_date"), x.get("label"), x.get("unit"), x.get("person_name"), "; ".join(x.get("overridden_labels") or []) or "None",
              x.get("reason"), x.get("by"), x.get("at"), "Yes" if x.get("post_publish") else "No", x.get("status")] for x in rows])
        r2 = r + max(1, len(rows)) + 3
        ws.write_string(r2 - 1, 0, "Published with superadmin override", F["sec"])
        overrides = section.get("publish_overrides") or []
        if overrides:
            table(ws, r2, 0, [("When", "dt", 16), ("Who", "text", 24), ("Open slots", "int", 18), ("Unconfirmed warnings", "int", 26),
                              ("Reason", "wrap", 44), ("Blockers at publish", "wrap", 40)],
                  [[o.get("at"), o.get("by"), o.get("open_slots"), o.get("warnings_unconfirmed"), o.get("reason"),
                    "; ".join(f"{b.get('title')}: {b.get('detail')}" for b in o.get("blockers") or [])]
                   for o in overrides], freeze=False)
        else:
            ws.write_string(r2, 0, "The rota was not published with a superadmin override.", F["note"])

    # ------------------------------------------------------------------ Compliance
    def compliance(ws: Any) -> None:
        r = heading(ws, "Compliance", "Strict rules checked independently (extra_duty_verify.check_month) plus the report's own reconciliation.")
        if unavailable(ws, "compliance", r):
            return
        c = data["compliance"]
        verdict = "ALL CHECKS PASSED" if c.get("all_passed") else ("NOT VERIFIED: " + str(c.get("error")) if not c.get("available") else "CHECKS FAILED")
        ws.write_string(r, 0, verdict, F["pass"] if c.get("all_passed") else F["fail"])
        r += 2
        checks = c.get("checks") or []
        first, last = table(ws, r, 0, [("Check", "text", 46), ("Source", "text", 22), ("Result", "text", 10), ("Checked", "int", 10), ("Violations", "int", 11)],
                            [[x["name"], {"independent": "Independent checker", "report": "Report reconciliation"}.get(x.get("source"), x.get("source")),
                              "PASS" if x.get("passed") else "FAIL", x.get("checked"), x.get("violations")] for x in checks], filt=False)
        if checks:
            ws.conditional_format(first, 2, last, 2, {"type": "cell", "criteria": "==", "value": '"PASS"', "format": F["pass"]})
            ws.conditional_format(first, 2, last, 2, {"type": "cell", "criteria": "==", "value": '"FAIL"', "format": F["fail"]})
        violations = c.get("violations") or []
        r2 = r + len(checks) + 3
        ws.write_string(r2 - 1, 0, f"Violations ({len(violations)})", F["sec"])
        if violations:
            table(ws, r2, 0, [("Date", "date", 16), ("Duty", "text", 22), ("Unit", "text", 18), ("Member", "text", 26), ("Code", "text", 18), ("Detail", "wrap", 70)],
                  [[v.get("date"), v.get("duty"), v.get("unit"), v.get("person_name"), v.get("code"), v.get("message")] for v in violations], freeze=False)
        ws.set_column(0, 0, 46)

    # ------------------------------------------------------------------ Trend
    def trend(ws: Any) -> None:
        r = heading(ws, "Trend", "Up to five earlier months with rota data, and this month.")
        if unavailable(ws, "trend", r):
            return
        s = data.get("summary") or {}
        points = list(data["trend"])
        if s:
            points.append({"month_label": meta.get("month_label", "") + " (this report)", "slots": s.get("slots", 0), "filled": s.get("filled", 0),
                           "coverage_pct": s.get("coverage_pct", 0), "duties": s.get("duties_total", 0), "extra": s.get("extra_duties", 0),
                           "gini": (data.get("fairness") or {}).get("overall", {}).get("gini_within_levels", 0)})
        first, last = table(ws, r, 0, [("Month", "text", 26), ("Slots", "int", 9), ("Filled", "int", 9), ("Coverage", "pct", 10), ("Duties", "int", 9),
                                       ("Extra duties", "int", 11), ("Gini (within level)", "dec3", 12)],
                            [[p["month_label"], p["slots"], p["filled"], float(p["coverage_pct"]) / 100, p.get("duties"), p["extra"], p["gini"]] for p in points],
                            filt=False)
        if len(points) >= 2:
            sheet = "'Trend'"
            chart = wb.add_chart({"type": "column"})
            chart.add_series({"name": "Filled", "categories": f"={sheet}!$A${first + 1}:$A${last + 1}",
                              "values": f"={sheet}!$C${first + 1}:$C${last + 1}", "fill": {"color": "#1C3A6B"}, "gap": 80})
            chart.add_series({"name": "Extra duties", "categories": f"={sheet}!$A${first + 1}:$A${last + 1}",
                              "values": f"={sheet}!$F${first + 1}:$F${last + 1}", "fill": {"color": "#B42335"}})
            chart.set_title({"name": "Filled slots and extra duties per month", "name_font": {"size": 11, "color": NAVY}})
            chart.set_legend({"position": "bottom"})
            chart.set_y_axis({"major_gridlines": {"visible": True, "line": {"color": "#E6E9EF"}}})
            ws.insert_chart(last + 3, 0, chart, {"x_scale": 1.4, "y_scale": 1.1})

    # ------------------------------------------------------------------ Audit trail
    def audit(ws: Any) -> None:
        r = heading(ws, "Audit trail", "Template runs, auto-assign runs, extra-duty batches (with their mode, including undone) and publish approvals.")
        if unavailable(ws, "audit_trail", r):
            return
        table(ws, r, 0, [("When", "dt", 18), ("Who", "text", 22), ("Action", "text", 26), ("Detail", "wrap", 100)],
              [[ev["at"], ev["actor"], ev["action"], ev["detail"]] for ev in data["audit_trail"]])

    for name, key, fn in [
        ("Cover", None, cover), ("Executive summary", "summary", summary), ("Coverage", "coverage", coverage),
        ("Member workload", "workload", workload), ("Fairness", "fairness", fairness),
        ("Over limit", "individual_limits", over_limit), ("Units", "units", units),
        ("Rota calendar", "calendar", cal), ("Extra duties", "extra_duties", extra), ("Superadmin", "superadmin", superadmin), ("Compliance", "compliance", compliance),
        ("Trend", "trend", trend), ("Audit trail", "audit_trail", audit),
    ]:
        guarded(name, key, fn)
    wb.worksheets()[0].activate()
    wb.close()
    return output.getvalue()
