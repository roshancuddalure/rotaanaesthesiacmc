"""Merging duplicate member records safely, with a preview and an exact undo.

How a merge runs (``run_merge``):
1. Every column that refers to a person is found from the database model itself
   (``person_references``), so tables added later are covered automatically.
2. Each referring row of a merged-away member is re-pointed to the kept member. Where that
   would duplicate something the kept member already has, a rule decides:
   - same duty slot: keep one assignment;
   - same posting, leave, rule or "different person" pair: keep the kept member's;
   - same position or eligibility group from the same date: combine their dates and notes;
   - same call-level change date with a different level: a conflict the admin resolves
     (default keeps the kept member's level).
3. Before anything is committed the result is verified: no row may still refer to a
   merged-away member. Otherwise the whole merge is rolled back.
4. Every changed row's before-image is stored in ``member_merges`` so ``undo_merge`` can put
   the database back exactly, or refuses with the reasons if later changes prevent that.

A preview runs the same merge inside a savepoint and rolls it back, so what the admin
reviews is exactly what will happen.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Table, and_, delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models import MemberMerge, Person, UserAccount

PERSON_COLUMN_NAMES = {"person_id", "from_person_id", "to_person_id", "person_a_id", "person_b_id"}
NOT_REFERENCES = {"member_merges", "deleted_records"}  # audit/recovery stores, never re-pointed

TABLE_LABELS = {
    "duty_assignments": "duty assignments",
    "leave_requests": "leave records",
    "person_postings": "unit postings",
    "person_aliases": "aliases",
    "person_designations": "positions",
    "member_call_level_changes": "dated call levels",
    "person_call_changes": "call-level history",
    "person_call_cluster_memberships": "eligibility groups",
    "person_comments": "comments",
    "member_activity": "activity records",
    "member_resolution_rules": "name rules",
    "member_distinct_pairs": "'different person' decisions",
    "rota_exchange_requests": "exchange requests",
    "rota_auto_fill_events": "auto-fill records",
}


class MergeError(ValueError):
    """A merge that cannot run; the message says why and nothing has been changed."""


class MergeConflict(MergeError):
    pass


class UndoBlocked(MergeError):
    def __init__(self, message: str, blockers: list[str]):
        super().__init__(message)
        self.blockers = blockers


@dataclass
class Step:
    table: str
    action: str  # move | drop | modify | insert | remove_person
    pk: dict
    before: dict | None = None
    changes: dict = field(default_factory=dict)  # column -> new value (move/modify)
    note: str = ""

    def key(self) -> list:
        """What the step does, without values that differ each run (new ids, timestamps)."""
        if self.action == "insert":
            return [self.table, self.action, sorted((k, str(v)) for k, v in self.changes.items()
                                                    if k not in {"id", "created_at"})]
        return [self.table, self.action, sorted((k, str(v)) for k, v in self.pk.items()),
                sorted((k, str(v)) for k, v in self.changes.items())]


# -- row (de)serialisation -------------------------------------------------------------------

def to_json(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def from_json(table: Table, column: str, value):
    if value is None:
        return None
    try:
        kind = table.c[column].type.python_type
    except (NotImplementedError, KeyError):
        return value
    if kind is UUID and not isinstance(value, UUID):
        return UUID(str(value))
    if kind is datetime and isinstance(value, str):
        return datetime.fromisoformat(value)
    if kind is date and isinstance(value, str):
        return date.fromisoformat(value[:10])
    if kind is Decimal and not isinstance(value, Decimal):
        return Decimal(str(value))
    return value


def row_json(row) -> dict:
    return {k: to_json(v) for k, v in row._mapping.items()}


def row_values(table: Table, data: dict) -> dict:
    return {k: from_json(table, k, v) for k, v in data.items() if k in table.c}


def pk_of(table: Table, data: dict) -> dict:
    return {c.name: data[c.name] for c in table.primary_key.columns}


def pk_clause(table: Table, pk: dict):
    return and_(*(table.c[k] == from_json(table, k, v) for k, v in pk.items()))


# -- discovery ---------------------------------------------------------------------------------

def person_references() -> list[tuple[Table, str]]:
    """Every (table, column) that holds a member id: foreign keys to persons, plus the
    audit columns that keep a member id without a foreign key."""
    persons = Base.metadata.tables["persons"]
    found: dict[tuple[str, str], tuple[Table, str]] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in NOT_REFERENCES or table is persons:
            continue
        for column in table.columns:
            refers = any(fk.column.table is persons for fk in column.foreign_keys)
            if refers or column.name in PERSON_COLUMN_NAMES:
                found[(table.name, column.name)] = (table, column.name)
    return [found[k] for k in sorted(found)]


def _label(table: str) -> str:
    return TABLE_LABELS.get(table, table.replace("_", " "))


# -- the merge -------------------------------------------------------------------------------

class _Merger:
    def __init__(self, db: Session, target: Person, choices: dict[str, str]):
        self.db, self.target, self.choices = db, target, choices or {}
        self.steps: list[Step] = []
        self.conflicts: list[dict] = []
        self.combined: list[str] = []
        self.warnings: list[str] = []

    # helpers
    def rows(self, table: Table, column: str, value) -> list[dict]:
        return [row_json(r) for r in self.db.execute(select(table).where(table.c[column] == value)).all()]

    def move(self, table: Table, row: dict, column: str, extra: dict | None = None, note: str = ""):
        changes = {column: str(self.target.id), **(extra or {})}
        self.db.execute(update(table).where(pk_clause(table, pk_of(table, row)))
                        .values(**row_values(table, changes)))
        self.steps.append(Step(table.name, "move", pk_of(table, row), row, changes, note))

    def drop(self, table: Table, row: dict, note: str):
        self.db.execute(delete(table).where(pk_clause(table, pk_of(table, row))))
        self.steps.append(Step(table.name, "drop", pk_of(table, row), row, {}, note))
        if note:
            self.combined.append(note)

    def modify(self, table: Table, row: dict, changes: dict, note: str):
        changes = {k: v for k, v in changes.items() if to_json(v) != row.get(k)}
        if not changes:
            return
        self.db.execute(update(table).where(pk_clause(table, pk_of(table, row)))
                        .values(**row_values(table, {k: to_json(v) for k, v in changes.items()})))
        self.steps.append(Step(table.name, "modify", pk_of(table, row), row,
                               {k: to_json(v) for k, v in changes.items()}, note))

    def target_rows(self, table: Table, column: str = "person_id") -> list[dict]:
        return self.rows(table, column, self.target.id)

    # per-table rules
    def merge_source(self, source: Person):
        tid = str(self.target.id)
        source_name = source.canonical_name
        for table, column in person_references():
            name = table.name
            for row in self.rows(table, column, source.id):
                if name == "duty_assignments":
                    same = [t for t in self.target_rows(table) if t["duty_slot_id"] == row["duty_slot_id"]]
                    if same:
                        self.drop(table, row, f"Both records were on the same duty ({self._slot_text(row)}); kept one assignment")
                    else:
                        self.move(table, row, column)
                elif name == "person_designations":
                    same = [t for t in self.target_rows(table) if t["designation"] == row["designation"]
                            and t["effective_from"] == row["effective_from"]]
                    if same:
                        keep = same[0]
                        ends = [keep["effective_to"], row["effective_to"]]
                        self.modify(table, keep, {
                            "effective_to": None if None in ends else max(ends),
                            "notes": _join_notes(keep.get("notes"), row.get("notes")),
                        }, "")
                        self.drop(table, row, f"Combined position \"{row['designation']}\" from {row['effective_from']}")
                    else:
                        self.move(table, row, column)
                elif name == "person_call_cluster_memberships":
                    same = [t for t in self.target_rows(table) if t["cluster_id"] == row["cluster_id"]
                            and t["effective_from"] == row["effective_from"]]
                    if same:
                        keep = same[0]
                        ends = [keep["effective_to"], row["effective_to"]]
                        self.modify(table, keep, {
                            "effective_to": None if None in ends else max(ends),
                            "notes": _join_notes(keep.get("notes"), row.get("notes")),
                        }, "")
                        self.drop(table, row, f"Combined eligibility group membership from {row['effective_from']}")
                    else:
                        self.move(table, row, column)
                elif name == "member_call_level_changes":
                    same = [t for t in self.target_rows(table) if t["effective_from"] == row["effective_from"]]
                    if not same:
                        self.move(table, row, column)
                    elif same[0]["call_level"] == row["call_level"]:
                        self.drop(table, row, f"Same call level from {row['effective_from']} on both records")
                    else:
                        conflict_id = f"call_level:{row['effective_from']}"
                        choice = self.choices.get(conflict_id, "keep_target")
                        self.conflicts.append({
                            "id": conflict_id,
                            "description": (f"From {row['effective_from']} the kept record says "
                                            f"{_level(same[0]['call_level'])} but {source_name} says "
                                            f"{_level(row['call_level'])}"),
                            "options": ["keep_target", "keep_source"], "chosen": choice,
                        })
                        if choice == "keep_source":
                            self.modify(table, same[0], {"call_level": row["call_level"]}, "")
                        self.drop(table, row, f"Call level from {row['effective_from']}: kept "
                                              f"{_level(row['call_level'] if choice == 'keep_source' else same[0]['call_level'])}")
                elif name == "person_postings":
                    sig = ("unit_id", "posting_type", "starts_on", "ends_on")
                    if any(all(t[k] == row[k] for k in sig) for t in self.target_rows(table)):
                        self.drop(table, row, f"Same posting ({row['posting_type']} from {row['starts_on']}) on both records")
                    else:
                        self.move(table, row, column)
                elif name == "leave_requests":
                    sig = ("starts_on", "ends_on", "leave_slot", "leave_type")
                    if any(all(t[k] == row[k] for k in sig) for t in self.target_rows(table)):
                        self.drop(table, row, f"Same leave ({row['starts_on']} to {row['ends_on']}) on both records")
                    else:
                        self.move(table, row, column)
                elif name == "member_resolution_rules":
                    sig = ("form_key", "call_levels", "duty_areas", "effective_from", "effective_to",
                           "requires_context", "scope")
                    if any(all(t.get(k) == row.get(k) for k in sig) for t in self.target_rows(table)):
                        self.drop(table, row, f"Same name rule \"{row['form']}\" on both records")
                    else:
                        self.move(table, row, column)
                elif name == "member_distinct_pairs":
                    other = row["person_b_id"] if column == "person_a_id" else row["person_a_id"]
                    if other == tid:
                        self.drop(table, row, "")  # the two records are now one
                        continue
                    a, b = sorted([tid, other])
                    clash = self.db.execute(select(table).where(
                        table.c.person_a_id == UUID(a), table.c.person_b_id == UUID(b))).first()
                    if clash:
                        self.drop(table, row, "")
                    else:
                        self.modify(table, row, {"person_a_id": a, "person_b_id": b}, "")
                elif name == "person_call_changes":
                    self.move(table, row, column, {"source": f"merged:{row.get('source') or ''}"[:100]})
                elif name == "person_aliases":
                    self.move(table, row, column)
                else:
                    self.move(table, row, column)
        # The removed record's name stays findable as an alias of the kept member.
        aliases = Base.metadata.tables["person_aliases"]
        if source_name != self.target.canonical_name and not self.db.execute(
                select(aliases.c.id).where(aliases.c.alias == source_name)).first():
            new = {"id": str(uuid4()), "person_id": tid, "alias": source_name, "source": "dedupe_merge",
                   "created_at": datetime.utcnow().isoformat()}
            self.db.execute(insert(aliases).values(**row_values(aliases, new)))
            self.steps.append(Step("person_aliases", "insert", {"id": new["id"]}, None, new,
                                   f"\"{source_name}\" kept as an alias"))
        persons = Base.metadata.tables["persons"]
        before = row_json(self.db.execute(select(persons).where(persons.c.id == source.id)).one())
        self.db.execute(delete(persons).where(persons.c.id == source.id))
        self.steps.append(Step("persons", "remove_person", {"id": str(source.id)}, before, {}, ""))

    def _slot_text(self, row: dict) -> str:
        slots = Base.metadata.tables.get("duty_slots")
        if slots is None:
            return "same slot"
        slot = self.db.execute(select(slots.c.duty_date, slots.c.duty_type)
                               .where(slots.c.id == UUID(row["duty_slot_id"]))).first()
        return f"{slot.duty_type} on {slot.duty_date}" if slot else "same slot"

    def verify(self, source_ids: list[UUID]):
        """Nothing may still refer to a merged-away member."""
        left = []
        for table, column in person_references():
            n = self.db.execute(select(table.c[column]).where(table.c[column].in_(source_ids))).all()
            if n:
                left.append(f"{len(n)} {_label(table.name)}")
        persons = Base.metadata.tables["persons"]
        if self.db.execute(select(persons.c.id).where(persons.c.id.in_(source_ids))).first():
            left.append("the merged record itself")
        if left:
            raise MergeError("Merge stopped and nothing was changed: these still refer to the merged "
                             f"record: {', '.join(left)}")


def _level(value) -> str:
    """'4TH_CALL' -> '4th call' for messages."""
    return str(value or "no call level").replace("_CALL", " call").replace("_", " ").lower()


def _join_notes(a, b):
    parts = [p for p in (a, b) if p]
    return "\n".join(dict.fromkeys(parts)) or None


def _summary(merger: _Merger) -> dict:
    moves = Counter(_label(s.table) for s in merger.steps if s.action == "move")
    return {
        "moves": dict(sorted(moves.items())),
        "combined": [n for n in merger.combined if n],
        "conflicts": merger.conflicts,
        "warnings": merger.warnings,
    }


def _token(steps: list[Step]) -> str:
    return hashlib.sha256(json.dumps([s.key() for s in steps], default=str).encode()).hexdigest()[:32]


def _load(db: Session, target_id: UUID, source_ids: list[UUID]) -> tuple[Person, list[Person]]:
    if target_id in source_ids:
        raise MergeError("The member you keep cannot also be merged away")
    target = db.get(Person, target_id)
    if target is None:
        raise MergeError("The member to keep no longer exists; refresh and try again")
    sources = []
    for source_id in dict.fromkeys(source_ids):
        source = db.get(Person, source_id)
        if source is None:
            raise MergeError("A member to merge no longer exists (already merged or deleted); refresh the list")
        sources.append(source)
    if not sources:
        raise MergeError("Choose at least one member to merge")
    return target, sources


def _warnings(db: Session, target: Person, sources: list[Person]) -> list[str]:
    from app.services.member_bulk import _shared_duty_days

    out = []
    for source in sources:
        shared = _shared_duty_days(db, str(target.id), str(source.id))
        if shared:
            out.append(f"{target.canonical_name} and {source.canonical_name} were both on duty on {shared} "
                       "same days. Merging is right only if one person was recorded twice.")
        if source.active_status == "active" and target.active_status != "active":
            out.append(f"You are keeping a {target.active_status} record and merging away an active one.")
    return out


def run_merge(db: Session, target_id: UUID, source_ids: list[UUID], *, choices: dict | None = None,
              preview: bool = False, preview_token: str | None = None,
              operator: UserAccount | None = None) -> dict:
    """Preview (rolled back) or apply a merge. Returns the summary, token and merge id."""
    target, sources = _load(db, target_id, source_ids)
    warnings = _warnings(db, target, sources)
    names = [s.canonical_name for s in sources]
    db.flush()
    savepoint = db.begin_nested()
    merger = _Merger(db, target, choices or {})
    merger.warnings = warnings
    try:
        for source in sources:
            merger.merge_source(source)
        merger.verify([s.id for s in sources])
        db.flush()
    except IntegrityError as exc:
        savepoint.rollback()
        raise MergeError(f"Merge stopped and nothing was changed: {_explain(exc)}") from exc
    except MergeError:
        savepoint.rollback()
        raise
    token = _token(merger.steps)
    summary = _summary(merger)
    if preview:
        savepoint.rollback()
        db.expire_all()
        return {"preview_token": token, "target": {"id": str(target_id), "name": target.canonical_name},
                "sources": [{"id": str(s), "name": n} for s, n in zip(source_ids, names)], **summary}
    if preview_token is not None and preview_token != token:
        savepoint.rollback()
        db.expire_all()
        from app.services.members import StalePreviewError

        raise StalePreviewError("The records changed since the merge preview; review the new preview")
    savepoint.commit()
    record = MemberMerge(
        target_id=target_id, target_name=target.canonical_name,
        source_ids=[str(s.id) for s in sources], source_names=names, summary=summary,
        payload={"steps": [s.__dict__ for s in merger.steps]},
        operator_id=getattr(operator, "id", None),
        operator_name=(getattr(operator, "display_name", None) or getattr(operator, "username", None) or "system"),
    )
    db.add(record)
    db.flush()
    db.expire_all()
    return {"merge_id": str(record.id), "preview_token": token, **summary}


def _explain(exc: IntegrityError) -> str:
    text = str(getattr(exc, "orig", exc)).splitlines()[0]
    for table, label in TABLE_LABELS.items():
        if table in text:
            return f"a conflict in {label} ({text})"
    return text


# -- undo --------------------------------------------------------------------------------------

def list_merges(db: Session, limit: int = 100) -> list[dict]:
    rows = db.scalars(select(MemberMerge).order_by(MemberMerge.merged_at.desc()).limit(limit)).all()
    return [{"merge_id": str(m.id), "merged_at": m.merged_at.isoformat(), "operator_name": m.operator_name,
             "target_id": str(m.target_id), "target_name": m.target_name, "source_names": m.source_names,
             "summary": m.summary, "undone_at": m.undone_at.isoformat() if m.undone_at else None,
             "undone_by_name": m.undone_by_name} for m in rows]


def undo_merge(db: Session, merge_id: UUID, operator: UserAccount | None = None) -> dict:
    """Put the database back exactly as before the merge, or refuse with the reasons."""
    record = db.get(MemberMerge, merge_id)
    if record is None:
        raise LookupError("Merge not found")
    if record.undone_at is not None:
        raise MergeConflict("This merge was already undone")
    steps = [Step(**s) for s in record.payload["steps"]]
    tables = Base.metadata.tables
    blockers: list[str] = []
    persons = tables["persons"]
    if not db.execute(select(persons.c.id).where(persons.c.id == record.target_id)).first():
        blockers.append(f"{record.target_name} no longer exists")
    for step in steps:
        table = tables.get(step.table)
        if table is None:
            blockers.append(f"table {step.table} no longer exists")
            continue
        current = db.execute(select(table).where(pk_clause(table, step.pk))).first()
        if step.action in {"remove_person", "drop"}:
            if current is not None:
                blockers.append(f"a {_label(step.table)} record with the same id exists again")
        elif step.action in {"move", "modify"}:
            if current is None:
                blockers.append(f"a moved {_label(step.table)} record was deleted after the merge")
            else:
                now = row_json(current)
                changed = [c for c, v in step.changes.items() if now.get(c) != v]
                if changed:
                    blockers.append(f"a {_label(step.table)} record was edited after the merge ({', '.join(changed)})")
    if blockers:
        raise UndoBlocked("This merge cannot be undone exactly because the records changed afterwards.",
                          sorted(set(blockers)))
    try:
        with db.begin_nested():
            for step in [s for s in steps if s.action == "remove_person"]:
                db.execute(insert(persons).values(**row_values(persons, step.before)))
            for step in reversed(steps):
                table = tables[step.table]
                if step.action in {"move", "modify"}:
                    restore = {c: step.before.get(c) for c in step.changes}
                    # Columns stamped automatically on update (updated_at) go back too.
                    restore.update({c.name: step.before.get(c.name) for c in table.columns
                                    if c.onupdate is not None and c.name in step.before})
                    db.execute(update(table).where(pk_clause(table, step.pk)).values(**row_values(table, restore)))
                elif step.action == "drop":
                    db.execute(insert(table).values(**row_values(table, step.before)))
                elif step.action == "insert":
                    db.execute(delete(table).where(pk_clause(table, step.pk)))
            db.flush()
    except IntegrityError as exc:
        raise UndoBlocked("Undo stopped and nothing was changed.", [_explain(exc)]) from exc
    record.undone_at = datetime.utcnow()
    record.undone_by_name = (getattr(operator, "display_name", None) or getattr(operator, "username", None)
                             or "system")
    db.flush()
    db.expire_all()
    return {"merge_id": str(record.id), "restored": record.source_names}
