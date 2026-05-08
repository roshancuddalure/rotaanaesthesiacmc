"""Add rota publish approvals.

Revision ID: 20260508_0012
Revises: 20260508_0011
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260508_0012"
down_revision: str | None = "20260508_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rota_publish_approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("confirmed_warnings", sa.Boolean(), nullable=False),
        sa.Column("approval_note", sa.Text(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["user_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rota_publish_approvals_rota_period_id"), "rota_publish_approvals", ["rota_period_id"], unique=False)
    op.create_index(op.f("ix_rota_publish_approvals_approved_by_user_id"), "rota_publish_approvals", ["approved_by_user_id"], unique=False)
    op.create_index(op.f("ix_rota_publish_approvals_status"), "rota_publish_approvals", ["status"], unique=False)
    op.create_index(op.f("ix_rota_publish_approvals_created_at"), "rota_publish_approvals", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_rota_publish_approvals_created_at"), table_name="rota_publish_approvals")
    op.drop_index(op.f("ix_rota_publish_approvals_status"), table_name="rota_publish_approvals")
    op.drop_index(op.f("ix_rota_publish_approvals_approved_by_user_id"), table_name="rota_publish_approvals")
    op.drop_index(op.f("ix_rota_publish_approvals_rota_period_id"), table_name="rota_publish_approvals")
    op.drop_table("rota_publish_approvals")
