"""Extra-duty layer: applied batches, the per-person justice ledger and unit fallback order.

See docs/extra_duty_contract.md. Ledger rows are never deleted; they become ``void``.
"""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ExtraDutyBatch(Base):
    """One applied extra-duty run; ``before_image`` lets it be undone exactly."""

    __tablename__ = "extra_duty_batches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    status: Mapped[str] = mapped_column(String(20), default="applied", index=True)
    plan_hash: Mapped[str] = mapped_column(String(64), index=True)
    context_hash: Mapped[str] = mapped_column(String(64))
    rules_revision: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    decisions: Mapped[list] = mapped_column(JSON, default=list)
    before_image: Mapped[list] = mapped_column(JSON, default=list)
    created_by_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    undone_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ExtraDutyRecord(Base):
    """Justice ledger row: one extra duty done by one person, and which rules it broke."""

    __tablename__ = "extra_duty_records"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    batch_id: Mapped[UUID] = mapped_column(ForeignKey("extra_duty_batches.id"), index=True)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    # No FK: the ledger outlives the assignment and the slot.
    assignment_id: Mapped[UUID] = mapped_column(index=True)
    slot_id: Mapped[UUID] = mapped_column(index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    duty_date: Mapped[date] = mapped_column(Date, index=True)
    duty_type: Mapped[str] = mapped_column(String(100))
    home_unit_id: Mapped[UUID | None] = mapped_column(nullable=True)
    assigned_unit_id: Mapped[UUID | None] = mapped_column(nullable=True)
    fallback_used: Mapped[bool] = mapped_column(Boolean, default=False)
    overridden_rules: Mapped[list] = mapped_column(JSON, default=list)
    justice: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    void_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UnitFallback(Base):
    """Admin-chosen fallback units for a unit, in order (``position`` ascending)."""

    __tablename__ = "unit_fallbacks"
    __table_args__ = (UniqueConstraint("unit_id", "fallback_unit_id", name="uq_unit_fallbacks_pair"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"), index=True)
    fallback_unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"))
    position: Mapped[int] = mapped_column(Integer, default=0)
