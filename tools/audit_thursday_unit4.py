"""Actual template/person paths: Thursday Unit IV demand and later compensation."""

# ruff: noqa: E402
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import NAMESPACE_URL, UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, OtCalendar, Person, PersonPosting, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_setup import monthly_setup, update_scope_units
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template


def run_case(name, pressure, later, start_day=19):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            units = [Unit(code=f"UNIT_{code}", name=f"Unit {code}", campus="MAIN", minimum_free_people=1) for code in ("IV", "V")]
            db.add_all(units)
            db.flush()
            for index, unit in enumerate(units):
                for p in range(4):
                    person = Person(canonical_name=f"Synthetic {unit.code} member {p}", call_level="3RD_CALL", active_status="active")
                    db.add(person)
                    db.flush()
                    db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL", starts_on=date(2026, 10, 1), source="unit_board"))
                config = canonical(CalendarConfiguration.model_validate({"reserve_mode": "included", "weekly": [{
                    "id": str(uuid5(NAMESPACE_URL, f"unit4-audit:{unit.code}:{weekday}")), "unit_id": str(unit.id), "area_key": "elective", "weekday": weekday, "effective_from": "2026-10-01",
                    "bands": [{"key": "senior", "start_minute": 480, "end_minute": 960, "call_levels": ["3RD_CALL"], "minimum": 4 if pressure and index == 0 and weekday == "THU" else 0, "target": 4 if pressure and index == 0 and weekday == "THU" else 0}],
                } for weekday in ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")]}))
                db.add(OtCalendar(unit_id=unit.id, configuration=config, revision=revision(config)))
            db.commit()
            _, scope = monthly_setup(db, "2026-11")
            update_scope_units(db, scope, [unit.id for unit in units], [], True, True, "Synthetic Thursday demand audit")
            result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(duty_keys=["MAIN_3RD_24HR"], starts_on=date(2026, 11, start_day), ends_on=date(2026, 11, start_day + 1 if later else start_day)))
            slots = list(db.scalars(select(DutySlot).order_by(DutySlot.duty_date)))
            assert len(slots) == (2 if later else 1), result
            assert all(slot.unit_id is not None for slot in slots)
            context = candidate_context(db, "2026-11")
            selected = {str(slot.id): slot for slot in slots}
            solved = solve_month(db, context, selected, seconds=10)
            assert len(solved["choices"]) == len(slots), solved
            assert validate_plan(db, context, selected, solved["choices"]) == []
            assignments = [SimpleNamespace(person_id=UUID(pid), duty_slot=selected[sid], status="assigned") for sid, pid in solved["choices"].items()]
            proof = context.ot_guard.check(assignments, context.rules)
            assert proof["status"] == "feasible", proof
            assert db.query(DutyAssignment).count() == 0
            rows = [{"date": str(slot.duty_date), "unit": slot.unit.code, "status": slot.template_status, "reason": slot.template_reason} for slot in slots]
            counts = Counter(row["unit"] for row in rows)
            return {"case": name, "pressure_on": pressure, "later_required_duty": later,
                "calendar_basis": "Both units explicitly reviewed all weekdays; Unit IV Thursday minimum0 control versus4 demand; other unit/days minimum0, no silent missing-demand zero. Unit free-person minimum1 with explicitly included OT reserve mode.",
                "generated_slots": rows, "unit_duty_counts": {unit.code: counts[unit.code] for unit in units},
                "required": len(slots), "covered": len(solved["choices"]), "ordinary_final_failures": 0,
                "whole_month_ot_final_status": proof["status"], "saved_assignments": 0,
                "compensation": "No later required duty in this selected generation window; compensation cannot be promised." if pressure and start_day == 19 and not later else "Later duty available in selected generation window." if later else "No Thursday duty was displaced in this selected window.",
                "template_summary": result["latest_run"]["summary"],
                "limits": "Two-day or one-day synthetic window, current default policy, no full-month fairness/architecture/performance proof."}
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve historical evidence; choose a new path")
    files = [Path(__file__), *sorted((ROOT / "backend/app/services").glob("*.py"))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "source_sha256": hashes, "runs": [], "scope": "Actual canonical template and person optimizer on disposable SQLite only; no operational writes or domain-policy amendments."}
    previous = settings.ot_calendar_enabled
    settings.ot_calendar_enabled = True
    try:
        for name, pressure, later, start_day in [("reviewed_zero", False, True, 19), ("thursday_pressure", True, True, 19), ("no_later_required_duty", True, False, 19), ("unaffected_tuesday_control", False, False, 24), ("unaffected_tuesday_pressure", True, False, 24)]:
            print("Starting " + name, flush=True)
            report["runs"].append(run_case(name, pressure, later, start_day))
            args.output.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        control, pressure, short, tuesday_control, tuesday_pressure = report["runs"]
        assert control["generated_slots"][0]["unit"] == "UNIT_IV"
        assert pressure["generated_slots"][0]["unit"] == short["generated_slots"][0]["unit"] == "UNIT_V"
        assert pressure["generated_slots"][1]["unit"] == "UNIT_IV"
        assert control["unit_duty_counts"] == pressure["unit_duty_counts"] == {"UNIT_IV": 1, "UNIT_V": 1}
        assert short["unit_duty_counts"] == {"UNIT_IV": 0, "UNIT_V": 1}
        assert tuesday_control["generated_slots"] == tuesday_pressure["generated_slots"]
        assert tuesday_pressure["generated_slots"][0]["unit"] == "UNIT_IV"
        assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
        report["complete"] = report["source_unchanged"] = True
        args.output.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    finally:
        settings.ot_calendar_enabled = previous


if __name__ == "__main__":
    main()
