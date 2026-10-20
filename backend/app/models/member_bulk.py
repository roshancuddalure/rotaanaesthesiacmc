"""Pairs of members an admin reviewed and marked as different people.

The suspected-duplicates screen skips these pairs. Ids are stored sorted (person_a_id <
person_b_id as strings). No foreign keys: like ``member_activity`` these review records may
outlive a member that is later merged or deleted, and must never block that.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

__all__ = ["MemberDistinctPair"]


class MemberDistinctPair(Base):
    __tablename__ = "member_distinct_pairs"
    __table_args__ = (UniqueConstraint("person_a_id", "person_b_id", name="uq_member_distinct_pairs_pair"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_a_id: Mapped[UUID] = mapped_column(index=True)
    person_b_id: Mapped[UUID] = mapped_column(index=True)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    operator_id: Mapped[UUID | None] = mapped_column(nullable=True)
    operator_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
