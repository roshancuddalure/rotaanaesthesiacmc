from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.person import Person


class CallCluster(Base):
    __tablename__ = "call_clusters"
    __table_args__ = (UniqueConstraint("key", name="uq_call_clusters_key"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(255))
    call_level: Mapped[str] = mapped_column(String(100), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    memberships: Mapped[list["PersonCallClusterMembership"]] = relationship(
        back_populates="cluster", cascade="all, delete-orphan"
    )


class PersonCallClusterMembership(Base):
    __tablename__ = "person_call_cluster_memberships"
    __table_args__ = (
        UniqueConstraint(
            "person_id",
            "cluster_id",
            "effective_from",
            name="uq_person_call_cluster_membership",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    cluster_id: Mapped[UUID] = mapped_column(ForeignKey("call_clusters.id"), index=True)
    effective_from: Mapped[date] = mapped_column(Date, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    person: Mapped["Person"] = relationship(back_populates="call_cluster_memberships")
    cluster: Mapped[CallCluster] = relationship(back_populates="memberships")
