"""Extend leave requests for first leave engine layer.

Revision ID: 20260507_0007
Revises: 20260506_0006
Create Date: 2026-05-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260507_0007"
down_revision: str | None = "20260506_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "leave_requests",
        sa.Column("leave_slot", sa.String(length=100), nullable=False, server_default="FULL_DAY"),
    )
    op.add_column("leave_requests", sa.Column("raw_person_name", sa.String(length=255), nullable=True))
    op.add_column(
        "leave_requests",
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(op.f("ix_leave_requests_leave_slot"), "leave_requests", ["leave_slot"], unique=False)
    op.alter_column("leave_requests", "leave_slot", server_default=None)
    op.alter_column("leave_requests", "updated_at", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_leave_requests_leave_slot"), table_name="leave_requests")
    op.drop_column("leave_requests", "updated_at")
    op.drop_column("leave_requests", "raw_person_name")
    op.drop_column("leave_requests", "leave_slot")

