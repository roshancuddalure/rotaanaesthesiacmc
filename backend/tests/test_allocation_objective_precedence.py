"""Adversarial, real-solver examples of the approved fairness-first priorities.

Two compatible duties can be shared or concentrated. Large preference costs
make the competing outcome explicit, without relying on tie-breaking identities.
"""

from collections import Counter
from datetime import date

import pytest
from sqlalchemy import select

from app.models import (
    DutyAssignment, DutySlot, LeaveRequest, MemberCallLevelChange, Person, PersonPosting,
)
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan, without_slots
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db


def competing_fixture(db):
    unit = db.scalar(select(DutySlot)).unit
    db.query(LeaveRequest).delete()
    db.query(DutySlot).delete()
    # These dates are four days apart, so concentration needs no rest exception.
    slots = {
        str(slot.id): slot
        for day in (5, 9)
        for slot in [create_slot(db, unit, date(2026, 5, day))]
    }
    favored = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    db.commit()
    return slots, favored


@pytest.mark.parametrize(
    ("mode", "expected_largest_load"), [("balanced", 1), ("preferences", 1)]
)
def test_preferences_cannot_override_fairness_in_any_mode(
    compute_db, mode, expected_largest_load
):
    db, _ = compute_db
    slots, favored = competing_fixture(db)
    context = candidate_context(db, "2026-05")
    preferences = {f"{sid}:{favored.id}": -1_000_000 for sid in slots}
    result = solve_month(
        db, context, slots, mode=mode, preferences=preferences, seconds=5
    )
    assert len(result["choices"]) == 2
    assert max(Counter(result["choices"].values()).values()) == expected_largest_load
    assert result['objective_basis']['preferences_before_equality'] is False
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0


def test_approved_repair_equality_precedes_stability_without_writing(compute_db):
    db, _ = compute_db
    slots, favored = competing_fixture(db)
    originals = {sid: str(favored.id) for sid in slots}
    for slot in slots.values():
        db.add(DutyAssignment(duty_slot=slot, person=favored, status="assigned"))
    db.commit()
    context = without_slots(candidate_context(db, "2026-05"), slots)
    # Both equality and these positive preference costs favor changing a person.
    result = solve_month(
        db, context, slots, mode="repair", originals=originals,
        preferences={f"{sid}:{favored.id}": 1_000_000 for sid in slots}, seconds=5,
    )
    assert max(Counter(result["choices"].values()).values()) == 1
    names = [row['name'] for row in result['objectives']]
    assert names.index('worst_call_gap') < names.index('changes')
    assert not validate_plan(db, context, slots, result["choices"])
    db.expire_all()
    saved = list(db.scalars(select(DutyAssignment)))
    assert len(saved) == 2
    assert all(row.status == "assigned" and row.person_id == favored.id for row in saved)


def test_coverage_precedes_even_large_unfavorable_preferences(compute_db):
    db, _ = compute_db
    slots, _ = competing_fixture(db)
    context = candidate_context(db, "2026-05")
    people = list(db.scalars(select(Person)))
    result = solve_month(
        db, context, slots, mode="preferences", seconds=5,
        preferences={f"{sid}:{person.id}": 1_000_000 for sid in slots for person in people},
    )
    assert len(result["choices"]) == 2
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0


def test_preference_cannot_override_approved_leave(compute_db):
    db, _ = compute_db
    slots, favored = competing_fixture(db)
    db.add(LeaveRequest(
        person=favored, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
        starts_on=date(2026, 5, 5), ends_on=date(2026, 5, 9), status="approved",
    ))
    db.commit()
    context = candidate_context(db, "2026-05")
    result = solve_month(
        db, context, slots, mode="preferences", seconds=5,
        preferences={f"{sid}:{favored.id}": -1_000_000 for sid in slots},
    )
    assert len(result["choices"]) == 2
    assert str(favored.id) not in result["choices"].values()
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0


def test_promotion_does_not_make_monthly_equality_depend_on_slot_iteration_order(compute_db):
    db, _ = compute_db
    slots, favored = competing_fixture(db)
    second = list(slots.values())[1]
    second.duty_date = date(2026, 5, 20)
    second.starts_at = second.starts_at.replace(day=20)
    second.ends_at = second.ends_at.replace(day=21)
    second.duty_type = "MAIN_2ND_24HR"
    second.call_level = "2ND_CALL"
    unit = second.unit
    colleague = Person(canonical_name="Stable second call", call_level="2ND_CALL")
    db.add_all([
        colleague,
        MemberCallLevelChange(
            person=favored, call_level="2ND_CALL", effective_from=date(2026, 5, 16)
        ),
        PersonPosting(
            person=colleague, unit=unit, posting_type="2ND_CALL",
            starts_on=date(2026, 5, 1), source="unit_board",
        ),
    ])
    db.commit()
    results = []
    for ordered in (slots, dict(reversed(list(slots.items())))):
        context = candidate_context(db, "2026-05")
        result = solve_month(
            db, context, ordered, mode="preferences", seconds=5,
            preferences={f"{sid}:{favored.id}": -1_000_000 for sid in slots},
        )
        assert max(Counter(result['choices'].values()).values()) == 1
        assert len(result["choices"]) == 2
        assert not validate_plan(db, context, ordered, result["choices"])
        results.append(next(
            item["value"] for item in result["objectives"]
            if item["name"] == "call_level_equality"
        ))
    # Include all four first-call members, including the three with zero duties.
    # The second-call member meets their target exactly. Targets are scaled1000.
    expected = (1000 - 250)**2 + 3 * 250**2
    assert results == [expected, expected]
    assert db.query(DutyAssignment).count() == 0
