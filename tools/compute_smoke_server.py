# ruff: noqa: E402
"""Loopback-only browser test server using disposable, in-memory data. Never uses the configured DB."""

import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import uvicorn
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import create_app
from app.models import DutyAssignment, RotaComputeJob, UserAccount, LeaveRequest
from uuid import UUID
from tests.test_rota_auto_fill import seed_auto_fill_context, create_slot
from datetime import date

engine = create_engine(
    "sqlite+pysqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
app = create_app()
operator = None


def reset_data():
    global operator
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first, _ = seed_auto_fill_context(db)
        create_slot(db, first.unit, date(2026, 5, 4))
        operator = UserAccount(
            id=uuid4(),
            username="browser-compute",
            display_name="Browser test admin",
            email=None,
            role="computer_admin",
            active_status="active",
            password_hash="disposable-test-only",
        )
        db.add(operator)
        db.commit()
        db.refresh(operator)
        db.expunge(operator)


def database():
    with Session(engine) as db:
        yield db


app.dependency_overrides[get_db] = database
app.dependency_overrides[current_user] = lambda: operator


@app.post("/__fixture/reset")
def reset():
    reset_data()
    return {"reset": True}


@app.get("/__fixture")
def inspect_fixture():
    with Session(engine) as db:
        return {
            "assignments": db.query(DutyAssignment).count(),
            "active_assignments":db.query(DutyAssignment).filter_by(status='assigned').count(),
            "cancelled_assignments":db.query(DutyAssignment).filter_by(status='cancelled').count(),
            "jobs": [
                {"id": str(j.id), "status": j.status} for j in db.query(RotaComputeJob)
            ],
        }


@app.post('/__fixture/leave')
def add_fixture_leave(payload:dict):
    with Session(engine) as db:
        db.add(LeaveRequest(person_id=UUID(payload['person_id']),leave_type='CASUAL_LEAVE',
            leave_slot='FULL_DAY',starts_on=date.fromisoformat(payload['date']),
            ends_on=date.fromisoformat(payload['date']),status='approved'))
        db.commit()
    return {'added':True}


if __name__ == "__main__":
    reset_data()
    uvicorn.run(app, host="127.0.0.1", port=8019, access_log=False)
