"""Template unit choices preserve complete duty/OT capacity without saving people."""

from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.models import DutyAssignment, DutySlot, LeaveRequest, MonthlyGenerationScopeUnit, OtCalendar, ReferenceValue, UserAccount
from app.services.ot_template import TemplateOtCapacity
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template
from tests.test_ot_assignment_integration import demand, environment as environment  # noqa: F401


DAY = date(2026, 11, 19)
KEY = "MAIN_3RD_24HR"


def lock_scope(db, unit):
    period, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    db.commit()
    return period


def add_second_duty(db):
    _, rules = get_phase_one_rules(db)
    original = rules.duty_rules_by_key[KEY]
    extra = original.model_copy(update={"key": "OT_TEST_3RD", "label": "Second senior duty"})
    db.add(ReferenceValue(kind="duty_type", key=extra.key, label=extra.label,
                          behavior=extra.model_dump(mode="json"), active=True))
    db.flush()
    rules.duty_rules.append(extra)
    save_phase_one_rules(db, rules)
    return extra.key


def test_capacity_checks_all_proposed_slots_without_queries_or_assignments(environment):
    db, _unit, _people, target = environment
    checker = TemplateOtCapacity(db, "2026-11", (target,))
    other = SimpleNamespace(**{name: getattr(target, name) for name in (
        "unit_id", "duty_date", "duty_type", "starts_at", "ends_at", "is_24hr", "call_level", "max_assignees")}, id=uuid4())
    def refuse_sql(*args):
        pytest.fail("Template capacity check attempted SQL after snapshot load")
    event.listen(db.get_bind(), "before_cursor_execute", refuse_sql)
    try:
        assert checker.check([target])["status"] == "feasible"
        assert checker.check([target, other])["status"] == "infeasible"
        assert checker.check([target])["status"] == "feasible"
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", refuse_sql)
    assert db.query(DutyAssignment).count() == 0


def test_capacity_budget_failure_is_unknown_and_is_not_cached_as_shortage(environment):
    db, _unit, _people, target = environment
    checker = TemplateOtCapacity(db, "2026-11", (target,))
    assert checker.check([target], seconds=0)["status"] == "not_evaluated"
    assert checker.check([target])["status"] == "feasible"


@pytest.mark.parametrize("missing", [False, True])
def test_template_cannot_force_ot_shortage_or_unknown_into_a_unit(environment, missing):
    db, unit, _people, _target = environment
    lock_scope(db, unit)
    if missing:
        db.query(OtCalendar).delete()
        db.commit()
    else:
        demand(db, unit, minimum=4)
    result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY], starts_on=DAY, ends_on=DAY))
    assert len(result["slots"]) == 1
    created = result["slots"][0]
    assert created["unit_id"] is None and created["template_status"] == "unresolved"
    assert not created["is_forced_allocation"]
    summary = result["latest_run"]["summary"]
    assert summary["ot_capacity"]["status"] == "incomplete"
    assert summary["ot_capacity"]["unallocated_duties"] == 1
    assert db.query(DutyAssignment).count() == 0
    from app.services.rota_template import call_wise_template_export
    _filename, workbook = call_wise_template_export(db, "2026-11")
    assert workbook.startswith(b"PK")


def test_template_does_not_double_book_people_for_second_simultaneous_duty(environment):
    db, unit, _people, _target = environment
    lock_scope(db, unit)
    extra = add_second_duty(db)
    result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY, extra], starts_on=DAY, ends_on=DAY))
    assert len(result["slots"]) == 2
    assert sum(row["unit_id"] is not None for row in result["slots"]) == 1
    assert sum(row["template_status"] == "unresolved" for row in result["slots"]) == 1
    assert db.query(DutyAssignment).count() == 0


def test_template_retains_protected_existing_assignments(environment):
    db, unit, people, target = environment
    saved = DutyAssignment(person=people[0], duty_slot=target, status="assigned")
    db.add(saved)
    db.commit()
    checker = TemplateOtCapacity(db, "2026-11", (target,))
    other = SimpleNamespace(**{name: getattr(target, name) for name in (
        "unit_id", "duty_date", "duty_type", "starts_at", "ends_at", "is_24hr", "call_level", "max_assignees")}, id=uuid4())
    assert checker.check([other])["status"] == "infeasible"
    assert db.get(DutyAssignment, saved.id).status == "assigned"


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
@pytest.mark.parametrize("changed_calendar", [False, True])
def test_reviewed_template_cpu_gpu_protocol_does_not_save_hypothetical_people(environment, engine, changed_calendar):
    from uuid import UUID
    from app.models import RotaComputeJob
    from app.services import rota_compute as compute, template_compute as template
    from app.services.compute_kernels import ranks
    db, unit, _people, target = environment
    original_id = target.id
    lock_scope(db, unit)
    operator = UserAccount(username="template-ot-admin", display_name="Template administrator",
        role="computer_admin", password_hash="fixture")
    db.add(operator)
    db.commit()
    config = {"duty_keys": [KEY], "starts_on": str(DAY), "ends_on": str(DAY), "replace_existing": True}
    started = template.start(db, "2026-11", operator, config, engine)
    job = db.get(RotaComputeJob, UUID(started["id"]))
    for _ in range(8):
        if job.status == "completed":
            break
        frame = compute.serialize(job)["frame"]
        compute.advance(db, job, job.revision,
            ranks(frame["rows"], frame["ties"]).index(0) if frame else None,
            frame["token"] if frame else None)
    assert job.status == "completed" and job.engine == engine
    if engine == "local_gpu":
        assert job.state["template"]["answers"]
    assert compute.apply_job(db, job, job.revision, operator, dry_run=True)["validated"]
    assert db.query(DutyAssignment).count() == 0
    if changed_calendar:
        from fastapi import HTTPException
        demand(db, unit, minimum=4)
        with pytest.raises(HTTPException) as failure:
            compute.apply_job(db, job, job.revision, operator)
        assert failure.value.status_code == 409
        assert db.get(DutySlot, original_id) is not None
    else:
        assert compute.apply_job(db, job, job.revision, operator)["status"] == "applied"
    assert db.query(DutyAssignment).count() == 0
    assert db.query(DutySlot).count() == 1


def test_reviewed_zero_ot_keeps_existing_non_ot_forced_review_semantics(environment):
    db, unit, people, _target = environment
    lock_scope(db, unit)
    demand(db, unit, minimum=0)
    db.add_all([LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
        starts_on=DAY, ends_on=DAY, status="approved") for person in people])
    db.commit()
    result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY], starts_on=DAY, ends_on=DAY))
    assert result["slots"][0]["unit_id"] == str(unit.id)
    assert result["slots"][0]["is_forced_allocation"]
    assert result["slots"][0]["template_status"] == "needs_review"


def test_feature_off_keeps_existing_template_behavior(environment, monkeypatch):
    from app.core.config import settings
    db, unit, _people, _target = environment
    lock_scope(db, unit)
    demand(db, unit, minimum=4)
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY], starts_on=DAY, ends_on=DAY))
    assert result["slots"][0]["unit_id"] == str(unit.id)
    assert "ot_capacity" not in result["latest_run"]["summary"]


def test_vertical_shuffle_cannot_move_duty_into_unit_whose_people_are_all_reserved(environment, monkeypatch):
    from copy import deepcopy
    from app.models import Person, PersonPosting, Unit
    from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
    db, unit, _people, _target = environment
    lock_scope(db, unit)
    other = Unit(code="UNIT_V", name="Unit V", minimum_free_people=0)
    db.add(other)
    db.flush()
    for home, count in ((unit, 4), (other, 8)):
        for index in range(count):
            person = Person(canonical_name=f"Anonymous {home.code} {index}", active_status="active", call_level="3RD_CALL")
            db.add(person)
            db.flush()
            db.add(PersonPosting(person=person, unit=home, posting_type="3RD_CALL",
                starts_on=date(2026, 10, 1), source="unit_board"))
    _, scope = monthly_setup(db, "2026-11")
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=other, status="included"))
    db.commit()
    demand(db, unit, minimum=2)
    demand(db, other, minimum=2)
    row = db.query(OtCalendar).filter_by(unit_id=other.id).one()
    config = deepcopy(row.configuration)
    config["exceptions"] = [{"id": str(uuid4()), "unit_id": str(other.id), "area_key": "main",
        "day": str(DAY), "closed": False, "bands": [{"key": "senior", "start_minute": 480,
            "end_minute": 960, "call_levels": ["3RD_CALL"], "minimum": 8, "target": 8}]}]
    row.configuration = canonical(CalendarConfiguration.model_validate(config))
    row.revision = revision(row.configuration)
    db.commit()
    extra = add_second_duty(db)
    attempted = []
    original = TemplateOtCapacity.check
    def record(self, slots, **kwargs):
        result = original(self, slots, **kwargs)
        if len(slots) == 4 and any(s.unit_id == other.id and s.duty_date == DAY for s in slots):
            attempted.append(result["status"])
        return result
    monkeypatch.setattr(TemplateOtCapacity, "check", record)
    result = generate_empty_template(db, "2026-11", TemplateGenerationOptions(
        duty_keys=[KEY, extra], starts_on=DAY, ends_on=DAY + timedelta(days=1)))
    assert len(result["slots"]) == 4 and all(s["unit_id"] is not None for s in result["slots"])
    assert attempted and set(attempted) == {"infeasible"}
    assert result["latest_run"]["summary"]["vertical_shuffle_swaps"] == 0
    assert result["latest_run"]["summary"]["ot_capacity"]["status"] == "feasible"
    assert db.query(DutyAssignment).count() == 0
