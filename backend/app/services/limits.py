"""Limits: the superadmin-only settings that decide how far the rota may load a member or a unit
(docs/limits_callevel_fairness_contract.md section 3).

The five *limit sections* (``rota_rules.LIMIT_SECTIONS``) stay inside the Rota Rules JSON and
are versioned with it (``RotaRuleVersion``), but only this module may change them:
``rota_rules_admin.save_rules_with_history`` keeps the stored values unless it is called with
``allow_limit_changes=True``, and the Rota Rules PUT refuses a payload that carries different
values (``locked_limit_changes``).

``FIELDS`` is the single plain-language description of every limit; the Limits page and the
docs both read it from ``GET /v1/admin/limits``. ``hard_or_soft`` says how each limit is
enforced (checked against rota_assignment / rota_safety / rota_template / rota_auto_fill /
extra_duty on 22 Oct 2026):

- ``hard``: never broken by any path (rest after a 24-hour duty is a ``blocked`` issue).
- ``soft``: automatic generation respects it, but a board member can go past it with an
  override reason, and the extra-duty layer may go past it to cover an empty duty; every
  breach is reported (individual monthly limits, unit staffing minimum / hard block).
- ``guide``: a warning threshold, target or preference; it never stops a duty being filled.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RotaRuleVersion
from app.services.member_profiles import local_today
from app.services.rota_rules import (
    LIMIT_SECTIONS,
    DutyCountLimits,
    ExtraDutyRules,
    FairnessRules,
    RestRules,
    RotaPhaseOneRules,
    RotaRulesInvalid,
    UnitStaffingRules,
    get_phase_one_rules,
)

log = logging.getLogger(__name__)

SECTION_MODELS: dict[str, type[BaseModel]] = {
    "duty_count_limits": DutyCountLimits,
    "rest_rules": RestRules,
    "unit_staffing_rules": UnitStaffingRules,
    "fairness_rules": FairnessRules,
    "extra_duty_rules": ExtraDutyRules,
}
assert tuple(SECTION_MODELS) == LIMIT_SECTIONS

CHANGED_NOTE = "Limits changed"
RESTORED_NOTE = "Limits restored"
NOTE_JOIN = ". Note: "
MAX_NOTE_LENGTH = 500
MAX_HISTORY = 100
MAX_NAMES = 10
READ_ROLES = {"superadmin", "computer_admin", "rota_board_member"}
LIMITS_PAGE = "Limits"

HARD_OR_SOFT_LABELS = {
    "hard": "Hard rule: never broken",
    "soft": "Can be exceeded, with a reason, and is reported",
    "guide": "Guide only: warns or steers, never stops a duty",
}

SECTIONS: list[dict[str, str]] = [
    {
        "key": "duty_count_limits",
        "title": "Per member each month",
        "intro": "How many duties of each kind one member should get in a calendar month. Every unit and "
                 "campus is counted together. Leave a box blank for no limit.",
    },
    {
        "key": "rest_rules",
        "title": "Rest after a 24-hour duty",
        "intro": "Protected time off after a 24-hour duty. The rest rule is never broken by any part of the rota.",
    },
    {
        "key": "unit_staffing_rules",
        "title": "Unit staffing",
        "intro": "How many members a unit must keep free for its normal work before its duties are flagged or held.",
    },
    {
        "key": "fairness_rules",
        "title": "Equal duties within a call level",
        "intro": "Members of the same call level should end the month with almost the same number of duties, "
                 "whatever campus they work at.",
    },
    {
        "key": "extra_duty_rules",
        "title": "Extra duties (justice)",
        "intro": "When the extra-duty step must ask someone to do more, it first asks whoever has done the "
                 "fewest extra duties recently.",
    },
]

_SOFT_MONTHLY = (
    "Automatic filling will not give a member a duty that takes them past this number. A rota board member "
    "can still go past it on purpose by writing a reason, and the extra-duty step may go past it when the only "
    "other choice is leaving a duty empty. Anyone over the limit is listed on the Publish screen and in the "
    "audit report."
)

FIELDS: list[dict[str, Any]] = [
    {
        "path": "duty_count_limits.max_24hr_per_month",
        "label": "Max 24-hour duties per member per month",
        "help": "The most 24-hour duties one member should get in a calendar month, counting all units and "
                "campuses together. " + _SOFT_MONTHLY,
        "example": "Set to 6: a member who already has 6 twenty-four-hour duties in June is not offered a 7th "
                   "by automatic filling. If the board gives them a 7th anyway, it needs a reason and the member "
                   "shows as over the limit.",
        "kind": "int", "min": 0, "max": 31, "unit": "duties", "blank_means": "No limit", "hard_or_soft": "soft",
    },
    {
        "path": "duty_count_limits.max_weekend_24hr_per_month",
        "label": "Max weekend 24-hour duties per member per month",
        "help": "The most 24-hour duties on a Saturday or Sunday that one member should get in a month, all "
                "units together. These also count towards the 24-hour limit above. " + _SOFT_MONTHLY,
        "example": "Set to 2: a member who has 24-hour duties on two Saturdays in June is not given a Sunday "
                   "24-hour duty that month by automatic filling.",
        "kind": "int", "min": 0, "max": 10, "unit": "duties", "blank_means": "No limit", "hard_or_soft": "soft",
    },
    {
        "path": "duty_count_limits.max_same_group_per_month",
        "label": "Max duties of one duty family per member per month",
        "help": "Every duty belongs to a family set in Rota Rules (for example Main, CB, RC or PAC). This is the "
                "most duties of one family a member should get in a month, so nobody does only one kind of work. "
                "Duties of every length count, not only 24-hour duties. " + _SOFT_MONTHLY,
        "example": "Set to 4: a member who already has 4 Main duties in June (say two Main 3rd Call and two Main "
                   "Co-3rd Call) can still get a CB or RC duty, but not a 5th Main duty.",
        "kind": "int", "min": 0, "max": 62, "unit": "duties", "blank_means": "No limit", "hard_or_soft": "soft",
    },
    {
        "path": "duty_count_limits.max_same_campus_per_month",
        "label": "Max duties at one campus per member per month",
        "help": "The most duties one member should do at the same campus in a month. The campus is the campus of "
                "the unit the duty belongs to. Use it to share work between campuses. " + _SOFT_MONTHLY,
        "example": "Set to 5: a member with 5 duties at one campus in June can still be placed at another campus, "
                   "but not a 6th time at the same campus.",
        "kind": "int", "min": 0, "max": 62, "unit": "duties", "blank_means": "No limit", "hard_or_soft": "soft",
    },
    {
        "path": "rest_rules.minimum_gap_after_24hr_hours",
        "label": "Rest after a 24-hour duty",
        "help": "The fewest hours a member must have off after a 24-hour duty ends before any other duty starts. "
                "This is a hard rule: automatic filling, the extra-duty step, manual assignment and superadmin "
                "allocation all refuse a duty that would cut the rest short. It also works the other way: a "
                "24-hour duty cannot be given if it would end too close to a duty the member already has.",
        "example": "Set to 24: after a 24-hour duty from Monday 8 am to Tuesday 8 am, the member's next duty can "
                   "start on Wednesday at 8 am at the earliest.",
        "kind": "hours", "min": 0, "max": 168, "unit": "hours", "blank_means": None, "hard_or_soft": "hard",
    },
    {
        "path": "rest_rules.post_24hr_blocks_next_day_elective",
        "label": "No elective work the day after a 24-hour duty (policy record)",
        "help": "Records the department policy that a member gets no elective (daytime) work on the day after a "
                "24-hour duty. The rota does not read this switch today: the day-after block is set for each duty "
                "in Rota Rules (\"Blocks elective next day\"), and every 24-hour duty already has it. Changing "
                "this switch does not change any rota.",
        "example": "On: matches the Rota Rules setting, so a member who finishes a 24-hour duty on Tuesday "
                   "morning is not given elective work on Tuesday.",
        "kind": "bool", "min": None, "max": None, "unit": None, "blank_means": None, "hard_or_soft": "guide",
    },
    {
        "path": "unit_staffing_rules.minimum_available_count",
        "label": "Members a unit must keep free (default)",
        "help": "How many eligible members of a unit must still be free (not on leave, not resting after a "
                "24-hour duty, not already on duty) after a duty is given out, so the unit can still do its normal "
                "work. Each unit usually has its own number in Unit management, also per call level; this default "
                "is used only where a unit or duty has no number of its own, and only while \"Always keep the "
                "minimum free\" is on. A duty that would leave fewer free is held: template generation avoids it "
                "and marks it for review, auto-fill leaves it open, a board member can still fill it with a "
                "reason, and the extra-duty step may fill it with a member from another unit.",
        "example": "Set to 1: in a unit of 6 eligible members where 5 are on leave or resting, giving the last "
                   "one a duty would leave nobody free, so the duty is held for the board to decide.",
        "kind": "int", "min": 0, "max": 50, "unit": "members", "blank_means": None, "hard_or_soft": "soft",
    },
    {
        "path": "unit_staffing_rules.warning_unavailable_percent",
        "label": "Warn when this share of a unit is unavailable",
        "help": "When this share (or more) of a unit's eligible members is unavailable on a day, because of leave, "
                "rest after a 24-hour duty or another duty, that day's duties in the unit are flagged \"needs "
                "review\". It is a warning, not a stop: template generation still fills the duty and marks it, "
                "auto-fill leaves it for a person to decide, and a board member who places someone gives a reason. "
                "It must be lower than the hard-block share below.",
        "example": "Set to 30%: in a unit of 10 eligible members, a day with 3 of them unavailable gets a "
                   "\"needs review\" flag.",
        "kind": "percent", "min": 0, "max": 100, "unit": "%", "blank_means": None, "hard_or_soft": "guide",
    },
    {
        "path": "unit_staffing_rules.hard_block_unavailable_percent",
        "label": "Hold duties when this share of a unit is unavailable",
        "help": "When this share (or more) of a unit's eligible members would be unavailable on a day, that day's "
                "duties in the unit are held (hard blocked) to protect the unit's normal work. Template generation "
                "avoids them and, if it has no other choice, marks them for review; auto-fill leaves them open; a "
                "board member can still fill one with a reason; and the extra-duty step may fill it with a member "
                "from another unit. It must be higher than the warning share above.",
        "example": "With 30% warning and 40% hold, in a unit of 10 eligible members: 3 unavailable gives a "
                   "warning, 4 unavailable holds the duty.",
        "kind": "percent", "min": 0, "max": 100, "unit": "%", "blank_means": None, "hard_or_soft": "soft",
    },
    {
        "path": "unit_staffing_rules.small_unit_uses_absolute_minimum",
        "label": "Always keep the minimum free",
        "help": "When on, a unit never drops below its minimum number of free members (the unit's own number in "
                "Unit management, or the default above), even when the percentages would allow it. This matters "
                "most in small units, where one person is a large share. When off, only the two percentages are "
                "checked.",
        "example": "On: a unit whose minimum is 2 keeps 2 members free whatever the percentages say. Off: the "
                   "same unit can drop to 1 free as long as the share unavailable stays below the hold share.",
        "kind": "bool", "min": None, "max": None, "unit": None, "blank_means": None, "hard_or_soft": "soft",
    },
    {
        "path": "fairness_rules.max_gap_within_call_level",
        "label": "Allowed difference in duties within a call level",
        "help": "Within each call level, every member's total duties for the month (all campuses together) "
                "should be almost the same. This is the largest difference allowed between the member with the "
                "most duties and the member with the fewest. The rota aims for it; when leave or rest make it "
                "impossible, the Publish screen shows a warning for that call level, but publishing is not "
                "stopped. Duties added by the extra-duty step or by a superadmin are shown separately when they "
                "cause the difference.",
        "example": "Set to 1: 3rd call has 130 duties and 40 members, so the target is 3.25 (3 or 4 each). "
                   "Totals of 3 and 4 are fine; a member with 2 while another has 4 (a difference of 2) is flagged.",
        "kind": "int", "min": 0, "max": 10, "unit": "duties", "blank_means": None, "hard_or_soft": "guide",
    },
    {
        "path": "fairness_rules.target_mode",
        "label": "How the target is worked out",
        "help": "Each call level's target is its duties in the month divided by its members available that "
                "month. \"Automatic\" is the only choice for now; the targets table shows the numbers for the "
                "chosen month.",
        "example": "Automatic: 4th call with 62 duties and 20 members has a target of 3.1 duties each.",
        "kind": "choice", "min": None, "max": None, "unit": None, "blank_means": None, "hard_or_soft": "guide",
        "options": [{"value": "auto", "label": "Automatic (duties divided by members)"}],
    },
    {
        "path": "extra_duty_rules.justice_lookback_months",
        "label": "Months of extra-duty history to count",
        "help": "When the extra-duty step must give someone an extra duty, it first asks the members who have done "
                "the fewest extra duties recently. This sets how far back \"recently\" goes. A longer period "
                "remembers older extra duties; a shorter one lets them drop off sooner. It changes who is asked "
                "first, never whether a duty can be filled.",
        "example": "Set to 12: when choosing for June 2026, an extra duty done in July 2025 still counts, but one "
                   "done in May 2025 no longer does.",
        "kind": "int", "min": 1, "max": 36, "unit": "months", "blank_means": None, "hard_or_soft": "guide",
    },
]
for _field in FIELDS:
    _field["section"] = _field["path"].split(".", 1)[0]
FIELDS_BY_PATH = {field["path"]: field for field in FIELDS}


class LimitsError(Exception):
    """An API-facing failure: ``code`` and ``status`` map straight onto the HTTP response."""

    def __init__(self, code: str, message: str, status: int, **extra: Any):
        self.code, self.message, self.status, self.extra = code, message, status, extra
        super().__init__(message)

    def detail(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.extra}


# --------------------------------------------------------------------------- sections


def current_limits(rules: RotaPhaseOneRules) -> dict[str, dict[str, Any]]:
    return {section: getattr(rules, section).model_dump(mode="json") for section in LIMIT_SECTIONS}


def default_limits() -> dict[str, dict[str, Any]]:
    return {section: model().model_dump(mode="json") for section, model in SECTION_MODELS.items()}


def stored_limits(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """The limit sections of a stored rules JSON (an old version without a section gets its
    defaults; a section that no longer validates is kept as stored, over the defaults)."""
    payload = payload or {}
    result = {}
    for section, model in SECTION_MODELS.items():
        raw = payload.get(section)
        raw = raw if isinstance(raw, dict) else {}
        try:
            result[section] = model.model_validate(raw).model_dump(mode="json")
        except ValueError:
            result[section] = {**model().model_dump(mode="json"), **raw}
    return result


def locked_limit_changes(stored: RotaPhaseOneRules, incoming: BaseModel) -> list[str]:
    """Paths of limit fields that a Rota Rules payload *sent* with a value different from the
    stored one. Sections or fields the payload left out are not changes."""
    paths: list[str] = []
    for section in LIMIT_SECTIONS:
        if section not in incoming.model_fields_set:
            continue
        sent, have = getattr(incoming, section), getattr(stored, section)
        for name in type(sent).model_fields:
            if name in sent.model_fields_set and getattr(sent, name) != getattr(have, name):
                paths.append(f"{section}.{name}")
    return paths


def limits_locked_detail(paths: list[str]) -> dict[str, Any]:
    labels = [FIELDS_BY_PATH[path]["label"] if path in FIELDS_BY_PATH else path for path in paths]
    return {
        "code": "limits_superadmin_only",
        "message": "Limits can only be changed by a superadmin on the Limits page. Nothing was saved; "
                   "save again without changing: " + ", ".join(labels) + ".",
        "page": LIMITS_PAGE,
        "api": "/api/v1/admin/limits",
        "paths": paths,
    }


# --------------------------------------------------------------------------- validation


def _problem(path: str, severity: str, message: str) -> dict[str, str]:
    return {"path": path, "severity": severity, "message": message}


def _check_value(field: dict[str, Any], value: Any) -> tuple[Any, str | None]:
    """``(clean value, error message or None)`` for one field."""
    label, kind = field["label"], field["kind"]
    if kind == "bool":
        return (value, None) if isinstance(value, bool) else (value, f"{label}: choose on or off.")
    if kind == "choice":
        options = [option["value"] for option in field.get("options", [])]
        if value in options:
            return value, None
        return value, f"{label}: choose one of the listed options."
    if value is None or (isinstance(value, str) and not value.strip()):
        if field["blank_means"] is not None:
            return None, None
        return value, f"{label}: enter a number."
    if isinstance(value, bool):
        return value, f"{label}: enter a whole number."
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        value = int(value)
    if not isinstance(value, int):
        return value, f"{label}: enter a whole number."
    unit = "%" if kind == "percent" else f" {field['unit']}" if field["unit"] else ""
    if value < field["min"] or value > field["max"]:
        return value, f"{label}: must be from {field['min']} to {field['max']}{unit} (got {value})."
    return value, None


def validate_limits(
    raw: Any, base: dict[str, dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    """Merge ``raw`` (sections / fields left out keep ``base``) and list every problem.

    Errors make the limits unsavable (422 ``invalid_limits``); warnings are advice only."""
    merged = {section: dict(values) for section, values in base.items()}
    problems: list[dict[str, str]] = []
    if not isinstance(raw, dict):
        return merged, [_problem("limits", "error", "Limits must be an object with the limit sections.")]
    for section, values in raw.items():
        if section not in SECTION_MODELS:
            problems.append(_problem(section, "error", f"Unknown limit section: {section}."))
            continue
        if not isinstance(values, dict):
            problems.append(_problem(section, "error", f"{section} must be an object."))
            continue
        for name, value in values.items():
            path = f"{section}.{name}"
            field = FIELDS_BY_PATH.get(path)
            if field is None:
                problems.append(_problem(path, "error", f"Unknown limit: {path}."))
                continue
            clean, error = _check_value(field, value)
            if error:
                problems.append(_problem(path, "error", error))
            else:
                merged[section][name] = clean
    if any(p["severity"] == "error" for p in problems):
        return merged, problems

    staffing = merged["unit_staffing_rules"]
    warning, hard = staffing["warning_unavailable_percent"], staffing["hard_block_unavailable_percent"]
    if warning >= hard:
        problems.append(_problem(
            "unit_staffing_rules.warning_unavailable_percent", "error",
            f"The warning share ({warning}%) must be below the hold share ({hard}%); otherwise duties are held "
            "before any warning is shown.",
        ))
    counts = merged["duty_count_limits"]
    if counts["max_24hr_per_month"] == 0:
        problems.append(_problem(
            "duty_count_limits.max_24hr_per_month", "warning",
            "0 means no member may be given any 24-hour duty without an override; leave it blank for no limit.",
        ))
    if (
        counts["max_24hr_per_month"] is not None
        and counts["max_weekend_24hr_per_month"] is not None
        and counts["max_weekend_24hr_per_month"] > counts["max_24hr_per_month"]
    ):
        problems.append(_problem(
            "duty_count_limits.max_weekend_24hr_per_month", "warning",
            f"The weekend limit ({counts['max_weekend_24hr_per_month']}) is above the overall 24-hour limit "
            f"({counts['max_24hr_per_month']}), so it never comes into play.",
        ))
    for name in ("max_same_group_per_month", "max_same_campus_per_month", "max_weekend_24hr_per_month"):
        if counts[name] == 0:
            problems.append(_problem(
                f"duty_count_limits.{name}", "warning",
                f"0 means nobody may get any such duty without an override ({FIELDS_BY_PATH['duty_count_limits.' + name]['label']}); "
                "leave it blank for no limit.",
            ))
    if merged["rest_rules"]["minimum_gap_after_24hr_hours"] < 24:
        problems.append(_problem(
            "rest_rules.minimum_gap_after_24hr_hours", "warning",
            f"Less than 24 hours of rest ({merged['rest_rules']['minimum_gap_after_24hr_hours']} hours) after a "
            "24-hour duty is unusual; check this is intended.",
        ))
    if merged["fairness_rules"]["max_gap_within_call_level"] == 0:
        problems.append(_problem(
            "fairness_rules.max_gap_within_call_level", "warning",
            "0 asks for exactly equal totals, which is only possible when the duties divide evenly; most months "
            "will show a warning.",
        ))
    return merged, problems


# --------------------------------------------------------------------------- change sentences


def format_value(field: dict[str, Any] | None, value: Any) -> str:
    if field is None:
        return "blank" if value is None else str(value)
    if value is None:
        return (field["blank_means"] or "blank").lower()
    kind = field["kind"]
    if kind == "bool":
        return "on" if value else "off"
    if kind == "choice":
        return next((o["label"] for o in field.get("options", []) if o["value"] == value), str(value))
    if kind == "percent":
        return f"{value}%"
    if kind == "hours":
        return f"{value} hour" if value == 1 else f"{value} hours"
    unit = field.get("unit") or ""
    if unit and unit != "%":
        if value == 1:
            unit = "person" if unit == "people" else unit[:-3] + "y" if unit.endswith("ies") else unit.rstrip("s")
        return f"{value} {unit}"
    return str(value)


def change_list(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """``[{path, label, before, after, sentence}]`` in ``FIELDS`` order."""
    changes = []
    for field in FIELDS:
        section, name = field["path"].split(".", 1)
        old, new = before.get(section, {}).get(name), after.get(section, {}).get(name)
        if old == new:
            continue
        changes.append({
            "path": field["path"],
            "label": field["label"],
            "before": old,
            "after": new,
            "sentence": f"{field['label']}: {format_value(field, old)} → {format_value(field, new)}",
        })
    return changes


# --------------------------------------------------------------------------- versions


def _versions(db: Session, newest_first: bool = False) -> list[RotaRuleVersion]:
    order = RotaRuleVersion.saved_at.desc() if newest_first else RotaRuleVersion.saved_at.asc()
    return list(db.scalars(select(RotaRuleVersion).order_by(order, RotaRuleVersion.id)))


def latest_version(db: Session) -> RotaRuleVersion | None:
    return db.scalar(select(RotaRuleVersion).order_by(RotaRuleVersion.saved_at.desc()).limit(1))


def _split_note(note: str | None) -> tuple[str, str | None]:
    """``(label, user note)`` of a stored version note."""
    if note and (note.startswith(CHANGED_NOTE) or note.startswith(RESTORED_NOTE)):
        head, _sep, rest = note.partition(NOTE_JOIN)
        label = CHANGED_NOTE if head.startswith(CHANGED_NOTE) else head
        return label, (rest or None)
    return "Rota Rules saved", note


def _limit_versions(db: Session) -> list[tuple[RotaRuleVersion, list[dict[str, Any]]]]:
    """Versions whose limit sections differ from the version before, newest first."""
    rows = []
    previous = None
    for version in _versions(db):
        limits = stored_limits(version.rules)
        if previous is not None:
            changes = change_list(previous, limits)
            if changes:
                rows.append((version, changes))
        previous = limits
    rows.reverse()
    return rows


def _uuid(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _check_base(db: Session, base_version_id: Any, current: dict[str, dict[str, Any]]) -> None:
    """409 ``stale_limits`` unless ``base_version_id`` is the latest version, or an older one
    whose limits equal the current limits (only duties changed since)."""
    latest = latest_version(db)
    latest_id = str(latest.id) if latest is not None else None
    if base_version_id in (None, "") and latest is None:
        return
    if latest is not None and str(base_version_id) == latest_id:
        return
    base_id = _uuid(base_version_id)
    base = db.get(RotaRuleVersion, base_id) if base_id is not None else None
    if base is not None and stored_limits(base.rules) == current:
        return
    raise LimitsError(
        "stale_limits",
        "Someone else changed the limits after you opened this page. Reload to see their changes, then "
        "make yours again.",
        409,
        current_version_id=latest_id,
    )


def _user_name(user: Any) -> str | None:
    return getattr(user, "display_name", None) or getattr(user, "username", None)


def _clean_note(note: Any) -> str | None:
    if note is None:
        return None
    text = str(note).strip()
    if len(text) > MAX_NOTE_LENGTH:
        raise LimitsError("invalid_limits", f"The note is too long (at most {MAX_NOTE_LENGTH} characters).", 422,
                          problems=[_problem("note", "error", "The note is too long.")])
    return text or None


# --------------------------------------------------------------------------- read


def check_month(month: str | None) -> str:
    if month in (None, ""):
        return local_today().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", str(month)):
        raise LimitsError("invalid_month", "month must be YYYY-MM", 400)
    return str(month)


def _targets(db: Session, month: str, rules: RotaPhaseOneRules) -> list[dict[str, Any]]:
    """Agent 2's ``fairness_targets.call_level_targets``; ``[]`` while it is missing or fails."""
    try:
        from app.services.fairness_targets import call_level_targets
    except ImportError:
        return []
    try:
        return list(call_level_targets(db, month, rules))
    except Exception:  # noqa: BLE001 - the targets table must never break the Limits page
        log.exception("call_level_targets failed for %s", month)
        db.rollback()
        return []


def limits_state(db: Session, month: str | None, user: Any) -> dict[str, Any]:
    """The ``GET /v1/admin/limits`` shape."""
    month = check_month(month)
    _version, rules = get_phase_one_rules(db)
    latest = latest_version(db)
    changed = _limit_versions(db)
    last_change = changed[0][0] if changed else None
    return {
        "version_id": str(latest.id) if latest is not None else None,
        "saved_at": last_change.saved_at.isoformat() if last_change is not None else None,
        "saved_by": last_change.saved_by_name if last_change is not None else None,
        "limits_version_id": str(last_change.id) if last_change is not None else None,
        "month": month,
        "limits": current_limits(rules),
        "defaults": default_limits(),
        "sections": SECTIONS,
        "fields": FIELDS,
        "hard_or_soft_labels": HARD_OR_SOFT_LABELS,
        "targets": _targets(db, month, rules),
        "can_edit": getattr(user, "role", None) == "superadmin",
    }


def _month_label(month: str) -> str:
    return datetime.strptime(month, "%Y-%m").strftime("%b %Y")


def _candidate_rules(rules: RotaPhaseOneRules, limits: dict[str, dict[str, Any]]) -> RotaPhaseOneRules:
    candidate = rules.model_copy()
    for section, model in SECTION_MODELS.items():
        setattr(candidate, section, model.model_validate(limits[section]))
    return candidate


def preview_limits(db: Session, raw: Any, month: str | None) -> dict[str, Any]:
    """``POST /v1/admin/limits/preview``: change sentences, problems and the month's impact
    (``individual_limit_breaches`` with the candidate limits). Never saves."""
    from app.services.extra_duty import individual_limit_breaches

    month = check_month(month)
    _version, rules = get_phase_one_rules(db)
    before = current_limits(rules)
    merged, problems = validate_limits(raw, before)
    changes = change_list(before, merged)
    impact = None
    if not any(p["severity"] == "error" for p in problems):
        after_rows = individual_limit_breaches(db, month, rules=_candidate_rules(rules, merged))
        now_rows = individual_limit_breaches(db, month, rules=rules)
        now_ids = {row["person_id"] for row in now_rows}
        count = len(after_rows)
        impact = {
            "month": month,
            "over_limit_people": count,
            "over_limit_people_now": len(now_rows),
            "newly_over": sum(1 for row in after_rows if row["person_id"] not in now_ids),
            "members_over": [row["person_name"] for row in after_rows[:MAX_NAMES]],
            "people": after_rows[:MAX_NAMES],
            "sentence": (
                f"With these limits, {count} member{'' if count == 1 else 's'} in {_month_label(month)} "
                f"would be over a limit (now {len(now_rows)})."
            ),
        }
    return {"month": month, "changes": changes, "problems": problems, "impact": impact}


def limits_history(db: Session) -> list[dict[str, Any]]:
    """Versions that changed a limit, newest first: ``[{version_id, saved_at, saved_by, label,
    note, changes}]``."""
    rows = []
    for version, changes in _limit_versions(db)[:MAX_HISTORY]:
        label, note = _split_note(version.note)
        rows.append({
            "version_id": str(version.id),
            "saved_at": version.saved_at.isoformat(),
            "saved_by": version.saved_by_name,
            "label": label,
            "note": note,
            "changes": changes,
        })
    return rows


# --------------------------------------------------------------------------- write


def _save(
    db: Session,
    rules: RotaPhaseOneRules,
    merged: dict[str, dict[str, Any]],
    *,
    user: Any,
    note_text: str,
    action: str,
    details: dict[str, Any],
) -> None:
    from app.services.reference_registry import audit
    from app.services.rota_rules_admin import save_rules_with_history

    for section, model in SECTION_MODELS.items():
        setattr(rules, section, model.model_validate(merged[section]))
    try:
        save_rules_with_history(db, rules, user=user, note=note_text, allow_limit_changes=True)
    except RotaRulesInvalid as exc:
        db.rollback()
        raise LimitsError(
            "invalid_rules",
            "The saved Rota Rules have problems that must be fixed in Rota Rules before limits can be saved.",
            422,
            problems=[
                {"path": p.get("field") or "rules", "severity": p["severity"], "message": p["message"]}
                for p in exc.problems
            ],
        ) from exc
    saved = latest_version(db)
    if getattr(user, "id", None) is not None:
        audit(db, user, action, saved.id if saved is not None else None, details)
        db.commit()


def save_limits(db: Session, raw: Any, base_version_id: Any, note: Any, user: Any) -> None:
    """``PUT /v1/admin/limits``: stale check, validation, then one new rules version labelled
    "Limits changed" plus an audit entry. Raises ``LimitsError``."""
    note = _clean_note(note)
    _version, rules = get_phase_one_rules(db)
    before = current_limits(rules)
    _check_base(db, base_version_id, before)
    merged, problems = validate_limits(raw, before)
    errors = [p for p in problems if p["severity"] == "error"]
    if errors:
        raise LimitsError("invalid_limits", f"{len(errors)} problem(s) must be fixed before saving.", 422,
                          problems=problems)
    changes = change_list(before, merged)
    if not changes:
        raise LimitsError("no_limit_changes", "Nothing to save: these are already the current limits.", 422)
    _save(db, rules, merged, user=user, note_text=CHANGED_NOTE + (NOTE_JOIN + note if note else ""),
          action="limits_changed", details={"changes": changes, "note": note})


def restore_limits(db: Session, version_id: Any, note: Any, user: Any, base_version_id: Any = None) -> None:
    """``POST /v1/admin/limits/restore``: copy only the limit sections of ``version_id`` onto
    the current rules, as a new version. Raises ``LimitsError``."""
    note = _clean_note(note)
    vid = _uuid(version_id)
    version = db.get(RotaRuleVersion, vid) if vid is not None else None
    if version is None:
        raise LimitsError("version_not_found", "That saved version no longer exists.", 404)
    _version, rules = get_phase_one_rules(db)
    before = current_limits(rules)
    if base_version_id not in (None, ""):
        _check_base(db, base_version_id, before)
    merged, problems = validate_limits(stored_limits(version.rules), before)
    errors = [p for p in problems if p["severity"] == "error"]
    if errors:
        raise LimitsError("invalid_limits", "The limits in that version are no longer valid and cannot be "
                          "restored.", 422, problems=problems)
    changes = change_list(before, merged)
    if not changes:
        raise LimitsError("no_limit_changes", "Nothing to restore: that version has the current limits.", 422)
    when = version.saved_at.strftime("%d %b %Y %H:%M")
    head = f"{RESTORED_NOTE} from the version saved {when}"
    _save(db, rules, merged, user=user, note_text=head + (NOTE_JOIN + note if note else ""),
          action="limits_restored",
          details={"changes": changes, "note": note, "restored_version_id": str(version.id)})
