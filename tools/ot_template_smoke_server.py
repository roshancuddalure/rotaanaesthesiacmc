"""Loopback application fixture for OT template presentation; memory database only."""

# ruff: noqa: E402
from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import HTTPException
from sqlalchemy.orm import Session
import uvicorn

import ot_calendar_smoke_server as fixture
from app.models import DutyAssignment, DutySlot, LeaveRequest, MonthlyGenerationScopeUnit, OtCalendar, Person, PersonPosting, Unit
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template
from tests.test_ot_assignment_integration import demand

app = fixture.app


@app.post("/__fixture/template")
def seed(scenario: str = "shortage"):
    if scenario not in {"shortage", "unknown", "safe", "forced_review"}:
        raise HTTPException(422, "Unknown disposable scenario")
    fixture.reset()
    with Session(fixture.engine, expire_on_commit=False) as db:
        unit = db.query(Unit).filter_by(code="UNIT_IV").one()
        unit.minimum_free_people = 0
        for other in db.query(Unit).filter(Unit.id != unit.id):
            other.active_status = "inactive"
        fourth = Person(canonical_name="OT fixture clinician 3", call_level="3RD_CALL", active_status="active")
        db.add(fourth)
        db.flush()
        db.add(PersonPosting(person=fourth, unit=unit, posting_type="3RD_CALL",
                             starts_on=date(2026, 11, 1), source="unit_board"))
        _, scope = monthly_setup(db, "2026-11")
        scope.is_locked = True
        db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
        db.commit()
        if scenario != "unknown":
            demand(db, unit, minimum={"shortage": 4, "safe": 3, "forced_review": 0}[scenario])
        if scenario == "safe":
            _, rules = get_phase_one_rules(db)
            rules.unit_staffing_rules.minimum_available_count = 0
            rules.unit_staffing_rules.hard_block_unavailable_percent = 100
            rules.unit_staffing_rules.warning_unavailable_percent = 100
            rules.unit_staffing_rules.small_unit_uses_absolute_minimum = False
            save_phase_one_rules(db, rules)
        if scenario == "forced_review":
            for person in db.query(Person):
                db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                                    starts_on=date(2026, 11, 19), ends_on=date(2026, 11, 19), status="approved"))
            db.commit()
        result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
            duty_keys=["MAIN_3RD_24HR"], starts_on=date(2026, 11, 19), ends_on=date(2026, 11, 19)))
        return {"identity": "ot-template-browser-fixture-v1", "scenario": scenario,
                "slots": result["slots"], "summary": result["latest_run"]["summary"],
                "assignments": db.query(DutyAssignment).count()}


@app.get("/__fixture/template-state")
def inspect_state():
    with Session(fixture.engine) as db:
        return {"identity": "ot-template-browser-fixture-v1", "assignments": db.query(DutyAssignment).count(),
                "calendars": db.query(OtCalendar).count()}


@app.post("/__fixture/month")
def seed_month(scenario: str = "unknown"):
    if scenario not in {"unknown", "shortage", "protected", "empty"}:
        raise HTTPException(422, "Unknown disposable scenario")
    seed("safe")
    with Session(fixture.engine, expire_on_commit=False) as db:
        unit = db.query(Unit).filter_by(code="UNIT_IV").one()
        if scenario == "unknown":
            db.query(OtCalendar).delete()
            db.query(Unit).filter(Unit.id != unit.id).update({"active_status": "active"})
        elif scenario == "shortage":
            demand(db, unit, minimum=5)
        elif scenario == "protected":
            db.query(DutySlot).one().rota_period.status = "published"
        else:
            db.query(DutySlot).delete()
        db.commit()
    return {"identity": "ot-template-browser-fixture-v1", "scenario": scenario}


if __name__ == "__main__":
    fixture.reset()
    uvicorn.run(app, host="127.0.0.1", port=8038, access_log=False)
