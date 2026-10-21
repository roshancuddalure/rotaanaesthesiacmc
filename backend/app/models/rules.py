"""Versioned rule storage. In practice a single ``RuleVersion`` ("Rota generator default
rules") holds one JSON ``RuleSetting`` (``rota_generator.phase1``) that is overwritten
in place on save. Every save also stores a ``RotaRuleVersion`` copy (history and restore).
"""

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


class RotaRuleVersion(Base):
    """One saved copy of the Rota Rules (docs/rota_rules_contract.md). Written on every save
    and restore; the first save after the upgrade also stores the earlier rules with the
    note "Before history"."""

    __tablename__ = "rota_rule_versions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    revision: Mapped[str] = mapped_column(String(64), index=True)
    rules: Mapped[dict] = mapped_column(JSON)
    saved_by_id: Mapped[UUID | None] = mapped_column(nullable=True)
    saved_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    changed_duties: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
