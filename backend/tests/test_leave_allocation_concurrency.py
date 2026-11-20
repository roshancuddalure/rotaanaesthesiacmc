"""Real PostgreSQL leave/allocation races with observed blocking, not timing guesses."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from queue import Queue
from threading import get_ident
from time import monotonic, sleep
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select, text

from app.core.config import settings
from app.models import DutyAssignment, LeaveRequest, NormalizationEvent, Person, PersonPosting, RotaComputeJob, UserAccount
from app.services import leave_approval, rota_compute as compute
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot
from app.services.rota_auto_fill import run_safe_auto_fill
from tests.test_import_concurrency import postgres_client as postgres_client
from tests.test_rota_compute_concurrency import seed


def pending(db, person, day=date(2026,5,20)):
    row = LeaveRequest(person=person, starts_on=day, ends_on=day, leave_slot="FULL_DAY",
                       leave_type="CASUAL_LEAVE", status="requested")
    db.add(row)
    db.commit()
    return row.id


def pid(db):
    return db.scalar(text("SELECT pg_backend_pid()"))


def assert_waiting(factory, waiter, holder, future):
    deadline = monotonic() + 15
    while monotonic() < deadline:
        with factory() as observer:
            if holder in observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter}):
                return
        if future.done():
            pytest.fail(f"Operation completed before the holder released its lock: {future.result()}")
        sleep(.03)
    pytest.fail("PostgreSQL did not report the expected blocking transaction")


def setup_job(factory):
    user_id = seed(factory)
    with factory() as db:
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        leave_id = pending(db, person)
        response = compute.create_job(db, "2026-05", db.get(UserAccount, user_id))
        job = db.get(RotaComputeJob, UUID(response["id"]))
        while job.status in {"queued", "running"}:
            compute.advance(db, job, job.revision)
        assert job.status == "completed" and any(row.get("person_id") for row in job.state["decisions"])
        review = leave_approval.preview(db, "2026-05", db.get(UserAccount, user_id))
        return user_id, leave_id, job.id, job.revision, review


@pytest.mark.parametrize("winner", ["approval", "compute"])
def test_reviewed_compute_and_approval_serialize_both_commit_orders(postgres_client, monkeypatch, winner):
    _, factory, _ = postgres_client
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    user_id, leave_id, job_id, revision, review = setup_job(factory)
    waiting_pid = Queue()

    def approve():
        with factory() as db:
            waiting_pid.put(pid(db))
            try:
                result = leave_approval.approve_month(db, "2026-05", db.get(UserAccount, user_id), review["review_token"])
                return "approved", result
            except HTTPException as exc:
                assert exc.status_code == 409
                return "stale", None

    def apply():
        with factory() as db:
            waiting_pid.put(pid(db))
            try:
                user = db.get(UserAccount, user_id)
                result = compute.apply_job(db, compute.owned_job(db, job_id, user), revision, user)
                return "applied", result
            except HTTPException as exc:
                assert exc.status_code == 409
                return "stale", None

    with factory() as holder:
        user = holder.get(UserAccount, user_id)
        if winner == "approval":
            leave_approval.preview(holder, "2026-05", user)
        else:
            compute.owned_job(holder, job_id, user)
            compute.lock_operational_inputs(holder)
        holder_pid = pid(holder)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(apply if winner == "approval" else approve)
            try:
                assert_waiting(factory, waiting_pid.get(timeout=10), holder_pid, future)
                if winner == "approval":
                    leave_approval.approve_month(holder, "2026-05", user, review["review_token"])
                else:
                    compute.apply_job(holder, holder.get(RotaComputeJob, job_id), revision, user)
            finally:
                holder.rollback()  # release even when an assertion fails
            assert future.result(timeout=20)[0] == "stale"
    with factory() as db:
        assert db.get(LeaveRequest, leave_id).status == ("approved" if winner == "approval" else "requested")
        assert db.query(DutyAssignment).count() == (0 if winner == "approval" else 1)
        assert db.query(NormalizationEvent).filter_by(action="leave_bulk_approved").count() == (1 if winner == "approval" else 0)


@pytest.mark.parametrize("path", ["manual", "autofill"])
def test_ordinary_allocation_waits_for_approval_even_with_ot_disabled(postgres_client, monkeypatch, path):
    _, factory, _ = postgres_client
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    user_id = seed(factory)
    with factory() as db:
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        person_id = person.id
        leave_id = pending(db, person, date(2026,5,2))
        slot = next(row for row in compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)
                    if row.duty_date == date(2026,5,2))
        slot_id = slot.id
        # Two of the original four are unavailable after approval. Preserve both
        # absolute minima and the existing 30% warning / 40% hard-block rules:
        # eight eligible identities keep the two absences at 25%.
        for index in range(4):
            reserve = Person(canonical_name=f"Extra recovery reserve {index}", call_level="1ST_CALL")
            db.add(reserve)
            db.flush()
            db.add(PersonPosting(person=reserve, unit_id=slot.unit_id, posting_type="1ST_CALL",
                                 starts_on=date(2026,5,1), source="unit_board"))
        db.commit()
        # Warm the documented bootstrap before measuring the final lock boundary.
        compute.candidate_context(db, "2026-05")
        db.commit()
    waiting_pid = Queue()

    def allocate():
        with factory() as db:
            if path == "autofill":
                # Autofill commits its audit bootstrap and can check out a new
                # pooled connection. Observe the PID at its final lock request.
                owner, reported = get_ident(), False
                def capture(conn, cursor, statement, parameters, context, executemany):
                    nonlocal reported
                    if get_ident() == owner and not reported and "pg_advisory_xact_lock(hashtext('normalization-context'))" in statement:
                        reported = True
                        waiting_pid.put(conn.exec_driver_sql("SELECT pg_backend_pid()").scalar())
                bind = db.get_bind()
                event.listen(bind, "before_cursor_execute", capture)
                try:
                    return run_safe_auto_fill(db, "2026-05")
                finally:
                    event.remove(bind, "before_cursor_execute", capture)
            waiting_pid.put(pid(db))
            try:
                return assign_person_to_slot(db, slot_id=slot_id, person_id=person_id)
            except RotaAssignmentError as exc:
                assert exc.status_code == 409
                return {"status": "rejected"}

    with factory() as holder:
        user = holder.get(UserAccount, user_id)
        review = leave_approval.preview(holder, "2026-05", user)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(allocate)
            try:
                assert_waiting(factory, waiting_pid.get(timeout=10), pid(holder), future)
                leave_approval.approve_month(holder, "2026-05", user, review["review_token"])
            finally:
                holder.rollback()
            result = future.result(timeout=25)
            if path == "manual":
                assert result["status"] == "rejected"
            else:
                assert result["assigned_slots"] == 1, result
    with factory() as db:
        assert db.get(LeaveRequest, leave_id).status == "approved"
        assert db.query(DutyAssignment).filter_by(person_id=person_id).count() == 0
        assert db.query(DutyAssignment).count() == (1 if path == "autofill" else 0)


def test_external_leave_edit_blocks_approval_then_refreshes_preloaded_record(postgres_client):
    _, factory, _ = postgres_client
    user_id = seed(factory)
    with factory() as db:
        person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
        leave_id = pending(db, person)
        review = leave_approval.preview(db, "2026-05", db.get(UserAccount, user_id))
    waiting_pid = Queue()

    def approve():
        with factory() as db:
            cached = db.get(LeaveRequest, leave_id)
            assert cached.leave_slot == "FULL_DAY"
            waiting_pid.put(pid(db))
            try:
                leave_approval.approve_month(db, "2026-05", db.get(UserAccount, user_id), review["review_token"])
            except HTTPException as exc:
                assert exc.status_code == 409
                assert cached.leave_slot == "AM"
                return "stale"
            return "unexpected approval"

    with factory() as holder:
        holder.get(LeaveRequest, leave_id).leave_slot = "AM"
        holder.flush()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(approve)
            try:
                assert_waiting(factory, waiting_pid.get(timeout=10), pid(holder), future)
                holder.commit()
            finally:
                holder.rollback()
            assert future.result(timeout=20) == "stale"
    with factory() as db:
        assert db.get(LeaveRequest, leave_id).status == "requested"
        assert db.get(LeaveRequest, leave_id).leave_slot == "AM"
        assert db.query(NormalizationEvent).filter_by(action="leave_bulk_approved").count() == 0
