"""Unit rules in "Who can do it" (docs/extra_duty_fill_all_contract.md section 5): the rules GET
exposes the units list, allowed/excluded unit ids round-trip unchanged, legacy code/name tokens
still match, and the check/save report ``missing_unit``, ``inactive_unit`` and ``unit_in_both``."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import Unit, UserAccount
from app.services.rota_rules_admin import unit_rule_problems
from app.services.rota_template import rule_applies_to_unit

RULES = "/api/v1/admin/rota-rules/phase-one"
DUTY = "MAIN_1ST_24HR"
UNIT_CODES = {"missing_unit", "inactive_unit", "unit_in_both"}


@pytest.fixture
def api():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as s:
        units = {
            "u1": Unit(code="UNIT_I", name="Unit I", campus="MAIN"),
            "u2": Unit(code="UNIT_II", name="Unit II", campus="MAIN"),
            "old": Unit(code="OLD", name="Old Unit", campus="CHAD", active_status="inactive"),
        }
        s.add_all(units.values())
        s.commit()
        ids = {key: str(unit.id) for key, unit in units.items()}
    admin = UserAccount(id=uuid4(), username="ru-admin", display_name="RU Admin", role="superadmin",
                        password_hash="x")

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: admin
    try:
        yield TestClient(app), ids
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def body_of(client):
    read = client.get(RULES).json()
    body = {k: read[k] for k in ("duty_rules", "duty_count_limits", "rest_rules", "unit_staffing_rules", "notes")}
    body["base_revision"] = read["revision"]
    return read, body


def duty(body, key=DUTY):
    return next(r for r in body["duty_rules"] if r["key"] == key)


def problems_for(client, body):
    res = client.post(f"{RULES}/check", json=body)
    assert res.status_code == 200, res.text
    return [p for p in res.json()["problems"] if p["duty_key"] == DUTY and p["code"] in UNIT_CODES]


def test_get_exposes_units_list(api):
    client, ids = api
    read, _body = body_of(client)
    units = {u["id"]: u for u in read["units"]}
    assert set(units) == set(ids.values())
    assert units[ids["u1"]] == {"id": ids["u1"], "code": "UNIT_I", "name": "Unit I", "campus": "MAIN", "active": True}
    assert units[ids["old"]]["active"] is False
    # Active units are listed first.
    assert read["units"][-1]["id"] == ids["old"]
    assert all(set(u) == {"id", "code", "name", "campus", "active"} for u in read["units"])


def test_unit_ids_round_trip_unchanged_and_legacy_tokens_accepted(api):
    client, ids = api
    _read, body = body_of(client)
    duty(body).update(allowed_units=[ids["u1"], "unit_ii"], excluded_units=["Old Unit"])
    assert problems_for(client, body) == []
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    saved = duty(res.json())
    assert saved["allowed_units"] == [ids["u1"], "unit_ii"]
    assert saved["excluded_units"] == ["Old Unit"]
    again = duty(client.get(RULES).json())
    assert again["allowed_units"] == [ids["u1"], "unit_ii"]


def test_missing_unit_is_an_error_and_blocks_save(api):
    client, ids = api
    _read, body = body_of(client)
    gone = str(uuid4())
    duty(body).update(allowed_units=[ids["u1"], gone])
    hit = next(p for p in problems_for(client, body) if p["code"] == "missing_unit")
    assert hit["severity"] == "error" and hit["field"] == "allowed_units"
    assert "no longer exists" in hit["message"] and gone in hit["message"]
    assert set(hit) == {"duty_key", "field", "code", "severity", "message", "fix"}
    res = client.put(RULES, json=body)
    assert res.status_code == 422
    assert any(p["code"] == "missing_unit" for p in res.json()["detail"]["problems"])


def test_missing_excluded_unit_is_reported_on_its_field(api):
    client, _ids = api
    _read, body = body_of(client)
    duty(body).update(excluded_units=["NOWHERE"])
    hit = next(p for p in problems_for(client, body) if p["code"] == "missing_unit")
    assert hit["field"] == "excluded_units"


def test_unit_in_both_lists_is_an_error(api):
    client, ids = api
    _read, body = body_of(client)
    # Same unit by id and by legacy code is still "in both".
    duty(body).update(allowed_units=[ids["u1"], ids["u2"]], excluded_units=["UNIT_I"])
    found = [p for p in problems_for(client, body) if p["code"] == "unit_in_both"]
    assert len(found) == 1
    assert found[0]["severity"] == "error" and "Unit I" in found[0]["message"]
    assert client.put(RULES, json=body).status_code == 422


def test_inactive_allowed_unit_is_a_warning_and_saves(api):
    client, ids = api
    _read, body = body_of(client)
    duty(body).update(allowed_units=[ids["u1"], ids["old"]])
    found = [p for p in problems_for(client, body) if p["code"] == "inactive_unit"]
    assert len(found) == 1 and found[0]["severity"] == "warning" and "Old Unit" in found[0]["message"]
    assert client.put(RULES, json=body).status_code == 200
    # An inactive duty does not warn about its units.
    _read, body = body_of(client)
    duty(body).update(active=False)
    assert not [p for p in problems_for(client, body) if p["code"] == "inactive_unit"]


def test_unit_rule_problems_and_matching_helpers():
    u1 = SimpleNamespace(id=uuid4(), code="UNIT_I", name="Unit I", active_status="active")
    u2 = SimpleNamespace(id=uuid4(), code="UNIT_II", name="Unit II", active_status="active")
    rule = SimpleNamespace(key="X", label="X duty", active=True, allowed_units=[str(u1.id)], excluded_units=[])
    assert unit_rule_problems(rule, [u1, u2]) == []
    assert rule_applies_to_unit(rule, u1) and not rule_applies_to_unit(rule, u2)
    rule.allowed_units = []
    rule.excluded_units = ["unit ii"]
    assert rule_applies_to_unit(rule, u1) and not rule_applies_to_unit(rule, u2)
    rule.excluded_units = ["  "]
    assert [p["code"] for p in unit_rule_problems(rule, [u1, u2])] == ["missing_unit"]
