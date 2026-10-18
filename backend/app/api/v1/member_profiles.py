from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import current_user
from app.api.v1.members import get_member_or_404, member_to_read
from app.db.session import get_db
from app.models import (
    DutyAssignment,
    ImportSourceRecord,
    LeaveRequest,
    PersonCallChange,
    PersonComment,
    PersonPosting,
    UserAccount,
)
from app.services.history_fairness import ACTIVE_STATUSES, unique_assignments
from app.services.member_profiles import CALL_LEVELS, call_level_on, local_today, record_call_change

router = APIRouter(prefix="/members", dependencies=[Depends(current_user)])
PROFILE_ROLES = {"computer_admin", "superadmin", "hod"}


def profile_manager(user: UserAccount = Depends(current_user)):
    if user.role not in PROFILE_ROLES:
        raise HTTPException(status_code=403, detail="Admin or HOD privilege required.")
    return user


class CallChangeCreate(BaseModel):
    call_level: str | None = None
    effective_from: date
    reason: str = Field(min_length=1, max_length=4000)

    @field_validator("call_level")
    @classmethod
    def valid_call(cls, value):
        if value is not None and value not in CALL_LEVELS:
            raise ValueError("Choose a recognized call level.")
        return value

    @field_validator("reason")
    @classmethod
    def valid_reason(cls, value):
        if not value.strip():
            raise ValueError("Reason is required.")
        return value.strip()


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)

    @field_validator("body")
    @classmethod
    def valid_body(cls, value):
        if not value.strip():
            raise ValueError("Comment cannot be blank.")
        return value.strip()


@router.get("/{person_id}/profile")
def profile(
    person_id: UUID, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)
):
    person = get_member_or_404(db, person_id)
    today = local_today()
    changes = list(
        db.scalars(
            select(PersonCallChange)
            .where(PersonCallChange.person_id == person_id)
            .order_by(PersonCallChange.effective_from.desc(), PersonCallChange.created_at.desc())
        )
    )
    comments = (
        list(
            db.scalars(
                select(PersonComment)
                .where(PersonComment.person_id == person_id)
                .order_by(PersonComment.created_at.desc())
            )
        )
        if user.role in PROFILE_ROLES
        else []
    )
    assignments = unique_assignments(
        db.scalars(
            select(DutyAssignment).where(
                DutyAssignment.person_id == person_id, DutyAssignment.status.in_(ACTIVE_STATUSES)
            )
        )
    )
    # Official past duties only contribute to profile statistics.
    official = [
        a
        for a in assignments
        if a.duty_slot.rota_period
        and a.duty_slot.rota_period.status in {"historical", "approved", "published", "finalized"}
    ]
    records = db.scalars(
        select(ImportSourceRecord)
        .where(
            ImportSourceRecord.normalized_table == "persons",
            ImportSourceRecord.normalized_id == person_id,
        )
        .order_by(ImportSourceRecord.created_at.desc())
        .limit(20)
    )
    postings = db.scalars(
        select(PersonPosting)
        .where(PersonPosting.person_id == person_id)
        .order_by(PersonPosting.starts_on.desc())
    )
    leaves = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.person_id == person_id)
        .order_by(LeaveRequest.starts_on.desc())
        .limit(30)
    )
    return {
        "member": member_to_read(person).model_dump(mode="json"),
        "today": today.isoformat(),
        "current_call_level": call_level_on(person, today),
        "can_manage": user.role in PROFILE_ROLES,
        "call_history": [
            {
                "id": str(c.id),
                "from": c.from_call_level,
                "to": c.to_call_level,
                "effective_from": c.effective_from.isoformat(),
                "reason": c.reason,
                "source": c.source,
                "scheduled": c.effective_from > today,
                "recorded_at": c.created_at.isoformat() + "Z",
                "author": db.get(UserAccount, c.actor_id).display_name
                if c.actor_id and db.get(UserAccount, c.actor_id)
                else "System import/admin workflow",
            }
            for c in changes
        ],
        "comments": [
            {
                "id": str(c.id),
                "author": c.author_name,
                "role": c.author_role,
                "body": c.body,
                "recorded_at": c.created_at.isoformat() + "Z",
            }
            for c in comments
        ],
        "postings": [
            {
                "unit": p.unit.name if p.unit else None,
                "type": p.posting_type,
                "starts_on": str(p.starts_on),
                "ends_on": str(p.ends_on) if p.ends_on else None,
            }
            for p in postings
        ],
        "leaves": [
            {
                "type": leave.leave_type,
                "from": str(leave.starts_on),
                "to": str(leave.ends_on),
                "status": leave.status,
            }
            for leave in leaves
        ],
        "statistics": {
            "official_duties": len(official),
            "hours24": sum(a.duty_slot.is_24hr for a in official),
            "weekend_duties": sum(a.duty_slot.duty_date.weekday() >= 5 for a in official),
        },
        "imports": [
            {
                "file": r.batch.source_filename,
                "sheet": r.sheet_name,
                "row": r.row_index,
                "recorded_at": r.created_at.isoformat() + "Z",
            }
            for r in records
        ],
    }


@router.post("/{person_id}/call-changes")
def add_call_change(
    person_id: UUID,
    payload: CallChangeCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(profile_manager),
):
    person = get_member_or_404(db, person_id)
    try:
        record_call_change(
            db,
            person,
            payload.call_level,
            payload.effective_from,
            payload.reason,
            source="hod_profile" if user.role == "hod" else "admin_profile",
            actor_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Member changed. Reload the profile.") from exc
    return profile(person_id, db, user)


@router.post("/{person_id}/comments")
def add_comment(
    person_id: UUID,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(profile_manager),
):
    get_member_or_404(db, person_id)
    db.add(
        PersonComment(
            person_id=person_id,
            author_id=user.id,
            author_name=user.display_name,
            author_role=user.role,
            body=payload.body,
        )
    )
    db.commit()
    return profile(person_id, db, user)
