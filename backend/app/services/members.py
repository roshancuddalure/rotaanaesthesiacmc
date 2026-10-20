"""Member deduplication and cleanup: duplicate detection by compact name/alias keys,
automatic and manual merges (moving assignments, postings, leave, designations and
aliases to the target), invalid-name cleanup and deletion.

Merges preserve all person references, including eligibility and exchange history.
The separate legacy invalid-name deletion path still needs relationship review before
being used on members with operational history.
"""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    LeaveRequest,
    Person,
    PersonAlias,
    PersonDesignation,
    PersonPosting,
)
from app.services.imports import clean_person_name, is_valid_person_name
from app.services.normalization import member_key
from app.models import PersonCallChange, PersonComment


@dataclass(frozen=True)
class DuplicateCandidate:
    normalized_name: str
    people: list[Person]
    # "canonical": identical canonical-name key (may be merged after preview + confirm);
    # "alias": only an alias is shared (listed for review, never merged automatically).
    match: str = "alias"


@dataclass(frozen=True)
class AutoMergeResult:
    merged_groups: int
    merged_people: int
    remaining_groups: int


class StalePreviewError(Exception):
    """The data changed between the preview and the confirmation; preview again."""


class AliasOwnedError(ValueError):
    """An alias already belongs to another member and was not moved."""


def preview_token(changes: object) -> str:
    """A stable hash of the proposed changes; the confirmation must echo it back."""
    encoded = json.dumps(changes, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:32]


def check_preview_token(expected: str, supplied: str | None, what: str) -> None:
    if not supplied:
        raise StalePreviewError(f"Preview the {what} first, then confirm with its preview token")
    if supplied != expected:
        raise StalePreviewError(
            f"Members changed since the {what} preview was made. Preview again and review the new list before confirming"
        )


def person_brief(person: Person) -> dict:
    return {"id": str(person.id), "name": person.canonical_name, "status": person.active_status}


def normalize_member_name(name: str) -> str:
    cleaned = unicodedata.normalize("NFKC", name).casefold()
    cleaned = re.sub(r"\b(dr|prof|mr|mrs|ms)\b\.?", " ", cleaned)
    cleaned = re.sub(r"[^\w]+", " ", cleaned).replace("_", " ")
    tokens = [token for token in cleaned.split() if token]
    return " ".join(tokens)


def compact_name_key(name: str) -> str:
    return normalize_member_name(name).replace(" ", "")


def identity_conflict(db: Session, name: str, exclude_id: UUID | None = None) -> Person | None:
    """The member (other than ``exclude_id``) whose name or alias has the same ``member_key``."""
    key = member_key(name)
    if not key:
        return None
    people = db.scalars(select(Person).options(selectinload(Person.aliases)).order_by(Person.created_at, Person.id))
    for person in people:
        if person.id != exclude_id and key in {member_key(person.canonical_name), *[member_key(a.alias) for a in person.aliases]}:
            return person
    return None


def duplicate_candidates(db: Session) -> list[DuplicateCandidate]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
        .order_by(Person.canonical_name)
    ).all()
    grouped: dict[str, list[Person]] = {}
    canonical_groups: dict[str, set[UUID]] = {}
    for person in people:
        canonical = member_key(person.canonical_name)
        if canonical:
            canonical_groups.setdefault(canonical, set()).add(person.id)
        keys = {canonical}
        keys.update(member_key(alias.alias) for alias in person.aliases)
        for key in keys:
            if key:
                grouped.setdefault(key, []).append(person)

    candidates: list[DuplicateCandidate] = []
    seen_groups: set[tuple[str, ...]] = set()
    # Canonical groups first so a group that is both is labelled as mergeable.
    for key, group in sorted(grouped.items(), key=lambda kv: (len(canonical_groups.get(kv[0], ())) < 2, kv[0])):
        unique = sorted({person.id: person for person in group}.values(),
                        key=lambda item: (item.canonical_name, str(item.id)))
        if len(unique) < 2:
            continue
        signature = tuple(sorted(str(person.id) for person in unique))
        if signature in seen_groups:
            continue
        seen_groups.add(signature)
        exact = canonical_groups.get(key, set()) == {person.id for person in unique}
        candidates.append(DuplicateCandidate(normalized_name=key, people=unique,
                                             match="canonical" if exact else "alias"))

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


def plan_auto_merge(db: Session) -> dict:
    """Preview of the automatic merge: only members whose canonical names have the same
    ``member_key`` are proposed. Groups that only share an alias are listed for review."""
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations))
        .order_by(Person.canonical_name, Person.id)
    ).all()
    by_key: dict[str, list[Person]] = {}
    for person in people:
        key = member_key(person.canonical_name)
        if key:
            by_key.setdefault(key, []).append(person)
    groups = []
    for key in sorted(by_key):
        group = by_key[key]
        if len(group) < 2:
            continue
        target = select_merge_target(group)
        sources = sorted((p for p in group if p.id != target.id), key=lambda p: (p.canonical_name, str(p.id)))
        warnings = [f"{p.canonical_name} is {p.active_status}" for p in group if p.active_status != "active"]
        groups.append({"key": key, "target": person_brief(target),
                       "sources": [person_brief(p) for p in sources], "warnings": warnings})
    needs_review = [
        {"key": candidate.normalized_name, "people": [person_brief(p) for p in candidate.people],
         "reason": f"Only the alias '{candidate.normalized_name}' is shared; merge by hand if they are the same person"}
        for candidate in duplicate_candidates(db) if candidate.match != "canonical"
    ]
    return {"groups": groups, "needs_review": needs_review, "preview_token": preview_token(groups)}


def auto_merge_duplicate_candidates(db: Session, preview_token: str | None = None) -> AutoMergeResult:
    """Merge the groups shown by ``plan_auto_merge``; ``preview_token`` must match that preview."""
    plan = plan_auto_merge(db)
    check_preview_token(plan["preview_token"], preview_token, "duplicate merge")
    merged_people = 0
    for group in plan["groups"]:
        source_ids = [UUID(source["id"]) for source in group["sources"]]
        merge_people(db, UUID(group["target"]["id"]), source_ids, commit=False)
        merged_people += len(source_ids)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    return AutoMergeResult(
        merged_groups=len(plan["groups"]),
        merged_people=merged_people,
        remaining_groups=len(duplicate_candidates(db)),
    )


def ensure_person_alias(db: Session, person: Person, alias: str, source: str = "dedupe", *,
                        reassign: bool = False) -> None:
    """Give ``person`` the alias. An alias owned by another member is moved only when
    ``reassign`` is True (merges); otherwise ``AliasOwnedError`` explains the clash."""
    alias = alias.strip()
    if not alias or alias == person.canonical_name:
        return
    existing = db.scalar(select(PersonAlias).where(PersonAlias.alias == alias))
    if existing is not None:
        if existing.person_id != person.id:
            if not reassign:
                owner = existing.person
                owner_name = owner.canonical_name if owner is not None else "another member"
                raise AliasOwnedError(
                    f'Alias "{alias}" already belongs to {owner_name}; it was not moved to {person.canonical_name}'
                )
            existing.person = person
        return
    db.add(PersonAlias(person=person, alias=alias, source=source))


def merge_people(db: Session, target_id: UUID, source_ids: list[UUID], *, commit: bool = True,
                 operator=None, choices: dict | None = None, preview_token: str | None = None) -> Person:
    """Merge ``source_ids`` into ``target_id`` through the safe merge engine.

    app.services.member_merge re-points every reference (found from the model), resolves
    duplicates, verifies nothing still refers to the merged records, and stores an undo record.
    Raises MergeError (a ValueError) with a plain reason; on any error nothing is changed.
    """
    from app.services.member_merge import run_merge

    result = run_merge(db, target_id, list(source_ids), choices=choices, preview_token=preview_token,
                       operator=operator)
    if commit:
        db.commit()
    else:
        db.flush()
    target = db.get(Person, target_id)
    target.last_merge_id = result.get("merge_id")  # read by the merge route
    return target


def invalid_members(db: Session) -> list[Person]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
        .order_by(Person.canonical_name)
    ).all()
    return [person for person in people if not is_valid_person_name(person.canonical_name)]


def plan_dirty_member_names(db: Session) -> dict:
    """Preview of name cleanup. A cleaned name that another member already uses (as a name
    or alias), or that two dirty names share, is reported as a collision and never merged."""
    people = db.scalars(select(Person).options(selectinload(Person.aliases))
                        .order_by(Person.canonical_name, Person.id)).all()
    owners: dict[str, set[UUID]] = {}
    for person in people:
        for name in (person.canonical_name, *[a.alias for a in person.aliases]):
            key = member_key(name)
            if key:
                owners.setdefault(key, set()).add(person.id)
    by_id = {person.id: person for person in people}
    proposed: list[tuple[Person, str]] = []
    for person in people:
        cleaned = clean_person_name(person.canonical_name)
        if cleaned == person.canonical_name or not is_valid_person_name(cleaned):
            continue
        proposed.append((person, cleaned))
    cleaned_counts: dict[str, int] = {}
    for _, cleaned in proposed:
        cleaned_counts[member_key(cleaned)] = cleaned_counts.get(member_key(cleaned), 0) + 1
    renames, collisions = [], []
    for person, cleaned in proposed:
        key = member_key(cleaned)
        others = sorted((by_id[i] for i in owners.get(key, set()) - {person.id}),
                        key=lambda p: (p.canonical_name, str(p.id)))
        row = {"person_id": str(person.id), "current_name": person.canonical_name, "cleaned_name": cleaned}
        if others:
            collisions.append({**row, "colliding_with": [person_brief(p) for p in others],
                               "reason": f'Cleaning "{person.canonical_name}" gives "{cleaned}", which '
                                         f'{", ".join(p.canonical_name for p in others)} already uses; '
                                         "not renamed or merged - merge by hand if they are the same person"})
        elif cleaned_counts[key] > 1:
            collisions.append({**row, "colliding_with": [],
                               "reason": f'Several members clean to "{cleaned}"; not renamed - rename them by hand'})
        else:
            renames.append(row)
    return {"renames": renames, "collisions": collisions}


def normalize_dirty_member_names(db: Session, token: str | None = None) -> int:
    """Rename members whose names carry noise (dates, codes) to the cleaned name, keeping the
    old name as an alias. Collisions are skipped, never merged. With ``token`` the plan must
    still match the reviewed preview (``preview_token(plan_dirty_member_names(db))``)."""
    plan = plan_dirty_member_names(db)
    if token is not None:
        check_preview_token(preview_token(plan), token, "name cleanup")
    for row in plan["renames"]:
        person = db.get(Person, UUID(row["person_id"]))
        existing_alias = db.scalar(select(PersonAlias).where(PersonAlias.alias == person.canonical_name))
        if existing_alias is None:
            db.add(PersonAlias(person=person, alias=person.canonical_name, source="name_cleanup"))
        person.canonical_name = row["cleaned_name"]
    db.commit()
    return len(plan["renames"])


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
