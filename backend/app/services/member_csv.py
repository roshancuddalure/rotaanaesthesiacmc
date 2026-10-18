"""Preview department lists without writes to members; apply a frozen batch atomically."""

import csv
import io
from collections import Counter
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MemberImportPreview, Person, PersonDesignation, UserAccount
from app.services.member_profile import (
    ensure_unique_name, record_activity, revision, snapshot, validate_designations, validate_identity,
)

HEADERS = ["member_id", "canonical_name", "active_status", "call_level", "designation",
           "designation_effective_from"]
HEADER_ALIASES = {
    "name": "canonical_name", "doctor_name": "canonical_name", "member_name": "canonical_name",
    "position": "designation", "status": "active_status", "id": "member_id",
    "effective_from": "designation_effective_from",
}


def name_key(value: str) -> str:
    return " ".join(value.casefold().split())


def parse_file(content: bytes, mapping: dict[str, str] | None = None) -> tuple[list[str], list[dict]]:
    if mapping is not None and not isinstance(mapping, dict):
        raise ValueError("Column mapping must be an object")
    if mapping and any(not isinstance(value, str) for value in mapping.values()):
        raise ValueError("Column mapping values must be field names")
    if len(content) > 2 * 1024 * 1024:
        raise ValueError("CSV must be 2 MB or smaller")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Save the spreadsheet as CSV UTF-8 and upload it again") from exc
    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        records = [row for row in reader if any(cell.strip() for cell in row)]
    except csv.Error as exc:
        raise ValueError(f"CSV formatting error: {exc}") from exc
    if not records:
        raise ValueError("The file is empty")
    raw_headers = records[0]
    if len(set(name_key(h) for h in raw_headers)) != len(raw_headers):
        raise ValueError("Column headings must be unique")
    normalized = [h.strip().lower().replace(" ", "_") for h in raw_headers]
    headers = [(mapping or {}).get(raw, HEADER_ALIASES.get(norm, norm))
               for raw, norm in zip(raw_headers, normalized)]
    # A plain one-name-per-line list is accepted with or without a heading.
    data = records[1:]
    if len(raw_headers) == 1 and headers[0] not in HEADERS and not mapping:
        headers = ["canonical_name"]
        data = records
    if "canonical_name" not in headers:
        raise ValueError("Map a column to canonical_name (member name)")
    mapped = [h for h in headers if h in HEADERS]
    if len(set(mapped)) != len(mapped):
        raise ValueError("Each member field can only be mapped once")
    if len(data) > 5000:
        raise ValueError("Import at most 5,000 members at a time")
    rows = []
    for index, values in enumerate(data, 1 if data is records else 2):
        rows.append({"row_number": index,
                     "values": {h: v.strip() for h, v in zip(headers, values) if h in HEADERS},
                     "parse_error": "Column count does not match headings" if len(values) != len(headers) else None})
    if not rows:
        raise ValueError("Add at least one member below the headings")
    return raw_headers, rows


def build_preview(db: Session, rows: list[dict], mode: str) -> list[dict]:
    if mode not in {"create_only", "update_existing"}:
        raise ValueError("Choose create_only or update_existing")
    people = list(db.scalars(select(Person).options(
        selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))))
    by_id = {str(p.id): p for p in people}
    names: dict[str, list[Person]] = {}
    for person in people:
        for label in {person.canonical_name, *(a.alias for a in person.aliases)}:
            key = name_key(label)
            if person not in names.setdefault(key, []):
                names[key].append(person)
    counts = Counter(name_key(r["values"].get("canonical_name", "")) for r in rows)
    result = []
    used_ids: set[str] = set()
    for row in rows:
        values = row["values"]
        name = values.get("canonical_name", "")
        key = name_key(name)
        errors = [row["parse_error"]] if row.get("parse_error") else []
        matches = names.get(key, [])
        person = None
        if values.get("member_id"):
            try:
                person = by_id.get(str(UUID(values["member_id"])))
                if not person:
                    errors.append("Member ID was not found")
            except ValueError:
                errors.append("Member ID is not a valid UUID")
        elif len(matches) == 1:
            person = matches[0]
        elif len(matches) > 1:
            errors.append("Ambiguous name or alias; supply the member ID")
        if counts[key] > 1:
            errors.append("Repeated member name in this file; keep one row per member")
        if person:
            if str(person.id) in used_ids:
                errors.append("Another row targets this member; keep one row per member")
            used_ids.add(str(person.id))
        status = values.get("active_status") or (person.active_status if person else "active")
        call_level = None if values.get("call_level") == "__CLEAR__" else values.get("call_level") or (person.call_level if person else None)
        try:
            name = validate_identity(name, status, call_level)
            ensure_unique_name(db, name, person)
            if values.get("designation"):
                start = date.fromisoformat(values.get("designation_effective_from", ""))
                proposed = [{"designation": d.designation, "effective_from": d.effective_from,
                             "effective_to": d.effective_to} for d in person.designations] if person else []
                identical = any(d["designation"] == values["designation"] and d["effective_from"] == start for d in proposed)
                if not identical:
                    validate_designations([*proposed, {"designation": values["designation"], "effective_from": start}])
            elif values.get("designation_effective_from"):
                errors.append("A designation is required with its effective date")
        except (ValueError, HTTPException) as exc:
            errors.append(str(exc.detail) if isinstance(exc, HTTPException) else str(exc))
        before = {"canonical_name": person.canonical_name, "active_status": person.active_status,
                  "call_level": person.call_level} if person else None
        after = {"canonical_name": name, "active_status": status, "call_level": call_level}
        designation_change = None
        if values.get("designation"):
            designation_change = {
                "before": [{"designation": d.designation, "effective_from": str(d.effective_from),
                            "effective_to": str(d.effective_to) if d.effective_to else None}
                           for d in person.designations] if person else [],
                "add": {"designation": values["designation"],
                        "effective_from": values.get("designation_effective_from")},
            }
        action = "update" if person else "create"
        suggestions = []
        if mode == "create_only" and person:
            errors.append(f"Member already exists as {person.active_status}; use update-existing mode")
        if mode == "update_existing" and not person:
            errors.append("No existing member matched; use create-only mode for new members")
        if person and person.active_status != "active" and status == "active":
            errors.append("Reactivate this member explicitly in their profile before importing")
        if not person and not errors and values.get("_confirm_distinct") != "yes":
            suggestions = [{"id": str(p.id), "name": p.canonical_name} for p in people
                           if SequenceMatcher(None, key, name_key(p.canonical_name)).ratio() >= .85][:5]
        if person and before == after and not values.get("designation"):
            action = "unchanged"
        result.append({**row, "action": "invalid" if errors else "needs_review" if suggestions else action,
                       "errors": errors, "suggestions": suggestions, "before": before, "after": after,
                       "designation_change": designation_change,
                       "person_id": str(person.id) if person else None,
                       "revision": revision(person) if person else None})
    return result


def apply_preview(db: Session, preview: MemberImportPreview, operator: UserAccount,
                  excluded: list[int]) -> dict:
    if preview.operator_id != operator.id:
        raise HTTPException(403, "This preview belongs to another operator")
    if preview.result is not None:
        return preview.result
    if preview.created_at < datetime.utcnow() - timedelta(hours=2):
        raise HTTPException(409, "Preview expired; preview the file again")
    selected = [r for r in preview.rows if r["row_number"] not in excluded]
    if not selected:
        raise HTTPException(422, "Select at least one row")
    if any(r["action"] in {"invalid", "needs_review"} for r in selected):
        raise HTTPException(422, "Correct or exclude all invalid and review rows before applying")
    # Lock existing identities in deterministic order before checking the frozen revisions.
    ids = sorted({UUID(r["person_id"]) for r in selected if r["person_id"]})
    if ids:
        list(db.scalars(select(Person).where(Person.id.in_(ids)).order_by(Person.id).with_for_update()))
    fresh = build_preview(db, selected, preview.mode)
    for old, new in zip(selected, fresh):
        if old["revision"] != new["revision"] or old["action"] != new["action"] or old["after"] != new["after"]:
            raise HTTPException(409, "Members changed since preview; review the file again")
    result = {"batch_id": str(preview.id), "created": 0, "updated": 0, "unchanged": 0,
              "excluded": len(preview.rows) - len(selected), "members": []}
    for row in selected:
        if row["action"] == "unchanged":
            result["unchanged"] += 1
            continue
        person = db.get(Person, UUID(row["person_id"])) if row["person_id"] else Person(**row["after"])
        before = snapshot(person) if row["person_id"] else None
        if not row["person_id"]:
            db.add(person)
        else:
            old_name = person.canonical_name
            for field, value in row["after"].items():
                setattr(person, field, value)
            if old_name != person.canonical_name:
                from app.models import PersonAlias
                if not any(a.alias.casefold() == old_name.casefold() for a in person.aliases):
                    person.aliases.append(PersonAlias(alias=old_name, source="member_csv_rename"))
        person.archived_at = (person.archived_at or datetime.utcnow()) if person.active_status == "archived" else None
        values = row["values"]
        if values.get("designation"):
            start = date.fromisoformat(values["designation_effective_from"])
            if not any(d.designation == values["designation"] and d.effective_from == start for d in person.designations):
                person.designations.append(PersonDesignation(designation=values["designation"],
                    effective_from=start, source="member_csv"))
        record_activity(db, person, operator, "csv_import", before, str(preview.id))
        result["created" if row["action"] == "create" else "updated"] += 1
        result["members"].append({"id": str(person.id), "canonical_name": person.canonical_name})
    preview.result = result
    db.commit()
    return result
