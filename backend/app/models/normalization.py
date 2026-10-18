"""Reference catalogs, normalization audit and durable import review batches."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ReferenceValue(Base):
    __tablename__ = "reference_values"
    __table_args__ = (UniqueConstraint("kind", "key", name="uq_reference_kind_key"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    kind: Mapped[str] = mapped_column(String(50), index=True)
    key: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(255))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    behavior: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NormalizationEvent(Base):
    __tablename__ = "normalization_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    operator_name: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ImportReviewBatch(Base):
    __tablename__ = "import_review_batches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(String(30))
    filename: Mapped[str] = mapped_column(String(255))
    month: Mapped[str] = mapped_column(String(7))
    mode: Mapped[str] = mapped_column(String(30))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str] = mapped_column(String(64))
    rows: Mapped[list] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
