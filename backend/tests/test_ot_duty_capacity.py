"""OT witness choices are not individual duty eligibility decisions."""

from datetime import timedelta

import pytest
from sqlalchemy import event

from app.models import DutyAssignment, DutySlot, OtCalendar, RuleSetting, RuleVersion
from app.services.ot_duty_capacity import day_duty_capacity
from tests.test_ot_assignment_integration import environment as environment, demand, slot  # noqa: F401
from tests.test_ot_calendar_api import api as api, url  # noqa: F401


def test_each_duty_has_four_individually_clear_candidates_but_combination_is_not_certified(environment):
    db, unit, _, target = environment
    slot(db, unit, target.duty_date)
    def refuse(*args):
        pytest.fail("Duty eligibility read tried to flush")
    event.listen(db, "before_flush", refuse)
    try:
        result = day_duty_capacity(db, unit.id, target.duty_date)
    finally:
        event.remove(db, "before_flush", refuse)
    assert result["status"] == "evaluated" and len(result["duties"]) == 2
    assert all(d["eligible_count"] == 4 for d in result["duties"])
    assert "not simultaneous" in result["scope_note"]
    assert db.query(DutyAssignment).count() == 0


def test_mandatory_ot_and_unknown_demand_cannot_produce_clear_duty_counts(environment):
    db, unit, _, target = environment
    demand(db, unit, minimum=4)
    result = day_duty_capacity(db, unit.id, target.duty_date)
    row = result["duties"][0]
    assert row["eligible_count"] == 0
    assert any(i["code"] == "ot_reservation_conflict" for p in row["blocked_people"] for i in p["issues"])
    db.query(OtCalendar).delete()
    db.commit()
    unknown = day_duty_capacity(db, unit.id, target.duty_date)["duties"][0]
    assert unknown["eligible_count"] is None and unknown["status"] == "not_evaluated"
    assert any(i["code"] == "ot_capacity_unresolved" for p in unknown["blocked_people"] for i in p["issues"])


def test_protected_filled_no_saved_and_pending_stress_are_explicit(environment):
    db, unit, people, target = environment
    assert day_duty_capacity(db, unit.id, target.duty_date, include_pending=True)["status"] == "not_evaluated"
    assert day_duty_capacity(db, unit.id, target.duty_date+timedelta(days=1))["status"] == "no_saved_duties"
    db.add(DutyAssignment(person=people[0], duty_slot=target, status="assigned"))
    db.commit()
    assert day_duty_capacity(db, unit.id, target.duty_date)["duties"][0]["status"] == "not_open"
    target.rota_period.status = "published"
    db.commit()
    assert day_duty_capacity(db, unit.id, target.duty_date)["duties"][0]["status"] == "protected"


def test_missing_rules_read_does_not_initialize_defaults(environment):
    db, unit, _, target = environment
    db.query(RuleSetting).delete()
    db.query(RuleVersion).delete()
    db.commit()
    result = day_duty_capacity(db, unit.id, target.duty_date)
    assert result["status"] == "not_evaluated"
    assert db.query(RuleSetting).count() == 0
    assert db.query(DutySlot).count() == 1


def test_day_duty_endpoint_retains_admin_and_date_validation(api):
    client, _, unit_id, state, _ = api
    assert client.get(url(unit_id)+"/duty-capacity?day=invalid").status_code == 422
    response = client.get(url(unit_id)+"/duty-capacity?day=2026-11-19")
    assert response.status_code == 200 and response.json()["status"] == "not_evaluated"
    state["user"].role = "member"
    assert client.get(url(unit_id)+"/duty-capacity?day=2026-11-19").status_code == 403
