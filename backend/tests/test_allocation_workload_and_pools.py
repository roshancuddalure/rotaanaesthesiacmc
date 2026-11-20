"""Independent worked outcomes for opportunity costs and dated mixed pools."""

from collections import Counter
from datetime import date, datetime, timedelta
from fractions import Fraction

import pytest
from sqlalchemy import select

from app.models import (
    DutyAssignment, DutySlot, LeaveRequest, MemberCallLevelChange, Person, PersonPosting,
)
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan, without_slots
from app.services.rota_rules import DutyRule, get_phase_one_rules
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db


def day_slot(db, unit, day, key, level):
    row = create_slot(db, unit, date(2026, 5, day), call_level=level, duty_type=key)
    row.is_24hr = False
    row.starts_at = datetime(2026, 5, day, 8)
    row.ends_at = row.starts_at + timedelta(hours=8)
    return row


def day_rule(key, levels):
    return DutyRule(
        key=key, label=key, group="audit", duration_hours=8,
        start_time="08:00", end_time="16:00", allowed_call_levels=levels,
    )


def clear_fixture(db):
    unit = db.scalar(select(DutySlot)).unit
    db.query(LeaveRequest).delete()
    db.query(DutySlot).delete()
    return unit, {person.canonical_name: person for person in db.scalars(select(Person))}


@pytest.mark.parametrize("reserve_active", [False, True])
def test_workload_normalization_beats_contrary_preferences_after_equality(compute_db, reserve_active):
    db, _ = compute_db
    unit, people = clear_fixture(db)
    flexible, early, late = [people[name] for name in ("Safe Member", "Spare One", "Spare Two")]
    reserve = people["Blocked Member"]
    reserve.active_status = "active" if reserve_active else "inactive"
    _, rules = get_phase_one_rules(db)
    rules.duty_rules.append(day_rule("AUDIT_DAY", ["1ST_CALL"]))
    first = day_slot(db, unit, 5, "AUDIT_DAY", "1ST_CALL")
    second = day_slot(db, unit, 8, "AUDIT_DAY", "1ST_CALL")
    db.add_all([
        LeaveRequest(person=early, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                     starts_on=date(2026, 5, 8), ends_on=date(2026, 5, 8), status="approved"),
        LeaveRequest(person=late, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                     starts_on=date(2026, 5, 5), ends_on=date(2026, 5, 5), status="approved"),
    ])
    db.commit()
    slots = {str(row.id): row for row in (first, second)}
    context = candidate_context(db, "2026-05", rules=rules)
    result = solve_month(
        db, context, slots, seconds=5,
        preferences={f"{first.id}:{early.id}": -1_000_000,
                     f"{second.id}:{late.id}": -1_000_000},
    )
    if not reserve_active:
        # One absence in the three-person roster reaches the existing staffing
        # review threshold. A numeric optimum cannot grant an override.
        assert result["choices"] == {}
        assert result["uncovered"] == 2
        for rejected in result["rejected"].values():
            assert any(issue["code"] == "unit_safety_review"
                       for person in rejected for issue in person["issues"])
        assert db.query(DutyAssignment).count() == 0
        return
    # Independently enumerate nine compatible identity sequences. Equal load
    # prefers two distinct people; each flexible person costs50 versus100 for
    # a single-opportunity person. Early+late costs200 despite preferences.
    # Four eligible staff keep the one approved absence below the existing
    # review threshold; the earlier three-person fixture correctly needed review.
    plans = [
        (a, b) for a in ("flexible", "reserve", "early")
        for b in ("flexible", "reserve", "late")
    ]
    opportunities = {"flexible": 2, "reserve": 2, "early": 1, "late": 1}
    losses = {}
    for plan in plans:
        counts = Counter(plan)
        equality = sum((Fraction(counts[name]) - Fraction(1, 2)) ** 2 for name in opportunities)
        workload = sum(Fraction(counts[name] ** 2 * 100, opportunities[name]) for name in opportunities)
        losses[plan] = (equality, workload)
    best = min(losses.values())
    expected = {plan for plan, loss in losses.items() if loss == best}
    labels = {str(flexible.id): "flexible", str(reserve.id): "reserve",
              str(early.id): "early", str(late.id): "late"}
    actual = tuple(labels[result["choices"][str(row.id)]] for row in (first, second))
    assert expected == {("flexible", "reserve"), ("reserve", "flexible")}
    assert actual in expected
    objectives = {item["name"]: item["value"] for item in result["objectives"]}
    assert objectives["workload"] == 100
    assert objectives["weekend_burden"] == objectives["night_burden"] == 0
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize("reverse", [False, True])
def test_dated_pool_uses_canonical_monthly_targets_without_eligibility_leak(compute_db, reverse):
    db, _ = compute_db
    unit, people = clear_fixture(db)
    promoted, colleague = people["Safe Member"], people["Spare One"]
    for person in people.values():
        person.call_level = "3RD_CALL"
        for posting in person.postings:
            posting.posting_type = "3RD_CALL"
    senior = Person(canonical_name="Senior A", call_level="4TH_CALL")
    reserve = Person(canonical_name="Senior B", call_level="4TH_CALL")
    db.add_all([senior, reserve])
    db.add(MemberCallLevelChange(
        person=promoted, call_level="4TH_CALL", effective_from=date(2026, 5, 16)
    ))
    for person in (senior, reserve):
        db.add(PersonPosting(
            person=person, unit=unit, posting_type="4TH_CALL",
            starts_on=date(2026, 5, 1), source="unit_board",
        ))
    _, rules = get_phase_one_rules(db)
    rules.duty_rules.extend([
        day_rule("AUDIT_POOL", ["3RD_CALL", "4TH_CALL"]),
        day_rule("AUDIT_THIRD", ["3RD_CALL"]),
        day_rule("AUDIT_FOURTH", ["4TH_CALL"]),
    ])
    early_pool = day_slot(db, unit, 5, "AUDIT_POOL", None)
    early_senior = day_slot(db, unit, 6, "AUDIT_FOURTH", "4TH_CALL")
    third = day_slot(db, unit, 8, "AUDIT_THIRD", "3RD_CALL")
    late_pool = day_slot(db, unit, 20, "AUDIT_POOL", None)
    db.commit()
    rows = [early_pool, early_senior, third, late_pool]
    if reverse:
        rows.reverse()
    slots = {str(row.id): row for row in rows}
    context = candidate_context(db, "2026-05", rules=rules)
    # An impossible senior preference before promotion must not become a candidate.
    preferences = {f"{early_senior.id}:{promoted.id}": -2_000_000}
    expected = {str(early_pool.id): str(promoted.id), str(early_senior.id): str(senior.id),
                str(third.id): str(colleague.id), str(late_pool.id): str(promoted.id)}
    preferences.update({f"{sid}:{person}": -1_000_000 for sid, person in expected.items()})
    result = solve_month(db, context, slots, mode="preferences", seconds=5, preferences=preferences)
    assert result["choices"] == expected
    assert str(promoted.id) not in result["candidates"][str(early_senior.id)]
    assert result["candidates"][str(early_pool.id)][str(promoted.id)]["call_level"] == "3RD_CALL"
    assert result["candidates"][str(late_pool.id)][str(promoted.id)]["call_level"] == "4TH_CALL"
    targets = result["objective_basis"]["target_by_call_level"]
    # Four monthly third-call and two fourth-call members: each pooled slot
    # contributes2/3 and1/3, plus one strict duty at each level.
    assert targets == pytest.approx({"3RD_CALL": Fraction(7, 12), "4TH_CALL": Fraction(5, 6)})
    cost = sum(round(100 * (2*k - 1 - 2*target))
               for count, target in [(2, Fraction(7, 12)), (1, Fraction(7, 12)), (1, Fraction(5, 6))]
               for k in range(1, count+1))
    assert cost == 82
    assert next(item["value"] for item in result["objectives"]
                if item["name"] == "call_level_equality") == cost
    assert context.fairness_member_levels[promoted.id] == "3RD_CALL"
    assert without_slots(context, []).fairness_member_levels == context.fairness_member_levels
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0
