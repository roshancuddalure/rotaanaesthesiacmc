from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.db.session import get_db
from app.models import UserAccount
from app.services.leave import month_bounds
from app.services.rota_review import (
    RotaReviewError,
    accept_review_issue,
    approve_exchange_request,
    create_exchange_request,
    reject_exchange_request,
    rota_review_month,
)

router = APIRouter()


class ExchangeRequestPayload(BaseModel):
    assignment_id: UUID
    to_person_id: UUID
    reason: str


class ExchangeDecisionPayload(BaseModel):
    decision_reason: str | None = None


class ReviewDecisionPayload(BaseModel):
    issue_code: str
    note: str


class RotaReviewMonthRead(BaseModel):
    month: str
    rota_period: dict[str, object]
    scope: dict[str, object]
    summary: dict[str, object]
    review_items: list[dict[str, object]]
    person_workload: list[dict[str, object]]
    exchange_requests: list[dict[str, object]]
    assignment_options: list[dict[str, object]]


class ExchangeRequestRead(BaseModel):
    id: str
    rota_period_id: str
    from_assignment_id: str | None
    from_slot: dict[str, object] | None
    from_person: dict[str, object] | None
    to_person: dict[str, object] | None
    requested_by: str | None
    approved_by: str | None
    applied_assignment_id: str | None
    status: str
    request_reason: str
    decision_reason: str | None
    validation_status: str
    validation_snapshot: dict[str, object]
    created_at: str
    decided_at: str | None


class RotaReviewDecisionRead(BaseModel):
    id: str
    issue_code: str
    decision_type: str
    note: str
    decided_by: str | None
    created_at: str
    updated_at: str


def review_http_error(exc: RotaReviewError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/rota-review/month")
def get_rota_review_month(
    month: str,
    _user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaReviewMonthRead:
    try:
        month_bounds(month)
        result = rota_review_month(db, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RotaReviewMonthRead(**result)


@router.post("/rota-review/slots/{slot_id}/decisions")
def accept_rota_review_issue(
    slot_id: UUID,
    payload: ReviewDecisionPayload,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> RotaReviewDecisionRead:
    try:
        result = accept_review_issue(
            db,
            slot_id=slot_id,
            issue_code=payload.issue_code,
            note=payload.note,
            decided_by=user,
        )
    except RotaReviewError as exc:
        raise review_http_error(exc) from exc
    return RotaReviewDecisionRead(**result)


@router.post("/rota-review/exchanges")
def request_rota_exchange(
    payload: ExchangeRequestPayload,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExchangeRequestRead:
    try:
        result = create_exchange_request(
            db,
            assignment_id=payload.assignment_id,
            to_person_id=payload.to_person_id,
            reason=payload.reason,
            requested_by=user,
        )
    except RotaReviewError as exc:
        raise review_http_error(exc) from exc
    return ExchangeRequestRead(**result)


@router.post("/rota-review/exchanges/{exchange_id}/approve")
def approve_rota_exchange(
    exchange_id: UUID,
    payload: ExchangeDecisionPayload,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExchangeRequestRead:
    try:
        result = approve_exchange_request(
            db,
            exchange_id=exchange_id,
            approved_by=user,
            decision_reason=payload.decision_reason,
        )
    except RotaReviewError as exc:
        raise review_http_error(exc) from exc
    return ExchangeRequestRead(**result)


@router.post("/rota-review/exchanges/{exchange_id}/reject")
def reject_rota_exchange(
    exchange_id: UUID,
    payload: ExchangeDecisionPayload,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExchangeRequestRead:
    try:
        result = reject_exchange_request(
            db,
            exchange_id=exchange_id,
            rejected_by=user,
            decision_reason=payload.decision_reason,
        )
    except RotaReviewError as exc:
        raise review_http_error(exc) from exc
    return ExchangeRequestRead(**result)
