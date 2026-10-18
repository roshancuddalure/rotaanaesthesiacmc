"""Shared reference catalogs and frozen operational import review."""

from alembic import op
import sqlalchemy as sa

revision = "20261018_0020"
down_revision = "20261017_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("reference_values",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(50), nullable=False, index=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("behavior", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("kind", "key", name="uq_reference_kind_key"))
    op.create_table("normalization_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("operator_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("operator_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=True, index=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_table("import_review_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("operator_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("mode", sa.String(30), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("rows", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False))


def downgrade() -> None:
    op.drop_table("import_review_batches")
    op.drop_table("normalization_events")
    op.drop_table("reference_values")
