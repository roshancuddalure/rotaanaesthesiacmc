"""Compare two workflow-equivalence runs: requests sent, saved data, and the exported workbook.

usage: compare_workflow_runs.py <old-run-dir> <new-run-dir> <old-db-name> <new-db-name> [month]
Exits non-zero if anything differs. IDs and timestamps differ per database and are ignored;
rows are compared by their human-meaningful fields.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from openpyxl import load_workbook
from sqlalchemy import create_engine, text

from app.core.config import settings

old_dir, new_dir, old_db, new_db = (Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4])
month = sys.argv[5] if len(sys.argv) > 5 else "2026-11"
problems: list[str] = []

# 1. Requests that change data: same order, same paths, same bodies (ids normalised).
old_report = json.loads((old_dir / "report.json").read_text())
new_report = json.loads((new_dir / "report.json").read_text())


def normalise(mutations):
    out = []
    for m in mutations:
        body = json.dumps(m["body"], sort_keys=True)
        # Unit ids are identical in both copies (both cloned from one database); review ids are not.
        out.append((m["method"], m["path"], m["query"], body))
    return out


old_requests, new_requests = normalise(old_report["mutations"]), normalise(new_report["mutations"])
if old_requests != new_requests:
    problems.append("Data-changing requests differ")
    for i, (a, b) in enumerate(zip(old_requests, new_requests)):
        if a != b:
            problems.append(f"  request {i}: {a[:3]} vs {b[:3]}\n    old body {a[3][:300]}\n    new body {b[3][:300]}")
    if len(old_requests) != len(new_requests):
        problems.append(f"  {len(old_requests)} vs {len(new_requests)} requests")
print(f"requests: {len(old_requests)} old, {len(new_requests)} new, identical={old_requests == new_requests}")
if old_report["steps"] != new_report["steps"]:
    problems.append(f"Step outcomes differ: {old_report['steps']} vs {new_report['steps']}")

# 2. Saved data for the month, by meaningful fields.
QUERIES = {
    "rota scope": """
        select u.name, su.status, s.is_locked, s.lock_reason, s.include_excluded_units_in_safety
        from monthly_generation_scopes s join rota_periods p on p.id = s.rota_period_id
        join monthly_generation_scope_units su on su.scope_id = s.id join units u on u.id = su.unit_id
        where to_char(p.starts_on, 'YYYY-MM') = :month order by 1""",
    "duty slots": """
        select ds.duty_date, ds.duty_type, coalesce(u.name, ''), ds.call_level, ds.template_status, ds.is_24hr
        from duty_slots ds left join units u on u.id = ds.unit_id
        where to_char(ds.duty_date, 'YYYY-MM') = :month order by 1, 2, 3""",
    "leave": """
        select p.canonical_name, l.starts_on, l.ends_on, l.leave_type, l.leave_slot, l.status, l.source
        from leave_requests l join persons p on p.id = l.person_id
        where to_char(l.starts_on, 'YYYY-MM') = :month order by 1, 2""",
    "postings": """
        select p.canonical_name, coalesce(u.name, ''), pp.posting_type, pp.starts_on, pp.ends_on, pp.source
        from person_postings pp join persons p on p.id = pp.person_id left join units u on u.id = pp.unit_id
        where to_char(pp.starts_on, 'YYYY-MM') = :month order by 1, 3""",
    "members": "select canonical_name, active_status, call_level from persons order by 1",
    "member activity": "select a.action, p.canonical_name from member_activity a join persons p on p.id = a.person_id order by 2, 1",
}
base = settings.sqlalchemy_database_url.rsplit("/", 1)[0]


def snapshot(db: str) -> dict[str, list]:
    engine = create_engine(f"{base}/{db}")
    result = {}
    for name, sql in QUERIES.items():
        # One connection per query so a failure cannot hide the others.
        with engine.connect() as conn:
            try:
                result[name] = [tuple(str(v) for v in row) for row in conn.execute(text(sql), {"month": month})]
            except Exception as exc:  # noqa: BLE001 - a broken check must fail the comparison
                problems.append(f"{db}: {name} query failed: {str(exc).splitlines()[0]}")
                result[name] = []
    engine.dispose()
    return result


old_data, new_data = snapshot(old_db), snapshot(new_db)
for name in QUERIES:
    same = old_data[name] == new_data[name]
    print(f"{name}: {len(old_data[name])} rows old, {len(new_data[name])} rows new, identical={same}")
    if not same:
        only_old = set(old_data[name]) - set(new_data[name])
        only_new = set(new_data[name]) - set(old_data[name])
        problems.append(f"{name} differs: {list(only_old)[:3]} only in old; {list(only_new)[:3]} only in new")

# 3. The exported workbook, cell by cell (generation timestamps excepted).
def workbook_cells(path: Path) -> dict[str, list]:
    book = load_workbook(path, read_only=True, data_only=True)
    cells = {}
    for sheet in book.worksheets:
        rows = []
        for row in sheet.iter_rows(values_only=True):
            rows.append(tuple("" if v is None else str(v) for v in row))
        cells[sheet.title] = rows
    return cells


old_book, new_book = workbook_cells(old_dir / "eagle-eye.xlsx"), workbook_cells(new_dir / "eagle-eye.xlsx")
if list(old_book) != list(new_book):
    problems.append(f"Workbook sheets differ: {list(old_book)} vs {list(new_book)}")
differing = []
for sheet in old_book:
    a, b = old_book[sheet], new_book.get(sheet, [])
    for r, (row_a, row_b) in enumerate(zip(a, b)):
        for c, (va, vb) in enumerate(zip(row_a, row_b)):
            if va != vb and not ("generated" in va.lower() or "exported" in va.lower()):
                differing.append(f"{sheet}!R{r + 1}C{c + 1}: {va!r} vs {vb!r}")
    if len(a) != len(b):
        differing.append(f"{sheet}: {len(a)} vs {len(b)} rows")
print(f"workbook: {sum(len(v) for v in old_book.values())} rows across {len(old_book)} sheets, differing cells={len(differing)}")
problems.extend(differing[:10])

print("\nRESULT:", "IDENTICAL" if not problems else "DIFFERENCES FOUND")
for line in problems:
    print(line)
sys.exit(1 if problems else 0)
