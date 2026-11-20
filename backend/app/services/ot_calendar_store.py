"""Revision-checked OT calendar administration; all saved changes are attributable."""

from datetime import datetime
import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import select

from app.models import CallCluster, OtCalendar, OtCalendarVersion, Unit
from app.services.ot_calendar import (
    ImmutableInput, OtDateException, WeeklyOtDemand, resolve_day, validate_calendar,
)
from app.services.reference_registry import lock_namespace


class QualificationBinding(ImmutableInput):
    skill_key: str = Field(min_length=1, max_length=80)
    group_keys: tuple[str, ...] = Field(min_length=1, max_length=64, strict=False)

    @model_validator(mode="after")
    def valid_keys(self):
        if not self.skill_key.strip() or len(set(self.group_keys)) != len(self.group_keys) \
                or any(not key.strip() or len(key) > 100 for key in self.group_keys):
            raise ValueError("Qualification bindings require distinct canonical group keys")
        return self


class CalendarConfiguration(ImmutableInput):
    schema_version: Literal[1] = 1
    # Deliberate administrator choice; neither reserve interpretation is invented.
    reserve_mode: Literal["included", "additional"]
    weekly: tuple[WeeklyOtDemand, ...] = Field(default=(), max_length=512, strict=False)
    exceptions: tuple[OtDateException, ...] = Field(default=(), max_length=2000, strict=False)
    qualification_bindings: tuple[QualificationBinding, ...] = Field(default=(), max_length=64, strict=False)

    @model_validator(mode="after")
    def consistent_calendar(self):
        validate_calendar(self.weekly, self.exceptions)
        if len({row.skill_key for row in self.qualification_bindings}) != len(self.qualification_bindings):
            raise ValueError("Each qualification skill may have only one reviewed binding")
        return self


class SaveCalendar(ImmutableInput):
    base_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    configuration: CalendarConfiguration
    note: str = Field(default="", max_length=1000)


def canonical(configuration):
    value = configuration.model_dump(mode="json")
    for name in ("weekly", "exceptions"):
        value[name].sort(key=lambda row: row["id"])
        for row in value[name]:
            row["bands"].sort(key=lambda band: band["key"])
            for band in row["bands"]:
                band["call_levels"].sort()
                band["required_skills"].sort()
    if value["qualification_bindings"]:
        value["qualification_bindings"].sort(key=lambda row: row["skill_key"])
        for row in value["qualification_bindings"]:
            row["group_keys"].sort()
    else:
        # Preserve old logical no-op hashes when no qualification binding is added.
        value.pop("qualification_bindings")
    return value


def revision(configuration):
    return hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


EMPTY_REVISION = revision(None)


def require_unit(db, unit_id):
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise HTTPException(404, "Unknown unit")
    return unit


def current(db, unit_id):
    unit = require_unit(db, unit_id)
    row = db.scalar(select(OtCalendar).where(OtCalendar.unit_id == unit_id))
    return {
        "unit_id": str(unit_id), "unit_name": unit.name,
        "revision": row.revision if row else EMPTY_REVISION,
        "configuration": row.configuration if row else None,
        "updated_at": row.updated_at.isoformat() + "Z" if row else None,
        "configured": row is not None,
    }


def validate_configuration(db, unit_id, configuration):
    if any(row.unit_id != unit_id for row in (*configuration.weekly, *configuration.exceptions)):
        raise HTTPException(422, "Every OT definition must belong to the selected unit")
    keys = {key for row in configuration.qualification_bindings for key in row.group_keys}
    groups = {group.key: group for group in db.scalars(select(CallCluster).where(CallCluster.key.in_(keys)))} if keys else {}
    invalid = sorted(key for key in keys if key not in groups or not groups[key].active)
    if invalid:
        raise HTTPException(422, {"code": "invalid_ot_qualification_groups",
                                  "message": "Qualification bindings must reference active, existing groups.",
                                  "group_keys": invalid})


def preview(db, unit_id, payload):
    saved = current(db, unit_id)
    if payload.base_revision != saved["revision"]:
        raise HTTPException(409, {"code": "stale_ot_calendar", "message": "OT calendar changed; compare the latest saved version.",
                                  "current_revision": saved["revision"]})
    validate_configuration(db, unit_id, payload.configuration)
    proposed = canonical(payload.configuration)
    return {"unit_id": str(unit_id), "base_revision": saved["revision"],
            "before": saved["configuration"], "proposed": proposed,
            "changed": revision(proposed) != saved["revision"]}


def save(db, unit_id, payload, operator):
    lock_namespace(db, f"ot-calendar:{unit_id}")
    require_unit(db, unit_id)
    validate_configuration(db, unit_id, payload.configuration)
    row = db.scalar(select(OtCalendar).where(OtCalendar.unit_id == unit_id).with_for_update())
    previous = row.revision if row else EMPTY_REVISION
    if payload.base_revision != previous:
        raise HTTPException(409, {"code": "stale_ot_calendar", "message": "OT calendar changed; reload before saving.",
                                  "current_revision": previous})
    value = canonical(payload.configuration)
    digest = revision(value)
    if digest == previous:
        return current(db, unit_id)
    if row is None:
        row = OtCalendar(unit_id=unit_id, revision=digest, configuration=value)
        db.add(row)
    else:
        row.revision, row.configuration = digest, value
    row.updated_at = datetime.utcnow()
    db.add(OtCalendarVersion(
        unit_id=unit_id, revision=digest, configuration=value,
        saved_by_id=operator.id, saved_by_name=operator.display_name or operator.username,
        note=payload.note,
    ))
    db.commit()
    return current(db, unit_id)


def versions(db, unit_id):
    require_unit(db, unit_id)
    return [{
        "id": str(row.id), "revision": row.revision, "saved_by": row.saved_by_name,
        "saved_at": row.saved_at.isoformat() + "Z", "note": row.note,
        "configuration": row.configuration,
    } for row in db.scalars(select(OtCalendarVersion).where(OtCalendarVersion.unit_id == unit_id)
                            .order_by(OtCalendarVersion.saved_at.desc(), OtCalendarVersion.id).limit(100))]


def resolved(db, unit_id: UUID, day):
    saved = current(db, unit_id)
    if saved["configuration"] is None:
        return {"unit_id": str(unit_id), "day": str(day), "revision": saved["revision"],
                "configured": False, "status": "not_evaluated", "requirements": [], "closed_areas": []}
    configuration = CalendarConfiguration.model_validate(saved["configuration"])
    result = resolve_day(configuration.weekly, configuration.exceptions, day=day, unit_id=unit_id)
    return {**result, "revision": saved["revision"], "reserve_mode": configuration.reserve_mode,
            "qualification_bindings": configuration.qualification_bindings}
