"""N24 canonical leave/OT/repair browser fixture, disposable SQLite memory only."""

# ruff: noqa: E402
from datetime import date, datetime
from uuid import uuid4

import uvicorn
from sqlalchemy import select
from sqlalchemy.orm import Session

import compute_smoke_server as fixture
from app.core.config import settings
from app.models import DutyAssignment, DutySlot, LeaveRequest, OtCalendar, Person, RotaPeriod, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_rules import get_phase_one_rules

app = fixture.app
settings.ot_calendar_enabled = True
settings.rota_compute_enabled = True
settings.rota_intelligence_enabled = True


@app.get("/__fixture/leave-repair-identity")
def identity():
    return {"identity": "leave-repair-memory-fixture-v1"}


@app.post("/__fixture/leave-repair")
def seed():
    fixture.reset_data()
    with Session(fixture.engine) as db:
        get_phase_one_rules(db)
        unit = db.scalar(select(Unit))
        safe = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        blocked = db.scalar(select(Person).where(Person.canonical_name == "Blocked Member"))
        slot = db.scalar(select(DutySlot).where(DutySlot.duty_date == date(2026,5,2)))
        db.add(DutyAssignment(person=blocked, duty_slot=slot, status="assigned"))
        period = RotaPeriod(name="Protected April fixture", starts_on=date(2026,4,1), ends_on=date(2026,4,30), status="published")
        overnight = DutySlot(rota_period=period, unit=unit, duty_date=date(2026,4,30), duty_type="MAIN_1ST_24HR",
                            slot_label="Protected overnight", starts_at=datetime(2026,4,30,20),
                            ends_at=datetime(2026,5,1,8), is_24hr=False, source="historical")
        db.add(DutyAssignment(person=safe, duty_slot=overnight, status="assigned"))
        for day in (1,20):
            db.add(LeaveRequest(person=safe, starts_on=date(2026,5,day), ends_on=date(2026,5,day),
                                leave_slot="FULL_DAY", leave_type="CASUAL_LEAVE", status="requested", notes="PRIVATE fixture note"))
        def band(minimum):
            return {"key": "first", "start_minute": 480, "end_minute": 960,
                    "call_levels": ["1ST_CALL"], "minimum": minimum, "target": minimum}
        value = canonical(CalendarConfiguration.model_validate({"reserve_mode": "included", "weekly": [
            {"id": str(uuid4()), "unit_id": str(unit.id), "area_key": "main", "weekday": day,
             "effective_from": "2026-04-01", "bands": [band(0)]}
            for day in ("MON","TUE","WED","THU","FRI","SAT","SUN")], "exceptions": [
            {"id": str(uuid4()), "unit_id": str(unit.id), "area_key": "main", "day": "2026-05-20", "bands": [band(4)]}]}))
        db.add(OtCalendar(unit_id=unit.id, configuration=value, revision=revision(value)))
        db.commit()
        return {"repair_slot": str(slot.id), "protected_slot": str(overnight.id),
                "repair_leave": str(db.scalar(select(LeaveRequest).where(LeaveRequest.person_id==blocked.id)).id)}


@app.post("/__fixture/leave-repair-change")
def change():
    with Session(fixture.engine) as db:
        db.scalar(select(Unit)).minimum_free_people += 1
        db.commit()
    return {"changed": True}


@app.post("/__fixture/leave-ot-only")
def ot_only():
    fixture.reset_data()
    from tests.test_leave_ot_repair_api import setup_ot_only
    with Session(fixture.engine) as db:
        _, _, slot, leave, assignment = setup_ot_only(db)
        return {"repair_slot": str(slot.id), "repair_leave": str(leave.id),
                "assignment_id": str(assignment.id)}


@app.post("/__fixture/leave-repair-unknown")
def unknown():
    with Session(fixture.engine) as db:
        db.query(OtCalendar).delete()
        db.commit()
    return {"reviewed_calendar_missing": True}


if __name__ == "__main__":
    seed()
    uvicorn.run(app, host="127.0.0.1", port=8041, access_log=False)
