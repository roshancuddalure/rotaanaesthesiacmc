from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.person import Person
    from app.models.rules import RuleVersion
    from app.models.unit import Unit
    from app.models.auth import UserAccount


class RotaPeriod(Base):
    __tablename__ = "rota_periods"
    __table_args__ = (UniqueConstraint("name", name="uq_rota_periods_name"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), index=True)
    starts_on: Mapped[date] = mapped_column(Date, index=True)
    ends_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    duty_slots: Mapped[list["DutySlot"]] = relationship(back_populates="rota_period")
    generation_scope: Mapped["MonthlyGenerationScope | None"] = relationship(
        back_populates="rota_period", uselist=False
    )
    template_generation_runs: Mapped[list["RotaTemplateGenerationRun"]] = relationship(
        back_populates="rota_period"
    )
    auto_fill_runs: Mapped[list["RotaAutoFillRun"]] = relationship(back_populates="rota_period")
    publish_approvals: Mapped[list["RotaPublishApproval"]] = relationship(back_populates="rota_period")
    review_decisions: Mapped[list["RotaReviewDecision"]] = relationship(back_populates="rota_period")


class DutySlot(Base):
    __tablename__ = "duty_slots"
    __table_args__ = (
        UniqueConstraint(
            "rota_period_id",
            "duty_date",
            "duty_type",
            "slot_label",
            name="uq_duty_slots_period_date_type_label",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("rota_periods.id"), nullable=True, index=True
    )
    unit_id: Mapped[UUID | None] = mapped_column(ForeignKey("units.id"), nullable=True, index=True)
    duty_date: Mapped[date] = mapped_column(Date, index=True)
    duty_type: Mapped[str] = mapped_column(String(100), index=True)
    call_level: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    slot_label: Mapped[str] = mapped_column(String(100), default="primary")
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    is_24hr: Mapped[bool] = mapped_column(Boolean, default=False)
    max_assignees: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    template_status: Mapped[str] = mapped_column(String(50), default="ready", index=True)
    template_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    generation_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("rota_template_generation_runs.id"), nullable=True, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rota_period: Mapped["RotaPeriod | None"] = relationship(back_populates="duty_slots")
    unit: Mapped["Unit | None"] = relationship(back_populates="duty_slots")
    assignments: Mapped[list["DutyAssignment"]] = relationship(back_populates="duty_slot")
    generation_run: Mapped["RotaTemplateGenerationRun | None"] = relationship(
        back_populates="created_slots_rows"
    )


class DutyAssignment(Base):
    __tablename__ = "duty_assignments"
    __table_args__ = (
        UniqueConstraint("duty_slot_id", "person_id", name="uq_duty_assignments_slot_person"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    duty_slot_id: Mapped[UUID] = mapped_column(ForeignKey("duty_slots.id"), index=True)
    person_id: Mapped[UUID] = mapped_column(ForeignKey("persons.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="assigned", index=True)
    source: Mapped[str] = mapped_column(String(100), default="manual")
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    duty_slot: Mapped[DutySlot] = relationship(back_populates="assignments")
    person: Mapped["Person"] = relationship(back_populates="duty_assignments")


class MonthlyGenerationScope(Base):
    __tablename__ = "monthly_generation_scopes"
    __table_args__ = (
        UniqueConstraint("rota_period_id", name="uq_monthly_generation_scopes_period"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    include_excluded_units_in_safety: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    lock_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rota_period: Mapped[RotaPeriod] = relationship(back_populates="generation_scope")
    units: Mapped[list["MonthlyGenerationScopeUnit"]] = relationship(
        back_populates="scope", cascade="all, delete-orphan"
    )


class MonthlyGenerationScopeUnit(Base):
    __tablename__ = "monthly_generation_scope_units"
    __table_args__ = (
        UniqueConstraint("scope_id", "unit_id", name="uq_monthly_generation_scope_units_scope_unit"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_id: Mapped[UUID] = mapped_column(ForeignKey("monthly_generation_scopes.id"), index=True)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="included", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    scope: Mapped[MonthlyGenerationScope] = relationship(back_populates="units")
    unit: Mapped["Unit"] = relationship()


class RotaTemplateGenerationRun(Base):
    __tablename__ = "rota_template_generation_runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    rule_version_id: Mapped[UUID | None] = mapped_column(ForeignKey("rule_versions.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="completed", index=True)
    included_units: Mapped[int] = mapped_column(Integer, default=0)
    created_slots: Mapped[int] = mapped_column(Integer, default=0)
    needs_review_slots: Mapped[int] = mapped_column(Integer, default=0)
    skipped_slots: Mapped[int] = mapped_column(Integer, default=0)
    blocked_slots: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    rota_period: Mapped[RotaPeriod] = relationship(back_populates="template_generation_runs")
    rule_version: Mapped["RuleVersion | None"] = relationship()
    created_slots_rows: Mapped[list[DutySlot]] = relationship(back_populates="generation_run")
    events: Mapped[list["RotaTemplateGenerationEvent"]] = relationship(
        back_populates="generation_run", cascade="all, delete-orphan"
    )


class RotaTemplateGenerationEvent(Base):
    __tablename__ = "rota_template_generation_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    generation_run_id: Mapped[UUID] = mapped_column(ForeignKey("rota_template_generation_runs.id"), index=True)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    unit_id: Mapped[UUID | None] = mapped_column(ForeignKey("units.id"), nullable=True, index=True)
    duty_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    duty_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    severity: Mapped[str] = mapped_column(String(50), default="info", index=True)
    reason: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    generation_run: Mapped[RotaTemplateGenerationRun] = relationship(back_populates="events")
    rota_period: Mapped[RotaPeriod] = relationship()
    unit: Mapped["Unit | None"] = relationship()


class RotaAutoFillRun(Base):
    __tablename__ = "rota_auto_fill_runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="completed", index=True)
    total_slots: Mapped[int] = mapped_column(Integer, default=0)
    assigned_slots: Mapped[int] = mapped_column(Integer, default=0)
    skipped_slots: Mapped[int] = mapped_column(Integer, default=0)
    review_slots: Mapped[int] = mapped_column(Integer, default=0)
    blocked_slots: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    rota_period: Mapped[RotaPeriod] = relationship(back_populates="auto_fill_runs")
    events: Mapped[list["RotaAutoFillEvent"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class RotaAutoFillEvent(Base):
    __tablename__ = "rota_auto_fill_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("rota_auto_fill_runs.id"), index=True)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    duty_slot_id: Mapped[UUID | None] = mapped_column(ForeignKey("duty_slots.id", ondelete="SET NULL"), nullable=True, index=True)
    assignment_id: Mapped[UUID | None] = mapped_column(ForeignKey("duty_assignments.id", ondelete="SET NULL"), nullable=True, index=True)
    person_id: Mapped[UUID | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    severity: Mapped[str] = mapped_column(String(50), default="info", index=True)
    reason: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run: Mapped[RotaAutoFillRun] = relationship(back_populates="events")
    rota_period: Mapped[RotaPeriod] = relationship()
    duty_slot: Mapped["DutySlot | None"] = relationship()
    assignment: Mapped["DutyAssignment | None"] = relationship()
    person: Mapped["Person | None"] = relationship()


class RotaExchangeRequest(Base):
    __tablename__ = "rota_exchange_requests"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    from_assignment_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    from_slot_id: Mapped[UUID | None] = mapped_column(ForeignKey("duty_slots.id", ondelete="SET NULL"), nullable=True, index=True)
    from_person_id: Mapped[UUID | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), nullable=True, index=True)
    to_person_id: Mapped[UUID | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), nullable=True, index=True)
    requested_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    approved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    applied_assignment_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending_approval", index=True)
    request_reason: Mapped[str] = mapped_column(Text)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(50), default="clear", index=True)
    validation_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    rota_period: Mapped[RotaPeriod] = relationship()
    from_slot: Mapped["DutySlot | None"] = relationship()
    from_person: Mapped["Person | None"] = relationship(foreign_keys=[from_person_id])
    to_person: Mapped["Person | None"] = relationship(foreign_keys=[to_person_id])
    requested_by: Mapped["UserAccount | None"] = relationship(foreign_keys=[requested_by_user_id])
    approved_by: Mapped["UserAccount | None"] = relationship(foreign_keys=[approved_by_user_id])


class RotaReviewDecision(Base):
    __tablename__ = "rota_review_decisions"
    __table_args__ = (
        UniqueConstraint("duty_slot_id", "issue_code", name="uq_rota_review_decisions_slot_issue"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    duty_slot_id: Mapped[UUID] = mapped_column(ForeignKey("duty_slots.id", ondelete="CASCADE"), index=True)
    issue_code: Mapped[str] = mapped_column(String(100), index=True)
    decision_type: Mapped[str] = mapped_column(String(50), default="accepted_warning", index=True)
    note: Mapped[str] = mapped_column(Text)
    decided_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    rota_period: Mapped[RotaPeriod] = relationship(back_populates="review_decisions")
    duty_slot: Mapped[DutySlot] = relationship()
    decided_by: Mapped["UserAccount | None"] = relationship()


class RotaPublishApproval(Base):
    __tablename__ = "rota_publish_approvals"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rota_period_id: Mapped[UUID] = mapped_column(ForeignKey("rota_periods.id"), index=True)
    approved_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(50), default="published", index=True)
    confirmed_warnings: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_note: Mapped[str] = mapped_column(Text)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    rota_period: Mapped[RotaPeriod] = relationship(back_populates="publish_approvals")
    approved_by: Mapped["UserAccount | None"] = relationship()
