"""Durable member activity and frozen CSV previews."""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

__all__ = ["MemberCallLevelChange", "MemberActivity", "MemberImportPreview",
           "LegacyPersonCallChange", "LegacyPersonComment"]


class MemberCallLevelChange(Base):
    __tablename__ = "member_call_level_changes"
    __table_args__ = (UniqueConstraint("person_id", "effective_from"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    call_level: Mapped[str] = mapped_column(String(100))
    effective_from: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    person = relationship("Person", back_populates="call_level_changes")


from app.models.member_profile import PersonCallChange as LegacyPersonCallChange, PersonComment as LegacyPersonComment


class MemberActivity(Base):
    __tablename__ = "member_activity"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    # Keep the identity even after a merge; audit records must survive deletion.
    person_id: Mapped[UUID] = mapped_column(index=True)
    operator_id: Mapped[UUID | None] = mapped_column(nullable=True)
    operator_name: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MemberImportPreview(Base):
    __tablename__ = "member_import_previews"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    filename: Mapped[str] = mapped_column(String(255))
    mode: Mapped[str] = mapped_column(String(30))
    rows: Mapped[list] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
