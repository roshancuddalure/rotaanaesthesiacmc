# ruff: noqa: E402
"""Loopback-only UX audit server: the real API on a disposable copy of the department database.

Signs every request in as the first superadmin so the audit can reach all sections without a
password. It refuses to run against the configured working database.

    CREATE DATABASE duty_rota_ux_audit TEMPLATE duty_rota;   -- once, with no other connections
    backend/.venv/Scripts/python.exe tools/ux_audit_server.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import uvicorn
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import UserAccount

working_url = settings.sqlalchemy_database_url
audit_url = os.environ.get("UX_AUDIT_DATABASE_URL") or working_url.rsplit("/", 1)[0] + "/duty_rota_ux_audit"
if audit_url == working_url:
    raise SystemExit("UX audit must run on a copy of the database, never the working database.")

engine = create_engine(audit_url, pool_pre_ping=True)
Sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False)
with Sessions() as db:
    operator = db.scalar(select(UserAccount).where(UserAccount.role == "superadmin").order_by(UserAccount.username))
    if operator is None:
        raise SystemExit("The audit database has no superadmin account.")
    db.expunge(operator)


def audit_db():
    db = Sessions()
    try:
        yield db
    finally:
        db.close()


app = create_app()
app.dependency_overrides[get_db] = audit_db
app.dependency_overrides[current_user] = lambda: operator

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("UX_AUDIT_PORT", "8020")), access_log=False)
