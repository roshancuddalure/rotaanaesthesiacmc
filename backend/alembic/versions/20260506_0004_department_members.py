"""Add department member designation history.

Revision ID: 20260506_0004
Revises: 20260506_0003
Create Date: 2026-05-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0004"
down_revision: str | None = "20260506_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "person_designations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("designation", sa.String(length=100), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "person_id", "designation", "effective_from", name="uq_person_designation"
        ),
    )
    op.create_index(
        op.f("ix_person_designations_designation"), "person_designations", ["designation"]
    )
    op.create_index(
        op.f("ix_person_designations_effective_from"),
        "person_designations",
        ["effective_from"],
    )
    op.create_index(
        op.f("ix_person_designations_effective_to"), "person_designations", ["effective_to"]
    )
    op.create_index(
        op.f("ix_person_designations_person_id"), "person_designations", ["person_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_person_designations_person_id"), table_name="person_designations")
    op.drop_index(op.f("ix_person_designations_effective_to"), table_name="person_designations")
    op.drop_index(op.f("ix_person_designations_effective_from"), table_name="person_designations")
    op.drop_index(op.f("ix_person_designations_designation"), table_name="person_designations")
    op.drop_table("person_designations")
