"""Bounded coverage architecture comparison using actual joint OT reservations.

All duties and one homogeneous OT band per unit coincide. That restriction gives
an independent counting oracle; it is not a month-wide policy implementation.
No DB, application writes, fairness priorities, or production scheduler changes.
"""

# ruff: noqa: E402
import argparse
from itertools import combinations, product
import hashlib
import json
from pathlib import Path
import platform
import sys
from time import perf_counter
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from ortools.sat.python import cp_model
from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_joint_reservations import add_joint_reservations
from app.services.rota_rules import RotaPhaseOneRules
from tests.test_ot_assignment_guard import UNIT, duty, need, roster

OTHER = UUID(int=18)


def fixture():
    people = tuple(person.model_copy(update={"unit_ids": (UNIT if i < 4 else OTHER,)}) for i, person in enumerate(roster(6)))
    context = OtAssignmentGuard((need(minimum=2, target=2), need(id="other_ot", unit_id=OTHER, minimum=1, target=1)), people, reviewed_complete=True)
    return context, RotaPhaseOneRules(duty_rules=[])


def run_case(name, fixed_count=0, locked=False):
    context, rules = fixture()
    fixed = tuple(duty(person) for person in context.people[:fixed_count])
    people = context.people[fixed_count:]
    options = {(d, p): duty(person) for d in range(3) for p, person in enumerate(people)}
    units = {p: 0 if person.unit_ids == (UNIT,) else 1 for p, person in enumerate(people)}
    capacities = (4 - fixed_count - 2, 2 - 1)

    def arithmetic(keys):
        selected = [p for _, p in keys]
        return len(selected) == len(set(selected)) and all(sum(units[p] == u for p in selected) <= capacities[u] for u in range(2))

    def canonical(keys):
        rows = tuple(options[key] for key in keys)
        return context.check((*fixed, *rows), rules)["status"] == "feasible"

    began = perf_counter()
    feasible = []
    enumerated = checked = 0
    for sequence in product([None, *range(len(people))], repeat=3):
        keys = tuple((d, p) for d, p in enumerate(sequence) if p is not None)
        enumerated += 1
        # Same person cannot do overlapping duties; caller owns duty conflicts.
        if len({p for _, p in keys}) != len(keys):
            continue
        expected = arithmetic(keys)
        actual = canonical(keys)
        checked += 1
        assert expected == actual, (name, keys, expected, actual)
        if expected:
            feasible.append(keys)
    oracle_seconds = perf_counter() - began

    def solve(layout=None, pairwise_only=False):
        started = perf_counter()
        model = cp_model.CpModel()
        variables = {key: model.new_bool_var(str(key)) for key in options}
        for d in range(3):
            model.add(sum(v for (day, _), v in variables.items() if day == d) <= 1)
        for p in range(len(people)):
            model.add(sum(v for (_, person), v in variables.items() if person == p) <= 1)
        if layout is not None:
            for (d, p), variable in variables.items():
                if units[p] != layout[d]:
                    model.add(variable == 0)
        if pairwise_only:
            for key in options:
                if not arithmetic((key,)):
                    model.add(variables[key] == 0)
            for first, second in combinations(options, 2):
                if first[0] != second[0] and not arithmetic((first, second)):
                    model.add(variables[first] + variables[second] <= 1)
            stats = None
        else:
            slots = {str(d): options[d, 0].duty_slot for d in range(3)}
            choices = {(str(d), str(people[p].id)): variable for (d, p), variable in variables.items()}
            stats = add_joint_reservations(model, context, fixed, slots, choices, rules)
        model.maximize(sum(variables.values()))
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        solver.parameters.max_time_in_seconds = 10
        status = solver.solve(model)
        assert status == cp_model.OPTIMAL, solver.status_name(status)
        keys = tuple(key for key, variable in variables.items() if solver.value(variable))
        return {"keys": keys, "covered": len(keys), "seconds": perf_counter() - started, "ot_model": stats}

    original_layout = (0, 0, 0)
    fixed_layout = solve(original_layout)
    joint = solve(original_layout if locked else None)
    best, layout, repair_calls = fixed_layout, original_layout, 1
    repair_seconds = fixed_layout["seconds"]
    while not locked:
        neighbors = []
        # Single-coordinate and two-coordinate unit moves; all use same model.
        for count in (1, 2):
            for indices in combinations(range(3), count):
                alternative = tuple(1 - u if d in indices else u for d, u in enumerate(layout))
                result = solve(alternative)
                repair_calls += 1
                repair_seconds += result["seconds"]
                neighbors.append((result, alternative))
        candidate, candidate_layout = max(neighbors, key=lambda row: (row[0]["covered"], row[1]))
        if candidate["covered"] <= best["covered"]:
            break
        best, layout = candidate, candidate_layout
    allowed = [keys for keys in feasible if not locked or all(units[p] == 0 for _, p in keys)]
    maximum = max(map(len, allowed))
    assert joint["covered"] == best["covered"] == maximum
    assert all(canonical(row["keys"]) and arithmetic(row["keys"]) for row in (fixed_layout, joint, best))
    pairwise = solve(original_layout, pairwise_only=True)
    pairwise_safe = canonical(pairwise["keys"])
    if fixed_count == 0:
        assert pairwise["covered"] == 3 and not pairwise_safe
        witness = tuple((d, d) for d in range(3))
        assert all(canonical(pair) for pair in combinations(witness, 2)) and not canonical(witness)
    assert not any(person.blocked for person in context.people)
    return {
        "case": name, "logical_duties": 3, "people": 6, "fixed_duties": fixed_count,
        "locked_unit_choices": locked, "remaining_duty_capacity_by_unit": capacities,
        "assignments_enumerated_including_duplicate_person_rejections": enumerated,
        "canonical_checks_with_distinct_people": checked, "independent_count_oracle_seconds": oracle_seconds,
        "oracle_maximum": maximum,
        "fixed_layout": fixed_layout, "joint": joint,
        "coordinated_repair": {"covered": best["covered"], "layout": layout, "solver_calls": repair_calls, "seconds": repair_seconds, "keys": best["keys"]},
        "pairwise_only": {**pairwise, "final_ot_safe": pairwise_safe, "accepted_for_use": False},
        "all_accepted_final_checks_clear": True, "fixed_and_people_unchanged": True,
        "fairness_comparison": None, "peak_memory_bytes": None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Preserve previous evidence; choose a new path")
    files = [Path(__file__), ROOT / "backend/tests/test_ot_assignment_guard.py", *sorted((ROOT / "backend/app/services").glob("*.py"))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "source_sha256": hashes, "python": platform.python_version(), "platform": platform.platform(), "scope": "Three coincident two-hour duties; homogeneous OT per unit. Pure synthetic reservation-component comparison, no DB or production architecture activation.", "runs": []}
    for name, fixed, locked in [("flexible", 0, False), ("locked_units", 0, True), ("fixed_duty", 1, False)]:
        print("Starting " + name, flush=True)
        report["runs"].append(run_case(name, fixed, locked))
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in hashes.items())
    report["source_unchanged"] = report["complete"] = True
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
