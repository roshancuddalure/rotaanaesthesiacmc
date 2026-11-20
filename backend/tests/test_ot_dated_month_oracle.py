"""Dated promotion and AM leave retain their actual whole-month consequences."""

from collections import Counter
from datetime import date, datetime

import pytest

from app.models import DutyAssignment, LeaveRequest, MemberCallLevelChange, OtCalendar, PersonPosting, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.ot_capacity import eligible
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from tests.test_ot_assignment_integration import environment as environment, demand, slot  # noqa: F401
from tests.test_ot_whole_month_oracle import independent_optima


@pytest.mark.parametrize("dated_change,partial_leave", [("promotion", False), ("promotion", True), ("posting", True)])
def test_dated_month_matches_independent_call_pool_and_partial_leave_oracle(environment, dated_change, partial_leave, record_property):
    db, unit, people, existing_slot = environment
    rows = [existing_slot if day == 19 else slot(db, unit, date(2026, 11, day)) for day in range(1, 31)]
    if dated_change == "promotion":
        db.add(MemberCallLevelChange(person=people[0], call_level="4TH_CALL", effective_from=date(2026, 11, 16)))
    else:
        posting = db.query(PersonPosting).filter_by(person_id=people[0].id, unit_id=unit.id).one()
        posting.ends_on = date(2026, 11, 15)
        other = Unit(code="UNIT_V", name="Synthetic destination", minimum_free_people=0)
        db.add(other)
        db.flush()
        db.add(PersonPosting(person=people[0], unit=other, posting_type="3RD_CALL",
            starts_on=date(2026, 11, 16), source="unit_board"))
        # An active destination is part of the shared reviewed context even
        # though this experiment generates no duties there. Unknown is not zero.
        demand(db, other, minimum=0)
    leave = {10: {1}} if partial_leave else {}
    if partial_leave:
        db.add(LeaveRequest(person=people[1], starts_on=date(2026, 11, 10), ends_on=date(2026, 11, 10),
            status="approved", leave_type="CASUAL_LEAVE", leave_slot="AM"))
    # Independently staffed morning/afternoon bands make the noon boundary
    # explicit. AM leave cannot erase this person's afternoon availability.
    calendar = db.query(OtCalendar).filter_by(unit_id=unit.id).one()
    configuration = dict(calendar.configuration)
    configuration["weekly"] = [{**row, "bands": [
        {**row["bands"][0], "key": "morning", "start_minute": 480, "end_minute": 720},
        {**row["bands"][0], "key": "afternoon", "start_minute": 720, "end_minute": 960},
    ]} for row in configuration["weekly"]]
    configuration = canonical(CalendarConfiguration.model_validate(configuration))
    calendar.configuration, calendar.revision = configuration, revision(configuration)
    db.commit()
    # Explicit fixture truth, independent of canonical membership/window logic:
    # Person0 is third-call in this unit through Nov15, then either fourth-call
    # or posted elsewhere. These roles require third-call in the original unit.
    pools = {day: set(range(4)) if day < 16 else {1, 2, 3} for day in range(1, 32)}
    expected_coverage, expected_square_load = independent_optima(leave, None, duty_people=pools, ot_people=pools)
    context = candidate_context(db, "2026-11")
    guard = context.ot_guard
    assert guard.reviewed_complete and not guard.unresolved
    promoted = next(person for person in guard.people if person.id == people[0].id)
    afternoon_member = next(person for person in guard.people if person.id == people[1].id)
    early = next(need for need in guard.requirements if need.starts_at == datetime(2026, 11, 15, 8))
    later = next(need for need in guard.requirements if need.starts_at == datetime(2026, 11, 16, 8))
    assert eligible(promoted, early) and not eligible(promoted, later)
    morning = next(need for need in guard.requirements if need.starts_at == datetime(2026, 11, 10, 8))
    afternoon = next(need for need in guard.requirements if need.starts_at == datetime(2026, 11, 10, 12))
    assert eligible(afternoon_member, morning) is (not partial_leave)
    assert eligible(afternoon_member, afternoon)
    slots = {str(row.id): row for row in rows}
    result = solve_month(db, context, slots, seconds=45)
    choices = result["choices"]
    assert len(choices) == expected_coverage, result
    assert validate_plan(db, context, slots, choices) == []
    assert result["ot_reservations"]["status"] == "modeled"
    counts = Counter(choices.values())
    square_load = sum(counts[str(person.id)]**2 for person in people)
    assert square_load == expected_square_load, result
    indices = {str(person.id): i for i, person in enumerate(people)}
    chosen_days = {slots[sid].duty_date.day: indices[person] for sid, person in choices.items()}
    previous = None
    for day in range(1, 32):
        current = chosen_days.get(day)
        assert current is None or (current in pools[day] and current != previous and current not in leave.get(day, set()))
        blocked = {p for p in (previous, current) if p is not None} | leave.get(day, set())
        assert len(pools[day] - blocked) >= 3
        previous = current
    for key, value in {"oracle_coverage": expected_coverage, "actual_coverage": len(choices),
                       "oracle_square_load": expected_square_load, "actual_square_load": square_load,
                       "member_loads": str([counts[str(p.id)] for p in people]),
                       "optimizer_status": result["status"], "cuts": result["cuts"],
                       "elapsed_ms": result["elapsed_ms"], "objective_receipts": str(result["objectives"])}.items():
        record_property(key, value)
    assert db.query(DutyAssignment).count() == 0
