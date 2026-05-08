"""Add rota review exchange requests.

Revision ID: 20260508_0011
Revises: 20260508_0010
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260508_0011"
down_revision: str | None = "20260508_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rota_exchange_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("from_assignment_id", sa.Uuid(), nullable=True),
        sa.Column("from_slot_id", sa.Uuid(), nullable=True),
        sa.Column("from_person_id", sa.Uuid(), nullable=True),
        sa.Column("to_person_id", sa.Uuid(), nullable=True),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("applied_assignment_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("request_reason", sa.Text(), nullable=False),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.Column("validation_status", sa.String(length=50), nullable=False),
        sa.Column("validation_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["user_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["from_person_id"], ["persons.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["from_slot_id"], ["duty_slots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["user_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.ForeignKeyConstraint(["to_person_id"], ["persons.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rota_exchange_requests_rota_period_id"), "rota_exchange_requests", ["rota_period_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_from_assignment_id"), "rota_exchange_requests", ["from_assignment_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_from_slot_id"), "rota_exchange_requests", ["from_slot_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_from_person_id"), "rota_exchange_requests", ["from_person_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_to_person_id"), "rota_exchange_requests", ["to_person_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_requested_by_user_id"), "rota_exchange_requests", ["requested_by_user_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_approved_by_user_id"), "rota_exchange_requests", ["approved_by_user_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_applied_assignment_id"), "rota_exchange_requests", ["applied_assignment_id"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_status"), "rota_exchange_requests", ["status"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_validation_status"), "rota_exchange_requests", ["validation_status"], unique=False)
    op.create_index(op.f("ix_rota_exchange_requests_created_at"), "rota_exchange_requests", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_rota_exchange_requests_created_at"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_validation_status"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_status"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_applied_assignment_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_approved_by_user_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_requested_by_user_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_to_person_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_from_person_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_from_slot_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_from_assignment_id"), table_name="rota_exchange_requests")
    op.drop_index(op.f("ix_rota_exchange_requests_rota_period_id"), table_name="rota_exchange_requests")
    op.drop_table("rota_exchange_requests")
