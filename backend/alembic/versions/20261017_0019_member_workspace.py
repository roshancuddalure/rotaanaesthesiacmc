"""Durable member activity and frozen import previews."""

from alembic import op
import sqlalchemy as sa

revision = "20261017_0019"
down_revision = "20261012_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_call_level_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id"), nullable=False, index=True),
        sa.Column("call_level", sa.String(100), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("notes", sa.String(1000), nullable=True),
        sa.UniqueConstraint("person_id", "effective_from"),
    )
    op.create_table(
        "member_activity",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("person_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("operator_id", sa.Uuid(), nullable=True),
        sa.Column("operator_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "member_import_previews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("operator_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("mode", sa.String(30), nullable=False),
        sa.Column("rows", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("member_call_level_changes")
    op.drop_table("member_import_previews")
    op.drop_table("member_activity")
