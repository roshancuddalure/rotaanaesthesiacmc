"""Shared validation, optimistic concurrency and transactional profile edits."""

import hashlib
import json
from datetime import date
from typing import Callable, TypeVar

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

from app.models import MemberActivity, Person, PersonAlias, PersonDesignation, UserAccount

STATUSES = {"active", "historical", "archived"}
CALL_LEVELS = {
    "1ST_CALL", "2ND_CALL", "3RD_CALL", "CO_4TH_CALL", "4TH_CALL", "5TH_CALL",
    "1ST_CALL_PG_2025", "2ND_CALL_SR", "2ND_CALL_PG_2022", "2ND_CALL_PG_2023",
    "2ND_CALL_PG_2024", "3RD_CALL_SR_AP", "3RD_CALL_PG_2023", "DM_PDF",
    "PAIN", "SICU", "DRP", "NEURO_ICU",
}
T = TypeVar("T")


def audited_member_operation(db: Session, operator: UserAccount, action: str,
                             operation: Callable[[], T]) -> T:
    """Capture per-member changes made by legacy batch services that commit internally."""
    def current_snapshots() -> dict:
        people = db.scalars(select(Person).options(
            selectinload(Person.aliases), selectinload(Person.designations),
            selectinload(Person.call_level_changes)).execution_options(populate_existing=True))
        return {p.id: snapshot(p) for p in people}

    before = current_snapshots()

    def log_changes() -> None:
        after = current_snapshots()
        for identity in before.keys() | after.keys():
            if before.get(identity) != after.get(identity):
                db.add(MemberActivity(person_id=identity, operator_id=operator.id,
                    operator_name=operator.display_name or operator.username, action=action,
                    details={"before": before.get(identity), "after": after.get(identity)}))
        db.commit()

    try:
        result = operation()
    except Exception:
        db.rollback()
        # Some old services commit per merge. Preserve evidence of any completed
        # changes even when a later row fails; do not claim the batch was atomic.
        log_changes()
        raise
    log_changes()
    return result


def validate_identity(name: str, status: str, call_level: str | None) -> str:
    name = " ".join(name.split())
    if not name or len(name) > 255 or not any(c.isalpha() for c in name):
        raise ValueError("Enter a member name containing letters (maximum 255 characters)")
    if status not in STATUSES:
        raise ValueError("Choose Active, Historical, or Archived")
    if call_level and call_level not in CALL_LEVELS:
        raise ValueError("Choose a supported call level")
    return name


def snapshot(person: Person) -> dict:
    return {
        "canonical_name": person.canonical_name,
        "active_status": person.active_status,
        "call_level": person.call_level,
        "call_level_changes": sorted((str(c.id), c.call_level, str(c.effective_from), c.notes)
                                     for c in person.call_level_changes),
        "archived_at": person.archived_at.isoformat() if person.archived_at else None,
        "aliases": sorted((str(a.id), a.alias, a.source) for a in person.aliases),
        "designations": sorted(
            (str(d.id), d.designation, str(d.effective_from),
             str(d.effective_to) if d.effective_to else None, d.notes, d.source)
            for d in person.designations
        ),
    }


def revision(person: Person) -> str:
    return hashlib.sha256(json.dumps(snapshot(person), sort_keys=True).encode()).hexdigest()


def default_call_level_on(person: Person, day: date) -> str | None:
    changes = [c for c in person.call_level_changes if c.effective_from <= day]
    return max(changes, key=lambda c: c.effective_from).call_level if changes else person.call_level


def record_activity(db: Session, person: Person, operator: UserAccount, action: str,
                    before: dict | None = None, batch_id: str | None = None) -> None:
    db.flush()
    db.add(MemberActivity(
        person_id=person.id, operator_id=operator.id,
        operator_name=operator.display_name or operator.username, action=action,
        details={"before": before, "after": snapshot(person), "batch_id": batch_id},
    ))


def ensure_unique_name(db: Session, name: str, person: Person | None = None) -> None:
    # Serialize case-insensitive name/alias claims across concurrent member edits.
    # The existing database has case-sensitive uniqueness constraints.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:identity))"),
                   {"identity": "member-name:" + name.casefold()})
    existing = db.scalar(select(Person).where(func.lower(Person.canonical_name) == name.lower()))
    alias = db.scalar(select(PersonAlias).where(func.lower(PersonAlias.alias) == name.lower()))
    if (existing and (not person or existing.id != person.id)) or (
        alias and (not person or alias.person_id != person.id)
    ):
        raise HTTPException(409, f'Name or alias "{name}" already belongs to another member')


def validate_designations(items: list[dict]) -> None:
    periods = []
    for item in items:
        if not item["designation"].strip() or len(item["designation"].strip()) > 100:
            raise ValueError("Enter a designation (maximum 100 characters)")
        start = date.fromisoformat(str(item["effective_from"]))
        end = date.fromisoformat(str(item["effective_to"])) if item.get("effective_to") else date.max
        if end < start:
            raise ValueError("Designation end date must be on or after its start date")
        periods.append((start, end))
    periods.sort()
    if any(previous[1] >= current[0] for previous, current in zip(periods, periods[1:])):
        raise ValueError("Designation periods overlap; end the previous position before the next starts")


def replace_designations(person: Person, items: list[dict], db: Session) -> None:
    validate_designations(items)
    existing = {str(d.id): d for d in person.designations}
    retained = set()
    for item in items:
        item_id = str(item.get("id") or "")
        designation = existing.get(item_id)
        if item_id and not designation:
            raise HTTPException(409, "Designation no longer exists; reload the profile")
        if designation is None:
            designation = PersonDesignation(person=person, source="manual")
            db.add(designation)
        else:
            retained.add(item_id)
        designation.designation = item["designation"].strip()
        designation.effective_from = date.fromisoformat(str(item["effective_from"]))
        designation.effective_to = date.fromisoformat(str(item["effective_to"])) if item.get("effective_to") else None
        designation.notes = item.get("notes") or None
    for item_id, designation in existing.items():
        if item_id not in retained:
            person.designations.remove(designation)
            db.delete(designation)
