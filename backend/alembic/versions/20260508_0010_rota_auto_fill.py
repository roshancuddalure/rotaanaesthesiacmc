"""Add rota auto-fill audit tables.

Revision ID: 20260508_0010
Revises: 20260507_0009
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260508_0010"
down_revision: str | None = "20260507_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rota_auto_fill_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("total_slots", sa.Integer(), nullable=False),
        sa.Column("assigned_slots", sa.Integer(), nullable=False),
        sa.Column("skipped_slots", sa.Integer(), nullable=False),
        sa.Column("review_slots", sa.Integer(), nullable=False),
        sa.Column("blocked_slots", sa.Integer(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rota_auto_fill_runs_rota_period_id"), "rota_auto_fill_runs", ["rota_period_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_runs_status"), "rota_auto_fill_runs", ["status"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_runs_created_at"), "rota_auto_fill_runs", ["created_at"], unique=False)
    op.create_table(
        "rota_auto_fill_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("duty_slot_id", sa.Uuid(), nullable=True),
        sa.Column("assignment_id", sa.Uuid(), nullable=True),
        sa.Column("person_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["duty_assignments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["duty_slot_id"], ["duty_slots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["rota_auto_fill_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rota_auto_fill_events_run_id"), "rota_auto_fill_events", ["run_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_rota_period_id"), "rota_auto_fill_events", ["rota_period_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_duty_slot_id"), "rota_auto_fill_events", ["duty_slot_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_assignment_id"), "rota_auto_fill_events", ["assignment_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_person_id"), "rota_auto_fill_events", ["person_id"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_action"), "rota_auto_fill_events", ["action"], unique=False)
    op.create_index(op.f("ix_rota_auto_fill_events_severity"), "rota_auto_fill_events", ["severity"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_rota_auto_fill_events_severity"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_action"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_person_id"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_assignment_id"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_duty_slot_id"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_rota_period_id"), table_name="rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_events_run_id"), table_name="rota_auto_fill_events")
    op.drop_table("rota_auto_fill_events")
    op.drop_index(op.f("ix_rota_auto_fill_runs_created_at"), table_name="rota_auto_fill_runs")
    op.drop_index(op.f("ix_rota_auto_fill_runs_status"), table_name="rota_auto_fill_runs")
    op.drop_index(op.f("ix_rota_auto_fill_runs_rota_period_id"), table_name="rota_auto_fill_runs")
    op.drop_table("rota_auto_fill_runs")
