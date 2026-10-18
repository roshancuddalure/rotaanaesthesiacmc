"""Reviewed teaching examples and versioned scheduling preferences."""

from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class RotaTeachingExample(Base):
    __tablename__ = "rota_teaching_examples"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(index=True)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(String(30), default="unverified", index=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RotaLearningVersion(Base):
    __tablename__ = "rota_learning_versions"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(String(30), default="candidate", index=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
