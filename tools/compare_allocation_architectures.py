"""Preparatory two-duty coverage experiment, never an operational scheduler.

Canonical final-plan checks supply every singleton and pair conflict. Pair cuts
are exact ONLY for these two-duty fixtures; larger staffing/OT models need
higher-order constraints. Fairness and production template quality are not scored.
"""

# ruff: noqa: E402
import argparse
from collections import Counter
from datetime import date
import hashlib
from itertools import product
import json
from pathlib import Path
import platform
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from ortools.sat.python import cp_model
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import DutyAssignment, Person, PersonPosting, Unit
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import validate_plan
from tests.test_rota_auto_fill import create_slot


def solve(options, invalid, layout=None):
    started = perf_counter()
    model = cp_model.CpModel()
    variables = {key: model.new_bool_var(str(key)) for key in options}
    for duty in range(2):
        model.add(sum(v for key, v in variables.items() if key[0] == duty) <= 1)
    for conflict in invalid:
        model.add(sum(variables[key] for key in conflict) <= len(conflict) - 1)
    if layout is not None:
        for key, variable in variables.items():
            if key[1] != layout[key[0]]:
                model.add(variable == 0)
    model.maximize(sum(variables.values()))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_time_in_seconds = 10
    status = solver.solve(model)
    assert status == cp_model.OPTIMAL, solver.status_name(status)
    chosen = tuple(key for key, var in variables.items() if solver.value(var))
    return chosen, perf_counter() - started


def run_case(name, days, locked=False):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            units = [Unit(code=f"UNIT_{x}", name=f"Unit {x}", campus="MAIN") for x in ("I", "II")]
            db.add_all(units)
            db.flush()
            people = []
            for unit_index, unit in enumerate(units):
                members = [Person(canonical_name=f"U{unit_index} member {i}", call_level="1ST_CALL") for i in range(3)]
                db.add_all(members)
                db.flush()
                for member in members:
                    db.add(PersonPosting(person=member, unit=unit, posting_type="1ST_CALL", starts_on=date(2026, 4, 1), source="unit_board"))
                people.append(members)
            alternatives = {}
            for d, day in enumerate(days):
                for u, unit in enumerate(units):
                    slot = create_slot(db, unit, date(2026, 5, day))
                    slot.slot_label += f":logical-duty-{d}"
                    db.flush()
                    alternatives[d, u] = slot
            db.commit()
            context = candidate_context(db, "2026-05")
            options = {(d, u, p): (alternatives[d, u], member) for d in range(2) for u in range(2) for p, member in enumerate(people[u]) if not locked or u == 0}

            def check(keys):
                selected = {str(options[key][0].id): options[key][0] for key in keys}
                choices = {str(options[key][0].id): str(options[key][1].id) for key in keys}
                assert len(selected) == len(keys), "One alternative per logical duty"
                return validate_plan(db, context, selected, choices)

            # Exhaustive canonical oracle: no duplicated rest/staffing arithmetic.
            started = perf_counter()
            invalid = []
            feasible = []
            rejected_codes = Counter()
            choices_by_duty = [[None, *(key for key in options if key[0] == d)] for d in range(2)]
            for sequence in product(*choices_by_duty):
                keys = tuple(key for key in sequence if key is not None)
                failures = check(keys)
                if failures:
                    invalid.append(keys)
                    rejected_codes.update(issue["code"] for row in failures for issue in row["issues"])
                else:
                    feasible.append(keys)
            oracle_seconds = perf_counter() - started
            best = max(map(len, feasible))
            joint, joint_seconds = solve(options, invalid)
            fixed, fixed_seconds = solve(options, invalid, (0, 0))
            layout = (0, 0)
            repaired = fixed
            repair_seconds = fixed_seconds
            calls = 1
            # Strict coverage improvement, all one-coordinate moves per round.
            # This can get trapped on larger instances; no global repair claim.
            while not locked:
                neighbors = []
                for duty in range(2):
                    next_layout = tuple(1 - u if i == duty else u for i, u in enumerate(layout))
                    result, seconds = solve(options, invalid, next_layout)
                    calls += 1
                    repair_seconds += seconds
                    neighbors.append((len(result), next_layout, result))
                count, next_layout, result = max(neighbors)
                if count <= len(repaired):
                    break
                layout, repaired = next_layout, result
            assert len(joint) == best
            assert all(check(result) == [] for result in (joint, fixed, repaired))
            assert db.query(DutyAssignment).count() == 0
            expected = 2 if not locked else 1
            assert best == expected, (name, best, rejected_codes)
            assert len(repaired) == best
            assert len(fixed) == (2 if name == "spaced_control" else 1), (name, len(fixed), best, dict(rejected_codes), fixed)

            def normalized(keys):
                return [{"duty": key[0], "unit": units[key[1]].code, "person": options[key][1].canonical_name} for key in keys]

            return {
                "case": name, "days": days, "unit_choices_locked_to_A": locked,
                "logical_duties": 2, "people": 6,
                "canonical_plans_enumerated": len(feasible) + len(invalid),
                "canonical_feasible_plans": len(feasible), "rejected_issue_counts": dict(rejected_codes),
                "oracle_max_coverage": best, "oracle_and_encoding_seconds": oracle_seconds,
                "fixed_template": {"covered": len(fixed), "solve_seconds": fixed_seconds, "choices": normalized(fixed)},
                "joint": {"covered": len(joint), "solve_seconds": joint_seconds, "choices": normalized(joint)},
                "iterative": {"covered": len(repaired), "solve_seconds": repair_seconds, "solver_calls": calls, "choices": normalized(repaired)},
                "all_final_checks_clear": True, "assignment_writes": 0,
                "peak_memory_bytes": None, "fairness_comparison": None,
            }
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain previous evidence; choose a new output file")
    files = [Path(__file__), ROOT / "backend/tests/test_rota_auto_fill.py", *sorted((ROOT / "backend/app").rglob("*.py"))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "scope": "Preparatory synthetic coverage-only two-duty oracle; not N26 architecture selection or current template regression proof.", "python": platform.python_version(), "platform": platform.platform(), "ot_enabled": False, "source_sha256": hashes, "runs": []}
    original = settings.ot_calendar_enabled
    settings.ot_calendar_enabled = False
    try:
        for name, days, locked in [("concurrent", [2, 2], False), ("adjacent_rest", [2, 3], False), ("spaced_control", [2, 5], False), ("locked_units", [2, 3], True)]:
            print("Starting " + name, flush=True)
            report["runs"].append(run_case(name, days, locked))
            args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        assert all(hashlib.sha256((ROOT / key).read_bytes()).hexdigest() == value for key, value in hashes.items())
        report["source_unchanged"] = report["complete"] = True
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    finally:
        settings.ot_calendar_enabled = original


if __name__ == "__main__":
    main()
