"""Render a sample 360° audit report from an in-memory SQLite fixture (never the real database).

    backend/.venv/Scripts/python.exe tools/report_360_sample.py OUT_BASENAME [--month 2026-05]

Writes OUT_BASENAME.html and OUT_BASENAME.xlsx and prints the timings and section errors.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
# The app's engine is created at import time; point it at SQLite so nothing can reach PostgreSQL.
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"

from app.services import rota_report_360 as report  # noqa: E402
from tests.test_rota_report_360 import make_session, seed_realistic_month  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", help="output path without extension")
    parser.add_argument("--month", default="2026-05")
    args = parser.parse_args()
    session = make_session()
    seed_realistic_month(session, month=args.month)
    started = time.perf_counter()
    data = report.build_report_data(session, args.month, generated_by="Dr Rota Auditor")
    html_text = report.render_html(data)
    xlsx = report.render_xlsx(data)
    elapsed = time.perf_counter() - started
    Path(args.out + ".html").write_text(html_text, encoding="utf-8")
    Path(args.out + ".xlsx").write_bytes(xlsx)
    print(f"built + rendered in {elapsed:.2f}s; slots={data['summary'].get('slots')} members={data['summary'].get('members')}")
    print("compliance:", data["compliance"].get("available"), data["compliance"].get("error"),
          [(c["name"], c["passed"]) for c in data["compliance"]["checks"]])
    print("section errors:", data["section_errors"] or "none")


if __name__ == "__main__":
    main()
