from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.analysis import analyze_dashboard, analyze_preflight, analysis_manual_review

router = APIRouter()


@router.get("/analysis/dashboard")
def get_analysis_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return analyze_dashboard(db)


@router.get("/analysis/preflight")
def get_analysis_preflight(db: Session = Depends(get_db)) -> dict[str, object]:
    return analyze_preflight(db)


@router.get("/analysis/manual-review")
def get_analysis_manual_review(limit: int = 300) -> dict[str, object]:
    return analysis_manual_review(limit=limit)
