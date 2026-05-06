from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    __table_args__ = (UniqueConstraint("name", name="uq_rule_versions_name"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    effective_from: Mapped[date] = mapped_column(Date, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    settings: Mapped[list["RuleSetting"]] = relationship(back_populates="rule_version")


class RuleSetting(Base):
    __tablename__ = "rule_settings"
    __table_args__ = (
        UniqueConstraint("rule_version_id", "key", name="uq_rule_settings_version_key"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rule_version_id: Mapped[UUID] = mapped_column(ForeignKey("rule_versions.id"), index=True)
    key: Mapped[str] = mapped_column(String(150), index=True)
    value: Mapped[dict] = mapped_column(JSON)
    value_type: Mapped[str] = mapped_column(String(50), default="json")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rule_version: Mapped[RuleVersion] = relationship(back_populates="settings")
