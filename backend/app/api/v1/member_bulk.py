"""Admin-only department-wide member tools: archive all members (preview, typed confirmation,
undo by batch) and the reviewed suspected-duplicates list. Every route requires an admin.

Merging a suspected pair uses the existing POST /admin/members/merge.
"""

from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import UserAccount
from app.services.member_bulk import (
    CONFIRM_PHRASE,
    StalePreviewError,
    UnknownBatchError,
    archive_all,
    archive_all_preview,
    dismiss_pair,
    list_batches,
    restore_batch,
    suspected_duplicates,
)

router = APIRouter(dependencies=[Depends(require_admin)])


class ArchiveAllRequest(BaseModel):
    preview_token: str | None = None
    confirm_phrase: str | None = None


class DismissRequest(BaseModel):
    person_ids: list[UUID]
    note: str | None = None


@router.get("/admin/members/archive-all/preview")
def preview_archive_all(db: Session = Depends(get_db)) -> dict:
    return archive_all_preview(db)


@router.post("/admin/members/archive-all")
def confirm_archive_all(payload: ArchiveAllRequest | None = Body(default=None), db: Session = Depends(get_db),
                        operator: UserAccount = Depends(require_admin)) -> dict:
    payload = payload or ArchiveAllRequest()
    if (payload.confirm_phrase or "").strip() != CONFIRM_PHRASE:
        raise HTTPException(422, {"code": "confirm_phrase", "message": f"Type {CONFIRM_PHRASE} to confirm"})
    try:
        return archive_all(db, operator, payload.preview_token)
    except StalePreviewError as exc:
        raise HTTPException(409, {"code": "stale_preview", "message": str(exc)}) from exc


@router.post("/admin/members/archive-all/{batch_id}/restore")
def restore_archive_batch(batch_id: str, db: Session = Depends(get_db),
                          operator: UserAccount = Depends(require_admin)) -> dict:
    try:
        return restore_batch(db, operator, batch_id)
    except UnknownBatchError as exc:
        raise HTTPException(404, "Archive batch not found") from exc


@router.get("/admin/members/archive-all/batches")
def archive_batches(db: Session = Depends(get_db)) -> list[dict]:
    return list_batches(db)


@router.get("/admin/members/suspected-duplicates")
def get_suspected_duplicates(db: Session = Depends(get_db)) -> list[dict]:
    return suspected_duplicates(db)


@router.post("/admin/members/suspected-duplicates/dismiss")
def dismiss_suspected_duplicate(payload: DismissRequest, db: Session = Depends(get_db),
                                operator: UserAccount = Depends(require_admin)) -> dict:
    if len(payload.person_ids) != 2 or payload.person_ids[0] == payload.person_ids[1]:
        raise HTTPException(422, "Choose two different members")
    try:
        return {"pair_id": dismiss_pair(db, operator, payload.person_ids, payload.note)}
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
