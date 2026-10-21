"""Cross-stage generation safety, exact scoring and reversible-apply regressions."""

from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, Person, RotaComputeJob
from app.services import rota_compute as compute, rota_intelligence as intelligence
from app.services.generation_undo import revert
from app.services.compute_kernels import ranks
from tests.test_template_compute import template_db as seeded_template_db, finish, CONFIG
from tests.test_rota_compute import compute_db as seeded_compute_db, complete
from tests.test_rota_intelligence import options


@pytest.fixture
def template_db():
    yield from seeded_template_db.__wrapped__()


@pytest.fixture
def compute_db():
    yield from seeded_compute_db.__wrapped__()


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
def test_template_apply_and_reversal_restore_exact_original_slots(template_db, engine):
    db, user = template_db
    job = finish(db, user, engine)
    compute.apply_job(db, job, job.revision, user)
    assert db.query(DutySlot).count() > 0
    checked = revert(db, job, job.revision, user, dry_run=True)
    assert checked["reversal_validated"] and db.query(DutySlot).count() > 0
    result = revert(db, job, job.revision, user)
    assert result["status"] == "reverted" and db.query(DutySlot).count() == 0
    assert revert(db, job, job.revision, user)["status"] == "reverted"


def test_member_apply_reverse_preserves_original_assignments_and_audit(compute_db):
    db, user = compute_db
    job = complete(db, user)
    compute.apply_job(db, job, job.revision, user)
    assert db.query(DutyAssignment).count() > 0
    revert(db, job, job.revision, user)
    assert db.query(DutyAssignment).count() == 0
    assert job.status == "reverted"


def test_reversal_rejects_changed_inputs_without_partial_deletion(compute_db):
    db, user = compute_db
    job = complete(db, user)
    compute.apply_job(db, job, job.revision, user)
    count = db.query(DutyAssignment).count()
    person = db.scalar(select(Person))
    person.canonical_name = "Changed after apply"
    db.commit()
    with pytest.raises(HTTPException, match="changed"):
        revert(db, job, job.revision, user)
    assert db.query(DutyAssignment).count() == count


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
def test_optimizer_gpu_hints_are_validated_and_keep_server_safety(compute_db, engine):
    db, user = compute_db
    started = intelligence.start(db, "2026-05", user, options(engine=engine))
    job = db.get(RotaComputeJob, UUID(started["id"]))
    frames = 0
    while job.status in {"queued", "running"}:
        pending = compute.serialize(job)["frame"]
        if pending:
            frames += 1
            with pytest.raises(HTTPException):
                compute.advance(db, job, job.revision, 99999, pending["token"])
        compute.advance(
            db,
            job,
            job.revision,
            ranks(pending["rows"], pending["ties"]).index(0) if pending else None,
            pending["token"] if pending else None,
        )
    assert (frames > 0) == (engine == "local_gpu")
    assert db.query(DutyAssignment).count() == 0
    assert job.state["intelligence"]["alternatives"][0]["status"] == "optimal"
    assert compute.apply_job(db, job, job.revision, user, dry_run=True)["validated"]
    compute.apply_job(db, job, job.revision, user)
    assert db.query(DutyAssignment).count() == 2


def test_optimizer_pending_frame_can_fall_back_and_replay_revision(compute_db):
    db, user = compute_db
    started = intelligence.start(db, "2026-05", user, options(engine="local_gpu"))
    job = db.get(RotaComputeJob, UUID(started["id"]))
    compute.advance(db, job, 0)
    assert compute.serialize(job)["frame"]
    result = compute.advance(db, job, job.revision, fallback=True)
    assert result["engine"] == "server" and result["status"] == "completed"
    revision = job.revision
    assert compute.advance(db, job, revision - 1)["revision"] == revision
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize(
    "bad",
    [
        {"starts_on": "2026-06-01"},
        {"ends_on": "2026-05-00"},
        {"include_weekdays": "true"},
        {"include_weekends": 1},
        {"duty_keys": []},
        {"duty_keys": [1]},
        {"duty_keys": ["x" * 101]},
        {"allocation_fairness_policy": "made-up"},
        {"starts_on": "2026-05-10", "ends_on": "2026-05-01"},
        {"shader": "custom"},
    ],
)
def test_template_configuration_rejected_before_creating_job(template_db, bad):
    from app.services.template_compute import start

    db, user = template_db
    with pytest.raises((HTTPException, ValueError)):
        start(db, "2026-05", user, {**CONFIG, **bad}, "server")
    assert db.query(RotaComputeJob).count() == 0 and db.query(DutySlot).count() == 0


def test_template_final_mismatch_rolls_back_all_slots(template_db, monkeypatch):
    from app.services import template_compute

    db, user = template_db
    job = finish(db, user, "server")
    original = template_compute.stable_slots
    calls = [0]

    def changed(result):
        calls[0] += 1
        values = original(result)
        if calls[0] == 2:
            values[0]["notes"] = "Injected final mismatch"
        return values

    monkeypatch.setattr(template_compute, "stable_slots", changed)
    with pytest.raises(HTTPException):
        compute.apply_job(db, job, job.revision, user)
    assert db.query(DutySlot).count() == 0 and db.query(DutyAssignment).count() == 0


def test_append_template_cannot_duplicate_duty_in_another_unit(template_db):
    from app.services.rota_template import generate_empty_template, TemplateGenerationOptions
    from datetime import date

    db, _ = template_db
    config = TemplateGenerationOptions(
        duty_keys=CONFIG["duty_keys"], starts_on=date(2026, 5, 1), ends_on=date(2026, 5, 4)
    )
    generate_empty_template(db, "2026-05", config)
    count = db.query(DutySlot).count()
    config.replace_existing = False
    generate_empty_template(db, "2026-05", config)
    assert db.query(DutySlot).count() == count


@pytest.mark.parametrize("kind", ["template", "optimizer"])
def test_batched_numeric_evidence_is_atomic_and_replay_safe(template_db, compute_db, kind):
    from app.services import template_compute

    db, user = template_db if kind == "template" else compute_db
    started = (
        template_compute.start(db, "2026-05", user, CONFIG, "local_gpu")
        if kind == "template"
        else intelligence.start(db, "2026-05", user, options(engine="local_gpu"))
    )
    job = db.get(RotaComputeJob, UUID(started["id"]))
    initial = compute.advance(db, job, 0)
    pending = initial["frame"]
    assert len(pending["batches"]) > 1
    selected = [ranks(frame["rows"], frame["ties"]).index(0) for frame in pending["batches"]]
    corrupted = [*selected[:-1], 99999]
    with pytest.raises(HTTPException):
        compute.advance(db, job, job.revision, token=pending["token"], selections=corrupted)
    assert job.revision == initial["revision"]
    assert job.state["metrics"].get("gpu_frames_verified", 0) == 0
    complete = compute.advance(db, job, job.revision, token=pending["token"], selections=selected)
    assert complete["status"] == "completed"
    assert complete["metrics"]["gpu_frames_verified"] == len(selected)
    assert (
        compute.advance(db, job, initial["revision"], token=pending["token"], selections=selected)[
            "revision"
        ]
        == complete["revision"]
    )
    assert db.query(DutyAssignment).count() == 0


def test_frozen_cross_language_numeric_goldens():
    import json
    from pathlib import Path

    for case in json.loads(
        (Path(__file__).parent / "fixtures/generation_numeric_goldens.json").read_text()
    ):
        actual = (
            ranks(case["rows"], case["ties"])
            if case["kernel"] == "lexicographic"
            else [sum(row) for row in case["rows"]]
        )
        assert actual == case["expected_scores"], case["name"]
        assert (
            min(range(len(actual)), key=lambda i: (actual[i], case["ties"][i]))
            == case["expected_winner"]
        )
