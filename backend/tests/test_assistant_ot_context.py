"""Selected OT context has the same admin authority and source as the inspector."""

import copy
import json
from uuid import UUID, uuid4

import pytest

from app.core.config import settings
from app.models import DutyAssignment, RuleVersion
from app.services.assistant_sources import digest
from tests.test_ot_calendar_api import api as api, configuration
from tests.test_assistant_ot_reference import save
from tests.test_local_ai_reference_context import send


def path(unit, **query):
    values = {"month": "2026-11", "day": "2026-11-19", "unit_id": str(unit), **query}
    return "/api/v1/rota-intelligence/assistant-context/ot?" + "&".join(f"{key}={value}" for key, value in values.items())


def context(client, unit, monkeypatch):
    monkeypatch.setattr(settings, "rota_intelligence_enabled", True)
    monkeypatch.setattr(settings, "rota_compute_enabled", True)
    cfg = configuration(unit)
    cfg["weekly"][0]["area_key"] = "PRIVATE_AREA"
    cfg["weekly"][0]["source_reference"] = "PRIVATE_SOURCE"
    save(client, unit, cfg)
    result = client.get(path(unit))
    assert result.status_code == 200, result.text
    return result.json()


def test_authoritative_context_is_minimized_readonly_and_companion_compatible(api, monkeypatch):
    client, sessions, unit, _, _ = api
    value = context(client, unit, monkeypatch)
    assert value["source_contract"] == 2 and len(value["sources"]) == 3
    assert value["sources"][-1] == {"source": "selected_unit_ot_demand", "content_version": digest(value["ot_demand"])}
    assert "unit_ot_demand" not in value["not_included"]
    assert "PRIVATE" not in json.dumps(value)
    with sessions() as db:
        assert db.query(DutyAssignment).count() == 0
        assert db.query(RuleVersion).count() == 0
    result, calls, body = send(value, "Balance duties while protecting the reviewed OT requirements.")
    assert result.status_code == 200 and calls == 4
    supplied = json.loads(body["messages"][1]["content"].split("Reference facts and examples:\n", 1)[1].split("\nUser request:", 1)[0])
    assert supplied["ot_demand"] == value["ot_demand"]
    assert "Never sum bands" in supplied["ot_interpretation"]
    assert "personal_availability" in supplied["not_included"]
    assert client.get("/api/v1/rota-intelligence/assistant-context?month=2026-11").json()["source_contract"] == 1


def test_scope_authority_features_and_oversize_refuse(api, monkeypatch):
    client, _, unit, state, _ = api
    context(client, unit, monkeypatch)
    assert client.get(path(unit, day="2026-12-01")).status_code == 422
    assert client.get(path(unit, month="bad")).status_code == 422
    assert client.get(path(uuid4())).status_code == 404
    state["user"].role = "rota_board_member"
    assert client.get(path(unit)).status_code == 403
    state["user"].role = "computer_admin"
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    assert client.get(path(unit)).status_code == 503
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    cfg = configuration(unit)
    cfg["weekly"] = [{**cfg["weekly"][0], "id": str(UUID(int=i+1)), "area_key": f"area_{i}"} for i in range(13)]
    current = client.get(f"/api/v1/admin/ot-calendars/{unit}").json()["revision"]
    save(client, unit, cfg, current)
    assert client.get(path(unit)).status_code == 422
    assert client.get(f"/api/v1/admin/ot-calendars/{unit}/assistant-reference?day=2026-11-19").status_code == 200


@pytest.mark.parametrize("mutation", [
    lambda v: v["ot_demand"]["content"].update(day="2026-12-19"),
    lambda v: v["ot_demand"]["content"].update(unit_id="PRIVATE_UNIT"),
    lambda v: v["ot_demand"]["content"].update(PRIVATE_NOTE="INJECT"),
    lambda v: v["ot_demand"]["content"]["bands"][0].update(minimum=True),
    lambda v: v["ot_demand"]["content"]["bands"][0].update(target=-1),
    lambda v: v["ot_demand"]["content"]["bands"][0].update(call_levels=[["INJECT"]]),
    lambda v: v["ot_demand"]["content"]["bands"][0].update(starts_at="2026-11-18T08:00:00"),
    lambda v: v["ot_demand"].update(calendar_revision="INJECT"),
    lambda v: v.update(sources=v["sources"][:2]),
    lambda v: v["ot_demand"]["content"].update(demand_known=False),
])
def test_hostile_selected_facts_reject_before_model_even_if_rehashed(api, monkeypatch, mutation):
    client, _, unit, _, _ = api
    value = context(client, unit, monkeypatch)
    mutation(value)
    if len(value["sources"]) == 3:
        value["sources"][-1]["content_version"] = digest(value["ot_demand"])
    result, calls, _ = send(value)
    assert result.status_code == 502 and calls == 0


def test_tamper_versions_unknown_demand_and_no_false_availability(api, monkeypatch):
    client, _, unit, _, _ = api
    value = context(client, unit, monkeypatch)
    tampered = copy.deepcopy(value)
    tampered["ot_demand"]["content"]["bands"][0]["minimum"] = 1
    assert send(tampered)[:2][1] == 0
    unknown = client.get(path(unit, day="2026-11-20")).json()
    assert unknown["ot_demand"]["content"]["demand_known"] is False
    assert send(unknown)[0].status_code == 200
    # Current companion produces mode suggestions, not factual OT or personal QA.
    result, calls, _ = send(value, "Which doctors are available for duty?")
    assert result.status_code == 502 and calls == 0
    result, calls, _ = send(value, "How many people does the OT need?")
    assert result.status_code == 502 and calls == 0
    assert "selected OT reference contains demand definitions" in result.json()["detail"]


def test_source_versions_track_selected_date_and_calendar_changes(api, monkeypatch):
    client, _, unit, _, _ = api
    before = context(client, unit, monkeypatch)
    same = client.get(path(unit)).json()
    assert before["sources"] == same["sources"]
    later = client.get(path(unit, day="2026-11-26")).json()
    assert later["sources"][-1] != before["sources"][-1]
    cfg = configuration(unit)
    cfg["weekly"][0]["area_key"] = "PRIVATE_AREA"
    cfg["weekly"][0]["bands"][0]["minimum"] = 1
    save(client, unit, cfg, before["ot_demand"]["calendar_revision"])
    changed = client.get(path(unit)).json()
    assert changed["sources"][:2] == before["sources"][:2]
    assert changed["sources"][-1] != before["sources"][-1]
    assert changed["ot_demand"]["calendar_revision"] != before["ot_demand"]["calendar_revision"]
