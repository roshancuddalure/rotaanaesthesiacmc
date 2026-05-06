"""Add editable person call level.

Revision ID: 20260506_0006
Revises: 20260506_0005
Create Date: 2026-05-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0006"
down_revision: str | None = "20260506_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("persons", sa.Column("call_level", sa.String(length=100), nullable=True))
    op.create_index(op.f("ix_persons_call_level"), "persons", ["call_level"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_persons_call_level"), table_name="persons")
    op.drop_column("persons", "call_level")
