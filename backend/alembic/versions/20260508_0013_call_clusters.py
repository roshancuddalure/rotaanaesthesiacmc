"""Add call clusters.

Revision ID: 20260508_0013
Revises: 20260508_0012
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260508_0013"
down_revision: str | None = "20260508_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "call_clusters",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("call_level", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_call_clusters_key"),
    )
    op.create_index(op.f("ix_call_clusters_key"), "call_clusters", ["key"], unique=False)
    op.create_index(op.f("ix_call_clusters_call_level"), "call_clusters", ["call_level"], unique=False)
    op.create_index(op.f("ix_call_clusters_active"), "call_clusters", ["active"], unique=False)

    op.create_table(
        "person_call_cluster_memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("cluster_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cluster_id"], ["call_clusters.id"]),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "person_id",
            "cluster_id",
            "effective_from",
            name="uq_person_call_cluster_membership",
        ),
    )
    op.create_index(
        op.f("ix_person_call_cluster_memberships_person_id"),
        "person_call_cluster_memberships",
        ["person_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_person_call_cluster_memberships_cluster_id"),
        "person_call_cluster_memberships",
        ["cluster_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_person_call_cluster_memberships_effective_from"),
        "person_call_cluster_memberships",
        ["effective_from"],
        unique=False,
    )
    op.create_index(
        op.f("ix_person_call_cluster_memberships_effective_to"),
        "person_call_cluster_memberships",
        ["effective_to"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_person_call_cluster_memberships_effective_to"), table_name="person_call_cluster_memberships")
    op.drop_index(op.f("ix_person_call_cluster_memberships_effective_from"), table_name="person_call_cluster_memberships")
    op.drop_index(op.f("ix_person_call_cluster_memberships_cluster_id"), table_name="person_call_cluster_memberships")
    op.drop_index(op.f("ix_person_call_cluster_memberships_person_id"), table_name="person_call_cluster_memberships")
    op.drop_table("person_call_cluster_memberships")
    op.drop_index(op.f("ix_call_clusters_active"), table_name="call_clusters")
    op.drop_index(op.f("ix_call_clusters_call_level"), table_name="call_clusters")
    op.drop_index(op.f("ix_call_clusters_key"), table_name="call_clusters")
    op.drop_table("call_clusters")
