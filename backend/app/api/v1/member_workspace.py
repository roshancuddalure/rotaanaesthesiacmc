"""Authenticated member workspace, atomic editor and CSV import endpoints."""

import json
import csv
import io
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user, require_admin
from app.api.v1.members import get_member_or_404, member_to_read
from app.db.session import get_db
from app.models import MemberActivity, MemberImportPreview, MemberCallLevelChange, Person, PersonAlias, UserAccount
from app.services.member_csv import apply_preview, build_preview, parse_file
from app.services.member_profile import (
    ensure_unique_name, record_activity, replace_designations, revision, snapshot, validate_identity,
)

router = APIRouter(prefix="/admin/member-workspace", dependencies=[Depends(current_user)])


class ProfileSave(BaseModel):
    revision: str
    canonical_name: str
    active_status: str
    call_level: str | None = None
    preserve_previous_name: bool = True
    aliases: list[str]
    designations: list[dict]
    call_level_changes: list[dict] = []

    @model_validator(mode="after")
    def validate_shapes(self):
        for item in self.designations:
            if not isinstance(item.get("designation"), str) or not item.get("effective_from"):
                raise ValueError("Every designation requires a name and start date")
            if item.get("notes") is not None and not isinstance(item["notes"], str):
                raise ValueError("Designation notes must be text")
        for item in self.call_level_changes:
            if not isinstance(item.get("call_level"), str) or not item.get("effective_from"):
                raise ValueError("Every call-level change requires a call level and effective date")
            if item.get("notes") is not None and not isinstance(item["notes"], str):
                raise ValueError("Call-level notes must be text")
        return self


class ApplyRequest(BaseModel):
    excluded: list[int] = []


class MergeProfileRequest(BaseModel):
    source_id: UUID
    target_revision: str
    source_revision: str


@router.post("/{person_id}/merge")
def merge_profile(person_id: UUID, payload: MergeProfileRequest, db: Session = Depends(get_db),
                  operator: UserAccount = Depends(require_admin)):
    from app.services.members import merge_people
    for identity in sorted({person_id, payload.source_id}):
        db.scalar(select(Person).where(Person.id == identity).with_for_update())
    target = get_member_or_404(db, person_id)
    source = get_member_or_404(db, payload.source_id)
    if revision(target) != payload.target_revision or revision(source) != payload.source_revision:
        raise HTTPException(409, "A member changed; reload the comparison")
    before = {"target": snapshot(target), "source": snapshot(source)}
    try:
        merged = merge_people(db, person_id, [payload.source_id], commit=False)
        record_activity(db, merged, operator, "members_merged", before)
        db.commit()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "These records have conflicting linked history; resolve it before merging") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/csv/columns")
async def csv_columns(file: UploadFile = File(...), operator: UserAccount = Depends(require_admin)):
    content = await file.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(422, "CSV must be 2 MB or smaller")
    try:
        header = next(csv.reader(io.StringIO(content.decode("utf-8-sig")), strict=True))
    except (UnicodeDecodeError, csv.Error, StopIteration) as exc:
        raise HTTPException(422, "Upload a non-empty CSV UTF-8 file") from exc
    return {"headers": header}


@router.get("/{person_id}")
def profile(person_id: UUID, db: Session = Depends(get_db)) -> dict:
    person = get_member_or_404(db, person_id)
    today = date.today()
    return {"member": member_to_read(person), "impact": {
        "future_duties": sum(a.duty_slot.duty_date >= today for a in person.duty_assignments),
        "current_or_future_postings": sum(p.ends_on is None or p.ends_on >= today for p in person.postings),
        "eligibility_memberships": len(person.call_cluster_memberships),
    }}


@router.get("/{person_id}/{section}")
def section(person_id: UUID, section: str, db: Session = Depends(get_db)) -> dict:
    person = get_member_or_404(db, person_id)
    if section == "postings":
        rows = [{"id": str(p.id), "unit": p.unit.name if p.unit else "Special posting",
                 "posting_type": p.posting_type, "starts_on": str(p.starts_on),
                 "ends_on": str(p.ends_on) if p.ends_on else None, "source": p.source}
                for p in sorted(person.postings, key=lambda p: p.starts_on, reverse=True)]
    elif section == "leave":
        rows = [{"id": str(p.id), "type": p.leave_type, "slot": p.leave_slot,
                 "starts_on": str(p.starts_on), "ends_on": str(p.ends_on),
                 "status": p.status, "source": p.source}
                for p in sorted(person.leave_requests, key=lambda p: p.starts_on, reverse=True)]
    elif section == "duties":
        rows = [{"id": str(a.id), "date": str(a.duty_slot.duty_date),
                 "duty": a.duty_slot.slot_label, "is_24hr": a.duty_slot.is_24hr,
                 "period_status": a.duty_slot.rota_period.status if a.duty_slot.rota_period else "Unknown"}
                for a in sorted(person.duty_assignments, key=lambda a: a.duty_slot.duty_date, reverse=True)]
    elif section == "roles":
        rows = [{"name": m.cluster.name, "call_level": m.cluster.call_level,
                 "active": m.cluster.active, "description": m.cluster.description,
                 "effective_from": str(m.effective_from),
                 "effective_to": str(m.effective_to) if m.effective_to else None,
                 "notes": m.notes} for m in person.call_cluster_memberships]
    elif section == "duplicates":
        from app.services.members import duplicate_candidates
        groups = [g for g in duplicate_candidates(db) if any(p.id == person.id for p in g.people)]
        candidates = {p.id: p for g in groups for p in g.people if p.id != person.id}
        rows = [{"id": str(p.id), "name": p.canonical_name, "status": p.active_status,
                 "call_level": p.call_level, "revision": revision(p),
                 "member": member_to_read(p).model_dump(mode="json"),
                 "designations": [d.designation for d in p.designations],
                 "duties": len(p.duty_assignments), "postings": len(p.postings),
                 "leave": len(p.leave_requests), "memberships": len(p.call_cluster_memberships)}
                for p in candidates.values()]
    elif section == "activity":
        rows = [{"action": a.action, "operator": a.operator_name,
                 "created_at": a.created_at.isoformat() + "Z", "details": a.details}
                for a in db.scalars(select(MemberActivity).where(MemberActivity.person_id == person_id)
                                   .order_by(MemberActivity.created_at.desc()))]
    else:
        raise HTTPException(404, "Unknown profile section")
    result = {"rows": rows}
    if section == "duties":
        from app.services.analysis import analyze_dashboard
        dashboard = analyze_dashboard(db)
        result["analysis"] = next((p for p in dashboard["people"] if p.get("person_id") == str(person.id)), None)
        result["months"] = dashboard["months"]
    return result


@router.put("/{person_id}")
def save_profile(person_id: UUID, payload: ProfileSave, db: Session = Depends(get_db),
                 operator: UserAccount = Depends(require_admin)):
    db.scalar(select(Person).where(Person.id == person_id).with_for_update())
    person = get_member_or_404(db, person_id)
    if revision(person) != payload.revision:
        raise HTTPException(409, detail={"message": "Another operator changed this profile. Compare the saved version before retrying.",
                                        "current": member_to_read(person).model_dump(mode="json")})
    before = snapshot(person)
    try:
        name = validate_identity(payload.canonical_name, payload.active_status, payload.call_level)
        ensure_unique_name(db, name, person)
        aliases = set({a.strip().casefold(): a.strip() for a in payload.aliases if a.strip()}.values())
        if payload.preserve_previous_name and name != person.canonical_name:
            aliases.add(person.canonical_name)
        if any(len(a) > 255 for a in aliases):
            raise ValueError("Aliases must be at most 255 characters")
        for alias in sorted(aliases):
            ensure_unique_name(db, alias, person)
        scheduled_dates = set()
        scheduled = []
        for change in payload.call_level_changes:
            validate_identity(name, payload.active_status, change.get("call_level"))
            if not change.get("call_level"):
                raise ValueError("Choose a call level for each dated change")
            day = date.fromisoformat(str(change.get("effective_from", "")))
            if day in scheduled_dates:
                raise ValueError("Only one call-level change is allowed per effective date")
            scheduled_dates.add(day)
            scheduled.append((change, day))
        for change in list(person.call_level_changes):
            person.call_level_changes.remove(change)
            db.delete(change)
        db.flush()
        for change, day in scheduled:
            person.call_level_changes.append(MemberCallLevelChange(call_level=change["call_level"],
                effective_from=day, notes=(change.get("notes") or "")[:1000] or None))
        replace_designations(person, payload.designations, db)
        person.canonical_name = name
        person.active_status = payload.active_status
        person.call_level = payload.call_level
        person.archived_at = (person.archived_at or datetime.utcnow()) if payload.active_status == "archived" else None
        for alias in list(person.aliases):
            if alias.alias not in aliases:
                person.aliases.remove(alias)
                db.delete(alias)
        existing = {a.alias for a in person.aliases}
        for alias in aliases - existing:
            person.aliases.append(PersonAlias(alias=alias, source="manual"))
        record_activity(db, person, operator, "profile_updated", before)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "A name, alias or designation conflicts with another record") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/csv/preview")
async def preview_csv(file: UploadFile = File(...), mode: str = Form("create_only"),
                      mapping: str = Form("{}"), corrections: str = Form("{}"),
                      db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(422, "Choose a .csv file saved as CSV UTF-8")
    try:
        headers, rows = parse_file(await file.read(2 * 1024 * 1024 + 1), json.loads(mapping))
        edits = json.loads(corrections)
        if not isinstance(edits, dict):
            raise ValueError("Row corrections must be an object")
        for row in rows:
            if not isinstance(edits.get(str(row["row_number"]), {}), dict):
                raise ValueError("Each row correction must be an object")
            row["values"].update({k: str(v) for k, v in edits.get(str(row["row_number"]), {}).items()
                                  if k in {"member_id", "canonical_name", "active_status", "call_level", "designation", "designation_effective_from", "_confirm_distinct"}})
        result = build_preview(db, rows, mode)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    preview = MemberImportPreview(operator_id=operator.id, filename=(file.filename or "members.csv")[:255],
                                  mode=mode, rows=result)
    db.add(preview)
    db.commit()
    return {"id": str(preview.id), "headers": headers, "rows": result}


@router.post("/csv/{preview_id}/apply")
def apply_csv(preview_id: UUID, payload: ApplyRequest, db: Session = Depends(get_db),
              operator: UserAccount = Depends(require_admin)):
    preview = db.scalar(select(MemberImportPreview).where(MemberImportPreview.id == preview_id).with_for_update())
    if preview is None:
        raise HTTPException(404, "Preview not found")
    try:
        return apply_preview(db, preview, operator, payload.excluded)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Members changed since preview; review the file again") from exc
