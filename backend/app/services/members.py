"""Member deduplication and cleanup: duplicate detection by compact name/alias keys,
automatic and manual merges (moving assignments, postings, leave, designations and
aliases to the target), invalid-name cleanup and deletion.

Merges preserve all person references, including eligibility and exchange history.
The separate legacy invalid-name deletion path still needs relationship review before
being used on members with operational history.
"""

import re
import unicodedata
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    LeaveRequest,
    Person,
    PersonAlias,
    PersonDesignation,
    PersonPosting,
    RotaExchangeRequest, RotaAutoFillEvent, MemberActivity,
    LegacyPersonComment,
)
from app.services.imports import clean_person_name, is_valid_person_name
from app.models import PersonCallChange, PersonComment


@dataclass(frozen=True)
class DuplicateCandidate:
    normalized_name: str
    people: list[Person]


@dataclass(frozen=True)
class AutoMergeResult:
    merged_groups: int
    merged_people: int
    remaining_groups: int


def normalize_member_name(name: str) -> str:
    cleaned = unicodedata.normalize("NFKC", name).casefold()
    cleaned = re.sub(r"\b(dr|prof|mr|mrs|ms)\b\.?", " ", cleaned)
    cleaned = re.sub(r"[^\w]+", " ", cleaned).replace("_", " ")
    tokens = [token for token in cleaned.split() if token]
    return " ".join(tokens)


def compact_name_key(name: str) -> str:
    return normalize_member_name(name).replace(" ", "")


def identity_conflict(db: Session, name: str, exclude_id: UUID | None = None) -> Person | None:
    key = compact_name_key(name)
    if not key:
        return None
    people = db.scalars(select(Person).options(selectinload(Person.aliases)).order_by(Person.created_at, Person.id))
    for person in people:
        if person.id != exclude_id and key in {compact_name_key(person.canonical_name), *[compact_name_key(a.alias) for a in person.aliases]}:
            return person
    return None


def duplicate_candidates(db: Session) -> list[DuplicateCandidate]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
        .order_by(Person.canonical_name)
    ).all()
    grouped: dict[str, list[Person]] = {}
    for person in people:
        keys = {compact_name_key(person.canonical_name)}
        keys.update(compact_name_key(alias.alias) for alias in person.aliases)
        for key in keys:
            if key:
                grouped.setdefault(key, []).append(person)

    candidates: list[DuplicateCandidate] = []
    seen_groups: set[tuple[UUID, ...]] = set()
    for key, group in grouped.items():
        unique = sorted({person.id: person for person in group}.values(), key=lambda item: item.canonical_name)
        if len(unique) < 2:
            continue
        signature = tuple(person.id for person in unique)
        if signature in seen_groups:
            continue
        seen_groups.add(signature)
        candidates.append(DuplicateCandidate(normalized_name=key, people=unique))

    return sorted(candidates, key=lambda candidate: (-len(candidate.people), candidate.normalized_name))


def target_score(person: Person) -> tuple[int, int, int, int, str]:
    name = person.canonical_name.strip()
    has_mixed_case = int(not name.isupper())
    has_designation = int(bool(person.designations))
    has_aliases = int(bool(person.aliases))
    token_count = len(name.split())
    return (has_mixed_case, has_designation, has_aliases, token_count, name.casefold())


def select_merge_target(people: list[Person]) -> Person:
    return sorted(people, key=target_score, reverse=True)[0]


def auto_merge_duplicate_candidates(db: Session, max_passes: int = 10) -> AutoMergeResult:
    merged_groups = 0
    merged_people = 0

    for _ in range(max_passes):
        candidates = duplicate_candidates(db)
        if not candidates:
            break
        merged_this_pass = False
        for candidate in candidates:
            current_people = [
                person
                for person in (db.get(Person, person.id) for person in candidate.people)
                if person is not None
            ]
            if len(current_people) < 2:
                continue
            target = select_merge_target(current_people)
            source_ids = [person.id for person in current_people if person.id != target.id]
            merge_people(db, target.id, source_ids)
            merged_groups += 1
            merged_people += len(source_ids)
            merged_this_pass = True
        if not merged_this_pass:
            break

    return AutoMergeResult(
        merged_groups=merged_groups,
        merged_people=merged_people,
        remaining_groups=len(duplicate_candidates(db)),
    )


def ensure_person_alias(db: Session, person: Person, alias: str, source: str = "dedupe") -> None:
    alias = alias.strip()
    if not alias or alias == person.canonical_name:
        return
    existing = db.scalar(select(PersonAlias).where(PersonAlias.alias == alias))
    if existing is not None:
        if existing.person_id != person.id:
            existing.person = person
        return
    db.add(PersonAlias(person=person, alias=alias, source=source))


def move_assignments(db: Session, source: Person, target: Person) -> None:
    assignments = db.scalars(
        select(DutyAssignment).where(DutyAssignment.person_id == source.id)
    ).all()
    for assignment in assignments:
        duplicate = db.scalar(
            select(DutyAssignment).where(
                DutyAssignment.duty_slot_id == assignment.duty_slot_id,
                DutyAssignment.person_id == target.id,
            )
        )
        if duplicate is not None:
            db.delete(assignment)
        else:
            assignment.person = target


def move_postings(db: Session, source: Person, target: Person) -> None:
    for posting in db.scalars(select(PersonPosting).where(PersonPosting.person_id == source.id)):
        posting.person = target


def move_leave_requests(db: Session, source: Person, target: Person) -> None:
    for leave_request in db.scalars(select(LeaveRequest).where(LeaveRequest.person_id == source.id)):
        leave_request.person = target


def move_designations(db: Session, source: Person, target: Person) -> None:
    for designation in db.scalars(
        select(PersonDesignation).where(PersonDesignation.person_id == source.id)
    ):
        existing = next((d for d in target.designations
                         if d.designation == designation.designation
                         and d.effective_from == designation.effective_from), None)
        if existing:
            if existing.effective_to != designation.effective_to or existing.notes != designation.notes:
                raise ValueError("Designation histories conflict; correct their dates or notes before merging")
            source.designations.remove(designation)
            db.delete(designation)
        else:
            designation.person = target


def merge_people(db: Session, target_id: UUID, source_ids: list[UUID], *, commit: bool = True) -> Person:
    """Merge identities and preserve every person reference in one transaction."""
    target = db.get(Person, target_id)
    if target is None:
        raise ValueError("Target person not found")

    if target_id in source_ids:
        raise ValueError("The surviving member cannot also be a source")
    sources = [db.get(Person, source_id) for source_id in set(source_ids)]
    if not sources or any(person is None for person in sources):
        raise ValueError("Select existing source members")
    for source in sources:
        if source.id == target.id:
            continue
        ensure_person_alias(db, target, source.canonical_name, source="dedupe_merge")
        for alias in list(source.aliases):
            ensure_person_alias(db, target, alias.alias, source=alias.source)
            if alias.person is not target:
                db.delete(alias)
        move_assignments(db, source, target)
        move_postings(db, source, target)
        move_leave_requests(db, source, target)
        move_designations(db, source, target)
        for change in list(source.call_level_changes):
            existing_change = next((c for c in target.call_level_changes if c.effective_from == change.effective_from), None)
            if existing_change and existing_change.call_level != change.call_level:
                raise ValueError("Dated call-level changes conflict; resolve them before merging")
            if existing_change:
                source.call_level_changes.remove(change)
                db.delete(change)
            else:
                change.person = target
        for membership in list(source.call_cluster_memberships):
            duplicate = next((m for m in target.call_cluster_memberships
                              if m.cluster_id == membership.cluster_id and m.effective_from == membership.effective_from), None)
            if duplicate:
                # Preserve the wider eligibility interval and both notes.
                duplicate.effective_to = (None if duplicate.effective_to is None or membership.effective_to is None
                                          else max(duplicate.effective_to, membership.effective_to))
                duplicate.notes = "\n".join(filter(None, [duplicate.notes, membership.notes])) or None
                source.call_cluster_memberships.remove(membership)
                db.delete(membership)
            else:
                membership.person = target
        for model, field in [(RotaExchangeRequest, "from_person_id"),
                             (RotaExchangeRequest, "to_person_id"),
                             (RotaAutoFillEvent, "person_id"), (MemberActivity, "person_id"),
                             (LegacyPersonComment, "person_id")]:
            db.execute(update(model).where(getattr(model, field) == source.id).values({field: target.id}))
        db.flush()
        for model in (PersonCallChange, PersonComment):
            for record in db.scalars(select(model).where(model.person_id == source.id)):
                if model is PersonCallChange:
                    record.source = f"merged:{record.source}"[:100]
                    with db.no_autoflush:
                        if record in source.call_changes:
                            source.call_changes.remove(record)
                        target.call_changes.append(record)
                record.person_id = target.id
        db.delete(source)

    try:
        if commit:
            db.commit()
        else:
            db.flush()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(target)
    return target


def invalid_members(db: Session) -> list[Person]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
        .order_by(Person.canonical_name)
    ).all()
    return [person for person in people if not is_valid_person_name(person.canonical_name)]


def normalize_dirty_member_names(db: Session) -> int:
    normalized = 0
    people = db.scalars(select(Person).order_by(Person.canonical_name)).all()
    for person in people:
        cleaned = clean_person_name(person.canonical_name)
        if cleaned == person.canonical_name or not is_valid_person_name(cleaned):
            continue
        target = db.scalar(select(Person).where(Person.canonical_name == cleaned))
        if target is not None and target.id != person.id:
            merge_people(db, target.id, [person.id])
        else:
            existing_alias = db.scalar(select(PersonAlias).where(PersonAlias.alias == person.canonical_name))
            if existing_alias is None:
                db.add(PersonAlias(person=person, alias=person.canonical_name, source="name_cleanup"))
            person.canonical_name = cleaned
        normalized += 1
    db.commit()
    return normalized


def delete_invalid_members(db: Session) -> int:
    normalize_dirty_member_names(db)
    people = invalid_members(db)
    for person in people:
        for model in (PersonCallChange, PersonComment):
            for record in db.scalars(select(model).where(model.person_id == person.id)):
                db.delete(record)
        for assignment in db.scalars(
            select(DutyAssignment).where(DutyAssignment.person_id == person.id)
        ):
            db.delete(assignment)
        for posting in db.scalars(select(PersonPosting).where(PersonPosting.person_id == person.id)):
            db.delete(posting)
        for leave_request in db.scalars(select(LeaveRequest).where(LeaveRequest.person_id == person.id)):
            db.delete(leave_request)
        for designation in db.scalars(
            select(PersonDesignation).where(PersonDesignation.person_id == person.id)
        ):
            db.delete(designation)
        for alias in db.scalars(select(PersonAlias).where(PersonAlias.person_id == person.id)):
            db.delete(alias)
        db.delete(person)
    db.commit()
    return len(people)
