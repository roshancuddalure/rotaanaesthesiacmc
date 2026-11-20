"""CPU attribution for one disposable corpus case; profiling is not a latency benchmark."""

import argparse
import cProfile
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import pstats

from benchmark_allocation_corpus import CASES, ROOT, run_case


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=CASES, default="ot_pressure")
    parser.add_argument("--members", type=int, default=48)
    parser.add_argument("--slots", type=int, default=62)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if (
        not 10 <= args.members <= 150
        or not 10 <= args.slots <= 62
        or not 1 <= args.seconds <= 120
    ):
        parser.error("Use10-150members,10-62slots,1-120searchseconds")
    binary = args.output.with_suffix(".pstats")
    if args.output.exists() or binary.exists():
        parser.error("Use fresh output paths; retain historical profiles")
    source = [
        Path(__file__),
        ROOT / "tools/benchmark_allocation_corpus.py",
        *sorted((ROOT / "backend/app/services").glob("*.py")),
        *sorted((ROOT / "backend/app/models").glob("*.py")),
    ]
    fingerprints = {
        str(path.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in source
    }
    profiler = cProfile.Profile()
    result = None
    failure = None
    try:
        result = profiler.runcall(
            run_case, args.case, args.members, args.slots, args.seconds
        )
    except Exception as exc:
        failure = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        profiler.dump_stats(str(binary))
        stats = pstats.Stats(profiler)
        rows = []
        for (filename, line, name), (
            primitive,
            calls,
            self_time,
            cumulative,
            callers,
        ) in stats.stats.items():
            path = Path(filename)
            try:
                label = str(path.resolve().relative_to(ROOT)).replace("\\", "/")
            except (ValueError, OSError):
                label = path.name
            rows.append(
                {
                    "file": label,
                    "line": line,
                    "function": name,
                    "primitive_calls": primitive,
                    "calls": calls,
                    "self_seconds": self_time,
                    "cumulative_seconds": cumulative,
                }
            )
        report = {
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "python": platform.python_version(),
            "case": args.case,
            "members": args.members,
            "slots": args.slots,
            "search_seconds": args.seconds,
            "purpose": "cProfile attribution only. Instrumentation changes timing and solver time available; do not compare latency with unprofiled runs.",
            "scope": "Disposable SQLite synthetic fixture, CPU only; no operational DB or duties modified.",
            "source_sha256": fingerprints,
            "source_unchanged": all(
                hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
                for name, digest in fingerprints.items()
            ),
            "failure": failure,
            "case_result": result,
            "total_profiled_seconds": stats.total_tt,
            "total_calls": stats.total_calls,
            "primitive_calls": stats.prim_calls,
            "top_self": sorted(rows, key=lambda row: row["self_seconds"], reverse=True)[
                :60
            ],
            "top_cumulative": sorted(
                rows, key=lambda row: row["cumulative_seconds"], reverse=True
            )[:60],
            "attribution_basis": "Self time excludes callees. Cumulative entries overlap and must not be added. Native CP-SAT appears at the Python/native boundary; this is not a native solver profiler.",
        }
        args.output.write_text(
            json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
        )
    assert report["source_unchanged"], "Source changed during profiling"


if __name__ == "__main__":
    main()
