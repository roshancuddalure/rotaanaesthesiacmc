"""Durable, reviewable rota proposals. Operational assignments are separate."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Integer, JSON, String, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RotaComputeJob(Base):
    __tablename__ = "rota_compute_jobs"
    __table_args__ = (
        Index(
            "uq_rota_compute_active_month",
            "month",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running', 'completed')"),
            sqlite_where=text("status IN ('queued', 'running', 'completed')"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    month: Mapped[str] = mapped_column(String(7), index=True)
    operator_id: Mapped[UUID] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="queued")
    engine: Mapped[str] = mapped_column(String(30), default="server")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    context_hash: Mapped[str] = mapped_column(String(64))
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
