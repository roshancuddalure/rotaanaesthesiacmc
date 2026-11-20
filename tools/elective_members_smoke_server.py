"""Loopback-only elective export browser fixture; never opens the operational DB."""

from datetime import datetime, timedelta

from compute_smoke_server import app, engine, reset_data
from sqlalchemy.orm import Session
import uvicorn

from app.models import DutyAssignment, DutySlot, MonthlyGenerationScopeUnit, Unit
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup
from tests.test_elective_members_export import person


@app.post("/__fixture/elective-reset")
def reset_elective():
    reset_data()
    with Session(engine) as db:
        get_phase_one_rules(db)
        period, scope = monthly_setup(db, "2026-05")
        scope.is_locked = True
        unit = db.query(Unit).first()
        other = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
        outside = Unit(code="OUT", name="Excluded Unit")
        db.add_all([other, outside])
        db.flush()
        for u in [unit, other]:
            db.add(MonthlyGenerationScopeUnit(scope=scope, unit=u, status="included"))
        person(db, unit, "Elective available A")
        person(db, other, "Elective available B")
        person(db, outside, "Excluded must not appear")
        holder = person(db, unit, "Duty and post-duty holder")
        starts = datetime(2026, 5, 1, 8)
        duty = DutySlot(rota_period=period, unit=unit, duty_date=starts.date(), call_level="1ST_CALL",
            duty_type="MAIN_1ST_24HR", slot_label="Fixture duty", source="phase4_template", is_24hr=True,
            starts_at=starts, ends_at=starts + timedelta(days=1))
        db.add(DutyAssignment(person=holder, duty_slot=duty, status="assigned"))
        db.commit()
    return {"ready": True}


@app.post("/__fixture/elective-unlock")
def unlock():
    with Session(engine) as db:
        _, scope = monthly_setup(db, "2026-05")
        scope.is_locked = False
        db.commit()
    return {"unlocked": True}


if __name__ == "__main__":
    reset_elective()
    uvicorn.run(app, host="127.0.0.1", port=8042, access_log=False)
