"""Cooperative compute jobs: requests execute bounded chunks, never detached threads."""

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import RotaComputeJob, UserAccount
from app.services import rota_compute as service
from app.services.auth import ADMIN_ROLES
from app.services.leave import month_bounds

router = APIRouter(prefix="/rota-compute", dependencies=[Depends(current_user)])
log = logging.getLogger(__name__)


def enabled():
    if not settings.rota_compute_enabled:
        raise HTTPException(503, "Reviewed compute is disabled by the administrator")


class Start(BaseModel):
    month: str
    engine: Literal["server", "local_gpu"] = "server"


class Step(BaseModel):
    revision: int = Field(ge=0)
    selection: int | None = Field(default=None, ge=0)
    token: str | None = None
    fallback: bool = False


@router.get("/capabilities")
def capabilities(month: str | None = None, db: Session = Depends(get_db)):
    return {
        "enabled": settings.rota_compute_enabled,
        "browser_gpu": settings.browser_gpu_enabled,
        "score_version": 1,
        "fields": service.SCORE_FIELDS,
        "context_hash": service.context_hash(db)
        if month and settings.rota_compute_enabled
        else None,
    }


@router.post("/jobs")
def start(payload: Start, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    try:
        month_bounds(payload.month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if payload.engine == "local_gpu" and (
        user.role not in ADMIN_ROLES or not settings.browser_gpu_enabled
    ):
        raise HTTPException(
            403, "Local GPU computation requires an admin and the browser GPU feature"
        )
    return service.create_job(db, payload.month, user, payload.engine)


@router.get("/jobs")
def jobs(month: str, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    return [
        service.serialize(job)
        for job in db.scalars(
            select(RotaComputeJob)
            .where(RotaComputeJob.month == month, RotaComputeJob.operator_id == user.id)
            .order_by(RotaComputeJob.created_at.desc())
            .limit(10)
        )
    ]


@router.get("/jobs/{job_id}")
def get_job(job_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    return service.serialize(service.owned_job(db, job_id, user))


@router.post("/jobs/{job_id}/step")
def step(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    job = service.owned_job(db, job_id, user)
    if job.state.get("intelligence") and not settings.rota_intelligence_enabled:
        raise HTTPException(
            503, "Intelligent planning is disabled; the proposal can still be cancelled"
        )
    try:
        return service.advance(
            db,
            job,
            payload.revision,
            payload.selection,
            payload.token,
            payload.fallback
            or (
                job.engine == "local_gpu"
                and (user.role not in ADMIN_ROLES or not settings.browser_gpu_enabled)
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        log.exception("Rota planning failed job=%s", job_id)
        job = service.owned_job(db, job_id, user)
        job.status = "failed"
        job.state = {
            **job.state,
            "error": "Computation failed. No proposed assignments were saved. Create a fresh proposal.",
        }
        db.commit()
        raise HTTPException(500, job.state["error"]) from exc


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    return service.cancel(db, service.owned_job(db, job_id, user))


@router.post("/jobs/{job_id}/apply")
def apply(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    job = service.owned_job(db, job_id, user)
    if job.state.get("intelligence") and not settings.rota_intelligence_enabled:
        raise HTTPException(
            503, "Intelligent planning is disabled; the proposal can still be cancelled"
        )
    return service.apply_job(db, job, payload.revision, user)


@router.post("/jobs/{job_id}/validate")
def validate(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    job = service.owned_job(db, job_id, user)
    if job.state.get("intelligence") and not settings.rota_intelligence_enabled:
        raise HTTPException(
            503, "Intelligent planning is disabled; the proposal can still be cancelled"
        )
    return service.apply_job(db, job, payload.revision, user, dry_run=True)
