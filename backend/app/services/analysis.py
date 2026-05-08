from collections import Counter
import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
import re

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.duty_types import DUTY_TYPES, MAIN_24HR_KEYS
from app.models import AdminMapping, DutyAssignment, DutySlot, PersonPosting, RotaPeriod
from app.services.members import duplicate_candidates, invalid_members

ANALYSIS_PERIOD_STATUSES = {"historical", "approved", "published", "finalized"}
EXCLUDED_FROM_24HR_TOTAL = {"FIFTH_CALL", "CART"}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
CALL_LEVEL_RANKS = {
    "CO_1ST_CALL": 0,
    "1ST_CALL": 1,
    "2ND_CALL": 2,
    "3RD_CALL": 3,
    "CO_3RD_CALL": 3,
    "CO_4TH_CALL": 4,
    "4TH_CALL": 5,
    "5TH_CALL": 6,
}
# Maps duty_type → implied call level, used as fallback when no posting record exists
DUTY_TYPE_CALL_LEVEL: dict[str, str] = {
    "MAIN_1ST_24HR": "1ST_CALL",
    "MAIN_1ST_CO_24HR": "1ST_CALL",
    "MAIN_2ND_24HR": "2ND_CALL",
    "MAIN_3RD_24HR": "3RD_CALL",
    "MAIN_4TH_24HR": "4TH_CALL",
    "MAIN_CO3RD_24HR": "CO_3RD_CALL",
    "MAIN_CO4TH_24HR": "CO_4TH_CALL",
    "CB_1ST_24HR": "1ST_CALL",
    "CB_3RD_24HR": "3RD_CALL",
    "CB_4TH_24HR": "4TH_CALL",
    "CB_CO3RD_24HR": "CO_3RD_CALL",
    "CB_CO4TH_24HR": "CO_4TH_CALL",
    "RC_1ST_A_24HR": "1ST_CALL",
    "RC_1ST_B_24HR": "1ST_CALL",
    "RC_2ND_24HR": "2ND_CALL",
    "RC_3RD_24HR": "3RD_CALL",
    "RC_4TH_24HR": "4TH_CALL",
    "RC_CO3RD_24HR": "CO_3RD_CALL",
    "RC_CO4TH_24HR": "CO_4TH_CALL",
    "CAESAR_B_24HR": "2ND_CALL",
    "FIFTH_CALL": "5TH_CALL",
}
KNOWN_DUTY_TYPES = {duty_type.key for duty_type in DUTY_TYPES}
REPO_DIR = Path(__file__).resolve().parents[3]
ANALYSIS_REBUILD_DIR = REPO_DIR / "Plan" / "Data" / "analysis_rebuild"


@dataclass
class PersonAnalysis:
    name: str
    total_24hr: int = 0
    total_weekend_24hr: int = 0
    total_weekday_24hr: int = 0
    main_24hr: int = 0
    cb_24hr: int = 0
    rc_24hr: int = 0
    schell: int = 0
    floating: int = 0
    fifth_call: int = 0
    fifth_call_weekend: int = 0
    caesar_b: int = 0
    cart: int = 0
    caesar_a: int = 0
    pac: int = 0
    shift: int = 0
    rc12hr: int = 0
    cb_co12hr: int = 0
    chad: int = 0
    ruhsa: int = 0
    neuro_dept: int = 0
    day_breakdown: dict[str, int] = field(default_factory=lambda: {day: 0 for day in DAYS})
    monthly_24hr: dict[str, int] = field(default_factory=dict)
    fifth_call_monthly: dict[str, int] = field(default_factory=dict)
    fifth_call_days: dict[str, int] = field(default_factory=lambda: {day: 0 for day in DAYS})
    pain_months: set[str] = field(default_factory=set)
    sicu_months: set[str] = field(default_factory=set)
    drp_months: set[str] = field(default_factory=set)
    neuro_icu_months: set[str] = field(default_factory=set)
    call_levels: dict[str, str] = field(default_factory=dict)
    inferred_call_levels: dict[str, str] = field(default_factory=dict)
    units: dict[str, str] = field(default_factory=dict)
    months_active: set[str] = field(default_factory=set)
    promotions: list[dict[str, str]] = field(default_factory=list)


def month_key(value: date) -> str:
    return value.strftime("%b_%Y")


def month_label(key: str) -> str:
    month, year = key.split("_")
    return f"{month} {year[-2:]}"


def is_analysis_period(period: RotaPeriod | None) -> bool:
    return period is not None and period.status in ANALYSIS_PERIOD_STATUSES


def counts_in_24hr_total(duty_type: str, is_24hr: bool) -> bool:
    return is_24hr and duty_type not in EXCLUDED_FROM_24HR_TOTAL


def duty_category_key(duty_type: str) -> str | None:
    if duty_type.startswith("MAIN_") and duty_type in MAIN_24HR_KEYS:
        return "main_24hr"
    if duty_type.startswith("CB_") and duty_type in MAIN_24HR_KEYS:
        return "cb_24hr"
    if duty_type.startswith("RC_") and duty_type in MAIN_24HR_KEYS:
        return "rc_24hr"
    return {
        "SCHELL_24HR": "schell",
        "FLOATING_24HR": "floating",
        "FIFTH_CALL": "fifth_call",
        "CAESAR_B_24HR": "caesar_b",
        "CART": "cart",
        "CAESAR_A_12HR": "caesar_a",
        "PAC": "pac",
        "SHIFT": "shift",
        "RC_12HR": "rc12hr",
        "RC_CO_12HR": "rc12hr",
        "CB_CO_12HR": "cb_co12hr",
        "CHAD": "chad",
        "RUHSA": "ruhsa",
        "NEURO_DEPT": "neuro_dept",
    }.get(duty_type)


_ORDINAL_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # CO-1st must come before plain 1st
    (re.compile(r"\bCO[\s_-]*1ST\b|\bCO[\s_-]*FIRST\b|\bCO[\s_-]*1\b"), "CO_1ST_CALL"),
    # CO-4th must come before plain 4th
    (re.compile(r"\bCO[\s_-]*4TH\b|\bCO[\s_-]*FOURTH\b|\bCO[\s_-]*4\b"), "CO_4TH_CALL"),
    # Plain ordinals — match the ordinal word/abbreviation only, not bare year digits
    (re.compile(r"\b1ST\b|\bFIRST\b"), "1ST_CALL"),
    (re.compile(r"\b2ND\b|\bSECOND\b"), "2ND_CALL"),
    (re.compile(r"\b3RD\b|\bTHIRD\b"), "3RD_CALL"),
    (re.compile(r"\b4TH\b|\bFOURTH\b"), "4TH_CALL"),
    (re.compile(r"\b5TH\b|\bFIFTH\b"), "5TH_CALL"),
]


def call_level_from_posting(posting_type: str) -> str | None:
    label = re.sub(r"[_-]+", " ", posting_type.upper())
    # Only attempt extraction if there is a call-related keyword present
    if "CALL" not in label and not re.search(r"\bCO[-_]?[14]", label):
        return None
    for pattern, level in _ORDINAL_PATTERNS:
        if pattern.search(label):
            return level
    return None


def posting_bucket(posting_type: str) -> str | None:
    label = posting_type.upper()
    if "PAIN" in label:
        return "pain_months"
    if "SICU" in label or ("ICU" in label and "NEURO" not in label):
        return "sicu_months"
    if "DRP" in label:
        return "drp_months"
    if "NEURO" in label:
        return "neuro_icu_months"
    return None


def empty_month_dict(months: list[str]) -> dict[str, int]:
    return {month: 0 for month in months}


def enforce_monotonic_call_levels(person: PersonAnalysis, months: list[str]) -> None:
    """
    Call levels can only ever increase (promotions only, no demotions).
    Walk through months in order and ensure each month's level is at least
    as high as the highest level seen so far.  This corrects noise from
    inferred levels when a person does a duty outside their normal call slot
    (e.g. a 4th-caller covering a 2nd-call duty).
    Posting-derived levels are already stored in call_levels; inferred ones
    were merged in. Either way, we enforce monotonicity here.
    """
    peak_rank = -1
    peak_level: str | None = None
    for month in months:
        level = person.call_levels.get(month)
        if level is None:
            # Carry forward the highest known level to fill gaps
            if peak_level is not None:
                person.call_levels[month] = peak_level
            continue
        rank = CALL_LEVEL_RANKS.get(level, -1)
        if rank >= peak_rank:
            peak_rank = rank
            peak_level = level
        else:
            # Level is lower than peak — clamp to peak (ignore downward noise)
            person.call_levels[month] = peak_level  # type: ignore[assignment]


def build_promotions(person: PersonAnalysis, months: list[str]) -> None:
    previous_level: str | None = None
    for month in months:
        level = person.call_levels.get(month)
        if level is None:
            continue
        if previous_level is not None and level != previous_level:
            # Only record upward changes (monotonicity is already enforced, but be defensive)
            if CALL_LEVEL_RANKS.get(level, -1) > CALL_LEVEL_RANKS.get(previous_level, -1):
                person.promotions.append({"month": month, "from": previous_level, "to": level})
        previous_level = level


def analyze_dashboard(db: Session) -> dict[str, object]:
    periods = db.scalars(
        select(RotaPeriod)
        .where(RotaPeriod.status.in_(ANALYSIS_PERIOD_STATUSES))
        .order_by(RotaPeriod.starts_on)
    ).all()
    months = [month_key(period.starts_on) for period in periods]
    month_labels = {month: month_label(month) for month in months}
    month_stats: dict[str, dict[str, object]] = {
        month: {
            "total": 0,
            "total_24hr": 0,
            "weekend_24hr": 0,
            "persons": 0,
            "duty_type_counts": {},
        }
        for month in months
    }
    monthly_people: dict[str, set[str]] = {month: set() for month in months}
    people: dict[str, PersonAnalysis] = {}

    assignments = db.scalars(
        select(DutyAssignment).options(
            selectinload(DutyAssignment.person),
            selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.rota_period),
        )
    ).all()
    for assignment in assignments:
        slot = assignment.duty_slot
        if not is_analysis_period(slot.rota_period):
            continue
        month = month_key(slot.duty_date)
        if month not in month_stats:
            continue
        name = assignment.person.canonical_name
        person = people.setdefault(name, PersonAnalysis(name=name))
        person.monthly_24hr.setdefault(month, 0)
        person.fifth_call_monthly.setdefault(month, 0)
        person.months_active.add(month)
        monthly_people[month].add(name)

        duty_type = slot.duty_type
        stats = month_stats[month]
        stats["total"] = int(stats["total"]) + 1
        duty_type_counts = stats["duty_type_counts"]
        assert isinstance(duty_type_counts, dict)
        duty_type_counts[duty_type] = duty_type_counts.get(duty_type, 0) + 1

        # Accumulate inferred call levels by duty type — stored separately so postings can override.
        # Among multiple inferred levels in the same month keep the highest-ranked one.
        inferred_level = DUTY_TYPE_CALL_LEVEL.get(duty_type)
        if inferred_level is not None:
            existing = person.inferred_call_levels.get(month)  # type: ignore[attr-defined]
            if existing is None or CALL_LEVEL_RANKS.get(inferred_level, -1) > CALL_LEVEL_RANKS.get(existing, -1):
                person.inferred_call_levels[month] = inferred_level  # type: ignore[attr-defined]

        category = duty_category_key(duty_type)
        if category is not None:
            setattr(person, category, getattr(person, category) + 1)

        weekday = slot.duty_date.strftime("%A")
        is_weekend = weekday in {"Saturday", "Sunday"}
        if duty_type == "FIFTH_CALL":
            person.fifth_call_monthly[month] = person.fifth_call_monthly.get(month, 0) + 1
            person.fifth_call_days[weekday] += 1
            if is_weekend:
                person.fifth_call_weekend += 1

        if counts_in_24hr_total(duty_type, slot.is_24hr):
            person.total_24hr += 1
            person.monthly_24hr[month] = person.monthly_24hr.get(month, 0) + 1
            person.day_breakdown[weekday] += 1
            stats["total_24hr"] = int(stats["total_24hr"]) + 1
            if is_weekend:
                person.total_weekend_24hr += 1
                stats["weekend_24hr"] = int(stats["weekend_24hr"]) + 1
            else:
                person.total_weekday_24hr += 1

    for month, names in monthly_people.items():
        month_stats[month]["persons"] = len(names)

    postings = db.scalars(
        select(PersonPosting).options(
            selectinload(PersonPosting.person),
            selectinload(PersonPosting.unit),
        )
    ).all()
    for posting in postings:
        month = month_key(posting.starts_on)
        if month not in month_stats:
            continue
        name = posting.person.canonical_name
        person = people.setdefault(name, PersonAnalysis(name=name))
        person.months_active.add(month)
        if posting.unit is not None:
            person.units[month] = posting.unit.name
        level = call_level_from_posting(posting.posting_type)
        if level is not None:
            person.call_levels[month] = level
        bucket = posting_bucket(posting.posting_type)
        if bucket is not None:
            getattr(person, bucket).add(month)

    for person in people.values():
        # Fill call levels for months with no posting record using duty-type inference
        for month, inferred in person.inferred_call_levels.items():
            if month not in person.call_levels:
                person.call_levels[month] = inferred
        # Enforce monotonic progression — call levels only go up, never down
        enforce_monotonic_call_levels(person, months)
        for month in months:
            person.monthly_24hr.setdefault(month, 0)
            person.fifth_call_monthly.setdefault(month, 0)
        build_promotions(person, months)

    person_rows = []
    for person in sorted(people.values(), key=lambda item: item.name.casefold()):
        person_rows.append(
            {
                "name": person.name,
                "total_24hr": person.total_24hr,
                "total_weekend_24hr": person.total_weekend_24hr,
                "total_weekday_24hr": person.total_weekday_24hr,
                "main_24hr": person.main_24hr,
                "cb_24hr": person.cb_24hr,
                "rc_24hr": person.rc_24hr,
                "schell": person.schell,
                "floating": person.floating,
                "fifth_call": person.fifth_call,
                "fifth_call_weekend": person.fifth_call_weekend,
                "caesar_b": person.caesar_b,
                "cart": person.cart,
                "caesar_a": person.caesar_a,
                "pac": person.pac,
                "shift": person.shift,
                "rc12hr": person.rc12hr,
                "cb_co12hr": person.cb_co12hr,
                "chad": person.chad,
                "ruhsa": person.ruhsa,
                "neuro_dept": person.neuro_dept,
                "day_breakdown": person.day_breakdown,
                "monthly_24hr": person.monthly_24hr,
                "fifth_call_monthly": person.fifth_call_monthly,
                "fifth_call_days": person.fifth_call_days,
                "pain_months": sorted(person.pain_months, key=months.index),
                "sicu_months": sorted(person.sicu_months, key=months.index),
                "drp_months": sorted(person.drp_months, key=months.index),
                "neuro_icu_months": sorted(person.neuro_icu_months, key=months.index),
                "call_levels": person.call_levels,
                "units": person.units,
                "promotions": person.promotions,
                "months_active": sorted(person.months_active, key=months.index),
            }
        )

    total_records = sum(int(stats["total"]) for stats in month_stats.values())
    total_24hr = sum(int(stats["total_24hr"]) for stats in month_stats.values())
    total_weekend = sum(int(stats["weekend_24hr"]) for stats in month_stats.values())
    active_people = sum(1 for person in person_rows if person["total_24hr"])
    duty_category_totals = Counter()
    for person in person_rows:
        for key in (
            "main_24hr",
            "cb_24hr",
            "rc_24hr",
            "schell",
            "floating",
            "fifth_call",
            "cart",
            "pac",
            "shift",
            "caesar_a",
            "caesar_b",
            "rc12hr",
            "cb_co12hr",
            "chad",
            "ruhsa",
            "neuro_dept",
        ):
            duty_category_totals[key] += int(person[key])

    return {
        "summary": {
            "personnel": len(person_rows),
            "active_personnel": active_people,
            "total_records": total_records,
            "total_24hr": total_24hr,
            "total_weekend_24hr": total_weekend,
            "weekend_percent": round((total_weekend / total_24hr) * 100, 1)
            if total_24hr
            else 0,
            "months": len(months),
            "avg_24hr_per_active_person": round(total_24hr / active_people, 1)
            if active_people
            else 0,
        },
        "months": months,
        "month_labels": month_labels,
        "month_stats": month_stats,
        "days": DAYS,
        "duty_category_totals": dict(duty_category_totals),
        "people": person_rows,
    }


def analyze_preflight(db: Session) -> dict[str, object]:
    periods = db.scalars(
        select(RotaPeriod)
        .where(RotaPeriod.status.in_(ANALYSIS_PERIOD_STATUSES))
        .order_by(RotaPeriod.starts_on)
    ).all()
    period_ids = {period.id for period in periods}
    period_names = [period.name for period in periods]

    invalid = invalid_members(db)
    duplicate_groups = duplicate_candidates(db)
    unresolved_mappings = db.scalars(
        select(AdminMapping)
        .where(AdminMapping.mapping_type == "duty_label")
        .where((AdminMapping.target_key.is_(None)) | (AdminMapping.status == "needs_review"))
        .order_by(AdminMapping.source_label)
    ).all()

    slots = db.scalars(
        select(DutySlot)
        .options(selectinload(DutySlot.rota_period))
        .where(DutySlot.rota_period_id.in_(period_ids) if period_ids else False)
    ).all()
    unknown_duty_types = sorted({slot.duty_type for slot in slots if slot.duty_type not in KNOWN_DUTY_TYPES})
    empty_periods = []
    for period in periods:
        has_assignment = db.scalar(
            select(DutyAssignment.id)
            .join(DutySlot)
            .where(DutySlot.rota_period_id == period.id)
            .limit(1)
        )
        if has_assignment is None:
            empty_periods.append(period.name)

    issues = []
    if invalid:
        issues.append("Invalid member names exist.")
    if duplicate_groups:
        issues.append("Possible duplicate member groups need review.")
    if unresolved_mappings:
        issues.append("Unresolved duty mappings exist.")
    if unknown_duty_types:
        issues.append("Unknown duty types exist in analysis periods.")
    if empty_periods:
        issues.append("Some included analysis periods have no assignments.")

    safe_to_publish = not (invalid or duplicate_groups or unresolved_mappings or unknown_duty_types)
    return {
        "safe_to_publish": safe_to_publish,
        "status": "ready" if safe_to_publish else "needs_review",
        "issues": issues,
        "included_periods": period_names,
        "counts": {
            "analysis_periods": len(periods),
            "invalid_members": len(invalid),
            "duplicate_groups": len(duplicate_groups),
            "unresolved_duty_mappings": len(unresolved_mappings),
            "unknown_duty_types": len(unknown_duty_types),
            "empty_periods": len(empty_periods),
        },
        "examples": {
            "invalid_members": [person.canonical_name for person in invalid[:20]],
            "duplicate_groups": [
                {
                    "key": candidate.normalized_name,
                    "names": [person.canonical_name for person in candidate.people],
                }
                for candidate in duplicate_groups[:10]
            ],
            "unresolved_duty_mappings": [mapping.source_label for mapping in unresolved_mappings[:20]],
            "unknown_duty_types": unknown_duty_types[:20],
            "empty_periods": empty_periods[:20],
        },
    }


def analysis_manual_review(limit: int = 300) -> dict[str, object]:
    skipped_path = ANALYSIS_REBUILD_DIR / "skipped_names_latest.csv"
    if not skipped_path.exists():
        skipped_path = ANALYSIS_REBUILD_DIR / "skipped_names.csv"
    warnings_path = ANALYSIS_REBUILD_DIR / "parser_warnings.csv"
    comparison_path = ANALYSIS_REBUILD_DIR / "reference_month_comparison.csv"

    skipped_rows: list[dict[str, str]] = []
    skipped_counter: Counter[tuple[str, str, str]] = Counter()
    status_counter: Counter[str] = Counter()
    if skipped_path.exists():
        with skipped_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                cleaned = row.get("cleaned_person_name", "")
                status = row.get("status", "")
                reason = row.get("reason", "")
                skipped_counter[(cleaned, status, reason)] += 1
                status_counter[status] += 1
                if len(skipped_rows) < limit:
                    skipped_rows.append(row)

    warning_counter: Counter[str] = Counter()
    warning_rows: list[dict[str, str]] = []
    if warnings_path.exists():
        with warnings_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                code = row.get("code", "")
                warning_counter[code] += 1
                if code == "UNMAPPED_DUTY_LABEL" and len(warning_rows) < 100:
                    warning_rows.append(row)

    comparison_rows: list[dict[str, str]] = []
    comparison_totals: Counter[str] = Counter()
    if comparison_path.exists():
        with comparison_path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                comparison_rows.append(row)
                comparison_totals["dry_run_24hr"] += int(row.get("dry_run_24hr") or 0)
                comparison_totals["reference_24hr"] += int(row.get("reference_24hr") or 0)
                comparison_totals["dry_run_weekend_24hr"] += int(row.get("dry_run_weekend_24hr") or 0)
                comparison_totals["reference_weekend_24hr"] += int(row.get("reference_weekend_24hr") or 0)

    top_skipped = [
        {
            "cleaned_person_name": name,
            "status": status,
            "reason": reason,
            "count": count,
        }
        for (name, status, reason), count in skipped_counter.most_common(100)
    ]
    return {
        "summary": {
            "skipped_names": sum(skipped_counter.values()),
            "unique_skipped_names": len(skipped_counter),
            "parser_warnings": sum(warning_counter.values()),
            "unmapped_duty_warnings": warning_counter["UNMAPPED_DUTY_LABEL"],
            "status_counts": dict(status_counter),
            "warning_counts": dict(warning_counter),
            "current_main_24hr": comparison_totals["dry_run_24hr"],
            "reference_main_24hr": comparison_totals["reference_24hr"],
            "main_24hr_gap": comparison_totals["dry_run_24hr"] - comparison_totals["reference_24hr"],
            "current_weekend_24hr": comparison_totals["dry_run_weekend_24hr"],
            "reference_weekend_24hr": comparison_totals["reference_weekend_24hr"],
            "weekend_24hr_gap": comparison_totals["dry_run_weekend_24hr"]
            - comparison_totals["reference_weekend_24hr"],
        },
        "files": {
            "skipped_names": str(skipped_path),
            "parser_warnings": str(warnings_path),
        },
        "top_skipped_names": top_skipped,
        "sample_rows": skipped_rows,
        "unmapped_duty_rows": warning_rows,
        "reference_comparison": comparison_rows,
    }
