"""Phase 0 evaluation: run every current member-name matcher against the golden set.

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
    from app.services import historical_analysis_dry_run as hist
    from app.services.imports import ParsedRotaAssignment
    from app.services.leave_import import clean_person_text, match_person, person_lookup
    from app.services.members import compact_name_key, normalize_member_name
    from app.services.normalization import member_lookup, resolve_member
    from app.services.unit_assignment_import import match_person_for_unit_import
    from app.services.unitwise_call_levels import match_person as unitwise_match

    people = list(db.scalars(select(Person).options(selectinload(Person.aliases))))
    review_lookup = member_lookup(db, active_only=False)
    legacy_lookup = person_lookup(db)
    compact_keys, spaced_keys = defaultdict(set), defaultdict(set)
    for p in people:
        for value in [p.canonical_name, *(a.alias for a in p.aliases)]:
            compact_keys[compact_name_key(value)].add(p)
            spaced_keys[normalize_member_name(value)].add(p)
    hist_aliases = {}
    for p in people:
        for a in p.aliases:
            if hist.compact_name(a.alias):
                hist_aliases[hist.compact_name(a.alias)] = p.canonical_name
    hist_resolver = hist.CanonicalNameResolver(
        [hist.CanonicalMember(str(p.id), p.canonical_name, p.call_level, "db") for p in people], hist_aliases)
    by_name = {p.canonical_name: p for p in people}

    def review_import(c):
        day = date.fromisoformat(c["date"]) if c["date"] else None
        r = resolve_member(db, c["raw_name"], as_of=day, lookup=review_lookup)
        return r["canonical_name"] if r["state"] == "matched" else None, r["state"]

    def legacy_leave(c):
        person, method, conf, _ = match_person(clean_person_text(c["raw_name"]), legacy_lookup)
        return (person.canonical_name if person else None), conf

    def legacy_unit(c):
        person, method, conf, _, _ = match_person_for_unit_import(clean_person_text(c["raw_name"]), legacy_lookup)
        return (person.canonical_name if person else None), conf

    def unitwise_prefill(c):
        person = unitwise_match(clean_person_text(c["raw_name"]), people)
        return (person.canonical_name if person else None), "matched" if person else "none"

    def member_workbook(c):
        hits = compact_keys.get(compact_name_key(c["raw_name"]), set())
        return (next(iter(hits)).canonical_name if len(hits) == 1 else None), f"{len(hits)} key hits"

    def past_duties(c):
        hits = spaced_keys.get(normalize_member_name(c["raw_name"]), set())
        return (next(iter(hits)).canonical_name if len(hits) == 1 else None), f"{len(hits)} key hits"

    def historical_rebuild(c):
        duty_type, label = CALL_TO_DUTY.get(c["call_level"], ("", c["unit"] or ""))
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

    from app.services.member_resolution_rules import build_seed_rules
    from app.services.member_resolver import MemberIndex, ResolutionContext

    # Use the saved rules when the table exists; otherwise the seed rules, built in memory.
    try:
        from app.models import MemberResolutionRule
        saved = list(db.scalars(select(MemberResolutionRule)))
    except Exception:  # noqa: BLE001 - table not migrated on this copy yet
        db.rollback()
        saved = []
    rules = saved or build_seed_rules({p.canonical_name: p for p in people})[0]
    index = MemberIndex(people, rules)

    def resolver(purpose):
        def run(c):
            day = date.fromisoformat(c["date"]) if c["date"] else None
            r = index.resolve(c["raw_name"], ResolutionContext.build(c["call_level"], day, c["unit"]), purpose=purpose)
            return (r.canonical_name if r.status == "matched" else None), r.status
        run.purpose = purpose
        return run

    return {"NEW shared resolver (live imports)": resolver("live"),
            "NEW shared resolver (history imports)": resolver("history"),
            "review_import (unit/leave CSV, member CSV)": review_import,
            "legacy_leave_import": legacy_leave, "legacy_unit_import": legacy_unit,
            "unitwise_call_level_prefill": unitwise_prefill, "member_workbook_import": member_workbook,
            "past_duties_import": past_duties, "historical_rebuild (context-aware)": historical_rebuild}, by_name


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
