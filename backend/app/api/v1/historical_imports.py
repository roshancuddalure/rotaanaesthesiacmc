from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.admin_mappings import HISTORICAL_DIR
from app.db.session import get_db
from app.models import DutyAssignment, DutySlot, ImportBatch, ImportWarning, Person, PersonPosting, Unit
from app.services.historical_analysis_dry_run import rebuild_and_import_historical_analysis

router = APIRouter()


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
    if not HISTORICAL_DIR.exists():
        raise HTTPException(status_code=404, detail="Historical source folder was not found")
    return rebuild_and_import_historical_analysis(db, historical_dir=HISTORICAL_DIR)
