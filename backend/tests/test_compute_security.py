"""Adversarial coverage of compute admission, transport and trust boundaries."""

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.v1.auth import current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import DutyAssignment, RotaComputeJob
from app.services import rota_compute as compute
from app.services.compute_limits import ComputeLimiter
from tests.test_rota_compute import compute_db as seed_compute_db


@pytest.fixture
def compute_db():
    yield from seed_compute_db.__wrapped__()


@pytest.fixture
def client(compute_db):
    db, operator = compute_db
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[current_user] = lambda: operator
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(
    "payload",
    [
        {"month": "2026-13"},
        {"month": "2026-00"},
        {"month": "2026-5"},
        {"month": "2026-05", "engine": "cuda"},
        {"month": "2026-05", "shader": "malicious"},
        {"month": "2026-05", "operator_id": "another"},
        {"month": ["2026-05"]},
        {"month": "2026-05", "engine": None},
        {"month": "2026-05\n"},
    ],
)
def test_start_rejects_invalid_protocol(client, compute_db, payload):
    assert client.post("/api/v1/rota-compute/jobs", json=payload).status_code == 422
    assert compute_db[0].scalar(select(RotaComputeJob)) is None


@pytest.mark.parametrize(
    "extra",
    [
        {"revision": True},
        {"revision": "0"},
        {"revision": -1},
        {"revision": 2147483648},
        {"revision": 0.0},
        {"selection": True},
        {"selection": 100000},
        {"selection": -1},
        {"token": "a" * 65},
        {"token": "a" * 63},
        {"token": "z" * 64},
        {"fallback": "true"},
        {"fallback": 1},
        {"shader": "custom"},
        {"rows": [[0] * 9]},
    ],
)
def test_step_rejects_invalid_protocol(client, compute_db, extra):
    job = client.post("/api/v1/rota-compute/jobs", json={"month": "2026-05"}).json()
    response = client.post(
        f"/api/v1/rota-compute/jobs/{job['id']}/step", json={"revision": 0, **extra}
    )
    assert response.status_code == 422, response.text
    db, _ = compute_db
    assert db.get(RotaComputeJob, UUID(job["id"])).revision == 0
    assert db.query(DutyAssignment).count() == 0


@pytest.mark.parametrize(
    "path", ["capabilities?month=2026-13", "jobs?month=2026-05evil", "capabilities?month=0000-00"]
)
def test_query_validation(client, path):
    assert client.get("/api/v1/rota-compute/" + path).status_code == 422


def test_streaming_body_limit_does_not_trust_content_length(client, compute_db):
    def chunks():
        yield b'{"month":"2026-05","padding":"'
        yield b"x" * 5000
        yield b'"}'

    result = client.post(
        "/api/v1/rota-compute/jobs", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert result.status_code == 413
    assert result.headers["cache-control"] == "no-store"
    assert compute_db[0].scalar(select(RotaComputeJob)) is None


def test_limiter_isolates_operators_refills_and_bounds_memory():
    now = [0.0]
    limiter = ComputeLimiter(lambda: now[0])
    for _ in range(12):
        limiter.check("first", "start")
    with pytest.raises(HTTPException) as error:
        limiter.check("first", "start")
    assert error.value.status_code == 429 and error.value.headers["Retry-After"] == "25"
    limiter.check("second", "start")
    limiter.check("first", "work")
    now[0] += 25
    limiter.check("first", "start")
    for i in range(11000):
        limiter.check(i, "work")
    assert len(limiter.buckets) == 10000
    now[0] += 601
    limiter.check("after-expiry", "work")
    assert len(limiter.buckets) == 1


def test_rate_limit_preserves_get_cancel_and_assignments(client, compute_db):
    job = client.post("/api/v1/rota-compute/jobs", json={"month": "2026-05"}).json()
    limiter = ComputeLimiter(lambda: 0)
    client.app.state.compute_limiter = limiter
    operator = compute_db[1]
    for _ in range(60):
        limiter.check(operator.id, "work")
    result = client.post(f"/api/v1/rota-compute/jobs/{job['id']}/step", json={"revision": 0})
    assert result.status_code == 429 and result.headers["Retry-After"] == "1"
    assert client.get("/api/v1/rota-compute/capabilities?month=2026-05").status_code == 429
    assert client.get("/api/v1/rota-compute/capabilities").status_code == 200
    assert client.get(f"/api/v1/rota-compute/jobs/{job['id']}").status_code == 200
    assert (
        client.post(f"/api/v1/rota-compute/jobs/{job['id']}/cancel").json()["status"] == "cancelled"
    )
    assert compute_db[0].query(DutyAssignment).count() == 0


def test_slow_request_body_times_out_without_executing_application():
    import asyncio
    from app.security import ComputeSecurityMiddleware

    async def scenario():
        messages = []

        async def receive():
            await asyncio.sleep(60)

        async def forbidden_app(*args):
            pytest.fail("Timed-out body reached the application")

        async def send(message):
            messages.append(message)

        middleware = ComputeSecurityMiddleware(forbidden_app)
        middleware.body_timeout = 0.01
        await middleware(
            {
                "type": "http",
                "path": "/api/v1/rota-compute/jobs",
                "method": "POST",
                "scheme": "https",
            },
            receive,
            send,
        )
        assert messages[0]["status"] == 408
        assert (b"cache-control", b"no-store") in messages[0]["headers"]

    asyncio.run(scenario())


def test_durable_active_proposal_quota(compute_db):
    db, operator = compute_db
    for month in ["2026-01", "2026-02", "2026-03"]:
        db.add(
            RotaComputeJob(month=month, operator_id=operator.id, context_hash="0" * 64, state={})
        )
    db.commit()
    with pytest.raises(HTTPException) as error:
        compute.create_job(db, "2026-05", operator)
    assert error.value.status_code == 429
    assert db.query(DutyAssignment).count() == 0


def test_production_security_headers_and_exact_origin_cors(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "frontend_origin", "https://rota.example")
    with TestClient(create_app(), base_url="https://rota.example") as client:
        response = client.get("/api/v1/rota-compute/capabilities")
        assert response.status_code == 401
        policy = response.headers["content-security-policy"]
        assert "worker-src 'self'" in policy and "script-src 'self'" in policy
        assert "connect-src 'self' http://127.0.0.1:*" in policy
        assert (
            "unsafe-eval" not in policy
            and "unsafe-inline" not in policy.split("script-src")[1].split(";")[0]
        )
        assert response.headers["strict-transport-security"] == "max-age=31536000"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "no-store"
        for origin, expected in [
            ("https://rota.example", 200),
            ("http://localhost:5173", 400),
            ("https://evil.example", 400),
        ]:
            preflight = client.options(
                "/api/v1/rota-compute/jobs",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            assert preflight.status_code == expected


def test_cross_user_mutations_rejected(client, compute_db):
    job = client.post("/api/v1/rota-compute/jobs", json={"month": "2026-05"}).json()
    db, operator = compute_db
    from app.models import UserAccount

    other = UserAccount(id=uuid4(), username="different", role="computer_admin")
    client.app.dependency_overrides[current_user] = lambda: other
    for action in ["step", "validate", "apply", "cancel"]:
        response = client.post(
            f"/api/v1/rota-compute/jobs/{job['id']}/{action}", json={"revision": 0}
        )
        assert response.status_code == 403
    assert db.query(DutyAssignment).count() == 0


def test_tampered_gpu_result_and_token_then_server_recovery(client, compute_db):
    job = client.post(
        "/api/v1/rota-compute/jobs", json={"month": "2026-05", "engine": "local_gpu"}
    ).json()
    path = f"/api/v1/rota-compute/jobs/{job['id']}/step"
    frame = client.post(path, json={"revision": 0}).json()
    for selection, token in [(99999, frame["frame"]["token"]), (0, "0" * 64)]:
        assert (
            client.post(
                path, json={"revision": frame["revision"], "selection": selection, "token": token}
            ).status_code
            == 422
        )
    assert (
        client.get(f"/api/v1/rota-compute/jobs/{job['id']}").json()["revision"] == frame["revision"]
    )
    recovered = client.post(path, json={"revision": frame["revision"], "fallback": True}).json()
    assert recovered["engine"] == "server" and recovered["status"] == "completed"
    assert compute_db[0].query(DutyAssignment).count() == 0
