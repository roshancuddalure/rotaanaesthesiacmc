"""Show observed PostgreSQL test progress without claiming a terminal certificate."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/allocation-progress"
parser = argparse.ArgumentParser()
parser.add_argument('name', nargs='?', default='postgres-performance-followup')
parser.add_argument('--revision', type=int, default=16)
parser.add_argument('--base-passed', type=int, default=0)
parser.add_argument('--base-failures', type=int, default=0)
args = parser.parse_args()
NAME = args.name
assert NAME.replace('-', '').isalnum()
assert 1 <= args.revision <= 99 and args.base_passed >= 0 and args.base_failures >= 0
STEM = OUT / (f'fairness-modes-revision{args.revision}-' + NAME)


def main():
    while True:
        try:
            status = json.loads(Path(str(STEM) + "-status.json").read_text(encoding="utf-8"))
            live_path = OUT / "fairness-modes-live.json"
            live = json.loads(live_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(2)
            continue
        raw = Path(str(STEM) + ".log").read_bytes() if Path(str(STEM) + ".log").exists() else b''
        log = raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8', errors='replace')
        outcomes = "".join(
            match.group(1) for line in log.splitlines()
            if (match := re.fullmatch(r"([.FsExX]+)(?:\s+\[\s*\d+%\])?", line.strip()))
        )
        count = len(outcomes)
        failures = outcomes.count("F") + outcomes.count("E")
        expected = len(status.get('nodes', []))
        terminal = status["status"] not in {"running", "waiting-for-full-suite"}
        value = f"PG {count}/{expected or '?'}"
        chart_value = f"{count}/{expected or '?'} PG; {args.base_failures} full failures"
        if terminal:
            value = "PG terminal: review"
            chart_value = "PG finished; reconcile"
        checkpoint = {
            "at": datetime.now(timezone.utc).isoformat(),
            "status": status["status"],
            "reported_outcomes": count,
            "observed_failure_markers": failures,
            "certificate_verified": False,
            "expected_postgres_cases": expected,
        }
        Path(str(STEM) + '-progress.json').write_text(
            json.dumps(checkpoint, indent=2), encoding="utf-8"
        )
        live["metrics"]["Full regression"] = value
        live["charts"][-1].update(value=chart_value, fraction=min(count / expected, 1) if expected else 0)
        live["phase"] = (
            f"PostgreSQL: {count}/{expected or '?'} reported outcomes; {failures} failure markers. "
            f"Full suite: {args.base_passed} passed, {args.base_failures} failures; "
            "final reconciliation pending."
        )
        live_path.write_text(json.dumps(live, indent=2), encoding="utf-8")
        if terminal:
            return
        time.sleep(10)


if __name__ == "__main__":
    main()
