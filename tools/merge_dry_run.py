"""Disaster-recovery check for member merges, on a database COPY.

For every suspected duplicate pair: preview, merge, verify nothing still refers to the merged
record, undo, and compare every table with its state before the merge. Everything is rolled
back at the end of each pair, so the copy is unchanged.

usage (from backend/): .venv/Scripts/python.exe ../tools/merge_dry_run.py [database]
Refuses the working database. Exit code 1 if any pair fails.
"""

import sys
from collections import Counter
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import settings  # noqa: E402

database = next((a for a in sys.argv[1:] if not a.startswith("--")), "duty_rota_ux_audit")
if database == settings.sqlalchemy_database_url.rsplit("/", 1)[1]:
    raise SystemExit("Refusing to run against the working database; use a copy.")
engine = create_engine(settings.sqlalchemy_database_url.rsplit("/", 1)[0] + "/" + database)

from app.db.session import Base  # noqa: E402
from app.services.member_bulk import suspected_duplicates  # noqa: E402
from app.services.member_merge import row_json, run_merge, undo_merge  # noqa: E402


def image(db) -> dict:
    out = {}
    for table in Base.metadata.sorted_tables:
        if table.name == "member_merges":
            continue
        out[table.name] = sorted(repr(sorted(row_json(r).items())) for r in db.execute(select(table)).all())
    return out


with Session(engine) as db:
    pairs = suspected_duplicates(db)
    db.rollback()
outcomes = Counter()
for pair in pairs:
    target = UUID(pair["suggested_target_id"])
    source = UUID(next(p["id"] for p in pair["people"] if p["id"] != str(target)))
    names = " + ".join(p["canonical_name"] for p in pair["people"])
    with Session(engine) as db:
        try:
            before = image(db)
            preview = run_merge(db, target, [source], preview=True)
            if image(db) != before:
                raise AssertionError("preview changed data")
            result = run_merge(db, target, [source], preview_token=preview["preview_token"])
            db.flush()
            undo_merge(db, UUID(result["merge_id"]))
            db.flush()
            after = image(db)
            if after != before:
                diff = [t for t in before if before[t] != after.get(t)]
                raise AssertionError(f"undo did not restore: {diff}")
            moved = sum(preview["moves"].values())
            outcome, detail = "ok", f"{moved} records moved, {len(preview['combined'])} combined, " \
                                    f"{len(preview['conflicts'])} conflicts"
        except Exception as exc:  # noqa: BLE001 - every failure is a finding
            outcome, detail = type(exc).__name__, str(getattr(exc, "orig", exc)).splitlines()[0][:200]
        finally:
            db.rollback()
    outcomes[outcome] += 1
    print(f"{'OK  ' if outcome == 'ok' else 'FAIL'} {names}: {detail}")
print(dict(outcomes), f"of {len(pairs)} pairs (merge + exact undo, all rolled back)")
sys.exit(0 if set(outcomes) <= {"ok"} else 1)
