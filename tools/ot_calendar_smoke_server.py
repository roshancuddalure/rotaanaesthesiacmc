"""Loopback OT browser fixture: isolated in-memory database, no operational writes."""

# ruff: noqa: E402
from pathlib import Path
from datetime import date
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import uvicorn

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import Base, get_db
from app.main import create_app
from app.models import OtCalendar, OtCalendarVersion, Person, PersonPosting, Unit, UserAccount
from app.services.rota_rules import get_phase_one_rules

settings.ot_calendar_enabled = True
engine = create_engine("sqlite+pysqlite:///:memory:",
                       connect_args={"check_same_thread": False}, poolclass=StaticPool)
app = create_app()
operator = None


def reset():
    global operator
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        operator = UserAccount(id=uuid4(), username="ot-browser", display_name="OT browser admin",
                               role="computer_admin", active_status="active", password_hash="test-only")
        unit = Unit(code="UNIT_IV", name="Unit 4")
        db.add_all([operator, unit, Unit(code="UNIT_I", name="Unit 1")])
        db.flush()
        for index in range(3):
            person = Person(canonical_name=f"OT fixture clinician {index}", call_level="3RD_CALL")
            db.add(person)
            db.flush()
            db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL",
                                 starts_on=date(2026, 11, 1), source="unit_board"))
        db.commit()
        get_phase_one_rules(db)
    return {"reset": True}


def database():
    with Session(engine) as db:
        yield db


app.dependency_overrides[get_db] = database
app.dependency_overrides[current_user] = lambda: operator
app.post("/__fixture/reset")(reset)


@app.get("/__fixture")
def inspect_fixture():
    with Session(engine) as db:
        return {"identity": "ot-calendar-browser-fixture", "calendars": db.query(OtCalendar).count(),
                "versions": db.query(OtCalendarVersion).count()}


if __name__ == "__main__":
    reset()
    uvicorn.run(app, host="127.0.0.1", port=8037, access_log=False)
