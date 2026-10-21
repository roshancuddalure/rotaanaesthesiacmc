"""Shared member resolution rules, seeded from the authoritative alias summary.

Adds rows only; existing members, aliases and assignments are untouched. Seed rules whose
member is not in the roster are skipped and logged.
"""

from alembic import op
import sqlalchemy as sa
from datetime import datetime
from uuid import uuid4

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
    op.create_index(
        "ix_member_resolution_rules_person_id", "member_resolution_rules", ["person_id"]
    )

    # Use this revision's Core table, not the current ORM model: ``scope`` does
    # not exist until 0025. Current ORM queries break clean database upgrades.
    from app.services.member_resolution_rules import SEED_RULES, SEED_SOURCE, member_key

    connection = op.get_bind()
    metadata = sa.MetaData()
    people_table = sa.Table("persons", metadata, autoload_with=connection)
    rules_table = sa.Table("member_resolution_rules", metadata, autoload_with=connection)
    people = dict(
        connection.execute(sa.select(people_table.c.canonical_name, people_table.c.id)).all()
    )
    seen = set()
    now = datetime.utcnow()
    for rule in SEED_RULES:
        person_id = people.get(rule.person)
        if person_id is None:
            continue
        for form in rule.forms:
            key = member_key(form)
            signature = (
                key,
                person_id,
                rule.call_levels,
                rule.duty_areas,
                rule.effective_from,
                rule.effective_to,
                rule.requires_context,
            )
            if not key or signature in seen:
                continue
            seen.add(signature)
            connection.execute(
                rules_table.insert().values(
                    id=uuid4(),
                    form=form,
                    form_key=key,
                    person_id=person_id,
                    call_levels=list(rule.call_levels),
                    duty_areas=list(rule.duty_areas),
                    effective_from=rule.effective_from,
                    effective_to=rule.effective_to,
                    requires_context=rule.requires_context,
                    priority=rule.priority,
                    active=True,
                    note=rule.note or None,
                    source=SEED_SOURCE,
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )


def downgrade():
    op.drop_table("member_resolution_rules")
