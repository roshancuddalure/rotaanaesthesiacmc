"""Small exact fairness oracles using the actual optimizer and final checker."""

from collections import Counter
from datetime import date

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, LeaveRequest, Person
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db


@pytest.mark.parametrize("fixed_count", [0, 2])
def test_exact_equal_capacity_month_balances_total_including_fixed_duties(compute_db, fixed_count):
    db, _ = compute_db
    db.query(LeaveRequest).delete()
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == "1ST_CALL"))
    for day in [7, 10, 13, 16, 19, 22]:
        create_slot(db, source.unit, date(2026, 5, day))
    all_slots = list(db.scalars(select(DutySlot).where(DutySlot.call_level == "1ST_CALL").order_by(DutySlot.duty_date)))
    assert len(all_slots) == 8
    loaded = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    for slot in all_slots[:fixed_count]:
        db.add(DutyAssignment(duty_slot=slot, person=loaded, status="assigned"))
    db.commit()
    context = candidate_context(db, "2026-05")
    slots = {str(s.id): s for s in all_slots[fixed_count:]}
    result = solve_month(db, context, slots, seconds=30)
    assert result["uncovered"] == 0, result
    assert validate_plan(db, context, slots, result["choices"]) == []
    counts = Counter(result["choices"].values())
    counts[str(loaded.id)] += fixed_count
    # Independent integer optimum: 8 duties / 4 equally eligible members = 2 each.
    assert [counts[str(pid)] for pid in context.people] == [2, 2, 2, 2]
    equality = next(o for o in result["objectives"] if o["name"] == "call_level_equality")
    assert equality["proven"] is True
    assert db.query(DutyAssignment).count() == fixed_count


def test_approved_full_month_leave_does_not_force_work_to_equalize(compute_db):
    db, _ = compute_db
    leave = db.query(LeaveRequest).one()
    leave.starts_on = date(2026, 5, 1)
    leave.ends_on = date(2026, 5, 31)
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == "1ST_CALL"))
    for day in [7, 10, 13, 16]:
        create_slot(db, source.unit, date(2026, 5, day))
    db.commit()
    context = candidate_context(db, "2026-05")
    slots = {str(s.id): s for s in db.scalars(select(DutySlot).where(DutySlot.call_level == "1ST_CALL"))}
    result = solve_month(db, context, slots, seconds=30)
    assert result["uncovered"] == 0, result
    assert str(leave.person_id) not in result["choices"].values()
    assert sorted(Counter(result["choices"].values()).values()) == [2, 2, 2]
    assert validate_plan(db, context, slots, result["choices"]) == []
