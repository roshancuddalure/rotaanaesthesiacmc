"""Preview department lists without writes to members; apply a frozen batch atomically."""

import csv
import io
from collections import Counter
from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MemberImportPreview, Person, PersonDesignation, UserAccount
from app.services.member_resolver import MemberIndex
from app.services.normalization import member_key
from app.services.member_profile import (
    ensure_unique_name, record_activity, revision, snapshot, validate_designations, validate_identity,
)
from app.services.member_profiles import call_level_on, local_today, record_call_change

# The uploaded file is the full current roster: create, update and list absentees.
ROSTER_SYNC = "roster_sync"

HEADERS = ["member_id", "canonical_name", "active_status", "call_level", "designation",
           "designation_effective_from"]
HEADER_ALIASES = {
    "name": "canonical_name", "doctor_name": "canonical_name", "member_name": "canonical_name",
    "position": "designation", "status": "active_status", "id": "member_id",
    "effective_from": "designation_effective_from",
}


def name_key(value: str) -> str:
    return member_key(value)


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


def current_designation(person: Person, today: date | None = None) -> PersonDesignation | None:
    today = today or local_today()
    return next((d for d in sorted(person.designations, key=lambda d: d.effective_from, reverse=True)
                 if d.effective_from <= today and (d.effective_to is None or d.effective_to >= today)), None)


def roster_missing(db: Session, rows: list[dict]) -> list[dict]:
    """Active members not matched by any row of a roster file."""
    present = {r["person_id"] for r in rows if r.get("person_id")}
    possible = {}
    for r in rows:
        for suggestion in r.get("suggestions", []):
            possible.setdefault(suggestion["id"], r["row_number"])
    people = db.scalars(select(Person).where(Person.active_status == "active").options(
        selectinload(Person.designations), selectinload(Person.call_changes),
        selectinload(Person.call_level_changes)).order_by(Person.canonical_name))
    missing = []
    for person in people:
        if str(person.id) in present:
            continue
        designation = current_designation(person)
        missing.append({"id": str(person.id), "canonical_name": person.canonical_name,
                        "call_level": call_level_on(person),
                        "designation": designation.designation if designation else None,
                        "possible_row": possible.get(str(person.id))})
    return missing


def build_preview(db: Session, rows: list[dict], mode: str) -> list[dict]:
    if mode not in {"create_only", "update_existing", ROSTER_SYNC}:
        raise ValueError("Choose create_only, update_existing or roster_sync")
    roster = mode == ROSTER_SYNC
    people = list(db.scalars(select(Person).options(
        selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))))
    by_id = {str(p.id): p for p in people}
    index = MemberIndex.load(db)
    counts = Counter(name_key(r["values"].get("canonical_name", "")) for r in rows)
    result = []
    used_ids: set[str] = set()
    for row in rows:
        values = row["values"]
        if values.get("designation"):
            from app.services.reference_catalog import canonical_label
            try:
                values = {**values, "designation":canonical_label(db,"designation",values["designation"])}
                row = {**row,"original_values":row.get("original_values",row["values"]),"values":values}
            except HTTPException:
                # Existing preview error handling reports archived/conflicting labels below.
                pass
        name = values.get("canonical_name", "")
        key = name_key(name)
        errors = [row["parse_error"]] if row.get("parse_error") else []
        # Exact name, approved alias or rule only; historical members can be updated, and a
        # match on an archived member is surfaced so the checks below can explain it.
        match = index.resolve(name, purpose="history")
        owner = by_id.get(match.person_id) if match.matched else None
        if (not owner and match.candidates and match.warnings
                and any("confirm before assigning" in w for w in match.warnings)):
            owner = by_id.get(match.candidates[0].person_id)
        person = None
        if values.get("member_id"):
            try:
                person = by_id.get(str(UUID(values["member_id"])))
                if not person:
                    errors.append("Member ID was not found")
            except ValueError:
                errors.append("Member ID is not a valid UUID")
        elif owner is not None:
            person = owner
        elif match.status in {"ambiguous", "needs_review"} and not match.only_similar:
            errors.append(f"'{name}' could be {', '.join(c.name for c in match.candidates[:3])}; supply the member ID")
        if counts[key] > 1:
            errors.append("Repeated member name in this file; keep one row per member")
        if person:
            if str(person.id) in used_ids:
                errors.append("Another row targets this member; keep one row per member")
            used_ids.add(str(person.id))
        status = values.get("active_status") or (person.active_status if person else "active")
        # Roster sync compares with the level in effect today, which call history can override.
        current_call = (call_level_on(person) if roster else person.call_level) if person else None
        call_level = None if values.get("call_level") == "__CLEAR__" else values.get("call_level") or current_call
        designation_pending = bool(values.get("designation"))
        try:
            name = validate_identity(name, status, call_level)
            ensure_unique_name(db, name, person)
            current = current_designation(person) if person else None
            if roster and current and values.get("designation") == current.designation:
                designation_pending = False
            if designation_pending:
                from app.services.reference_catalog import canonical_label
                canonical_label(db,"designation",values["designation"])
                if roster and not values.get("designation_effective_from"):
                    values = {**values, "designation_effective_from": local_today().isoformat()}
                    row = {**row, "original_values": row.get("original_values", row["values"]), "values": values}
                start = date.fromisoformat(values.get("designation_effective_from", ""))
                proposed = [{"designation": d.designation, "effective_from": d.effective_from,
                             "effective_to": d.effective_to} for d in person.designations] if person else []
                if roster:
                    # A new position ends the previous open one the day before it starts.
                    proposed = [{**d, "effective_to": start - timedelta(days=1)}
                                if d["effective_from"] < start and (d["effective_to"] is None or d["effective_to"] >= start)
                                else d for d in proposed]
                identical = any(d["designation"] == values["designation"] and d["effective_from"] == start for d in proposed)
                if not identical:
                    validate_designations([*proposed, {"designation": values["designation"], "effective_from": start}])
            elif values.get("designation_effective_from") and not values.get("designation"):
                errors.append("A designation is required with its effective date")
        except (ValueError, HTTPException) as exc:
            errors.append(str(exc.detail) if isinstance(exc, HTTPException) else str(exc))
        before = {"canonical_name": person.canonical_name, "active_status": person.active_status,
                  "call_level": current_call} if person else None
        after = {"canonical_name": name, "active_status": status, "call_level": call_level}
        designation_change = None
        if designation_pending:
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
        if roster and person and person.active_status != "active":
            if values.get("active_status") != "active":
                errors.append(f"Matched member is {person.active_status}; enter active in active_status "
                              "to restore them, or exclude the row")
        elif person and person.active_status != "active" and status == "active":
            errors.append("Reactivate this member explicitly in their profile before importing")
        if not person and not errors and values.get("_confirm_distinct") != "yes":
            today = date.today()
            # Duplicate prevention: a new member that resembles an existing one needs review;
            # the admin can still confirm it is a different person (_confirm_distinct).
            possible = [by_id[c.person_id] for c in index.near_duplicates(name) if c.person_id in by_id]
            suggestions = [{"id": str(p.id), "name": p.canonical_name, "status":p.active_status,
                            "call_level":p.call_level, "designation":next((d.designation for d in sorted(p.designations,key=lambda d:d.effective_from,reverse=True)
                                if d.effective_from<=today and (d.effective_to is None or d.effective_to>=today)),None),
                            "units":sorted({f"{a.unit.campus or ''} {a.unit.name}".strip() for a in p.postings
                                            if a.unit and a.starts_on<=today and (a.ends_on is None or a.ends_on>=today)})}
                           for p in possible]
        if person and before == after and not designation_pending:
            action = "unchanged"
        result.append({**row, "action": "invalid" if errors else "needs_review" if suggestions else action,
                       "errors": errors, "suggestions": suggestions, "before": before, "after": after,
                       "designation_change": designation_change,
                       "normalizations":[{"field":field,"original":row.get("original_values",values).get(field,""),
                           "proposed":proposed,"reason":"Validated member value; blank update fields preserve existing values"}
                           for field,proposed in after.items()],
                       "person_id": str(person.id) if person else None,
                       "revision": revision(person) if person else None})
    return result


def apply_preview(db: Session, preview: MemberImportPreview, operator: UserAccount,
                  excluded: list[int], archive_ids: list[str] | None = None) -> dict:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"member-import")
    if preview.operator_id != operator.id:
        raise HTTPException(403, "This preview belongs to another operator")
    if preview.result is not None:
        return preview.result
    if preview.created_at < datetime.utcnow() - timedelta(hours=2):
        raise HTTPException(409, "Preview expired; preview the file again")
    roster = preview.mode == ROSTER_SYNC
    archive_ids = sorted({str(i) for i in archive_ids or []})
    if archive_ids and not roster:
        raise HTTPException(422, "Only a full-roster sync can archive members missing from the file")
    selected = [r for r in preview.rows if r["row_number"] not in excluded]
    if not selected and not archive_ids:
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
    if archive_ids:
        allowed = {m["id"] for m in roster_missing(db, preview.rows)}
        if not set(archive_ids) <= allowed:
            raise HTTPException(409, "Members changed since preview; review the file again")
    result = {"batch_id": str(preview.id), "created": 0, "updated": 0, "unchanged": 0, "archived": 0,
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
                if not (roster and field == "call_level"):
                    setattr(person, field, value)
            if roster and row["before"]["call_level"] != row["after"]["call_level"]:
                try:
                    record_call_change(db, person, row["after"]["call_level"], local_today(),
                                       "Department roster CSV import", source="roster_csv", actor_id=operator.id)
                except ValueError as exc:
                    raise HTTPException(409, f"{person.canonical_name}: {exc}") from exc
            if old_name != person.canonical_name:
                from app.models import PersonAlias
                if not any(a.alias.casefold() == old_name.casefold() for a in person.aliases):
                    person.aliases.append(PersonAlias(alias=old_name, source="member_csv_rename"))
        person.archived_at = (person.archived_at or datetime.utcnow()) if person.active_status == "archived" else None
        values = row["values"]
        if row.get("designation_change"):
            start = date.fromisoformat(values["designation_effective_from"])
            if not any(d.designation == values["designation"] and d.effective_from == start for d in person.designations):
                if roster:
                    for d in person.designations:
                        if d.effective_from < start and (d.effective_to is None or d.effective_to >= start):
                            d.effective_to = start - timedelta(days=1)
                person.designations.append(PersonDesignation(designation=values["designation"],
                    effective_from=start, source="member_csv"))
        record_activity(db, person, operator, "roster_import" if roster else "csv_import", before, str(preview.id))
        result["created" if row["action"] == "create" else "updated"] += 1
        result["members"].append({"id": str(person.id), "canonical_name": person.canonical_name})
    for person_id in archive_ids:
        person = db.get(Person, UUID(person_id))
        before = snapshot(person)
        person.active_status = "archived"
        person.archived_at = datetime.utcnow()
        record_activity(db, person, operator, "roster_archived", before, str(preview.id))
        result["archived"] += 1
        result["members"].append({"id": str(person.id), "canonical_name": person.canonical_name})
    preview.result = result
    db.commit()
    return result
