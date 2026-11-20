"""Actual PostgreSQL input edits versus OT-protected allocation, both lock orders."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models import CallCluster, DutyAssignment, DutySlot, LeaveRequest, OtCalendar, Person, PersonPosting, RotaComputeJob, RuleSetting, RuleVersion, Unit, UserAccount
from app.services.ot_calendar_store import revision
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot
from app.services.rota_rules import get_phase_one_rules, PHASE_ONE_SETTING_KEY
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_ot_assignment_integration import demand, slot


def seed(factory):
    with factory() as db:
        unit = Unit(code="OT_RACE", name="OT race unit", minimum_free_people=0)
        people = [Person(canonical_name=f"Anonymous OT race {i}", call_level="3RD_CALL", active_status="active")
                  for i in range(4)]
        db.add_all([unit, *people])
        db.flush()
        for person in people:
            db.add(PersonPosting(person=person, unit=unit, posting_type="3RD_CALL",
                starts_on=date(2026, 10, 1), source="unit_board"))
        get_phase_one_rules(db)
        db.commit()
        demand(db, unit, minimum=3)
        target = slot(db, unit)
        future = slot(db, unit, date(2026, 11, 21))
        db.add(DutyAssignment(person=people[1], duty_slot=future, status="assigned"))
        db.commit()
        return unit.id, target.id, [p.id for p in people]


def edit(db, kind, unit_id, person_ids):
    if kind == "calendar":
        row = db.scalar(select(OtCalendar).where(OtCalendar.unit_id == unit_id))
        cfg = deepcopy(row.configuration)
        for weekly in cfg["weekly"]:
            weekly["bands"][0]["minimum"] = weekly["bands"][0]["target"] = 4
        row.configuration, row.revision = cfg, revision(cfg)
    elif kind == "leave":
        db.add(LeaveRequest(person_id=person_ids[1], starts_on=date(2026, 11, 19), ends_on=date(2026, 11, 19),
            leave_slot="FULL_DAY", leave_type="ANNUAL_LEAVE", status="approved"))
    elif kind == "unit":
        db.get(Unit, unit_id).minimum_free_people = 4
    else:
        row = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
        value = deepcopy(row.value)
        value["rest_rules"]["minimum_gap_after_24hr_hours"] = 168
        row.value = value
    db.commit()


@pytest.mark.parametrize("kind", ["calendar", "leave", "unit", "rules"])
def test_committed_edit_before_allocation_refreshes_cached_inputs_and_refuses_unsafe_duty(postgres_client, monkeypatch, kind):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, slot_id, people = seed(factory)
    loaded, edited = Event(), Event()
    def allocate():
        with factory() as db:
            # Keep references alive: querying again must not reuse their old values.
            cached = (db.get(Unit, unit_id), db.get(Person, people[1]),
                db.scalar(select(OtCalendar)), db.scalar(select(RuleSetting)))
            loaded.set()
            assert edited.wait(10)
            try:
                assign_person_to_slot(db, slot_id=slot_id, person_id=people[0])
                return "unsafe_acceptance"
            except RotaAssignmentError as error:
                assert error.status_code == 409
                assert cached
                db.rollback()
                return "refused"
    def writer():
        assert loaded.wait(10)
        with factory() as db:
            edit(db, kind, unit_id, people)
        edited.set()
    with ThreadPoolExecutor(max_workers=2) as pool:
        allocation, change = pool.submit(allocate), pool.submit(writer)
        try:
            change.result(timeout=20)
            assert allocation.result(timeout=20) == "refused"
        finally:
            edited.set()
    with factory() as db:
        assert not list(db.scalars(select(DutyAssignment).where(DutyAssignment.duty_slot_id == slot_id)))


@pytest.mark.parametrize("kind,cold,mode", [("calendar", False, "manual"), ("leave", False, "manual"),
    ("unit", False, "manual"), ("rules", False, "manual"), ("unit", True, "manual"),
    ("calendar", False, "autofill"), ("unit", True, "autofill")])
def test_allocation_lock_blocks_even_uncoordinated_input_writer_until_commit(postgres_client, monkeypatch, kind, cold, mode):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, slot_id, people = seed(factory)
    if cold:
        with factory() as db:
            db.query(RuleSetting).delete()
            db.query(RuleVersion).delete()
            db.query(CallCluster).delete()
            db.commit()
    locked, release, pid_ready = Event(), Event(), Event()
    writer_pid = []
    from app.services import ot_assignment_context, ot_assignment_validation
    original = ot_assignment_validation.load_assignment_guard
    def hold(db, month, rules, **kwargs):
        locked.set()
        assert release.wait(10)
        return original(db, month, rules, **kwargs)
    monkeypatch.setattr(ot_assignment_validation, "load_assignment_guard", hold)
    monkeypatch.setattr(ot_assignment_context, "load_assignment_guard", hold)
    def allocate():
        with factory() as db:
            if mode == "manual":
                assign_person_to_slot(db, slot_id=slot_id, person_id=people[0])
            else:
                from app.services.rota_auto_fill import run_safe_auto_fill
                assert run_safe_auto_fill(db, "2026-11")["assigned_slots"] == 1
            return "allocated"
    def writer():
        assert locked.wait(10)
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '8s'"))
            writer_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
            pid_ready.set()
            edit(db, kind, unit_id, people)
        return "edited_after_allocation"
    with ThreadPoolExecutor(max_workers=2) as pool:
        allocation, change = pool.submit(allocate), pool.submit(writer)
        try:
            assert locked.wait(10) and pid_ready.wait(10)
            waiting = False
            deadline = monotonic() + 5
            with factory() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)"),
                                              {"pid": writer_pid[0]})
                    if waiting:
                        break
                    Event().wait(0.025)
            assert waiting and not change.done()
        finally:
            release.set()
        assert allocation.result(timeout=20) == "allocated"
        assert change.result(timeout=20) == "edited_after_allocation"
    with factory() as db:
        assert len(list(db.scalars(select(DutyAssignment).where(DutyAssignment.duty_slot_id == slot_id)))) == 1


@pytest.mark.parametrize("kind", [None, "calendar", "leave", "unit", "rules"])
def test_reviewed_template_apply_on_postgres_keeps_protected_duties_and_refuses_stale_inputs(postgres_client, monkeypatch, kind):
    from uuid import UUID
    from fastapi import HTTPException
    from app.services import rota_compute as compute, template_compute as template
    from app.services.rota_setup import monthly_setup, update_scope_units
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, _slot_id, people = seed(factory)
    with factory() as db:
        _, scope = monthly_setup(db, "2026-11")
        update_scope_units(db, scope, [unit_id], [], True, True, "Reviewed OT race fixture")
        operator = db.scalar(select(UserAccount))
        user_id = operator.id
        result = template.start(db, "2026-11", operator, {"duty_keys": ["MAIN_3RD_24HR"],
            "starts_on": "2026-11-25", "ends_on": "2026-11-25", "replace_existing": False}, "server")
        job = db.get(RotaComputeJob, UUID(result["id"]))
        compute.advance(db, job, job.revision)
        assert job.status == "completed"
        assert db.query(DutySlot).count() == 2 and db.query(DutyAssignment).count() == 1
        job_id, proposal_revision = job.id, job.revision
    with factory() as db:
        # Hold stale identity-map inputs across another session's committed edit.
        cached = (db.get(Unit, unit_id), db.scalar(select(OtCalendar)), db.scalar(select(RuleSetting)))
        job = db.get(RotaComputeJob, job_id)
        if kind is not None:
            with factory() as editor:
                edit(editor, kind, unit_id, people)
            with pytest.raises(HTTPException) as failed:
                compute.apply_job(db, job, proposal_revision, db.get(UserAccount, user_id))
            assert failed.value.status_code == 409
        else:
            assert compute.apply_job(db, job, proposal_revision, db.get(UserAccount, user_id))["status"] == "applied"
        assert cached
    with factory() as db:
        assert db.query(DutyAssignment).count() == 1
        assert db.query(DutySlot).count() == (2 if kind is not None else 3)
        assert db.get(RotaComputeJob, job_id).status == ("failed" if kind is not None else "applied")
