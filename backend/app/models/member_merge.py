"""Merged member records, kept so a merge can be reviewed and undone (disaster recovery)."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MemberMerge(Base):
    """One confirmed merge: who was merged into whom, and every row it changed.

    ``payload`` holds the before-image needed to undo it exactly: the removed member rows,
    the rows re-pointed to the kept member, the rows combined or dropped as duplicates, the
    kept member's rows that were changed, and rows the merge added.
    """

    __tablename__ = "member_merges"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    target_id: Mapped[UUID] = mapped_column(index=True)
    target_name: Mapped[str] = mapped_column(String(255))
    source_ids: Mapped[list] = mapped_column(JSON)
    source_names: Mapped[list] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    payload: Mapped[dict] = mapped_column(JSON)
    operator_id: Mapped[UUID | None] = mapped_column(nullable=True)
    operator_name: Mapped[str] = mapped_column(String(255))
    merged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    undone_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
