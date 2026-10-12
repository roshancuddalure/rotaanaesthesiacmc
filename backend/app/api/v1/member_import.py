import json
from io import BytesIO
from xml.etree.ElementTree import ParseError

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import UserAccount
from app.services.member_import import (
    FIELDS,
    apply_member_import,
    inspect_member_workbook,
    preview_member_import,
)

router = APIRouter(prefix="/admin/members/import", dependencies=[Depends(require_admin)])


@router.get("/template")
def member_import_template():
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


async def read_upload(file: UploadFile):
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Workbook must be no larger than 5 MB.")
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
