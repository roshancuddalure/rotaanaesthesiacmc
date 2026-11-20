"""Attributable leave history projected from existing canonical audit/recovery stores.

No second leave ledger, inferred approval event, raw file contents or private notes.
Limits are disclosed; missing legacy evidence is never a complete-history claim.
"""

import base64
import binascii
import json
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import String, and_, cast, or_, select

from app.models import (
    DeletedRecord,
    ImportBatch,
    ImportReviewBatch,
    ImportSourceRecord,
    LeaveRequest,
    MemberMerge,
    NormalizationEvent,
)

FIELDS = ("person_id", "leave_type", "leave_slot", "starts_on", "ends_on", "status", "source")
ACTIONS = {
    "leave_created", "leave_updated", "leave_cancelled", "leave_bulk_approved",
    "leave_imported", "import_replacement", "leave_split", "leave_deleted", "leave_restored",
}
MAX_RECORDS = 64
MAX_EVENTS = 200
CATEGORIES = {"audit", "imports", "recycle", "merges"}


def page_cursor(record_id, category, row_id, recorded_at):
    payload = {"v": 1, "record": str(record_id), "category": category,
               "after": [timestamp(recorded_at), str(row_id)]}
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


def read_cursor(value, record_id, category):
    try:
        if not isinstance(value, str) or len(value) > 2048:
            raise ValueError()
        data = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(data, dict) or data.get("v") != 1 or data.get("record") != str(record_id) \
                or data.get("category") != category:
            raise ValueError()
        after = data.get("after")
        if not isinstance(after, list) or len(after) != 2 or not isinstance(after[0], str):
            raise ValueError()
        recorded_at = datetime.fromisoformat(after[0])
        row_id = identity(after[1])
        if recorded_at.tzinfo is None or row_id is None:
            raise ValueError()
        return recorded_at.astimezone(timezone.utc).replace(tzinfo=None), row_id
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeError, RecursionError) as exc:
        raise ValueError("Invalid history cursor for this record and category") from exc


def identity(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def timestamp(value):
    if value is None:
        return None
    # Existing audit models store UTC as naive datetime.
    return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()


def snapshot(value):
    if value is None:
        return None
    if isinstance(value, dict):
        return {key: str(value[key]) if value[key] is not None else None
                for key in FIELDS if key in value and not isinstance(value[key], (dict, list))}
    if not isinstance(value, LeaveRequest):
        return None
    return {key: str(getattr(value, key)) if getattr(value, key) is not None else None for key in FIELDS}


def actor(actor_id, name):
    key = identity(actor_id)
    return {"id": str(key) if key else None, "name": str(name)[:255] if name else None}


def history(db, leave_id, *, category=None, cursor=None, limit=MAX_EVENTS):
    """Read only. Caller supplies authorization and transaction coherence boundary."""
    if category is not None and category not in CATEGORIES:
        raise ValueError("Unknown history evidence category")
    if type(limit) is not int or not 1 <= limit <= MAX_EVENTS:
        raise ValueError(f"History page limit must be between 1 and {MAX_EVENTS}")
    if cursor is not None and category is None:
        raise ValueError("A history cursor requires an evidence category")
    after = read_cursor(cursor, leave_id, category) if cursor is not None else None
    with db.no_autoflush:
        return _history(db, leave_id, category=category, after=after, limit=limit)


def _history(db, leave_id, *, category, after, limit):
    current = db.get(LeaveRequest, leave_id)
    events, sources, warnings, lineage = [], [], set(), set()
    pending = [leave_id]
    evidence_found = current is not None
    event_ids, related = set(), set()
    next_cursor = None
    batch_limit = limit if category else MAX_EVENTS

    def load(statement, model, dated_column, kind, *, scalar=True):
        nonlocal next_cursor
        if category is not None and category != kind:
            return []
        if after is not None:
            when, key = after
            statement = statement.where(or_(dated_column > when,
                and_(dated_column == when, model.id > key)))
        result = db.scalars(statement) if scalar else db.execute(statement)
        rows = list(result.fetchmany(batch_limit + 1))
        if category and len(rows) > batch_limit:
            last = rows[batch_limit - 1] if scalar else rows[batch_limit - 1][0]
            next_cursor = page_cursor(leave_id, kind, last.id, getattr(last, dated_column.key))
        return rows

    def link(record_id):
        related.add(record_id)
        if category is None and record_id not in lineage:
            pending.append(record_id)

    def append_event(key, action, recorded_at, author, record_id, **values):
        if key in event_ids:
            return
        event_ids.add(key)
        events.append({"id": key, "action": action, "record_id": str(record_id),
                       "recorded_at": timestamp(recorded_at), "actor": author, **values})

    while pending and len(lineage) < MAX_RECORDS:
        record_id = pending.pop(0)
        if record_id in lineage:
            continue
        lineage.add(record_id)
        rows = load(select(NormalizationEvent).where(
            NormalizationEvent.entity_id == record_id,
            NormalizationEvent.action.in_(ACTIONS),
        ).order_by(NormalizationEvent.created_at, NormalizationEvent.id).limit(batch_limit + 1),
                    NormalizationEvent, NormalizationEvent.created_at, "audit")
        if len(rows) > batch_limit and category is None:
            warnings.add("audit_events_truncated")
        for row in rows[:batch_limit]:
            evidence_found = True
            details = row.details if isinstance(row.details, dict) else {}
            parent = identity(details.get("parent_leave_id"))
            if parent:
                link(parent)
            batch_id = identity(details.get("batch_id"))
            reference = details.get("source")
            reference = reference if isinstance(reference, dict) else {}
            append_event(f"audit:{row.id}", row.action, row.created_at,
                         actor(row.operator_id, row.operator_name), record_id,
                         before=snapshot(details.get("before")), after=snapshot(details.get("after")),
                         parent_leave_id=str(parent) if parent else None,
                         batch_id=str(batch_id) if batch_id else None,
                         reason=str(details["reason"])[:2000] if isinstance(details.get("reason"), str) else None,
                         source_reference={key: reference[key] for key in ("sheet", "row")
                                           if key in reference and isinstance(reference[key], (str, int))})
            if batch_id:
                batch = db.get(ImportReviewBatch, batch_id)
                if batch and batch.kind == "leave":
                    sources.append({"id": f"review:{row.id}", "record_id": str(record_id),
                                    "kind": "reviewed_import", "batch_id": str(batch.id),
                                    "filename": batch.filename, "month": batch.month,
                                    "sheet": reference.get("sheet") if isinstance(reference.get("sheet"), str) else None,
                                    "row": reference.get("row") if isinstance(reference.get("row"), int) else None,
                                    "recorded_at": timestamp(row.created_at),
                                    "actor": actor(row.operator_id, row.operator_name)})

        imported = load(select(ImportSourceRecord, ImportBatch).join(ImportBatch).where(
            ImportSourceRecord.normalized_table == "leave_requests",
            ImportSourceRecord.normalized_id == record_id,
        ).order_by(ImportSourceRecord.created_at, ImportSourceRecord.id).limit(batch_limit + 1),
                        ImportSourceRecord, ImportSourceRecord.created_at, "imports", scalar=False)
        if len(imported) > batch_limit and category is None:
            warnings.add("import_sources_truncated")
        for source, batch in imported[:batch_limit]:
            evidence_found = True
            metadata = batch.source_metadata if isinstance(batch.source_metadata, dict) else {}
            author = actor(metadata.get("actor_id"), None)
            imported_state = None
            if source.cleaned_value:
                try:
                    if len(source.cleaned_value) > 1_000_000:
                        raise ValueError("Oversized legacy source snapshot")
                    imported_state = snapshot(json.loads(source.cleaned_value))
                except (ValueError, TypeError):
                    warnings.add("import_snapshot_unavailable")
            sources.append({"id": f"source:{source.id}", "record_id": str(record_id),
                            "kind": "source_record", "batch_id": str(batch.id),
                            "filename": batch.source_filename, "sheet": source.sheet_name,
                            "row": source.row_index, "recorded_at": timestamp(source.created_at),
                            "actor": author})
            append_event(f"import:{source.id}", "leave_source_recorded", source.created_at,
                         author, record_id, source_record_id=str(source.id), batch_id=str(batch.id),
                         after=imported_state)

        deleted = load(select(DeletedRecord).where(
            DeletedRecord.kind == "leave", DeletedRecord.entity_id == record_id,
        ).order_by(DeletedRecord.deleted_at, DeletedRecord.id).limit(batch_limit + 1),
                       DeletedRecord, DeletedRecord.deleted_at, "recycle")
        if len(deleted) > batch_limit and category is None:
            warnings.add("recycle_records_truncated")
        for row in deleted[:batch_limit]:
            evidence_found = True
            represented = {(e["action"], e.get("batch_id"), e["record_id"]) for e in events}
            # A paged audit may not include the corresponding event. Check exact batch
            # attribution before falling back to legacy bin-only evidence.
            for action in ("leave_deleted", "leave_restored"):
                if db.scalar(select(NormalizationEvent.id).where(
                    NormalizationEvent.entity_id == record_id, NormalizationEvent.action == action,
                    NormalizationEvent.details["batch_id"].as_string() == str(row.batch_id),
                ).limit(1)):
                    represented.add((action, str(row.batch_id), str(record_id)))
            if ("leave_deleted", str(row.batch_id), str(record_id)) not in represented:
                append_event(f"bin:{row.id}:delete", "leave_deleted", row.deleted_at,
                             actor(row.deleted_by_id, row.deleted_by_name), record_id,
                             batch_id=str(row.batch_id), recoverable_until=timestamp(row.purge_after))
            if row.restored_at and ("leave_restored", str(row.batch_id), str(record_id)) not in represented:
                append_event(f"bin:{row.id}:restore", "leave_restored", row.restored_at,
                             actor(None, row.restored_by_name), record_id, batch_id=str(row.batch_id))

        # Existing recovery payloads have exact leave PKs, but no relational per-leave index.
        # Filter payload text first, then verify exact typed PK in Python; never match names.
        merges = load(select(MemberMerge).where(
            cast(MemberMerge.payload, String).contains(str(record_id)),
        ).order_by(MemberMerge.merged_at, MemberMerge.id).limit(batch_limit + 1),
                      MemberMerge, MemberMerge.merged_at, "merges")
        if len(merges) > batch_limit and category is None:
            warnings.add("merge_records_truncated")
        for row in merges[:batch_limit]:
            payload = row.payload if isinstance(row.payload, dict) else {}
            steps = payload.get("steps", [])
            survivors = payload.get("leave_survivors", {})
            survivors = survivors if isinstance(survivors, dict) else {}
            for number, step in enumerate(steps if isinstance(steps, list) else []):
                if not isinstance(step, dict) or step.get("table") != "leave_requests":
                    continue
                pk = step.get("pk")
                original_id = identity(pk.get("id")) if isinstance(pk, dict) else None
                survivor = identity(step.get("survivor_id") or survivors.get(str(original_id)))
                if original_id is None or record_id not in {original_id, survivor}:
                    continue
                evidence_found = True
                if survivor:
                    link(original_id)
                    link(survivor)
                append_event(f"merge:{row.id}:{number}", "leave_identity_merged", row.merged_at,
                             actor(row.operator_id, row.operator_name), original_id,
                             merge_id=str(row.id), operation=step.get("action"),
                             survivor_leave_id=str(survivor) if survivor else None,
                             before=snapshot(step.get("before")), changes=snapshot(step.get("changes")))
                if step.get("action") == "drop" and survivor is None:
                    warnings.add("merge_duplicate_survivor_link_unavailable")
                if row.undone_at:
                    append_event(f"merge:{row.id}:{number}:undo", "leave_identity_merge_undone",
                                 row.undone_at, actor(None, row.undone_by_name), original_id,
                                 merge_id=str(row.id))

    if pending:
        warnings.add("lineage_truncated")
    if not evidence_found and category is None:
        return None
    warnings.add("legacy_history_may_be_incomplete")
    if current and not events and category is None:
        warnings.add("no_attributable_lifecycle_events")
    events.sort(key=lambda row: (row["recorded_at"] or "", row["id"]))
    sources.sort(key=lambda row: (row["recorded_at"] or "", row["id"]))
    return {"leave_id": str(leave_id), "current": snapshot(current), "record_present": current is not None,
            "record_created_at": timestamp(current.created_at) if current else None,
            "record_updated_at": timestamp(current.updated_at) if current else None,
            "lineage_ids": sorted(map(str, lineage)), "events": events, "sources": sources,
            "related_record_ids": sorted(map(str, related)),
            "unvisited_record_ids": sorted(str(key) for key in set(pending) - lineage),
            "evidence_pages": [
                {"record_id": str(key), "category": kind,
                 "url": f"/api/v1/leave/requests/{key}/history/page?category={kind}"}
                for key in sorted(lineage, key=str) for kind in sorted(CATEGORIES)],
            "pagination": {"category": category, "limit": batch_limit,
                           "next_cursor": next_cursor, "has_more": next_cursor is not None,
                           "basis": "Keyset over retained backing rows; a page can contain multiple events or no projected events."},
            "coverage": {"complete": False, "warnings": sorted(warnings),
                         "basis": "Recorded audit, import and recovery evidence; no inferred attendance or approval."}}
