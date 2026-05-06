import re
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
    cleaned = name.casefold()
    cleaned = re.sub(r"\b(dr|prof|mr|mrs|ms)\b\.?", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    tokens = [token for token in cleaned.split() if token]
    return " ".join(tokens)


def compact_name_key(name: str) -> str:
    return normalize_member_name(name).replace(" ", "")


def duplicate_candidates(db: Session) -> list[DuplicateCandidate]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations))
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
        designation.person = target


def merge_people(db: Session, target_id: UUID, source_ids: list[UUID]) -> Person:
    target = db.get(Person, target_id)
    if target is None:
        raise ValueError("Target person not found")

    sources = [person for person in (db.get(Person, source_id) for source_id in source_ids) if person]
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
        db.delete(source)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(target)
    return target


def invalid_members(db: Session) -> list[Person]:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations))
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
