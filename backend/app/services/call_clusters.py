import re
from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import CallCluster, Person, PersonCallClusterMembership
from app.services.rota_call_levels import normalize_call_level as normalize_rota_call_level


@dataclass(frozen=True)
class ClusterMemberPayload:
    person_id: UUID
    effective_from: date
    effective_to: date | None = None
    notes: str | None = None


def normalize_cluster_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if not key:
        raise ValueError("Cluster key is required")
    return key


def normalize_call_level(value: str) -> str:
    call_level = normalize_rota_call_level(value)
    if call_level == "Unassigned":
        raise ValueError("Call level is required")
    return call_level


def generated_cluster_key(name: str, call_level: str) -> str:
    return normalize_cluster_key(f"{normalize_call_level(call_level)} {name}")


def list_call_clusters(db: Session) -> list[CallCluster]:
    return list(
        db.scalars(
            select(CallCluster)
            .options(selectinload(CallCluster.memberships).selectinload(PersonCallClusterMembership.person))
            .order_by(CallCluster.call_level, CallCluster.name)
        )
    )


def get_call_cluster(db: Session, cluster_id: UUID) -> CallCluster | None:
    return db.scalar(
        select(CallCluster)
        .where(CallCluster.id == cluster_id)
        .options(selectinload(CallCluster.memberships).selectinload(PersonCallClusterMembership.person))
    )


def create_call_cluster(
    db: Session,
    *,
    name: str,
    call_level: str,
    description: str | None = None,
    active: bool = True,
) -> CallCluster:
    cleaned_name = name.strip()
    if not cleaned_name:
        raise ValueError("Cluster name is required")
    normalized_call_level = normalize_call_level(call_level)
    cluster = CallCluster(
        key=generated_cluster_key(cleaned_name, normalized_call_level),
        name=cleaned_name,
        call_level=normalized_call_level,
        description=description.strip() if description else None,
        active=active,
    )
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    return cluster


DEFAULT_CALL_CLUSTERS = (
    {
        "key": "3rd_call_a",
        "name": "3rd Call A",
        "call_level": "3RD_CALL",
        "description": "3rd call A subgroup for PAC and duty eligibility.",
    },
    {
        "key": "3rd_call_b",
        "name": "3rd Call B",
        "call_level": "3RD_CALL",
        "description": "3rd call B subgroup for PAC and duty eligibility.",
    },
    {
        "key": "3rd_call_c",
        "name": "3rd Call C",
        "call_level": "3RD_CALL",
        "description": "3rd call C subgroup for PAC PG eligibility.",
    },
    {
        "key": "pac_sr",
        "name": "PAC SR",
        "call_level": "3RD_CALL",
        "description": "Senior 3rd call PAC pool. Use if PAC-specific senior eligibility differs from 3rd Call A/B.",
    },
    {
        "key": "pac_senior",
        "name": "PAC Senior",
        "call_level": "4TH_CALL",
        "description": "4th call PAC senior pool. Use if PAC senior eligibility needs additional restriction.",
    },
)


def ensure_default_call_clusters(db: Session) -> list[CallCluster]:
    existing = {cluster.key: cluster for cluster in db.scalars(select(CallCluster))}
    created_or_existing: list[CallCluster] = []
    changed = False
    for item in DEFAULT_CALL_CLUSTERS:
        cluster = existing.get(item["key"])
        if cluster is None:
            cluster = CallCluster(
                key=item["key"],
                name=item["name"],
                call_level=normalize_call_level(item["call_level"]),
                description=item["description"],
                active=True,
            )
            db.add(cluster)
            changed = True
        created_or_existing.append(cluster)
    if changed:
        db.commit()
        for cluster in created_or_existing:
            db.refresh(cluster)
    return created_or_existing


def update_call_cluster(
    db: Session,
    cluster: CallCluster,
    *,
    name: str,
    call_level: str,
    description: str | None = None,
    active: bool = True,
) -> CallCluster:
    cluster.name = name.strip()
    cluster.call_level = normalize_call_level(call_level)
    cluster.description = description.strip() if description else None
    cluster.active = active
    cluster.updated_at = datetime.utcnow()
    if not cluster.name:
        raise ValueError("Cluster name is required")
    db.commit()
    db.refresh(cluster)
    return cluster


def replace_cluster_members(
    db: Session,
    cluster: CallCluster,
    members: list[ClusterMemberPayload],
) -> CallCluster:
    seen: set[tuple[UUID, date]] = set()
    person_ids = {member.person_id for member in members}
    people = {
        person.id: person
        for person in db.scalars(select(Person).where(Person.id.in_(person_ids)))
    } if person_ids else {}
    if set(people) != person_ids:
        raise ValueError("One or more members were not found")
    wrong_call_people = [
        person.canonical_name
        for person in people.values()
        if normalize_rota_call_level(person.call_level) != cluster.call_level
    ]
    if wrong_call_people:
        raise ValueError(
            f"Subgroup members must belong to {cluster.call_level}: {', '.join(sorted(wrong_call_people))}"
        )

    for membership in list(cluster.memberships):
        db.delete(membership)
    db.flush()
    for member in members:
        if member.effective_to is not None and member.effective_to < member.effective_from:
            raise ValueError("Membership end date cannot be before start date")
        key = (member.person_id, member.effective_from)
        if key in seen:
            raise ValueError("Duplicate member effective date in cluster payload")
        seen.add(key)
        cluster.memberships.append(
            PersonCallClusterMembership(
                person_id=member.person_id,
                effective_from=member.effective_from,
                effective_to=member.effective_to,
                source="manual",
                notes=member.notes.strip() if member.notes else None,
            )
        )
    db.commit()
    return get_call_cluster(db, cluster.id) or cluster


def active_cluster_keys_for_person(db: Session, person_id: UUID, on_date: date) -> set[str]:
    statement = (
        select(CallCluster.key)
        .join(PersonCallClusterMembership)
        .where(
            PersonCallClusterMembership.person_id == person_id,
            PersonCallClusterMembership.effective_from <= on_date,
            (PersonCallClusterMembership.effective_to.is_(None))
            | (PersonCallClusterMembership.effective_to >= on_date),
            CallCluster.active.is_(True),
        )
    )
    return set(db.scalars(statement))
