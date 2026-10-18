import json
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from uuid import UUID
from xml.etree.ElementTree import ParseError

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.domain.duty_types import DUTY_TYPES
from app.models import ImportBatch, ImportSourceRecord, UserAccount
from app.services.history_fairness import (
    HistoryFairnessPolicy,
    past_coverage,
    policy_for_date,
    save_history_policy,
)
from app.services.past_duties import (
    PAST_FIELDS,
    PAST_SOURCE,
    apply_past_duties,
    inspect_past_workbook,
    preview_past_duties,
)

router = APIRouter(prefix="/admin/past-duties", dependencies=[Depends(require_admin)])


class Options(BaseModel):
    month: str
    sheet: str
    layout: str = "table"
    header_row: int = Field(default=1, ge=1, le=100)
    mapping: dict[str, int] | None = None
    resolutions: dict[str, dict[str, str]] = Field(default_factory=dict)
    confirm_corrections: bool = False
    confirm_warnings: bool = False


class PolicyUpdate(BaseModel):
    policy: HistoryFairnessPolicy
    effective_from: date


@router.get("/template")
def template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Past Duties"
    sheet.append(list(PAST_FIELDS))
    sheet.freeze_panes = "A2"
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 26
    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return Response(
        buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="past-duties-template.xlsx"'},
    )


@router.get("/status")
def status(db: Session = Depends(get_db)):
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    batches = list(
        db.scalars(
            select(ImportBatch)
            .where(ImportBatch.import_kind == PAST_SOURCE)
            .order_by(ImportBatch.created_at.desc())
            .limit(30)
        )
    )
    history = []
    for batch in batches:
        try:
            actor = db.get(UserAccount, UUID(batch.source_metadata.get("actor_id", "")))
        except ValueError:
            actor = None
        history.append(
            {
                "id": str(batch.id),
                "filename": batch.source_filename,
                "at": batch.completed_at.isoformat() + "Z" if batch.completed_at else None,
                "actor": actor.display_name if actor else "Unavailable account",
                **batch.source_metadata,
            }
        )
    return {
        "coverage": past_coverage(db),
        "history": history,
        "policy": policy_for_date(db, today).model_dump(),
        "today": today.isoformat(),
        "duty_types": [{"key": d.key, "label": d.label} for d in DUTY_TYPES],
    }


@router.get("/history/{batch_id}")
def history_detail(batch_id: UUID, db: Session = Depends(get_db)):
    batch = db.get(ImportBatch, batch_id)
    if not batch or batch.import_kind != PAST_SOURCE:
        raise HTTPException(status_code=404, detail="Past-duty import not found.")
    records = db.scalars(
        select(ImportSourceRecord)
        .where(ImportSourceRecord.batch_id == batch_id)
        .order_by(ImportSourceRecord.row_index, ImportSourceRecord.column_index)
    )
    return {
        "filename": batch.source_filename,
        "metadata": batch.source_metadata,
        "rows": [
            {
                "row": r.row_index,
                "column": r.column_index,
                "raw": json.loads(r.raw_value or "{}"),
                "normalized": json.loads(r.cleaned_value or "{}"),
                **json.loads(r.notes or "{}"),
            }
            for r in records
        ],
    }


@router.put("/policy")
def update_policy(
    payload: PolicyUpdate,
    db: Session = Depends(get_db),
    actor: UserAccount = Depends(require_admin),
):
    return save_history_policy(db, payload.policy, payload.effective_from, str(actor.id))


async def upload(file: UploadFile):
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise ValueError("File must be no larger than 5 MB.")
    return content


@router.post("/inspect")
async def inspect(file: UploadFile = File(...), header_row: int = Form(1)):
    try:
        return inspect_past_workbook(file.filename or "", await upload(file), header_row)
    except (ValueError, ParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{action}")
async def review(
    action: str,
    file: UploadFile = File(...),
    options: str = Form(...),
    preview_hash: str = Form(""),
    db: Session = Depends(get_db),
    actor: UserAccount = Depends(require_admin),
):
    if action not in {"preview", "apply"}:
        raise HTTPException(status_code=404, detail="Unknown past-duty action.")
    try:
        parsed = Options.model_validate_json(options).model_dump(exclude_none=True)
        content = await upload(file)
        if action == "preview":
            return preview_past_duties(db, file.filename or "", content, parsed)
        return apply_past_duties(
            db, file.filename or "", content, parsed, preview_hash, str(actor.id)
        )
    except (ValueError, ParseError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Recorded duties changed or conflict. Preview again."
        ) from exc
