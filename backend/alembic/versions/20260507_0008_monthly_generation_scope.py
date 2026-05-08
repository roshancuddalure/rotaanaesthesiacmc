"""Add monthly generation scope tables.

Revision ID: 20260507_0008
Revises: 20260507_0007
Create Date: 2026-05-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260507_0008"
down_revision: str | None = "20260507_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "monthly_generation_scopes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("include_excluded_units_in_safety", sa.Boolean(), nullable=False),
        sa.Column("is_locked", sa.Boolean(), nullable=False),
        sa.Column("lock_reason", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rota_period_id", name="uq_monthly_generation_scopes_period"),
    )
    op.create_index(
        op.f("ix_monthly_generation_scopes_rota_period_id"),
        "monthly_generation_scopes",
        ["rota_period_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_monthly_generation_scopes_is_locked"),
        "monthly_generation_scopes",
        ["is_locked"],
        unique=False,
    )
    op.create_table(
        "monthly_generation_scope_units",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["scope_id"], ["monthly_generation_scopes.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope_id", "unit_id", name="uq_monthly_generation_scope_units_scope_unit"),
    )
    op.create_index(
        op.f("ix_monthly_generation_scope_units_scope_id"),
        "monthly_generation_scope_units",
        ["scope_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_monthly_generation_scope_units_unit_id"),
        "monthly_generation_scope_units",
        ["unit_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_monthly_generation_scope_units_status"),
        "monthly_generation_scope_units",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_monthly_generation_scope_units_status"), table_name="monthly_generation_scope_units")
    op.drop_index(op.f("ix_monthly_generation_scope_units_unit_id"), table_name="monthly_generation_scope_units")
    op.drop_index(op.f("ix_monthly_generation_scope_units_scope_id"), table_name="monthly_generation_scope_units")
    op.drop_table("monthly_generation_scope_units")
    op.drop_index(op.f("ix_monthly_generation_scopes_is_locked"), table_name="monthly_generation_scopes")
    op.drop_index(op.f("ix_monthly_generation_scopes_rota_period_id"), table_name="monthly_generation_scopes")
    op.drop_table("monthly_generation_scopes")
