"""Add unit minimum free people setting.

Revision ID: 20260508_0014
Revises: 20260508_0013
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260508_0014"
down_revision: str | None = "20260508_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "units",
        sa.Column("minimum_free_people", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("units", "minimum_free_people")
