"""Member call-level timeline and attributed Admin/HOD comments."""

from alembic import op
import sqlalchemy as sa

revision = "20261012_0018"
down_revision = "20260514_0017"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "person_call_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id"), nullable=False),
        sa.Column("from_call_level", sa.String(100)),
        sa.Column("to_call_level", sa.String(100)),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("user_accounts.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_person_call_changes_person_id", "person_call_changes", ["person_id"])
    op.create_index(
        "ix_person_call_changes_effective_from", "person_call_changes", ["effective_from"]
    )
    op.create_table(
        "person_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id"), nullable=False),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("user_accounts.id"), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("author_role", sa.String(50), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_person_comments_person_id", "person_comments", ["person_id"])


def downgrade():
    op.drop_table("person_comments")
    op.drop_table("person_call_changes")
