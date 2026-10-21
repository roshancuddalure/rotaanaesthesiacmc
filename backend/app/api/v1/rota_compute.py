"""Cooperative compute jobs: requests execute bounded chunks, never detached threads."""

import logging
from typing import Literal, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import RotaComputeJob, UserAccount, DutySlot, PersonPosting, Unit
from app.services import rota_compute as service
from app.services.auth import ADMIN_ROLES
from app.services.leave import month_bounds

router = APIRouter(prefix="/rota-compute", dependencies=[Depends(current_user)])
log = logging.getLogger(__name__)


def enabled():
    if not settings.rota_compute_enabled:
        raise HTTPException(503, "Reviewed compute is disabled by the administrator")


class ComputePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Start(ComputePayload):
    month: str = Field(min_length=7, max_length=7, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    engine: Literal["server", "local_gpu"] = "server"
    kind: Literal["members", "template"] = "members"
    template_options: dict | None = None


class Step(ComputePayload):
    revision: int = Field(ge=0, le=2147483647)
    selection: int | None = Field(default=None, ge=0, lt=100000)
    selections: list[Annotated[int, Field(ge=0, lt=100000)]] | None = Field(
        default=None, min_length=1, max_length=32
    )
    token: str | None = Field(default=None, min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    fallback: bool = False


def limit_start(request: Request, user=Depends(current_user)):
    request.app.state.compute_limiter.check(user.id, "start")


def limit_work(request: Request, user=Depends(current_user)):
    request.app.state.compute_limiter.check(user.id, "work")


@router.get("/capabilities")
def capabilities(
    request: Request,
    month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$", max_length=7),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    if month and settings.rota_compute_enabled:
        request.app.state.compute_limiter.check(user.id, "work")
    estimates = None
    if month and settings.rota_compute_enabled:
        starts_on, ends_on = month_bounds(month)
        slots = (
            db.scalar(
                select(func.count())
                .select_from(DutySlot)
                .where(DutySlot.duty_date >= starts_on, DutySlot.duty_date <= ends_on)
            )
            or 0
        )
        members = (
            db.scalar(
                select(func.count(func.distinct(PersonPosting.person_id))).where(
                    PersonPosting.starts_on <= ends_on,
                    or_(PersonPosting.ends_on.is_(None), PersonPosting.ends_on >= starts_on),
                )
            )
            or 0
        )
        units = (
            db.scalar(select(func.count()).select_from(Unit).where(Unit.active_status == "active"))
            or 0
        )
        estimates = {
            "members_rows": slots * members,
            "optimizer_rows": slots * members,
            "template_rows": max(1, units) * max(1, slots),
            "units": units,
        }
    data_hash = service.context_hash(db) if month and settings.rota_compute_enabled else None
    optimizer_hash = None
    if data_hash:
        from app.services.rota_intelligence import active_learning, benchmark_context_hash

        optimizer_hash = benchmark_context_hash(data_hash, active_learning(db))
    return {
        "enabled": settings.rota_compute_enabled,
        "browser_gpu": settings.browser_gpu_enabled,
        "template_compute": settings.template_compute_enabled,
        "template_gpu": settings.template_gpu_enabled,
        "optimizer_gpu": settings.optimizer_gpu_enabled,
        "workload_estimates": estimates,
        "optimizer_context_hash": optimizer_hash,
        "score_version": 1,
        "fields": service.SCORE_FIELDS,
        "context_hash": data_hash,
    }


@router.post("/jobs", dependencies=[Depends(limit_start)])
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
    if payload.kind == "template":
        if not settings.template_compute_enabled:
            raise HTTPException(503, "Reviewed template computation is disabled")
        if payload.engine == "local_gpu" and not settings.template_gpu_enabled:
            raise HTTPException(403, "Template GPU computation is disabled")
        from app.services.template_compute import start as start_template

        try:
            return start_template(
                db, payload.month, user, payload.template_options or {}, payload.engine
            )
        except ValueError as exc:
            db.rollback()
            raise HTTPException(422, str(exc)) from exc
    if payload.template_options is not None:
        raise HTTPException(422, "Template options require template workload")
    return service.create_job(db, payload.month, user, payload.engine)


@router.get("/jobs")
def jobs(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", max_length=7),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
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


@router.post("/jobs/{job_id}/step", dependencies=[Depends(limit_work)])
def step(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    job = service.owned_job(db, job_id, user)
    if job.state.get("template") and not settings.template_compute_enabled:
        raise HTTPException(
            503, "Reviewed template computation is disabled; cancel remains available"
        )
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
                and (
                    user.role not in ADMIN_ROLES
                    or not settings.browser_gpu_enabled
                    or (job.state.get("template") and not settings.template_gpu_enabled)
                    or (job.state.get("intelligence") and not settings.optimizer_gpu_enabled)
                )
            ),
            selections=payload.selections,
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


@router.post("/jobs/{job_id}/apply", dependencies=[Depends(limit_work)])
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


@router.post("/jobs/{job_id}/validate", dependencies=[Depends(limit_work)])
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


@router.post("/jobs/{job_id}/reversal-check", dependencies=[Depends(limit_work)])
def reversal_check(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    from app.services.generation_undo import revert

    return revert(db, service.owned_job(db, job_id, user), payload.revision, user, dry_run=True)


@router.post("/jobs/{job_id}/revert", dependencies=[Depends(limit_work)])
def revert(
    job_id: UUID,
    payload: Step,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    from app.services.generation_undo import revert

    return revert(db, service.owned_job(db, job_id, user), payload.revision, user)
