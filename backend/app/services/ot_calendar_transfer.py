"""Reviewed portable monthly area replacements; canonical calendar remains authoritative."""

from collections import defaultdict
from datetime import date, datetime, time
import hashlib
import json
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from pydantic import Field, field_validator, model_validator
from sqlalchemy import select

from app.models import AdminMapping, OtCalendarVersion, Unit
from app.services import ot_calendar_store as store
from app.services.leave import date_range, month_bounds
from app.services.operational_import import resolve_unit
from app.services.ot_calendar import ImmutableInput, OtBand, OtDateException, WEEKDAYS, resolve_day
from app.services.reference_registry import lock_namespace
from app.services.rota_call_levels import normalize_call_level
from app.services.rota_compute import context_hash, lock_operational_inputs


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


class TransferBand(OtBand):
    @field_validator("call_levels", mode="before")
    @classmethod
    def calls(cls, value):
        return [normalize_call_level(v) for v in value] if isinstance(value, (list, tuple)) and all(isinstance(v, str) for v in value) else value


class AreaDay(ImmutableInput):
    day: date
    weekday: str
    area_key: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    state: Literal["open", "closed", "unknown"]
    bands: tuple[TransferBand, ...] = Field(default=(), max_length=32, strict=False)
    source_reference: str = Field(default="admin", min_length=1, max_length=255)

    @field_validator("day", mode="before")
    @classmethod
    def calendar_date(cls, value):
        if isinstance(value, str):
            return date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def valid_row(self):
        if self.weekday != WEEKDAYS[self.day.weekday()]:
            raise ValueError("Weekday must match the calendar date")
        if (self.state == "open") != bool(self.bands):
            raise ValueError("Open areas require bands; closed/unknown areas must have none")
        return self


class MonthDocument(ImmutableInput):
    format: Literal["duty-rota-ot-month-v1"]
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    unit_label: str = Field(min_length=1, max_length=255)
    reserve_mode: Literal["included", "additional"]
    qualification_bindings: tuple[store.QualificationBinding, ...] = Field(default=(), max_length=64, strict=False)
    rows: tuple[AreaDay, ...] = Field(default=(), max_length=2000, strict=False)

    @model_validator(mode="after")
    def bounds(self):
        first, last = month_bounds(self.month)
        if any(not first <= r.day <= last for r in self.rows):
            raise ValueError("Every date must belong to the declared month")
        if len({(r.day, r.area_key) for r in self.rows}) != len(self.rows):
            raise ValueError("Duplicate area/date rows require an explicit resolution")
        if sum(len(r.bands) for r in self.rows) > 4096:
            raise ValueError("Monthly transfer exceeds 4096 role bands")
        return self


class TransferRequest(ImmutableInput):
    filename: str = Field(min_length=1, max_length=120)
    base_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    document: MonthDocument


class ApplyTransfer(TransferRequest):
    review_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


def mapping_hash(db):
    return digest({"units": [dict(r) for r in db.execute(select(Unit.__table__).order_by(Unit.id)).mappings()],
        "unit_mappings": [dict(r) for r in db.execute(select(AdminMapping.__table__)
            .where(AdminMapping.mapping_type == "unit_label").order_by(AdminMapping.id)).mappings()]})


def bands_value(bands):
    values = [r.model_dump(mode="json", exclude={"id", "unit_id", "area_key", "band_key", "starts_at", "ends_at", "source_reference"}) for r in bands]
    for r in values:
        r["call_levels"].sort()
        r["required_skills"].sort()
    return sorted(values, key=lambda r: r["key"])


def plan(db, unit_id, payload):
    saved = store.current(db, unit_id)
    mapped = resolve_unit(db, payload.document.unit_label)
    if mapped["unit_id"] != str(unit_id):
        raise HTTPException(422, {"code": "ot_import_unit_unresolved", "mapping": mapped})
    old = store.CalendarConfiguration.model_validate(saved["configuration"]) if saved["configuration"] else None
    document = payload.document
    if old and (old.reserve_mode != document.reserve_mode or
                sorted((r.model_dump(mode="json") for r in old.qualification_bindings), key=lambda r: r["skill_key"]) !=
                sorted((r.model_dump(mode="json") for r in document.qualification_bindings), key=lambda r: r["skill_key"])):
        raise HTTPException(422, "Monthly import cannot change global reserve/qualification policy; review it in the calendar editor first")
    value = old.model_dump(mode="json") if old else {"reserve_mode": document.reserve_mode,
        "qualification_bindings": [r.model_dump(mode="json") for r in document.qualification_bindings], "weekly": [], "exceptions": []}
    exceptions = {(r["day"], r["area_key"]): r for r in value["exceptions"]}
    changes, unknown = [], []
    for row in document.rows:
        effective = resolve_day(old.weekly, old.exceptions, day=row.day, unit_id=unit_id) if old else {"requirements": [], "closed_areas": []}
        requirements = [r for r in effective["requirements"] if r.area_key == row.area_key]
        closed = row.area_key in effective["closed_areas"]
        if row.state == "unknown":
            if requirements or closed:
                raise HTTPException(422, "Unknown import rows cannot erase reviewed demand or closure")
            unknown.append({"day": str(row.day), "area_key": row.area_key})
            continue
        previous = []
        for r in requirements:
            midnight = datetime.combine(row.day, time.min)
            previous.append(OtBand(key=r.band_key, start_minute=int((r.starts_at-midnight).total_seconds()/60),
                end_minute=int((r.ends_at-midnight).total_seconds()/60), call_levels=r.call_levels,
                required_skills=r.required_skills, minimum=r.minimum, target=r.target))
        if (row.state == "closed" and closed) or (row.state == "open" and bands_value(previous) == bands_value(row.bands)):
            continue
        key = (str(row.day), row.area_key)
        identity = exceptions.get(key, {}).get("id") or str(uuid5(NAMESPACE_URL, f"ot-month:{unit_id}:{row.day}:{row.area_key}"))
        replacement = OtDateException(id=identity, unit_id=unit_id, day=row.day,
            area_key=row.area_key, closed=row.state == "closed", bands=row.bands, source_reference=row.source_reference)
        exceptions[key] = replacement.model_dump(mode="json")
        changes.append({"day": str(row.day), "area_key": row.area_key, "state": row.state,
                        "before": bands_value(previous), "after": bands_value(row.bands)})
    value["exceptions"] = list(exceptions.values())
    proposed = store.CalendarConfiguration.model_validate(value)
    store.validate_configuration(db, unit_id, proposed)
    return saved, store.canonical(proposed), changes, unknown


def preview(db, unit_id, payload, user):
    saved, proposed, changes, unknown = plan(db, unit_id, payload)
    if payload.base_revision != saved["revision"]:
        raise HTTPException(409, "Calendar changed; export or preview against the latest saved revision")
    source_hash = digest(payload.document.model_dump(mode="json"))
    review = digest({"source": source_hash, "filename": payload.filename, "unit": str(unit_id),
        "operator": str(user.id), "base": payload.base_revision, "proposed": proposed, "context": context_hash(db)})
    return {"unit_id": str(unit_id), "month": payload.document.month, "source_hash": source_hash,
        "mapping_hash": mapping_hash(db), "review_hash": review, "base_revision": saved["revision"],
        "changed": store.revision(proposed) != saved["revision"], "changes": changes,
        "unknown_rows": unknown, "proposed": proposed}


def apply(db, unit_id, payload, user):
    # Namespace before table locks follows the existing normalization writer order.
    lock_namespace(db, "ot-month-import")
    lock_operational_inputs(db)
    # Revalidate mapping/configuration even for an idempotent retry.
    saved, _, _, _ = plan(db, unit_id, payload)
    for version in db.scalars(select(OtCalendarVersion).where(OtCalendarVersion.unit_id == unit_id,
        OtCalendarVersion.saved_by_id == user.id).order_by(OtCalendarVersion.saved_at.desc()).limit(100)):
        try:
            audit = json.loads(version.note)
        except (ValueError, TypeError):
            continue
        if isinstance(audit, dict) and audit.get("kind") == "ot_month_import_v1" and audit.get("review_hash") == payload.review_hash:
            if audit.get("source_hash") != digest(payload.document.model_dump(mode="json")) or audit.get("filename") != payload.filename or audit.get("mapping_hash") != mapping_hash(db) or version.revision != saved["revision"]:
                raise HTTPException(409, "Imported file or current mapping/calendar changed after the reviewed application")
            return {"already_applied": True, "calendar": saved}
    reviewed = preview(db, unit_id, payload, user)
    if reviewed["review_hash"] != payload.review_hash:
        raise HTTPException(409, "Import context or mappings changed; preview the file again")
    note = json.dumps({"kind": "ot_month_import_v1", "filename": payload.filename,
        "source_hash": reviewed["source_hash"], "review_hash": payload.review_hash,
        "mapping_hash": reviewed["mapping_hash"], "month": payload.document.month}, ensure_ascii=False, separators=(",", ":"))
    result = store.save(db, unit_id, store.SaveCalendar(base_revision=payload.base_revision,
        configuration=store.CalendarConfiguration.model_validate(reviewed["proposed"]), note=note), user)
    return {"already_applied": False, "changed": reviewed["changed"], "calendar": result}


def export_month(db, unit_id, month):
    first, last = month_bounds(month)
    saved = store.current(db, unit_id)
    if saved["configuration"] is None:
        raise HTTPException(409, "Review and save this unit's reserve policy/calendar before exporting monthly demand")
    configuration = store.CalendarConfiguration.model_validate(saved["configuration"]) if saved["configuration"] else None
    unit = store.require_unit(db, unit_id)
    rows = []
    for day in date_range(first, last):
        effective = resolve_day(configuration.weekly, configuration.exceptions, day=day, unit_id=unit_id) if configuration else {"requirements": [], "closed_areas": [], "missing_areas": []}
        areas = defaultdict(list)
        sources = {r.area_key: r.source_reference for r in configuration.exceptions
                   if r.day == day and r.closed}
        for r in effective["requirements"]:
            sources[r.area_key] = r.source_reference
            midnight = datetime.combine(day, time.min)
            areas[r.area_key].append(OtBand(key=r.band_key, start_minute=int((r.starts_at-midnight).total_seconds()/60),
                end_minute=int((r.ends_at-midnight).total_seconds()/60), call_levels=r.call_levels,
                required_skills=r.required_skills, minimum=r.minimum, target=r.target).model_dump(mode="json"))
        for area in sorted(set(areas) | set(effective["closed_areas"]) | set(effective.get("missing_areas", ()))):
            rows.append({"day": str(day), "weekday": WEEKDAYS[day.weekday()], "area_key": area,
                "state": "open" if area in areas else "closed" if area in effective["closed_areas"] else "unknown", "bands": areas[area],
                "source_reference": sources.get(area, "admin")})
    return {"base_revision": saved["revision"], "document": {"format": "duty-rota-ot-month-v1",
        "month": month, "unit_label": unit.code, "reserve_mode": configuration.reserve_mode if configuration else "included",
        "qualification_bindings": [r.model_dump(mode="json") for r in configuration.qualification_bindings] if configuration else [], "rows": rows},
        "configured": configuration is not None,
        "scope_note": "Dated area replacements only. Omitted/unknown areas are not invented closures; global reserve/qualification changes require separate calendar review."}
