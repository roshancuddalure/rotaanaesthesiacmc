"""Add rota template generation audit tables.

Revision ID: 20260507_0009
Revises: 20260507_0008
Create Date: 2026-05-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260507_0009"
down_revision: str | None = "20260507_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rota_template_generation_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("rule_version_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("included_units", sa.Integer(), nullable=False),
        sa.Column("created_slots", sa.Integer(), nullable=False),
        sa.Column("needs_review_slots", sa.Integer(), nullable=False),
        sa.Column("skipped_slots", sa.Integer(), nullable=False),
        sa.Column("blocked_slots", sa.Integer(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.ForeignKeyConstraint(["rule_version_id"], ["rule_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_rota_template_generation_runs_rota_period_id"),
        "rota_template_generation_runs",
        ["rota_period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_runs_rule_version_id"),
        "rota_template_generation_runs",
        ["rule_version_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_runs_status"),
        "rota_template_generation_runs",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_runs_created_at"),
        "rota_template_generation_runs",
        ["created_at"],
        unique=False,
    )
    op.add_column("duty_slots", sa.Column("template_status", sa.String(length=50), nullable=False, server_default="ready"))
    op.add_column("duty_slots", sa.Column("template_reason", sa.Text(), nullable=True))
    op.add_column("duty_slots", sa.Column("generation_run_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_duty_slots_generation_run_id_rota_template_generation_runs",
        "duty_slots",
        "rota_template_generation_runs",
        ["generation_run_id"],
        ["id"],
    )
    op.create_index(op.f("ix_duty_slots_template_status"), "duty_slots", ["template_status"], unique=False)
    op.create_index(op.f("ix_duty_slots_generation_run_id"), "duty_slots", ["generation_run_id"], unique=False)
    op.alter_column("duty_slots", "template_status", server_default=None)
    op.create_table(
        "rota_template_generation_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("generation_run_id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("duty_date", sa.Date(), nullable=True),
        sa.Column("duty_type", sa.String(length=100), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["generation_run_id"], ["rota_template_generation_runs.id"]),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_generation_run_id"),
        "rota_template_generation_events",
        ["generation_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_rota_period_id"),
        "rota_template_generation_events",
        ["rota_period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_unit_id"),
        "rota_template_generation_events",
        ["unit_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_duty_date"),
        "rota_template_generation_events",
        ["duty_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_duty_type"),
        "rota_template_generation_events",
        ["duty_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_action"),
        "rota_template_generation_events",
        ["action"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rota_template_generation_events_severity"),
        "rota_template_generation_events",
        ["severity"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_rota_template_generation_events_severity"), table_name="rota_template_generation_events")
    op.drop_index(op.f("ix_rota_template_generation_events_action"), table_name="rota_template_generation_events")
    op.drop_index(op.f("ix_rota_template_generation_events_duty_type"), table_name="rota_template_generation_events")
    op.drop_index(op.f("ix_rota_template_generation_events_duty_date"), table_name="rota_template_generation_events")
    op.drop_index(op.f("ix_rota_template_generation_events_unit_id"), table_name="rota_template_generation_events")
    op.drop_index(op.f("ix_rota_template_generation_events_rota_period_id"), table_name="rota_template_generation_events")
    op.drop_index(
        op.f("ix_rota_template_generation_events_generation_run_id"),
        table_name="rota_template_generation_events",
    )
    op.drop_table("rota_template_generation_events")
    op.drop_index(op.f("ix_duty_slots_generation_run_id"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_template_status"), table_name="duty_slots")
    op.drop_constraint("fk_duty_slots_generation_run_id_rota_template_generation_runs", "duty_slots", type_="foreignkey")
    op.drop_column("duty_slots", "generation_run_id")
    op.drop_column("duty_slots", "template_reason")
    op.drop_column("duty_slots", "template_status")
    op.drop_index(op.f("ix_rota_template_generation_runs_created_at"), table_name="rota_template_generation_runs")
    op.drop_index(op.f("ix_rota_template_generation_runs_status"), table_name="rota_template_generation_runs")
    op.drop_index(op.f("ix_rota_template_generation_runs_rule_version_id"), table_name="rota_template_generation_runs")
    op.drop_index(op.f("ix_rota_template_generation_runs_rota_period_id"), table_name="rota_template_generation_runs")
    op.drop_table("rota_template_generation_runs")
