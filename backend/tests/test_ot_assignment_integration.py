"""Ordinary manual/candidate/whole-plan paths enforce the same OT reservation guard."""

from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, MonthlyGenerationScopeUnit, OtCalendar, Person, PersonPosting, Unit
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot, validate_assignment
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from app.services.rota_optimizer import validate_plan, without_slots
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup


def demand(db, unit, minimum=3, closed_day=None):
    value = canonical(CalendarConfiguration.model_validate({"reserve_mode": "included", "weekly": [
        {"id": str(uuid4()), "unit_id": str(unit.id), "area_key": "main", "weekday": day,
         "effective_from": "2026-10-01", "bands": [{"key": "senior", "start_minute": 480,
            "end_minute": 960, "call_levels": ["3RD_CALL"], "minimum": minimum, "target": minimum}]}
        for day in ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")],
        "exceptions": [{"id": str(uuid4()), "unit_id": str(unit.id), "area_key": "main",
            "day": str(closed_day), "closed": True, "bands": []}] if closed_day else []}))
    row = db.query(OtCalendar).filter_by(unit_id=unit.id).one_or_none()
    if row is None:
        db.add(OtCalendar(unit_id=unit.id, configuration=value, revision=revision(value)))
    else:
        row.configuration, row.revision = value, revision(value)
    db.commit()


def slot(db, unit, day=date(2026, 11, 19)):
    period, _ = monthly_setup(db, "2026-11")
    starts = datetime.combine(day, datetime.min.time()) + timedelta(hours=8)
    value = DutySlot(rota_period=period, unit=unit, duty_date=day, duty_type="MAIN_3RD_24HR",
        call_level="3RD_CALL", slot_label=str(uuid4()), starts_at=starts,
        ends_at=starts + timedelta(hours=24), is_24hr=True, source="phase4_template")
    db.add(value)
    db.commit()
    return value


@pytest.fixture
def environment(monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        unit = Unit(code="UNIT_IV", name="Unit IV", minimum_free_people=0)
        people = [Person(canonical_name=f"Anonymous senior {i}", active_status="active", call_level="3RD_CALL")
                  for i in range(4)]
        db.add_all([unit, *people])
        db.flush()
        for person in people:
            db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL",
                starts_on=date(2026, 10, 1), source="unit_board"))
        get_phase_one_rules(db)
        db.commit()
        demand(db, unit)
        yield db, unit, people, slot(db, unit)
    engine.dispose()


@pytest.mark.parametrize("path", ["ordinary", "verifier", "extra"])
def test_context_preserves_future_duties_through_extended_ot_horizon(environment, path):
    from app.services.ot_assignment_validation import validate_ot_assignment
    db, unit, people, _target = environment
    period, _ = monthly_setup(db, "2026-12")
    long_slot = DutySlot(rota_period=_target.rota_period, unit=unit, duty_date=date(2026, 11, 30),
        duty_type="MAIN_3RD_24HR", call_level="3RD_CALL", slot_label="extended-month-end",
        starts_at=datetime(2026, 11, 30, 8), ends_at=datetime(2026, 12, 9, 8),
        is_24hr=True, source="phase4_template")
    future = DutySlot(rota_period=period, unit=unit, duty_date=date(2026, 12, 9),
        duty_type="MAIN_3RD_24HR", call_level="3RD_CALL", slot_label="preserved-future-duty",
        starts_at=datetime(2026, 12, 9, 8), ends_at=datetime(2026, 12, 10, 8),
        is_24hr=True, source="phase4_template")
    saved = DutyAssignment(person=people[1], duty_slot=future, status="assigned")
    db.add_all([long_slot, saved])
    db.commit()
    if path == "verifier":
        from app.services.extra_duty_verify import load_month_state
        state = load_month_state(db, "2026-11")
        assert saved.id in {d.key for duties in state.duties_by_person.values() for d in duties}
        assert any(code == "ot_reservation_conflict" for code, _ in state.ot_blockers(people[0].id, long_slot))
        return
    if path == "extra":
        from app.services.extra_duty import build_context, strict_blockers
        from app.services.rota_rules import read_phase_one_rules
        context = build_context(db, "2026-11", _target.rota_period, read_phase_one_rules(db))
        assert saved.id in {e.assignment_id for entries in context.entries_by_person.values() for e in entries}
        assert any(row["code"] == "ot_reservation_conflict" for row in strict_blockers(context, people[0].id, long_slot, unit.id))
        return
    context = candidate_context(db, "2026-11")
    assert saved.id in {a.id for rows in context.nearby_assignments.values() for a in rows}
    report = validate_ot_assignment(db, long_slot, people[0], context.rules,
                                    replace_existing=False, context=context)
    assert report["status"] == "infeasible"
    assert db.query(DutyAssignment).filter_by(duty_slot_id=long_slot.id).count() == 0


def test_manual_override_cannot_consume_mandatory_ot_and_does_not_write(environment):
    db, unit, people, target = environment
    demand(db, unit, minimum=4)
    with pytest.raises(RotaAssignmentError) as failed:
        assign_person_to_slot(db, slot_id=target.id, person_id=people[0].id,
                              override_reason="Explicit ordinary manual reason")
    assert failed.value.status_code == 409
    assert any(row["code"] == "ot_reservation_conflict" for row in failed.value.validation["issues"]), failed.value.validation
    assert db.query(DutyAssignment).count() == 0


def test_month_optimizer_models_joint_ot_scarcity_before_final_validation_cuts(environment):
    from app.services.rota_optimizer import solve_month
    db, unit, _people, first = environment
    second = slot(db, unit, first.duty_date)
    context = candidate_context(db, "2026-11")
    slots = {str(row.id): row for row in (first, second)}
    # Either duty alone can leave three of four seniors for OT. Together they
    # cannot: duty overlap forbids a shared holder, and OT needs three identities.
    result = solve_month(db, context, slots, seconds=5, minimum_coverage=2)
    assert result["status"] == "infeasible" and result["choices"] == {}
    assert result["cuts"] == 0
    assert result["ot_reservations"]["status"] == "modeled"
    assert result["ot_reservations"]["couplings"] > 0
    assert db.query(DutyAssignment).count() == 0


def test_month_optimizer_retains_safe_partial_coverage_and_independent_validation(environment):
    from app.services.rota_optimizer import solve_month
    db, unit, _people, first = environment
    second = slot(db, unit, first.duty_date)
    context = candidate_context(db, "2026-11")
    slots = {str(row.id): row for row in (first, second)}
    result = solve_month(db, context, slots, seconds=5)
    assert len(result["choices"]) == 1
    assert result["ot_reservations"]["status"] == "modeled"
    assert not validate_plan(db, context, slots, result["choices"])
    assert db.query(DutyAssignment).count() == 0


def test_month_optimizer_reports_unresolved_joint_context_without_certifying_empty_plan(environment):
    from dataclasses import replace
    from app.services.rota_optimizer import solve_month
    db, _unit, _people, target = environment
    context = candidate_context(db, "2026-11")
    context.ot_guard = replace(context.ot_guard, unresolved=("Calendar withdrawn after snapshot",))
    result = solve_month(db, context, {str(target.id): target}, seconds=5)
    assert result["status"] == "time_limited" and result["choices"] == {}
    assert result["ot_reservations"]["status"] == "unresolved"
    assert result["warnings"]


def test_intelligent_job_surfaces_unknown_joint_ot_context_as_unresolved_decisions(environment):
    from app.models import RotaComputeJob, UserAccount
    from app.services import rota_compute as compute, rota_intelligence as intelligence
    db, unit, _people, _target = environment
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    operator = UserAccount(username="unresolved-joint-ot", display_name="Planning administrator",
        role="computer_admin", password_hash="fixture")
    db.add(operator)
    db.query(OtCalendar).delete()
    db.commit()
    started = intelligence.start(db, "2026-11", operator, {"mode": "balanced", "seconds": 5,
        "repair_slots": [], "locked_slots": [], "preferences": []})
    job = db.get(RotaComputeJob, UUID(started["id"]))
    compute.advance(db, job, job.revision)
    assert job.status == "completed"
    report = job.state["intelligence"]["alternatives"][0]
    assert report["status"] == "time_limited"
    assert report["ot_reservations"]["status"] == "unresolved"
    assert report["decisions"] and all(row["action"] == "unresolved" for row in report["decisions"])
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
@pytest.mark.parametrize("changed_calendar", [False, True])
def test_reviewed_intelligent_apply_preserves_ot_with_cpu_or_verified_gpu_hints(environment, engine, changed_calendar):
    from fastapi import HTTPException
    from app.models import RotaComputeJob, UserAccount
    from app.services import rota_compute as compute, rota_intelligence as intelligence
    from app.services.compute_kernels import ranks
    db, unit, _people, target = environment
    slot(db, unit, target.duty_date)
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    operator = UserAccount(username="joint-reviewed-admin", display_name="Planning administrator",
        role="computer_admin", password_hash="fixture")
    db.add(operator)
    db.commit()
    started = intelligence.start(db, "2026-11", operator, {"mode": "balanced", "seconds": 5,
        "engine": engine, "repair_slots": [], "locked_slots": [], "preferences": []})
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
        assert job.state["metrics"]["gpu_frames_verified"] > 0
    report = job.state["intelligence"]["alternatives"][0]
    assert report["ot_reservations"]["status"] == "modeled"
    assert len(report["choices"]) == 1 and report["uncovered"] == 1
    assert compute.apply_job(db, job, job.revision, operator, dry_run=True)["validated"]
    assert db.query(DutyAssignment).count() == 0
    if changed_calendar:
        demand(db, unit, minimum=4)
        with pytest.raises(HTTPException) as failure:
            compute.apply_job(db, job, job.revision, operator)
        assert failure.value.status_code == 409
        assert db.query(DutyAssignment).count() == 0
    else:
        assert compute.apply_job(db, job, job.revision, operator)["status"] == "applied"
        assert db.query(DutyAssignment).count() == 1


def test_candidate_ranking_marks_ot_consumers_blocked(environment):
    db, unit, _, target = environment
    demand(db, unit, minimum=4)
    context = candidate_context(db, "2026-11")
    result = slot_candidates_with_context(db, slot=target, context=context)
    assert result["candidates"]
    assert all(row["candidate_status"] == "blocked" for row in result["candidates"])
    assert all(any(issue["code"] == "ot_reservation_conflict" for issue in row["validation_issues"])
               for row in result["candidates"])


def test_context_is_loaded_once_and_preserved_when_optimizer_removes_slots(environment, monkeypatch):
    db, _, people, target = environment
    import app.services.ot_assignment_context as loader
    original, calls = loader.load_assignment_guard, []
    def counted(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)
    monkeypatch.setattr(loader, "load_assignment_guard", counted)
    context = candidate_context(db, "2026-11")
    modified = without_slots(context, [target.id])
    assert modified.ot_guard is context.ot_guard
    for person in people:
        assert validate_assignment(db, slot=target, person=person, replace_existing=True,
                                   context=modified)["ot_protection"]["status"] == "feasible"
    assert len(calls) == 1


def test_final_plan_rejects_combination_of_individually_safe_choices(environment):
    db, unit, people, first = environment
    second = slot(db, unit)
    context = candidate_context(db, "2026-11")
    for target, person in zip((first, second), people):
        assert validate_assignment(db, slot=target, person=person, replace_existing=True,
                                   context=context)["ot_protection"]["status"] == "feasible"
    slots = {str(row.id): row for row in (first, second)}
    failures = validate_plan(db, context, slots, {str(first.id): str(people[0].id), str(second.id): str(people[1].id)})
    assert any(any(issue["code"] == "ot_reservation_conflict" for issue in row["issues"]) for row in failures)


def test_replacement_releases_previous_holder_before_reserving_new_person(environment):
    db, _, people, target = environment
    db.add(DutyAssignment(person=people[0], duty_slot=target, status="assigned"))
    db.commit()
    check = validate_assignment(db, slot=target, person=people[1], replace_existing=True)
    assert check["ot_protection"]["status"] == "feasible"
    context = candidate_context(db, "2026-11")
    assert validate_assignment(db, slot=target, person=people[1], replace_existing=True,
                               context=context)["ot_protection"]["status"] == "feasible"


def test_month_end_assignment_protects_next_month_ot_despite_closed_duty_date(environment):
    db, unit, people, _ = environment
    demand(db, unit, minimum=4, closed_day=date(2026, 11, 30))
    target = slot(db, unit, date(2026, 11, 30))
    check = validate_assignment(db, slot=target, person=people[0], replace_existing=True)
    assert check["ot_protection"]["status"] == "infeasible"
    assert any("2026-12-01" in row["id"] and row["minimum_shortage"]
               for row in check["ot_protection"]["capacity"]["requirements"])


def test_missing_demand_is_unresolved_and_feature_off_retains_legacy_behavior(environment, monkeypatch):
    db, _, people, target = environment
    db.query(OtCalendar).delete()
    db.commit()
    check = validate_assignment(db, slot=target, person=people[0], replace_existing=True)
    assert any(row["code"] == "ot_capacity_unresolved" and row["severity"] == "blocked" for row in check["issues"])
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    legacy = validate_assignment(db, slot=target, person=people[0], replace_existing=True)
    assert "ot_protection" not in legacy
    assert not any(row["code"].startswith("ot_") for row in legacy["issues"])


def test_extra_duty_strict_check_and_independent_verifier_protect_ot(environment):
    from app.services.extra_duty import build_context, strict_blockers
    from app.services.extra_duty_verify import check_month, load_month_state
    from app.services.superadmin_allocation import strict_blocks

    db, unit, people, target = environment
    demand(db, unit, minimum=4)
    rules = get_phase_one_rules(db)[1]
    context = build_context(db, "2026-11", target.rota_period, rules)
    assert any(row["code"] == "ot_reservation_conflict"
               for row in strict_blockers(context, people[0].id, target, unit.id))
    state = load_month_state(db, "2026-11")
    assert any(row["code"] == "ot_reservation_conflict" for row in strict_blocks(state, people[0].id, target))
    # Even an existing superadmin source does not waive the new reservation check.
    db.add(DutyAssignment(person=people[0], duty_slot=target, status="assigned", source="superadmin_allocation"))
    db.commit()
    report = check_month(db, "2026-11")
    assert not report["ok"]
    assert any(row["code"] == "ot_reservation_conflict" for row in report["violations"])
    assert any(row["name"] == "OT reservations" and not row["passed"] for row in report["checks"])


def test_extra_duty_planner_recomputes_everyones_ot_alternatives_after_each_choice(environment):
    from app.services.extra_duty import plan_extra_duties

    db, unit, _, _ = environment
    slot(db, unit)
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    db.commit()
    plan = plan_extra_duties(db, "2026-11")
    # Either duty alone is safe, but both would leave only two of the three
    # mandatory OT seniors. Cached pools must not let the second one through.
    assert plan["summary"]["filled"] == 1
    assert plan["summary"]["unfilled"] == 1
    unfilled = next(row for row in plan["decisions"] if row["action"] == "unfilled")
    # The chosen member is already double-booked; the others are needed for OT.
    assert unfilled["cause"] in {"other", "ot_reservations"}
    assert "OT" in unfilled["reason"]
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize("changed_calendar", [False, True])
def test_extra_duty_actual_apply_preserves_ot_and_refuses_stale_preview(environment, changed_calendar):
    from app.models import ExtraDutyBatch, UserAccount
    from app.services import extra_duty as ed
    from app.services.extra_duty_verify import check_month

    db, unit, _people, target = environment
    slot(db, unit, target.duty_date)
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    user = UserAccount(username="ot-extra-apply", display_name="OT test operator",
                       role="superadmin", password_hash="fixture")
    db.add(user)
    db.commit()
    plan = ed.preview(db, "2026-11", user)
    assert plan["summary"]["filled"] == 1 and plan["summary"]["unfilled"] == 1
    assert db.query(DutyAssignment).count() == 0
    if changed_calendar:
        demand(db, unit, minimum=4)
        with pytest.raises(ed.ExtraDutyError) as failure:
            ed.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)
        assert failure.value.code == "stale_preview"
        assert db.query(DutyAssignment).count() == 0
        assert db.query(ExtraDutyBatch).count() == 0
    else:
        result = ed.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)
        assert not result["already_applied"]
        assert db.query(DutyAssignment).count() == 1
        assert check_month(db, "2026-11")["ok"]
        assert ed.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)["already_applied"]
        assert db.query(DutyAssignment).count() == 1


@pytest.mark.parametrize("changed_calendar", [False, True])
def test_balance_actual_apply_preserves_ot_and_refuses_stale_preview(environment, changed_calendar):
    from app.models import ExtraDutyBatch, UserAccount
    from app.services import balance_duties as bd
    from app.services.extra_duty_verify import check_month

    db, unit, people, _target = environment
    _, scope = monthly_setup(db, "2026-11")
    scope.is_locked = True
    db.add(MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included"))
    user = UserAccount(username="ot-balance-apply", display_name="OT test operator",
                       role="superadmin", password_hash="fixture")
    db.add(user)
    for day in (1, 5, 9, 13):
        duty = slot(db, unit, date(2026, 11, day))
        db.add(DutyAssignment(person=people[0], duty_slot=duty, status="assigned",
                              source="safe_auto_fill_draft"))
    db.commit()
    before = {row.id: row.person_id for row in db.query(DutyAssignment)}
    plan = bd.preview(db, "2026-11", user)
    assert plan["moves"], __import__("json").dumps(plan["levels"])
    assert {row.id: row.person_id for row in db.query(DutyAssignment)} == before
    if changed_calendar:
        demand(db, unit, minimum=4)
        with pytest.raises(bd.BalanceError) as failure:
            bd.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)
        assert failure.value.code == "stale_preview"
        assert {row.id: row.person_id for row in db.query(DutyAssignment)} == before
        assert db.query(ExtraDutyBatch).count() == 0
    else:
        result = bd.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)
        assert not result["already_applied"]
        after = {row.id: row.person_id for row in db.query(DutyAssignment)}
        assert after.keys() == before.keys() and after != before
        assert check_month(db, "2026-11")["ok"]
        assert bd.apply(db, "2026-11", plan["token"], plan["plan_hash"], user)["already_applied"]
        assert {row.id: row.person_id for row in db.query(DutyAssignment)} == after


def test_specialized_guards_keep_missing_calendar_unresolved(environment):
    from app.services.extra_duty import build_context, strict_blockers
    from app.services.extra_duty_verify import load_month_state
    from app.services.superadmin_allocation import strict_blocks

    db, unit, people, target = environment
    db.query(OtCalendar).delete()
    db.commit()
    rules = get_phase_one_rules(db)[1]
    context = build_context(db, "2026-11", target.rota_period, rules)
    assert any(row["code"] == "ot_capacity_unresolved"
               for row in strict_blockers(context, people[0].id, target, unit.id))
    assert any(row["code"] == "ot_capacity_unresolved"
               for row in strict_blocks(load_month_state(db, "2026-11"), people[0].id, target))


def test_superadmin_actual_write_cannot_bypass_ot_but_retains_published_month_authority(environment):
    from app.models import UserAccount
    from app.services.superadmin_allocation import allocate, SuperadminAllocationError

    db, unit, people, target = environment
    operator = UserAccount(username="anonymous-superadmin", display_name="Administrator",
                           role="superadmin", password_hash="fixture")
    db.add(operator)
    target.rota_period.status = "published"
    db.commit()
    demand(db, unit, minimum=4)
    with pytest.raises(SuperadminAllocationError) as failure:
        allocate(db, slot_id=target.id, person_id=people[0].id,
                 reason="Reviewed clinical allocation", user=operator)
    assert failure.value.code == "strict_blocked"
    assert db.query(DutyAssignment).count() == 0
    demand(db, unit, minimum=3)
    result = allocate(db, slot_id=target.id, person_id=people[0].id,
                      reason="Reviewed clinical allocation", user=operator)
    assert result["post_publish"] is True
    assert db.query(DutyAssignment).filter_by(status="assigned").count() == 1


def test_publish_exposes_ot_deficit_and_preserves_attributed_superadmin_publish_override(environment):
    from app.models import RotaPublishApproval, UserAccount
    from app.services.rota_publish import publish_rota_month, rota_publish_checklist, RotaPublishError

    db, unit, people, target = environment
    demand(db, unit, minimum=4)
    db.add(DutyAssignment(person=people[0], duty_slot=target, status="assigned"))
    admin = UserAccount(username="publish-admin", display_name="Publish administrator",
                        role="computer_admin", password_hash="fixture")
    superadmin = UserAccount(username="publish-superadmin", display_name="Publish superadmin",
                             role="superadmin", password_hash="fixture")
    db.add_all([admin, superadmin])
    db.commit()
    checklist = rota_publish_checklist(db, "2026-11", admin)
    assert checklist["ot_protection"]["status"] == "infeasible"
    assert any(row["title"] == "OT reservations" for row in checklist["blockers"])
    with pytest.raises(RotaPublishError):
        publish_rota_month(db, month="2026-11", approved_by=admin, confirm_warnings=True,
                        approval_note="Reviewed monthly plan")
    assert db.query(RotaPublishApproval).count() == 0
    publish_rota_month(db, month="2026-11", approved_by=superadmin, confirm_warnings=True,
                    approval_note="Reviewed monthly plan", superadmin_override=True,
                    override_reason="Explicit existing publish exception")
    saved = db.query(RotaPublishApproval).one()
    assert saved.summary["published_with_override"]
    assert saved.summary["checklist"]["ot_protection"]["status"] == "infeasible"
    assert any(row["title"] == "OT reservations" for row in saved.summary["blockers"])


def test_exchange_approval_rechecks_ot_after_calendar_changes_and_keeps_original_holder(environment):
    from app.models import RotaExchangeRequest, UserAccount
    from app.services.rota_review import approve_exchange_request, create_exchange_request, RotaReviewError

    db, unit, people, target = environment
    original = DutyAssignment(person=people[0], duty_slot=target, status="assigned")
    requester = UserAccount(username="exchange-requester", display_name="Requester", role="computer_admin", password_hash="fixture")
    approver = UserAccount(username="exchange-approver", display_name="Approver", role="superadmin", password_hash="fixture")
    db.add_all([original, requester, approver])
    db.commit()
    exchange = create_exchange_request(db, assignment_id=original.id, to_person_id=people[1].id,
                                      reason="Reviewed replacement", requested_by=requester)
    demand(db, unit, minimum=4)
    with pytest.raises(RotaReviewError) as failure:
        approve_exchange_request(db, exchange_id=UUID(exchange["id"]), approved_by=approver,
                                 decision_reason="Cannot waive mandatory OT")
    assert failure.value.status_code == 409
    active = db.query(DutyAssignment).filter_by(duty_slot_id=target.id, status="assigned").all()
    assert [row.person_id for row in active] == [people[0].id]
    assert db.get(RotaExchangeRequest, UUID(exchange["id"])).status != "approved"


def test_restoration_checks_complete_set_and_excludes_replaced_duties(environment, monkeypatch):
    from types import SimpleNamespace
    from app.services.ot_restoration import check_restored_duties

    db, _unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    other = slot(db, target.unit)
    saved = DutyAssignment(person=people[0], duty_slot=target, status="assigned")
    db.add(saved)
    db.commit()
    restored = SimpleNamespace(id=uuid4(), person_id=people[1].id, duty_slot=other, status="assigned")
    assert check_restored_duties(db, (restored,))["status"] == "infeasible"
    assert check_restored_duties(db, (restored,), removed_ids=(saved.id,)) is None
    combined = SimpleNamespace(id=uuid4(), person_id=people[2].id, duty_slot=target, status="assigned")
    assert check_restored_duties(db, (restored, combined), removed_ids=(saved.id,))["status"] == "infeasible"
    assert db.get(DutyAssignment, saved.id).person_id == people[0].id


def test_archival_and_elapsed_restoration_remain_facts_without_demand(environment, monkeypatch):
    from types import SimpleNamespace
    from app.services.ot_restoration import check_restored_duties

    db, _unit, people, target = environment
    db.query(OtCalendar).delete()
    target.rota_period.status = "historical"
    db.commit()
    restored = SimpleNamespace(person_id=people[0].id, duty_slot=target, status="assigned")
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    assert check_restored_duties(db, (restored,)) is None
    target.rota_period.status = "draft"
    db.commit()
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2027, 1, 1))
    assert check_restored_duties(db, (restored,)) is None
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    assert check_restored_duties(db, (restored,))["status"] == "not_evaluated"


def test_restoration_filters_cancelled_duties_and_feature_off_keeps_existing_behavior(environment, monkeypatch):
    from types import SimpleNamespace
    from app.services.ot_restoration import check_restored_duties

    db, unit, people, target = environment
    demand(db, unit, minimum=4)
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    restored = SimpleNamespace(person_id=people[0].id, duty_slot=target, status="cancelled")
    assert check_restored_duties(db, (restored,)) is None
    restored.status = "assigned"
    assert check_restored_duties(db, (restored,))["status"] == "infeasible"
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    assert check_restored_duties(db, (restored,)) is None


def test_superadmin_undo_preview_and_apply_refuse_unsafe_restoration_atomically(environment, monkeypatch):
    from app.models import ExtraDutyBatch, UserAccount
    from app.services.superadmin_allocation import allocate, undo, SuperadminAllocationError

    db, unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    demand(db, unit, minimum=1)
    original = DutyAssignment(person=people[1], duty_slot=target, status="assigned")
    operator = UserAccount(username="undo-superadmin", display_name="Undo administrator", role="superadmin", password_hash="fixture")
    db.add_all([original, operator])
    db.commit()
    applied = allocate(db, slot_id=target.id, person_id=people[0].id, reason="Reviewed replacement", user=operator)
    people[2].active_status = people[3].active_status = "inactive"
    db.query(PersonPosting).filter_by(person_id=people[0].id).update({"ends_on": date(2026, 11, 18)})
    db.commit()
    batch_id = UUID(applied["batch_id"])
    preview = undo(db, batch_id, operator, dry_run=True)
    assert preview["conflicts"] and preview["restored"] == 0
    assert any(row["code"] == "ot_reservation_conflict" for row in preview["conflicts"])
    with pytest.raises(SuperadminAllocationError):
        undo(db, batch_id, operator)
    db.expire_all()
    assert db.get(ExtraDutyBatch, batch_id).status == "applied"
    assert db.get(DutyAssignment, original.id).status == "cancelled"
    active = db.query(DutyAssignment).filter_by(duty_slot_id=target.id, status="assigned").one()
    assert active.person_id == people[0].id
    # Restore enough OT capacity; the same reviewed undo is now feasible.
    people[2].active_status = "active"
    db.commit()
    assert not undo(db, batch_id, operator, dry_run=True)["conflicts"]
    assert undo(db, batch_id, operator)["restored"] == 1
    assert db.get(DutyAssignment, original.id).status == "assigned"


def test_balance_undo_preview_and_apply_reject_ot_conflict_before_changing_rows(environment, monkeypatch):
    from app.models import ExtraDutyBatch, UserAccount
    from app.services.balance_duties import BALANCE_SOURCE, undo, BalanceError

    db, unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    demand(db, unit, minimum=1)
    people[2].active_status = people[3].active_status = "inactive"
    db.query(PersonPosting).filter_by(person_id=people[0].id).update({"ends_on": date(2026, 11, 18)})
    assignment = DutyAssignment(person=people[0], duty_slot=target, status="assigned", source=BALANCE_SOURCE)
    operator = UserAccount(username="balance-undo-admin", display_name="Balance administrator", role="superadmin", password_hash="fixture")
    db.add_all([assignment, operator])
    db.flush()
    batch = ExtraDutyBatch(rota_period_id=target.rota_period_id, month="2026-11", plan_hash="a" * 64,
        context_hash="b" * 64, summary={"mode": "balance"}, before_image=[{
            "slot_id": str(target.id), "assignment_id": str(assignment.id),
            "person_id_before": str(people[1].id), "person_id_after": str(people[0].id),
            "unit_id_before": str(unit.id), "unit_id_after": str(unit.id),
            "source_before": "safe_auto_fill_draft", "source_after": BALANCE_SOURCE,
            "status_before": "assigned", "override_reason_before": None}])
    db.add(batch)
    db.commit()
    preview = undo(db, batch.id, operator, dry_run=True)
    assert any(row["code"] == "ot_reservation_conflict" for row in preview["conflicts"])
    with pytest.raises(BalanceError):
        undo(db, batch.id, operator)
    assert db.get(DutyAssignment, assignment.id).person_id == people[0].id
    assert db.get(ExtraDutyBatch, batch.id).status == "applied"
    people[2].active_status = "active"
    db.commit()
    assert not undo(db, batch.id, operator, dry_run=True)["conflicts"]
    assert undo(db, batch.id, operator)["restored"] == 1
    assert db.get(DutyAssignment, assignment.id).person_id == people[1].id


def test_generation_reversal_rejects_ot_conflict_in_preview_and_apply(environment, monkeypatch):
    from fastapi import HTTPException
    from app.models import RotaComputeJob, UserAccount
    from app.services.generation_undo import revert
    from app.services.rota_compute import context_hash

    db, unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    demand(db, unit, minimum=1)
    people[2].active_status = people[3].active_status = "inactive"
    db.query(PersonPosting).filter_by(person_id=people[0].id).update({"ends_on": date(2026, 11, 18)})
    old = DutyAssignment(person=people[1], duty_slot=target, status="cancelled")
    current = DutyAssignment(person=people[0], duty_slot=target, status="assigned")
    operator = UserAccount(username="generation-undo-admin", display_name="Generation administrator", role="superadmin", password_hash="fixture")
    db.add_all([old, current, operator])
    db.commit()
    digest = context_hash(db)
    job = RotaComputeJob(month="2026-11", operator_id=operator.id, status="applied", revision=2,
        context_hash=digest, state={"result": {"after_context_hash": digest,
            "assignment_ids": [str(current.id)]}, "intelligence": {"originals": {
                str(target.id): {"assignment_id": str(old.id), "person_id": str(old.person_id), "status": "assigned"}}}})
    db.add(job)
    db.commit()
    for dry_run in (True, False):
        with pytest.raises(HTTPException) as failure:
            revert(db, job, 2, operator, dry_run=dry_run)
        assert failure.value.status_code == 409
        assert failure.value.detail["code"] == "ot_restoration_blocked"
        assert db.get(DutyAssignment, old.id).status == "cancelled"
        assert db.get(DutyAssignment, current.id).status == "assigned"
        assert db.get(RotaComputeJob, job.id).status == "applied"


def test_generation_reversal_previews_and_restores_safe_original_without_partial_writes(environment, monkeypatch):
    from app.models import RotaComputeJob, UserAccount
    from app.services.generation_undo import revert
    from app.services.rota_compute import context_hash

    db, _unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    original = DutyAssignment(person=people[1], duty_slot=target, status="cancelled")
    replacement = DutyAssignment(person=people[0], duty_slot=target, status="assigned")
    operator = UserAccount(username="safe-reversal-admin", display_name="Reversal administrator",
                           role="superadmin", password_hash="fixture")
    db.add_all([original, replacement, operator])
    db.commit()
    digest = context_hash(db)
    replacement_id = replacement.id
    job = RotaComputeJob(month="2026-11", operator_id=operator.id, status="applied", revision=2,
        context_hash=digest, state={"result": {"after_context_hash": digest,
            "assignment_ids": [str(replacement.id)]}, "intelligence": {"originals": {
                str(target.id): {"assignment_id": str(original.id), "person_id": str(original.person_id),
                                "status": "assigned"}}}})
    db.add(job)
    db.commit()
    assert revert(db, job, 2, operator, dry_run=True)["reversal_validated"] is True
    assert original.status == "cancelled" and replacement.status == "assigned"
    assert job.status == "applied" and job.revision == 2
    assert revert(db, job, 2, operator)["status"] == "reverted"
    db.expire_all()
    assert db.get(DutyAssignment, replacement_id) is None
    assert db.get(DutyAssignment, original.id).status == "assigned"
    assert db.get(RotaComputeJob, job.id).revision == 3
    assert revert(db, job, 2, operator)["status"] == "reverted"


@pytest.mark.parametrize("historical", [False, True])
def test_recycle_restore_rolls_back_unsafe_recent_duty_but_preserves_archival_facts(environment, monkeypatch, historical):
    from app.models import DeletedRecord, UserAccount
    from app.services.recycle_bin import restore

    db, unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 20))
    demand(db, unit, minimum=4)
    if historical:
        target.rota_period.status = "historical"
    operator = UserAccount(username="recycle-admin", display_name="Restore administrator", role="superadmin", password_hash="fixture")
    assignment_id, batch_id = uuid4(), uuid4()
    record = DeletedRecord(batch_id=batch_id, kind="past_duty", entity_id=assignment_id,
        label="Anonymous recent duty", purge_after=datetime(2026, 12, 20), payload={"duty_assignments": [{
            "id": str(assignment_id), "person_id": str(people[0].id), "duty_slot_id": str(target.id),
            "status": "assigned", "source": "manual_rota_board"}]})
    db.add_all([operator, record])
    db.commit()
    result = restore(db, operator, batch_id)
    db.expire_all()
    if historical:
        assert result["restored"] == 1 and not result["failed"]
        assert db.get(DutyAssignment, assignment_id) is not None
        assert db.get(DeletedRecord, record.id).restored_at is not None
    else:
        assert result["restored"] == 0 and len(result["failed"]) == 1
        assert "OT" in result["failed"][0]["reason"]
        assert db.get(DutyAssignment, assignment_id) is None
        assert db.get(DeletedRecord, record.id).restored_at is None


def test_restoration_preview_neither_flushes_nor_discards_unrelated_pending_edits(environment, monkeypatch):
    from types import SimpleNamespace
    from sqlalchemy import event
    from app.services.ot_restoration import check_restored_duties

    db, unit, people, target = environment
    monkeypatch.setattr("app.services.ot_restoration.local_today", lambda: date(2026, 11, 1))
    unit.notes = "Unrelated unsaved administrator edit"
    proposal = SimpleNamespace(person_id=people[0].id, duty_slot=target, status="assigned")
    def refuse_flush(*args):
        pytest.fail("Read-only restoration preview attempted to flush unrelated changes")
    event.listen(db, "before_flush", refuse_flush)
    try:
        assert check_restored_duties(db, (proposal,)) is None
        assert unit in db.dirty
        assert unit.notes == "Unrelated unsaved administrator edit"
    finally:
        event.remove(db, "before_flush", refuse_flush)
