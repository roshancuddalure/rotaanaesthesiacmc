"""Authenticated planning and teaching controls. Model suggestions cannot write rotas."""

from typing import Literal
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import UserAccount, RotaTeachingExample, RotaLearningVersion, RotaPeriod
from app.services import rota_compute as compute, rota_intelligence as service
from app.services.auth import ADMIN_ROLES
from app.services.leave import month_bounds
from app.services.rota_candidates import candidate_context

router = APIRouter(prefix="/rota-intelligence", dependencies=[Depends(current_user)])


class Preference(BaseModel):
    slot_id: UUID
    person_id: UUID
    penalty: int = Field(ge=-100, le=100)


class Start(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str
    mode: Literal["balanced", "repair", "preferences"] = "balanced"
    seconds: int = Field(default=30, ge=1, le=120)
    locked_slots: list[UUID] = Field(default_factory=list, max_length=5000)
    repair_slots: list[UUID] = Field(default_factory=list, max_length=5000)
    preferences: list[Preference] = Field(default_factory=list, max_length=5000)


class Selection(BaseModel):
    revision: int = Field(ge=0)
    index: int = Field(ge=0, le=2)


class Example(BaseModel):
    slot_id: UUID
    kind: Literal["accept", "prefer", "exception"]
    preferred_person_id: UUID | None = None
    reason: Literal["burden", "spacing", "history", "coverage", "preference", "other"]
    note: str = Field(default="", max_length=1000)


class Evaluation(BaseModel):
    months: list[str] = Field(min_length=2, max_length=3)


class HistoricalExamples(BaseModel):
    month: str


class Approval(BaseModel):
    historical_context_verified: bool = False


class Calendar(BaseModel):
    dates: list[date] = Field(default_factory=list, max_length=1000)


def admin(user):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "An administrator must approve teaching and learning changes")


def enabled():
    if not settings.rota_compute_enabled or not settings.rota_intelligence_enabled:
        raise HTTPException(503, "Intelligent planning is disabled")


@router.get("/setup")
def setup(month: str, db: Session = Depends(get_db)):
    enabled()
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    period, _ = compute.writable_period(db, month)
    context = candidate_context(db, month)
    return {
        "slots": [
            {
                "id": str(s.id),
                "date": str(s.duty_date),
                "label": s.slot_label,
                "assigned": [
                    {"id": str(a.person_id), "name": a.person.canonical_name}
                    for a in compute.active_slot_assignments(s)
                ],
            }
            for s in compute.open_slots_for_period(db, period.id)
        ],
        "people": [{"id": str(p.id), "name": p.canonical_name} for p in context.people.values()],
        "rules": context.rules.model_dump(),
        "history_months": context.history["months"],
        "history_lookback": context.history["policy"].lookback_months,
        "enabled": settings.rota_intelligence_enabled,
        "holiday_dates": service.calendar(db),
    }


@router.post("/calendar")
def save_calendar(
    payload: Calendar, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)
):
    enabled()
    admin(user)
    return service.save_calendar(db, user, [str(day) for day in payload.dates])


@router.get("/assistant-context")
def assistant_context(month: str, instruction: str = "", db: Session = Depends(get_db)):
    enabled()
    try:
        month_bounds(month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    context = candidate_context(db, month)
    terms = set(instruction.lower().split())
    rows = list(
        db.scalars(
            select(RotaTeachingExample)
            .where(RotaTeachingExample.status == "approved")
            .order_by(RotaTeachingExample.created_at.desc())
            .limit(200)
        )
    )
    rows.sort(
        key=lambda r: len(terms & set((r.data["reason"] + " " + r.data["note"]).lower().split())),
        reverse=True,
    )
    # Names, IDs, leave reasons and entire schedules never enter the model context.
    return {
        "month": month,
        "constraints": {
            "limits": context.rules.duty_count_limits.model_dump(),
            "rest": context.rules.rest_rules.model_dump(),
            "staffing": context.rules.unit_staffing_rules.model_dump(),
        },
        "examples": [
            {
                "reason": r.data["reason"],
                "kind": r.data["kind"],
                "weekend": r.data["decision"].get("weekend"),
                "proposed_score_components": r.data["decision"].get("score_parts", {}),
                "preferred_score_components": r.data.get("preferred_features"),
            }
            for r in rows[:5]
        ],
        "instruction": "All proposed policies require administrator review. Never bypass constraints.",
    }


@router.get("/history-months")
def history_months(db: Session = Depends(get_db)):
    enabled()
    from app.services.history_fairness import OFFICIAL_STATUSES

    return sorted(
        {
            str(p.starts_on)[:7]
            for p in db.scalars(select(RotaPeriod).where(RotaPeriod.status.in_(OFFICIAL_STATUSES)))
        },
        reverse=True,
    )


@router.post("/teaching/history")
def historical_examples(
    payload: HistoricalExamples,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    admin(user)
    from app.services.history_fairness import recorded_assignments, unique_assignments
    from app.services.reference_registry import lock_namespace

    lock_namespace(db, "rota-teaching-history")

    try:
        start, end = month_bounds(payload.month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    existing = {
        r.data.get("historical_assignment") for r in db.scalars(select(RotaTeachingExample))
    }
    count = 0
    for assignment in unique_assignments(recorded_assignments(db, start, end))[:200]:
        if str(assignment.id) in existing:
            continue
        slot = assignment.duty_slot
        db.add(
            RotaTeachingExample(
                job_id=UUID(int=0),
                operator_id=user.id,
                status="unverified",
                data={
                    "month": payload.month,
                    "historical_assignment": str(assignment.id),
                    "kind": "accept",
                    "slot_id": str(slot.id),
                    "preferred_person_id": None,
                    "reason": "other",
                    "note": "Imported historical reference. Original policy and availability must be checked before reuse.",
                    "decision": {
                        "person_id": str(assignment.person_id),
                        "person_name": assignment.person.canonical_name,
                        "slot_id": str(slot.id),
                        "date": str(slot.duty_date),
                        "duty": slot.slot_label,
                    },
                    "historical_policy_unknown": True,
                },
            )
        )
        count += 1
    db.commit()
    return {"prepared": count, "status": "unverified"}


@router.post("/jobs")
def start(payload: Start, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    try:
        month_bounds(payload.month)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return service.start(
        db, payload.month, user, payload.model_dump(mode="json", exclude={"month"})
    )


@router.post("/jobs/{job_id}/select")
def select_alternative(
    job_id: UUID,
    payload: Selection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    return service.select_alternative(
        db, compute.owned_job(db, job_id, user), payload.index, payload.revision
    )


@router.post("/jobs/{job_id}/alternative")
def alternative(
    job_id: UUID,
    payload: Selection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    job = compute.owned_job(db, job_id, user)
    compute.check_current(db, job)
    if (
        job.status != "completed"
        or payload.revision != job.revision
        or not job.state.get("intelligence")
    ):
        raise HTTPException(409, "Reload a completed intelligent proposal")
    if len(job.state["intelligence"]["alternatives"]) >= 3:
        raise HTTPException(409, "Three alternatives are already available")
    job.status = "running"
    return service.advance(db, job, job.revision)


@router.post("/jobs/{job_id}/examples")
def example(
    job_id: UUID,
    payload: Example,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    if payload.kind == "prefer" and payload.preferred_person_id is None:
        raise HTTPException(422, "Select the preferred member")
    return service.add_example(
        db, compute.owned_job(db, job_id, user), user, payload.model_dump(mode="json")
    )


@router.get("/teaching")
def teaching(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    # Keep notes restricted to their author unless an administrator is reviewing them.
    query = select(RotaTeachingExample).order_by(RotaTeachingExample.created_at.desc()).limit(200)
    if user.role not in ADMIN_ROLES:
        query = query.where(RotaTeachingExample.operator_id == user.id)
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "month": r.data["month"],
            "kind": r.data["kind"],
            "reason": r.data["reason"],
            "note": r.data["note"],
            "decision": r.data["decision"],
            "preferred_person_name": r.data.get("preferred_person_name"),
            "historical_policy_unknown": r.data.get("historical_policy_unknown", False),
        }
        for r in db.scalars(query)
    ]


@router.post("/teaching/{example_id}/approve")
def approve(
    example_id: UUID,
    payload: Approval,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    admin(user)
    row = db.get(RotaTeachingExample, example_id)
    if row is None:
        raise HTTPException(404, "Example not found")
    if row.data.get("historical_policy_unknown") and not payload.historical_context_verified:
        raise HTTPException(
            409,
            "Review the original historical policy and availability before approving this reference",
        )
    service.approve_example(db, row, user)
    return {"id": str(row.id), "status": row.status}


@router.post("/teaching/{example_id}/reject")
def reject_example(
    example_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)
):
    enabled()
    admin(user)
    row = db.get(RotaTeachingExample, example_id)
    if row is None:
        raise HTTPException(404, "Example not found")
    row.status = "rejected"
    row.data = {**row.data, "rejected_by": str(user.id)}
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.get("/learning")
def learning(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    admin(user)
    return [
        {"id": str(r.id), "status": r.status, **r.data}
        for r in db.scalars(
            select(RotaLearningVersion).order_by(RotaLearningVersion.created_at.desc()).limit(50)
        )
    ]


@router.post("/learning")
def propose_learning(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)):
    enabled()
    admin(user)
    row = service.learning_candidate(db, user)
    return {"id": str(row.id), "status": row.status, **row.data}


@router.post("/learning/{version_id}/activate")
def activate(
    version_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)
):
    enabled()
    admin(user)
    row = db.get(RotaLearningVersion, version_id)
    if row is None:
        raise HTTPException(404, "Learning version not found")
    service.activate(db, row, user)
    return {"status": row.status}


@router.post("/learning/{version_id}/evaluate")
def evaluate(
    version_id: UUID,
    payload: Evaluation,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
):
    enabled()
    admin(user)
    for month in payload.months:
        try:
            month_bounds(month)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    row = db.get(RotaLearningVersion, version_id)
    if row is None:
        raise HTTPException(404, "Learning version not found")
    if row.status == "active":
        raise HTTPException(409, "Prepare a candidate version before evaluation")
    return service.evaluate(db, row, user, payload.months)


@router.post("/learning/{version_id}/rollback")
def rollback(
    version_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)
):
    enabled()
    admin(user)
    row = db.get(RotaLearningVersion, version_id)
    if row is None:
        raise HTTPException(404, "Learning version not found")
    service.activate(db, row, user, rollback=True)
    return {"status": row.status}
