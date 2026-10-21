"""Loopback-only monthly leave approval fixtures; never uses a configured database."""

from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import select
import uvicorn

import compute_smoke_server as fixture
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person

app = fixture.app


@app.post("/__fixture/leave-approval")
def seed():
    fixture.reset_data()
    with Session(fixture.engine) as db:
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        for start, end, status in [
            (date(2026, 5, 2), date(2026, 5, 2), "requested"),
            (date(2026, 5, 31), date(2026, 6, 2), "imported_pending_review"),
            (date(2026, 5, 10), date(2026, 5, 10), "cancelled"),
            (date(2026, 5, 11), date(2026, 5, 11), "rejected"),
        ]:
            db.add(
                LeaveRequest(
                    person=person,
                    leave_type="ANNUAL_LEAVE",
                    leave_slot="FULL_DAY",
                    starts_on=start,
                    ends_on=end,
                    status=status,
                )
            )
        slot = db.scalar(select(DutySlot).where(DutySlot.duty_date == date(2026, 5, 2)))
        db.add(DutyAssignment(person=person, duty_slot=slot, status="assigned"))
        db.commit()
    return {"pending": 2}


@app.post("/__fixture/leave-approval-change")
def change():
    with Session(fixture.engine) as db:
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        db.add(
            LeaveRequest(
                person=person,
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 15),
                ends_on=date(2026, 5, 15),
                status="requested",
            )
        )
        db.commit()
    return {"added": True}


@app.post("/__fixture/leave-approval-board")
def board():
    with Session(fixture.engine) as db:
        fixture.operator.role = "rota_board_member"
        db.merge(fixture.operator)
        db.commit()
    return {"role": "rota_board_member"}


if __name__ == "__main__":
    seed()
    uvicorn.run(app, host="127.0.0.1", port=8025, access_log=False)
