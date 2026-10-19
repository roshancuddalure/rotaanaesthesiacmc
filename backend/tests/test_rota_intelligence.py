"""Whole-month choices, review, repair and learning gates against real domain validation."""

from datetime import date
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app.models import DutyAssignment, Person, RotaComputeJob, RotaTeachingExample
from app.services import rota_compute as compute, rota_intelligence as intelligence
from app.services.rota_optimizer import solve_month
from app.services.rota_candidates import candidate_context
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db


def options(**kw):
    return {
        "mode": "balanced",
        "seconds": 3,
        "repair_slots": [],
        "locked_slots": [],
        "preferences": [],
        **kw,
    }


def complete(db, user, **kw):
    result = intelligence.start(db, "2026-05", user, options(**kw))
    job = db.get(RotaComputeJob, UUID(result["id"]))
    compute.advance(db, job, job.revision)
    return job


def test_whole_month_validated_reviewed_and_alternatives(compute_db):
    db, user = compute_db
    job = complete(db, user)
    assert job.status == "completed"
    result = job.state["intelligence"]["alternatives"][0]
    assert result["status"] == "optimal"
    assert len(result["choices"]) == 2
    assert db.query(DutyAssignment).count() == 0
    assert compute.apply_job(db, job, job.revision, dry_run=True)["validated"]
    job.status = "running"
    intelligence.advance(db, job, job.revision)
    alternatives = job.state["intelligence"]["alternatives"]
    assert len(alternatives) == 2
    assert alternatives[0]["choices"] != alternatives[1]["choices"]
    intelligence.select_alternative(db, job, 1, job.revision)
    assert job.state["decisions"] == alternatives[1]["decisions"]
    compute.apply_job(db, job, job.revision)
    assert db.query(DutyAssignment).filter(DutyAssignment.status == "assigned").count() == 2


def test_repair_replaces_only_selected_original_and_keeps_locks(compute_db):
    db, user = compute_db
    slots = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)
    first = slots[0]
    person = db.scalar(select(Person).where(Person.canonical_name == "Blocked Member"))
    old = DutyAssignment(duty_slot=first, person=person, status="assigned")
    db.add(old)
    db.commit()
    job = complete(
        db, user, mode="repair", repair_slots=[str(first.id)], locked_slots=[str(slots[-1].id)]
    )
    assert old.status == "assigned"
    assert any(d.get("original") for d in job.state["decisions"])
    assert compute.apply_job(db, job, job.revision, dry_run=True)["validated"]
    assert old.status == "assigned"
    response = compute.apply_job(db, job, job.revision)
    assert response["result"]["replaced"] == 1
    assert old.status == "cancelled"
    assert not any(
        d.get("person_id") for d in job.state["decisions"] if d["slot_id"] == str(slots[-1].id)
    )


def test_preserve_default_and_invalid_repair_scope(compute_db):
    db, user = compute_db
    slot = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    db.add(DutyAssignment(duty_slot=slot, person=person, status="assigned"))
    db.commit()
    with pytest.raises(HTTPException):
        intelligence.start(
            db,
            "2026-05",
            user,
            options(mode="repair", repair_slots=[str(slot.id)], locked_slots=[str(slot.id)]),
        )
    job = complete(db, user)
    assert (
        next(d for d in job.state["decisions"] if d["slot_id"] == str(slot.id))["action"]
        == "preserved"
    )
    compute.apply_job(db, job, job.revision)
    assert db.query(DutyAssignment).filter_by(duty_slot_id=slot.id).count() == 1


def test_monthly_limits_and_future_conflicts_are_not_relaxed(compute_db):
    db, _ = compute_db
    context = candidate_context(db, "2026-05")
    context.rules.duty_count_limits.max_24hr_per_month = 0
    period, _ = compute.monthly_setup(db, "2026-05")
    slots = {str(s.id): s for s in compute.open_slots_for_period(db, period.id)}
    result = solve_month(db, context, slots, seconds=2)
    assert result["choices"] == {} and result["uncovered"] == len(slots)
    assert result["status"] == "optimal"


def test_teaching_is_reviewed_exceptions_excluded_and_activation_gated(compute_db):
    db, user = compute_db
    job = complete(db, user)
    d = next(d for d in job.state["decisions"] if d.get("person_id"))
    for kind in ["accept", "exception"]:
        result = intelligence.add_example(
            db,
            job,
            user,
            {
                "slot_id": d["slot_id"],
                "kind": kind,
                "preferred_person_id": None,
                "reason": "burden",
                "note": "Test reason",
            },
        )
        row = db.get(RotaTeachingExample, UUID(result["id"]))
        assert row.status == "unverified"
        assert row.data["rule_snapshot"]
        intelligence.approve_example(db, row, user)
    version = intelligence.learning_candidate(db, user)
    assert len(version.data["training_examples"]) == 1
    with pytest.raises(HTTPException):
        intelligence.activate(db, version, user)


def test_global_search_reserves_scarce_candidate(compute_db, monkeypatch):
    """A greedy choice loses coverage; whole-month search must find both assignments."""
    db, _ = compute_db
    import app.services.rota_optimizer as optimizer

    period, _ = compute.monthly_setup(db, "2026-05")
    source = compute.open_slots_for_period(db, period.id)[0]
    second = create_slot(db, source.unit, date(2026, 5, 2), duty_type="CB_1ST_24HR")
    db.commit()
    context = candidate_context(db, "2026-05")
    people = [str(p.id) for p in context.people.values()][:2]

    def candidates(_db, *, slot, context):
        ids = people if slot.id == source.id else people[:1]
        return {
            "candidates": [
                {
                    "person_id": p,
                    "candidate_status": "eligible",
                    "validation_status": "clear",
                    "requires_override": False,
                    "score_parts": {},
                }
                for p in ids
            ]
        }

    monkeypatch.setattr(optimizer, "slot_candidates_with_context", candidates)
    monkeypatch.setattr(optimizer, "validate_plan", lambda *a: [])
    result = optimizer.solve_month(db, context, {str(s.id): s for s in [source, second]}, seconds=2)
    assert result["choices"][str(source.id)] == people[1]
    assert result["choices"][str(second.id)] == people[0]


def test_fit_pairwise_weights_and_deduplicate_feedback(compute_db):
    db, user = compute_db
    job = complete(db, user)
    decision = next(d for d in job.state["decisions"] if d.get("person_id"))
    for _ in range(8):
        db.add(
            RotaTeachingExample(
                job_id=job.id,
                operator_id=user.id,
                status="approved",
                data={
                    "month": "2026-05",
                    "slot_id": decision["slot_id"],
                    "context_hash": job.context_hash,
                    "kind": "prefer",
                    "reason": "burden",
                    "note": "Prefer less burden",
                    "decision": {
                        **decision,
                        "score_parts": {"burden": 10, "historical_fairness": 0},
                    },
                    "preferred_features": {"burden": 0, "historical_fairness": 20},
                },
            )
        )
    db.commit()
    version = intelligence.learning_candidate(db, user)
    assert version.data["pairwise_examples"] == 1
    assert len(version.data["training_examples"]) == 1
    assert version.data["training_agreement"] == 1
    assert version.data["weights"]["burden"] > version.data["weights"]["history"] * 2


def test_global_search_improves_concentrated_incumbent_and_spaces_duties(compute_db, monkeypatch):
    from collections import Counter
    import app.services.rota_optimizer as optimizer

    db, _ = compute_db
    period, _ = compute.monthly_setup(db, "2026-05")
    slots = [s for s in compute.open_slots_for_period(db, period.id) if s.call_level == "1ST_CALL"]
    slots.append(create_slot(db, slots[0].unit, date(2026, 5, 6)))
    db.commit()
    context = candidate_context(db, "2026-05")
    people = list(context.people)[:2]

    # Deliberately supply a concentrated warm start; the global search must improve it.
    def candidates(_db, *, slot, context):
        return {
            "candidates": [
                {
                    "person_id": str(p),
                    "candidate_status": "eligible",
                    "validation_status": "clear",
                    "requires_override": False,
                    "score_parts": {},
                }
                for p in people
            ]
        }

    monkeypatch.setattr(optimizer, "slot_candidates_with_context", candidates)
    monkeypatch.setattr(optimizer, "validate_plan", lambda *args: [])
    result = optimizer.solve_month(db, context, {str(s.id): s for s in slots}, seconds=3)
    counts = Counter(result["choices"].values())
    assert sorted(counts.values()) == [1, 2]
    assert result["status"] == "optimal"
    paired = [
        s.duty_date for s in slots if result["choices"][str(s.id)] == counts.most_common(1)[0][0]
    ]
    assert abs((paired[1] - paired[0]).days) == 4


def test_heldout_evaluation_activation_and_rollback(compute_db):
    from datetime import datetime, timedelta
    from app.models import DutySlot

    db, user = compute_db
    source = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    for day in [7, 10, 13, 16, 19, 22]:
        create_slot(db, source.unit, date(2026, 5, day))
    db.commit()
    job = complete(db, user)
    decisions = [d for d in job.state["decisions"] if d.get("person_id")][:6]
    assert len(decisions) == 6
    for d in decisions:
        result = intelligence.add_example(
            db,
            job,
            user,
            {
                "slot_id": d["slot_id"],
                "kind": "accept",
                "preferred_person_id": None,
                "reason": "burden",
                "note": "Approved valid case",
            },
        )
        intelligence.approve_example(db, db.get(RotaTeachingExample, UUID(result["id"])), user)
    for month in ["2026-06", "2026-07"]:
        period, _ = compute.monthly_setup(db, month)
        start = datetime.fromisoformat(month + "-04T08:00:00")
        db.add(
            DutySlot(
                rota_period=period,
                unit=source.unit,
                duty_date=start.date(),
                duty_type=source.duty_type,
                call_level=source.call_level,
                slot_label="heldout",
                starts_at=start,
                ends_at=start + timedelta(hours=24),
                is_24hr=True,
                source="phase4_template",
            )
        )
    db.commit()
    version = intelligence.learning_candidate(db, user)
    with pytest.raises(HTTPException):
        intelligence.evaluate(db, version, user, ["2026-05", "2026-06"])
    report = intelligence.evaluate(db, version, user, ["2026-06", "2026-07"])
    assert report["passed"] and len(report["results"]) == 2
    assert db.query(DutyAssignment).count() == 0
    intelligence.activate(db, version, user)
    assert version.status == "active"
    next_version = intelligence.learning_candidate(db, user)
    intelligence.evaluate(db, next_version, user, ["2026-06", "2026-07"])
    intelligence.activate(db, next_version, user)
    assert version.status == "retired" and next_version.status == "active"
    intelligence.activate(db, version, user, rollback=True)
    assert version.status == "active" and next_version.status == "retired"
    candidate = intelligence.learning_candidate(db, user)
    intelligence.evaluate(db, candidate, user, ["2026-06", "2026-07"])
    person = db.scalar(select(Person).limit(1))
    person.canonical_name += " updated"
    db.commit()
    with pytest.raises(HTTPException):
        intelligence.activate(db, candidate, user)


def test_api_authorization_flags_and_private_assistant_context(compute_db):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.api.v1.auth import current_user
    from app.db.session import get_db
    from app.core.config import settings

    db, user = compute_db
    app = create_app()

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        assert client.get("/api/v1/rota-intelligence/setup?month=2026-05").status_code == 401
        app.dependency_overrides[current_user] = lambda: user
        assert (
            client.post("/api/v1/rota-intelligence/jobs", json={"month": "bad"}).status_code == 422
        )
        assert (
            client.post(
                "/api/v1/rota-intelligence/jobs", json={"month": "2026-05", "seconds": 121}
            ).status_code
            == 422
        )
        job = complete(db, user)
        assert (
            client.post(
                f"/api/v1/rota-intelligence/jobs/{job.id}/select",
                json={"revision": job.revision - 1, "index": 0},
            ).status_code
            == 409
        )
        user.role = "rota_board_member"
        assert client.post("/api/v1/rota-intelligence/learning", json={}).status_code == 403
        context = client.get("/api/v1/rota-intelligence/assistant-context?month=2026-05").json()
        assert "Safe Member" not in str(context) and "person_id" not in str(context)
        previous = settings.rota_intelligence_enabled
        settings.rota_intelligence_enabled = False
        try:
            assert client.get("/api/v1/rota-intelligence/setup?month=2026-05").status_code == 503
            assert (
                client.post(
                    f"/api/v1/rota-compute/jobs/{job.id}/step", json={"revision": job.revision}
                ).status_code
                == 503
            )
            assert (
                client.post(f"/api/v1/rota-compute/jobs/{job.id}/cancel", json={}).status_code
                == 200
            )
        finally:
            settings.rota_intelligence_enabled = previous


def test_calendar_is_explicit_versioned_and_invalidates_proposals(compute_db):
    db, user = compute_db
    job = complete(db, user)
    assert intelligence.calendar(db) == []
    intelligence.save_calendar(db, user, ["2026-05-04", "2026-05-04"])
    assert intelligence.calendar(db) == ["2026-05-04"]
    with pytest.raises(HTTPException):
        compute.apply_job(db, job, job.revision)
    assert db.query(DutyAssignment).count() == 0


def test_new_choices_cannot_break_staffing_of_preserved_duty(compute_db):
    db, _ = compute_db
    period, _ = compute.monthly_setup(db, "2026-05")
    target = next(
        s for s in compute.open_slots_for_period(db, period.id) if s.duty_date == date(2026, 5, 4)
    )
    old = create_slot(db, target.unit, date(2026, 5, 5))
    target.unit.minimum_free_people = 4
    person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    db.add(DutyAssignment(duty_slot=old, person=person, status="assigned"))
    db.commit()
    context = candidate_context(db, "2026-05")
    context.rules.unit_staffing_rules.minimum_available_count = 4
    result = solve_month(db, context, {str(target.id): target}, seconds=3)
    assert result["choices"] == {} and result["cuts"] > 0
    assert db.query(DutyAssignment).count() == 1


def test_new_choices_protect_next_month_staffing(compute_db, monkeypatch):
    from datetime import datetime
    from app.models import DutySlot
    import app.services.rota_optimizer as optimizer

    db, _ = compute_db
    period, _ = compute.monthly_setup(db, "2026-05")
    source = compute.open_slots_for_period(db, period.id)[0]
    target = create_slot(db, source.unit, date(2026, 5, 31))
    june, _ = compute.monthly_setup(db, "2026-06")
    old = DutySlot(
        rota_period=june,
        unit=source.unit,
        duty_date=date(2026, 6, 1),
        duty_type=source.duty_type,
        call_level="1ST_CALL",
        slot_label="Preserve June coverage",
        starts_at=datetime(2026, 6, 1, 8),
        ends_at=datetime(2026, 6, 2, 8),
        is_24hr=True,
        source="phase4_template",
    )
    source.unit.minimum_free_people = 4
    db.add(old)
    person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    db.add(DutyAssignment(duty_slot=old, person=person, status="assigned"))
    db.commit()

    def context_for_month(session, month):
        context = candidate_context(session, month)
        context.rules.unit_staffing_rules.minimum_available_count = 4
        return context

    monkeypatch.setattr(optimizer, "candidate_context", context_for_month)
    context = context_for_month(db, "2026-05")
    result = optimizer.solve_month(db, context, {str(target.id): target}, seconds=3)
    assert result["choices"] == {} and result["cuts"] > 0
    assert db.query(DutyAssignment).count() == 1


def test_locked_unfilled_duties_remain_visible_as_uncovered(compute_db):
    db, user = compute_db
    target = compute.open_slots_for_period(db, compute.monthly_setup(db, "2026-05")[0].id)[0]
    job = complete(db, user, locked_slots=[str(target.id)])
    decision = next(d for d in job.state["decisions"] if d["slot_id"] == str(target.id))
    assert decision["action"] == "unresolved" and "locked" in decision["reason"]
    assert job.state["intelligence"]["alternatives"][0]["uncovered"] >= 1


def test_apply_independently_rejects_damage_to_a_preserved_duty(compute_db):
    db, user = compute_db
    period, _ = compute.monthly_setup(db, "2026-05")
    target = next(
        s for s in compute.open_slots_for_period(db, period.id) if s.duty_date == date(2026, 5, 4)
    )
    old = create_slot(db, target.unit, date(2026, 5, 5))
    target.unit.minimum_free_people = 4
    person = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    db.add(DutyAssignment(duty_slot=old, person=person, status="assigned"))
    db.commit()
    job = complete(db, user)
    candidate = db.scalar(select(Person).where(Person.canonical_name == "Spare One"))
    state = {**job.state, "decisions": [dict(d) for d in job.state["decisions"]]}
    decision = next(d for d in state["decisions"] if d["slot_id"] == str(target.id))
    decision.update(
        person_id=str(candidate.id), person_name=candidate.canonical_name, action="proposed"
    )
    job.state = state
    db.commit()
    with pytest.raises(HTTPException, match="preserved duty"):
        compute.apply_job(db, job, job.revision, dry_run=True)
    assert db.query(DutyAssignment).count() == 1


def test_feedback_after_apply_keeps_original_frozen_inputs(compute_db):
    db, user = compute_db
    job = complete(db, user)
    decision = next(d for d in job.state["decisions"] if d.get("person_id"))
    assert job.state["intelligence"]["input_snapshot"]["availability"]["recorded_duties"] == []
    compute.apply_job(db, job, job.revision)
    result = intelligence.add_example(
        db,
        job,
        user,
        {
            "slot_id": decision["slot_id"],
            "kind": "accept",
            "preferred_person_id": None,
            "reason": "burden",
            "note": "Approved after applying draft",
        },
    )
    row = db.get(RotaTeachingExample, UUID(result["id"]))
    assert row.data["availability_snapshot"]["recorded_duties"] == []
    assert db.query(DutyAssignment).count() == 2


def test_historical_examples_require_explicit_context_review_and_can_be_excluded(compute_db):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.api.v1.auth import current_user
    from app.db.session import get_db

    db, user = compute_db
    job = complete(db, user)
    compute.apply_job(db, job, job.revision)
    period, _ = compute.monthly_setup(db, "2026-05")
    period.status = "historical"
    db.commit()
    app = create_app()

    def database():
        yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = lambda: user
    with TestClient(app) as client:
        assert "2026-05" in client.get("/api/v1/rota-intelligence/history-months").json()
        result = client.post(
            "/api/v1/rota-intelligence/teaching/history", json={"month": "2026-05"}
        )
        assert result.status_code == 200 and result.json()["prepared"] == 2
        assert (
            client.post(
                "/api/v1/rota-intelligence/teaching/history", json={"month": "2026-05"}
            ).json()["prepared"]
            == 0
        )
        row = client.get("/api/v1/rota-intelligence/teaching").json()[0]
        assert row["historical_policy_unknown"] and row["status"] == "unverified"
        path = f"/api/v1/rota-intelligence/teaching/{row['id']}"
        assert client.post(path + "/approve", json={}).status_code == 409
        assert (
            client.post(path + "/approve", json={"historical_context_verified": True}).status_code
            == 200
        )
        assert client.post(path + "/reject", json={}).status_code == 200
        assert intelligence.learning_candidate(db, user).data["training_examples"] == []
