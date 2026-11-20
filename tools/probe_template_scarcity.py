"""Reproduce dated scarcity through the real template generator in memory only."""

# ruff: noqa: E402
import argparse
from datetime import date
import hashlib
from itertools import product
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, Unit
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_setup import monthly_setup, update_scope_units
from app.services.rota_template import generate_empty_template, TemplateGenerationOptions
from tests.test_rota_auto_fill import create_slot
from compare_allocation_architectures import solve


def experiment():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            units = [Unit(code=f"UNIT_{x}", name=f"Unit {x}", campus="MAIN") for x in ("A", "B")]
            db.add_all(units)
            db.flush()
            members = []
            for u, unit in enumerate(units):
                people = [Person(canonical_name=f"{unit.code} member {p}", call_level="1ST_CALL") for p in range(3)]
                db.add_all(people)
                db.flush()
                for person in people:
                    db.add(PersonPosting(person=person, unit=unit, posting_type="1ST_CALL", starts_on=date(2026, 4, 1), source="unit_board"))
                    if u == 1:
                        db.add(LeaveRequest(person=person, starts_on=date(2026, 5, 5), ends_on=date(2026, 5, 5), leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", status="approved"))
                members.append(people)
            db.commit()
            _, scope = monthly_setup(db, "2026-05")
            update_scope_units(db, scope, [unit.id for unit in units], [], True, True, "Disposable scarcity experiment")
            started = perf_counter()
            generated = generate_empty_template(db, "2026-05", TemplateGenerationOptions(duty_keys=["MAIN_1ST_24HR"], starts_on=date(2026, 5, 4), ends_on=date(2026, 5, 5)))
            template_seconds = perf_counter() - started
            originals = list(db.scalars(select(DutySlot).order_by(DutySlot.duty_date)))
            assert len(originals) == 2
            context = candidate_context(db, "2026-05")
            selected = {str(slot.id): slot for slot in originals}
            current = solve_month(db, context, selected, seconds=10)
            assert validate_plan(db, context, selected, current["choices"]) == []
            # Keep the generated slots, making only missing unit alternatives.
            alternatives = {}
            for d, slot in enumerate(originals):
                for u, unit in enumerate(units):
                    alternatives[d, u] = slot if slot.unit_id == unit.id else create_slot(db, unit, slot.duty_date)
            db.commit()
            context = candidate_context(db, "2026-05")
            options = {(d, u, p): (alternatives[d, u], person) for d in range(2) for u in range(2) for p, person in enumerate(members[u])}

            def check(keys):
                slots = {str(options[key][0].id): options[key][0] for key in keys}
                choices = {str(options[key][0].id): str(options[key][1].id) for key in keys}
                return validate_plan(db, context, slots, choices)

            invalid, feasible = [], []
            for sequence in product(*[[None, *(key for key in options if key[0] == d)] for d in range(2)]):
                keys = tuple(key for key in sequence if key is not None)
                (invalid if check(keys) else feasible).append(keys)
            joint, joint_seconds = solve(options, invalid)
            original_layout = tuple(next(u for u, unit in enumerate(units) if unit.id == slot.unit_id) for slot in originals)
            fixed, _ = solve(options, invalid, original_layout)
            best_neighbors = []
            layout_results = []
            for layout in product(range(2), repeat=2):
                result, _ = solve(options, invalid, layout)
                layout_results.append({"units": [units[u].code for u in layout], "covered": len(result)})
            for d in range(2):
                layout = tuple(1 - u if i == d else u for i, u in enumerate(original_layout))
                result, _ = solve(options, invalid, layout)
                best_neighbors.append(result)
            repaired = max([fixed, *best_neighbors], key=len)
            coordinated, _ = solve(options, invalid, tuple(reversed(original_layout)))
            maximum = max(map(len, feasible))
            assert len(joint) == maximum
            assert len(fixed) == len(current["choices"])
            assert check(joint) == check(repaired) == []
            assert check(coordinated) == []
            assert original_layout == (0, 1), original_layout
            assert len(fixed) == len(repaired) == 1
            assert len(joint) == len(coordinated) == maximum == 2
            assert db.query(DutyAssignment).count() == 0
            return {
                "scenario": "Two days, two units, three first-call members per unit; all Unit B members on approved leave on day two.",
                "template_generation_seconds": template_seconds,
                "generated_slots": [{"day": str(slot.duty_date), "unit": slot.unit.code, "status": slot.template_status, "reason": slot.template_reason} for slot in originals],
                "template_run": generated["latest_run"],
                "current_optimizer_coverage": len(current["choices"]),
                "current_optimizer_status": current["status"],
                "fixed_layout_exact_coverage": len(fixed),
                "joint_coverage": len(joint), "one_move_repair_coverage": len(repaired),
                "coordinated_swap_repair_coverage": len(coordinated),
                "exact_coverage_by_unit_layout": layout_results,
                "exhaustive_maximum": maximum, "canonical_plans_enumerated": len(feasible) + len(invalid),
                "joint_solve_seconds_excluding_conflict_preparation": joint_seconds,
                "joint_choices": [{"day": str(options[key][0].duty_date), "unit": options[key][0].unit.code, "person": options[key][1].canonical_name} for key in joint],
                "counterexample_found": len(fixed) < maximum,
                "final_checks_clear": True, "saved_assignments": 0,
                "limits": "Synthetic coverage-only canonical oracle, OT off, no independent safety implementation, memory/fairness unmeasured, no architecture selected.",
            }
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain old evidence; choose a new path")
    files = [Path(__file__), ROOT / "tools/compare_allocation_architectures.py", ROOT / "backend/tests/test_rota_auto_fill.py", *sorted((ROOT / "backend/app").rglob("*.py"))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    original = settings.ot_calendar_enabled
    settings.ot_calendar_enabled = False
    try:
        result = experiment()
        assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
        args.output.write_text(json.dumps({"complete": True, "source_unchanged": True, "source_sha256": hashes, "result": result}, indent=2, default=str) + "\n", encoding="utf-8")
        print(json.dumps({key: result[key] for key in ("counterexample_found", "current_optimizer_coverage", "joint_coverage", "one_move_repair_coverage")}), flush=True)
    finally:
        settings.ot_calendar_enabled = original


if __name__ == "__main__":
    main()
