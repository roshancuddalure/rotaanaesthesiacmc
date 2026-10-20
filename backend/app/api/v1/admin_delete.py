"""Admin delete with a 30-day recycle bin (docs/admin_delete_contract.md). Admin only.

Preview -> delete (preview token, typed phrase for month deletes) -> recycle bin listing,
restore and permanent purge, plus the recorded past duties of a month for the delete UI.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import UserAccount
from app.services import recycle_bin
from app.services.members import StalePreviewError

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])

Kind = Literal["member", "leave", "posting", "past_duty"]


class DeleteSelection(BaseModel):
    kind: Kind
    ids: list[UUID] | None = None
    month: str | None = None


class DeleteRequest(DeleteSelection):
    preview_token: str | None = None
    confirm_phrase: str | None = None


class PurgeRequest(BaseModel):
    confirm: bool = False


def _selection_error(exc: Exception) -> HTTPException:
    return HTTPException(422, {"code": "invalid_selection", "message": str(exc)})


@router.post("/delete/preview")
def preview_delete(payload: DeleteSelection, db: Session = Depends(get_db)) -> dict:
    try:
        return recycle_bin.preview(db, payload.kind, payload.ids, payload.month)
    except recycle_bin.SelectionError as exc:
        raise _selection_error(exc) from exc


@router.post("/delete")
def confirm_delete(payload: DeleteRequest, db: Session = Depends(get_db),
                   operator: UserAccount = Depends(require_admin)) -> dict:
    try:
        return recycle_bin.delete(db, operator, payload.kind, payload.ids, payload.month,
                                  payload.preview_token, payload.confirm_phrase)
    except recycle_bin.SelectionError as exc:
        raise _selection_error(exc) from exc
    except recycle_bin.ConfirmPhraseError as exc:
        raise HTTPException(422, {"code": "confirm_phrase", "message": str(exc),
                                  "confirm_phrase": exc.expected}) from exc
    except StalePreviewError as exc:
        raise HTTPException(409, {"code": "stale_preview", "message": str(exc)}) from exc
    except recycle_bin.NothingToDeleteError as exc:
        raise HTTPException(422, {"code": "nothing_to_delete", "message": str(exc)}) from exc


@router.get("/recycle-bin")
def get_recycle_bin(db: Session = Depends(get_db)) -> list[dict]:
    return recycle_bin.list_bin(db)


@router.post("/recycle-bin/{batch_id}/restore")
def restore_batch(batch_id: UUID, db: Session = Depends(get_db),
                  operator: UserAccount = Depends(require_admin)) -> dict:
    try:
        return recycle_bin.restore(db, operator, batch_id)
    except recycle_bin.UnknownBatchError as exc:
        raise HTTPException(404, "Recycle bin entry not found") from exc
    except recycle_bin.AlreadyRestoredError as exc:
        raise HTTPException(409, {"code": "already_restored", "message": str(exc)}) from exc


@router.delete("/recycle-bin/{batch_id}")
def purge_batch(batch_id: UUID, payload: PurgeRequest | None = Body(default=None),
                db: Session = Depends(get_db)) -> dict:
    if not payload or not payload.confirm:
        raise HTTPException(422, {"code": "confirm", "message": "Send {\"confirm\": true} to delete permanently"})
    try:
        return {"purged": recycle_bin.purge_batch(db, batch_id)}
    except recycle_bin.UnknownBatchError as exc:
        raise HTTPException(404, "Recycle bin entry not found") from exc


@router.get("/past-duties/recorded")
def recorded_past_duties(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db)) -> dict:
    try:
        return recycle_bin.recorded_past_duties(db, month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
