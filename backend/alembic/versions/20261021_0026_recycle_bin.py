"""Recycle bin for admin deletes: the deleted_records table.

Adds one table only; no existing rows are changed.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261021_0026"
down_revision = "20261020_0025"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "deleted_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(500), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("deleted_by_id", sa.Uuid(), nullable=True),
        sa.Column("deleted_by_name", sa.String(255), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.Column("purge_after", sa.DateTime(), nullable=False),
        sa.Column("restored_at", sa.DateTime(), nullable=True),
        sa.Column("restored_by_name", sa.String(255), nullable=True),
    )
    op.create_index("ix_deleted_records_batch_id", "deleted_records", ["batch_id"])
    op.create_index("ix_deleted_records_kind", "deleted_records", ["kind"])
    op.create_index("ix_deleted_records_entity_id", "deleted_records", ["entity_id"])
    op.create_index("ix_deleted_records_deleted_at", "deleted_records", ["deleted_at"])
    op.create_index("ix_deleted_records_purge_after", "deleted_records", ["purge_after"])


def downgrade():
    op.drop_table("deleted_records")
