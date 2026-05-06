"""Add import traceability tables.

Revision ID: 20260506_0002
Revises: 20260505_0001
Create Date: 2026-05-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260506_0002"
down_revision: str | None = "20260505_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=True),
        sa.Column("import_kind", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_import_batches_import_kind"), "import_batches", ["import_kind"])
    op.create_index(op.f("ix_import_batches_source_filename"), "import_batches", ["source_filename"])
    op.create_index(op.f("ix_import_batches_status"), "import_batches", ["status"])

    op.create_table(
        "import_source_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("sheet_name", sa.String(length=255), nullable=True),
        sa.Column("row_index", sa.Integer(), nullable=True),
        sa.Column("column_index", sa.Integer(), nullable=True),
        sa.Column("column_label", sa.String(length=50), nullable=True),
        sa.Column("raw_value", sa.Text(), nullable=True),
        sa.Column("cleaned_value", sa.Text(), nullable=True),
        sa.Column("record_type", sa.String(length=100), nullable=False),
        sa.Column("normalized_table", sa.String(length=100), nullable=True),
        sa.Column("normalized_id", sa.Uuid(), nullable=True),
        sa.Column("rule_key", sa.String(length=150), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["import_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_import_source_records_batch_id"), "import_source_records", ["batch_id"]
    )
    op.create_index(
        op.f("ix_import_source_records_record_type"), "import_source_records", ["record_type"]
    )
    op.create_index(
        op.f("ix_import_source_records_sheet_name"), "import_source_records", ["sheet_name"]
    )

    op.create_table(
        "import_warnings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("source_record_id", sa.Uuid(), nullable=True),
        sa.Column("severity", sa.String(length=50), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["import_batches.id"]),
        sa.ForeignKeyConstraint(["source_record_id"], ["import_source_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_import_warnings_batch_id"), "import_warnings", ["batch_id"])
    op.create_index(op.f("ix_import_warnings_code"), "import_warnings", ["code"])
    op.create_index(op.f("ix_import_warnings_severity"), "import_warnings", ["severity"])
    op.create_index(
        op.f("ix_import_warnings_source_record_id"), "import_warnings", ["source_record_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_import_warnings_source_record_id"), table_name="import_warnings")
    op.drop_index(op.f("ix_import_warnings_severity"), table_name="import_warnings")
    op.drop_index(op.f("ix_import_warnings_code"), table_name="import_warnings")
    op.drop_index(op.f("ix_import_warnings_batch_id"), table_name="import_warnings")
    op.drop_table("import_warnings")
    op.drop_index(op.f("ix_import_source_records_sheet_name"), table_name="import_source_records")
    op.drop_index(op.f("ix_import_source_records_record_type"), table_name="import_source_records")
    op.drop_index(op.f("ix_import_source_records_batch_id"), table_name="import_source_records")
    op.drop_table("import_source_records")
    op.drop_index(op.f("ix_import_batches_status"), table_name="import_batches")
    op.drop_index(op.f("ix_import_batches_source_filename"), table_name="import_batches")
    op.drop_index(op.f("ix_import_batches_import_kind"), table_name="import_batches")
    op.drop_table("import_batches")
