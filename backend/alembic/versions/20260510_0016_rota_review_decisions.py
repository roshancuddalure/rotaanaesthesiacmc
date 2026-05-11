"""add rota review decisions"""

from alembic import op
import sqlalchemy as sa


revision = "20260510_0016"
down_revision = "20260510_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rota_review_decisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rota_period_id", sa.Uuid(), nullable=False),
        sa.Column("duty_slot_id", sa.Uuid(), nullable=False),
        sa.Column("issue_code", sa.String(length=100), nullable=False),
        sa.Column("decision_type", sa.String(length=50), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["user_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["duty_slot_id"], ["duty_slots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rota_period_id"], ["rota_periods.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("duty_slot_id", "issue_code", name="uq_rota_review_decisions_slot_issue"),
    )
    op.create_index(op.f("ix_rota_review_decisions_created_at"), "rota_review_decisions", ["created_at"], unique=False)
    op.create_index(op.f("ix_rota_review_decisions_decided_by_user_id"), "rota_review_decisions", ["decided_by_user_id"], unique=False)
    op.create_index(op.f("ix_rota_review_decisions_decision_type"), "rota_review_decisions", ["decision_type"], unique=False)
    op.create_index(op.f("ix_rota_review_decisions_duty_slot_id"), "rota_review_decisions", ["duty_slot_id"], unique=False)
    op.create_index(op.f("ix_rota_review_decisions_issue_code"), "rota_review_decisions", ["issue_code"], unique=False)
    op.create_index(op.f("ix_rota_review_decisions_rota_period_id"), "rota_review_decisions", ["rota_period_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_rota_review_decisions_rota_period_id"), table_name="rota_review_decisions")
    op.drop_index(op.f("ix_rota_review_decisions_issue_code"), table_name="rota_review_decisions")
    op.drop_index(op.f("ix_rota_review_decisions_duty_slot_id"), table_name="rota_review_decisions")
    op.drop_index(op.f("ix_rota_review_decisions_decision_type"), table_name="rota_review_decisions")
    op.drop_index(op.f("ix_rota_review_decisions_decided_by_user_id"), table_name="rota_review_decisions")
    op.drop_index(op.f("ix_rota_review_decisions_created_at"), table_name="rota_review_decisions")
    op.drop_table("rota_review_decisions")
