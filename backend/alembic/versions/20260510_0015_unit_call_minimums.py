"""add unit call minimums"""

from alembic import op
import sqlalchemy as sa


revision = "20260510_0015"
down_revision = "20260508_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "unit_call_minimums",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("call_level", sa.String(length=100), nullable=False),
        sa.Column("minimum_free_people", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("unit_id", "call_level", name="uq_unit_call_minimums_unit_call"),
    )
    op.create_index(op.f("ix_unit_call_minimums_call_level"), "unit_call_minimums", ["call_level"], unique=False)
    op.create_index(op.f("ix_unit_call_minimums_unit_id"), "unit_call_minimums", ["unit_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_unit_call_minimums_unit_id"), table_name="unit_call_minimums")
    op.drop_index(op.f("ix_unit_call_minimums_call_level"), table_name="unit_call_minimums")
    op.drop_table("unit_call_minimums")
