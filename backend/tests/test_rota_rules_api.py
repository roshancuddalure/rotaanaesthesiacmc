"""Rota Rules API and eligibility (docs/rota_rules_contract.md): check codes, structured
save errors, stale revisions, version history/restore, eligibility gaps, admin-only
access, and template stamping for multi-level duties."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (
    CallCluster,
    DutySlot,
    Person,
    PersonCallClusterMembership,
    PersonPosting,
    RuleSetting,
    Unit,
    UserAccount,
)
from app.services.call_clusters import ensure_default_call_clusters
from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules

RULES = "/api/v1/admin/rota-rules/phase-one"
GAPS = "/api/v1/admin/rota-rules/eligibility-gaps"
MONTH = "2026-05"


# --------------------------------------------------------------------------- helpers


def new_sessions():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


def cluster(session: Session, key: str) -> CallCluster:
    ensure_default_call_clusters(session)
    return session.scalar(select(CallCluster).where(CallCluster.key == key))


def member(session, unit, name, level, groups=(), since=date(2026, 1, 1)) -> Person:
    person = Person(canonical_name=name, call_level=level, active_status="active")
    session.add(person)
    session.flush()
    if unit is not None:
        session.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=since,
                                  source="unit_board"))
    for group in groups:
        session.add(PersonCallClusterMembership(person_id=person.id, cluster_id=group.id,
                                                effective_from=since, source="manual"))
    session.commit()
    return person


def store_rules(session: Session, changes: dict[str, dict]) -> None:
    version, rules = get_phase_one_rules(session)
    for key, fields in changes.items():
        for name, value in fields.items():
            setattr(rules.duty_rules_by_key[key], name, value)
    setting = session.scalar(select(RuleSetting).where(RuleSetting.rule_version_id == version.id,
                                                       RuleSetting.key == PHASE_ONE_SETTING_KEY))
    setting.value = rules.model_dump(mode="json")
    session.commit()


@pytest.fixture
def api():
    engine, sessions = new_sessions()
    admin = UserAccount(id=uuid4(), username="rr-admin", display_name="RR Admin", role="superadmin",
                        password_hash="x")
    state = {"user": admin}

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


def body_of(client, base="current"):
    read = client.get(RULES).json()
    body = {k: read[k] for k in ("duty_rules", "duty_count_limits", "rest_rules",
                                 "unit_staffing_rules", "notes")}
    body["base_revision"] = read["revision"] if base == "current" else base
    return read, body


def rule(body, key):
    return next(r for r in body["duty_rules"] if r["key"] == key)


def check(client, body):
    res = client.post(f"{RULES}/check", json=body)
    assert res.status_code == 200, res.text
    return res.json()


# --------------------------------------------------------------------------- check endpoint


ERROR_CASES = {
    "unknown_group": lambda b: rule(b, "MAIN_PAC_3RD").update(allowed_cluster_keys=["gone"]),
    "allowed_and_excluded": lambda b: rule(b, "MAIN_PAC_3RD").update(
        allowed_cluster_keys=["pac_sr"], excluded_cluster_keys=["pac_sr"]),
    "unknown_call_level": lambda b: rule(b, "MAIN_PAC_3RD").update(allowed_call_levels=["7TH"]),
    "unknown_duty": lambda b: b["duty_rules"].append({**rule(b, "MAIN_PAC_3RD"), "key": "GHOST",
                                                      "label": "Ghost"}),
    "bad_group": lambda b: rule(b, "MAIN_PAC_3RD").update(group="nonsense"),
    "bad_hours": lambda b: rule(b, "MAIN_PAC_3RD").update(duration_hours=-1),
}


@pytest.mark.parametrize("code", sorted(ERROR_CASES))
def test_check_reports_each_error_code(api, code) -> None:
    client, _sessions, _state = api
    _read, body = body_of(client)
    ERROR_CASES[code](body)
    problems = check(client, body)["problems"]
    hit = next(p for p in problems if p["code"] == code)
    assert hit["severity"] == "error"
    assert set(hit) == {"duty_key", "field", "code", "severity", "message", "fix"}
    assert hit["message"] and hit["fix"]


def test_check_reports_each_warning_code(api) -> None:
    client, sessions, _state = api
    with sessions() as s:
        senior = cluster(s, "pac_senior")
        senior.active = False
        s.commit()
        member(s, None, "SR member", "3RD_CALL", [cluster(s, "pac_sr")])
    _read, body = body_of(client)
    rule(body, "MAIN_PAC_3RD").update(active=True, allowed_cluster_keys=["pac_sr", "pac_senior"])
    rule(body, "MAIN_PAC_PG").update(active=True, allowed_cluster_keys=["3rd_call_c"])
    rule(body, "MAIN_PAC_SENIOR")["label"] = rule(body, "MAIN_PAC_3RD")["label"]
    body["unit_staffing_rules"].update(warning_unavailable_percent=60, hard_block_unavailable_percent=10)
    result = check(client, body)
    found = {(p["code"], p["duty_key"]) for p in result["problems"] if p["severity"] == "warning"}
    assert ("inactive_group", "MAIN_PAC_3RD") in found
    assert ("empty_group", "MAIN_PAC_PG") in found
    assert ("nobody_eligible", "MAIN_PAC_PG") in found
    assert ("label_duplicate", "MAIN_PAC_SENIOR") in found
    assert ("guardrail", None) in found
    assert not [p for p in result["problems"] if p["severity"] == "error"]
    pac = result["duties"]["MAIN_PAC_3RD"]
    assert pac["effective_call_levels"] == ["3RD_CALL"]  # inactive group adds no level
    assert pac["eligible_now"] == 1 and pac["eligible_by_level"]["3RD_CALL"] == 1


def test_check_two_groups_give_both_levels(api) -> None:
    client, sessions, _state = api
    with sessions() as s:
        member(s, None, "SR", "3RD_CALL", [cluster(s, "pac_sr")])
        member(s, None, "Senior", "4TH_CALL", [cluster(s, "pac_senior")])
        member(s, None, "Loose senior", "4TH_CALL")
    _read, body = body_of(client)
    rule(body, "MAIN_PAC_3RD").update(active=True, allowed_call_levels=["3RD_CALL"],
                                      allowed_cluster_keys=["pac_sr", "pac_senior"])
    result = check(client, body)
    duty = result["duties"]["MAIN_PAC_3RD"]
    assert duty["effective_call_levels"] == ["3RD_CALL", "4TH_CALL"]
    # Two levels = a pool (call_level_pool_and_balance_contract 1): both levels eligible, an info note.
    assert duty["eligible_now"] == 2
    assert duty["eligible_by_level"] == {"3RD_CALL": 1, "4TH_CALL": 1}
    assert any(p["code"] == "call_level_pool" and p["duty_key"] == "MAIN_PAC_3RD"
               and p["severity"] == "info" for p in result["problems"])
    assert not [p for p in result["problems"] if p["code"] in {"call_level_not_single", "call_level_missing"}
                and p["duty_key"] == "MAIN_PAC_3RD"]


def test_get_has_revision_and_group_counts(api) -> None:
    client, sessions, _state = api
    with sessions() as s:
        member(s, None, "SR", "3RD_CALL", [cluster(s, "pac_sr")])
        gone = member(s, None, "Archived SR", "3RD_CALL", [cluster(s, "pac_sr")])
        gone.active_status = "archived"
        s.commit()
    read = client.get(RULES).json()
    groups = {g["key"]: g for g in read["groups"]}
    assert groups["pac_sr"] == {"key": "pac_sr", "name": "PAC SR", "call_level": "3RD_CALL",
                                "active": True, "members": 1}
    assert len(read["revision"]) == 16
    assert client.get(RULES).json()["revision"] == read["revision"]


# --------------------------------------------------------------------------- save


def test_save_with_errors_returns_422_listing_all(api) -> None:
    client, _sessions, _state = api
    read, body = body_of(client)
    rule(body, "MAIN_PAC_3RD")["allowed_cluster_keys"] = ["gone"]
    rule(body, "MAIN_1ST_24HR")["allowed_call_levels"] = ["7TH"]
    rule(body, "MAIN_2ND_24HR")["duration_hours"] = 72
    res = client.put(RULES, json=body)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "invalid_rules" and detail["message"]
    errors = sorted(p["code"] for p in detail["problems"] if p["severity"] == "error")
    assert errors == ["bad_hours", "unknown_call_level", "unknown_group"]
    assert client.get(RULES).json()["revision"] == read["revision"]


def test_save_with_warnings_only_succeeds(api) -> None:
    client, _sessions, _state = api
    read, body = body_of(client)
    # Limits can no longer change here (Limits API); a duplicate label is a warning-only save.
    rule(body, "MAIN_PAC_SENIOR")["label"] = rule(body, "MAIN_PAC_3RD")["label"]
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    saved = res.json()
    assert rule(saved, "MAIN_PAC_SENIOR")["label"] == rule(saved, "MAIN_PAC_3RD")["label"]
    assert saved["revision"] != read["revision"] and saved["groups"]


def test_save_stale_revision_409(api) -> None:
    client, _sessions, _state = api
    read, body = body_of(client, base="old")
    body["notes"] = "nope"
    res = client.put(RULES, json=body)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "stale_rules"
    assert res.json()["detail"]["current_revision"] == read["revision"]


# --------------------------------------------------------------------------- versions


def save(client, notes, label=None):
    _read, body = body_of(client)
    body["notes"] = notes
    if label:
        rule(body, "MAIN_PAC_SENIOR")["label"] = label
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_versions_list_get_restore(api) -> None:
    client, _sessions, _state = api
    original = client.get(RULES).json()
    first = save(client, "one", label="Senior PAC renamed")
    second = save(client, "two")
    versions = client.get(f"{RULES}/versions").json()
    assert [v["note"] for v in versions][-1] == "Before history"
    assert versions[-1]["revision"] == original["revision"]
    assert versions[0]["revision"] == second["revision"]
    assert versions[1]["revision"] == first["revision"]
    assert versions[1]["changed_duties"] == ["Senior PAC renamed"]
    assert versions[0]["saved_by"] == "RR Admin"
    detail = client.get(f"{RULES}/versions/{versions[1]['version_id']}").json()
    assert detail["rules"]["notes"] == "one" and detail["saved_by"] == "RR Admin"

    restored = client.post(f"{RULES}/versions/{versions[-1]['version_id']}/restore",
                           json={"base_revision": second["revision"]})
    assert restored.status_code == 200, restored.text
    assert restored.json()["revision"] == original["revision"]
    after = client.get(f"{RULES}/versions").json()
    assert len(after) == len(versions) + 1
    assert after[0]["note"].startswith("Restored")


def test_restore_stale_409_and_unknown_404(api) -> None:
    client, _sessions, _state = api
    current = save(client, "one")
    vid = client.get(f"{RULES}/versions").json()[-1]["version_id"]
    stale = client.post(f"{RULES}/versions/{vid}/restore", json={"base_revision": "old"})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_rules"
    assert client.get(RULES).json()["revision"] == current["revision"]
    assert client.get(f"{RULES}/versions/{uuid4()}").status_code == 404
    assert client.post(f"{RULES}/versions/{uuid4()}/restore", json={"base_revision": None}).status_code == 404


# --------------------------------------------------------------------------- gaps and access


def test_eligibility_gaps(api) -> None:
    client, sessions, _state = api
    with sessions() as s:
        member(s, None, "Only first", "1ST_CALL")
        member(s, None, "Third outside groups", "3RD_CALL")
    res = client.get(GAPS, params={"month": MONTH})
    assert res.status_code == 200, res.text
    gaps = {g["duty_key"]: g for g in res.json()}
    assert "MAIN_1ST_24HR" not in gaps
    assert gaps["MAIN_2ND_24HR"]["reason"] == "Nobody active is listed as 2nd call."
    assert gaps["RC_3RD_CALL_A"]["reason"] == "Not in 3rd Call A"
    assert "PAC" not in gaps
    assert client.get(GAPS, params={"month": "May"}).status_code == 400


def test_non_admin_gets_403(api) -> None:
    client, _sessions, state = api
    _read, body = body_of(client)
    state["user"] = UserAccount(id=uuid4(), username="viewer", display_name="Viewer", role="rota_board_member")
    vid = uuid4()
    responses = [
        client.get(RULES),
        client.post(f"{RULES}/check", json=body),
        client.put(RULES, json=body),
        client.get(f"{RULES}/versions"),
        client.get(f"{RULES}/versions/{vid}"),
        client.post(f"{RULES}/versions/{vid}/restore", json={"base_revision": None}),
        client.get(GAPS, params={"month": MONTH}),
    ]
    assert {r.status_code for r in responses} == {403}


# --------------------------------------------------------------------------- templates


def template_world(sessions, changes):
    from app.services.rota_setup import monthly_setup, update_scope_units
    from app.services.rota_template import TemplateGenerationOptions, generate_empty_template

    with sessions() as s:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN", minimum_free_people=0)
        other = Unit(code="UNIT_II", name="Unit II", campus="MAIN", minimum_free_people=0)
        s.add_all([unit, other])
        s.commit()
        people = {
            "sr": member(s, unit, "SR", "3RD_CALL", [cluster(s, "pac_sr")]),
            "senior": member(s, unit, "Senior", "4TH_CALL", [cluster(s, "pac_senior")]),
            "loose4": member(s, unit, "Loose Senior", "4TH_CALL"),
        }
        store_rules(s, changes)
        _period, scope = monthly_setup(s, MONTH)
        update_scope_units(s, scope, [unit.id], [other.id], True, True, "ready")
        generate_empty_template(s, MONTH, TemplateGenerationOptions(
            duty_keys=list(changes), starts_on=date(2026, 5, 4), ends_on=date(2026, 5, 4)))
        s.commit()
        slots = {slot.duty_type: (slot.id, slot.call_level) for slot in s.scalars(select(DutySlot))}
        return slots, {k: str(p.id) for k, p in people.items()}, unit.id


def eligible_ids(sessions, slot_id) -> set[str]:
    from app.services.rota_safety import month_safety

    with sessions() as s:
        row = next(r for r in month_safety(s, MONTH)["slots"] if r["slot_id"] == str(slot_id))
    return {p["person_id"] for p in row["available_people"] + row["hard_blocked_people"]}


PAC_TWO_GROUPS = {"MAIN_PAC_3RD": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                                   "allowed_cluster_keys": ["pac_sr", "pac_senior"]}}


def test_template_multi_level_duty_slot_unstamped_and_both_levels_eligible() -> None:
    """A pool duty's slot is not stamped; its pool (3rd + 4th call groups) is read from the rule."""
    engine, sessions = new_sessions()
    slots, ids, _unit = template_world(sessions, PAC_TWO_GROUPS)
    slot_id, level = slots["MAIN_PAC_3RD"]
    assert level is None
    assert eligible_ids(sessions, slot_id) == {ids["sr"], ids["senior"]}
    engine.dispose()


def test_template_single_level_duty_still_stamped() -> None:
    engine, sessions = new_sessions()
    slots, ids, _unit = template_world(sessions, {
        "MAIN_PAC_SENIOR": {"active": True, "allowed_call_levels": ["4TH_CALL"], "allowed_cluster_keys": []},
    })
    slot_id, level = slots["MAIN_PAC_SENIOR"]
    assert level == "4TH_CALL"
    assert eligible_ids(sessions, slot_id) == {ids["senior"], ids["loose4"]}
    engine.dispose()


def test_existing_stamped_slot_still_overrides() -> None:
    engine, sessions = new_sessions()
    slots, ids, unit_id = template_world(sessions, PAC_TWO_GROUPS)
    with sessions() as s:
        template_slot = s.get(DutySlot, slots["MAIN_PAC_3RD"][0])
        starts = datetime.combine(date(2026, 5, 6), time(8))
        old = DutySlot(rota_period_id=template_slot.rota_period_id, unit_id=unit_id,
                       duty_date=date(2026, 5, 6), duty_type="MAIN_PAC_3RD", call_level="3RD_CALL",
                       slot_label="old-stamped", starts_at=starts, ends_at=starts + timedelta(hours=8),
                       is_24hr=False, source=template_slot.source)
        s.add(old)
        s.commit()
        old_id = old.id
    assert eligible_ids(sessions, old_id) == {ids["sr"]}
    engine.dispose()
