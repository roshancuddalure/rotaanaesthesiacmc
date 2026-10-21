"""Rota Rules version history (docs/rota_rules_contract.md).

Adds a table only; no existing data changes.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261021_0028"
down_revision = "20261021_0027"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rota_rule_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("rules", sa.JSON(), nullable=False),
        sa.Column("saved_by_id", sa.Uuid(), nullable=True),
        sa.Column("saved_by_name", sa.String(255), nullable=True),
        sa.Column("saved_at", sa.DateTime(), nullable=False),
        sa.Column("changed_duties", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.create_index("ix_rota_rule_versions_revision", "rota_rule_versions", ["revision"])
    op.create_index("ix_rota_rule_versions_saved_at", "rota_rule_versions", ["saved_at"])


def downgrade():
    op.drop_table("rota_rule_versions")
