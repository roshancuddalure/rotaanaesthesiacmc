"""Monthly capacity counts reconcile by identity and interval, never aggregate subtraction."""

from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.models import DutyAssignment, LeaveRequest, OtCalendar
from app.services import ot_month_capacity as service
from tests.test_ot_assignment_integration import environment as environment, demand  # noqa: F401
from tests.test_ot_calendar_api import api as api, url  # noqa: F401


def test_month_reuses_one_availability_load_and_counts_leave_rest_union(environment, monkeypatch):
    db, unit, people, target = environment
    db.add(DutyAssignment(person=people[0], duty_slot=target, status="assigned"))
    db.add(LeaveRequest(person=people[0], leave_type="ANNUAL_LEAVE", leave_slot="PM",
        starts_on=target.duty_date, ends_on=target.duty_date, status="approved", notes="private reason"))
    db.commit()
    calls = []
    original = service.canonical_availability
    def counted(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)
    monkeypatch.setattr(service, "canonical_availability", counted)
    result = service.month_capacity(db, unit.id, "2026-11")
    assert len(calls) == 1 and len(result["days"]) == 30
    assert result["people"][str(people[0].id)] == people[0].canonical_name
    row = next(r for r in result["days"] if r["day"] == "2026-11-19")
    assert row["status"] == "feasible"
    interval = next(r for r in row["intervals"] if r["starts_at"] == "2026-11-19T12:00:00")
    assert len(interval["posted_person_ids"]) == 4
    assert interval["unavailable_person_ids"] == [str(people[0].id)]
    assert len(interval["available_person_ids"]) == 3
    assert len(interval["reserved_person_ids"]) == 3 and interval["unreserved_person_ids"] == []
    assert interval["ot_required"] == 3
    assert "private reason" not in str(result)


def test_unknown_month_keeps_counts_but_never_invents_zero_reservations(environment):
    db, unit, _, _ = environment
    db.query(OtCalendar).delete()
    db.commit()
    result = service.month_capacity(db, unit.id, "2026-11")
    assert all(r["status"] == "not_evaluated" for r in result["days"])
    assert all(i["reserved_person_ids"] is None and i["ot_required"] is None
               for r in result["days"] for i in r["intervals"])
    assert len(result["days"][0]["intervals"][0]["posted_person_ids"]) == 4


def test_pending_leave_stress_is_separate_and_reader_never_writes(environment):
    db, unit, people, _ = environment
    db.add(LeaveRequest(person=people[0], leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
        starts_on=date(2026, 11, 19), ends_on=date(2026, 11, 19), status="requested"))
    db.commit()
    def refuse(*args):
        pytest.fail("Monthly view tried to write")
    event.listen(db, "before_flush", refuse)
    try:
        regular = service.month_capacity(db, unit.id, "2026-11")
        stress = service.month_capacity(db, unit.id, "2026-11", include_pending=True)
    finally:
        event.remove(db, "before_flush", refuse)
    def find(result):
        return next(r for r in result["days"] if r["day"] == "2026-11-19")
    assert len(find(regular)["intervals"][0]["available_person_ids"]) == 4
    assert len(find(stress)["intervals"][0]["available_person_ids"]) == 3
    assert not regular["pending_stress"] and stress["pending_stress"]


def test_month_endpoint_preserves_admin_gate_and_reports_bad_month(api):
    client, _, unit_id, state, _ = api
    assert client.get(url(unit_id)+"/month-capacity?month=invalid").status_code == 422
    assert client.get(url(uuid4())+"/month-capacity?month=2026-11").status_code == 404
    state["user"].role = "member"
    assert client.get(url(unit_id)+"/month-capacity?month=2026-11").status_code == 403


def test_timeout_never_labels_every_available_person_unreserved(environment, monkeypatch):
    db, unit, _, _ = environment
    monkeypatch.setattr(service, "evaluate_capacity", lambda *args, **kwargs: {
        "status": "time_limited", "solver_status": "UNKNOWN", "requirements": [], "reserves": []})
    result = service.month_capacity(db, unit.id, "2026-11")
    assert all(r["status"] == "time_limited" for r in result["days"])
    assert all(i["reserved_person_ids"] is None and i["unreserved_person_ids"] is None
               for r in result["days"] for i in r["intervals"])


def test_reviewed_closure_has_zero_reservations_and_still_counts_posted_people(environment):
    db, unit, _, _ = environment
    demand(db, unit, closed_day=date(2026, 11, 19))
    result = service.month_capacity(db, unit.id, "2026-11")
    row = next(r for r in result["days"] if r["day"] == "2026-11-19")
    assert row["status"] == "closed" and row["requirements"] == []
    assert all(i["ot_required"] == 0 and i["reserved_person_ids"] == []
               and len(i["unreserved_person_ids"]) == 4 for i in row["intervals"])
