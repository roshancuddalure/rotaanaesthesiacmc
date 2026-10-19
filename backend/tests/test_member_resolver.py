"""The shared member resolver against the golden set, plus safety and property tests.

The golden set (tests/fixtures/member_resolution_cases.csv) holds 644 cases from the alias
summary and real imported spellings; the roster snapshot is the department roster they refer
to. The bar is zero wrong automatic assignments (docs/member_resolution_audit.md).
"""

import csv
import json
import random
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import MemberResolutionRule, Person, PersonAlias
from app.services.member_resolution_rules import seed_resolution_rules
from app.services.member_resolver import MemberIndex, ResolutionContext, UnknownMemberId, resolve_rows

FIXTURES = Path(__file__).parent / "fixtures"
CASES = list(csv.DictReader(open(FIXTURES / "member_resolution_cases.csv", encoding="utf-8")))


def make_db():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


@pytest.fixture(scope="module")
def roster():
    db = make_db()
    snapshot = json.load(open(FIXTURES / "member_roster_snapshot.json", encoding="utf-8"))
    for p in snapshot["people"]:
        person = Person(canonical_name=p["name"], active_status=p["status"], call_level=p["call_level"])
        person.aliases = [PersonAlias(alias=a, source=s) for a, s in p["aliases"]]
        db.add(person)
    db.flush()
    seed_resolution_rules(db)
    db.commit()
    yield db
    db.close()


def assigned(index, case, purpose):
    day = date.fromisoformat(case["date"]) if case["date"] else None
    result = index.resolve(case["raw_name"], ResolutionContext.build(case["call_level"], day, case["unit"]),
                           purpose=purpose)
    return result


@pytest.mark.parametrize("purpose", ["live", "history"])
def test_golden_set_has_no_wrong_automatic_assignment(roster, purpose):
    index = MemberIndex.load(roster)
    status = {p.canonical_name: p.active_status for p in index.people}
    wrong, missed = [], []
    for case in CASES:
        result = assigned(index, case, purpose)
        got = result.canonical_name if result.matched else None
        expected = case["expected_member"]
        outcome = case["expected_outcome"]
        accepted = set(expected.split(" / ")) if expected else set()
        if got is not None and got not in accepted:
            wrong.append((case["raw_name"], case["call_level"], case["unit"], case["date"], expected or outcome, got))
        if outcome == "matched" and got is None:
            live_must_ask = purpose == "live" and status.get(expected) != "active"
            if not live_must_ask:
                missed.append((case["raw_name"], case["call_level"], expected, result.status, result.reason))
    assert wrong == [], f"{len(wrong)} wrong automatic assignments: {wrong[:15]}"
    assert missed == [], f"{len(missed)} known names not matched: {missed[:15]}"


def test_shared_short_forms_ask_without_context(roster):
    index = MemberIndex.load(roster)
    for name in ["Sam", "Daniel", "David", "Rohan", "Riya", "Angeline", "Priyadarshini", "Joel", "Jeenu"]:
        result = index.resolve(name)
        assert result.status in {"needs_review", "ambiguous"}, (name, result.status, result.canonical_name)
        assert len(result.candidates) >= 2, name


def test_context_rules_pick_the_right_person(roster):
    index = MemberIndex.load(roster)
    cases = [
        ("Sam", "1ST_CALL", date(2026, 5, 1), "Samcharles D"),
        ("Sam", "4TH_CALL", date(2026, 5, 1), "Samuel David Chandran"),
        ("Daniel", "4TH_CALL", date(2026, 5, 1), "Pradeep Daniel"),
        ("Daniel", "1ST_CALL", date(2026, 4, 15), "Joel Daniel"),
        ("Daniel", "2ND_CALL", date(2025, 6, 1), "Daniel Jonathan Roy L"),
        ("David", "2ND_CALL", date(2026, 5, 1), "Karumuru David Raj"),
        ("Rohan", "3RD_CALL", date(2026, 5, 1), "Rohan Chacko Jacob"),
    ]
    for name, level, day, expected in cases:
        result = index.resolve(name, ResolutionContext.build(level, day))
        assert result.canonical_name == expected, (name, level, day, result.as_dict())
        assert result.method == "context_rule"


def test_historical_members_need_review_on_live_imports(roster):
    index = MemberIndex.load(roster)
    live = index.resolve("Rohan", ResolutionContext.build("3RD_CALL", date(2025, 10, 10)))
    assert live.status == "needs_review" and live.person_id is None
    assert live.candidates[0].name == "Rohan Jacob Titus"
    history = index.resolve("Rohan", ResolutionContext.build("3RD_CALL", date(2025, 10, 10)), purpose="history")
    assert history.canonical_name == "Rohan Jacob Titus"


def test_fuzzy_never_assigns(roster):
    index = MemberIndex.load(roster)
    result = index.resolve("Jerrin Danniel D")
    assert result.status == "needs_review" and result.person_id is None
    assert result.candidates and result.candidates[0].name == "Jerin Daniel D"


def test_unknown_names_are_not_found(roster):
    index = MemberIndex.load(roster)
    assert index.resolve("Zzyzx Qwerty").status == "not_found"
    assert index.resolve("   ").status == "not_found"


def test_explicit_member_id_wins_and_unknown_id_is_an_error(roster):
    index = MemberIndex.load(roster)
    person = next(p for p in index.people if p.canonical_name == "Jerin Daniel D")
    assert index.resolve("anything", person_id=person.id).canonical_name == "Jerin Daniel D"
    with pytest.raises(UnknownMemberId):
        index.resolve("Jerin", person_id=uuid4())


@pytest.mark.parametrize("variant", ["jerin daniel d", "JERIN DANIEL D", "  Jerin   Daniel  D ", "Dr. Jerin Daniel D",
                                     "Dr Jerin-Daniel D", "Jerin.Daniel.D", "Prof. jerin daniel d"])
def test_case_spacing_punctuation_and_titles_do_not_matter(roster, variant):
    result = MemberIndex.load(roster).resolve(variant)
    assert result.canonical_name == "Jerin Daniel D", (variant, result.as_dict())


def test_database_order_does_not_change_results(roster):
    people = list(MemberIndex.load(roster).people)
    rules = list(roster.query(MemberResolutionRule))
    sample = CASES[::7]
    baseline = None
    for seed in range(3):
        random.Random(seed).shuffle(people)
        random.Random(seed + 10).shuffle(rules)
        index = MemberIndex(people, rules)
        outcome = [(r.status, r.person_id, [c.person_id for c in r.candidates])
                   for r in (assigned(index, case, "live") for case in sample)]
        assert baseline is None or outcome == baseline
        baseline = outcome


def test_file_level_warnings(roster):
    index = MemberIndex.load(roster)
    day = date(2026, 5, 1)
    results = resolve_rows(index, [
        {"raw_name": "Sam", "call_level": "1ST_CALL", "on": day},
        {"raw_name": "Sam", "call_level": "4TH_CALL", "on": day},
        {"raw_name": "Jerin", "on": day},
        {"raw_name": "Jerin Daniel D", "on": day},
    ])
    assert any("resolves to 2 different members" in w for w in results[0].warnings)
    assert any("different spellings on the same day" in w for w in results[2].warnings)


def test_near_duplicates_flag_existing_members(roster):
    index = MemberIndex.load(roster)
    names = [c.name for c in index.near_duplicates("Jasmine J.")]
    assert "Jasmine J" in names and "Jasmin J" in names
    assert index.near_duplicates("Completely New Person") == []


def test_seeding_is_idempotent(roster):
    assert seed_resolution_rules(roster)["created"] == 0
