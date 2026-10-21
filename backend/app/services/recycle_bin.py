"""Admin delete with a 30-day recycle bin (docs/admin_delete_contract.md).

Kinds: ``member`` (a persons row), ``leave`` (leave_requests), ``posting`` (person_postings)
and ``past_duty`` (a duty_assignments row dated before today). Selected by ids, or (except
members) by month. A delete is previewed first; the confirmation echoes the preview token
(and the typed phrase for month deletes) and runs in one transaction.

Every deleted item becomes one ``DeletedRecord`` holding a generic snapshot of the item and
its dependent rows (``{table_name: [row dicts]}``), found through the foreign keys declared in
the models. Dependent rows behind a nullable foreign key are not deleted: the reference is set
to NULL and remembered under ``_nullified`` so a restore can put it back. Restore re-inserts
the saved rows with their original ids, parents first, one transaction per item; an item that
cannot come back is reported with a reason and left in the bin.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Table, delete as sa_delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import Base
from app.domain.duty_types import DUTY_TYPES
from app.models import (
    DeletedRecord,
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    MemberActivity,
    Person,
    PersonPosting,
    Unit,
    UserAccount,
)
from app.services.leave import month_bounds
from app.services.member_profiles import local_today
from app.services.members import StalePreviewError, identity_conflict, preview_token

KINDS = ("member", "leave", "posting", "past_duty")
RETENTION_DAYS = 30
PREVIEW_ITEMS = 50
MAX_IDS = 5000
RECORDED_LIMIT = 2000
# Slots created by uploads and historical imports; live rota template slots are never removed.
REMOVABLE_SLOT_SOURCES = {"past_duty_upload", "historical_import", "historical_analysis_import"}
MEMBER_BLOCKING = {"duty_assignments": ("duty", "duties"), "leave_requests": ("leave record", "leave records"),
                   "person_postings": ("posting", "postings")}
# Nullable references that are nevertheless removed with the member (contract).
MEMBER_FORCE_DELETE = frozenset({"member_resolution_rules"})
PHRASE_WORDS = {"leave": "LEAVE", "posting": "POSTINGS", "past_duty": "PAST DUTIES"}
NULLIFIED = "_nullified"
# A missing parent in these tables makes a restore fail; other nullable references are cleared.
STRICT_PARENTS = {"persons", "duty_slots", "duty_assignments", "units", "rota_periods", "call_clusters",
                  "leave_requests", "person_postings"}
MISSING_REASONS = {
    "persons": "Its member was deleted or merged",
    "duty_slots": "Its duty slot is gone",
    "units": "Its unit no longer exists",
    "rota_periods": "Its rota month no longer exists",
    "call_clusters": "Its eligibility group no longer exists",
    "user_accounts": "Its author account no longer exists",
}
DUTY_LABELS = {d.key: d.label for d in DUTY_TYPES}


class SelectionError(ValueError):
    pass


class ConfirmPhraseError(ValueError):
    def __init__(self, expected: str):
        super().__init__(f"Type {expected} to confirm")
        self.expected = expected


class NothingToDeleteError(ValueError):
    pass


class UnknownBatchError(LookupError):
    pass


class AlreadyRestoredError(Exception):
    pass


def utcnow() -> datetime:
    """Current UTC time (naive, like every other timestamp column); tests monkeypatch this."""
    return datetime.utcnow()


# -- generic row snapshots ------------------------------------------------------------------------

def _tables() -> dict[str, Table]:
    return Base.metadata.tables  # type: ignore[return-value]


def _json_value(value):
    if value is None or isinstance(value, (bool, int, float, str, dict, list)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def _python_value(column, value):
    if value is None:
        return None
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        return value
    if python_type is UUID:
        return value if isinstance(value, UUID) else UUID(str(value))
    if python_type is datetime:
        return datetime.fromisoformat(value)
    if python_type is date:
        return date.fromisoformat(value)
    if python_type is Decimal:
        return Decimal(value)
    return value


def _snapshot(table: Table, row) -> dict:
    return {column.name: _json_value(row[column.name]) for column in table.columns}


def _dependents(table_name: str) -> list[tuple[Table, object]]:
    """(table, column) pairs whose foreign key points at ``table_name.id``."""
    found = []
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name == table_name and fk.column.name == "id":
                found.append((table, fk.parent))
    return found


def _remove(db: Session, table_name: str, ids: list, payload: dict, skip: frozenset = frozenset(),
            force_delete: frozenset = frozenset()) -> None:
    """Snapshot rows ``ids`` of ``table_name`` and everything that depends on them, then delete."""
    if not ids:
        return
    table = _tables()[table_name]
    rows = db.execute(select(table).where(table.c.id.in_(ids))).mappings().all()
    if not rows:
        return
    payload.setdefault(table_name, []).extend(_snapshot(table, row) for row in rows)
    ids = [row["id"] for row in rows]
    for dependent, column in _dependents(table_name):
        if dependent.name in skip or dependent.name == table_name:
            continue
        if column.nullable and dependent.name not in force_delete:
            refs = db.execute(select(dependent.c.id, column).where(column.in_(ids))).all()
            if refs:
                payload.setdefault(NULLIFIED, []).extend(
                    {"table": dependent.name, "id": str(ref_id), "column": column.name, "value": str(value)}
                    for ref_id, value in refs)
                db.execute(update(dependent).where(column.in_(ids)).values({column.name: None}))
            continue
        child_ids = list(db.scalars(select(dependent.c.id).where(column.in_(ids))))
        _remove(db, dependent.name, child_ids, payload, skip, force_delete)
    db.execute(sa_delete(table).where(table.c.id.in_(ids)))


# -- labels ---------------------------------------------------------------------------------------

def _day(day: date) -> str:
    return f"{day.day} {day:%b %Y}"


def _range(start: date, end: date | None) -> str:
    if end is None:
        return f"from {_day(start)}"
    if start == end:
        return _day(start)
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.day}–{end.day} {start:%b %Y}"
    if start.year == end.year:
        return f"{start.day} {start:%b} – {_day(end)}"
    return f"{_day(start)} – {_day(end)}"


def _leave_type_label(leave_type: str, slot: str | None) -> str:
    text = (leave_type or "Leave").replace("_", " ").strip().capitalize()
    if "leave" not in text.lower():
        text += " leave"
    if slot and slot.upper() != "FULL_DAY":
        text += f" ({slot.replace('_', ' ')})"
    return text


def _duty_label(duty_type: str) -> str:
    return DUTY_LABELS.get(duty_type, duty_type)


# -- selection and plans --------------------------------------------------------------------------

def confirm_phrase(kind: str, month: str) -> str:
    return f"DELETE {PHRASE_WORDS[kind]} {month}"


def _validate(kind: str, ids: list[UUID] | None, month: str | None) -> tuple[list[UUID] | None, str | None]:
    if kind not in KINDS:
        raise SelectionError(f"Unknown kind {kind!r}")
    if (ids is None) == (month is None):
        raise SelectionError("Give exactly one of ids or month")
    if month is not None:
        if kind == "member":
            raise SelectionError("Members can only be deleted by id")
        month = month.strip()
        if len(month) != 7:
            raise SelectionError("Month must be in YYYY-MM format")
        try:
            month_bounds(month)
        except ValueError as exc:
            raise SelectionError(str(exc)) from exc
        return None, month
    unique = list(dict.fromkeys(ids or []))
    if len(unique) > MAX_IDS:
        raise SelectionError(f"Select at most {MAX_IDS} items at a time")
    return unique, None


def _not_found(ids: list[UUID], found: set) -> list[dict]:
    return [{"id": str(i), "label": str(i), "reason": "Not found (it may already be deleted)"}
            for i in ids if i not in found]


def _plan_member(db: Session, ids: list[UUID]) -> dict:
    people = db.execute(select(Person.id, Person.canonical_name).where(Person.id.in_(ids))).all() if ids else []
    names = dict(people)
    blocked = _not_found(ids, set(names))
    tables = _tables()
    counts: dict[str, Counter] = {}
    for name in MEMBER_BLOCKING:
        table = tables[name]
        counts[name] = Counter(dict(db.execute(
            select(table.c.person_id, func.count()).where(table.c.person_id.in_(list(names)))
            .group_by(table.c.person_id)).all())) if names else Counter()
    items = []
    for person_id in ids:
        if person_id not in names:
            continue
        parts = []
        for name, (one, many) in MEMBER_BLOCKING.items():
            n = counts[name][person_id]
            if n:
                parts.append(f"{n} {one if n == 1 else many}")
        if parts:
            listed = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
            blocked.append({"id": str(person_id), "label": names[person_id], "reason": (
                f"Has {listed}. Archive or merge this member instead; to delete anyway, delete their "
                "leave and postings first.")})
        else:
            items.append((person_id, names[person_id]))
    linked = 0
    deletable = [i for i, _ in items]
    if deletable:
        for dependent, column in _dependents("persons"):
            if dependent.name in MEMBER_BLOCKING:
                continue
            linked += db.scalar(select(func.count()).select_from(dependent).where(column.in_(deletable))) or 0
        linked += db.scalar(select(func.count(MemberActivity.id)).where(MemberActivity.person_id.in_(deletable))) or 0
    return {"items": items, "blocked": blocked, "effects": {"linked_records": linked}}


def _plan_leave(db: Session, ids: list[UUID] | None, month: str | None) -> dict:
    statement = select(LeaveRequest.id, Person.canonical_name, LeaveRequest.leave_type, LeaveRequest.leave_slot,
                       LeaveRequest.starts_on, LeaveRequest.ends_on).join(Person, Person.id == LeaveRequest.person_id)
    if month:
        start, end = month_bounds(month)
        statement = statement.where(LeaveRequest.starts_on.between(start, end))
    else:
        statement = statement.where(LeaveRequest.id.in_(ids or []))
    rows = db.execute(statement.order_by(LeaveRequest.starts_on, Person.canonical_name, LeaveRequest.id)).all()
    items = [(row.id, f"{row.canonical_name} · {_leave_type_label(row.leave_type, row.leave_slot)} · "
                      f"{_range(row.starts_on, row.ends_on)}") for row in rows]
    blocked = _not_found(ids, {row.id for row in rows}) if ids is not None else []
    return {"items": items, "blocked": blocked, "effects": {}}


def _plan_posting(db: Session, ids: list[UUID] | None, month: str | None) -> dict:
    statement = (select(PersonPosting.id, Person.canonical_name, PersonPosting.posting_type, Unit.name.label("unit"),
                        PersonPosting.starts_on, PersonPosting.ends_on)
                 .join(Person, Person.id == PersonPosting.person_id)
                 .outerjoin(Unit, Unit.id == PersonPosting.unit_id))
    if month:
        start, end = month_bounds(month)
        statement = statement.where(PersonPosting.starts_on.between(start, end))
    else:
        statement = statement.where(PersonPosting.id.in_(ids or []))
    rows = db.execute(statement.order_by(PersonPosting.starts_on, Person.canonical_name, PersonPosting.id)).all()
    items = []
    for row in rows:
        where = f"{row.unit} ({row.posting_type})" if row.unit else row.posting_type
        items.append((row.id, f"{row.canonical_name} · {where} · {_range(row.starts_on, row.ends_on)}"))
    blocked = _not_found(ids, {row.id for row in rows}) if ids is not None else []
    return {"items": items, "blocked": blocked, "effects": {}}


def _plan_past_duty(db: Session, ids: list[UUID] | None, month: str | None) -> dict:
    today = local_today()
    statement = (select(DutyAssignment.id, DutyAssignment.duty_slot_id, DutySlot.duty_date, DutySlot.duty_type,
                        DutySlot.slot_label, DutySlot.source.label("slot_source"), Person.canonical_name)
                 .join(DutySlot, DutySlot.id == DutyAssignment.duty_slot_id)
                 .join(Person, Person.id == DutyAssignment.person_id))
    if month:
        start, end = month_bounds(month)
        statement = statement.where(DutySlot.duty_date.between(start, end), DutySlot.duty_date < today)
    else:
        statement = statement.where(DutyAssignment.id.in_(ids or []))
    rows = db.execute(statement.order_by(DutySlot.duty_date, DutySlot.duty_type, DutySlot.slot_label,
                                         Person.canonical_name, DutyAssignment.id)).all()
    blocked = _not_found(ids, {row.id for row in rows}) if ids is not None else []
    items, slot_of, slot_source = [], {}, {}
    for row in rows:
        label = f"{row.canonical_name} · {_duty_label(row.duty_type)} · {_day(row.duty_date)}"
        if row.duty_date >= today:
            blocked.append({"id": str(row.id), "label": label, "reason": "Not a past duty (dated today or later)"})
            continue
        items.append((row.id, label))
        slot_of[row.id] = row.duty_slot_id
        slot_source[row.duty_slot_id] = row.slot_source
    selected = Counter(slot_of.values())
    totals = dict(db.execute(select(DutyAssignment.duty_slot_id, func.count()).where(
        DutyAssignment.duty_slot_id.in_(list(selected))).group_by(DutyAssignment.duty_slot_id)).all()) if selected else {}
    removable = {slot for slot, n in selected.items()
                 if totals.get(slot, 0) == n and slot_source.get(slot) in REMOVABLE_SLOT_SOURCES}
    # The slot goes into the bin entry of the last of its assignments to be deleted.
    carriers = {}
    for item_id, _ in items:
        if slot_of[item_id] in removable:
            carriers[slot_of[item_id]] = item_id
    return {"items": items, "blocked": blocked, "effects": {"extra_slots": len(removable)},
            "slot_carriers": {item: slot for slot, item in carriers.items()}}


def _plan(db: Session, kind: str, ids: list[UUID] | None, month: str | None) -> dict:
    if kind == "member":
        return _plan_member(db, ids or [])
    if kind == "leave":
        return _plan_leave(db, ids, month)
    if kind == "posting":
        return _plan_posting(db, ids, month)
    return _plan_past_duty(db, ids, month)


def _token(kind: str, items: list) -> str:
    return preview_token({"kind": kind, "ids": sorted(str(item_id) for item_id, _ in items)})


def preview(db: Session, kind: str, ids: list[UUID] | None, month: str | None) -> dict:
    ids, month = _validate(kind, ids, month)
    plan = _plan(db, kind, ids, month)
    items = plan["items"]
    return {
        "kind": kind,
        "count": len(items),
        "items": [{"id": str(item_id), "label": label} for item_id, label in items[:PREVIEW_ITEMS]],
        "blocked": plan["blocked"],
        "effects": plan["effects"],
        "preview_token": _token(kind, items),
        "confirm_phrase": confirm_phrase(kind, month) if month else None,
    }


# -- delete ---------------------------------------------------------------------------------------

def _operator_name(operator: UserAccount) -> str:
    return operator.display_name or operator.username


def _remove_item(db: Session, kind: str, item_id: UUID, plan: dict) -> dict:
    payload: dict = {}
    if kind == "member":
        _remove(db, "persons", [item_id], payload, skip=frozenset(MEMBER_BLOCKING), force_delete=MEMBER_FORCE_DELETE)
        activity = _tables()["member_activity"]
        rows = db.execute(select(activity).where(activity.c.person_id == item_id)).mappings().all()
        if rows:
            payload["member_activity"] = [_snapshot(activity, row) for row in rows]
            db.execute(sa_delete(activity).where(activity.c.person_id == item_id))
    elif kind == "leave":
        _remove(db, "leave_requests", [item_id], payload)
    elif kind == "posting":
        _remove(db, "person_postings", [item_id], payload)
    else:
        from app.services.extra_duty_hooks import void_extra_duty_records
        void_extra_duty_records(db, [item_id], "deleted")
        _remove(db, "duty_assignments", [item_id], payload)
        slot_id = plan.get("slot_carriers", {}).get(item_id)
        if slot_id is not None:
            _remove(db, "duty_slots", [slot_id], payload, skip=frozenset({"duty_assignments"}))
    return payload


def _move(db: Session, operator: UserAccount, kind: str, plan: dict) -> UUID:
    batch_id = uuid4()
    now = utcnow()
    for item_id, label in plan["items"]:
        payload = _remove_item(db, kind, item_id, plan)
        db.add(DeletedRecord(batch_id=batch_id, kind=kind, entity_id=item_id, label=label[:500], payload=payload,
                             deleted_by_id=operator.id, deleted_by_name=_operator_name(operator), deleted_at=now,
                             purge_after=now + timedelta(days=RETENTION_DAYS)))
        if kind == "member":
            db.add(MemberActivity(person_id=item_id, operator_id=operator.id, operator_name=_operator_name(operator),
                                  action="member_deleted", details={"batch_id": str(batch_id), "name": label}))
        db.flush()
    return batch_id


def move_to_bin(db: Session, operator: UserAccount, kind: str, ids: list[UUID]) -> UUID:
    """Move the given items to the bin without committing (used by older delete routes)."""
    return _move(db, operator, kind, _plan(db, kind, list(ids), None))


def delete(db: Session, operator: UserAccount, kind: str, ids: list[UUID] | None, month: str | None,
           token: str | None, phrase: str | None) -> dict:
    """Delete into the bin in one transaction. Raises SelectionError, ConfirmPhraseError,
    StalePreviewError or NothingToDeleteError."""
    ids, month = _validate(kind, ids, month)
    if month is not None:
        expected = confirm_phrase(kind, month)
        if (phrase or "").strip() != expected:
            raise ConfirmPhraseError(expected)
    from app.services.reference_registry import lock_namespace
    lock_namespace(db, "normalization-edit")
    plan = _plan(db, kind, ids, month)
    if not token or token != _token(kind, plan["items"]):
        raise StalePreviewError("The selection changed since the preview. Preview again before deleting.")
    if not plan["items"]:
        raise NothingToDeleteError("Nothing can be deleted: every selected item is blocked or gone")
    try:
        batch_id = _move(db, operator, kind, plan)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"batch_id": str(batch_id), "deleted": len(plan["items"])}


# -- restore --------------------------------------------------------------------------------------

def _same(column, value):
    return column.is_(None) if value is None else column == value


def _duplicate_reason(db: Session, table_name: str, values: dict) -> str | None:
    if table_name == "persons":
        if identity_conflict(db, values.get("canonical_name") or ""):
            return f"A member named {values.get('canonical_name')} now exists"
    elif table_name == "person_aliases":
        if db.scalar(select(func.count()).select_from(_tables()[table_name]).where(
                _tables()[table_name].c.alias == values.get("alias"))):
            return f"The alias {values.get('alias')} now belongs to another member"
    elif table_name == "leave_requests":
        t = LeaveRequest
        if db.scalar(select(func.count(t.id)).where(
                t.person_id == values["person_id"], t.leave_type == values["leave_type"],
                t.leave_slot == values["leave_slot"], t.starts_on == values["starts_on"], t.ends_on == values["ends_on"])):
            return "An identical leave record now exists"
    elif table_name == "person_postings":
        t = PersonPosting
        if db.scalar(select(func.count(t.id)).where(
                t.person_id == values["person_id"], t.posting_type == values["posting_type"],
                _same(t.unit_id, values.get("unit_id")), t.starts_on == values["starts_on"],
                _same(t.ends_on, values.get("ends_on")))):
            return "An identical posting now exists"
    elif table_name == "duty_assignments":
        if db.scalar(select(func.count(DutyAssignment.id)).where(
                DutyAssignment.duty_slot_id == values["duty_slot_id"], DutyAssignment.person_id == values["person_id"])):
            return "This member is already on that duty"
    elif table_name == "duty_slots":
        s = DutySlot
        if db.scalar(select(func.count(s.id)).where(
                _same(s.rota_period_id, values.get("rota_period_id")), s.duty_date == values["duty_date"],
                s.duty_type == values["duty_type"], s.slot_label == values["slot_label"])):
            return "An identical duty slot now exists"
    return None


def _restore_payload(db: Session, payload: dict) -> str | None:
    tables = _tables()
    order = [t.name for t in Base.metadata.sorted_tables if t.name in payload]
    for name in order:
        table = tables[name]
        for row in payload[name]:
            values = {c.name: _python_value(c, row[c.name]) for c in table.columns if c.name in row}
            if db.execute(select(table.c.id).where(table.c.id == values["id"])).first():
                return "An identical record now exists"
            reason = _duplicate_reason(db, name, values)
            if reason:
                return reason
            for fk in table.foreign_keys:
                value = values.get(fk.parent.name)
                if value is None or db.execute(select(fk.column).where(fk.column == value)).first():
                    continue
                target = fk.column.table.name
                if fk.parent.nullable and target not in STRICT_PARENTS:
                    values[fk.parent.name] = None
                    continue
                return MISSING_REASONS.get(target, f"A linked record ({target}) no longer exists")
            db.execute(insert(table).values(**values))
    for ref in payload.get(NULLIFIED, []):
        table = tables.get(ref["table"])
        if table is None or ref["column"] not in table.c:
            continue
        column = table.c[ref["column"]]
        db.execute(update(table).where(table.c.id == UUID(ref["id"]), column.is_(None))
                   .values({column.name: _python_value(column, ref["value"])}))
    return None


def restore(db: Session, operator: UserAccount, batch_id: UUID) -> dict:
    """Restore every unrestored item of a batch, one transaction per item."""
    records = db.scalars(select(DeletedRecord).where(DeletedRecord.batch_id == batch_id)).all()
    if not records:
        raise UnknownBatchError(str(batch_id))
    pending = [r for r in records if r.restored_at is None]
    if not pending:
        raise AlreadyRestoredError("This batch was already restored")
    # Items that carry a removed duty slot first, so the other assignments find their slot.
    pending.sort(key=lambda r: (0 if "duty_slots" in (r.payload or {}) else 1, r.label, str(r.id)))
    work = [(r.id, r.kind, r.label, r.entity_id, r.payload or {}) for r in pending]
    from app.services.reference_registry import lock_namespace
    restored, failed = 0, []
    for record_id, kind, label, entity_id, payload in work:
        try:
            lock_namespace(db, "normalization-edit")
            reason = _restore_payload(db, payload)
            if reason is None:
                record = db.get(DeletedRecord, record_id)
                record.restored_at = utcnow()
                record.restored_by_name = _operator_name(operator)
                if kind == "member":
                    db.add(MemberActivity(person_id=entity_id, operator_id=operator.id,
                                          operator_name=_operator_name(operator), action="member_restored",
                                          details={"batch_id": str(batch_id), "name": label}))
                db.commit()
        except IntegrityError:
            reason = "An identical record now exists"
        if reason is not None:
            db.rollback()
            failed.append({"label": label, "reason": reason})
        else:
            restored += 1
    return {"restored": restored, "failed": failed}


# -- listing and purge ----------------------------------------------------------------------------

def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def purge_expired(db: Session) -> int:
    count = db.execute(sa_delete(DeletedRecord).where(DeletedRecord.purge_after < utcnow())).rowcount or 0
    db.commit()
    return count


def list_bin(db: Session) -> list[dict]:
    purge_expired(db)
    batches: dict[UUID, list[DeletedRecord]] = defaultdict(list)
    for record in db.scalars(select(DeletedRecord)):
        batches[record.batch_id].append(record)
    result = []
    for batch_id, records in batches.items():
        records.sort(key=lambda r: (r.label, str(r.id)))
        first = records[0]
        all_restored = all(r.restored_at for r in records)
        last = max((r for r in records if r.restored_at), key=lambda r: r.restored_at, default=None)
        result.append({
            "batch_id": str(batch_id),
            "kind": first.kind,
            "count": len(records),
            "labels": [r.label for r in records[:5]],
            "deleted_at": _iso(first.deleted_at),
            "deleted_by": first.deleted_by_name,
            "purge_after": _iso(first.purge_after),
            "restored_at": _iso(last.restored_at) if all_restored and last else None,
            "restored_by": last.restored_by_name if all_restored and last else None,
        })
    result.sort(key=lambda b: (b["deleted_at"] or "", b["batch_id"]), reverse=True)
    return result


def purge_batch(db: Session, batch_id: UUID) -> int:
    count = db.execute(sa_delete(DeletedRecord).where(DeletedRecord.batch_id == batch_id)).rowcount or 0
    if not count:
        db.rollback()
        raise UnknownBatchError(str(batch_id))
    db.commit()
    return count


# -- recorded past duties -------------------------------------------------------------------------

def recorded_past_duties(db: Session, month: str) -> dict:
    start, end = month_bounds(month)
    last = min(end, local_today() - timedelta(days=1))
    if last < start:
        return {"month": month, "items": [], "truncated": False}
    rows = db.execute(
        select(DutyAssignment.id, DutyAssignment.status, DutyAssignment.source, DutySlot.duty_date,
               DutySlot.duty_type, DutySlot.source.label("slot_source"), Person.id.label("member_id"),
               Person.canonical_name)
        .join(DutySlot, DutySlot.id == DutyAssignment.duty_slot_id)
        .join(Person, Person.id == DutyAssignment.person_id)
        .where(DutySlot.duty_date.between(start, last))
        .order_by(DutySlot.duty_date, DutySlot.duty_type, DutySlot.slot_label, Person.canonical_name, DutyAssignment.id)
        .limit(RECORDED_LIMIT + 1)).all()
    items = [{
        "id": str(row.id), "date": row.duty_date.isoformat(), "duty_type": row.duty_type,
        "duty_label": _duty_label(row.duty_type), "member_id": str(row.member_id), "member_name": row.canonical_name,
        "source": row.source or row.slot_source, "status": row.status,
    } for row in rows[:RECORDED_LIMIT]]
    return {"month": month, "items": items, "truncated": len(rows) > RECORDED_LIMIT}
