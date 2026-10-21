from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import DutySlot, DutyAssignment, RotaComputeJob, UserAccount, RotaLearningVersion
from tests.test_template_compute import template_db as seeded_template_db, CONFIG


@pytest.fixture
def environment():
    fixture = seeded_template_db.__wrapped__()
    db, user = next(fixture)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[current_user] = lambda: user
    try:
        with TestClient(app) as client:
            yield client, db, user
    finally:
        fixture.close()


def start(client, engine="server"):
    return client.post(
        "/api/v1/rota-compute/jobs",
        json={"month": "2026-05", "kind": "template", "engine": engine, "template_options": CONFIG},
    )


def test_template_api_requires_auth_and_admin_for_gpu(environment):
    client, db, user = environment
    client.app.dependency_overrides.pop(current_user)
    assert start(client).status_code == 401
    board = UserAccount(
        id=user.id, username=user.username, display_name=user.display_name, role="rota_board_member"
    )
    client.app.dependency_overrides[current_user] = lambda: board
    assert start(client, "local_gpu").status_code == 403
    assert db.query(RotaComputeJob).count() == 0


def test_independent_template_feature_flags_and_readable_cancel(environment, monkeypatch):
    client, db, _ = environment
    monkeypatch.setattr(settings, "template_compute_enabled", False)
    assert start(client).status_code == 503
    monkeypatch.setattr(settings, "template_compute_enabled", True)
    monkeypatch.setattr(settings, "template_gpu_enabled", False)
    assert start(client, "local_gpu").status_code == 403
    response = start(client)
    assert response.status_code == 200, response.text
    job = response.json()
    monkeypatch.setattr(settings, "template_compute_enabled", False)
    assert (
        client.post(f"/api/v1/rota-compute/jobs/{job['id']}/step", json={"revision": 0}).status_code
        == 503
    )
    assert client.get(f"/api/v1/rota-compute/jobs/{job['id']}").status_code == 200
    assert (
        client.post(f"/api/v1/rota-compute/jobs/{job['id']}/cancel").json()["status"] == "cancelled"
    )
    assert db.query(DutySlot).count() == 0


def test_gpu_revocation_resumes_template_on_server_and_never_autoapplies(environment, monkeypatch):
    client, db, _ = environment
    job = start(client, "local_gpu").json()
    initial = client.post(
        f"/api/v1/rota-compute/jobs/{job['id']}/step", json={"revision": 0}
    ).json()
    assert initial["frame"]["kernel"] == "lexicographic"
    assert set(initial["frame"]) == {"kernel", "version", "rows", "ties", "token", "batches"}
    monkeypatch.setattr(settings, "template_gpu_enabled", False)
    completed = client.post(
        f"/api/v1/rota-compute/jobs/{job['id']}/step", json={"revision": initial["revision"]}
    ).json()
    assert completed["engine"] == "server" and completed["requested_engine"] == "local_gpu"
    assert completed["status"] == "completed" and completed["proposed"] == 4
    assert db.query(DutySlot).count() == 0 and db.query(DutyAssignment).count() == 0


def test_template_ownership_protects_reads_apply_and_reversal(environment):
    client, db, _ = environment
    job = start(client).json()
    other = UserAccount(id=uuid4(), username="other-planner", role="computer_admin")
    client.app.dependency_overrides[current_user] = lambda: other
    for action in ["step", "validate", "apply", "reversal-check", "revert", "cancel"]:
        assert (
            client.post(
                f"/api/v1/rota-compute/jobs/{job['id']}/{action}", json={"revision": 0}
            ).status_code
            == 403
        )
    assert client.get(f"/api/v1/rota-compute/jobs/{job['id']}").status_code == 403
    assert db.query(DutySlot).count() == 0


def test_optimizer_benchmark_fingerprint_changes_only_with_active_learning(environment):
    client, db, user = environment
    path = "/api/v1/rota-compute/capabilities?month=2026-05"
    original = client.get(path).json()
    learning = RotaLearningVersion(
        operator_id=user.id,
        status="candidate",
        data={"weights": {"burden": 2, "history": 1, "spacing": 1}},
    )
    db.add(learning)
    db.commit()
    candidate = client.get(path).json()
    assert candidate["context_hash"] == original["context_hash"]
    assert candidate["optimizer_context_hash"] == original["optimizer_context_hash"]
    learning.status = "active"
    db.commit()
    activated = client.get(path).json()
    assert activated["context_hash"] == original["context_hash"]
    assert activated["optimizer_context_hash"] != original["optimizer_context_hash"]


def test_unknown_template_rule_has_actionable_error_before_job_creation(environment):
    client, db, _ = environment
    response = client.post(
        "/api/v1/rota-compute/jobs",
        json={
            "month": "2026-05",
            "kind": "template",
            "template_options": {**CONFIG, "duty_keys": ["UNKNOWN_RULE"]},
        },
    )
    assert response.status_code == 422 and "Unknown or inactive" in response.json()["detail"]
    assert db.query(RotaComputeJob).count() == 0


@pytest.mark.parametrize("selections", [[], [0] * 33, [True], [1.5], [-1], [100000], ["0"]])
def test_invalid_batch_schema_never_advances_or_writes(environment, selections):
    client, db, _ = environment
    job = start(client, "local_gpu").json()
    response = client.post(
        f"/api/v1/rota-compute/jobs/{job['id']}/step",
        json={"revision": 0, "selections": selections},
    )
    assert response.status_code == 422
    assert client.get(f"/api/v1/rota-compute/jobs/{job['id']}").json()["revision"] == 0
    assert db.query(DutySlot).count() == 0
