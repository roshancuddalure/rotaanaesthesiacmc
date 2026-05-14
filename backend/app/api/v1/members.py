from datetime import date, datetime
from collections import Counter
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models import Person, PersonAlias, PersonDesignation
from app.services.members import (
    delete_invalid_members,
    auto_merge_duplicate_candidates,
    duplicate_candidates,
    invalid_members,
    merge_people,
    normalize_dirty_member_names,
)
from app.services.roster_reconciliation import reconcile_department_roster
from app.services.department_roster_reset import reset_department_members_from_roster
from app.services.unitwise_call_levels import prefill_call_levels_from_unitwise

router = APIRouter()


class AliasRead(BaseModel):
    id: UUID
    alias: str
    source: str


class DesignationRead(BaseModel):
    id: UUID
    designation: str
    effective_from: date
    effective_to: date | None
    source: str
    notes: str | None


class MemberRead(BaseModel):
    id: UUID
    canonical_name: str
    active_status: str
    call_level: str | None
    archived_at: datetime | None
    aliases: list[AliasRead]
    designations: list[DesignationRead]


class MemberCreate(BaseModel):
    canonical_name: str
    active_status: str = "active"
    call_level: str | None = None


class MemberUpdate(BaseModel):
    canonical_name: str
    active_status: str = "active"
    call_level: str | None = None


class AliasCreate(BaseModel):
    alias: str
    source: str = "manual"


class DesignationCreate(BaseModel):
    designation: str
    effective_from: date
    effective_to: date | None = None
    notes: str | None = None


class MergeRequest(BaseModel):
    target_person_id: UUID
    source_person_ids: list[UUID]


class DuplicateCandidateRead(BaseModel):
    normalized_name: str
    people: list[MemberRead]


class InvalidMembersRead(BaseModel):
    count: int
    people: list[MemberRead]


class CleanupResult(BaseModel):
    normalized: int = 0
    deleted: int


class AutoMergeResultRead(BaseModel):
    merged_groups: int
    merged_people: int
    remaining_groups: int


class RosterReconciliationRead(BaseModel):
    roster_entries: int
    matched_people: int
    created_people: int
    renamed_people: int
    merged_people: int
    aliases_created: int
    designations_created: int
    unmatched_database_people: int
    examples: list[str]


class DepartmentRosterResetRead(BaseModel):
    deleted_counts: dict[str, int]
    created_members: int
    created_designations: int
    duplicate_names_skipped: int
    source_file: str
    source_sheets: list[str]
    examples: list[str]


class CallLevelPrefillRead(BaseModel):
    matched: int
    unmatched: int
    cleared: int
    unmatched_names: list[str]
    examples: list[str]


class MemberAuditRead(BaseModel):
    total_members: int
    active_members: int
    inactive_members: int
    aliases: int
    designations: int
    invalid_members: int
    duplicate_groups: int
    missing_designations: int
    missing_call_levels: int
    positions: dict[str, int]
    call_levels: dict[str, int]
    sources: dict[str, int]
    status: str


def member_to_read(person: Person) -> MemberRead:
    return MemberRead(
        id=person.id,
        canonical_name=person.canonical_name,
        active_status=person.active_status,
        call_level=person.call_level,
        archived_at=person.archived_at,
        aliases=[
            AliasRead(id=alias.id, alias=alias.alias, source=alias.source)
            for alias in sorted(person.aliases, key=lambda item: item.alias.casefold())
        ],
        designations=[
            DesignationRead(
                id=designation.id,
                designation=designation.designation,
                effective_from=designation.effective_from,
                effective_to=designation.effective_to,
                source=designation.source,
                notes=designation.notes,
            )
            for designation in sorted(person.designations, key=lambda item: item.effective_from)
        ],
    )


def get_member_or_404(db: Session, person_id: UUID) -> Person:
    person = db.scalar(
        select(Person)
        .where(Person.id == person_id)
        .options(selectinload(Person.aliases), selectinload(Person.designations))
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return person


@router.get("/admin/members")
def list_members(q: str | None = None, db: Session = Depends(get_db)) -> list[MemberRead]:
    statement = select(Person).options(
        selectinload(Person.aliases), selectinload(Person.designations)
    )
    if q:
        statement = statement.where(Person.canonical_name.ilike(f"%{q}%"))
    statement = statement.order_by(Person.canonical_name)
    return [member_to_read(person) for person in db.scalars(statement)]


@router.post("/admin/members")
def create_member(payload: MemberCreate, db: Session = Depends(get_db)) -> MemberRead:
    canonical_name = payload.canonical_name.strip()
    existing = db.scalar(
        select(Person)
        .where(func.lower(Person.canonical_name) == canonical_name.lower())
        .options(selectinload(Person.aliases), selectinload(Person.designations))
    )
    if existing is not None:
        changed = False
        if existing.active_status != payload.active_status:
            existing.active_status = payload.active_status
            if payload.active_status == "archived":
                existing.archived_at = existing.archived_at or datetime.utcnow()
            elif existing.archived_at is not None:
                existing.archived_at = None
            changed = True
        if payload.call_level and existing.call_level != payload.call_level.strip():
            existing.call_level = payload.call_level.strip()
            changed = True
        if changed:
            db.commit()
            return member_to_read(get_member_or_404(db, existing.id))
        raise HTTPException(
            status_code=409,
            detail=f'Member already exists as {existing.active_status}: {existing.canonical_name}',
        )

    person = Person(
        canonical_name=canonical_name,
        active_status=payload.active_status,
        call_level=payload.call_level.strip() if payload.call_level else None,
    )
    db.add(person)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Member already exists") from exc
    db.refresh(person)
    return member_to_read(get_member_or_404(db, person.id))


@router.put("/admin/members/{person_id}")
def update_member(
    person_id: UUID,
    payload: MemberUpdate,
    db: Session = Depends(get_db),
) -> MemberRead:
    person = get_member_or_404(db, person_id)
    person.canonical_name = payload.canonical_name.strip()
    person.active_status = payload.active_status
    if payload.active_status == "archived":
        person.archived_at = person.archived_at or datetime.utcnow()
    elif person.archived_at is not None:
        person.archived_at = None
    person.call_level = payload.call_level.strip() if payload.call_level else None
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Canonical name already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/archive")
def archive_member(person_id: UUID, db: Session = Depends(get_db)) -> MemberRead:
    person = get_member_or_404(db, person_id)
    if person.active_status != "archived":
        person.active_status = "archived"
        person.archived_at = datetime.utcnow()
        db.commit()
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/restore")
def restore_member(person_id: UUID, db: Session = Depends(get_db)) -> MemberRead:
    person = get_member_or_404(db, person_id)
    if person.active_status == "archived":
        person.active_status = "active"
        person.archived_at = None
        db.commit()
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/aliases")
def add_alias(person_id: UUID, payload: AliasCreate, db: Session = Depends(get_db)) -> MemberRead:
    person = get_member_or_404(db, person_id)
    db.add(PersonAlias(person=person, alias=payload.alias.strip(), source=payload.source))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Alias already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/designations")
def add_designation(
    person_id: UUID,
    payload: DesignationCreate,
    db: Session = Depends(get_db),
) -> MemberRead:
    person = get_member_or_404(db, person_id)
    db.add(
        PersonDesignation(
            person=person,
            designation=payload.designation.strip(),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            source="manual",
            notes=payload.notes,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Designation already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.get("/admin/members/dedupe-candidates")
def get_dedupe_candidates(db: Session = Depends(get_db)) -> list[DuplicateCandidateRead]:
    return [
        DuplicateCandidateRead(
            normalized_name=candidate.normalized_name,
            people=[member_to_read(person) for person in candidate.people],
        )
        for candidate in duplicate_candidates(db)[:100]
    ]


@router.get("/admin/members/invalid")
def get_invalid_members(db: Session = Depends(get_db)) -> InvalidMembersRead:
    people = invalid_members(db)
    return InvalidMembersRead(
        count=len(people),
        people=[member_to_read(person) for person in people[:200]],
    )


@router.get("/admin/members/audit")
def audit_members(db: Session = Depends(get_db)) -> MemberAuditRead:
    people = db.scalars(
        select(Person)
        .options(selectinload(Person.aliases), selectinload(Person.designations))
        .order_by(Person.canonical_name)
    ).all()
    invalid = invalid_members(db)
    duplicates = duplicate_candidates(db)
    positions = Counter()
    sources = Counter()
    call_levels = Counter()
    missing_designations = 0
    missing_call_levels = 0
    aliases = 0
    designations = 0
    active_members = 0

    for person in people:
        if person.active_status == "active":
            active_members += 1
        if person.call_level:
            call_levels[person.call_level] += 1
        else:
            missing_call_levels += 1
        aliases += len(person.aliases)
        designations += len(person.designations)
        if not person.designations:
            missing_designations += 1
            continue
        latest = sorted(person.designations, key=lambda item: item.effective_from)[-1]
        positions[latest.designation] += 1
        sources[latest.source] += 1

    is_clean = not invalid and not duplicates and missing_designations == 0
    return MemberAuditRead(
        total_members=len(people),
        active_members=active_members,
        inactive_members=len(people) - active_members,
        aliases=aliases,
        designations=designations,
        invalid_members=len(invalid),
        duplicate_groups=len(duplicates),
        missing_designations=missing_designations,
        missing_call_levels=missing_call_levels,
        positions=dict(sorted(positions.items())),
        call_levels=dict(sorted(call_levels.items())),
        sources=dict(sorted(sources.items())),
        status="clean" if is_clean else "needs_review",
    )


@router.post("/admin/members/cleanup-invalid")
def cleanup_invalid_members(db: Session = Depends(get_db)) -> CleanupResult:
    normalized = normalize_dirty_member_names(db)
    deleted = delete_invalid_members(db)
    return CleanupResult(normalized=normalized, deleted=deleted)


@router.post("/admin/members/auto-merge-duplicates")
def auto_merge_duplicates(db: Session = Depends(get_db)) -> AutoMergeResultRead:
    return AutoMergeResultRead(**auto_merge_duplicate_candidates(db).__dict__)


@router.post("/admin/members/reconcile-trusted-roster")
def reconcile_trusted_roster(db: Session = Depends(get_db)) -> RosterReconciliationRead:
    return RosterReconciliationRead(**reconcile_department_roster(db).__dict__)


@router.post("/admin/members/reset-from-trusted-roster")
def reset_from_trusted_roster(db: Session = Depends(get_db)) -> DepartmentRosterResetRead:
    return DepartmentRosterResetRead(**reset_department_members_from_roster(db).__dict__)


@router.post("/admin/members/prefill-call-levels")
def prefill_call_levels(db: Session = Depends(get_db)) -> CallLevelPrefillRead:
    return CallLevelPrefillRead(**prefill_call_levels_from_unitwise(db).__dict__)


@router.post("/admin/members/merge")
def merge_members(payload: MergeRequest, db: Session = Depends(get_db)) -> MemberRead:
    try:
        person = merge_people(db, payload.target_person_id, payload.source_person_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Merge produced a duplicate record") from exc
    return member_to_read(get_member_or_404(db, person.id))
