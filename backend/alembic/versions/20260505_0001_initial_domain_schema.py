"""Initial domain schema.

Revision ID: 20260505_0001
Revises:
Create Date: 2026-05-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260505_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "persons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("canonical_name", sa.String(length=255), nullable=False),
        sa.Column("active_status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_persons_canonical_name"), "persons", ["canonical_name"], unique=True)

    op.create_table(
        "rule_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_rule_versions_name"),
    )
    op.create_index(op.f("ix_rule_versions_effective_from"), "rule_versions", ["effective_from"])
    op.create_index(op.f("ix_rule_versions_effective_to"), "rule_versions", ["effective_to"])
    op.create_index(op.f("ix_rule_versions_is_active"), "rule_versions", ["is_active"])
    op.create_index(op.f("ix_rule_versions_name"), "rule_versions", ["name"])

    op.create_table(
        "rota_periods",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_rota_periods_name"),
    )
    op.create_index(op.f("ix_rota_periods_ends_on"), "rota_periods", ["ends_on"])
    op.create_index(op.f("ix_rota_periods_name"), "rota_periods", ["name"])
    op.create_index(op.f("ix_rota_periods_starts_on"), "rota_periods", ["starts_on"])
    op.create_index(op.f("ix_rota_periods_status"), "rota_periods", ["status"])

    op.create_table(
        "units",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("campus", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("active_status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_units_code"),
    )
    op.create_index(op.f("ix_units_code"), "units", ["code"])

    op.create_table(
        "person_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("alias", name="uq_person_aliases_alias"),
    )
    op.create_index(op.f("ix_person_aliases_alias"), "person_aliases", ["alias"])

    op.create_table(
        "leave_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("leave_type", sa.String(length=100), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_requests_ends_on"), "leave_requests", ["ends_on"])
    op.create_index(op.f("ix_leave_requests_leave_type"), "leave_requests", ["leave_type"])
    op.create_index(op.f("ix_leave_requests_person_id"), "leave_requests", ["person_id"])
    op.create_index(op.f("ix_leave_requests_starts_on"), "leave_requests", ["starts_on"])
    op.create_index(op.f("ix_leave_requests_status"), "leave_requests", ["status"])

    op.create_table(
        "person_postings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("posting_type", sa.String(length=100), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_person_postings_person_id"), "person_postings", ["person_id"])
    op.create_index(op.f("ix_person_postings_posting_type"), "person_postings", ["posting_type"])
    op.create_index(op.f("ix_person_postings_unit_id"), "person_postings", ["unit_id"])

    op.create_table(
        "rule_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rule_version_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=150), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("value_type", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rule_version_id"], ["rule_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rule_version_id", "key", name="uq_rule_settings_version_key"),
    )
    op.create_index(op.f("ix_rule_settings_key"), "rule_settings", ["key"])
    op.create_index(op.f("ix_rule_settings_rule_version_id"), "rule_settings", ["rule_version_id"])

    op.create_table(
        "duty_slots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=True),
        sa.Column("unit_id", sa.Uuid(), nullable=True),
        sa.Column("duty_date", sa.Date(), nullable=False),
        sa.Column("duty_type", sa.String(length=100), nullable=False),
        sa.Column("call_level", sa.String(length=100), nullable=True),
        sa.Column("slot_label", sa.String(length=100), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("is_24hr", sa.Boolean(), nullable=False),
        sa.Column("max_assignees", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "rota_period_id",
            "duty_date",
            "duty_type",
            "slot_label",
            name="uq_duty_slots_period_date_type_label",
        ),
    )
    op.create_index(op.f("ix_duty_slots_call_level"), "duty_slots", ["call_level"])
    op.create_index(op.f("ix_duty_slots_duty_date"), "duty_slots", ["duty_date"])
    op.create_index(op.f("ix_duty_slots_duty_type"), "duty_slots", ["duty_type"])
    op.create_index(op.f("ix_duty_slots_ends_at"), "duty_slots", ["ends_at"])
    op.create_index(op.f("ix_duty_slots_rota_period_id"), "duty_slots", ["rota_period_id"])
    op.create_index(op.f("ix_duty_slots_starts_at"), "duty_slots", ["starts_at"])
    op.create_index(op.f("ix_duty_slots_unit_id"), "duty_slots", ["unit_id"])

    op.create_table(
        "duty_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("duty_slot_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["duty_slot_id"], ["duty_slots.id"]),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("duty_slot_id", "person_id", name="uq_duty_assignments_slot_person"),
    )
    op.create_index(op.f("ix_duty_assignments_duty_slot_id"), "duty_assignments", ["duty_slot_id"])
    op.create_index(op.f("ix_duty_assignments_person_id"), "duty_assignments", ["person_id"])
    op.create_index(op.f("ix_duty_assignments_status"), "duty_assignments", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_duty_assignments_status"), table_name="duty_assignments")
    op.drop_index(op.f("ix_duty_assignments_person_id"), table_name="duty_assignments")
    op.drop_index(op.f("ix_duty_assignments_duty_slot_id"), table_name="duty_assignments")
    op.drop_table("duty_assignments")
    op.drop_index(op.f("ix_duty_slots_unit_id"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_starts_at"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_rota_period_id"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_ends_at"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_duty_type"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_duty_date"), table_name="duty_slots")
    op.drop_index(op.f("ix_duty_slots_call_level"), table_name="duty_slots")
    op.drop_table("duty_slots")
    op.drop_index(op.f("ix_rule_settings_rule_version_id"), table_name="rule_settings")
    op.drop_index(op.f("ix_rule_settings_key"), table_name="rule_settings")
    op.drop_table("rule_settings")
    op.drop_index(op.f("ix_person_postings_unit_id"), table_name="person_postings")
    op.drop_index(op.f("ix_person_postings_posting_type"), table_name="person_postings")
    op.drop_index(op.f("ix_person_postings_person_id"), table_name="person_postings")
    op.drop_table("person_postings")
    op.drop_index(op.f("ix_leave_requests_status"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_starts_on"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_person_id"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_leave_type"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_ends_on"), table_name="leave_requests")
    op.drop_table("leave_requests")
    op.drop_index(op.f("ix_person_aliases_alias"), table_name="person_aliases")
    op.drop_table("person_aliases")
    op.drop_index(op.f("ix_units_code"), table_name="units")
    op.drop_table("units")
    op.drop_index(op.f("ix_rota_periods_status"), table_name="rota_periods")
    op.drop_index(op.f("ix_rota_periods_starts_on"), table_name="rota_periods")
    op.drop_index(op.f("ix_rota_periods_name"), table_name="rota_periods")
    op.drop_index(op.f("ix_rota_periods_ends_on"), table_name="rota_periods")
    op.drop_table("rota_periods")
    op.drop_index(op.f("ix_rule_versions_name"), table_name="rule_versions")
    op.drop_index(op.f("ix_rule_versions_is_active"), table_name="rule_versions")
    op.drop_index(op.f("ix_rule_versions_effective_to"), table_name="rule_versions")
    op.drop_index(op.f("ix_rule_versions_effective_from"), table_name="rule_versions")
    op.drop_table("rule_versions")
    op.drop_index(op.f("ix_persons_canonical_name"), table_name="persons")
    op.drop_table("persons")
