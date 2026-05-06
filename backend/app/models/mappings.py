from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AdminMapping(Base):
    __tablename__ = "admin_mappings"
    __table_args__ = (
        UniqueConstraint("mapping_type", "source_label", name="uq_admin_mappings_type_source"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    mapping_type: Mapped[str] = mapped_column(String(100), index=True)
    source_label: Mapped[str] = mapped_column(String(255), index=True)
    target_key: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    target_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    source: Mapped[str] = mapped_column(String(100), default="admin")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
