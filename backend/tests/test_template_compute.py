from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import (
    DutySlot,
    DutyAssignment,
    RotaComputeJob,
    UserAccount,
    RotaTemplateGenerationRun,
)
from app.services import rota_compute as compute, template_compute as template
from app.services.compute_kernels import ranks
from app.services.rota_template import (
    TemplateGenerationOptions,
    generate_empty_template,
    clear_template_cache,
)
from app.services.rota_setup import monthly_setup
from tests.test_rota_template import seed_template_context, lock_month_scope


@pytest.fixture
def template_db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        included, excluded, _ = seed_template_context(db)
        lock_month_scope(db, included, excluded)
        user = UserAccount(
            id=uuid4(),
            username="planner",
            display_name="Planner",
            role="computer_admin",
            password_hash="test",
        )
        db.add(user)
        db.commit()
        yield db, user
    engine.dispose()


CONFIG = {
    "duty_keys": ["MAIN_1ST_24HR"],
    "starts_on": "2026-05-01",
    "ends_on": "2026-05-04",
    "replace_existing": True,
}


def finish(db, user, engine):
    response = template.start(db, "2026-05", user, CONFIG, engine)
    job = db.get(RotaComputeJob, UUID(response["id"]))
    while job.status in {"queued", "running"}:
        pending = compute.serialize(job)["frame"]
        compute.advance(
            db,
            job,
            job.revision,
            ranks(pending["rows"], pending["ties"]).index(0) if pending else None,
            pending["token"] if pending else None,
        )
    return job


@pytest.mark.parametrize("engine", ["server", "local_gpu"])
def test_preview_has_no_operational_writes_apply_is_atomic_idempotent(template_db, engine):
    db, user = template_db
    job = finish(db, user, engine)
    assert db.query(DutySlot).count() == 0
    assert db.query(RotaTemplateGenerationRun).count() == 0
    assert db.query(DutyAssignment).count() == 0
    assert job.state["template"]["slots"]
    compute.apply_job(db, job, job.revision, user, dry_run=True)
    assert db.query(DutySlot).count() == 0
    result = compute.apply_job(db, job, job.revision, user)
    assert result["status"] == "applied"
    count = db.query(DutySlot).count()
    assert count > 0 and db.query(DutyAssignment).count() == 0
    assert compute.apply_job(db, job, job.revision, user)["status"] == "applied"
    assert db.query(DutySlot).count() == count


def test_rejects_wrong_gpu_choice_then_recovers_without_apply(template_db):
    db, user = template_db
    response = template.start(db, "2026-05", user, CONFIG, "local_gpu")
    job = db.get(RotaComputeJob, UUID(response["id"]))
    compute.advance(db, job, 0)
    pending = compute.serialize(job)["frame"]
    assert pending
    revision = job.revision
    with pytest.raises(HTTPException):
        compute.advance(db, job, revision, 99999, pending["token"])
    assert job.revision == revision
    compute.advance(db, job, revision, fallback=True)
    assert job.status == "completed" and job.engine == "server"
    assert db.query(DutySlot).count() == 0


def test_stale_input_rejects_template_apply(template_db):
    db, user = template_db
    job = finish(db, user, "server")
    period, _ = monthly_setup(db, "2026-05")
    period.status = "published"
    db.commit()
    with pytest.raises(HTTPException):
        compute.apply_job(db, job, job.revision, user)
    assert db.query(DutySlot).count() == 0


def test_published_generation_and_clear_are_rejected(template_db):
    db, _ = template_db
    period, _ = monthly_setup(db, "2026-05")
    period.status = "published"
    db.commit()
    for action in [
        lambda: generate_empty_template(db, "2026-05", TemplateGenerationOptions()),
        lambda: clear_template_cache(db, "2026-05"),
    ]:
        with pytest.raises(ValueError, match="unpublished"):
            action()


def test_signed_lexicographic_extremes_and_ordered_objectives():
    assert ranks(
        [[-2147483648, 2147483647], [-2147483647, -2147483648], [-2147483648, 2147483647]],
        [2, 1, 0],
    ) == [1, 2, 0]
    assert ranks([[0, 100000], [1, -100000]], [0, 1]) == [0, 1]
