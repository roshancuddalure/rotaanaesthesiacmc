"""Resolution rules get a scope; historical rota spellings become history-only rules.

Live leave and unit imports ignore "history" rules, so old-file spellings can never decide a
live record. Adds rows only.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = "20261020_0025"
down_revision = "20261020_0024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("member_resolution_rules",
                  sa.Column("scope", sa.String(20), nullable=False, server_default="all"))

    from app.services.member_resolution_rules import seed_resolution_rules

    with Session(bind=op.get_bind()) as db:
        seed_resolution_rules(db)
        db.commit()


def downgrade():
    op.execute("DELETE FROM member_resolution_rules WHERE scope = 'history'")
    op.drop_column("member_resolution_rules", "scope")
