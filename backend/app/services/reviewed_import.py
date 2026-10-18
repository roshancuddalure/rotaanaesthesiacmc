"""Bind import review to source, options and the relevant master-data snapshot."""
import hashlib
import hmac
import json
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app.models import AdminMapping, ImportBatch, ImportSourceRecord, LeaveRequest, Person, PersonAlias, PersonCallChange, PersonPosting, Unit, UnitCallMinimum


class StalePreviewError(ValueError):
    pass


def acquire_import_lock(db: Session) -> None:
    # Use the same global edit lock as normalization before taking the import lock.
    from app.services.reference_registry import lock_namespace
    lock_namespace(db, "normalization-edit")
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 1877026829})
    db.flush()
    db.expire_all()


def reviewed_hash(db: Session, kind: str, filename: str, content: bytes, month: str,
                  options: dict, rows: list) -> str:
    snapshot = {}
    for model in [Person, PersonAlias, PersonCallChange, PersonPosting, LeaveRequest, Unit, UnitCallMinimum, AdminMapping]:
        records = list(db.scalars(select(model).order_by(model.id)))
        snapshot[model.__tablename__] = [
            {column.name: getattr(record, column.name) for column in model.__table__.columns}
            for record in records
        ]
    payload = {"version": 1, "kind": kind, "filename": filename, "source": hashlib.sha256(content).hexdigest(),
               "month": month, "options": options, "rows": rows, "snapshot": snapshot}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def verify_reviewed_hash(provided: str, expected: str) -> None:
    if not provided:
        raise ValueError("Preview this file and review the proposed changes before applying it.")
    if not hmac.compare_digest(provided, expected):
        raise StalePreviewError("The file, options or saved records changed after review. Preview again before applying.")


def request_fingerprint(filename: str, content: bytes, options: dict) -> str:
    payload = [filename, hashlib.sha256(content).hexdigest(), options]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def replayed_result(db: Session, kind: str, key: str, actor_id: str,
                    filename: str, content: bytes, options: dict) -> dict | None:
    if not key:
        return None
    batch = db.scalar(select(ImportBatch).where(
        ImportBatch.import_kind == kind, ImportBatch.status == "completed",
        ImportBatch.source_metadata["preview_hash"].as_string() == key,
        ImportBatch.source_metadata["actor_id"].as_string() == actor_id,
    ).order_by(ImportBatch.completed_at.desc()))
    if batch is None:
        return None
    metadata = batch.source_metadata
    fingerprint = metadata.get("request_fingerprint")
    if fingerprint is None:
        return None  # Pre-upgrade batches require a new review.
    if fingerprint != request_fingerprint(filename, content, options):
        raise StalePreviewError("This review key was already used with different file or options. Preview again.")
    return {**metadata["result"], "batch_id": str(batch.id), "replayed": True}


def attach_result(batch: ImportBatch, result: dict, filename: str, content: bytes, options: dict) -> None:
    batch.source_metadata = {**batch.source_metadata,
                             "request_fingerprint": request_fingerprint(filename, content, options),
                             "result": json.loads(json.dumps(result, default=str))}


def record_workflow_batch(db: Session, kind: str, filename: str, content: bytes, month: str,
                          options: dict, actor_id: str, key: str, result: dict) -> ImportBatch:
    batch = ImportBatch(source_filename=filename[:255], import_kind=kind, status="completed",
                        completed_at=datetime.utcnow(), source_metadata={
                            "actor_id": actor_id, "month": month, "preview_hash": key,
                            "file_sha256": hashlib.sha256(content).hexdigest(),
                            "counts": {"created": result["created_rows"], "skipped": result["skipped_rows"],
                                       "replaced_intervals": result.get("deleted_existing_rows", 0)},
                            "options": options,
                        })
    db.add(batch)
    for row in result["preview"]["rows"]:
        record_id = row.get("record_id")
        db.add(ImportSourceRecord(batch=batch, sheet_name=str(row.get("sheet_name") or "")[:255],
                                 row_index=row.get("row_number"), record_type=kind,
                                 raw_value=json.dumps({k:v for k,v in row.items() if k.startswith("raw_")}, default=str),
                                 cleaned_value=json.dumps(row, default=str),
                                 normalized_table="leave_requests" if kind == "leave_upload" else "person_postings",
                                 normalized_id=UUID(record_id) if record_id else None,
                                 notes=json.dumps({"action": "created" if record_id else "skipped", "issues": row.get("issues", [])})))
    db.flush()
    result["batch_id"] = str(batch.id)
    result["replayed"] = False
    attach_result(batch, result, filename, content, options)
    return batch
