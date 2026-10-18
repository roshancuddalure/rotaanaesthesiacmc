"""Durable reviewed rota compute jobs."""
from alembic import op
import sqlalchemy as sa

revision = "20261018_0021"
down_revision = "20261018_0020"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("rota_compute_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("operator_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("engine", sa.String(30), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("context_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    for name in ["month", "operator_id", "status"]:
        op.create_index(f"ix_rota_compute_jobs_{name}", "rota_compute_jobs", [name])
    op.create_index("uq_rota_compute_active_month", "rota_compute_jobs", ["month"], unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running', 'completed')"),
        sqlite_where=sa.text("status IN ('queued', 'running', 'completed')"))


def downgrade():
    op.drop_table("rota_compute_jobs")
