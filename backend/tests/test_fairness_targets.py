"""Equal duties within a call level (docs/limits_callevel_fairness_contract.md section 2).

* ``call_level_targets`` / ``call_level_spread`` shapes and the member counting rule.
* The ranking order: not tight -> distance below the call-level target (fewest month duties,
  all campuses) -> soft burden; the campus term only counts for a tight candidate.
* A realistic simulation: 6 units on 2 campuses, 5 call levels, 150 members, leave and the
  24-hour rest rule, filled by Safe Auto-Fill. Within each call level the duty totals must stay
  within ``max_gap_within_call_level`` except where leave makes that impossible (the member on
  leave, or colleagues of a unit left short-staffed so its slots stay open for the extra-duty
  layer), and every such exception must be explained by the spread output.

Normal generation draws candidates from the slot's own unit, so equality across units within a
level relies on each unit holding the same ratio of duties to members of that level; the
simulation keeps that ratio (as the real template does per unit) and varies leave instead.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, Unit
from app.services.fairness_targets import call_level_spread, call_level_targets
from app.services.rota_auto_fill import run_safe_auto_fill
from app.services.rota_candidates import EQUALITY_WEIGHT, TIGHT_WEIGHT, candidate_score
from app.services.rota_rules import RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_setup import monthly_setup

MONTH = "2026-05"
DAYS = 31
# (level, duty type, members per unit, weekend-only slots)
LEVELS = [
    ("1ST_CALL", "MAIN_1ST_24HR", 8, False),
    ("2ND_CALL", "MAIN_2ND_24HR", 6, False),
    ("3RD_CALL", "MAIN_3RD_24HR", 5, False),
    ("4TH_CALL", "MAIN_4TH_24HR", 4, False),
    ("5TH_CALL", "FLOATING_24HR", 2, True),
]
UNITS = [("U1", "A"), ("U2", "A"), ("U3", "A"), ("U4", "B"), ("U5", "B"), ("U6", "B")]


@pytest.fixture()
def db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _slot(session, period, unit, day: date, level: str, duty_type: str) -> DutySlot:
    starts_at = datetime.combine(day, time(8))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=day,
        duty_type=duty_type,
        call_level=level,
        slot_label=f"{unit.code}:{level}:{day.isoformat()}",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=24),
        is_24hr=True,
        source="phase4_template",
    )
    session.add(slot)
    return slot


def build_month(session: Session, *, seed: int = 7, leave_people: int = 12):
    """150 members, ~800 slots, a dozen members with 5-14 days of leave."""
    rng = random.Random(seed)
    get_phase_one_rules(session)
    period, _scope = monthly_setup(session, MONTH)
    units = [Unit(code=code, name=f"Unit {code}", campus=campus) for code, campus in UNITS]
    session.add_all(units)
    session.flush()
    people: list[Person] = []
    for unit in units:
        for level, _duty, count, _weekend in LEVELS:
            for n in range(count):
                person = Person(canonical_name=f"{unit.code} {level} {n + 1:02d}", call_level=level)
                session.add(person)
                session.flush()
                session.add(
                    PersonPosting(
                        person=person,
                        unit=unit,
                        posting_type=level,
                        starts_on=date(2026, 5, 1),
                        source="unit_board",
                    )
                )
                people.append(person)
    on_leave = {}
    for person in rng.sample(people, leave_people):
        first = rng.randint(1, 20)
        length = rng.randint(5, 14)
        last = min(DAYS, first + length - 1)
        session.add(
            LeaveRequest(
                person=person,
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, first),
                ends_on=date(2026, 5, last),
                status="approved",
            )
        )
        on_leave[person.id] = last - first + 1
    for day_number in range(1, DAYS + 1):
        day = date(2026, 5, day_number)
        for unit in units:
            for level, duty, _count, weekend in LEVELS:
                if weekend and day.weekday() < 5:
                    continue
                _slot(session, period, unit, day, level, duty)
    session.commit()
    return units, people, on_leave


def test_targets_count_slots_and_available_members(db):
    units, people, _leave = build_month(db, leave_people=0)
    # One member of 1st call is on leave the whole month: not counted as available.
    absent = next(p for p in people if p.call_level == "1ST_CALL")
    db.add(
        LeaveRequest(
            person=absent, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
            starts_on=date(2026, 5, 1), ends_on=date(2026, 5, 31), status="approved",
        )
    )
    db.commit()
    rows = {row["call_level"]: row for row in call_level_targets(db, MONTH)}
    assert set(rows) == {level for level, *_ in LEVELS}
    first = rows["1ST_CALL"]
    assert first["slots"] == 6 * DAYS and first["members"] == 6 * 8 - 1
    assert first["target"] == round(186 / 47, 2)
    assert first["min_expected"] == 3 and first["max_expected"] == 4
    assert first["label"] == "1st call"
    weekend_days = sum(1 for d in range(1, DAYS + 1) if date(2026, 5, d).weekday() >= 5)
    assert rows["5TH_CALL"]["slots"] == 6 * weekend_days and rows["5TH_CALL"]["members"] == 12


def test_pool_slots_split_by_member_count(db):
    """docs/call_level_pool_and_balance_contract.md 1: a pool slot's demand is split across the
    pool's levels in proportion to each level's member count; unresolved slots are not counted."""
    from app.services.fairness_targets import split_pool_demand
    from app.services.rota_rules import save_phase_one_rules

    assert split_pool_demand({"3RD_CALL", "4TH_CALL"}, {"3RD_CALL": 30, "4TH_CALL": 10}) == {
        "3RD_CALL": 0.75, "4TH_CALL": 0.25}
    assert split_pool_demand({"3RD_CALL", "4TH_CALL"}, {}) == {"3RD_CALL": 0.5, "4TH_CALL": 0.5}
    assert split_pool_demand({"4TH_CALL"}, {}) == {"4TH_CALL": 1.0}
    assert split_pool_demand(set(), {"3RD_CALL": 3}) == {}

    _version, rules = get_phase_one_rules(db)
    rules.duty_rules_by_key["SCHELL_24HR"].allowed_call_levels = ["3RD_CALL", "4TH_CALL"]
    save_phase_one_rules(db, rules)
    period, _scope = monthly_setup(db, MONTH)
    unit = Unit(code="U1", name="Unit U1", campus="A")
    db.add(unit)
    db.flush()
    for level, count in (("3RD_CALL", 3), ("4TH_CALL", 1)):
        for n in range(count):
            person = Person(canonical_name=f"{level} {n}", call_level=level)
            db.add(person)
            db.flush()
            db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=date(2026, 5, 1),
                                 source="unit_board"))
    for day_number in range(1, 9):
        _slot(db, period, unit, date(2026, 5, day_number), None, "SCHELL_24HR")  # pool, unstamped
    for day_number in range(9, 13):
        _slot(db, period, unit, date(2026, 5, day_number), "4TH_CALL", "MAIN_4TH_24HR")
    _slot(db, period, unit, date(2026, 5, 13), None, "CART")  # no level: not counted
    db.commit()
    rows = {row["call_level"]: row for row in call_level_targets(db, MONTH)}
    assert set(rows) == {"3RD_CALL", "4TH_CALL"}
    assert rows["3RD_CALL"]["slots"] == 6 and rows["3RD_CALL"]["pool_slots"] == 6
    assert rows["3RD_CALL"]["target"] == 2.0
    assert rows["4TH_CALL"]["slots"] == 6 and rows["4TH_CALL"]["pool_slots"] == 2
    assert rows["4TH_CALL"]["target"] == 6.0
    spread = {row["call_level"]: row for row in call_level_spread(db, MONTH)}
    assert spread["3RD_CALL"]["target"] == 2.0 and spread["3RD_CALL"]["member_count"] == 3


def test_spread_shape_before_any_assignment(db):
    build_month(db, leave_people=0)
    spread = call_level_spread(db, MONTH)
    row = next(r for r in spread if r["call_level"] == "2ND_CALL")
    assert row["min"] == row["max"] == row["gap"] == 0 and row["ok"] is True
    assert row["allowed_gap"] == 1 and row["reasons"] == []
    member = row["members"][0]
    assert set(member) >= {"person_id", "name", "duties", "extra_duties", "diff_from_target"}
    assert member["diff_from_target"] == round(-row["slots"] / row["member_count"], 2)


def test_campus_term_only_for_tight_candidates():
    rules = RotaPhaseOneRules(duty_rules=[])
    base = dict(
        status="eligible",
        rest_gap_hours=None,
        average_assignments=3.0,
        slot_safety_status="clear",
        validation={"issues": [], "requires_override": False},
        rules=rules,
        target=4.0,
    )
    counts = {
        "total_assignments": 3, "target_is_weekend": 0, "same_day_type": 2, "weekday_assignments": 2,
        "weekend_assignments": 1, "total_24hr": 3, "weekend_24hr": 1, "same_group": 3, "same_campus": 0,
    }
    loose_home, _ = candidate_score(counts=counts, **base)
    loose_away, _ = candidate_score(counts={**counts, "same_campus": 3}, **base)
    assert loose_home == loose_away  # campus plays no part while not tight
    tight_home, _ = candidate_score(counts=counts, tight=True, **base)
    tight_away, _ = candidate_score(counts={**counts, "same_campus": 3}, tight=True, **base)
    assert tight_away > tight_home and tight_home - loose_home == TIGHT_WEIGHT
    # One duty further below target beats any soft burden difference.
    fewer, _ = candidate_score(counts={**counts, "total_assignments": 2, "same_day_type": 12}, **base)
    assert fewer < loose_home
    assert loose_home - fewer < 2 * EQUALITY_WEIGHT


def test_simulated_month_keeps_duties_equal_within_each_call_level(db):
    units, people, on_leave = build_month(db)
    result = run_safe_auto_fill(db, MONTH)
    total = db.query(DutySlot).count()
    # Some slots stay open on purpose: a unit hard blocked by staffing (leave + rest) is left
    # for the extra-duty layer. The spread must name those open slots as the reason.
    assert result["assigned_slots"] >= total * 0.9, result["summary"]
    spread = call_level_spread(db, MONTH)
    report = {}
    for row in spread:
        report[row["call_level"]] = (row["target"], row["min"], row["max"], row["gap"], row["ok"])
        full = [
            m["duties"]
            for m in row["members"]
            if m["available_days"] == DAYS and m["unit_open_slots"] == 0
        ]
        # Members available all month in fully staffed units are within the allowed gap.
        assert not full or max(full) - min(full) <= row["allowed_gap"], (row["call_level"], sorted(full))
        if not row["ok"]:
            # Only leave (or extra duties) may explain a wider gap, and the output says so.
            assert row["explained"] is True, row
            assert row["reasons"] and {r["code"] for r in row["reasons"]} <= {
                "limited_availability", "extra_duties", "open_slots"
            }, row["reasons"]
            for reason in row["reasons"]:
                if reason["code"] == "limited_availability":
                    member = next(m for m in row["members"] if m["person_id"] == reason["person_id"])
                    assert member["leave_days"] > 0 and "leave" in reason["message"]
        assert row["reason"] is None or row["reason"]
    print("spread per level (target, min, max, gap, ok):", report)
    # Nobody without leave is more than one duty from the level's target.
    for row in spread:
        for member in row["members"]:
            if member["available_days"] == DAYS and member["unit_open_slots"] == 0:
                assert abs(member["diff_from_target"]) < 1 + row["allowed_gap"], (row["call_level"], member)
    assert db.query(DutyAssignment).count() == result["assigned_slots"]
