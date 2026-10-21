"""Extra-duty layer: batches, justice ledger, unit fallback order (docs/extra_duty_contract.md).

Adds tables only; no existing data changes.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261022_0029"
down_revision = "20261021_0028"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "extra_duty_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rota_period_id", sa.Uuid(), sa.ForeignKey("rota_periods.id"), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("plan_hash", sa.String(64), nullable=False),
        sa.Column("context_hash", sa.String(64), nullable=False),
        sa.Column("rules_revision", sa.String(64), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("decisions", sa.JSON(), nullable=False),
        sa.Column("before_image", sa.JSON(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.Column("undone_by_name", sa.String(255), nullable=True),
    )
    for column in ("rota_period_id", "month", "status", "plan_hash", "created_at"):
        op.create_index(f"ix_extra_duty_batches_{column}", "extra_duty_batches", [column])
    op.create_table(
        "extra_duty_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("extra_duty_batches.id"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id"), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("slot_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("duty_date", sa.Date(), nullable=False),
        sa.Column("duty_type", sa.String(100), nullable=False),
        sa.Column("home_unit_id", sa.Uuid(), nullable=True),
        sa.Column("assigned_unit_id", sa.Uuid(), nullable=True),
        sa.Column("fallback_used", sa.Boolean(), nullable=False),
        sa.Column("overridden_rules", sa.JSON(), nullable=False),
        sa.Column("justice", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("void_reason", sa.String(255), nullable=True),
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("batch_id", "person_id", "assignment_id", "slot_id", "month", "duty_date", "status"):
        op.create_index(f"ix_extra_duty_records_{column}", "extra_duty_records", [column])
    op.create_table(
        "unit_fallbacks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("unit_id", sa.Uuid(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("fallback_unit_id", sa.Uuid(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("unit_id", "fallback_unit_id", name="uq_unit_fallbacks_pair"),
    )
    op.create_index("ix_unit_fallbacks_unit_id", "unit_fallbacks", ["unit_id"])


def downgrade():
    op.drop_table("unit_fallbacks")
    op.drop_table("extra_duty_records")
    op.drop_table("extra_duty_batches")
