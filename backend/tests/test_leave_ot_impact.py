"""Prospective leave effects use real canonical calendars/people, without writes."""

from dataclasses import FrozenInstanceError
from datetime import date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from app.models import DutyAssignment, DutySlot, LeaveRequest, OtCalendar, Person, PersonPosting, Unit
from app.core.config import settings
from app.services.leave_ot_impact import compare_month, review_impacts
from app.services.leave_projection import LeaveProjection
from app.services.ot_availability import canonical_availability
from app.services.ot_capacity import evaluate_capacity
from tests.test_ot_assignment_context import environment as environment, save_calendar
from tests.test_ot_availability import requirement
from tests.test_leave_approval import environment as approval_environment, leave, preview, apply


@pytest.fixture
def api_environment():
    yield from approval_environment.__wrapped__()


def proposal(person, *, identity=None, slot="FULL_DAY", status="approved", day=date(2026,11,19)):
    return LeaveProjection(identity or uuid4(), person.id, day, day, slot, status)


def test_approval_creates_visible_ot_shortage_without_writing_leave_or_duties(environment):
    db, unit, person, rules = environment
    save_calendar(db, unit)
    # read_phase_one_rules needs saved configuration, not an injected rule object.
    from app.services.rota_rules import get_phase_one_rules
    get_phase_one_rules(db)
    db.commit()
    row = LeaveRequest(person=person, starts_on=date(2026,11,19), ends_on=date(2026,11,19),
                       leave_slot="FULL_DAY", status="requested", leave_type="CASUAL_LEAVE", notes="PRIVATE")
    db.add(row)
    db.commit()
    before = tuple(db.execute(select(LeaveRequest.__table__)).mappings())
    statements = []
    def observe(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lstrip().split(None,1)[0].upper())
    event.listen(db.get_bind(), "before_cursor_execute", observe)
    try:
        report = compare_month(db, "2026-11", [proposal(person, identity=row.id)])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", observe)
    assert report["before"]["status"] == "feasible"
    assert report["after"]["status"] == "infeasible"
    assert report["after"]["mandatory_required"] - report["after"]["mandatory_covered"] == 1
    assert report["changed"] is True and report["assignments_changed"] is False
    assert tuple(db.execute(select(LeaveRequest.__table__)).mappings()) == before
    assert not {"INSERT", "UPDATE", "DELETE"}.intersection(statements)
    assert "PRIVATE" not in str(report)
    assert row.status == "requested" and not db.dirty and not db.new


def test_edit_replaces_only_selected_record_and_can_move_it_out_of_scope(environment):
    db, unit, person, rules = environment
    row = LeaveRequest(person=person, starts_on=date(2026,11,19), ends_on=date(2026,11,19),
                       leave_slot="FULL_DAY", status="approved", leave_type="CASUAL_LEAVE")
    other = Person(canonical_name="Another canonical member", call_level="3RD_CALL", active_status="active")
    db.add_all([row, other])
    db.flush()
    db.add_all([row, PersonPosting(person=other, unit=unit, posting_type="3RD_CALL", starts_on=date(2026,11,1)),
                LeaveRequest(person=other, starts_on=date(2026,11,19), ends_on=date(2026,11,19),
                             leave_slot="PM", status="approved", leave_type="CASUAL_LEAVE")])
    db.commit()
    need = requirement(unit, start=datetime(2026,11,19,12))
    def coverage(projections=()):
        context = canonical_availability(db, (need,), rules, leave_projections=projections)
        return context, evaluate_capacity((need,), context["people"])
    assert coverage()[1]["status"] == "infeasible"
    context, result = coverage([proposal(person, identity=row.id, slot="AM")])
    assert result["status"] == "feasible"
    assert result["requirements"][0]["eligible_person_ids"] == [str(person.id)]
    assert len([fact for fact in context["facts"] if fact["code"] == "approved_leave"]) == 2
    assert coverage([proposal(person, identity=row.id, day=date(2026,12,1))])[1]["status"] == "feasible"
    assert row.leave_slot == "FULL_DAY" and row.starts_on == date(2026,11,19)


@pytest.mark.parametrize("status", ["cancelled", "rejected"])
def test_removing_leave_restores_availability_in_projection_only(environment, status):
    db, unit, person, rules = environment
    row = LeaveRequest(person=person, starts_on=date(2026,11,19), ends_on=date(2026,11,19),
                       leave_slot="FULL_DAY", status="approved", leave_type="CASUAL_LEAVE")
    db.add(row)
    db.commit()
    need = requirement(unit)
    context = canonical_availability(db, (need,), rules, leave_projections=[proposal(person, identity=row.id, status=status)])
    assert evaluate_capacity((need,), context["people"])["status"] == "feasible"
    assert row.status == "approved"


def test_projection_is_immutable_and_duplicate_ids_are_rejected(environment):
    db, unit, person, rules = environment
    value = proposal(person)
    with pytest.raises(FrozenInstanceError):
        value.status = "cancelled"
    with pytest.raises(ValueError, match="once"):
        canonical_availability(db, (requirement(unit),), rules, leave_projections=[value, value])


def test_missing_rules_and_calendar_are_unknown_rather_than_no_impact(environment):
    db, unit, person, _ = environment
    result = compare_month(db, "2026-11", [proposal(person)])
    assert result["changed"] is None and result["after"]["status"] == "not_evaluated"
    from app.services.rota_rules import get_phase_one_rules
    get_phase_one_rules(db)
    db.commit()
    result = compare_month(db, "2026-11", [proposal(person)])
    assert result["changed"] is None and result["after"]["status"] == "not_evaluated"
    assert any("calendar" in reason for reason in result["after"]["reasons"])


def test_actual_monthly_and_manual_reviews_include_ot_evidence_and_stale_calendar_rejection(api_environment, monkeypatch):
    client, db, _, person = api_environment
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    unit = Unit(code="UNIT_IV", name="Unit IV", minimum_free_people=0)
    person.call_level = "3RD_CALL"
    db.add(unit)
    db.flush()
    db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL", starts_on=date(2026,10,1)))
    db.commit()
    save_calendar(db, unit)
    from app.services.rota_rules import get_phase_one_rules
    get_phase_one_rules(db)
    db.commit()
    row = leave(db, person, "2026-11-19")
    review = preview(client, "2026-11")
    impact, = review["ot_impact"]["months"]
    assert impact["before"]["status"] == "feasible"
    assert impact["after"]["status"] == "infeasible"
    assert review["ot_impact"]["context_digest"]
    values = {"person_id": str(person.id), "starts_on": "2026-11-20", "ends_on": "2026-11-20",
              "leave_type": "ANNUAL_LEAVE", "leave_slot": "FULL_DAY", "status": "approved"}
    manual = client.post("/api/v1/normalization/records/leave/preview", json={"values": values})
    assert manual.status_code == 200, manual.text
    assert manual.json()["ot_impact"]["months"][0]["after"]["status"] == "infeasible"
    manual_token = manual.json()["review_token"]
    saved = db.scalar(select(OtCalendar))
    configuration = {**saved.configuration, "reserve_mode": "additional"}
    from app.services.ot_calendar_store import revision
    saved.configuration, saved.revision = configuration, revision(configuration)
    db.commit()
    assert apply(client, review).status_code == 409
    assert preview(client, "2026-11")["review_token"] != review["review_token"]
    assert client.post("/api/v1/normalization/records/leave/preview", json={"values": values}).json()["review_token"] != manual_token
    assert db.get(LeaveRequest, row.id).status == "requested"


def test_pending_projection_is_only_blocking_in_explicit_stress_scenario(environment):
    db, unit, person, rules = environment
    value = proposal(person, status="requested")
    need = requirement(unit)
    official = canonical_availability(db, (need,), rules, leave_projections=[value])
    stress = canonical_availability(db, (need,), rules, leave_projections=[value], include_pending=True)
    assert evaluate_capacity((need,), official["people"])["status"] == "feasible"
    assert evaluate_capacity((need,), stress["people"])["status"] == "infeasible"


def test_saved_duty_stays_blocking_without_double_subtracting_proposed_leave(environment):
    db, unit, person, _ = environment
    save_calendar(db, unit)
    from app.services.rota_rules import get_phase_one_rules
    get_phase_one_rules(db)
    slot = DutySlot(unit=unit, duty_date=date(2026,11,19), duty_type="TEST", slot_label="Retained duty",
                    starts_at=datetime(2026,11,19,8), ends_at=datetime(2026,11,19,16),
                    is_24hr=False, source="phase4_template")
    assignment = DutyAssignment(person=person, duty_slot=slot, status="assigned")
    db.add(assignment)
    db.commit()
    original = (assignment.id, assignment.person_id, assignment.status, assignment.duty_slot_id)
    report = compare_month(db, "2026-11", [proposal(person)])
    assert report["before"]["status"] == report["after"]["status"] == "infeasible"
    assert report["before"]["mandatory_covered"] == report["after"]["mandatory_covered"]
    assert report["before"]["mandatory_required"] == report["after"]["mandatory_required"]
    assert (assignment.id, assignment.person_id, assignment.status, assignment.duty_slot_id) == original
    assert db.query(LeaveRequest).count() == 0


def test_disabled_and_oversized_reviews_do_not_claim_no_impact(environment, monkeypatch):
    db, _, person, _ = environment
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    disabled = review_impacts(db, [proposal(person)])
    assert disabled["status"] == "disabled" and disabled["context_digest"] is None
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    wide = LeaveProjection(uuid4(), person.id, date(2026,1,1), date(2026,5,1), "FULL_DAY", "approved")
    report = review_impacts(db, [wide])
    assert report["status"] == "not_evaluated" and report["months"] == []
    assert "four months" in report["basis"] and report["context_digest"]
