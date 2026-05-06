from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.person import Person
    from app.models.unit import Unit


class RotaPeriod(Base):
    __tablename__ = "rota_periods"
    __table_args__ = (UniqueConstraint("name", name="uq_rota_periods_name"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), index=True)
    starts_on: Mapped[date] = mapped_column(Date, index=True)
    ends_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    duty_slots: Mapped[list["DutySlot"]] = relationship(back_populates="rota_period")


class DutySlot(Base):
    __tablename__ = "duty_slots"
    __table_args__ = (
        UniqueConstraint(
            "rota_period_id",
            "duty_date",
            "duty_type",
            "slot_label",
            name="uq_duty_slots_period_date_type_label",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("rota_periods.id"), nullable=True, index=True
    )
    unit_id: Mapped[UUID | None] = mapped_column(ForeignKey("units.id"), nullable=True, index=True)
    duty_date: Mapped[date] = mapped_column(Date, index=True)
    duty_type: Mapped[str] = mapped_column(String(100), index=True)
    call_level: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    slot_label: Mapped[str] = mapped_column(String(100), default="primary")
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    is_24hr: Mapped[bool] = mapped_column(Boolean, default=False)
    max_assignees: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rota_period: Mapped["RotaPeriod | None"] = relationship(back_populates="duty_slots")
    unit: Mapped["Unit | None"] = relationship(back_populates="duty_slots")
    assignments: Mapped[list["DutyAssignment"]] = relationship(back_populates="duty_slot")


class DutyAssignment(Base):
    __tablename__ = "duty_assignments"
    __table_args__ = (
        UniqueConstraint("duty_slot_id", "person_id", name="uq_duty_assignments_slot_person"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    duty_slot_id: Mapped[UUID] = mapped_column(ForeignKey("duty_slots.id"), index=True)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="assigned", index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    duty_slot: Mapped[DutySlot] = relationship(back_populates="assignments")
    person: Mapped["Person"] = relationship(back_populates="duty_assignments")
