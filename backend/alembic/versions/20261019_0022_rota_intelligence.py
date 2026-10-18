"""Reviewed teaching examples and learning versions; no operational data changes."""

from alembic import op
import sqlalchemy as sa

revision = "20261019_0022"
down_revision = "20261018_0021"
branch_labels = None
depends_on = None


def upgrade():
    for table in ["rota_teaching_examples", "rota_learning_versions"]:
        columns = [
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("operator_id", sa.Uuid(), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("data", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        ]
        if table == "rota_teaching_examples":
            columns.append(sa.Column("job_id", sa.Uuid(), nullable=False))
        op.create_table(table, *columns)
        for field in ["operator_id", "status"] + (
            ["job_id"] if table == "rota_teaching_examples" else []
        ):
            op.create_index(f"ix_{table}_{field}", table, [field])


def downgrade():
    op.drop_table("rota_learning_versions")
    op.drop_table("rota_teaching_examples")
