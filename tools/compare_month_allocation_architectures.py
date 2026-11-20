"""Synthetic month unit/person comparison, never a production scheduler.

Both methods share immutable canonical candidates, duty incompatibilities, joint
OT constraints, complete final validation and coverage/equality objectives.
The default retains the historical two-tier experiment. --full-objectives reuses
the complete production balanced objective builder and reports per-tier proofs.
"""

# ruff: noqa: E402
import argparse
from collections import Counter, defaultdict
from datetime import date
from itertools import combinations
import hashlib
import json
from pathlib import Path
import platform
import sys
from threading import Event, Thread
from time import perf_counter
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from ortools.sat.python import cp_model
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import CallCluster, DutyAssignment, DutySlot, LeaveRequest, OtCalendar, Person, PersonCallClusterMembership, PersonPosting, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.ot_joint_reservations import add_joint_reservations
from app.services.allocation_objective_model import build_objectives
from app.services.rota_candidates import candidate_context, context_targets, slot_candidates_with_context
from app.services.rota_optimizer import incompatible, validate_plan
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_safety import rule_for_slot
from app.services.rota_setup import monthly_setup
from tests.test_ot_assignment_integration import demand, slot


class InvalidPlan(ValueError):
    """Only canonical final-plan rejection may become a validator-guided cut."""


def working_set():
    """Current whole-process resident working set, including native solver memory."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD),
                    *[(name, ctypes.c_size_t) for name in ("peak", "current", "qpp", "qp", "qnp", "qn", "page", "peak_page")]]
    kernel, psapi = ctypes.WinDLL("kernel32"), ctypes.WinDLL("psapi")
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise OSError("Process working-set observation failed")
    return counters.current


class Samples:
    def __enter__(self):
        self.done, self.values, self.errors = Event(), [], []
        def observe():
            while not self.done.is_set():
                try:
                    self.values.append({"offset_seconds": perf_counter() - self.started, "working_set_bytes": working_set()})
                except OSError as exc:
                    self.errors.append(str(exc))
                self.done.wait(.1)
        self.started = perf_counter()
        self.thread = Thread(target=observe, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.done.set()
        self.thread.join()

    def report(self):
        values = [v["working_set_bytes"] for v in self.values if v["working_set_bytes"] is not None]
        return {"scope": "Sampled whole Python process RSS including native CP-SAT, shared fixture and prior retained allocations; not continuous peaks or isolated method memory.",
                "requested_interval_seconds": .1, "samples": self.values, "errors": self.errors,
                "maximum_observed_bytes": max(values, default=None)}


def fixture(db, *, preserved=False, plateau=False):
    units = [Unit(code=code, name=code, minimum_free_people=0) for code in ("UNIT_IV", "UNIT_V")]
    db.add_all(units)
    db.flush()
    people = [Person(canonical_name=f"Synthetic month member {i}", call_level="3RD_CALL", active_status="active") for i in range(8)]
    db.add_all(people)
    db.flush()
    for i, person in enumerate(people):
        db.add(PersonPosting(person=person, unit=units[i // 4], posting_type="3RD_CALL",
            starts_on=date(2026, 10, 1), ends_on=date(2026, 11, 15) if i in (1, 5) else None, source="unit_board"))
        if i in (1, 5):
            db.add(PersonPosting(person=person, unit=units[1 - i // 4], posting_type="3RD_CALL",
                starts_on=date(2026, 11, 16), source="unit_board"))
    db.add(LeaveRequest(person=people[0], starts_on=date(2026, 11, 7), ends_on=date(2026, 11, 9),
        status="approved", leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY"))
    get_phase_one_rules(db)
    db.commit()
    for index, unit in enumerate(units):
        demand(db, unit, minimum=2)
        if index == 0:
            calendar = db.query(OtCalendar).filter_by(unit_id=unit.id).one()
            value = dict(calendar.configuration)
            value["weekly"] = [{**row, "bands": [{**band, "minimum": 4, "target": 4} for band in row["bands"]]}
                               if row["weekday"] == "THU" else row for row in value["weekly"]]
            value = canonical(CalendarConfiguration.model_validate(value))
            calendar.configuration, calendar.revision = value, revision(value)
            db.commit()
    alternatives = {(day, unit_index): slot(db, unit, date(2026, 11, day))
                    for day in range(1, 31) for unit_index, unit in enumerate(units)}
    if plateau:
        group = CallCluster(key="synthetic_month_duty", name="Synthetic dated duty pool", call_level="3RD_CALL", active=True)
        db.add(group)
        db.flush()
        db.add_all(PersonCallClusterMembership(person=person, cluster=group,
            effective_from=date(2026, 10, 1) if i in (0, 4) else date(2026, 11, 3))
            for i, person in enumerate(people))
        db.commit()
        _, rules = get_phase_one_rules(db)
        rule = next(rule for rule in rules.duty_rules if rule.key == "MAIN_3RD_24HR")
        rule.allowed_cluster_keys = [group.key]
        save_phase_one_rules(db, rules)
        calendar = db.query(OtCalendar).filter_by(unit_id=units[0].id).one()
        value = dict(calendar.configuration)
        value["exceptions"] = [*value.get("exceptions", []), {"id": str(uuid4()), "unit_id": str(units[0].id),
            "area_key": "main", "day": "2026-11-01", "closed": False,
            "bands": [{**value["weekly"][0]["bands"][0], "minimum": 4, "target": 4}]}]
        value = canonical(CalendarConfiguration.model_validate(value))
        calendar.configuration, calendar.revision = value, revision(value)
        db.commit()
    if preserved:
        previous = slot(db, units[0], date(2026, 10, 31))
        previous.rota_period = monthly_setup(db, "2026-10")[0]
        future = slot(db, units[1], date(2026, 12, 1))
        future.rota_period = monthly_setup(db, "2026-12")[0]
        db.add_all([DutyAssignment(person=people[0], duty_slot=previous, status="assigned"),
                    DutyAssignment(person=people[2], duty_slot=alternatives[15, 0], status="assigned"),
                    DutyAssignment(person=people[4], duty_slot=future, status="assigned")])
        db.commit()
    return units, people, alternatives


class Experiment:
    def __init__(self, db, people, alternatives, *, locked_open, full_objectives=False):
        self.db, self.people, self.alternatives = db, people, alternatives
        self.full_objectives = full_objectives
        self.context = candidate_context(db, "2026-11")
        assert self.context.ot_guard.reviewed_complete and not self.context.ot_guard.unresolved
        assert all(v is None for v in self.context.rules.duty_count_limits.model_dump().values()), "Fixture requires unlimited monthly hard counts"
        assert all(rule_for_slot(row, self.context.rules).is_mandatory for row in alternatives.values())
        context_targets(db, self.context)
        assert set(self.context.fairness_member_levels.values()) == {"3RD_CALL"}, "Squared loads require the common fixture call target"
        # Physical alternative rows are not additional required duties. The
        # fixture's eight monthly members share thirty logical requirements.
        self.targets = {"3RD_CALL": len({day for day, _ in alternatives}) / len(people)}
        self.context.fairness_targets = dict(self.targets)
        self.month_fixed = tuple(a for rows in self.context.assignments_by_person.values() for a in rows)
        self.fixed_days = {a.duty_slot.duty_date.day for a in self.month_fixed}
        assert len(self.fixed_days) == len(self.month_fixed), "Fixture has at most one preserved duty per logical day"
        self.saved_signature = self.signature()
        self.fixed_assignments = tuple(a for rows in self.context.nearby_assignments.values() for a in rows)
        self.baseline_ot = self.context.ot_guard.check(self.fixed_assignments, self.context.rules)
        assert self.baseline_ot["status"] == "feasible", "Synthetic saved baseline must be globally OT-feasible"
        unit_indices = {row.unit_id: unit for (_, unit), row in alternatives.items()}
        self.fixed_units = Counter(unit_indices[a.duty_slot.unit_id] for a in self.month_fixed)
        self.options = {}
        self.score_candidates = {}
        for (day, unit), duty_slot in alternatives.items():
            if day in self.fixed_days:
                continue
            if locked_open and day == 19 and unit != 0:
                continue
            row = slot_candidates_with_context(db, slot=duty_slot, context=self.context)
            self.score_candidates[str(duty_slot.id)] = {}
            for person in row["candidates"]:
                if person["validation_status"] == "clear" and person["candidate_status"] == "eligible" and not person["requires_override"]:
                    self.options[day, unit, person["person_id"]] = duty_slot
                    self.score_candidates[str(duty_slot.id)][person["person_id"]] = person
        self.locked = {19} if locked_open else set()
        self.upper_coverage = len({day for day, _, _ in self.options} | self.fixed_days)

    def signature(self):
        # Column queries see persisted values, independently of ORM identity cache.
        rows = self.db.query(DutyAssignment.id, DutyAssignment.person_id, DutyAssignment.status,
            DutySlot.id, DutySlot.unit_id, DutySlot.duty_date, DutySlot.starts_at, DutySlot.ends_at,
            DutySlot.is_24hr, DutySlot.duty_type).join(DutyAssignment.duty_slot).all()
        return sorted(tuple(str(value) for value in row) for row in rows)

    def check(self, keys):
        assert len({day for day, _, _ in keys}) == len(keys), "Duplicate logical duty"
        assert all(day not in self.locked or unit == 0 for day, unit, _ in keys)
        assert all(day not in self.fixed_days for day, _, _ in keys), "Preserved logical duty cannot be replaced"
        assert self.signature() == self.saved_signature, "Preserved commitments changed"
        choices = {str(self.options[key].id): key[2] for key in keys}
        slots = {str(self.options[key].id): self.options[key] for key in keys}
        if validate_plan(self.db, self.context, slots, choices):
            raise InvalidPlan("Complete canonical final check failed")
        assert self.db.query(DutyAssignment).count() == len(self.saved_signature)

    def solve(self, deadline, layout=None):
        began = perf_counter()
        model = cp_model.CpModel()
        variables = {key: model.new_bool_var(str(key)) for key in self.options}
        # Keep one common opportunity universe for every layout. Removing the
        # forbidden rows would change workload denominators between methods.
        if layout is not None:
            for key, variable in variables.items():
                if layout[key[0]-1] != key[1]:
                    model.add(variable == 0)
        for day in range(1, 31):
            model.add(sum(v for (d, _, _), v in variables.items() if day == d) <= 1)
        by_person = defaultdict(list)
        for key, variable in variables.items():
            by_person[key[2]].append((key, variable))
        for items in by_person.values():
            for i, (key, variable) in enumerate(items):
                for other, second in items[i+1:]:
                    if incompatible(self.options[key], self.options[other], self.context.rules):
                        model.add(variable + second <= 1)
        slots = {str(row.id): row for row in self.options.values()}
        choices = {(str(self.options[key].id), person): variable for key, variable in variables.items() for person in (key[2],)}
        stats = add_joint_reservations(model, self.context.ot_guard, self.fixed_assignments, slots, choices, self.context.rules)
        terms = None
        if self.full_objectives:
            terms = build_objectives(model, choices, self.score_candidates, slots, self.context,
                targets=self.targets, mandatory=sum(variables.values()), coverage=sum(variables.values()),
                mode="balanced", originals={}, preferences={}, weights={"burden": 1, "history": 1, "spacing": 1},
                holiday_dates={"2026-11-14", "2026-11-26"}, incompatible=incompatible)
            tiers = terms.tiers
        else:
            squares = []
            for person in self.people:
                load = model.new_int_var(0, 30, f"load{person.id}")
                square = model.new_int_var(0, 900, f"square{person.id}")
                baseline = len(self.context.assignments_by_person.get(person.id, ()))
                model.add(load == baseline + sum(v for _, v in by_person[str(person.id)]))
                model.add_element(load, [n*n for n in range(31)], square)
                squares.append(square)
            tiers = [("coverage", -len(self.fixed_days)-sum(variables.values())), ("call_level_squared_load", sum(squares))]
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        keys, receipts, cuts = (), [], 0
        for index, (name, expression) in enumerate(tiers):
            while perf_counter() < deadline:
                solver.parameters.max_time_in_seconds = max(.001, (deadline-perf_counter()) / (len(tiers)-index))
                model.minimize(expression)
                status = solver.solve(model)
                if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    break
                trial = tuple(key for key, variable in variables.items() if solver.value(variable))
                try:
                    self.check(trial)
                except InvalidPlan:
                    if not trial:
                        raise
                    model.add(sum(variables[key] for key in trial) <= len(trial)-1)
                    cuts += 1
                    continue
                keys = trial
                value = solver.value(expression) if not isinstance(expression, int) else expression
                receipts.append({"tier": name, "value": value, "proven": status == cp_model.OPTIMAL})
                model.add(expression == value)
                break
            if len(receipts) <= index:
                break
        self.check(keys)
        loads = Counter(str(a.person_id) for a in self.month_fixed)
        loads.update(key[2] for key in keys)
        unit_counts = self.fixed_units + Counter(key[1] for key in keys)
        square_load = sum(loads[str(p.id)]**2 for p in self.people)
        quality = terms.quality({str(self.options[key].id): key[2] for key in keys}) if terms else [-len(keys)-len(self.fixed_days), square_load]
        return {"keys": keys, "covered": len(keys)+len(self.fixed_days), "new_choices": len(keys),
                "fixed_logical_days": sorted(self.fixed_days), "square_load": square_load,
                "quality": quality, "objective_tiers": [name for name, _ in tiers],
                "unit_contributions": {str(unit): count for unit, count in unit_counts.items()},
                "member_loads": [loads[str(p.id)] for p in self.people], "proofs": receipts,
                "seconds": perf_counter()-began, "cuts": cuts, "ot_model": stats}

    def bounds_reached(self, result):
        if self.full_objectives:
            # Coverage/equality certificates alone say nothing about later tiers.
            return False
        n, remainder = divmod(result["covered"], len(self.people))
        return result["covered"] == self.upper_coverage and result["square_load"] == remainder*(n+1)**2+(len(self.people)-remainder)*n*n

    def moves(self, layout, keys, *, coordinated=False):
        covered = {key[0] for key in keys} | self.fixed_days
        unit_counts = self.fixed_units + Counter(key[1] for key in keys)
        order = sorted(set(range(1, 31))-self.locked-self.fixed_days,
            key=lambda day: (day in covered, -unit_counts[layout[day-1]], day))
        moves = []
        if coordinated:
            # Reopen a neighboring unit choice early when an unfilled duty's
            # alternative competes for the same person's duty/rest window.
            # This uses canonical candidate identities and incompatibility,
            # not dates or expected answers hardcoded to the plateau fixture.
            for day in order:
                if day in covered:
                    continue
                alternatives = [key for key in self.options if key[0] == day and key[1] != layout[day-1]]
                for other in order:
                    if other == day:
                        continue
                    current = [key for key in self.options if key[0] == other and key[1] == layout[other-1]]
                    if any(first[2] == second[2] and incompatible(self.options[first], self.options[second], self.context.rules)
                           for first in alternatives for second in current):
                        moves.append((tuple(sorted((day, other))), "shared_candidate_rest"))
        moves.extend(((day,), "single_coordinate") for day in order)
        if coordinated:
            moves.extend((tuple(sorted(days)), "remaining_pair") for days in combinations(order, 2))
        seen = set()
        result = []
        for days, reason in moves:
            if days not in seen:
                seen.add(days)
                result.append((days, reason))
        return result

    def compare(self, seconds, *, coordinated=False):
        reports = {}
        for method in (("joint", "repair", "repair_pairs") if coordinated else ("joint", "repair")):
            with Samples() as samples:
                began = perf_counter()
                deadline = began + seconds
                calls, accepted = 1, 0
                if method == "joint":
                    best = self.solve(deadline)
                    stop = "single_joint_model"
                else:
                    layout = tuple((day-1) % 2 for day in range(1, 31))
                    best = self.solve(min(deadline, perf_counter()+5), layout)
                    initial = dict(best)
                    trace = []
                    stop = "budget_exhausted"
                    while perf_counter() < deadline:
                        if self.bounds_reached(best):
                            stop = "coverage_and_equality_bounds_reached"
                            break
                        improved = False
                        for days, reason in self.moves(layout, best["keys"], coordinated=method == "repair_pairs"):
                            if perf_counter() >= deadline:
                                break
                            neighbor = tuple(1-unit if index+1 in days else unit for index, unit in enumerate(layout))
                            trial = self.solve(min(deadline, perf_counter()+5), neighbor)
                            calls += 1
                            trace.append({"changed_days": days, "priority_reason": reason,
                                          "covered": trial["covered"], "square_load": trial["square_load"],
                                          "quality": trial["quality"], "proofs": trial["proofs"], "seconds": trial["seconds"]})
                            if tuple(trial["quality"]) < tuple(best["quality"]):
                                best, layout = trial, neighbor
                                accepted += 1
                                improved = True
                                break
                        if not improved:
                            stop = "all_configured_neighbors_evaluated" if perf_counter() < deadline else "budget_exhausted"
                            break
                    best["layout"] = layout
                    best["initial_prescribed_layout"] = initial
                    best["neighbor_observations"] = trace
                best.update({"wall_seconds": perf_counter()-began, "budget_seconds": seconds,
                             "budget_overrun_seconds": max(0, perf_counter()-deadline), "solver_calls": calls,
                             "accepted_layout_changes": accepted, "termination": stop})
                best["preserved_assignment_count"] = len(self.saved_signature)
                best["preserved_signatures_unchanged"] = self.signature() == self.saved_signature
                best["baseline_ot_status"] = self.baseline_ot["status"]
            best["memory"] = samples.report()
            best["upper_coverage"] = self.upper_coverage
            best["coverage_optimal_by_upper_bound"] = best["covered"] == self.upper_coverage
            n, remainder = divmod(best["covered"], len(self.people))
            lower = remainder*(n+1)**2+(len(self.people)-remainder)*n*n
            best["arithmetic_square_load_lower_bound_at_coverage"] = lower
            best["equality_optimal_by_lower_bound"] = best["square_load"] == lower
            reports[method] = best
        return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--locked-open", action="store_true")
    parser.add_argument("--preserved", action="store_true")
    parser.add_argument("--plateau", action="store_true")
    parser.add_argument("--full-objectives", action="store_true")
    args = parser.parse_args()
    if args.output.exists() or not 5 <= args.seconds <= 120:
        parser.error("Use a fresh evidence path and a 5–120 second method budget")
    files = [Path(__file__), ROOT/'backend/tests/test_ot_assignment_integration.py', *sorted((ROOT/'backend/app').rglob('*.py'))]
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report = {"complete": False, "scope": "Isolated30-day logical-duty unit/person experiment with canonical safety; objective_scope specifies modeled tiers. Not production architecture activation/selection.",
              "source_sha256": hashes, "python": platform.python_version(), "platform": platform.platform(),
              "locked_open": args.locked_open, "preserved": args.preserved, "plateau": args.plateau,
              "full_objectives": args.full_objectives}
    report["objective_scope"] = "All30 logical duties mandatory; coverage then common-call equality. At fixed coverage common target terms cancel. Unit contributions are descriptive, not a new objective. Weekend/night/history/preferences tiers not compared."
    report["budget_scope"] = "Same per-method monotonic wall allowance including model construction, all solver calls and canonical validation; common fixture/candidate preprocessing reported separately. Blocking stages may overrun; report actual overrun, not a hard-cancel guarantee."
    report["template_scope"] = "Initial alternating unit layout is prescribed for this experiment, not generated by the current production template."
    if args.full_objectives:
        report["objective_scope"] = "Shared production balanced tiers: required coverage, coverage, call-level equality, weekend, night, holiday, workload, spacing/history, preferences. Logical target30/8; fixed opportunity universe for every layout. Two synthetic holiday dates; no preference costs or repair replacement requests in this fixture. Per-tier proof receipts remain authoritative."
    engine = create_engine("sqlite+pysqlite:///:memory:")
    old = settings.ot_calendar_enabled
    settings.ot_calendar_enabled = True
    try:
        Base.metadata.create_all(engine)
        with Session(engine, expire_on_commit=False) as db:
            began = perf_counter()
            _, people, alternatives = fixture(db, preserved=args.preserved, plateau=args.plateau)
            experiment = Experiment(db, people, alternatives, locked_open=args.locked_open, full_objectives=args.full_objectives)
            report["common_setup_seconds"] = perf_counter()-began
            report["logical_required_duties"] = 30
            report["candidate_edges"] = len(experiment.options)
            print("Comparing joint and repair", flush=True)
            report["methods"] = experiment.compare(args.seconds, coordinated=args.plateau)
            assert db.query(DutyAssignment).count() == len(experiment.saved_signature)
            report["assignment_writes"] = 0
        assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in hashes.items())
        report["source_unchanged"] = report["complete"] = True
        args.output.write_text(json.dumps(report, indent=2)+'\n', encoding="utf-8")
    finally:
        settings.ot_calendar_enabled = old
        engine.dispose()


if __name__ == "__main__":
    main()
