"""Member leave action browser fixture; disposable SQLite memory and loopback only."""

# ruff: noqa: E402
from datetime import date
import uvicorn
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import compute_smoke_server as fixture
from app.models import LeaveRequest, Person

app = fixture.app


@app.post("/__fixture/member-leave")
def seed_member_leave():
    fixture.reset_data()
    with Session(fixture.engine) as db:
        db.execute(delete(LeaveRequest))
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        row = LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                           status="requested", starts_on=date(2026, 5, 20), ends_on=date(2026, 5, 20),
                           notes="PRIVATE clinical note")
        db.add(row)
        db.commit()
        return {"person_id": str(person.id), "leave_id": str(row.id)}


@app.post("/__fixture/member-leave-change")
def change():
    with Session(fixture.engine) as db:
        row = db.scalar(select(LeaveRequest))
        row.notes = "PRIVATE concurrent correction"
        db.commit()
    return {"changed": True}


@app.post("/__fixture/member-statistics")
def seed_statistics():
    fixture.reset_data()
    with Session(fixture.engine) as db:
        db.execute(delete(LeaveRequest))
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        for first, last, slot, status in [(10, 12, "FULL_DAY", "approved"), (14, 14, "FULL_DAY", "approved"),
                                          (20, 21, "FULL_DAY", "approved"), (14, 14, "AM", "approved"),
                                          (22, 22, "CUSTOM", "requested")]:
            db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot=slot, status=status,
                                starts_on=date(2026, 5, first), ends_on=date(2026, 5, last), notes="PRIVATE stats note"))
        db.commit()
        return {"person_id": str(person.id)}


@app.get("/__fixture/member-leave-identity")
def identity():
    return {"identity": "member-leave-memory-fixture-v1"}


if __name__ == "__main__":
    seed_member_leave()
    uvicorn.run(app, host="127.0.0.1", port=8040, access_log=False)
