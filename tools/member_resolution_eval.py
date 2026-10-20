"""Score the shared member resolver (and the historical rebuild) against the golden set.

The Phase 0 scores of the matchers it replaced are kept in docs/member_resolution_baseline.json.

usage (from backend/):  .venv/Scripts/python.exe ../tools/member_resolution_eval.py tests/fixtures/member_resolution_cases.csv <out.json> [database]
Reads only the named database (default duty_rota_ux_audit, a copy); never writes. Each matcher is
scored on what it would ASSIGN without a person reviewing the row.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session, selectinload  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.models import Person  # noqa: E402

golden_path, out_path = sys.argv[1], sys.argv[2]
database = sys.argv[3] if len(sys.argv) > 3 else "duty_rota_ux_audit"
if database == settings.sqlalchemy_database_url.rsplit("/", 1)[1]:
    raise SystemExit("Refusing to evaluate against the working database; use a copy.")
engine = create_engine(settings.sqlalchemy_database_url.rsplit("/", 1)[0] + "/" + database)
cases = list(csv.DictReader(open(golden_path, encoding="utf-8")))

CALL_TO_DUTY = {"1ST_CALL": ("MAIN_1ST_24HR", "1st call"), "2ND_CALL": ("MAIN_2ND_24HR", "2nd call"),
                "3RD_CALL": ("MAIN_3RD_24HR", "3rd call"), "4TH_CALL": ("MAIN_4TH_24HR", "4th call")}


def build_matchers(db: Session):
    from app.models import MemberResolutionRule
    from app.services import historical_analysis_dry_run as hist
    from app.services.imports import ParsedRotaAssignment
    from app.services.member_resolution_rules import build_seed_rules
    from app.services.member_resolver import MemberIndex, ResolutionContext

    people = list(db.scalars(select(Person).options(selectinload(Person.aliases))))
    by_name = {p.canonical_name: p for p in people}
    # Use the saved rules when the table exists on this copy; otherwise the seed, in memory.
    try:
        saved = list(db.scalars(select(MemberResolutionRule)))
    except Exception:  # noqa: BLE001 - table not migrated on this copy yet
        db.rollback()
        saved = []
    index = MemberIndex(people, saved or build_seed_rules(by_name)[0])
    hist.set_shared_index(index)  # the rebuild resolves against this copy, not the working DB
    hist_aliases = {hist.compact_name(a.alias): p.canonical_name for p in people for a in p.aliases
                    if hist.compact_name(a.alias)}
    hist_resolver = hist.CanonicalNameResolver(
        [hist.CanonicalMember(str(p.id), p.canonical_name, p.call_level, "db") for p in people], hist_aliases)

    def resolver(purpose):
        def run(c):
            day = date.fromisoformat(c["date"]) if c["date"] else None
            r = index.resolve(c["raw_name"], ResolutionContext.build(c["call_level"], day, c["unit"]), purpose=purpose)
            return (r.canonical_name if r.status == "matched" else None), r.status
        run.purpose = purpose
        return run

    def historical_rebuild(c):
        duty_type, label = CALL_TO_DUTY.get(c["call_level"], (c["unit"] or "", c["unit"] or ""))
        day = date.fromisoformat(c["date"]) if c["date"] else date(2026, 5, 1)
        when = datetime.combine(day, datetime.min.time())
        assignment = ParsedRotaAssignment(
            source_file=None, sheet_name="", duty_date=day, weekday_label="", row_index=0, column_index=0,
            column_label=label, duty_label=label, duty_type=duty_type, person_name=c["raw_name"],
            raw_person_name=c["raw_name"], starts_at=when, ends_at=when, is_24hr=True)
        manual = hist.manual_name_resolution(assignment, day.strftime("%Y-%m"))
        r = manual or hist_resolver.resolve(c["raw_name"])
        name = r.canonical_name if r.status == "matched" else None
        return (name if name in by_name or name is None else f"{name} [not in DB]"), r.status
    historical_rebuild.purpose = "history"

    return {"shared resolver (live imports)": resolver("live"),
            "shared resolver (history imports)": resolver("history"),
            "historical rebuild": historical_rebuild}, by_name


def classify(case, assigned, by_name, purpose="live"):
    expected = case["expected_member"]
    # "A / B": the source data credits either record (a split or duplicate identity).
    if " / " in expected:
        alternatives = expected.split(" / ")
        if assigned in alternatives:
            return "correct"
        expected = alternatives[0]
    # A live import must ask before assigning a historical member; asking is then correct.
    if (case["expected_outcome"] == "matched" and purpose == "live" and assigned is None
            and expected in by_name and by_name[expected].active_status != "active"):
        return "asked_for_review"
    if case["expected_outcome"] == "owner_confirm":
        return "owner_confirm"
    if case["expected_outcome"] == "member_or_review":
        # Assigning the right person or asking are both acceptable; anyone else is wrong.
        if assigned == expected:
            return "correct"
        return "asked_for_review" if assigned is None else "wrong_member"
    if case["expected_outcome"] == "matched":
        if assigned == expected:
            return "correct"
        if assigned is None:
            return "missed_match"
        return "wrong_member"
    # needs_review / not_found / not_auto_assigned: nothing may be assigned automatically.
    if assigned is None:
        return "correct"
    person = by_name.get(assigned)
    if person is not None and person.active_status != "active":
        return "archived_or_historical_auto_assigned"
    return "ambiguous_auto_assigned"


with Session(engine) as db:
    matchers, by_name = build_matchers(db)
    report = {"database": database, "cases": len(cases), "matchers": {}}
    for name, fn in matchers.items():
        tally, failures = Counter(), []
        for c in cases:
            try:
                assigned, detail = fn(c)
            except Exception as exc:  # noqa: BLE001 - a crash is a failure, recorded as such
                assigned, detail = None, f"error: {exc}"
            verdict = classify(c, assigned, by_name, getattr(fn, "purpose", "live"))
            # A matched case wrongly mapped to an inactive member is also an archived assignment.
            if verdict == "wrong_member" and assigned in by_name and by_name[assigned].active_status != "active":
                verdict = "wrong_member (inactive)"
            tally[verdict] += 1
            if verdict not in {"correct"}:
                failures.append({**c, "assigned": assigned, "detail": detail, "verdict": verdict})
        scored = len(cases) - tally["owner_confirm"]
        acceptable = tally["correct"] + tally["asked_for_review"]
        wrong = sum(v for k, v in tally.items() if k not in {"correct", "asked_for_review", "missed_match", "owner_confirm"})
        report["matchers"][name] = {"acceptable": round(acceptable / scored, 4), "wrong_auto_assignments": wrong,
                                    "tally": dict(tally), "failures": failures}
        print(f"{name:45} acceptable {acceptable / scored:6.1%}  wrong auto-assignments {wrong:3}  {dict(tally)}")
    db.rollback()
json.dump(report, open(out_path, "w", encoding="utf-8"), indent=1, default=str)
