"""Authoritative demand-only reference shares OT admin authority and date semantics."""

from datetime import date
from uuid import UUID, uuid4

from app.api.v1.auth import current_user
from app.core.config import settings
from app.models import DutyAssignment, OtCalendar, OtCalendarVersion
from app.services.assistant_sources import digest
from app.services.ot_calendar_store import EMPTY_REVISION
from tests.test_ot_calendar_api import api as api, configuration, url


def reference_path(unit_id, day="2026-11-19"):
    return url(unit_id) + "/assistant-reference?day=" + day


def save(client, unit_id, cfg, revision=EMPTY_REVISION):
    response = client.put(url(unit_id), json={"base_revision": revision, "configuration": cfg, "note": "PRIVATE_ADMIN_NOTE"})
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def test_absent_calendar_read_stays_unknown_and_writes_nothing(api):
    client, sessions, unit_id, _, _ = api
    response = client.get(reference_path(unit_id))
    assert response.status_code == 200
    value = response.json()
    assert value["content"]["demand_known"] is False
    assert value["content"]["calendar_status"] == "not_evaluated"
    assert value["content"]["bands"] == []
    assert value["source"]["content_version"] == digest(value["content"])
    assert value["source"]["calendar_revision"] == EMPTY_REVISION
    with sessions() as db:
        assert db.query(OtCalendar).count() == db.query(OtCalendarVersion).count() == db.query(DutyAssignment).count() == 0


def test_saved_date_resolution_is_minimized_versioned_and_demand_only(api):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["weekly"][0]["area_key"] = "PRIVATE_AREA_TEXT"
    cfg["weekly"][0]["source_reference"] = "PRIVATE_SOURCE_NOTE"
    cfg["weekly"][0]["bands"][0]["key"] = "PRIVATE_BAND_TEXT"
    revision = save(client, unit_id, cfg)
    first = client.get(reference_path(unit_id))
    value = first.json()
    assert first.status_code == 200
    assert "PRIVATE" not in first.text and "saved_by" not in first.text
    content = value["content"]
    assert content["demand_known"] is True and content["reserve_mode"] == "included"
    assert content["bands"] == [{"band_index": 0, "starts_at": "2026-11-19T08:00:00", "ends_at": "2026-11-19T16:00:00", "call_levels": ["3RD_CALL", "4TH_CALL"], "minimum": 2, "target": 3, "required_skill_count": 0}]
    assert value["source"]["calendar_revision"] == revision
    assert "personal_availability" in value["not_included"]
    assert value["source"]["content_version"] == digest(content)
    second = client.get(reference_path(unit_id)).json()
    assert second["source"] == value["source"]
    cfg["weekly"][0]["bands"][0]["minimum"] = 1
    changed = save(client, unit_id, cfg, revision)
    third = client.get(reference_path(unit_id)).json()
    assert third["source"]["calendar_revision"] == changed
    assert third["source"]["content_version"] != value["source"]["content_version"]
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 2
        assert db.query(DutyAssignment).count() == 0


def test_explicit_closed_partial_and_undefined_days_are_distinct(api):
    client, _, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["exceptions"] = [{"id": str(UUID(int=2)), "unit_id": str(unit_id), "area_key": "main_ot", "day": "2026-11-19", "closed": True, "bands": []}]
    revision = save(client, unit_id, cfg)
    closed = client.get(reference_path(unit_id)).json()["content"]
    assert closed["demand_known"] is True and closed["bands"] == [] and closed["closed_area_count"] == 1
    undefined = client.get(reference_path(unit_id, "2026-11-20")).json()["content"]
    assert undefined["demand_known"] is False and undefined["calendar_status"] == "not_evaluated"
    cfg["weekly"].append({**cfg["weekly"][0], "id": str(UUID(int=3)), "area_key": "other_ot", "weekday": "FRI"})
    save(client, unit_id, cfg, revision)
    partial = client.get(reference_path(unit_id)).json()["content"]
    assert partial["calendar_status"] == "partially_configured" and partial["demand_known"] is False and partial["missing_area_count"] == 1


def test_bounded_reference_refuses_instead_of_truncating_required_bands(api):
    client, sessions, unit_id, _, _ = api
    cfg = configuration(unit_id)
    cfg["weekly"] = [{**cfg["weekly"][0], "id": str(UUID(int=index + 1)), "area_key": f"area_{index}"} for index in range(65)]
    save(client, unit_id, cfg)
    response = client.get(reference_path(unit_id))
    assert response.status_code == 422 and response.json()["detail"]["code"] == "assistant_ot_reference_too_large"
    with sessions() as db:
        assert db.query(OtCalendarVersion).count() == 1


def test_same_admin_feature_boundary_and_explicit_dates(api, monkeypatch):
    client, _, unit_id, state, app = api
    assert client.get(reference_path(unit_id, "bad")).status_code == 422
    assert client.get(reference_path(uuid4())).status_code == 404
    state["user"].role = "rota_board_member"
    assert client.get(reference_path(unit_id)).status_code == 403
    state["user"].role = "computer_admin"
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    assert client.get(reference_path(unit_id)).status_code == 503
    del app.dependency_overrides[current_user]
    assert client.get(reference_path(unit_id)).status_code == 401


def test_date_scope_changes_content_version(api):
    client, _, unit_id, _, _ = api
    cfg = configuration(unit_id)
    save(client, unit_id, cfg)
    first = client.get(reference_path(unit_id, date(2026, 11, 19).isoformat())).json()
    second = client.get(reference_path(unit_id, "2026-11-26")).json()
    assert first["source"]["calendar_revision"] == second["source"]["calendar_revision"]
    assert first["source"]["content_version"] != second["source"]["content_version"]
