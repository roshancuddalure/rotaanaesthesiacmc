"""N17 named shortage/safe-alternative corpus; no policy or input minima weakened."""

from copy import deepcopy
from datetime import date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, LeaveRequest, MonthlyGenerationScopeUnit, OtCalendar, Person, PersonPosting, Unit
from app.services.ot_assignment_validation import validate_ot_assignment
from app.services.ot_availability import canonical_availability
from app.services.ot_calendar import OtRequirement
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.ot_capacity import evaluate_capacity
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template
from tests.test_ot_assignment_integration import demand, environment as environment  # noqa: F401


DAY = date(2026, 11, 19)
KEY = "MAIN_3RD_24HR"


def relaxed_fixture(db):
    # Explicit synthetic non-OT staffing settings isolate the OT invariant. They
    # are not amended departmental policy or modified operational inputs.
    _, rules = get_phase_one_rules(db)
    rules.unit_staffing_rules.minimum_available_count = 0
    rules.unit_staffing_rules.hard_block_unavailable_percent = 100
    rules.unit_staffing_rules.warning_unavailable_percent = 100
    rules.unit_staffing_rules.small_unit_uses_absolute_minimum = False
    save_phase_one_rules(db, rules)


def generate(db, units):
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    existing = {row.unit_id for row in scope.units}
    for unit in units:
        if unit.id not in existing:
            db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    db.commit()
    return generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY], starts_on=DAY, ends_on=DAY))["slots"][0]


def test_all_units_busy_leave_unallocated_then_choose_only_safe_unit_without_reducing_minima(environment):
    db, unit, _, _ = environment
    relaxed_fixture(db)
    other = Unit(code="SCARCITY_OTHER", name="Scarcity second unit", minimum_free_people=0)
    people = [Person(canonical_name=f"Anonymous second-unit senior {i}", call_level="3RD_CALL", active_status="active") for i in range(4)]
    db.add_all([other, *people])
    db.flush()
    for person in people:
        db.add(PersonPosting(person=person, unit=other, posting_type="3RD_CALL", starts_on=date(2026, 10, 1), source="unit_board"))
    db.commit()
    demand(db, unit, minimum=4)
    demand(db, other, minimum=4)
    before = {r.unit_id: (r.revision, deepcopy(r.configuration)) for r in db.scalars(select(OtCalendar))}
    blocked = generate(db, [unit, other])
    assert blocked["unit_id"] is None and blocked["template_status"] == "unresolved"
    assert not blocked["is_forced_allocation"]
    assert {r.unit_id: (r.revision, r.configuration) for r in db.scalars(select(OtCalendar))} == before
    # A reviewed synthetic scenario with less demand in only the second unit:
    # the unchanged first unit must never be chosen as a forced safe alternative.
    demand(db, other, minimum=3)
    after = {r.unit_id: (r.revision, deepcopy(r.configuration)) for r in db.scalars(select(OtCalendar))}
    safe = generate(db, [unit, other])
    assert safe["unit_id"] == str(other.id) and safe["template_status"] == "ready"
    assert not safe["is_forced_allocation"]
    assert {r.unit_id: (r.revision, r.configuration) for r in db.scalars(select(OtCalendar))} == after
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize("minimum", [1, 5])
def test_no_eligible_senior_or_demand_above_roster_never_becomes_forced_safe(environment, minimum):
    db, unit, people, _ = environment
    relaxed_fixture(db)
    if minimum == 1:
        for person in people:
            person.call_level = "1ST_CALL"
        for posting in db.scalars(select(PersonPosting)):
            posting.posting_type = "1ST_CALL"
        db.commit()
    demand(db, unit, minimum=minimum)
    saved = db.scalar(select(OtCalendar)).revision
    row = generate(db, [unit])
    assert row["unit_id"] is None and row["template_status"] == "unresolved"
    assert not row["is_forced_allocation"]
    assert db.scalar(select(OtCalendar)).revision == saved
    assert db.query(DutyAssignment).count() == 0


def test_overlapping_areas_block_duty_but_adjacent_areas_allow_same_people_to_cover(environment):
    db, unit, _, _ = environment
    relaxed_fixture(db)
    demand(db, unit, minimum=2)
    calendar = db.scalar(select(OtCalendar))
    value = deepcopy(calendar.configuration)
    extra = []
    for row in value["weekly"]:
        second = deepcopy(row)
        second.update(id=str(uuid4()), area_key="second")
        extra.append(second)
    value["weekly"].extend(extra)
    calendar.configuration = canonical(CalendarConfiguration.model_validate(value))
    calendar.revision = revision(calendar.configuration)
    db.commit()
    blocked = generate(db, [unit])
    assert blocked["unit_id"] is None and not blocked["is_forced_allocation"]
    # Retain both minima of two; the sole changed input is the explicitly
    # reviewed interval arrangement, so people may cover consecutive roles.
    value = deepcopy(calendar.configuration)
    for row in value["weekly"]:
        row["bands"][0].update(start_minute=480 if row["area_key"] == "main" else 720,
                                 end_minute=720 if row["area_key"] == "main" else 960)
    calendar.configuration = canonical(CalendarConfiguration.model_validate(value))
    calendar.revision = revision(calendar.configuration)
    db.commit()
    before = calendar.revision
    safe = generate(db, [unit])
    assert safe["unit_id"] == str(unit.id) and safe["template_status"] == "ready"
    assert calendar.revision == before
    assert all(r["bands"][0]["minimum"] == 2 for r in calendar.configuration["weekly"])


def test_leap_day_closure_does_not_waive_next_month_rest_and_reviewed_closure_restores_feasibility(environment):
    db, unit, people, _ = environment
    relaxed_fixture(db)
    day = date(2028, 2, 29)
    period, _ = monthly_setup(db, "2028-02")
    target = DutySlot(rota_period=period, unit=unit, duty_date=day, duty_type=KEY, call_level="3RD_CALL",
        slot_label="Leap day senior", starts_at=datetime(2028, 2, 29, 8), ends_at=datetime(2028, 3, 1, 8),
        is_24hr=True, source="phase4_template")
    db.add(target)
    db.commit()
    demand(db, unit, minimum=4, closed_day=day)
    rules = get_phase_one_rules(db)[1]
    assert validate_ot_assignment(db, target, people[0], rules, replace_existing=False)["status"] == "infeasible"
    with pytest.raises(RotaAssignmentError) as failure:
        assign_person_to_slot(db, slot_id=target.id, person_id=people[0].id, override_reason="Reviewed manual reason")
    assert any(i["code"] == "ot_reservation_conflict" for i in failure.value.validation["issues"])
    assert db.query(DutyAssignment).count() == 0
    calendar = db.scalar(select(OtCalendar))
    value = deepcopy(calendar.configuration)
    value["exceptions"].append({**value["exceptions"][0], "id": str(uuid4()), "day": "2028-03-01"})
    calendar.configuration = canonical(CalendarConfiguration.model_validate(value))
    calendar.revision = revision(calendar.configuration)
    db.commit()
    before = calendar.revision
    assert validate_ot_assignment(db, target, people[0], rules, replace_existing=False)["status"] == "feasible"
    assert calendar.revision == before
    assert all(r["bands"][0]["minimum"] == 4 for r in calendar.configuration["weekly"])
    assert db.query(DutyAssignment).count() == 0
    assign_person_to_slot(db, slot_id=target.id, person_id=people[0].id)
    from app.services.extra_duty_verify import check_month
    assert check_month(db, "2028-02")["ok"]
    assert db.query(DutyAssignment).filter_by(duty_slot_id=target.id, person_id=people[0].id).count() == 1
    assert calendar.revision == before


def test_partial_leave_blocks_whole_ot_band_but_not_explicit_unaffected_half(environment):
    db, unit, people, _ = environment
    for person in people:
        db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="AM",
            starts_on=DAY, ends_on=DAY, status="approved"))
    db.commit()
    rules = get_phase_one_rules(db)[1]
    def report(start, end):
        need = OtRequirement(id=str(uuid4()), unit_id=unit.id, area_key="partial", band_key="senior",
            starts_at=datetime.combine(DAY, datetime.min.time())+timedelta(hours=start),
            ends_at=datetime.combine(DAY, datetime.min.time())+timedelta(hours=end),
            call_levels=("3RD_CALL",), minimum=4, target=4)
        context = canonical_availability(db, (need,), rules)
        return evaluate_capacity((need,), context["people"])
    blocked, safe = report(8, 16), report(12, 16)
    assert blocked["status"] == "infeasible" and blocked["mandatory_covered"] == 0
    assert safe["status"] == "feasible" and safe["mandatory_covered"] == 4
    assert blocked["mandatory_required"] == safe["mandatory_required"] == 4
