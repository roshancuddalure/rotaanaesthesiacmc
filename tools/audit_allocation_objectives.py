"""Bounded exact objective examples on disposable canonical scheduling fixtures."""

# ruff: noqa: E402
import argparse
from collections import Counter
from datetime import date
from fractions import Fraction
import hashlib
from itertools import product
import json
from pathlib import Path
import sys
from time import perf_counter
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person
from app.services.balance_duties import shares
from app.services.fairness_targets import target_by_level, split_pool_demand
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from tests.test_rota_auto_fill import create_slot, seed_auto_fill_context


def oracle(days, names, partial, unavailable_until, fixed):
    """Exhaust every identity choice. Fixture duties are >=3 dates apart,
    so overlap/24h+24h-rest conflicts cannot occur; leave is the only exclusion.
    This intentionally does not call optimizer objectives or validators.
    """
    total = len(days)
    available = {
        name: 31 - (unavailable_until if name == partial else 0) for name in names
    }
    eligible = [name for name in names if available[name] > 0]
    uniform = {
        name: Fraction(total, len(eligible)) if name in eligible else Fraction(0)
        for name in names
    }
    prorata = {
        name: Fraction(total * available[name], sum(available.values()))
        for name in names
    }
    best_uniform = best_prorata = None
    uniform_counts = prorata_counts = set()
    explored = 0
    for suffix in product(names, repeat=total - len(fixed)):
        sequence = tuple(fixed) + suffix
        if any(
            name == partial and day <= unavailable_until
            for day, name in zip(days, sequence)
        ):
            continue
        explored += 1
        counts = Counter(sequence)
        actual = tuple(counts[name] for name in names)
        uniform_cost = sum((counts[name] - uniform[name]) ** 2 for name in names)
        prorata_cost = sum((counts[name] - prorata[name]) ** 2 for name in names)
        if best_uniform is None or uniform_cost < best_uniform:
            best_uniform, uniform_counts = uniform_cost, {actual}
        elif uniform_cost == best_uniform:
            uniform_counts.add(actual)
        if best_prorata is None or prorata_cost < best_prorata:
            best_prorata, prorata_counts = prorata_cost, {actual}
        elif prorata_cost == best_prorata:
            prorata_counts.add(actual)
    return {
        "names": names,
        "available_days": available,
        "uniform_targets": {k: str(v) for k, v in uniform.items()},
        "prorata_targets": {k: str(v) for k, v in prorata.items()},
        "uniform_best_cost": str(best_uniform),
        "prorata_best_cost": str(best_prorata),
        "uniform_optimal_counts": sorted(uniform_counts),
        "prorata_optimal_counts": sorted(prorata_counts),
        "feasible_allocations_enumerated": explored,
    }


def example(case):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            first, _ = seed_auto_fill_context(db)
            unit = first.unit
            db.query(LeaveRequest).delete()
            db.query(DutySlot).delete()
            days = [2, 5, 8, 11, 14, 17, 24, 28]
            slots = [create_slot(db, unit, date(2026, 5, day)) for day in days]
            people = list(db.scalars(select(Person).order_by(Person.canonical_name)))
            partial = next(
                row for row in people if row.canonical_name == "Blocked Member"
            )
            unavailable_until = (
                23 if case == "partial" else 31 if case == "zero_capacity" else 0
            )
            if unavailable_until:
                db.add(
                    LeaveRequest(
                        person=partial,
                        starts_on=date(2026, 5, 1),
                        ends_on=date(2026, 5, unavailable_until),
                        leave_type="ANNUAL_LEAVE",
                        leave_slot="FULL_DAY",
                        status="approved",
                    )
                )
            fixed_person = next(
                row for row in people if row.canonical_name == "Safe Member"
            )
            fixed_slots = slots[:2] if case == "fixed" else []
            for slot in fixed_slots:
                db.add(
                    DutyAssignment(
                        person=fixed_person, duty_slot=slot, status="assigned"
                    )
                )
            db.commit()
            names = [row.canonical_name for row in people]
            exact = oracle(
                days,
                names,
                partial.canonical_name,
                unavailable_until,
                [fixed_person.canonical_name] * len(fixed_slots),
            )
            context = candidate_context(db, "2026-05")
            selected = {str(slot.id): slot for slot in slots if slot not in fixed_slots}
            start = perf_counter()
            solved = solve_month(
                db, context, selected, seconds=30, holiday_dates={"2026-05-01"}
            )
            assert len(solved["choices"]) == len(selected), solved
            failures = validate_plan(db, context, selected, solved["choices"])
            assert failures == [], failures
            counts = Counter(
                context.people[UUID(pid)].canonical_name
                for pid in solved["choices"].values()
            )
            counts[fixed_person.canonical_name] += len(fixed_slots)
            actual = tuple(counts[name] for name in names)
            assert actual in exact["uniform_optimal_counts"], (case, actual, exact)
            assert db.query(DutyAssignment).count() == len(fixed_slots)
            # Balance shares deliberately use saved assignments, not hypothetical
            # or unfilled demand. Save only in this disposable measurement fixture.
            for sid, pid in solved["choices"].items():
                db.add(
                    DutyAssignment(
                        duty_slot=selected[sid], person_id=UUID(pid), status="assigned"
                    )
                )
            db.commit()
            balanced = shares(db, "2026-05")
            level = next(row for row in balanced if row["call_level"] == "1ST_CALL")
            expected_shares = exact["prorata_targets"]
            for member in level["members_detail"]:
                assert (
                    abs(
                        member["share"]
                        - float(Fraction(expected_shares[member["name"]]))
                    )
                    < 0.011
                )
            return {
                "case": case,
                "days": days,
                "fixed_duties": len(fixed_slots),
                "oracle": exact,
                "optimizer_counts": dict(zip(names, actual)),
                "optimizer_matches_uniform_oracle": True,
                "optimizer_matches_prorata_oracle": actual
                in exact["prorata_optimal_counts"],
                "final_validation_failures": len(failures),
                "optimizer_status": solved["status"],
                "equality_objective": next(
                    row
                    for row in solved["objectives"]
                    if row["name"] == "call_level_equality"
                ),
                "level_targets": target_by_level(db, "2026-05"),
                "balance_shares": [
                    {
                        key: row[key]
                        for key in ("name", "avail_days", "duties", "share", "goal")
                    }
                    for row in level["members_detail"]
                ],
                "measured_seconds": perf_counter() - start,
            }
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Retain historical evidence; choose a new output path")
    files = [Path(__file__), *sorted((ROOT / "backend/app/services").glob("*.py"))]
    hashes = {
        str(p.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(
            p.read_bytes()
        ).hexdigest()
        for p in files
    }
    report = {
        "scope": "Four synthetic8duty4personexamples and exhaustive arithmetic; not departmental pilot or policy amendment.",
        "source_sha256": hashes,
        "runs": [],
        "complete": False,
    }
    flag = settings.ot_calendar_enabled
    settings.ot_calendar_enabled = False
    try:
        for case in ("equal", "partial", "fixed", "zero_capacity"):
            print("Starting " + case, flush=True)
            report["runs"].append(example(case))
            args.output.write_text(
                json.dumps(report, indent=2) + "\n", encoding="utf-8"
            )
        pool = split_pool_demand(
            {"3RD_CALL", "4TH_CALL"}, {"3RD_CALL": 30, "4TH_CALL": 10}
        )
        assert pool == {"3RD_CALL": 0.75, "4TH_CALL": 0.25}
        report["pool_demand_example"] = pool
        report["rounding_example"] = {
            "available_days": [31, 31, 31, 15],
            "shares": [str(Fraction(8 * day, 108)) for day in [31, 31, 31, 15]],
            "independently_rounded_goals": [
                round(Fraction(8 * day, 108)) for day in [31, 31, 31, 15]
            ],
            "sum_rounded_goals": sum(
                round(Fraction(8 * day, 108)) for day in [31, 31, 31, 15]
            ),
            "required_duties": 8,
            "basis": "Rounding goals independently need not preserve total demand; higher coverage tier and allowed gap remain authoritative.",
        }
        assert all(
            hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == value
            for name, value in hashes.items()
        )
        report["source_unchanged"] = report["complete"] = True
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    finally:
        settings.ot_calendar_enabled = flag


if __name__ == "__main__":
    main()
