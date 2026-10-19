"""Shared member resolution rules, seeded from the authoritative alias summary.

Adds rows only; existing members, aliases and assignments are untouched. Seed rules whose
member is not in the roster are skipped and logged.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = "20261020_0023"
down_revision = "20261019_0022"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "member_resolution_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("form", sa.String(255), nullable=False),
        sa.Column("form_key", sa.String(255), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id"), nullable=True),
        sa.Column("call_levels", sa.JSON(), nullable=False),
        sa.Column("duty_areas", sa.JSON(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("requires_context", sa.Boolean(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_member_resolution_rules_form_key", "member_resolution_rules", ["form_key"])
    op.create_index("ix_member_resolution_rules_person_id", "member_resolution_rules", ["person_id"])

    from app.services.member_resolution_rules import seed_resolution_rules

    with Session(bind=op.get_bind()) as db:
        seed_resolution_rules(db)
        db.commit()


def downgrade():
    op.drop_table("member_resolution_rules")
