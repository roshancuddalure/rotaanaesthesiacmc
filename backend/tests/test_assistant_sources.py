"""Context minimization includes malformed historical approved example payloads."""

import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.services.assistant_sources import assistant_source_context, score_features
from app.services.rota_rules import default_phase_one_rules
from app.models import RotaTeachingExample
from tests.test_rota_compute import compute_db as compute_db


def example(**data):
    return SimpleNamespace(status="approved", data={"kind": "prefer", "reason": "burden", "decision": {"weekend": True, "score_parts": {"burden": 3}}, **data})


def test_minimized_features_drop_private_text_unknown_keys_invalid_numbers_and_exceptions():
    rows = [example(note="PRIVATE_NOTE", preferred_person_name="PRIVATE_NAME", preferred_features={"burden": 2, "rest": float("nan"), "staffing": float("inf"), "fairness": True, "validation": 1_000_001, "PRIVATE_KEY": "INJECT"}, decision={"weekend": "PRIVATE_WEEKEND", "score_parts": {"burden": 3, "rest": "INJECT", "PRIVATE_KEY": 1}}), example(reason="PRIVATE_REASON"), example(kind="exception"), SimpleNamespace(status="rejected", data=example().data), SimpleNamespace(status="approved", data=None)]
    context = assistant_source_context("2026-05", default_phase_one_rules(), rows)
    assert len(context["examples"]) == 1
    assert context["examples"][0]["proposed_score_components"] == {"burden": 3}
    assert context["examples"][0]["preferred_score_components"] == {"burden": 2}
    assert context["examples"][0]["weekend"] is None
    assert "PRIVATE" not in json.dumps(context) and "INJECT" not in json.dumps(context)
    assert "unit_ot_demand" in context["not_included"]


def test_content_versions_track_actual_minimized_values_not_time_or_private_notes():
    rules = default_phase_one_rules()
    first = assistant_source_context("2026-05", rules, [example(note="first")])
    second = assistant_source_context("2026-05", rules, [example(note="changed")])
    assert first["sources"] == second["sources"]
    rules.duty_count_limits.max_24hr_per_month = 8
    changed = assistant_source_context("2026-05", rules, [example()])
    assert changed["sources"][0] != first["sources"][0]
    assert changed["sources"][1] == first["sources"][1]
    features = assistant_source_context("2026-05", rules, [example(preferred_features={"burden": 2})])
    assert features["sources"][0] == changed["sources"][0]
    assert features["sources"][1] != changed["sources"][1]
    assert len(assistant_source_context("2026-05", rules, [example() for _ in range(8)])["examples"]) == 5


def test_hostile_historical_shapes_are_bounded_and_never_become_model_text():
    assert score_features({"burden": 10**400, "weekend": -1_000_001, "rest": -2, "validation": 0}) == {"rest": -2, "validation": 0}
    assert score_features(["PRIVATE_TEXT"]) == {}
    context = assistant_source_context("2026-05", default_phase_one_rules(), [example(kind={"PRIVATE": "INJECT"}), example(reason=["PRIVATE"]), example(decision="PRIVATE", preferred_features="INJECT")])
    assert len(context["examples"]) == 1
    assert context["examples"][0]["weekend"] is None
    assert context["examples"][0]["preferred_score_components"] == {}
    assert "PRIVATE" not in json.dumps(context) and "INJECT" not in json.dumps(context)


def test_authenticated_endpoint_excludes_legacy_injection_and_versions_current_rules(compute_db):
    from app.main import create_app
    from app.api.v1.auth import current_user
    from app.db.session import get_db
    from app.core.config import settings

    db, user = compute_db
    for data in (example(note="PRIVATE_NOTE", preferred_features={"burden": 2, "PRIVATE_KEY": "INJECT"}).data, example(reason="PRIVATE_REASON").data):
        db.add(RotaTeachingExample(job_id=uuid4(), operator_id=user.id, status="approved", data=data))
    db.commit()
    app = create_app()
    def database():
        yield db
    app.dependency_overrides[get_db] = database
    previous = settings.rota_intelligence_enabled
    settings.rota_intelligence_enabled = True
    try:
        with TestClient(app) as client:
            path = "/api/v1/rota-intelligence/assistant-context?month=2026-05"
            assert client.get(path).status_code == 401
            app.dependency_overrides[current_user] = lambda: user
            response = client.get(path)
            assert response.status_code == 200
            context = response.json()
            assert context["source_contract"] == 1 and len(context["sources"]) == 2
            assert len(context["examples"]) == 1
            assert "PRIVATE" not in response.text and "INJECT" not in response.text
            assert "Safe Member" not in response.text and "person_id" not in response.text
            assert client.get("/api/v1/rota-intelligence/assistant-context?month=bad").status_code == 422
    finally:
        settings.rota_intelligence_enabled = previous
