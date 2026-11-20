"""Independent role-matching oracle for bounded qualified unit/person choices."""

# ruff: noqa: E402
import argparse
from datetime import timedelta
from itertools import combinations, permutations, product
import hashlib
import json
from pathlib import Path
import sys
from time import perf_counter
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from ortools.sat.python import cp_model
from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_capacity import CapacityWindow
from app.services.ot_joint_reservations import add_joint_reservations
from app.services.rota_rules import RotaPhaseOneRules
from tests.test_ot_assignment_guard import DAY, UNIT, duty, need, roster

OTHER = UUID(int=18)


def experiment(name, *, partial=False, fixed=False, locked_open=False, reverse=False):
    people = tuple(person.model_copy(update={"unit_ids": (UNIT if i < 4 else OTHER,), "call_level": "3RD_CALL" if i in (0, 1, 4) else "4TH_CALL", "skills": ("cardiac",) if i in (0, 2) else ()}) for i, person in enumerate(roster(6)))
    if partial:
        first = people[0].model_copy(update={"windowed": True, "windows": (CapacityWindow(unit_id=UNIT, call_level="3RD_CALL", skills=("cardiac",), starts_at=DAY + timedelta(hours=8), ends_at=DAY + timedelta(hours=12)),)})
        people = (first, *people[1:])
    requirements = (
        need(id="cardiac", call_levels=("3RD_CALL", "4TH_CALL"), required_skills=("cardiac",), minimum=1, target=1),
        need(id="general", call_levels=("3RD_CALL", "4TH_CALL"), minimum=1, target=1),
        need(id="other", unit_id=OTHER, call_levels=("3RD_CALL",), minimum=1, target=1),
    )
    context = OtAssignmentGuard(requirements, tuple(reversed(people)) if reverse else people, reviewed_complete=True)
    rules = RotaPhaseOneRules(duty_rules=[])
    fixed_indices = {3} if fixed else set()
    preserved = tuple(duty(people[p]) for p in fixed_indices)
    options = {(d, p): duty(person) for d in range(3) for p, person in enumerate(people) if p not in fixed_indices and not (locked_open and d == 2)}
    units = {p: 0 if person.unit_ids == (UNIT,) else 1 for p, person in enumerate(people)}
    # Independent whole-band identity role lists from the declared fixture, not
    # canonical eligibility/window/interval helpers. A partial12:00 end cannot
    # cover the8:00-16:00 role. Duties9:00-11:00 overlap every role completely.
    eligible_roles = ({2} if partial else {0, 2}, {1, 2, 3} if partial else {0, 1, 2, 3}, {4})
    # Partial person's short window also cannot cover the general whole band.
    eligible_roles = tuple(set(indices) - fixed_indices for indices in eligible_roles)

    def oracle(keys):
        selected = [p for _, p in keys]
        if len(set(selected)) != len(selected):
            return False
        remaining = set(range(6)) - set(selected) - fixed_indices
        return any(all(person in eligible_roles[role] for role, person in enumerate(assignment)) for assignment in permutations(remaining, 3))

    def final_check(keys):
        return context.check((*preserved, *(options[key] for key in keys)), rules)["status"] == "feasible"

    began = perf_counter()
    feasible, checked = [], 0
    for sequence in product(*[[None, *(p for d, p in options if d == index)] for index in range(3)]):
        keys = tuple((d, p) for d, p in enumerate(sequence) if p is not None)
        if len({p for _, p in keys}) != len(keys):
            continue
        actual = final_check(keys)
        expected = oracle(keys)
        assert actual == expected, (name, keys, expected, actual)
        checked += 1
        if expected:
            feasible.append(keys)
    oracle_seconds = perf_counter() - began

    def solve(layout=None):
        started = perf_counter()
        model = cp_model.CpModel()
        items = list(options.items())
        if reverse:
            items.reverse()
        variables = {key: model.new_bool_var(str(key)) for key, _ in items}
        for d in range(3):
            model.add(sum(v for (index, _), v in variables.items() if index == d) <= 1)
        for p in range(6):
            model.add(sum(v for (_, person), v in variables.items() if person == p) <= 1)
        if layout is not None:
            for (d, p), variable in variables.items():
                if units[p] != layout[d]:
                    model.add(variable == 0)
        slots = {str(d): next(row.duty_slot for (index, _), row in options.items() if index == d) for d in range(3) if any(index == d for index, _ in options)}
        choices = {(str(d), str(people[p].id)): variable for (d, p), variable in variables.items()}
        stats = add_joint_reservations(model, context, preserved, slots, choices, rules)
        model.maximize(sum(variables.values()))
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        solver.parameters.max_time_in_seconds = 10
        status = solver.solve(model)
        assert status == cp_model.OPTIMAL, solver.status_name(status)
        keys = tuple(sorted(key for key, variable in variables.items() if solver.value(variable)))
        assert oracle(keys) and final_check(keys)
        return {"keys": keys, "covered": len(keys), "seconds": perf_counter() - started, "ot_model": stats}

    joint, original = solve(), solve((0, 0, 0))
    best, layout, calls, repair_seconds = original, (0, 0, 0), 1, original["seconds"]
    while True:
        candidates = []
        for size in (1, 2):
            for indices in combinations(range(3), size):
                next_layout = tuple(1 - unit if index in indices else unit for index, unit in enumerate(layout))
                result = solve(next_layout)
                calls += 1
                repair_seconds += result["seconds"]
                candidates.append((result, next_layout))
        result, next_layout = max(candidates, key=lambda row: (row[0]["covered"], row[1]))
        if result["covered"] <= best["covered"]:
            break
        best, layout = result, next_layout
    maximum = max(map(len, feasible))
    assert maximum == joint["covered"] == best["covered"] == (2 if fixed or locked_open else 3)
    if partial:
        assert all(p != 2 for _, p in joint["keys"]), "Only whole-band cardiac member must remain for OT"
        assert any(p == 0 for _, p in joint["keys"]), "Short-window member remains eligible for these short duties"
    assert all(p not in fixed_indices for _, p in joint["keys"])
    assert all(d != 2 for d, _ in joint["keys"]) if locked_open else True
    return {"case": name, "partial_skill_window": partial, "preserved_fixed_person_indices": sorted(fixed_indices), "locked_unfilled_logical_duties": [2] if locked_open else [], "input_order_reversed": reverse, "whole_band_role_eligible_indices": [sorted(row) for row in eligible_roles], "independent_canonical_sets_compared": checked, "oracle_seconds": oracle_seconds, "oracle_maximum": maximum, "joint": joint, "original_layout": original, "coordinated_repair": {"covered": best["covered"], "keys": best["keys"], "layout": layout, "solver_calls": calls, "seconds": repair_seconds}, "all_final_checks_clear": True, "scope": "Three coincident short pooled-call duties, three whole-band roles; no ordinary-duty policy validation or DB, fairness/memory not measured."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve historical evidence; choose a new output")
    files = [Path(__file__), ROOT / "backend/tests/test_ot_assignment_guard.py", *sorted((ROOT / "backend/app/services").glob("*.py"))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "source_sha256": hashes, "runs": [], "scope": "Independent role matching and actual reservation model, synthetic component-only architecture comparison; not production scheduler."}
    for name, options in [("pooled_skills", {}), ("partial_skill_window", {"partial": True}), ("partial_reversed", {"partial": True, "reverse": True}), ("fixed_person", {"partial": True, "fixed": True}), ("locked_open", {"partial": True, "locked_open": True})]:
        print("Starting " + name, flush=True)
        report["runs"].append(experiment(name, **options))
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert report["runs"][1]["oracle_maximum"] == report["runs"][2]["oracle_maximum"]
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
    report["complete"] = report["source_unchanged"] = True
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
