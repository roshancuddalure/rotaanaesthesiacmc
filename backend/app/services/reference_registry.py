"""Validated unit lifecycle and reference-value ownership."""

import hashlib
import json
import re
from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import (
    AdminMapping,
    DutySlot,
    NormalizationEvent,
    PersonPosting,
    Unit,
    UnitCallMinimum,
    UserAccount,
)
from app.services.normalization import display_text, label_key, unit_key


def audit(
    db: Session, operator: UserAccount, action: str, identity: UUID | None, details: dict
) -> None:
    db.add(
        NormalizationEvent(
            operator_id=operator.id,
            operator_name=operator.display_name or operator.username,
            action=action,
            entity_id=identity,
            details=details,
        )
    )


def lock_namespace(db: Session, namespace: str) -> None:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('normalization-context'))"))
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:namespace))"), {"namespace": namespace}
        )


def suggested_unit_code(name: str, campus: str | None = None) -> str:
    return (
        re.sub(r"[^A-Z0-9]+", "_", f"{campus or ''} {unit_key(name)}".upper()).strip("_")[:50]
        or "UNIT"
    )


def unit_aliases(db: Session, unit: Unit) -> list[AdminMapping]:
    return list(
        db.scalars(
            select(AdminMapping).where(
                AdminMapping.mapping_type == "unit_label",
                AdminMapping.target_key.in_([str(unit.id), unit.code]),
                AdminMapping.status == "reviewed",
            )
        )
    )


def unit_snapshot(db: Session, unit: Unit) -> dict:
    return {
        "id": str(unit.id),
        "name": unit.name,
        "code": unit.code,
        "campus": unit.campus,
        "active_status": unit.active_status,
        "minimum_free_people": unit.minimum_free_people,
        "notes": unit.notes,
        "aliases": sorted(m.source_label for m in unit_aliases(db, unit)),
        "call_minimums": sorted((c.call_level, c.minimum_free_people) for c in unit.call_minimums),
    }


def unit_read(db: Session, unit: Unit, period: tuple[date, date] | None = None) -> dict:
    result = unit_snapshot(db, unit)
    result["revision"] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    today = date.today()
    start, end = period or (today, today)
    result["usage"] = {
        "selected_members": db.scalar(
            select(func.count(func.distinct(PersonPosting.person_id))).where(
                PersonPosting.unit_id == unit.id,
                PersonPosting.starts_on <= end,
                (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= start),
            )
        ),
        "postings": db.scalar(
            select(func.count()).select_from(PersonPosting).where(PersonPosting.unit_id == unit.id)
        ),
        "duties": db.scalar(
            select(func.count()).select_from(DutySlot).where(DutySlot.unit_id == unit.id)
        ),
        "future_postings": db.scalar(
            select(func.count())
            .select_from(PersonPosting)
            .where(
                PersonPosting.unit_id == unit.id,
                (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= today),
            )
        ),
        "future_duties": db.scalar(
            select(func.count())
            .select_from(DutySlot)
            .where(DutySlot.unit_id == unit.id, DutySlot.duty_date >= today)
        ),
    }
    return result


def save_unit(
    db: Session, operator: UserAccount, values: dict, identity: UUID | None = None
) -> dict:
    lock_namespace(db, "unit-registry")
    unit = (
        db.scalar(select(Unit).where(Unit.id == identity).with_for_update()) if identity else None
    )
    if identity and unit is None:
        raise HTTPException(404, "Unit not found")
    before = unit_read(db, unit) if unit else None
    if unit and values.get("revision") != before["revision"]:
        raise HTTPException(409, "This unit changed. Reload it before saving.")
    name = display_text(values["name"])
    campus = display_text(values.get("campus") or "") or None
    if campus and (not unit or campus != unit.campus):
        from app.services.reference_catalog import canonical_label

        campus = canonical_label(db, "campus", campus)
    code = (values.get("code") or suggested_unit_code(name, campus)).strip().upper()
    if not name or len(name) > 255:
        raise HTTPException(422, "Enter a unit name (maximum 255 characters)")
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9_\-]{0,49}", code):
        raise HTTPException(
            422, "Unit code must use letters, digits, underscores or hyphens (maximum 50)"
        )
    if len(campus or "") > 100:
        raise HTTPException(422, "Campus must be at most 100 characters")
    others = list(db.scalars(select(Unit)))
    for other in others:
        if unit and other.id == unit.id:
            continue
        if label_key(other.code) == label_key(code):
            raise HTTPException(
                409, f'Unit code already belongs to "{other.name}" ({other.active_status})'
            )
        if unit_key(other.name) == unit_key(name) and label_key(other.campus or "") == label_key(
            campus or ""
        ):
            raise HTTPException(
                409, "An equivalent unit already exists at this campus; select or restore it"
            )
        if unit_key(other.name) == unit_key(name) and not campus:
            raise HTTPException(
                409, "Specify a campus to distinguish this unit from an existing numbered unit"
            )
    aliases = {display_text(a) for a in values.get("aliases", []) if display_text(a)}
    # A rename retains the previous label as an explicit alias.
    if unit and (unit.name != name or unit.campus != campus):
        aliases.add(unit.name if not unit.campus else f"{unit.campus} {unit.name}")
    owned = unit_aliases(db, unit) if unit else []
    for alias in sorted(aliases):
        if len(alias) > 255:
            raise HTTPException(422, "Unit aliases must be at most 255 characters")
        for mapping in db.scalars(
            select(AdminMapping).where(AdminMapping.mapping_type == "unit_label")
        ):
            if unit_key(mapping.source_label) == unit_key(alias) and mapping not in owned:
                raise HTTPException(409, f'Unit alias "{alias}" is already mapped elsewhere')
        for other in others:
            if (not unit or other.id != unit.id) and unit_key(alias) in {
                unit_key(other.code),
                unit_key(f"{other.campus or ''} {other.name}"),
            }:
                raise HTTPException(409, f'Unit alias "{alias}" conflicts with another unit')
    if unit is None:
        unit = Unit()
        db.add(unit)
    unit.name, unit.code, unit.campus = name, code, campus
    unit.notes = values.get("notes") or None
    unit.active_status = values.get("active_status", "active")
    if unit.active_status not in {"active", "archived"}:
        raise HTTPException(422, "Choose Active or Archived")
    unit.minimum_free_people = values.get("minimum_free_people", 1)
    if unit.minimum_free_people < 0:
        raise HTTPException(422, "Minimum free people cannot be negative")
    if values.get("call_minimums") is not None:
        from app.services.rota_rules import VALID_CALL_LEVELS

        minimums = values["call_minimums"]
        if len({i["call_level"] for i in minimums}) != len(minimums):
            raise HTTPException(422, "Each call level can have one staffing minimum")
        if any(
            i["call_level"] not in VALID_CALL_LEVELS or i["minimum_free_people"] < 0
            for i in minimums
        ):
            raise HTTPException(422, "Choose supported call levels and nonnegative minimums")
        existing = {r.call_level: r for r in unit.call_minimums}
        for value in minimums:
            row = existing.pop(value["call_level"], None)
            if row is None:
                row = UnitCallMinimum(unit=unit, call_level=value["call_level"])
                db.add(row)
            row.minimum_free_people = value["minimum_free_people"]
        for row in existing.values():
            db.delete(row)
    db.flush()
    for mapping in owned:
        if mapping.source_label not in aliases:
            db.delete(mapping)
        else:
            mapping.target_key, mapping.target_label = str(unit.id), name
    existing = {m.source_label for m in owned}
    for alias in aliases - existing:
        db.add(
            AdminMapping(
                mapping_type="unit_label",
                source_label=alias,
                target_key=str(unit.id),
                target_label=name,
                status="reviewed",
                source="unit_registry",
            )
        )
    db.flush()
    db.expire(unit, ["call_minimums"])
    after = unit_read(db, unit)
    audit(
        db,
        operator,
        "unit_updated" if before else "unit_created",
        unit.id,
        {"before": before, "after": after},
    )
    db.commit()
    return unit_read(db, unit)
