"""Reference maintenance and shared normalization endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user, require_admin
from app.db.session import get_db
from app.models import NormalizationEvent, Unit, UserAccount
from app.services.normalization import resolve_member
from app.services.reference_registry import save_unit, suggested_unit_code, unit_read
from app.services.reference_catalog import catalog, reference_usage, save_reference

router = APIRouter(prefix="/normalization", dependencies=[Depends(current_user)])


class RecordPayload(BaseModel):
    values: dict
    identity: UUID | None = None
    review_token: str | None = None


@router.get("/records/{kind}/{identity}")
def read_record(kind: str, identity: UUID, db: Session = Depends(get_db)):
    from app.services.operational_records import get_record
    from app.services.operational_import import record_values

    return {"id": str(identity), **record_values(get_record(db, kind, identity), kind)}


@router.post("/records/{kind}/preview")
def preview_record(kind: str, payload: RecordPayload, db: Session = Depends(get_db)):
    from app.services.operational_records import inspect_record

    return inspect_record(db, kind, payload.values, payload.identity)


@router.post("/records/{kind}/save")
def write_record(
    kind: str,
    payload: RecordPayload,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(current_user),
):
    from app.services.operational_records import save_record

    return save_record(db, operator, kind, payload.values, payload.review_token, payload.identity)


class CallMinimumPayload(BaseModel):
    call_level: str
    minimum_free_people: int = Field(ge=0)


class UnitPayload(BaseModel):
    name: str
    code: str = ""
    campus: str | None = None
    notes: str | None = None
    aliases: list[str] = []
    minimum_free_people: int = Field(default=1, ge=0)
    active_status: str = "active"
    revision: str | None = None
    call_minimums: list[CallMinimumPayload] | None = None


class MemberResolve(BaseModel):
    name: str
    person_id: UUID | None = None
    active_only: bool = True


class ReferencePayload(BaseModel):
    label: str
    aliases: list[str] = []
    behavior: dict = {}
    active: bool = True
    version: int = 0


@router.get("/catalog/{kind}")
def list_references(kind: str, db: Session = Depends(get_db)):
    return [{**item, "usage": reference_usage(db, kind, item)} for item in catalog(db, kind)]


@router.put("/catalog/{kind}/{key}")
def put_reference(
    kind: str,
    key: str,
    payload: ReferencePayload,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(require_admin),
):
    return save_reference(db, operator, kind, key, payload.model_dump())


@router.post("/members/resolve")
def resolve_member_name(payload: MemberResolve, db: Session = Depends(get_db)):
    return resolve_member(db, payload.name, payload.person_id, active_only=payload.active_only)


@router.get("/units")
def units(month: str | None = None, db: Session = Depends(get_db)):
    from app.services.leave import month_bounds

    try:
        period = month_bounds(month) if month else None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return [unit_read(db, unit, period) for unit in db.scalars(select(Unit).order_by(Unit.name))]


@router.get("/activity")
def activity(
    entity_id: UUID | None = None,
    kind: str | None = None,
    key: str | None = None,
    db: Session = Depends(get_db),
):
    query = select(NormalizationEvent).order_by(NormalizationEvent.created_at.desc())
    if entity_id:
        query = query.where(NormalizationEvent.entity_id == entity_id)
    records = list(db.scalars(query.limit(500)))
    if kind or key:
        records = [
            r
            for r in records
            if (not kind or (r.details.get("after") or {}).get("kind") == kind)
            and (not key or (r.details.get("after") or {}).get("key") == key)
        ]
    return [
        {
            "action": r.action,
            "operator": r.operator_name,
            "created_at": r.created_at.isoformat() + "Z",
            "details": r.details,
        }
        for r in records[:100]
    ]


@router.get("/units/suggest-code")
def suggest_code(name: str, campus: str = ""):
    return {"code": suggested_unit_code(name, campus)}


@router.post("/units")
def create_unit(
    payload: UnitPayload,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(require_admin),
):
    try:
        return save_unit(db, operator, payload.model_dump())
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "The unit or alias was created by another operator; reload the list"
        ) from exc


@router.put("/units/{identity}")
def update_unit(
    identity: UUID,
    payload: UnitPayload,
    db: Session = Depends(get_db),
    operator: UserAccount = Depends(require_admin),
):
    try:
        return save_unit(db, operator, payload.model_dump(), identity)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "A unit or alias conflicts with another record") from exc
