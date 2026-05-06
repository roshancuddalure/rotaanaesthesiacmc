from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    pass


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source_filename: Mapped[str] = mapped_column(String(255), index=True)
    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_kind: Mapped[str] = mapped_column(String(50), index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    source_records: Mapped[list["ImportSourceRecord"]] = relationship(back_populates="batch")
    warnings: Mapped[list["ImportWarning"]] = relationship(back_populates="batch")


class ImportSourceRecord(Base):
    __tablename__ = "import_source_records"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    batch_id: Mapped[UUID] = mapped_column(ForeignKey("import_batches.id"), index=True)
    sheet_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    row_index: Mapped[int | None] = mapped_column(nullable=True)
    column_index: Mapped[int | None] = mapped_column(nullable=True)
    column_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    raw_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    cleaned_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    record_type: Mapped[str] = mapped_column(String(100), default="cell", index=True)
    normalized_table: Mapped[str | None] = mapped_column(String(100), nullable=True)
    normalized_id: Mapped[UUID | None] = mapped_column(nullable=True)
    rule_key: Mapped[str | None] = mapped_column(String(150), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    batch: Mapped[ImportBatch] = relationship(back_populates="source_records")
    warnings: Mapped[list["ImportWarning"]] = relationship(back_populates="source_record")


class ImportWarning(Base):
    __tablename__ = "import_warnings"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    batch_id: Mapped[UUID] = mapped_column(ForeignKey("import_batches.id"), index=True)
    source_record_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("import_source_records.id"), nullable=True, index=True
    )
    severity: Mapped[str] = mapped_column(String(50), default="warning", index=True)
    code: Mapped[str] = mapped_column(String(100), index=True)
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    batch: Mapped[ImportBatch] = relationship(back_populates="warnings")
    source_record: Mapped["ImportSourceRecord | None"] = relationship(back_populates="warnings")
