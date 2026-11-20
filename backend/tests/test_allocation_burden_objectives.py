"""Competing category burdens with equal total loads and a contrary preference."""

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, LeaveRequest, Person
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_rules import DutyRule, get_phase_one_rules
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db


@pytest.mark.parametrize("category", ["weekend", "night", "holiday", "unconfigured_holiday"])
def test_category_burden_precedes_late_preference_at_equal_total_load(compute_db, category):
    db, _ = compute_db
    unit = db.scalar(select(DutySlot)).unit
    db.query(LeaveRequest).delete()
    db.query(DutySlot).delete()
    people = {person.canonical_name: person for person in db.scalars(select(Person))}
    first, second = people["Safe Member"], people["Spare One"]
    for name in ("Spare Two", "Blocked Member"):
        people[name].active_status = "inactive"
    _, rules = get_phase_one_rules(db)
    rules.duty_rules.extend([
        DutyRule(
            key="AUDIT_DAY", label="Audit day", group="audit", duration_hours=8,
            start_time="08:00", end_time="16:00", allowed_call_levels=["1ST_CALL"],
        ),
        DutyRule(
            key="AUDIT_NIGHT", label="Audit night", group="audit", duration_hours=8,
            start_time="18:00", end_time="02:00", allowed_call_levels=["1ST_CALL"],
        ),
    ])

    def slot(day, night=False):
        row = create_slot(db, unit, date(2026, 5, day))
        if category != "weekend":
            row.duty_type = "AUDIT_NIGHT" if night else "AUDIT_DAY"
            row.is_24hr = False
            row.starts_at = datetime(2026, 5, day, 18 if night else 8)
            row.ends_at = row.starts_at + timedelta(hours=8)
        return row

    # Both people have one fixed duty. Only the tested category differs.
    earlier = slot(2 if category == "weekend" else 5, night=category == "night")
    later = slot(5 if category == "weekend" else 8)
    target = slot(16 if category == "weekend" else 20, night=category == "night")
    db.add_all([
        DutyAssignment(duty_slot=earlier, person=first, status="assigned"),
        DutyAssignment(duty_slot=later, person=second, status="assigned"),
    ])
    db.commit()
    context = candidate_context(db, "2026-05", rules=rules)
    slots = {str(target.id): target}
    holidays = ["2026-05-05", "2026-05-20"] if category == "holiday" else []
    result = solve_month(
        db, context, slots, seconds=5, holiday_dates=holidays,
        preferences={f"{target.id}:{first.id}": -1_000_000},
    )
    assert len(result["choices"]) == 1
    assert not validate_plan(db, context, slots, result["choices"])
    if category != "unconfigured_holiday":
        # First has the existing category duty; second has equal total load but
        # no category duty. Category equality outranks the contrary preference.
        assert result["choices"][str(target.id)] == str(second.id)
    else:
        assert next(
            item["value"] for item in result["objectives"]
            if item["name"] == "holiday_burden"
        ) == 0
        assert result["holiday_dates"] == []
    db.expire_all()
    saved = list(db.scalars(select(DutyAssignment)))
    assert len(saved) == 2
    assert {row.person_id for row in saved} == {first.id, second.id}
    assert all(row.status == "assigned" for row in saved)
