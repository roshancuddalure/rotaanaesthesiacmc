"""Recycle bin for admin deletes (docs/admin_delete_contract.md).

One ``DeletedRecord`` per deleted item; ``batch_id`` groups the items of one delete action.
``payload`` holds ``{table_name: [row dicts]}`` for the item and its dependent rows (JSON-safe
values), plus an internal ``_nullified`` list of references that were set to NULL. Entries are
purged permanently after ``purge_after`` (deleted_at + 30 days).
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

__all__ = ["DeletedRecord"]


class DeletedRecord(Base):
    __tablename__ = "deleted_records"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    batch_id: Mapped[UUID] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    entity_id: Mapped[UUID] = mapped_column(index=True)
    label: Mapped[str] = mapped_column(String(500))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted_by_id: Mapped[UUID | None] = mapped_column(nullable=True)
    deleted_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    purge_after: Mapped[datetime] = mapped_column(DateTime, index=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    restored_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
