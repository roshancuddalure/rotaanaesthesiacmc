"""Versioned unit OT calendars. Additive schema; no operational records modified."""

from alembic import op
import sqlalchemy as sa

revision = "20261114_0030"
down_revision = "20261022_0029"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ot_calendars",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("unit_id", sa.Uuid(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("configuration", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("unit_id", name="uq_ot_calendars_unit"),
    )
    op.create_index("ix_ot_calendars_unit_id", "ot_calendars", ["unit_id"])
    op.create_table(
        "ot_calendar_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("unit_id", sa.Uuid(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("configuration", sa.JSON(), nullable=False),
        sa.Column("saved_by_id", sa.Uuid(), nullable=True),
        sa.Column("saved_by_name", sa.String(255), nullable=False),
        sa.Column("saved_at", sa.DateTime(), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
    )
    op.create_index("ix_ot_calendar_versions_unit_id", "ot_calendar_versions", ["unit_id"])
    op.create_index("ix_ot_calendar_versions_revision", "ot_calendar_versions", ["revision"])
    op.create_index("ix_ot_calendar_versions_saved_at", "ot_calendar_versions", ["saved_at"])


def downgrade():
    op.drop_table("ot_calendar_versions")
    op.drop_table("ot_calendars")
