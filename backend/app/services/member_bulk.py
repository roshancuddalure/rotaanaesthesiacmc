"""Department-wide member actions: archive every active member (undoable by batch) and the
reviewed list of suspected duplicate pairs (docs/member_resolution_audit.md, Phase 3).

Archiving never deletes: duties, leave, postings and aliases keep pointing at the same
member ids. Every archive/restore writes one ``member_activity`` row per member carrying the
batch id; the batch itself is reconstructed from those rows, so no extra table is needed.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    MemberActivity,
    MemberDistinctPair,
    MemberResolutionRule,
    Person,
    PersonPosting,
    UserAccount,
)
from app.services.member_profile import record_activity, snapshot
from app.services.member_profiles import local_today
from app.services.members import StalePreviewError, check_preview_token, preview_token
from app.services.normalization import member_key

CONFIRM_PHRASE = "ARCHIVE ALL MEMBERS"
ARCHIVE_ACTION = "member_archived_all"
RESTORE_ACTION = "member_restored_batch"
DUPLICATE_THRESHOLD = 0.86  # same as MemberIndex.near_duplicates


class UnknownBatchError(LookupError):
    pass


def _count_by_person(db: Session, statement) -> Counter:
    return Counter({pid: n for pid, n in db.execute(statement)})


# -- archive all -----------------------------------------------------------------------------

def archive_all_preview(db: Session) -> dict:
    ids = sorted(str(i) for i in db.scalars(select(Person.id).where(Person.active_status == "active")))
    uuids = [UUID(i) for i in ids]
    if uuids:
        linked = db.scalar(select(func.count(DutyAssignment.id)).where(DutyAssignment.person_id.in_(uuids))) or 0
        future = db.scalar(select(func.count(DutyAssignment.id)).join(DutySlot, DutySlot.id == DutyAssignment.duty_slot_id)
                           .where(DutyAssignment.person_id.in_(uuids), DutySlot.duty_date >= local_today())) or 0
        leave = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.person_id.in_(uuids))) or 0
        postings = db.scalar(select(func.count(PersonPosting.id)).where(PersonPosting.person_id.in_(uuids))) or 0
    else:
        linked = future = leave = postings = 0
    counts = {"members": len(ids), "linked_duties": linked, "future_duties": future,
              "leave": leave, "postings": postings}
    return {**counts, "preview_token": preview_token({"ids": ids, **counts}),
            "confirm_phrase": CONFIRM_PHRASE}


def archive_all(db: Session, operator: UserAccount, token: str | None) -> dict:
    """Archive every active member in one transaction. Raises StalePreviewError."""
    from app.services.reference_registry import lock_namespace
    lock_namespace(db, "normalization-edit")
    check_preview_token(archive_all_preview(db)["preview_token"], token, "archive-all")
    people = db.scalars(select(Person).where(Person.active_status == "active").options(
        selectinload(Person.aliases), selectinload(Person.designations),
        selectinload(Person.call_level_changes)).with_for_update()).all()
    batch_id = str(uuid4())
    now = datetime.utcnow()
    try:
        for person in people:
            before = snapshot(person)
            person.active_status = "archived"
            person.archived_at = now
            record_activity(db, person, operator, ARCHIVE_ACTION, before, batch_id=batch_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"batch_id": batch_id, "archived": len(people)}


def _batch_rows(db: Session, action: str, batch_id: str | None = None) -> list[MemberActivity]:
    rows = db.scalars(select(MemberActivity).where(MemberActivity.action == action)
                      .order_by(MemberActivity.created_at)).all()
    return [r for r in rows if batch_id is None or (r.details or {}).get("batch_id") == batch_id]


def restore_batch(db: Session, operator: UserAccount, batch_id: str) -> dict:
    """Put back exactly the members a batch archived that are still archived by that batch.

    A member restored, re-archived or otherwise changed in status since then is skipped."""
    from app.services.reference_registry import lock_namespace
    lock_namespace(db, "normalization-edit")
    archived_rows = _batch_rows(db, ARCHIVE_ACTION, batch_id)
    if not archived_rows:
        raise UnknownBatchError(batch_id)
    restored = skipped = 0
    try:
        for row in archived_rows:
            details = row.details or {}
            person = db.scalar(select(Person).where(Person.id == row.person_id).options(
                selectinload(Person.aliases), selectinload(Person.designations),
                selectinload(Person.call_level_changes)).with_for_update())
            archived_at = (details.get("after") or {}).get("archived_at")
            if (person is None or person.active_status != "archived" or person.archived_at is None
                    or person.archived_at.isoformat() != archived_at):
                skipped += 1
                continue
            before = snapshot(person)
            person.active_status = (details.get("before") or {}).get("active_status") or "active"
            person.archived_at = None
            record_activity(db, person, operator, RESTORE_ACTION, before, batch_id=batch_id)
            restored += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"batch_id": batch_id, "restored": restored, "skipped": skipped}


def list_batches(db: Session) -> list[dict]:
    batches: dict[str, dict] = {}
    for row in _batch_rows(db, ARCHIVE_ACTION):
        batch_id = (row.details or {}).get("batch_id")
        if not batch_id:
            continue
        entry = batches.setdefault(batch_id, {"batch_id": batch_id, "at": row.created_at,
                                              "operator_name": row.operator_name, "archived": 0, "restored": 0})
        entry["archived"] += 1
    for row in _batch_rows(db, RESTORE_ACTION):
        batch_id = (row.details or {}).get("batch_id")
        if batch_id in batches:
            batches[batch_id]["restored"] += 1
    ordered = sorted(batches.values(), key=lambda b: b["at"], reverse=True)
    return [{**b, "at": b["at"].isoformat()} for b in ordered]


# -- suspected duplicates ----------------------------------------------------------------------

def pair_key(a: UUID | str, b: UUID | str) -> tuple[str, str]:
    x, y = sorted((str(a), str(b)))
    return x, y


def _pair_score(a: str, b: str, matcher: SequenceMatcher) -> float:
    """Score two comparison keys exactly as MemberIndex.near_duplicates does (0 = no match)."""
    if a == b:
        return 1.0
    contained = min(len(a), len(b)) >= 6 and (a in b or b in a)
    # Cheap upper bound first: ratio <= 2*min/(len_a+len_b).
    if not contained and 2 * min(len(a), len(b)) / (len(a) + len(b)) < DUPLICATE_THRESHOLD:
        return 0.0
    matcher.set_seq1(a)
    if not contained and matcher.quick_ratio() < DUPLICATE_THRESHOLD:
        return 0.0
    score = matcher.ratio()
    if score >= DUPLICATE_THRESHOLD:
        return max(score, 0.9) if contained else score
    return 0.9 if contained else 0.0


def suspected_duplicates(db: Session) -> list[dict]:
    """Pairs of members (any status) whose names or aliases look alike, minus reviewed pairs."""
    people = db.scalars(select(Person).options(selectinload(Person.aliases))).all()
    by_id = {p.id: p for p in people}
    labels: list[tuple[str, UUID, str, str]] = []  # key, person, written form, kind
    for person in people:
        key = member_key(person.canonical_name)
        if key:
            labels.append((key, person.id, person.canonical_name, "name"))
        for alias in person.aliases:
            akey = member_key(alias.alias)
            if akey:
                labels.append((akey, person.id, alias.alias, "alias"))
    labels.sort(key=lambda item: (item[0], str(item[1]), item[2]))

    best: dict[tuple[str, str], tuple[float, str]] = {}
    matcher = SequenceMatcher(None)
    for j, (key_b, pid_b, form_b, kind_b) in enumerate(labels):
        matcher.set_seq2(key_b)
        for key_a, pid_a, form_a, kind_a in labels[:j]:
            if pid_a == pid_b:
                continue
            score = _pair_score(key_a, key_b, matcher)
            if not score:
                continue
            pair = pair_key(pid_a, pid_b)
            if score <= best.get(pair, (0.0, ""))[0]:
                continue
            if key_a == key_b:
                reason = ("Same name" if kind_a == kind_b == "name"
                          else f'Same name form "{form_a}" / "{form_b}"')
            elif min(len(key_a), len(key_b)) >= 6 and (key_a in key_b or key_b in key_a):
                reason = f'One name contains the other: "{form_a}" / "{form_b}"'
            else:
                reason = f'Similar spelling: "{form_a}" / "{form_b}"'
            best[pair] = (round(score, 3), reason)

    dismissed = {pair_key(a, b) for a, b in db.execute(
        select(MemberDistinctPair.person_a_id, MemberDistinctPair.person_b_id))}
    # People the reviewed name rules already tell apart (one written form meaning different
    # people by call level or date, e.g. Angelin Aniruth / Angeline Mary Abraham) are known
    # to be different people, so they are not offered for merging.
    targets_by_form: dict[str, set[str]] = defaultdict(set)
    for form_key, person_id in db.execute(
            select(MemberResolutionRule.form_key, MemberResolutionRule.person_id)
            .where(MemberResolutionRule.active.is_(True), MemberResolutionRule.person_id.is_not(None))):
        targets_by_form[form_key].add(str(person_id))
    known_distinct = {pair_key(a, b) for ids in targets_by_form.values() if len(ids) > 1
                      for a in ids for b in ids if a < b}
    pairs = {k: v for k, v in best.items() if k not in dismissed and k not in known_distinct}
    involved = {UUID(i) for pair in pairs for i in pair}
    duties = postings = leave = Counter()
    if involved:
        ids = list(involved)
        duties = _count_by_person(db, select(DutyAssignment.person_id, func.count(DutyAssignment.id))
                                  .where(DutyAssignment.person_id.in_(ids)).group_by(DutyAssignment.person_id))
        postings = _count_by_person(db, select(PersonPosting.person_id, func.count(PersonPosting.id))
                                    .where(PersonPosting.person_id.in_(ids)).group_by(PersonPosting.person_id))
        leave = _count_by_person(db, select(LeaveRequest.person_id, func.count(LeaveRequest.id))
                                 .where(LeaveRequest.person_id.in_(ids)).group_by(LeaveRequest.person_id))

    def describe(person: Person) -> dict:
        return {"id": str(person.id), "canonical_name": person.canonical_name,
                "active_status": person.active_status, "call_level": person.call_level,
                "duties": duties.get(person.id, 0), "postings": postings.get(person.id, 0),
                "leave": leave.get(person.id, 0),
                "aliases": sorted((a.alias for a in person.aliases), key=str.casefold)}

    result = []
    for (a, b), (score, reason) in pairs.items():
        pa, pb = by_id[UUID(a)], by_id[UUID(b)]
        target = min((pa, pb), key=lambda p: (p.active_status != "active", -duties.get(p.id, 0),
                                              p.canonical_name.casefold(), str(p.id)))
        ordered = sorted((pa, pb), key=lambda p: (p.canonical_name.casefold(), str(p.id)))
        result.append({"pair_id": f"{a}:{b}", "similarity": score, "reason": reason,
                       "suggested_target_id": str(target.id),
                       "people": [describe(p) for p in ordered]})
    result.sort(key=lambda r: (-r["similarity"], r["people"][0]["canonical_name"].casefold(),
                               r["people"][1]["canonical_name"].casefold()))
    return result


def dismiss_pair(db: Session, operator: UserAccount, person_ids: list[UUID], note: str | None) -> str:
    """Record that two members are different people. Raises LookupError for an unknown id."""
    a, b = pair_key(*person_ids)
    for pid in (a, b):
        if db.get(Person, UUID(pid)) is None:
            raise LookupError(f"Member {pid} not found")
    existing = db.scalar(select(MemberDistinctPair).where(
        MemberDistinctPair.person_a_id == UUID(a), MemberDistinctPair.person_b_id == UUID(b)))
    if existing is None:
        db.add(MemberDistinctPair(person_a_id=UUID(a), person_b_id=UUID(b),
                                  note=(note or "").strip()[:1000] or None, operator_id=operator.id,
                                  operator_name=operator.display_name or operator.username))
        db.commit()
    return f"{a}:{b}"


__all__ = ["CONFIRM_PHRASE", "StalePreviewError", "UnknownBatchError", "archive_all", "archive_all_preview",
           "dismiss_pair", "list_batches", "restore_batch", "suspected_duplicates"]
