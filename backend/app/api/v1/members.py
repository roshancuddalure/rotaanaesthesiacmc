"""Department member (Person) administration: CRUD, aliases, designations, archive/restore,
duplicate detection, merges, invalid-name cleanup and trusted-roster reconciliation/reset.

All reads require an authenticated rota account; every mutation requires an admin.
"""

from datetime import date, datetime
from collections import Counter
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, model_validator, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.api.v1.auth import current_user, require_admin
from app.services.member_profile import validate_identity, revision, record_activity, snapshot, ensure_unique_name, validate_designations, audited_member_operation, default_call_level_on
from app.models import Person, PersonAlias, PersonDesignation, UserAccount
from app.services.members import (
    StalePreviewError,
    check_preview_token,
    delete_invalid_members,
    auto_merge_duplicate_candidates,
    duplicate_candidates,
    invalid_members,
    merge_people,
    normalize_dirty_member_names,
    person_brief,
    plan_auto_merge,
    plan_dirty_member_names,
    preview_token,
)
from app.services.roster_reconciliation import preview_roster_reconciliation, reconcile_department_roster
from app.services.department_roster_reset import reset_department_members_from_roster
from app.services.unitwise_call_levels import preview_call_level_prefill, prefill_call_levels_from_unitwise
from app.services.member_profiles import call_level_on, local_today, record_call_change
from app.domain.member_validation import normalize_member_display_name, normalize_member_call, normalize_member_status

router = APIRouter(dependencies=[Depends(current_user)])


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
    revision: str
    call_level_changes: list[dict]
    effective_call_level: str | None
    aliases: list[AliasRead]
    designations: list[DesignationRead]


class MemberCreate(BaseModel):
    canonical_name: str
    active_status: str = "active"
    call_level: str | None = None
    # Admin override: create the member even though the name is close to an existing one.
    confirm_distinct: bool = False

    _name = field_validator("canonical_name")(normalize_member_display_name)
    _status = field_validator("active_status")(normalize_member_status)
    _call = field_validator("call_level")(normalize_member_call)

    @model_validator(mode="after")
    def validate_fields(self):
        self.canonical_name = validate_identity(self.canonical_name, self.active_status, self.call_level)
        return self



class MemberUpdate(BaseModel):
    revision: str | None = None
    canonical_name: str
    active_status: str = "active"
    call_level: str | None = None

    _name = field_validator("canonical_name")(normalize_member_display_name)
    _status = field_validator("active_status")(normalize_member_status)
    _call = field_validator("call_level")(normalize_member_call)

    @model_validator(mode="after")
    def validate_fields(self):
        self.canonical_name = validate_identity(self.canonical_name, self.active_status, self.call_level)
        return self



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


class ConfirmRequest(BaseModel):
    """Body for the preview/confirm admin tools. Empty (or confirm=false) = preview only."""
    confirm: bool = False
    preview_token: str | None = None


class CleanupResult(BaseModel):
    normalized: int = 0
    deleted: int
    mode: str = "applied"
    preview_token: str = ""
    renames: list[dict] = []
    collisions: list[dict] = []
    to_delete: list[dict] = []


class AutoMergeResultRead(BaseModel):
    merged_groups: int
    merged_people: int
    remaining_groups: int
    mode: str = "applied"
    preview_token: str = ""
    groups: list[dict] = []
    needs_review: list[dict] = []


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
    mode: str = "applied"
    preview_token: str = ""
    needs_review: int = 0
    rows: list[dict] = []


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
    mode: str = "applied"
    preview_token: str = ""
    changes: int = 0
    needs_review: int = 0
    rows: list[dict] = []


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
    from app.services.member_profile import default_call_level_on
    return MemberRead(
        id=person.id,
        canonical_name=person.canonical_name,
        active_status=person.active_status,
        call_level=person.call_level,
        archived_at=person.archived_at,
        revision=revision(person),
        effective_call_level=default_call_level_on(person, date.today()),
        call_level_changes=[{"id": str(c.id), "call_level": c.call_level,
                             "effective_from": str(c.effective_from), "notes": c.notes}
                            for c in sorted(person.call_level_changes, key=lambda c: c.effective_from)],
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
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return person


@router.get("/admin/members")
def list_members(q: str | None = None, db: Session = Depends(get_db)) -> list[MemberRead]:
    statement = select(Person).options(
        selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes)
    )
    if q:
        statement = statement.where(Person.canonical_name.ilike(f"%{q}%"))
    statement = statement.order_by(Person.canonical_name)
    return [member_to_read(person) for person in db.scalars(statement)]


@router.post("/admin/members", dependencies=[Depends(require_admin)])
def create_member(payload: MemberCreate, db: Session = Depends(get_db),
                  operator: UserAccount = Depends(require_admin)) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    canonical_name = payload.canonical_name.strip()
    existing = db.scalar(
        select(Person)
        .where(func.lower(Person.canonical_name) == canonical_name.lower())
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f'Member already exists as {existing.active_status}: {existing.canonical_name}',
        )

    ensure_unique_name(db, canonical_name)
    if not payload.confirm_distinct:
        from app.services.member_resolver import MemberIndex
        near = MemberIndex.load(db).near_duplicates(canonical_name)
        if near:
            listed = ", ".join(f"{c.name} ({c.status})" for c in near)
            raise HTTPException(status_code=409, detail={
                "code": "near_duplicate",
                "message": f'"{canonical_name}" looks like an existing member: {listed}. '
                           "If this is a different person, confirm that it is distinct to create it anyway.",
                "existing": [asdict(c) for c in near],
            })
    person = Person(
        canonical_name=canonical_name,
        active_status=payload.active_status,
        call_level=payload.call_level.strip() if payload.call_level else None,
        archived_at=datetime.utcnow() if payload.active_status == "archived" else None,
    )
    db.add(person)
    try:
        record_activity(db, person, operator, "member_created")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Member already exists") from exc
    db.refresh(person)
    return member_to_read(get_member_or_404(db, person.id))


@router.put("/admin/members/{person_id}", dependencies=[Depends(require_admin)])
def update_member(
    person_id: UUID,
    payload: MemberUpdate,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(require_admin),
) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    db.scalar(select(Person).where(Person.id == person_id).with_for_update())
    person = get_member_or_404(db, person_id)
    if payload.revision is not None and payload.revision != revision(person):
        raise HTTPException(409, "Another operator changed this member. Reload before saving.")
    before = snapshot(person)
    ensure_unique_name(db, payload.canonical_name, person)
    if person.canonical_name != payload.canonical_name:
        old_name = person.canonical_name
        if not any(a.alias.casefold() == old_name.casefold() for a in person.aliases):
            ensure_unique_name(db, old_name, person)
            person.aliases.append(PersonAlias(alias=old_name, source="member_rename"))
    person.canonical_name = payload.canonical_name.strip()
    person.active_status = payload.active_status
    if payload.active_status == "archived":
        person.archived_at = person.archived_at or datetime.utcnow()
    elif person.archived_at is not None:
        person.archived_at = None
    new_call = payload.call_level.strip() if payload.call_level else None
    if new_call != call_level_on(person):
        try:
            record_call_change(db, person, new_call, local_today(), "Call level updated through member management", "member_management")
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        record_activity(db, person, operator, "member_updated", before)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Canonical name already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/archive", dependencies=[Depends(require_admin)])
def archive_member(person_id: UUID, db: Session = Depends(get_db),
                   operator: UserAccount = Depends(require_admin)) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    person = get_member_or_404(db, person_id)
    if person.active_status != "archived":
        before = snapshot(person)
        person.active_status = "archived"
        person.archived_at = datetime.utcnow()
        record_activity(db, person, operator, "member_archived", before)
        db.commit()
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/restore", dependencies=[Depends(require_admin)])
def restore_member(person_id: UUID, db: Session = Depends(get_db),
                   operator: UserAccount = Depends(require_admin)) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    person = get_member_or_404(db, person_id)
    if person.active_status in {"archived", "historical", "inactive"}:
        before = snapshot(person)
        person.active_status = "active"
        person.archived_at = None
        record_activity(db, person, operator, "member_restored", before)
        db.commit()
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/aliases", dependencies=[Depends(require_admin)])
def add_alias(person_id: UUID, payload: AliasCreate, db: Session = Depends(get_db),
              operator: UserAccount = Depends(require_admin)) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    person = get_member_or_404(db, person_id)
    alias = payload.alias.strip()
    if not alias or len(alias) > 255:
        raise HTTPException(422, "Enter an alias (maximum 255 characters)")
    ensure_unique_name(db, alias, person)
    before = snapshot(person)
    person.aliases.append(PersonAlias(alias=alias, source=payload.source))
    try:
        record_activity(db, person, operator, "alias_added", before)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Alias already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.post("/admin/members/{person_id}/designations", dependencies=[Depends(require_admin)])
def add_designation(
    person_id: UUID,
    payload: DesignationCreate,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(require_admin),
) -> MemberRead:
    from app.services.reference_registry import lock_namespace
    lock_namespace(db,"normalization-edit")
    person = get_member_or_404(db, person_id)
    before = snapshot(person)
    try:
        validate_designations([*[{
            "designation": d.designation, "effective_from": d.effective_from,
            "effective_to": d.effective_to} for d in person.designations], payload.model_dump()])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    from app.services.reference_catalog import canonical_label
    db.add(
        PersonDesignation(
            person=person,
            designation=canonical_label(db,"designation",payload.designation),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            source="manual",
            notes=payload.notes,
        )
    )
    try:
        record_activity(db, person, operator, "designation_added", before)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Designation already exists") from exc
    return member_to_read(get_member_or_404(db, person_id))


@router.get("/admin/members/dedupe-candidates", dependencies=[Depends(require_admin)])
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
        .options(selectinload(Person.aliases), selectinload(Person.designations), selectinload(Person.call_level_changes))
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
        current_call = default_call_level_on(person, date.today())
        if current_call:
            call_levels[current_call] += 1
        else:
            missing_call_levels += 1
        aliases += len(person.aliases)
        designations += len(person.designations)
        current = [d for d in person.designations if d.effective_from <= date.today()
                   and (d.effective_to is None or d.effective_to >= date.today())]
        if not current:
            missing_designations += 1
            continue
        latest = max(current, key=lambda item: item.effective_from)
        positions[latest.designation] += 1
        sources[latest.source] += 1

    is_clean = not invalid and not duplicates and missing_designations == 0 and missing_call_levels == 0
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


def _confirm_token(payload: ConfirmRequest | None) -> str | None:
    """None for a preview; the token for a confirmation (422 when it is missing)."""
    if payload is None or not payload.confirm:
        return None
    if not payload.preview_token:
        raise HTTPException(status_code=422, detail="Confirming needs the preview_token from the preview; preview first")
    return payload.preview_token


def _apply_errors(action):
    """Run an apply step, turning expected failures into clear 4xx responses."""
    try:
        return action()
    except StalePreviewError as exc:
        raise HTTPException(status_code=409, detail={"code": "stale_preview", "message": str(exc)}) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Source workbook not found: {exc.filename or exc}") from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="The change would create a duplicate name or alias; preview again") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _cleanup_plan(db: Session) -> dict:
    names = plan_dirty_member_names(db)
    to_delete = [person_brief(p) for p in invalid_members(db)]
    return {**names, "to_delete": to_delete, "preview_token": preview_token({**names, "to_delete": to_delete})}


@router.post("/admin/members/cleanup-invalid", dependencies=[Depends(require_admin)])
def cleanup_invalid_members(payload: ConfirmRequest | None = Body(default=None), db: Session = Depends(get_db),
                            operator: UserAccount = Depends(require_admin)) -> CleanupResult:
    """Preview (no body / confirm=false) or apply (confirm + preview_token) the name cleanup.

    Cleaned names that collide with another member are reported, never merged."""
    token = _confirm_token(payload)
    plan = _cleanup_plan(db)
    if token is None:
        return CleanupResult(normalized=len(plan["renames"]), deleted=len(plan["to_delete"]), mode="preview",
                             preview_token=plan["preview_token"], renames=plan["renames"],
                             collisions=plan["collisions"], to_delete=plan["to_delete"])

    def operation():
        check_preview_token(plan["preview_token"], token, "name cleanup")
        normalized = normalize_dirty_member_names(db)
        deleted = delete_invalid_members(db)
        return CleanupResult(normalized=normalized, deleted=deleted, preview_token=plan["preview_token"],
                             renames=plan["renames"], collisions=plan["collisions"], to_delete=plan["to_delete"])
    return _apply_errors(lambda: audited_member_operation(db, operator, "invalid_names_cleaned", operation))


@router.post("/admin/members/auto-merge-duplicates", dependencies=[Depends(require_admin)])
def auto_merge_duplicates(payload: ConfirmRequest | None = Body(default=None), db: Session = Depends(get_db),
                          operator: UserAccount = Depends(require_admin)) -> AutoMergeResultRead:
    """Preview, or apply with confirm + preview_token, merges of members whose canonical
    names are identical. Groups that only share an alias are listed, never merged."""
    token = _confirm_token(payload)
    plan = plan_auto_merge(db)
    if token is None:
        return AutoMergeResultRead(merged_groups=len(plan["groups"]),
                                   merged_people=sum(len(g["sources"]) for g in plan["groups"]),
                                   remaining_groups=len(duplicate_candidates(db)), mode="preview",
                                   preview_token=plan["preview_token"], groups=plan["groups"],
                                   needs_review=plan["needs_review"])
    return _apply_errors(lambda: audited_member_operation(db, operator, "duplicates_merged",
        lambda: AutoMergeResultRead(**auto_merge_duplicate_candidates(db, token).__dict__,
                                    preview_token=plan["preview_token"], groups=plan["groups"],
                                    needs_review=plan["needs_review"])))


@router.post("/admin/members/reconcile-trusted-roster", dependencies=[Depends(require_admin)])
def reconcile_trusted_roster(payload: ConfirmRequest | None = Body(default=None), db: Session = Depends(get_db),
                             operator: UserAccount = Depends(require_admin)) -> RosterReconciliationRead:
    """Preview, or apply with confirm + preview_token. Only certain matches are renamed or
    merged; similar names are listed as needs_review with candidates."""
    token = _confirm_token(payload)
    if token is None:
        return _apply_errors(lambda: RosterReconciliationRead(**preview_roster_reconciliation(db).__dict__))
    return _apply_errors(lambda: audited_member_operation(db, operator, "roster_reconciled",
        lambda: RosterReconciliationRead(**reconcile_department_roster(db, token=token).__dict__)))


# Existing admin-only roster reset deletes members, units,
# periods, slots, assignments, leave, mappings, import history and rule settings, then
# recreates members from the roster workbook. Fails with a foreign-key error on
# PostgreSQL once call clusters / generation scopes / runs / approvals exist.
@router.post("/admin/members/reset-from-trusted-roster", dependencies=[Depends(require_admin)])
def reset_from_trusted_roster(db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)) -> DepartmentRosterResetRead:
    return audited_member_operation(db, operator, "trusted_roster_reset",
        lambda: DepartmentRosterResetRead(**reset_department_members_from_roster(db).__dict__))


@router.post("/admin/members/prefill-call-levels", dependencies=[Depends(require_admin)])
def prefill_call_levels(payload: ConfirmRequest | None = Body(default=None), db: Session = Depends(get_db),
                        operator: UserAccount = Depends(require_admin)) -> CallLevelPrefillRead:
    """Preview, or apply with confirm + preview_token. Only rows the resolver matched with
    certainty change a level; review rows and all other members are left unchanged."""
    token = _confirm_token(payload)
    if token is None:
        return _apply_errors(lambda: CallLevelPrefillRead(**preview_call_level_prefill(db).__dict__))
    return _apply_errors(lambda: audited_member_operation(db, operator, "call_levels_prefilled",
        lambda: CallLevelPrefillRead(**prefill_call_levels_from_unitwise(db, token=token).__dict__)))


@router.post("/admin/members/merge", dependencies=[Depends(require_admin)])
def merge_members(payload: MergeRequest, db: Session = Depends(get_db), operator: UserAccount = Depends(require_admin)) -> MemberRead:
    """Merge ``source_person_ids`` into ``target_person_id`` (moves history, keeps old names as aliases)."""
    try:
        person = audited_member_operation(db, operator, "members_merged",
            lambda: merge_people(db, payload.target_person_id, payload.source_person_ids))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Merge produced a duplicate record") from exc
    return member_to_read(get_member_or_404(db, person.id))
