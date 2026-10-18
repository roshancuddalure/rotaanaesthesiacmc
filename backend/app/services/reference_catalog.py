"""Canonical reference labels and aliases with explicit operational semantics."""

import re
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AdminMapping,
    DutySlot,
    LeaveRequest,
    PersonDesignation,
    PersonPosting,
    ReferenceValue,
    Unit,
)
from app.services.normalization import label_key
from app.services.reference_registry import audit, lock_namespace

KINDS = {
    "campus",
    "designation",
    "leave_type",
    "leave_slot",
    "leave_status",
    "posting_type",
    "duty_type",
}
DEFAULTS = {
    "leave_type": {
        "ANNUAL_LEAVE": ["Annual leave", "AL", "EL", "Earned leave"],
        "ACADEMIC_LEAVE": ["Academic leave"],
        "CASUAL_LEAVE": ["Casual leave", "CL"],
        "SICK_LEAVE": ["Sick leave", "SL"],
        "MEDICAL_LEAVE": ["Medical leave", "ML"],
        "MATERNITY_LEAVE": ["Maternity leave"],
        "PATERNITY_LEAVE": ["Paternity leave"],
        "CHILD_CARE_LEAVE": ["Child care leave", "CCL"],
        "LOSS_OF_PAY": ["Loss of pay", "LOP"],
        "LEAVE_WITHOUT_PAY": ["Leave without pay", "LWP"],
        "ON_DUTY": ["On duty", "OD"],
        "CONFERENCE": ["Conference"],
        "EXAM": ["Exam"],
        "OTHER": ["Other"],
        "OFF": ["Off"],
        "LEAVE": ["Leave", "LV"],
    },
    "leave_slot": {
        "FULL_DAY": ["Full day", "Full", "FD", "Whole day"],
        "AM": ["Morning", "AM", "FN", "Forenoon"],
        "PM": ["Afternoon", "PM", "AN"],
        "NIGHT": ["Night"],
        "CUSTOM": ["Custom"],
    },
    "leave_status": {
        "approved": ["Approved", "Sanctioned", "Approve"],
        "requested": ["Requested", "Pending", "Request"],
        "imported_pending_review": ["Imported pending review"],
        "rejected": ["Rejected"],
        "cancelled": ["Cancelled", "Canceled"],
    },
    "posting_type": {
        "1ST_CALL": ["1st Call", "First call"],
        "CO_1ST_CALL": ["Co 1st Call"],
        "2ND_CALL": ["2nd Call", "Second call"],
        "3RD_CALL": ["3rd Call", "Third call"],
        "CO_4TH_CALL": ["Co 4th Call", "Co fourth call"],
        "4TH_CALL": ["4th Call", "Fourth call"],
        "5TH_CALL": ["5th Call", "Fifth call"],
        "PAIN": ["Pain"],
        "SICU": ["SICU"],
        "DRP": ["DRP"],
        "NEURO_ICU": ["Neuro ICU"],
        "PAC": ["PAC"],
    },
}


def reference_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")[:100]


def base_behavior(kind: str, key: str) -> dict:
    if kind == "leave_status":
        return {
            "maps_to": key,
            "availability": "block"
            if key == "approved"
            else "warn"
            if key in {"requested", "imported_pending_review"}
            else "none",
        }
    if kind == "posting_type":
        return {"maps_to": key, "requires_unit": key not in {"PAIN", "SICU", "DRP"}}
    return {}


def catalog(db: Session, kind: str) -> list[dict]:
    if kind not in KINDS:
        raise HTTPException(404, "Unknown reference category")
    items = {
        key: {
            "kind": kind,
            "key": key,
            "label": labels[0],
            "aliases": labels[1:],
            "active": True,
            "version": 0,
            "behavior": base_behavior(kind, key),
        }
        for key, labels in DEFAULTS.get(kind, {}).items()
    }
    if kind == "duty_type":
        from app.services.rota_rules import default_phase_one_rules

        for rule in default_phase_one_rules().duty_rules:
            items[rule.key] = {
                "kind": kind,
                "key": rule.key,
                "label": rule.label,
                "aliases": [],
                "active": rule.active,
                "version": 0,
                "behavior": rule.model_dump(mode="json"),
            }
    if kind in {"campus", "designation"}:
        column = Unit.campus if kind == "campus" else PersonDesignation.designation
        for label in db.scalars(select(column).where(column.is_not(None)).distinct()):
            key = reference_key(label)
            if key:
                items[key] = {
                    "kind": kind,
                    "key": key,
                    "label": label,
                    "aliases": [],
                    "active": True,
                    "version": 0,
                    "behavior": {},
                }
    persisted = list(db.scalars(select(ReferenceValue).where(ReferenceValue.kind == kind)))
    # A renamed label may still occur on historical rows; its alias must not appear
    # as another editable reference entry.
    for value in persisted:
        for alias in value.aliases:
            old_key = reference_key(alias)
            if old_key != value.key:
                items.pop(old_key, None)
        items[value.key] = {
            "kind": kind,
            "key": value.key,
            "label": value.label,
            "aliases": value.aliases,
            "active": value.active,
            "version": value.version,
            "behavior": value.behavior,
        }
    return sorted(items.values(), key=lambda item: item["label"].casefold())


def resolve_value(db: Session, kind: str, raw: str) -> tuple[str, str]:
    key = label_key(raw)
    matches = [
        item
        for item in catalog(db, kind)
        if key and key in {label_key(v) for v in [item["key"], item["label"], *item["aliases"]]}
    ]
    if len(matches) != 1:
        raise ValueError(
            f'Unknown or ambiguous {kind.replace("_", " ")}: "{raw}"; select or add an approved reference'
        )
    item = matches[0]
    if not item["active"]:
        raise ValueError(f"{item['label']} is archived; choose an active reference")
    return str(item["behavior"].get("maps_to") or item["key"]), "Approved reference label or alias"


def reference_usage(db: Session, kind: str, item: dict) -> dict:
    keys = {label_key(v) for v in [item["key"], item["label"], *item["aliases"]]}
    column = {
        "campus": Unit.campus,
        "designation": PersonDesignation.designation,
        "leave_type": LeaveRequest.leave_type,
        "leave_status": LeaveRequest.status,
        "leave_slot": LeaveRequest.leave_slot,
        "posting_type": PersonPosting.posting_type,
        "duty_type": DutySlot.duty_type,
    }[kind]
    used = sum(label_key(v or "") in keys for v in db.scalars(select(column)))
    return {"records": used}


def save_reference(db: Session, operator, kind: str, key: str, values: dict) -> dict:
    lock_namespace(db, "reference:" + kind)
    items = catalog(db, kind)
    previous = next((i for i in items if i["key"] == key), None)
    if previous and values.get("version") != previous["version"]:
        raise HTTPException(409, "This reference changed; reload before saving")
    if not re.fullmatch(r"[A-Za-z0-9_]{1,100}", key):
        raise HTTPException(422, "Reference key must use letters, digits and underscores")
    label = str(values["label"]).strip()
    if not label or len(label) > 255:
        raise HTTPException(422, "Enter a reference label (maximum 255 characters)")
    aliases = {str(a).strip() for a in values.get("aliases", []) if str(a).strip()}
    if previous and previous["label"] != label:
        aliases.add(previous["label"])
    claims = {label_key(v) for v in [key, label, *aliases]}
    for item in items:
        if item["key"] != key and claims.intersection(
            label_key(v) for v in [item["key"], item["label"], *item["aliases"]]
        ):
            raise HTTPException(409, f"An equivalent label already belongs to {item['label']}")
    behavior = values.get("behavior") or (previous["behavior"] if previous else {})
    if kind == "duty_type":
        from app.services.rota_rules import DutyRule, VALID_CALL_LEVELS, VALID_DUTY_GROUPS

        try:
            rule = DutyRule.model_validate(
                {**behavior, "key": key, "label": label, "active": values.get("active", True)}
            )
        except ValueError as exc:
            raise HTTPException(
                422,
                "Set the duty duration, timing, group, eligibility, counting and validation rules",
            ) from exc
        if rule.duration_hours <= 0 or rule.group not in VALID_DUTY_GROUPS:
            raise HTTPException(422, "Choose a supported duty family and a duration above zero")
        if not rule.allowed_call_levels or set(rule.allowed_call_levels) - VALID_CALL_LEVELS:
            raise HTTPException(422, "Select at least one supported eligible call level")
        if rule.is_24hr != (rule.duration_hours == 24):
            raise HTTPException(422, "24-hour classification must agree with the duration")
        if rule.counts_in_main_24hr and not rule.is_24hr:
            raise HTTPException(422, "Only 24-hour duties can count as main 24-hour duties")
        from datetime import time

        try:
            start, end = time.fromisoformat(rule.start_time), time.fromisoformat(rule.end_time)
            minutes = ((end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)) % (24 * 60)
            if minutes != (rule.duration_hours * 60) % (24 * 60):
                raise ValueError("Duration and clock times disagree")
        except ValueError as exc:
            raise HTTPException(422, "Duty start/end times must agree with its duration") from exc
        behavior = rule.model_dump(mode="json")
    if kind == "leave_status":
        target = behavior.get("maps_to")
        if target not in DEFAULTS["leave_status"]:
            raise HTTPException(422, "Choose the supported approval state this label represents")
        if key in DEFAULTS["leave_status"] and target != key:
            raise HTTPException(
                422, "A built-in approval state cannot change meaning; add a separate label"
            )
        behavior = base_behavior(kind, target)
    if kind == "posting_type":
        target = behavior.get("maps_to")
        if target not in DEFAULTS["posting_type"]:
            raise HTTPException(
                422, "Choose a posting/call type with defined unit and eligibility behaviour"
            )
        behavior = base_behavior(kind, target)
    value = db.scalar(
        select(ReferenceValue).where(ReferenceValue.kind == kind, ReferenceValue.key == key)
    )
    if value is None:
        value = ReferenceValue(kind=kind, key=key)
        db.add(value)
    value.label, value.aliases, value.behavior = label, sorted(aliases), behavior
    value.active = values.get("active", True)
    value.version = (previous["version"] if previous else 0) + 1
    value.updated_at = datetime.utcnow()
    if kind == "duty_type":
        for alias in aliases:
            matches = list(
                db.scalars(select(AdminMapping).where(AdminMapping.mapping_type == "duty_label"))
            )
            existing = next(
                (m for m in matches if label_key(m.source_label) == label_key(alias)), None
            )
            if existing and existing.target_key != key:
                raise HTTPException(409, f'Duty alias "{alias}" already maps to another duty')
            if not existing:
                db.add(
                    AdminMapping(
                        mapping_type="duty_label",
                        source_label=alias,
                        target_key=key,
                        target_label=label,
                        status="reviewed",
                        source="reference_registry",
                    )
                )
    db.flush()
    after = {
        "kind": kind,
        "key": key,
        "label": label,
        "aliases": sorted(aliases),
        "active": value.active,
        "behavior": behavior,
        "version": value.version,
    }
    audit(
        db,
        operator,
        "reference_updated" if previous else "reference_created",
        value.id,
        {"before": previous, "after": after, "usage": reference_usage(db, kind, after)},
    )
    db.commit()
    return after
