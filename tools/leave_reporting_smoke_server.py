"""Actual application leave reports; loopback and disposable memory database only."""

# ruff: noqa: E402
from datetime import date
import uvicorn
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import compute_smoke_server as fixture
from app.models import LeaveRequest, Person

app = fixture.app


@app.post("/__fixture/reporting")
def seed():
    fixture.reset_data()
    with Session(fixture.engine) as db:
        db.execute(delete(LeaveRequest))
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        for slot, status, day in [("AM", "approved", 10), ("AM", "approved", 10),
                                  ("FULL_DAY", "requested", 11), ("CUSTOM", "requested", 12)]:
            db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot=slot,
                                starts_on=date(2026, 5, day), ends_on=date(2026, 5, day), status=status))
        db.commit()
    return {"seeded": True}


@app.get("/__fixture/reporting-identity")
def identity():
    return {"identity": "leave-reporting-memory-fixture-v1"}


if __name__ == "__main__":
    seed()
    uvicorn.run(app, host="127.0.0.1", port=8039, access_log=False)
