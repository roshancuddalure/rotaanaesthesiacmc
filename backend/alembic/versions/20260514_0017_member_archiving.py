"""add member archive timestamp"""

from alembic import op
import sqlalchemy as sa


revision = "20260514_0017"
down_revision = "20260510_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("persons", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.create_index(op.f("ix_persons_archived_at"), "persons", ["archived_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_persons_archived_at"), table_name="persons")
    op.drop_column("persons", "archived_at")
