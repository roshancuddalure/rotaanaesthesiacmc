"""Member bulk archive (recorded in member_activity) and reviewed "not the same person" pairs.

Adds the member_distinct_pairs table only; no existing rows are changed.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261020_0024"
down_revision = "20261020_0023"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "member_distinct_pairs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("person_a_id", sa.Uuid(), nullable=False),
        sa.Column("person_b_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.String(1000), nullable=True),
        sa.Column("operator_id", sa.Uuid(), nullable=True),
        sa.Column("operator_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("person_a_id", "person_b_id", name="uq_member_distinct_pairs_pair"),
    )
    op.create_index("ix_member_distinct_pairs_person_a_id", "member_distinct_pairs", ["person_a_id"])
    op.create_index("ix_member_distinct_pairs_person_b_id", "member_distinct_pairs", ["person_b_id"])


def downgrade():
    op.drop_table("member_distinct_pairs")
