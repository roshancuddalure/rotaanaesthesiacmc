from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, LeaveRequest, Person, RotaComputeJob, UserAccount
from app.services import rota_compute as compute
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from tests.test_rota_auto_fill import seed_auto_fill_context, create_slot


@pytest.fixture
def compute_db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first, _ = seed_auto_fill_context(db)
        create_slot(db, first.unit, date(2026, 5, 4))
        operator = UserAccount(
            id=uuid4(),
            username="compute-admin",
            display_name="Compute admin",
            role="computer_admin",
            password_hash="test",
        )
        db.add(operator)
        db.commit()
        yield db, operator
    engine.dispose()


def complete(db, user, engine="server"):
    response = compute.create_job(db, "2026-05", user, engine)
    job = db.get(RotaComputeJob, UUID(response["id"]))
    while job.status in {"queued", "running"}:
        pending = job.state.get("pending")
        compute.advance(
            db,
            job,
            job.revision,
            pending["winner"] if pending else None,
            pending["public"]["token"] if pending else None,
        )
    return job


def test_cached_candidates_match_reference_and_remove_queries(compute_db):
    db, _ = compute_db
    context = candidate_context(db, "2026-05")
    slot = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    counts = []

    def count(*_):
        counts.append(1)

    event.listen(db.get_bind(), "before_cursor_execute", count)
    try:
        reference = slot_candidates_with_context(db, slot=slot, context=context, optimized=False)
        old = len(counts)
        counts.clear()
        actual = slot_candidates_with_context(db, slot=slot, context=context)
        new = len(counts)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", count)
    assert actual == reference
    assert new < old / 2, (new, old)


@pytest.mark.parametrize("conflict", ["previous", "future", "inactive", "partial_leave"])
def test_cached_and_reference_validation_agree_on_hard_cases(compute_db, conflict):
    db, _ = compute_db
    target = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    person = db.scalars(select(Person).where(Person.canonical_name == "Safe Member")).one()
    if conflict in {"previous", "future"}:
        day = date(2026, 5, 1) if conflict == "previous" else date(2026, 5, 3)
        other = create_slot(db, target.unit, day)
        db.add(DutyAssignment(duty_slot=other, person=person, status="assigned"))
    elif conflict == "inactive":
        person.active_status = "inactive"
    else:
        db.add(
            LeaveRequest(
                person=person,
                leave_type="CASUAL_LEAVE",
                leave_slot="AM",
                starts_on=target.duty_date,
                ends_on=target.duty_date,
                status="approved",
            )
        )
    db.commit()
    context = candidate_context(db, "2026-05")
    reference = slot_candidates_with_context(db, slot=target, context=context, optimized=False)
    actual = slot_candidates_with_context(db, slot=target, context=context)
    assert actual == reference
    assert not any(
        c["person_id"] == str(person.id) and c["validation_status"] == "clear"
        for c in actual["candidates"]
    )


def test_cancelled_duplicate_does_not_hide_an_active_duty(compute_db):
    from app.services.history_fairness import nearby_duties

    db, _ = compute_db
    target = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    person = db.scalars(select(Person).where(Person.canonical_name == "Safe Member")).one()
    old = create_slot(db, target.unit, date(2026, 5, 1), call_level="1ST_CALL")
    active = create_slot(db, target.unit, date(2026, 5, 1), call_level="2ND_CALL")
    db.add_all(
        [
            DutyAssignment(duty_slot=old, person=person, status="cancelled"),
            DutyAssignment(duty_slot=active, person=person, status="assigned"),
        ]
    )
    db.commit()
    context = candidate_context(db, "2026-05")
    assert [s.id for s in nearby_duties(db, target, person.id, 24)] == [active.id]
    assert [
        s.id
        for s in nearby_duties(
            db, target, person.id, 24, assignments=context.nearby_assignments[person.id]
        )
    ] == [active.id]
    assert len(context.assignments_by_person[person.id]) == 1


def test_plan_never_writes_and_apply_is_reviewed_atomic_idempotent(compute_db):
    db, user = compute_db
    job = complete(db, user)
    assert compute.serialize(job)["proposed"] == 2
    burden = compute.serialize(job)["burden"]
    assert burden["members"] == 4
    assert burden["before"]["total"]["mean"] == 0
    assert burden["after"]["total"]["mean"] == 0.5
    assert db.query(DutyAssignment).count() == 0
    assert any(d["action"] == "unresolved" for d in job.state["decisions"])
    with pytest.raises(HTTPException):
        compute.apply_job(db, job, job.revision - 1)
    validated = compute.apply_job(db, job, job.revision, dry_run=True)
    assert validated["validated"] and db.query(DutyAssignment).count() == 0
    result = compute.apply_job(db, job, job.revision)
    assert result["status"] == "applied" and result["result"]["assigned"] == 2
    assert compute.apply_job(db, job, 0)["result"]["assigned"] == 2
    assert db.query(DutyAssignment).count() == 2
    assert compute.cancel(db, job)["status"] == "applied"
    assert db.query(DutyAssignment).count() == 2
    assert compute.monthly_setup(db, "2026-05")[0].status == "draft"


def test_local_gpu_frames_are_numeric_and_match_server_decisions(compute_db):
    db, user = compute_db
    server = complete(db, user)
    decisions = [(d["slot_id"], d["person_id"], d["score"]) for d in server.state["decisions"]]
    compute.cancel(db, server)
    response = compute.create_job(db, "2026-05", user, "local_gpu")
    job = db.get(RotaComputeJob, UUID(response["id"]))
    compute.advance(db, job, 0)
    frame = job.state["pending"]["public"]
    assert set(frame) == {"token", "rows", "ties"}
    assert all(len(row) == 9 and all(isinstance(n, int) for n in row) for row in frame["rows"])
    with pytest.raises(HTTPException):
        compute.advance(db, job, job.revision, 999, "bad")
    while job.status != "completed":
        frame = job.state["pending"]["public"]
        winner = min(
            range(len(frame["rows"])), key=lambda i: (sum(frame["rows"][i]), frame["ties"][i])
        )
        compute.advance(db, job, job.revision, winner, frame["token"])
    assert [(d["slot_id"], d["person_id"], d["score"]) for d in job.state["decisions"]] == decisions


def test_gpu_failure_can_continue_on_server(compute_db):
    db, user = compute_db
    result = compute.create_job(db, "2026-05", user, "local_gpu")
    job = db.get(RotaComputeJob, UUID(result["id"]))
    compute.advance(db, job, 0)
    assert job.state.get("pending")
    response = compute.advance(db, job, job.revision, fallback=True)
    assert response["status"] == "completed" and response["engine"] == "server"
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize("change", ["leave", "rules", "assignment", "publish"])
def test_changed_snapshot_rejects_apply_without_partial_writes(compute_db, change):
    db, user = compute_db
    job = complete(db, user)
    if change == "leave":
        member = db.scalars(select(Person)).first()
        db.add(
            LeaveRequest(
                person=member,
                leave_type="CASUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 5, 2),
                ends_on=date(2026, 5, 2),
                status="approved",
            )
        )
    elif change == "rules":
        from app.models import RuleSetting

        setting = db.scalars(select(RuleSetting)).first()
        setting.description = "Edited after preview"
    elif change == "publish":
        compute.monthly_setup(db, "2026-05")[0].status = "published"
    else:
        d = next(d for d in job.state["decisions"] if d.get("person_id"))
        db.add(DutyAssignment(duty_slot_id=UUID(d["slot_id"]), person_id=UUID(d["person_id"])))
    db.commit()
    count = db.query(DutyAssignment).count()
    with pytest.raises(HTTPException) as exc:
        compute.apply_job(db, job, job.revision)
    assert exc.value.status_code == 409
    assert db.query(DutyAssignment).count() == count


def test_cancel_expiry_duplicates_ownership_and_retry(compute_db):
    db, user = compute_db
    first = compute.create_job(db, "2026-05", user)
    job = db.get(RotaComputeJob, UUID(first["id"]))
    with pytest.raises(HTTPException):
        compute.create_job(db, "2026-05", user)
    other = UserAccount(id=uuid4(), role="computer_admin")
    with pytest.raises(HTTPException):
        compute.owned_job(db, job.id, other)
    response = compute.advance(db, job, 0, batch=1)
    assert compute.advance(db, job, 0) == response
    compute.cancel(db, job)
    assert compute.advance(db, job, job.revision)["status"] == "cancelled"
    second = compute.create_job(db, "2026-05", user)
    job = db.get(RotaComputeJob, UUID(second["id"]))
    job.created_at -= timedelta(hours=3)
    db.commit()
    with pytest.raises(HTTPException):
        compute.advance(db, job, job.revision)
    assert job.status == "failed"


def test_final_validation_failure_rolls_back_entire_proposal(compute_db, monkeypatch):
    db, user = compute_db
    job = complete(db, user)
    real = compute.validate_assignment
    calls = []

    def validate(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs) if len(calls) == 1 else {"status": "blocked"}

    monkeypatch.setattr(compute, "validate_assignment", validate)
    with pytest.raises(HTTPException):
        compute.apply_job(db, job, job.revision)
    assert db.query(DutyAssignment).count() == 0 and job.status == "completed"


def test_api_permissions_resumption_failure_state_and_feature_flags(compute_db, monkeypatch):
    from app.core.config import settings

    db, user = compute_db
    factory = sessionmaker(bind=db.get_bind())

    def database():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = database
    try:
        client = TestClient(app)
        assert client.get("/api/v1/rota-compute/capabilities").status_code == 401
        app.dependency_overrides[current_user] = lambda: user
        monkeypatch.setattr(settings, "browser_gpu_enabled", False)
        assert (
            client.post(
                "/api/v1/rota-compute/jobs", json={"month": "2026-05", "engine": "local_gpu"}
            ).status_code
            == 403
        )
        monkeypatch.setattr(settings, "browser_gpu_enabled", True)
        board = UserAccount(
            id=user.id, username="board", display_name="Board", role="rota_board_member"
        )
        app.dependency_overrides[current_user] = lambda: board
        assert (
            client.post(
                "/api/v1/rota-compute/jobs", json={"month": "2026-05", "engine": "local_gpu"}
            ).status_code
            == 403
        )
        app.dependency_overrides[current_user] = lambda: user
        local = client.post(
            "/api/v1/rota-compute/jobs", json={"month": "2026-05", "engine": "local_gpu"}
        ).json()
        frame = client.post(
            f"/api/v1/rota-compute/jobs/{local['id']}/step", json={"revision": 0}
        ).json()
        assert frame["frame"]["rows"]
        monkeypatch.setattr(settings, "browser_gpu_enabled", False)
        fallback = client.post(
            f"/api/v1/rota-compute/jobs/{local['id']}/step", json={"revision": frame["revision"]}
        ).json()
        assert fallback["engine"] == "server" and fallback["status"] == "completed"
        assert db.query(DutyAssignment).count() == 0
        client.post(f"/api/v1/rota-compute/jobs/{local['id']}/cancel")
        result = client.post("/api/v1/rota-compute/jobs", json={"month": "2026-05"})
        assert result.status_code == 200, result.text
        job_id = result.json()["id"]
        assert client.get("/api/v1/rota-compute/jobs?month=2026-05").json()[0]["id"] == job_id
        assert client.get(f"/api/v1/rota-compute/jobs/{job_id}").json()["status"] == "queued"

        def fail(*_, **__):
            raise RuntimeError("test injected failure")

        monkeypatch.setattr(compute, "choose_candidates", fail)
        assert (
            client.post(
                f"/api/v1/rota-compute/jobs/{job_id}/step", json={"revision": 0}
            ).status_code
            == 500
        )
        assert client.get(f"/api/v1/rota-compute/jobs/{job_id}").json()["status"] == "failed"
        assert db.query(DutyAssignment).count() == 0
        monkeypatch.setattr(settings, "rota_compute_enabled", False)
        assert client.get("/api/v1/rota-compute/jobs?month=2026-05").status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_conflict_detail_lets_the_generator_offer_resume_and_cancel(compute_db):
    db, user = compute_db
    first = compute.create_job(db, "2026-05", user)
    with pytest.raises(HTTPException) as raised:
        compute.create_job(db, "2026-05", user)
    detail = raised.value.detail
    assert raised.value.status_code == 409
    assert detail["code"] == "proposal_exists" and detail["job_id"] == first["id"]
    assert detail["kind"] == "members" and detail["status"] == "queued" and detail["owned"] is True
    assert detail["month"] == "2026-05" and "processed" in detail and "total" in detail
    other = UserAccount(id=uuid4(), role="computer_admin")
    with pytest.raises(HTTPException) as raised:
        compute.create_job(db, "2026-05", other)
    assert raised.value.detail["owned"] is False
    assert raised.value.detail["operator_name"] in {None, user.display_name or user.username}
