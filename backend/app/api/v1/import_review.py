"""Common preview, correction and frozen apply for unitwise and leave imports."""

import hashlib
import json
from zipfile import BadZipFile
from openpyxl.utils.exceptions import InvalidFileException
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import ImportReviewBatch, LeaveRequest, PersonPosting, UserAccount
from app.services.leave import month_bounds
from app.services.operational_import import (
    FIELDS,
    HEADER_MAP,
    apply_batch,
    fingerprint,
    normalize_rows,
    read_rows,
    record_values,
    tabular_records,
)
from app.services.normalization import label_key

router = APIRouter(prefix="/import-review", dependencies=[Depends(current_user)])


class ReviewApply(BaseModel):
    excluded: list[str] = []
    acknowledge_warnings: bool = False


@router.post("/columns")
async def columns(file: UploadFile = File(...)):
    try:
        tables = tabular_records(file.filename or "upload", await file.read(5 * 1024 * 1024 + 1))
        headers = list(
            dict.fromkeys(
                h
                for _, records in tables
                for h in next((r for r in records if any(v.strip() for v in r)), [])
            )
        )
        return {
            "headers": headers,
            "fields": list(FIELDS),
            "suggested": {h: HEADER_MAP.get(label_key(h), "") for h in headers},
        }
    except (ValueError, TypeError, BadZipFile, InvalidFileException) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/{kind}/preview")
async def preview(
    kind: str,
    month: str = Form(...),
    mode: str = Form("append"),
    settings_json: str = Form("{}"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(current_user),
):
    if kind not in {"units", "leave"}:
        raise HTTPException(404, "Choose units or leave")
    if mode not in {"append", "update_matching", "replace_month"}:
        raise HTTPException(422, "Choose Append, Update matching or Replace month")
    try:
        start, end = month_bounds(month)
        settings = json.loads(settings_json)
        if not isinstance(settings, dict):
            raise ValueError("Import settings must be an object")
        for field in ["mapping", "corrections", "repeated"]:
            if not isinstance(settings.get(field, {}), dict):
                raise ValueError(f"{field} must be an object")
        if not isinstance(settings.get("excluded", []), list) or any(
            not isinstance(key, str) for key in settings.get("excluded", [])
        ):
            raise ValueError("Excluded rows must be a list of source row keys")
        for correction in settings.get("corrections", {}).values():
            if not isinstance(correction, dict):
                raise ValueError("Each row correction must be an object")
            for flag in ["remember_person_alias", "remember_unit_alias"]:
                if flag in correction and not isinstance(correction[flag], bool):
                    raise ValueError("Reusable alias choices must be explicit true/false values")
        if settings.get("date_format", "auto") not in {"auto", "DMY", "MDY"}:
            raise ValueError("Choose a supported date format")
        settings["mode"] = mode
        content = await file.read(5 * 1024 * 1024 + 1)
        headers, raw = read_rows(db, kind, file.filename or "upload", content, month, settings)
        if not raw or len(raw) > 5000:
            raise ValueError("Import between 1 and 5,000 rows")
        rows = normalize_rows(db, kind, month, raw, settings)
        settings["file_hash"] = hashlib.sha256(content).hexdigest()
        replace = []
        if mode == "replace_month":
            model = PersonPosting if kind == "units" else LeaveRequest
            records = db.scalars(
                select(model).where(
                    model.starts_on <= end, (model.ends_on.is_(None)) | (model.ends_on >= start)
                )
            )
            replace = [
                {"id": str(r.id), **record_values(r, kind)}
                for r in records
                if r.source
                in ({"unit_board"} if kind == "units" else {"import", "normalized_import"})
            ]
        settings["replacement_scope"] = replace
    except (ValueError, TypeError, AttributeError, BadZipFile, InvalidFileException) as exc:
        raise HTTPException(422, str(exc)) from exc
    batch = ImportReviewBatch(
        operator_id=operator.id,
        kind=kind,
        filename=(file.filename or "upload")[:255],
        month=month,
        mode=mode,
        settings=settings,
        rows=rows,
        fingerprint=fingerprint(db),
    )
    db.add(batch)
    db.commit()
    return {
        "id": str(batch.id),
        "kind": kind,
        "month": month,
        "mode": mode,
        "headers": headers,
        "rows": rows,
        "replacement_scope": replace,
        "fields": list(FIELDS),
    }


@router.post("/{identity}/apply")
def apply(
    identity: UUID,
    payload: ReviewApply,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(current_user),
):
    batch = db.scalar(
        select(ImportReviewBatch).where(ImportReviewBatch.id == identity).with_for_update()
    )
    if not batch:
        raise HTTPException(404, "Import review not found")
    try:
        return apply_batch(db, batch, operator, payload.excluded, payload.acknowledge_warnings)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "A conflicting record was saved; preview again") from exc
