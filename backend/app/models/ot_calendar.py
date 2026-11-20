"""Current per-unit OT calendar and attributable immutable saved versions."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class OtCalendar(Base):
    __tablename__ = "ot_calendars"
    __table_args__ = (UniqueConstraint("unit_id", name="uq_ot_calendars_unit"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"), index=True)
    revision: Mapped[str] = mapped_column(String(64))
    configuration: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OtCalendarVersion(Base):
    __tablename__ = "ot_calendar_versions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"), index=True)
    revision: Mapped[str] = mapped_column(String(64), index=True)
    configuration: Mapped[dict] = mapped_column(JSON)
    saved_by_id: Mapped[UUID | None] = mapped_column(nullable=True)
    saved_by_name: Mapped[str] = mapped_column(String(255))
    saved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    note: Mapped[str] = mapped_column(String(1000), default="")
