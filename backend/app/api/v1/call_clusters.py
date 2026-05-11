from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import require_admin
from app.db.session import get_db
from app.models import CallCluster, PersonCallClusterMembership, UserAccount
from app.services.call_clusters import (
    ClusterMemberPayload,
    create_call_cluster,
    get_call_cluster,
    list_call_clusters,
    replace_cluster_members,
    update_call_cluster,
)

router = APIRouter()


class CallClusterPayload(BaseModel):
    key: str | None = None
    name: str
    call_level: str
    description: str | None = None
    active: bool = True


class CallClusterMemberPayloadRead(BaseModel):
    person_id: UUID
    effective_from: date
    effective_to: date | None = None
    notes: str | None = None


class CallClusterMembersPayload(BaseModel):
    members: list[CallClusterMemberPayloadRead]


class CallClusterMemberRead(BaseModel):
    id: UUID
    person_id: UUID
    canonical_name: str
    call_level: str | None
    effective_from: date
    effective_to: date | None
    source: str
    notes: str | None


class CallClusterRead(BaseModel):
    id: UUID
    key: str
    name: str
    call_level: str
    description: str | None
    active: bool
    member_count: int


class CallClusterWithMembersRead(CallClusterRead):
    members: list[CallClusterMemberRead]


def cluster_member_to_read(membership: PersonCallClusterMembership) -> CallClusterMemberRead:
    return CallClusterMemberRead(
        id=membership.id,
        person_id=membership.person_id,
        canonical_name=membership.person.canonical_name,
        call_level=membership.person.call_level,
        effective_from=membership.effective_from,
        effective_to=membership.effective_to,
        source=membership.source,
        notes=membership.notes,
    )


def cluster_to_read(cluster: CallCluster) -> CallClusterRead:
    return CallClusterRead(
        id=cluster.id,
        key=cluster.key,
        name=cluster.name,
        call_level=cluster.call_level,
        description=cluster.description,
        active=cluster.active,
        member_count=len(cluster.memberships),
    )


def cluster_with_members_to_read(cluster: CallCluster) -> CallClusterWithMembersRead:
    return CallClusterWithMembersRead(
        **cluster_to_read(cluster).model_dump(),
        members=[
            cluster_member_to_read(membership)
            for membership in sorted(
                cluster.memberships,
                key=lambda item: (item.person.canonical_name.casefold(), item.effective_from),
            )
        ],
    )


def get_cluster_or_404(db: Session, cluster_id: UUID) -> CallCluster:
    cluster = get_call_cluster(db, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail="Call cluster not found")
    return cluster


@router.get("/admin/call-clusters")
def get_call_clusters(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[CallClusterRead]:
    return [cluster_to_read(cluster) for cluster in list_call_clusters(db)]


@router.post("/admin/call-clusters")
def post_call_cluster(
    payload: CallClusterPayload,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CallClusterWithMembersRead:
    try:
        cluster = create_call_cluster(
            db,
            name=payload.name,
            call_level=payload.call_level,
            description=payload.description,
            active=payload.active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Call cluster key already exists") from exc
    return cluster_with_members_to_read(get_cluster_or_404(db, cluster.id))


@router.put("/admin/call-clusters/{cluster_id}")
def put_call_cluster(
    cluster_id: UUID,
    payload: CallClusterPayload,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CallClusterWithMembersRead:
    cluster = get_cluster_or_404(db, cluster_id)
    if payload.key is not None and payload.key != cluster.key:
        raise HTTPException(status_code=400, detail="Eligibility group system ID cannot be changed")
    try:
        update_call_cluster(
            db,
            cluster,
            name=payload.name,
            call_level=payload.call_level,
            description=payload.description,
            active=payload.active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Call cluster key already exists") from exc
    return cluster_with_members_to_read(get_cluster_or_404(db, cluster_id))


@router.get("/admin/call-clusters/{cluster_id}/members")
def get_call_cluster_members(
    cluster_id: UUID,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CallClusterWithMembersRead:
    return cluster_with_members_to_read(get_cluster_or_404(db, cluster_id))


@router.put("/admin/call-clusters/{cluster_id}/members")
def put_call_cluster_members(
    cluster_id: UUID,
    payload: CallClusterMembersPayload,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CallClusterWithMembersRead:
    cluster = get_cluster_or_404(db, cluster_id)
    try:
        updated = replace_cluster_members(
            db,
            cluster,
            [
                ClusterMemberPayload(
                    person_id=member.person_id,
                    effective_from=member.effective_from,
                    effective_to=member.effective_to,
                    notes=member.notes,
                )
                for member in payload.members
            ],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return cluster_with_members_to_read(updated)
