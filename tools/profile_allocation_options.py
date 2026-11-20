"""Profile the disposable 200-person options regression without changing its gate.

Run from the repository root with backend/.venv/Scripts/python.exe. This runs
only the existing in-memory test; it never opens an operational test database.
Stage totals overlap when calls nest and profiling overhead affects latency.
"""

from collections import defaultdict
from functools import wraps
import json
from pathlib import Path
import sys
from time import perf_counter, process_time


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import pytest  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from app.services import superadmin_allocation as allocation  # noqa: E402


def main():
    stages = defaultdict(lambda: {"calls": 0, "wall_seconds": 0.0, "cpu_seconds": 0.0})
    state = {"inside_options": False}
    queries = {"calls": 0, "wall_seconds": 0.0}
    originals = []

    def instrument(owner, name):
        original = getattr(owner, name)
        originals.append((owner, name, original))

        @wraps(original)
        def measured(*args, **kwargs):
            prior = state["inside_options"]
            if name == "options":
                state["inside_options"] = True
            wall, cpu = perf_counter(), process_time()
            try:
                return original(*args, **kwargs)
            finally:
                row = stages[f"{owner.__name__}.{name}"]
                row["calls"] += 1
                row["wall_seconds"] += perf_counter() - wall
                row["cpu_seconds"] += process_time() - cpu
                state["inside_options"] = prior

        setattr(owner, name, measured)

    def before_sql(conn, cursor, statement, parameters, context, executemany):
        context._options_profile_started = perf_counter() if state["inside_options"] else None

    def after_sql(conn, cursor, statement, parameters, context, executemany):
        started = getattr(context, "_options_profile_started", None)
        if started is not None:
            queries["calls"] += 1
            queries["wall_seconds"] += perf_counter() - started

    for name in ("options", "_load_slot", "_load_state", "strict_blocks", "cross_level",
                 "_member_context", "_person_unit", "_month_duties"):
        instrument(allocation, name)
    instrument(allocation._Overrides, "__init__")
    instrument(allocation._Overrides, "for_person")
    event.listen(Engine, "before_cursor_execute", before_sql)
    event.listen(Engine, "after_cursor_execute", after_sql)
    evidence = ROOT / "docs/allocation-progress"
    wall, cpu = perf_counter(), process_time()
    code = None
    try:
        code = pytest.main([
            str(ROOT / "backend/tests/test_superadmin_allocation.py")
            + "::test_options_fast_for_two_hundred_people", "-q",
            f"--junitxml={evidence / 'ot-options-profile-tests.xml'}",
        ])
    finally:
        event.remove(Engine, "before_cursor_execute", before_sql)
        event.remove(Engine, "after_cursor_execute", after_sql)
        for owner, name, original in reversed(originals):
            setattr(owner, name, original)
        artifact = {"scenario": "existing in-memory 200-person superadmin options gate",
                    "pytest_exit_code": int(code) if code is not None else None,
                    "wall_seconds": perf_counter() - wall, "cpu_seconds": process_time() - cpu,
                    "stages": dict(stages), "options_sql": queries,
                    "limitations": "Instrumented timings include profiling overhead. Nested stage totals overlap; process CPU includes all threads. Not a production benchmark."}
        (evidence / "ot-options-profile.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    return int(code)


if __name__ == "__main__":
    raise SystemExit(main())
