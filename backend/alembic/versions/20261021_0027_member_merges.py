"""Merge records for review and exact undo (disaster recovery for member merges).

Adds a table only; no existing data changes.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261021_0027"
down_revision = "20261021_0026"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "member_merges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("target_name", sa.String(255), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("source_names", sa.JSON(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("operator_id", sa.Uuid(), nullable=True),
        sa.Column("operator_name", sa.String(255), nullable=False),
        sa.Column("merged_at", sa.DateTime(), nullable=False),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.Column("undone_by_name", sa.String(255), nullable=True),
    )
    op.create_index("ix_member_merges_target_id", "member_merges", ["target_id"])
    op.create_index("ix_member_merges_merged_at", "member_merges", ["merged_at"])


def downgrade():
    op.drop_table("member_merges")
