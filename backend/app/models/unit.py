from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.posting import PersonPosting
    from app.models.rota import DutySlot


class Unit(Base):
    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("code", name="uq_units_code"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(255))
    campus: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    minimum_free_people: Mapped[int] = mapped_column(Integer, default=1)
    active_status: Mapped[str] = mapped_column(String(50), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    postings: Mapped[list["PersonPosting"]] = relationship(back_populates="unit")
    duty_slots: Mapped[list["DutySlot"]] = relationship(back_populates="unit")
    call_minimums: Mapped[list["UnitCallMinimum"]] = relationship(
        back_populates="unit",
        cascade="all, delete-orphan",
    )


class UnitCallMinimum(Base):
    __tablename__ = "unit_call_minimums"
    __table_args__ = (UniqueConstraint("unit_id", "call_level", name="uq_unit_call_minimums_unit_call"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"), index=True)
    call_level: Mapped[str] = mapped_column(String(100), index=True)
    minimum_free_people: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    unit: Mapped[Unit] = relationship(back_populates="call_minimums")
