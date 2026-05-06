from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.leave import LeaveRequest
    from app.models.posting import PersonPosting
    from app.models.rota import DutyAssignment


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    canonical_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    active_status: Mapped[str] = mapped_column(String(50), default="active")
    call_level: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    aliases: Mapped[list["PersonAlias"]] = relationship(back_populates="person")
    postings: Mapped[list["PersonPosting"]] = relationship(back_populates="person")
    leave_requests: Mapped[list["LeaveRequest"]] = relationship(back_populates="person")
    duty_assignments: Mapped[list["DutyAssignment"]] = relationship(back_populates="person")
    designations: Mapped[list["PersonDesignation"]] = relationship(back_populates="person")


class PersonAlias(Base):
    __tablename__ = "person_aliases"
    __table_args__ = (UniqueConstraint("alias", name="uq_person_aliases_alias"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"))
    alias: Mapped[str] = mapped_column(String(255), index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    person: Mapped[Person] = relationship(back_populates="aliases")


class PersonDesignation(Base):
    __tablename__ = "person_designations"
    __table_args__ = (
        UniqueConstraint("person_id", "designation", "effective_from", name="uq_person_designation"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    designation: Mapped[str] = mapped_column(String(100), index=True)
    effective_from: Mapped[date] = mapped_column(Date, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    person: Mapped[Person] = relationship(back_populates="designations")
