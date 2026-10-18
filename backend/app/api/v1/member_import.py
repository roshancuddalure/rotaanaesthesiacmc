import json
import csv
from io import BytesIO, StringIO
from uuid import UUID
from xml.etree.ElementTree import ParseError

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import ImportBatch, ImportSourceRecord, UserAccount
from app.services.member_import import (
    FIELDS,
    apply_member_import,
    inspect_member_workbook,
    preview_member_import,
)

router = APIRouter(prefix="/admin/members/import", dependencies=[Depends(require_admin)])


@router.get("/template")
def member_import_template(format: str = "xlsx"):
    if format == "csv":
        buffer = StringIO()
        csv.writer(buffer).writerow(["name", "call_level"])
        return Response(
            buffer.getvalue().encode("utf-8-sig"),
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="department-members-template.csv"'
            },
        )
    if format != "xlsx":
        raise HTTPException(status_code=400, detail="Template format must be csv or xlsx.")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Members"
    sheet.append(list(FIELDS))
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 24
    sheet.freeze_panes = "A2"
    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return Response(
        buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="department-members-template.xlsx"'},
    )


def batch_read(batch: ImportBatch, db: Session):
    actor_id = batch.source_metadata.get("actor_id")
    try:
        actor = db.get(UserAccount, UUID(actor_id)) if actor_id else None
    except (ValueError, TypeError):
        actor = None
    return {
        "id": str(batch.id),
        "filename": batch.source_filename,
        "status": batch.status,
        "completed_at": batch.completed_at.isoformat() + "Z" if batch.completed_at else None,
        "actor": actor.display_name or actor.username if actor else "Unavailable account",
        "counts": batch.source_metadata.get("counts", {}),
        "sheet": batch.source_metadata.get("sheet"),
        "call_changes_confirmed": batch.source_metadata.get("call_changes_confirmed", False),
    }


@router.get("/history")
def history(limit: int = 30, db: Session = Depends(get_db)):
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.import_kind == "department_members")
        .order_by(ImportBatch.created_at.desc(), ImportBatch.id.desc())
        .limit(max(1, min(limit, 100)))
    )
    return [batch_read(batch, db) for batch in batches]


@router.get("/history/{batch_id}")
def history_detail(batch_id: UUID, db: Session = Depends(get_db)):
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.import_kind != "department_members":
        raise HTTPException(status_code=404, detail="Member import not found.")
    records = db.scalars(
        select(ImportSourceRecord)
        .where(ImportSourceRecord.batch_id == batch_id)
        .order_by(ImportSourceRecord.row_index)
    )
    return {
        "batch": batch_read(batch, db),
        "rows": [
            {
                "row": record.row_index,
                "sheet": record.sheet_name,
                "raw": json.loads(record.raw_value or "{}"),
                "normalized": json.loads(record.cleaned_value or "{}"),
                "member_id": str(record.normalized_id) if record.normalized_id else None,
                **json.loads(record.notes or "{}"),
            }
            for record in records
        ],
    }


async def read_upload(file: UploadFile):
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be no larger than 5 MB.")
    return content


def parse_options(options: str):
    try:
        parsed = json.loads(options)
        if not isinstance(parsed, dict):
            raise ValueError()
        if not isinstance(parsed.get("header_row", 1), int):
            raise ValueError()
        if "sheet" in parsed and not isinstance(parsed["sheet"], str):
            raise ValueError()
        for field in ("mapping", "resolutions"):
            if field in parsed and not isinstance(parsed[field], dict):
                raise ValueError()
        if any(not isinstance(v, str) for v in parsed.get("resolutions", {}).values()):
            raise ValueError()
        if "confirm_call_changes" in parsed and not isinstance(
            parsed["confirm_call_changes"], bool
        ):
            raise ValueError()
        return parsed
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid import options.") from exc


@router.post("/inspect")
async def inspect(file: UploadFile = File(...), header_row: int = Form(1)):
    try:
        return inspect_member_workbook(file.filename or "", await read_upload(file), header_row)
    except (ValueError, ParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/preview")
async def preview(
    file: UploadFile = File(...), options: str = Form("{}"), db: Session = Depends(get_db)
):
    try:
        return preview_member_import(
            db, file.filename or "", await read_upload(file), parse_options(options)
        )
    except (ValueError, ParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/apply")
async def apply(
    file: UploadFile = File(...),
    options: str = Form(...),
    preview_hash: str = Form(...),
    db: Session = Depends(get_db),
    actor: UserAccount = Depends(require_admin),
):
    try:
        return apply_member_import(
            db,
            file.filename or "",
            await read_upload(file),
            parse_options(options),
            preview_hash,
            str(actor.id),
        )
    except (ValueError, ParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409, detail="Member conflict. Preview again before importing."
        ) from exc
