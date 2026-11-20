"""Monthly guard loading uses canonical data once and refuses incomplete horizons."""

from datetime import date, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models import DutyAssignment, DutySlot, OtCalendar, Person, PersonPosting, Unit
from app.services.ot_assignment_context import load_assignment_guard
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_rules import RotaPhaseOneRules


@pytest.fixture
def environment():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        unit = Unit(code="UNIT_IV", name="Unit IV", minimum_free_people=0)
        person = Person(canonical_name="Anonymous OT senior", active_status="active", call_level="3RD_CALL")
        db.add_all([unit, person])
        db.flush()
        db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL",
                             starts_on=date(2026, 10, 1), source="unit_board"))
        db.commit()
        yield db, unit, person, RotaPhaseOneRules(duty_rules=[])
    engine.dispose()


def save_calendar(db, unit, *, omit=None, minimum=1, target=1):
    value = canonical(CalendarConfiguration.model_validate({"reserve_mode": "included", "weekly": [
        {"id": str(uuid4()), "unit_id": str(unit.id), "area_key": "main", "weekday": day,
         "effective_from": "2026-10-01", "bands": [{"key": "senior", "start_minute": 480,
            "end_minute": 960, "call_levels": ["3RD_CALL"], "minimum": minimum, "target": target}]}
        for day in ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN") if day != omit]}))
    db.add(OtCalendar(unit_id=unit.id, configuration=value, revision=revision(value)))
    db.commit()


def test_missing_calendar_and_missing_weekday_remain_unresolved(environment):
    db, unit, _, rules = environment
    assert load_assignment_guard(db, "2026-11", rules).check((), rules)["status"] == "not_evaluated"
    assert db.query(OtCalendar).count() == 0
    save_calendar(db, unit, omit="THU")
    context = load_assignment_guard(db, "2026-11", rules)
    assert not context.reviewed_complete
    assert any("2026-11-19" in reason for reason in context.unresolved)


def test_future_ot_covers_full_month_end_rest_and_saved_duties_are_overlayed(environment):
    db, unit, person, rules = environment
    save_calendar(db, unit)
    rules.rest_rules.minimum_gap_after_24hr_hours = 168
    slot = DutySlot(unit=unit, duty_date=date(2026, 11, 30), duty_type="TEST", slot_label="last-day",
                    starts_at=datetime(2026, 11, 30, 8), ends_at=datetime(2026, 12, 1, 8),
                    is_24hr=True, source="phase4_template")
    saved = DutyAssignment(person=person, duty_slot=slot, status="assigned")
    db.add(saved)
    db.commit()
    context = load_assignment_guard(db, "2026-11", rules)
    assert context.reviewed_complete and not context.unresolved
    assert max(row.starts_at.date() for row in context.requirements) == date(2026, 12, 7)
    assert not context.people[0].blocked
    assert context.check((), rules)["status"] == "feasible"
    result = context.check((saved,), rules)
    assert result["status"] == "infeasible"
    assert any("2026-12-07" in row["id"] and row["minimum_shortage"] == 1
               for row in result["capacity"]["requirements"])


def test_zero_ot_still_preserves_existing_minimum_reserve(environment):
    db, unit, person, rules = environment
    unit.minimum_free_people = 1
    save_calendar(db, unit, minimum=0, target=0)
    context = load_assignment_guard(db, "2026-11", rules)
    assignment = SimpleNamespace(person_id=person.id, status="assigned", duty_slot=SimpleNamespace(
        duty_date=date(2026, 11, 19), starts_at=datetime(2026, 11, 19, 8),
        ends_at=datetime(2026, 11, 19, 10), is_24hr=False, duty_type="TEST"))
    result = context.check((assignment,), rules)
    assert result["status"] == "infeasible"
    assert any(row["minimum_shortage"] for row in result["capacity"]["reserves"])


def test_loaded_guard_checks_multiple_plans_without_database_reads(environment):
    db, unit, _, rules = environment
    save_calendar(db, unit)
    context = load_assignment_guard(db, "2026-11", rules)
    def reject_sql(*args):
        pytest.fail("Candidate reservation checks must not query the database")
    event.listen(db.get_bind(), "before_cursor_execute", reject_sql)
    try:
        for _ in range(3):
            assert context.check((), rules)["status"] == "feasible"
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", reject_sql)


def test_abnormally_long_slot_never_silently_truncates_rest_or_future_demand(environment):
    db, unit, _, rules = environment
    save_calendar(db, unit)
    db.add(DutySlot(unit=unit, duty_date=date(2026, 11, 30), duty_type="TEST", slot_label="long",
        starts_at=datetime(2026, 11, 30, 8), ends_at=datetime(2026, 12, 20, 8),
        is_24hr=True, source="phase4_template"))
    db.commit()
    context = load_assignment_guard(db, "2026-11", rules)
    assert context.check((), rules)["status"] == "not_evaluated"
    assert any("horizon" in reason for reason in context.unresolved)


def test_malformed_saved_calendar_is_unresolved_without_initializing_or_rewriting_data(environment):
    db, unit, _, rules = environment
    db.add(OtCalendar(unit_id=unit.id, configuration={}, revision="0" * 64))
    db.commit()
    context = load_assignment_guard(db, "2026-11", rules)
    assert context.check((), rules)["status"] == "not_evaluated"
    assert db.query(OtCalendar).one().configuration == {}


def test_cached_guard_refuses_changed_duty_beyond_reviewed_horizon_without_sql(environment):
    db, unit, person, rules = environment
    save_calendar(db, unit)
    context = load_assignment_guard(db, "2026-11", rules)
    proposed = SimpleNamespace(person_id=person.id, status="assigned", duty_slot=SimpleNamespace(
        duty_date=date(2026, 11, 30), starts_at=datetime(2026, 11, 30, 8),
        ends_at=datetime(2026, 12, 5, 8), is_24hr=True, duty_type="TEST"))
    def reject_sql(*args):
        pytest.fail("Out-of-horizon proposals must be refused without candidate SQL")
    event.listen(db.get_bind(), "before_cursor_execute", reject_sql)
    try:
        result = context.check_affected((proposed,), (proposed,), rules)
        assert result["status"] == "not_evaluated"
        assert result["code"] == "ot_context_unresolved"
        assert "horizon" in result["reasons"][0]
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", reject_sql)


def test_unsaved_duty_extends_loaded_demand_through_actual_end_and_rest(environment):
    db, unit, person, rules = environment
    save_calendar(db, unit)
    rules.rest_rules.minimum_gap_after_24hr_hours = 168
    proposed = SimpleNamespace(person_id=person.id, status="assigned", duty_slot=SimpleNamespace(
        duty_date=date(2026, 11, 30), starts_at=datetime(2026, 11, 30, 8),
        ends_at=datetime(2026, 12, 5, 8), is_24hr=True, duty_type="TEST"))
    original = load_assignment_guard(db, "2026-11", rules)
    context = load_assignment_guard(db, "2026-11", rules, prospective_slots=(proposed.duty_slot,))
    assert context.horizon_end == datetime(2026, 12, 12, 8)
    assert context.horizon_end > original.horizon_end
    assert max(row.starts_at.date() for row in context.requirements) == date(2026, 12, 11)
    assert context.check_affected((proposed,), (proposed,), rules)["status"] == "infeasible"
    result = context.check((proposed,), rules)
    assert result["status"] == "infeasible"
    assert any("2026-12-11" in row["id"] and row["minimum_shortage"] == 1
               for row in result["capacity"]["requirements"])
    assert db.query(DutySlot).count() == 0


def test_oversized_unsaved_duty_is_unresolved_instead_of_truncated(environment):
    db, unit, _person, rules = environment
    save_calendar(db, unit)
    proposed = SimpleNamespace(duty_date=date(2026, 11, 30),
        starts_at=datetime(2026, 11, 30, 8), ends_at=datetime(2026, 12, 20, 8),
        is_24hr=True, duty_type="TEST")
    context = load_assignment_guard(db, "2026-11", rules, prospective_slots=(proposed,))
    assert context.check((), rules)["status"] == "not_evaluated"
    assert any("horizon" in reason for reason in context.unresolved)
    assert db.query(DutySlot).count() == 0


def test_reviewed_horizon_is_preserved_when_context_is_replaced(environment):
    from dataclasses import replace
    db, unit, _person, rules = environment
    save_calendar(db, unit)
    context = load_assignment_guard(db, "2026-11", rules)
    replacement = replace(context)
    assert replacement.horizon_start == context.horizon_start
    assert replacement.horizon_end == context.horizon_end
    with pytest.raises(ValueError, match="horizon"):
        replace(context, horizon_end=context.horizon_start)
    with pytest.raises(ValueError, match="horizon"):
        replace(context, horizon_start=None)


def test_assignment_adapter_loads_unsaved_horizon_but_rejects_cached_shorter_context(environment, monkeypatch):
    from app.core.config import settings
    from app.services.ot_assignment_validation import validate_ot_assignment
    db, unit, person, rules = environment
    save_calendar(db, unit)
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    proposed = SimpleNamespace(id=uuid4(), duty_date=date(2026, 11, 30),
        starts_at=datetime(2026, 11, 30, 8), ends_at=datetime(2026, 12, 5, 8),
        is_24hr=True, duty_type="TEST")
    cached = SimpleNamespace(ot_guard=load_assignment_guard(db, "2026-11", rules), nearby_assignments={})
    result = validate_ot_assignment(db, proposed, person, rules, replace_existing=False, context=cached)
    assert result["status"] == "not_evaluated"
    assert "horizon" in result["reasons"][0]
    fresh = validate_ot_assignment(db, proposed, person, rules, replace_existing=False)
    assert fresh["status"] == "infeasible"
    assert db.query(DutyAssignment).count() == 0


def test_reviewed_closed_window_cannot_certify_a_duty_outside_its_dates(environment):
    from app.services.ot_assignment_guard import OtAssignmentGuard
    _db, _unit, person, rules = environment
    context = OtAssignmentGuard((), (), reviewed_complete=True,
        horizon_start=datetime(2026, 11, 1), horizon_end=datetime(2026, 12, 1))
    proposed = SimpleNamespace(person_id=person.id, status="assigned", duty_slot=SimpleNamespace(
        duty_date=date(2026, 11, 30), starts_at=datetime(2026, 11, 30, 8),
        ends_at=datetime(2026, 12, 5, 8), is_24hr=True, duty_type="TEST"))
    assert context.check((), rules)["status"] == "feasible"
    assert context.check_affected((proposed,), (proposed,), rules)["status"] == "not_evaluated"
