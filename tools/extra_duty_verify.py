"""Independent strict-rule check of one month's rota (docs/extra_duty_contract.md, section 7).

Read-only. Checks every active assignment of the month: active member, posted to the duty's
unit, duty allowed for the unit (the duty's allowed/excluded unit rules, code ``unit_rule``),
call level and groups, leave (all active statuses), no double booking, rest after 24-hour
duties (including neighbouring months) and slot capacity.

An assignment backed by an active extra-duty ledger record with ``unposted_member`` (fill-all,
docs/extra_duty_fill_all_contract.md section 3) is exempt from the posted-to-unit check only,
and only while the member has no posting at all on that date; every other check still applies.
The number of such exempted assignments is printed under the check table.

A superadmin allocation (``source == "superadmin_allocation"``) is exempt from the call level
and groups, duty-allowed-for-unit, posted-to-unit and active-member checks; never from leave,
rest, double booking or capacity. Their count is printed as well, and each one that crosses call
level is listed under "Call level crossed by superadmin" (never hidden).

usage (from backend/):
    .venv/Scripts/python.exe ../tools/extra_duty_verify.py --month 2026-05 [--database-url URL] [--json]

Refuses the working database (``duty_rota``) unless ``--i-know-this-is-production`` is given,
the same guard as tools/merge_dry_run.py. Exit code: 0 all checks pass, 1 violations, 2 error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

WORKING_DATABASE = "duty_rota"


def database_name(url: str) -> str:
    return url.rsplit("/", 1)[-1].split("?", 1)[0]


def render(result: dict) -> str:
    lines = [f"Strict-rule check for {result['month']}: {result['checked']} active assignments checked"]
    for check in result["checks"]:
        mark = "PASS" if check["passed"] else "FAIL"
        lines.append(f"  [{mark}] {check['name']}: {check['violations']} violation(s) in {check['checked']} checked")
    if result.get("unposted_exempt"):
        lines.append(f"  ({result['unposted_exempt']} assignment(s) ledgered as 'no posting this month' were exempt from the posting check only)")
    if result.get("superadmin_exempt"):
        lines.append(f"  ({result['superadmin_exempt']} superadmin allocation(s) were exempt from the call level, groups, unit rule, posting and active-member checks; leave, rest, double booking and capacity still apply)")
    if result.get("superadmin_cross_level"):
        lines.append("")
        lines.append(f"Call level crossed by superadmin ({len(result['superadmin_cross_level'])}):")
        for v in result["superadmin_cross_level"]:
            lines.append(
                f"  {v['duty_date']}  {v['duty_type']:<18} {v['person_name'] or v['person_id']}: "
                f"{v['message']}  (slot {v['slot_id']})"
            )
    if result["violations"]:
        lines.append("")
        lines.append("Violations:")
        for v in result["violations"]:
            lines.append(
                f"  {v['duty_date']}  {v['duty_type']:<18} {v['person_name'] or v['person_id']}: "
                f"{v['code']} - {v['message']}  (slot {v['slot_id']})"
            )
    lines.append("")
    lines.append("OK: no strict rule is broken." if result["ok"] else f"NOT OK: {len(result['violations'])} violation(s).")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--month", required=True, help="YYYY-MM")
    parser.add_argument("--database-url", help="SQLAlchemy URL (default: the configured database)")
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    parser.add_argument("--i-know-this-is-production", action="store_true", dest="production_ok")
    args = parser.parse_args(argv)
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from app import models  # noqa: F401
        from app.core.config import settings
        from app.services.extra_duty_verify import check_month
        from app.services.leave import month_bounds

        month_bounds(args.month)
        url = args.database_url or settings.sqlalchemy_database_url
        working = {WORKING_DATABASE, database_name(settings.sqlalchemy_database_url)} if not args.database_url else {WORKING_DATABASE}
        if database_name(url) in working and not args.production_ok:
            print("Refusing to run against the working database; use a copy "
                  "(or pass --i-know-this-is-production).", file=sys.stderr)
            return 2
        engine = create_engine(url)
        try:
            with Session(engine) as db:
                result = check_month(db, args.month)
                db.rollback()
        finally:
            engine.dispose()
    except Exception as exc:  # noqa: BLE001 - any failure is exit code 2
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, default=str) if args.json else render(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
