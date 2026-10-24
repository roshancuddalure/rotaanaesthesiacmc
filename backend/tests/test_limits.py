"""Limits API (docs/limits_callevel_fairness_contract.md section 3): permissions, validation,
stale 409, the Rota Rules guard, history, restore, preview sentences and impact, and old rules
JSON without the new sections."""

from __future__ import annotations

import sys
from datetime import date, datetime, time, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    DutyAssignment,
    DutySlot,
    NormalizationEvent,
    Person,
    RotaPeriod,
    RotaRuleVersion,
    RuleSetting,
    Unit,
    UserAccount,
)
from app.services import limits as limits_service
from app.services.rota_rules import (
    LIMIT_SECTIONS,
    PHASE_ONE_SETTING_KEY,
    RotaPhaseOneRules,
    get_phase_one_rules,
)

LIMITS = "/api/v1/admin/limits"
RULES = "/api/v1/admin/rota-rules/phase-one"
MONTH = "2026-06"


def user(role: str) -> UserAccount:
    return UserAccount(id=uuid4(), username=f"u-{role}", display_name=f"{role} user", role=role,
                       password_hash="x")


@pytest.fixture
def api():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    state = {"user": user("superadmin")}

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: state["user"]
    try:
        yield TestClient(app), sessions, state
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def get(client, month=MONTH):
    res = client.get(LIMITS, params={"month": month})
    assert res.status_code == 200, res.text
    return res.json()


def put(client, limits, base="current", note=None):
    base_id = get(client)["version_id"] if base == "current" else base
    return client.put(LIMITS, json={"limits": limits, "base_version_id": base_id, "note": note})


def rules_body(client):
    read = client.get(RULES).json()
    body = {k: read[k] for k in ("duty_rules", "duty_count_limits", "rest_rules", "unit_staffing_rules",
                                 "fairness_rules", "extra_duty_rules", "notes")}
    body["base_revision"] = read["revision"]
    return body


def seed_month(sessions, person_duties: dict[str, int]) -> None:
    """One unit; each named member gets that many 24-hour duties on different June days."""
    with sessions() as s:
        period = RotaPeriod(name="June 2026", starts_on=date(2026, 6, 1), ends_on=date(2026, 6, 30),
                            status="draft")
        unit = Unit(code="U1", name="Unit One", campus="Main")
        s.add_all([period, unit])
        s.flush()
        day = 1
        for name, count in person_duties.items():
            person = Person(canonical_name=name, call_level="3RD_CALL", active_status="active")
            s.add(person)
            s.flush()
            for _ in range(count):
                starts = datetime.combine(date(2026, 6, day), time(8))
                slot = DutySlot(rota_period=period, unit=unit, duty_date=starts.date(),
                                duty_type="MAIN_3RD_24HR", call_level="3RD_CALL",
                                slot_label=f"U1:{day}", starts_at=starts, ends_at=starts + timedelta(hours=24),
                                is_24hr=True, source="phase4_template")
                s.add(slot)
                s.flush()
                s.add(DutyAssignment(duty_slot_id=slot.id, person_id=person.id, status="assigned"))
                day += 2
        s.commit()


# --------------------------------------------------------------------------- GET / fields


def test_get_shape_and_every_limit_has_plain_help(api) -> None:
    client, _sessions, _state = api
    body = get(client)
    assert body["can_edit"] is True
    assert body["month"] == MONTH
    assert set(body["limits"]) == set(LIMIT_SECTIONS) == set(body["defaults"])
    assert body["limits"]["fairness_rules"] == {"max_gap_within_call_level": 1, "target_mode": "auto"}
    assert body["limits"]["extra_duty_rules"] == {"justice_lookback_months": 12}
    assert isinstance(body["targets"], list)
    assert [s["key"] for s in body["sections"]] == list(LIMIT_SECTIONS)
    paths = {f["path"] for f in body["fields"]}
    expected = {f"{section}.{name}" for section, values in body["limits"].items() for name in values}
    assert paths == expected, "every limit needs a field description"
    for field in body["fields"]:
        assert field["section"] == field["path"].split(".")[0]
        assert field["label"] and len(field["help"]) > 60 and field["example"], field["path"]
        assert field["kind"] in {"int", "bool", "percent", "hours", "choice"}
        assert field["hard_or_soft"] in {"hard", "soft", "guide"}
        assert field["hard_or_soft"] in body["hard_or_soft_labels"]
        if field["kind"] in {"int", "percent", "hours"}:
            assert field["min"] is not None and field["max"] is not None
    by_path = {f["path"]: f for f in body["fields"]}
    assert by_path["rest_rules.minimum_gap_after_24hr_hours"]["hard_or_soft"] == "hard"
    assert by_path["duty_count_limits.max_24hr_per_month"]["hard_or_soft"] == "soft"
    assert by_path["duty_count_limits.max_24hr_per_month"]["blank_means"] == "No limit"
    assert by_path["unit_staffing_rules.warning_unavailable_percent"]["hard_or_soft"] == "guide"
    assert by_path["rest_rules.post_24hr_blocks_next_day_elective"]["hard_or_soft"] == "guide"


def test_fields_have_section(api) -> None:
    for field in limits_service.FIELDS:
        assert field["path"].split(".")[0] in LIMIT_SECTIONS


def test_targets_guarded_when_module_missing_or_failing(api, monkeypatch) -> None:
    client, _sessions, _state = api
    monkeypatch.setitem(sys.modules, "app.services.fairness_targets", None)
    assert get(client)["targets"] == []
    fake = type(sys)("fake_targets")

    def boom(*_args, **_kwargs):
        raise RuntimeError("not ready")

    fake.call_level_targets = boom
    monkeypatch.setitem(sys.modules, "app.services.fairness_targets", fake)
    assert get(client)["targets"] == []
    fake.call_level_targets = lambda db, month, rules=None: [{"call_level": "3RD_CALL", "target": 3.0}]
    assert get(client)["targets"] == [{"call_level": "3RD_CALL", "target": 3.0}]


def test_bad_month_400(api) -> None:
    client, _sessions, _state = api
    res = client.get(LIMITS, params={"month": "2026-13"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "invalid_month"


# --------------------------------------------------------------------------- permissions


@pytest.mark.parametrize("role", ["computer_admin", "rota_board_member"])
def test_admin_and_board_read_only(api, role) -> None:
    client, _sessions, state = api
    state["user"] = user(role)
    body = get(client)
    assert body["can_edit"] is False and body["fields"]
    assert client.get(f"{LIMITS}/history").status_code == 200
    assert put(client, {"fairness_rules": {"max_gap_within_call_level": 2}}).status_code == 403
    assert client.post(f"{LIMITS}/preview", json={"limits": {}, "month": MONTH}).status_code == 403
    assert client.post(f"{LIMITS}/restore", json={"version_id": str(uuid4())}).status_code == 403


def test_other_roles_403_and_anonymous_401(api) -> None:
    client, _sessions, state = api
    state["user"] = user("hod")
    res = client.get(LIMITS)
    assert res.status_code == 403 and res.json()["detail"]["code"] == "limits_forbidden"
    assert client.get(f"{LIMITS}/history").status_code == 403
    app.dependency_overrides.pop(current_user)
    assert client.get(LIMITS).status_code == 401
    assert client.put(LIMITS, json={"limits": {}}).status_code == 401
    assert client.post(f"{LIMITS}/preview", json={"limits": {}}).status_code == 401


# --------------------------------------------------------------------------- PUT and validation


def test_superadmin_saves_new_version_with_audit(api) -> None:
    client, sessions, _state = api
    res = put(client, {"duty_count_limits": {"max_24hr_per_month": 6},
                       "fairness_rules": {"max_gap_within_call_level": 2}}, note="Board meeting 21 Oct")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["limits"]["duty_count_limits"]["max_24hr_per_month"] == 6
    assert body["limits"]["fairness_rules"]["max_gap_within_call_level"] == 2
    assert body["saved_by"] == "superadmin user" and body["saved_at"]
    with sessions() as s:
        _v, rules = get_phase_one_rules(s)
        assert rules.duty_count_limits.max_24hr_per_month == 6
        latest = s.scalar(select(RotaRuleVersion).order_by(RotaRuleVersion.saved_at.desc()).limit(1))
        assert latest.note == "Limits changed. Note: Board meeting 21 Oct"
        assert str(latest.id) == body["version_id"] == body["limits_version_id"]
        event = s.scalar(select(NormalizationEvent).where(NormalizationEvent.action == "limits_changed"))
        assert event is not None and event.entity_id == latest.id
        assert [c["path"] for c in event.details["changes"]] == [
            "duty_count_limits.max_24hr_per_month", "fairness_rules.max_gap_within_call_level"]
    # Blank clears a limit again.
    res = put(client, {"duty_count_limits": {"max_24hr_per_month": None}})
    assert res.status_code == 200 and res.json()["limits"]["duty_count_limits"]["max_24hr_per_month"] is None


def test_no_change_is_422(api) -> None:
    client, _sessions, _state = api
    res = put(client, get(client)["limits"])
    assert res.status_code == 422 and res.json()["detail"]["code"] == "no_limit_changes"


@pytest.mark.parametrize(
    ("limits", "path"),
    [
        ({"unit_staffing_rules": {"warning_unavailable_percent": 50, "hard_block_unavailable_percent": 40}},
         "unit_staffing_rules.warning_unavailable_percent"),
        ({"unit_staffing_rules": {"warning_unavailable_percent": 40, "hard_block_unavailable_percent": 40}},
         "unit_staffing_rules.warning_unavailable_percent"),
        ({"unit_staffing_rules": {"hard_block_unavailable_percent": 101}}, "unit_staffing_rules.hard_block_unavailable_percent"),
        ({"unit_staffing_rules": {"warning_unavailable_percent": -1}}, "unit_staffing_rules.warning_unavailable_percent"),
        ({"unit_staffing_rules": {"minimum_available_count": -1}}, "unit_staffing_rules.minimum_available_count"),
        ({"unit_staffing_rules": {"minimum_available_count": None}}, "unit_staffing_rules.minimum_available_count"),
        ({"unit_staffing_rules": {"small_unit_uses_absolute_minimum": "yes"}},
         "unit_staffing_rules.small_unit_uses_absolute_minimum"),
        ({"rest_rules": {"minimum_gap_after_24hr_hours": 169}}, "rest_rules.minimum_gap_after_24hr_hours"),
        ({"rest_rules": {"minimum_gap_after_24hr_hours": -1}}, "rest_rules.minimum_gap_after_24hr_hours"),
        ({"rest_rules": {"minimum_gap_after_24hr_hours": 12.5}}, "rest_rules.minimum_gap_after_24hr_hours"),
        ({"duty_count_limits": {"max_24hr_per_month": -1}}, "duty_count_limits.max_24hr_per_month"),
        ({"duty_count_limits": {"max_24hr_per_month": 32}}, "duty_count_limits.max_24hr_per_month"),
        ({"duty_count_limits": {"max_weekend_24hr_per_month": "six"}}, "duty_count_limits.max_weekend_24hr_per_month"),
        ({"duty_count_limits": {"max_same_group_per_month": True}}, "duty_count_limits.max_same_group_per_month"),
        ({"fairness_rules": {"max_gap_within_call_level": 11}}, "fairness_rules.max_gap_within_call_level"),
        ({"fairness_rules": {"max_gap_within_call_level": -1}}, "fairness_rules.max_gap_within_call_level"),
        ({"fairness_rules": {"target_mode": "manual"}}, "fairness_rules.target_mode"),
        ({"extra_duty_rules": {"justice_lookback_months": 0}}, "extra_duty_rules.justice_lookback_months"),
        ({"extra_duty_rules": {"justice_lookback_months": 37}}, "extra_duty_rules.justice_lookback_months"),
        ({"duty_rules": []}, "duty_rules"),
        ({"rest_rules": {"no_such_limit": 1}}, "rest_rules.no_such_limit"),
        ({"rest_rules": 5}, "rest_rules"),
        ("not an object", "limits"),
    ],
)
def test_validation_422(api, limits, path) -> None:
    client, sessions, _state = api
    before = get(client)
    res = put(client, limits)
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "invalid_limits"
    assert path in {p["path"] for p in detail["problems"] if p["severity"] == "error"}, detail
    assert all(p["message"] for p in detail["problems"])
    after = get(client)
    assert after["limits"] == before["limits"] and after["version_id"] == before["version_id"]


def test_edge_values_accepted(api) -> None:
    client, _sessions, _state = api
    res = put(client, {
        "unit_staffing_rules": {"warning_unavailable_percent": 0, "hard_block_unavailable_percent": 100,
                                "minimum_available_count": 0},
        "rest_rules": {"minimum_gap_after_24hr_hours": 168},
        "fairness_rules": {"max_gap_within_call_level": 10},
        "extra_duty_rules": {"justice_lookback_months": 36},
        "duty_count_limits": {"max_24hr_per_month": "6"},
    })
    assert res.status_code == 200, res.text
    assert res.json()["limits"]["duty_count_limits"]["max_24hr_per_month"] == 6
    res = put(client, {"extra_duty_rules": {"justice_lookback_months": 1},
                       "fairness_rules": {"max_gap_within_call_level": 0}})
    assert res.status_code == 200, res.text


def test_stale_base_409(api) -> None:
    client, _sessions, _state = api
    old = get(client)["version_id"]
    assert put(client, {"fairness_rules": {"max_gap_within_call_level": 2}}).status_code == 200
    first = get(client)["version_id"]
    res = put(client, {"fairness_rules": {"max_gap_within_call_level": 3}}, base=old)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "stale_limits" and detail["current_version_id"] == first
    res = put(client, {"fairness_rules": {"max_gap_within_call_level": 3}}, base=str(uuid4()))
    assert res.status_code == 409
    res = put(client, {"fairness_rules": {"max_gap_within_call_level": 3}}, base="garbage")
    assert res.status_code == 409
    assert get(client)["limits"]["fairness_rules"]["max_gap_within_call_level"] == 2


def test_duty_only_rules_save_does_not_make_limits_stale(api) -> None:
    client, _sessions, _state = api
    assert put(client, {"fairness_rules": {"max_gap_within_call_level": 2}}).status_code == 200
    base = get(client)["version_id"]
    body = rules_body(client)
    body["notes"] = "Duty notes changed"
    assert client.put(RULES, json=body).status_code == 200
    assert get(client)["version_id"] != base
    res = put(client, {"fairness_rules": {"max_gap_within_call_level": 3}}, base=base)
    assert res.status_code == 200, res.text
    # The duty change made in between is kept.
    assert client.get(RULES).json()["notes"] == "Duty notes changed"


# --------------------------------------------------------------------------- Rota Rules guard


def test_rules_put_cannot_change_limits(api) -> None:
    client, _sessions, _state = api  # caller is a superadmin: still refused on this path
    before = client.get(RULES).json()
    body = rules_body(client)
    body["duty_count_limits"]["max_24hr_per_month"] = 6
    body["notes"] = "sneaky"
    res = client.put(RULES, json=body)
    assert res.status_code == 403
    detail = res.json()["detail"]
    assert detail["code"] == "limits_superadmin_only" and detail["page"] == "Limits"
    assert detail["paths"] == ["duty_count_limits.max_24hr_per_month"]
    after = client.get(RULES).json()
    assert after["revision"] == before["revision"] and after["notes"] == before["notes"]
    for section in ("rest_rules", "unit_staffing_rules", "fairness_rules", "extra_duty_rules"):
        body = rules_body(client)
        key = next(iter(body[section]))
        value = body[section][key]
        body[section][key] = (not value) if isinstance(value, bool) else (
            "other" if isinstance(value, str) else value + 1)
        res = client.put(RULES, json=body)
        assert res.status_code == 403, section


def test_rules_put_with_identical_or_omitted_limits_still_works(api) -> None:
    client, _sessions, _state = api
    assert put(client, {"duty_count_limits": {"max_24hr_per_month": 5}}).status_code == 200
    body = rules_body(client)  # identical values
    body["notes"] = "same limits"
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    assert res.json()["duty_count_limits"]["max_24hr_per_month"] == 5
    body = rules_body(client)
    for section in LIMIT_SECTIONS:
        body.pop(section)
    body["notes"] = "limits omitted"
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["notes"] == "limits omitted"
    assert saved["duty_count_limits"]["max_24hr_per_month"] == 5, "omitted sections keep stored values"
    assert get(client)["limits"]["duty_count_limits"]["max_24hr_per_month"] == 5


def test_rules_restore_keeps_current_limits(api) -> None:
    client, _sessions, _state = api
    body = rules_body(client)
    body["notes"] = "v1"
    assert client.put(RULES, json=body).status_code == 200
    v1 = client.get(f"{RULES}/versions").json()[0]["version_id"]
    assert put(client, {"duty_count_limits": {"max_24hr_per_month": 4}}).status_code == 200
    revision = client.get(RULES).json()["revision"]
    res = client.post(f"{RULES}/versions/{v1}/restore", json={"base_revision": revision})
    assert res.status_code == 200, res.text
    assert res.json()["notes"] == "v1"
    assert res.json()["duty_count_limits"]["max_24hr_per_month"] == 4


# --------------------------------------------------------------------------- history and restore


def test_history_lists_only_limit_changes(api) -> None:
    client, _sessions, _state = api
    body = rules_body(client)
    body["notes"] = "duty change only"
    assert client.put(RULES, json=body).status_code == 200
    assert put(client, {"duty_count_limits": {"max_24hr_per_month": 6}}, note="first").status_code == 200
    body = rules_body(client)
    body["notes"] = "another duty change"
    assert client.put(RULES, json=body).status_code == 200
    assert put(client, {"rest_rules": {"minimum_gap_after_24hr_hours": 48}}).status_code == 200
    history = client.get(f"{LIMITS}/history").json()
    assert len(history) == 2
    newest, oldest = history
    assert newest["label"] == "Limits changed" and newest["note"] is None
    assert [c["sentence"] for c in newest["changes"]] == ["Rest after a 24-hour duty: 24 hours → 48 hours"]
    assert oldest["note"] == "first" and oldest["saved_by"] == "superadmin user"
    assert oldest["changes"] == [{
        "path": "duty_count_limits.max_24hr_per_month",
        "label": "Max 24-hour duties per member per month",
        "before": None, "after": 6,
        "sentence": "Max 24-hour duties per member per month: no limit → 6 duties",
    }]
    assert len(client.get(f"{RULES}/versions").json()) == 5  # baseline + 4 saves


def test_restore_creates_new_version_restoring_only_limits(api) -> None:
    client, sessions, _state = api
    assert put(client, {"duty_count_limits": {"max_24hr_per_month": 6}}).status_code == 200
    target = client.get(f"{LIMITS}/history").json()[0]["version_id"]
    assert put(client, {"duty_count_limits": {"max_24hr_per_month": 8},
                        "extra_duty_rules": {"justice_lookback_months": 6}}).status_code == 200
    body = rules_body(client)
    body["notes"] = "kept after restore"
    assert client.put(RULES, json=body).status_code == 200
    versions_before = len(client.get(f"{RULES}/versions").json())
    res = client.post(f"{LIMITS}/restore", json={"version_id": target, "note": "back to 6"})
    assert res.status_code == 200, res.text
    limits = res.json()["limits"]
    assert limits["duty_count_limits"]["max_24hr_per_month"] == 6
    assert limits["extra_duty_rules"]["justice_lookback_months"] == 12
    assert client.get(RULES).json()["notes"] == "kept after restore"
    assert len(client.get(f"{RULES}/versions").json()) == versions_before + 1
    top = client.get(f"{LIMITS}/history").json()[0]
    assert top["label"].startswith("Limits restored from the version saved") and top["note"] == "back to 6"
    assert {c["path"] for c in top["changes"]} == {"duty_count_limits.max_24hr_per_month",
                                                    "extra_duty_rules.justice_lookback_months"}
    with sessions() as s:
        assert s.scalar(select(NormalizationEvent).where(NormalizationEvent.action == "limits_restored"))
    res = client.post(f"{LIMITS}/restore", json={"version_id": target})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "no_limit_changes"
    res = client.post(f"{LIMITS}/restore", json={"version_id": str(uuid4())})
    assert res.status_code == 404 and res.json()["detail"]["code"] == "version_not_found"
    res = client.post(f"{LIMITS}/restore", json={"version_id": target, "base_version_id": str(uuid4())})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "stale_limits"


# --------------------------------------------------------------------------- preview


def test_preview_sentences_problems_and_impact(api) -> None:
    client, sessions, _state = api
    seed_month(sessions, {"Asha": 4, "Bala": 3, "Chitra": 1})
    res = client.post(f"{LIMITS}/preview", json={
        "month": MONTH,
        "limits": {"duty_count_limits": {"max_24hr_per_month": 2, "max_weekend_24hr_per_month": 3},
                   "unit_staffing_rules": {"warning_unavailable_percent": 25}},
    })
    assert res.status_code == 200, res.text
    body = res.json()
    sentences = [c["sentence"] for c in body["changes"]]
    assert sentences == [
        "Max 24-hour duties per member per month: no limit → 2 duties",
        "Max weekend 24-hour duties per member per month: no limit → 3 duties",
        "Warn when this share of a unit is unavailable: 30% → 25%",
    ]
    assert {p["path"] for p in body["problems"]} == {"duty_count_limits.max_weekend_24hr_per_month"}
    assert body["problems"][0]["severity"] == "warning"
    impact = body["impact"]
    assert impact["over_limit_people"] == 2 and impact["over_limit_people_now"] == 0
    assert impact["newly_over"] == 2 and impact["members_over"] == ["Asha", "Bala"]
    assert impact["sentence"] == "With these limits, 2 members in Jun 2026 would be over a limit (now 0)."
    # Preview never saves.
    assert get(client)["limits"]["duty_count_limits"]["max_24hr_per_month"] is None

    res = client.post(f"{LIMITS}/preview", json={
        "month": MONTH, "limits": {"unit_staffing_rules": {"warning_unavailable_percent": 90}}})
    body = res.json()
    assert res.status_code == 200 and body["impact"] is None
    assert body["problems"][0]["severity"] == "error"


# --------------------------------------------------------------------------- old JSON


def test_old_rules_json_without_new_sections_loads_with_defaults(api) -> None:
    client, sessions, _state = api
    with sessions() as s:
        version, rules = get_phase_one_rules(s)
        payload = rules.model_dump(mode="json")
        payload.pop("fairness_rules")
        payload.pop("extra_duty_rules")
        payload["duty_count_limits"]["max_24hr_per_month"] = 7
        setting = s.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
        setting.value = payload
        s.commit()
        assert RotaPhaseOneRules.model_validate(payload).fairness_rules.max_gap_within_call_level == 1
        _v, loaded = get_phase_one_rules(s)
        assert loaded.extra_duty_rules.justice_lookback_months == 12
        assert loaded.duty_count_limits.max_24hr_per_month == 7
    body = get(client)
    assert body["limits"]["fairness_rules"]["max_gap_within_call_level"] == 1
    assert body["limits"]["duty_count_limits"]["max_24hr_per_month"] == 7
    # Old stored versions (no new sections) compare as defaults, not as changes.
    assert limits_service.stored_limits(payload)["extra_duty_rules"] == {"justice_lookback_months": 12}
    res = put(client, {"extra_duty_rules": {"justice_lookback_months": 24}})
    assert res.status_code == 200, res.text
    history = client.get(f"{LIMITS}/history").json()
    assert [c["path"] for c in history[0]["changes"]] == ["extra_duty_rules.justice_lookback_months"]
