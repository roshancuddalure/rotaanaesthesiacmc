# ruff: noqa: E402
"""Synthetic full-month benchmark. Always creates disposable SQLite databases; no live DB access."""

import argparse
import json
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, Person, PersonPosting, Unit
from app.services.rota_auto_fill import AutoFillOptions, run_safe_auto_fill
from app.services.rota_setup import monthly_setup


def seed(db, members, slots):
    period, _ = monthly_setup(db, "2026-05")
    units = [
        Unit(code=f"BENCH_{i}", name=f"Benchmark Unit {i}", campus="MAIN")
        for i in range(2)
    ]
    db.add_all(units)
    db.flush()
    for i in range(members):
        person = Person(
            canonical_name=f"Benchmark Member {i:04}",
            call_level="1ST_CALL",
            active_status="active",
        )
        db.add(person)
        db.flush()
        db.add(
            PersonPosting(
                person=person,
                unit=units[i % 2],
                posting_type="1ST_CALL",
                starts_on=date(2026, 5, 1),
                source="unit_board",
            )
        )
    for i in range(slots):
        day = date(2026, 5, 1) + timedelta(days=(i // 2) % 31)
        start = datetime.combine(day, time(8))
        db.add(
            DutySlot(
                rota_period=period,
                unit=units[i % 2],
                duty_date=day,
                duty_type="MAIN_1ST_24HR",
                call_level="1ST_CALL",
                slot_label=f"BENCH:{i}",
                starts_at=start,
                ends_at=start + timedelta(hours=24),
                is_24hr=True,
                source="phase4_template",
            )
        )
    db.commit()


def measure(members, slots, cached):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed(db, members, slots)
        queries = []
        sql_started = []
        sql_ms = []

        def before(*_):
            queries.append(1)
            sql_started.append(perf_counter())

        def after(*_):
            sql_ms.append((perf_counter() - sql_started.pop()) * 1000)

        event.listen(engine, "before_cursor_execute", before)
        event.listen(engine, "after_cursor_execute", after)
        began = perf_counter()
        result = run_safe_auto_fill(
            db, "2026-05", AutoFillOptions(use_cached_context=cached)
        )
        elapsed = (perf_counter() - began) * 1000
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)
        choices = sorted(
            (a.duty_slot.slot_label, a.person.canonical_name)
            for a in db.scalars(select(DutyAssignment))
        )
        report = {
            "elapsed_ms": round(elapsed, 2),
            "sql_queries": len(queries),
            "sql_ms": round(sum(sql_ms), 2),
            "assigned": result["assigned_slots"],
            "unresolved": result["skipped_slots"],
            "choices": choices,
            "stages": result["summary"].get("performance", {}),
        }
    engine.dispose()
    return report


def template_measure(members):
    from app.services.rota_template import (
        generate_empty_template,
        TemplateGenerationOptions,
    )
    from app.services.rota_setup import update_scope_units

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed(db, members, 0)
        _, scope = monthly_setup(db, "2026-05")
        ids = list(db.scalars(select(Unit.id)))
        update_scope_units(db, scope, ids, [], True, True, "Synthetic benchmark")
        queries = []

        def count(*_):
            queries.append(1)

        event.listen(engine, "before_cursor_execute", count)
        began = perf_counter()
        generate_empty_template(
            db, "2026-05", TemplateGenerationOptions(duty_keys=["MAIN_1ST_24HR"])
        )
        elapsed = (perf_counter() - began) * 1000
        event.remove(engine, "before_cursor_execute", count)
        report = {
            "elapsed_ms": round(elapsed, 2),
            "sql_queries": len(queries),
            "generated_slots": db.query(DutySlot).count(),
            "month": "2026-05",
            "duty_keys": ["MAIN_1ST_24HR"],
        }
    engine.dispose()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--members", type=int, default=96)
    parser.add_argument("--slots", type=int, default=62)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 4 <= args.members <= 1000 or not 1 <= args.slots <= 500:
        parser.error("members must be 4–1000 and slots 1–500")
    old = measure(args.members, args.slots, False)
    new = measure(args.members, args.slots, True)
    same = old.pop("choices") == new.pop("choices")
    report = {
        "fixture": {
            "members": args.members,
            "slots": args.slots,
            "month": "2026-05",
            "database": "disposable SQLite",
            "baseline": "uncached validation/context, atomic writes in both paths",
        },
        "template_generation": template_measure(args.members),
        "reference": old,
        "optimized": new,
        "identical_assignments": same,
        "speedup": round(old["elapsed_ms"] / max(1, new["elapsed_ms"]), 2),
        "query_reduction_percent": round(
            100 * (1 - new["sql_queries"] / old["sql_queries"]), 2
        ),
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not same:
        sys.exit("Assignment parity failed")
