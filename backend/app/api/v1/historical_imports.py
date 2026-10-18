"""Historical import status counts and the "rebuild + import" trigger for Jan 2025 - May 2026 data.

``POST /admin/imports/historical/run`` re-parses every workbook, writes CSV/markdown
artefacts to ``Plan/Data/analysis_rebuild`` and replaces previously imported historical
slots/assignments/postings in the database (see ``historical_analysis_dry_run``).

SECURITY (handbook S3): endpoints are unauthenticated.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import require_admin
from app.models import DutyAssignment, DutySlot, ImportBatch, ImportWarning, Person, PersonPosting, Unit

router = APIRouter(dependencies=[Depends(require_admin)])


class HistoricalImportStatus(BaseModel):
    people: int
    units: int
    duty_slots: int
    duty_assignments: int
    postings: int
    import_batches: int
    import_warnings: int


@router.get("/admin/imports/historical/status")
def get_historical_import_status(db: Session = Depends(get_db)) -> HistoricalImportStatus:
    return HistoricalImportStatus(
        people=db.scalar(select(func.count()).select_from(Person)) or 0,
        units=db.scalar(select(func.count()).select_from(Unit)) or 0,
        duty_slots=db.scalar(select(func.count()).select_from(DutySlot)) or 0,
        duty_assignments=db.scalar(select(func.count()).select_from(DutyAssignment)) or 0,
        postings=db.scalar(select(func.count()).select_from(PersonPosting)) or 0,
        import_batches=db.scalar(select(func.count()).select_from(ImportBatch)) or 0,
        import_warnings=db.scalar(select(func.count()).select_from(ImportWarning)) or 0,
    )


@router.post("/admin/imports/historical/run")
def run_historical_import(db: Session = Depends(get_db)) -> dict[str, object]:
    raise HTTPException(status_code=410, detail="Server-folder rebuild is retired. Use Past Duties to upload, preview and apply reviewed historical records.")
