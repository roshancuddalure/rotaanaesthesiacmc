"""Add admin mapping configuration.

Revision ID: 20260506_0003
Revises: 20260506_0002
Create Date: 2026-05-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0003"
down_revision: str | None = "20260506_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_mappings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mapping_type", sa.String(length=100), nullable=False),
        sa.Column("source_label", sa.String(length=255), nullable=False),
        sa.Column("target_key", sa.String(length=150), nullable=True),
        sa.Column("target_label", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mapping_type", "source_label", name="uq_admin_mappings_type_source"),
    )
    op.create_index(op.f("ix_admin_mappings_mapping_type"), "admin_mappings", ["mapping_type"])
    op.create_index(op.f("ix_admin_mappings_source_label"), "admin_mappings", ["source_label"])
    op.create_index(op.f("ix_admin_mappings_status"), "admin_mappings", ["status"])
    op.create_index(op.f("ix_admin_mappings_target_key"), "admin_mappings", ["target_key"])


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_mappings_target_key"), table_name="admin_mappings")
    op.drop_index(op.f("ix_admin_mappings_status"), table_name="admin_mappings")
    op.drop_index(op.f("ix_admin_mappings_source_label"), table_name="admin_mappings")
    op.drop_index(op.f("ix_admin_mappings_mapping_type"), table_name="admin_mappings")
    op.drop_table("admin_mappings")
