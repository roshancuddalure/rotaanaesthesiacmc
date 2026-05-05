from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    canonical_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    active_status: Mapped[str] = mapped_column(String(50), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    aliases: Mapped[list["PersonAlias"]] = relationship(back_populates="person")


class PersonAlias(Base):
    __tablename__ = "person_aliases"
    __table_args__ = (UniqueConstraint("alias", name="uq_person_aliases_alias"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"))
    alias: Mapped[str] = mapped_column(String(255), index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    person: Mapped[Person] = relationship(back_populates="aliases")

