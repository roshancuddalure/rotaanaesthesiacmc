"""Independent contract tests for docs/rota_rules_contract.md (Rota Rules: eligibility, checks
and history). Written from the contract alone, not from the implementation.

Areas:
A. eligibility matrix through the real safety path (month_safety -> slot_safety), manual
   assignment validation (validate_assignment + POST assign API) and the public helpers in
   app.services.rota_eligibility;
B. template generation call-level stamping (new templates only);
C. the admin rota-rules API (GET/check/PUT/versions/restore/eligibility-gaps, 403s).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from uuid import UUID, uuid4

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
from app.services.rota_setup import monthly_setup, update_scope_units

MONTH = "2026-05"
SLOT_DAY = date(2026, 5, 10)
RULES = "/api/v1/admin/rota-rules/phase-one"


# --------------------------------------------------------------------------- helpers


def make_sessions():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine)


def write_rules(session: Session, changes: dict[str, dict]) -> None:
    """Persist duty-rule field changes straight into the rule setting (bypasses API checks)."""
    rule_version, rules = get_phase_one_rules(session)
    by_key = rules.duty_rules_by_key
    for key, fields in changes.items():
        for name, value in fields.items():
            setattr(by_key[key], name, value)
    setting = session.scalar(
        select(RuleSetting).where(
            RuleSetting.rule_version_id == rule_version.id,
            RuleSetting.key == PHASE_ONE_SETTING_KEY,
        )
    )
    setting.value = rules.model_dump(mode="json")
    session.commit()


def group(session: Session, key: str) -> CallCluster:
    ensure_default_call_clusters(session)
    return session.scalar(select(CallCluster).where(CallCluster.key == key))


def add_group(session: Session, key: str, name: str, call_level: str, active: bool = True) -> CallCluster:
    cluster = CallCluster(key=key, name=name, call_level=call_level, active=active)
    session.add(cluster)
    session.commit()
    return cluster


def add_member(
    session: Session,
    unit: Unit | None,
    name: str,
    call_level: str,
    groups: list[tuple[CallCluster, date, date | None]] = (),
    posting_from: date = date(2026, 1, 1),
) -> Person:
    person = Person(canonical_name=name, call_level=call_level, active_status="active")
    session.add(person)
    session.flush()
    if unit is not None:
        session.add(
            PersonPosting(
                person=person,
                unit=unit,
                posting_type=call_level,
                starts_on=posting_from,
                source="unit_board",
            )
        )
    for cluster, starts, ends in groups:
        session.add(
            PersonCallClusterMembership(
                person_id=person.id,
                cluster_id=cluster.id,
                effective_from=starts,
                effective_to=ends,
                source="manual",
            )
        )
    session.commit()
    return person


def add_unit(session: Session, code: str = "UNIT_I") -> Unit:
    unit = Unit(code=code, name=f"Unit {code}", campus="MAIN", minimum_free_people=0)
    session.add(unit)
    session.commit()
    return unit


def add_slot(session: Session, unit: Unit, duty_type: str, day: date = SLOT_DAY, call_level: str | None = None) -> DutySlot:
    period, _scope = monthly_setup(session, MONTH)
    starts_at = datetime.combine(day, time(hour=8))
    slot = DutySlot(
        rota_period=period,
        unit=unit,
        duty_date=day,
        duty_type=duty_type,
        call_level=call_level,
        slot_label=f"{unit.code}:{duty_type}:{day.isoformat()}:{uuid4().hex[:6]}",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=8),
        is_24hr=False,
        source="phase4_template",
    )
    session.add(slot)
    session.commit()
    return slot


def eligible_ids_via_safety(sessions, slot_id) -> set[str]:
    from app.services.rota_safety import month_safety

    with sessions() as session:
        safety = month_safety(session, MONTH)
    row = next(r for r in safety["slots"] if r["slot_id"] == str(slot_id))
    ids = {p["person_id"] for p in row["available_people"]}
    ids |= {p["person_id"] for p in row["hard_blocked_people"]}
    assert row["eligible_members"] == len(ids)
    return ids


def validation_for(sessions, slot_id, person_id) -> dict:
    from app.services.rota_assignment import hydrate_slot, validate_assignment

    with sessions() as session:
        slot = hydrate_slot(session, slot_id)
        person = session.get(Person, UUID(str(person_id)))
        return validate_assignment(session, slot=slot, person=person, replace_existing=False)


def is_blocked(validation: dict) -> bool:
    return validation["status"] == "blocked"


def eligibility_messages(validation: dict) -> str:
    return " | ".join(i["message"] for i in validation["issues"] if i["severity"] == "blocked")


@pytest.fixture
def pac_world():
    """The owner's bug: MAIN_PAC_3RD (3rd-call-named) allowing PAC SR (3rd) + PAC Senior (4th)."""
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        pac_sr, pac_senior = group(s, "pac_sr"), group(s, "pac_senior")
        sr = add_member(s, unit, "SR Third", "3RD_CALL", [(pac_sr, date(2026, 1, 1), None)])
        senior = add_member(s, unit, "Senior Fourth", "4TH_CALL", [(pac_senior, date(2026, 1, 1), None)])
        loose4 = add_member(s, unit, "Loose Fourth", "4TH_CALL")
        loose3 = add_member(s, unit, "Loose Third", "3RD_CALL")
        second = add_member(s, unit, "Second Call", "2ND_CALL")
        write_rules(
            s,
            {"MAIN_PAC_3RD": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                              "allowed_cluster_keys": ["pac_sr", "pac_senior"], "excluded_cluster_keys": []}},
        )
        slot = add_slot(s, unit, "MAIN_PAC_3RD")
        ids = {n: str(p.id) for n, p in
               {"sr": sr, "senior": senior, "loose4": loose4, "loose3": loose3, "second": second}.items()}
        yield sessions, slot.id, ids, unit.id
    engine.dispose()


# --------------------------------------------------------------------------- A. eligibility


def test_a_no_groups_explicit_call_level_allows_only_that_level() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        fourth = add_member(s, unit, "Fourth", "4TH_CALL")
        third = add_member(s, unit, "Third", "3RD_CALL")
        write_rules(s, {"MAIN_PAC_SENIOR": {"active": True, "allowed_call_levels": ["4TH_CALL"],
                                            "allowed_cluster_keys": [], "excluded_cluster_keys": []}})
        slot = add_slot(s, unit, "MAIN_PAC_SENIOR")
        fourth_id, third_id, slot_id = str(fourth.id), str(third.id), slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {fourth_id}
    assert not is_blocked(validation_for(sessions, slot_id, fourth_id))
    assert is_blocked(validation_for(sessions, slot_id, third_id))


def test_a_no_groups_empty_allowed_list_infers_level_from_duty_key() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        first = add_member(s, unit, "First", "1ST_CALL")
        second = add_member(s, unit, "Second", "2ND_CALL")
        write_rules(s, {"MAIN_1ST_24HR": {"allowed_call_levels": [], "allowed_cluster_keys": [],
                                          "excluded_cluster_keys": []}})
        slot = add_slot(s, unit, "MAIN_1ST_24HR")
        first_id, second_id, slot_id = str(first.id), str(second.id), slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {first_id}
    assert is_blocked(validation_for(sessions, slot_id, second_id))


def test_a_one_group_member_eligible_same_level_non_member_not() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        a = group(s, "3rd_call_a")
        inside = add_member(s, unit, "In A", "3RD_CALL", [(a, date(2026, 1, 1), None)])
        outside = add_member(s, unit, "Not In A", "3RD_CALL")
        write_rules(s, {"MAIN_PAC_SR_A": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                                          "allowed_cluster_keys": ["3rd_call_a"], "excluded_cluster_keys": []}})
        slot = add_slot(s, unit, "MAIN_PAC_SR_A")
        in_id, out_id, slot_id = str(inside.id), str(outside.id), slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {in_id}
    assert not is_blocked(validation_for(sessions, slot_id, in_id))
    blocked = validation_for(sessions, slot_id, out_id)
    assert is_blocked(blocked)
    assert "3rd Call A" in eligibility_messages(blocked)


# Call-level pools (docs/call_level_pool_and_balance_contract.md section 1, 22 Oct 2026): groups
# of two levels make the duty a deliberate *pool*: members of either level (in an allowed group)
# may take it; other levels are still refused. Only a duty with no level is unresolved.


def test_a_two_groups_different_levels_safety_path(pac_world) -> None:
    sessions, slot_id, ids, _unit = pac_world
    assert eligible_ids_via_safety(sessions, slot_id) == {ids["sr"], ids["senior"]}


def test_a_two_groups_different_levels_manual_validation(pac_world) -> None:
    sessions, slot_id, ids, _unit = pac_world
    assert not is_blocked(validation_for(sessions, slot_id, ids["sr"]))
    assert not is_blocked(validation_for(sessions, slot_id, ids["senior"])), \
        validation_for(sessions, slot_id, ids["senior"])["issues"]
    for name in ("loose4", "loose3", "second"):
        validation = validation_for(sessions, slot_id, ids[name])
        assert is_blocked(validation), name
        assert "call_level_unresolved" not in {i["code"] for i in validation["issues"]}, name
    assert "call_level_mismatch" in {
        i["code"] for i in validation_for(sessions, slot_id, ids["second"])["issues"]}


def test_a_two_groups_reason_texts(pac_world) -> None:
    sessions, slot_id, ids, _unit = pac_world
    group_msg = eligibility_messages(validation_for(sessions, slot_id, ids["loose4"]))
    assert "PAC SR" in group_msg and "PAC Senior" in group_msg, group_msg
    level_msg = eligibility_messages(validation_for(sessions, slot_id, ids["second"]))
    assert "3rd" in level_msg and "4th" in level_msg and "2nd" in level_msg, level_msg


def test_a_two_groups_manual_assign_api(pac_world) -> None:
    sessions, slot_id, ids, _unit = pac_world
    user = UserAccount(id=uuid4(), username="adm", display_name="Admin", role="superadmin")
    app.dependency_overrides[get_db] = lambda: (yield from _gen(sessions))
    app.dependency_overrides[current_user] = lambda: user
    try:
        client = TestClient(app)
        ok = client.post(f"/api/v1/rota-assignments/slots/{slot_id}/assign",
                         json={"person_id": ids["senior"], "override_reason": "contract test"})
        assert ok.status_code == 200, ok.text
        bad = client.post(f"/api/v1/rota-assignments/slots/{slot_id}/assign",
                          json={"person_id": ids["second"], "replace_existing": True,
                                "override_reason": "contract test"})
        assert bad.status_code == 409, bad.text
        assert bad.json()["detail"]["validation"]["status"] == "blocked"
    finally:
        app.dependency_overrides.clear()


def _gen(sessions):
    with sessions() as session:
        yield session


def test_a_existing_slot_with_stamped_call_level_still_overrides(pac_world) -> None:
    sessions, _slot_id, ids, unit_id = pac_world
    with sessions() as s:
        unit = s.get(Unit, unit_id)
        stamped = add_slot(s, unit, "MAIN_PAC_3RD", day=date(2026, 5, 12), call_level="3RD_CALL")
        stamped_id = stamped.id
    assert eligible_ids_via_safety(sessions, stamped_id) == {ids["sr"]}
    assert is_blocked(validation_for(sessions, stamped_id, ids["senior"]))


def test_a_excluded_group_overrides_eligibility() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        schell = add_group(s, "schell", "Schell", "1ST_CALL")
        excluded = add_member(s, unit, "Excluded First", "1ST_CALL", [(schell, date(2026, 1, 1), None)])
        normal = add_member(s, unit, "Normal First", "1ST_CALL")
        write_rules(s, {"MAIN_1ST_24HR": {"allowed_call_levels": [], "allowed_cluster_keys": [],
                                          "excluded_cluster_keys": ["schell"]}})
        slot = add_slot(s, unit, "MAIN_1ST_24HR")
        ex_id, ok_id, slot_id = str(excluded.id), str(normal.id), slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {ok_id}
    v = validation_for(sessions, slot_id, ex_id)
    assert is_blocked(v)
    assert "Schell" in eligibility_messages(v)


def test_a_excluded_group_beats_allowed_group() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        a = group(s, "3rd_call_a")
        schell = add_group(s, "schell3", "Schell Three", "3RD_CALL")
        both = add_member(s, unit, "Both", "3RD_CALL",
                          [(a, date(2026, 1, 1), None), (schell, date(2026, 1, 1), None)])
        only_a = add_member(s, unit, "Only A", "3RD_CALL", [(a, date(2026, 1, 1), None)])
        write_rules(s, {"MAIN_PAC_SR_A": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                                          "allowed_cluster_keys": ["3rd_call_a"],
                                          "excluded_cluster_keys": ["schell3"]}})
        slot = add_slot(s, unit, "MAIN_PAC_SR_A")
        both_id, a_id, slot_id = str(both.id), str(only_a.id), slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {a_id}
    assert is_blocked(validation_for(sessions, slot_id, both_id))


def test_a_inactive_group_members_not_eligible(pac_world) -> None:
    sessions, slot_id, ids, _unit = pac_world
    with sessions() as s:
        group(s, "pac_senior").active = False
        s.commit()
    assert eligible_ids_via_safety(sessions, slot_id) == {ids["sr"]}
    assert is_blocked(validation_for(sessions, slot_id, ids["senior"]))


def test_a_membership_date_window_respected() -> None:
    engine, sessions = make_sessions()
    with sessions() as s:
        unit = add_unit(s)
        a = group(s, "3rd_call_a")
        expired = add_member(s, unit, "Expired", "3RD_CALL", [(a, date(2026, 5, 1), date(2026, 5, 5))])
        future = add_member(s, unit, "Future", "3RD_CALL", [(a, date(2026, 5, 15), None)])
        current = add_member(s, unit, "Current", "3RD_CALL", [(a, date(2026, 5, 1), date(2026, 5, 31))])
        edge = add_member(s, unit, "Edge", "3RD_CALL", [(a, date(2026, 5, 10), date(2026, 5, 10))])
        write_rules(s, {"MAIN_PAC_SR_A": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                                          "allowed_cluster_keys": ["3rd_call_a"], "excluded_cluster_keys": []}})
        slot = add_slot(s, unit, "MAIN_PAC_SR_A")
        ids = {n: str(p.id) for n, p in
               {"expired": expired, "future": future, "current": current, "edge": edge}.items()}
        slot_id = slot.id
    assert eligible_ids_via_safety(sessions, slot_id) == {ids["current"], ids["edge"]}
    assert is_blocked(validation_for(sessions, slot_id, ids["expired"]))
    assert is_blocked(validation_for(sessions, slot_id, ids["future"]))


def test_a_effective_call_levels_union_and_inference() -> None:
    from app.services.rota_eligibility import effective_call_levels

    engine, sessions = make_sessions()
    with sessions() as s:
        ensure_default_call_clusters(s)
        groups = {c.key: c for c in s.scalars(select(CallCluster))}
        _v, rules = get_phase_one_rules(s)
        rule = rules.duty_rules_by_key["MAIN_PAC_3RD"].model_copy(deep=True)
        rule.allowed_call_levels = ["3RD_CALL"]
        rule.allowed_cluster_keys = ["pac_sr", "pac_senior"]
        assert set(effective_call_levels(rule, groups)) == {"3RD_CALL", "4TH_CALL"}
        rule.allowed_call_levels = []
        assert set(effective_call_levels(rule, groups)) == {"3RD_CALL", "4TH_CALL"}
        groups["pac_senior"].active = False
        assert set(effective_call_levels(rule, groups)) == {"3RD_CALL"}
        first = rules.duty_rules_by_key["MAIN_1ST_24HR"].model_copy(deep=True)
        first.allowed_call_levels, first.allowed_cluster_keys = [], []
        assert set(effective_call_levels(first, groups)) == {"1ST_CALL"}
    engine.dispose()


# --------------------------------------------------------------------------- B. templates


def _template_world(sessions, rule_changes):
    from app.services.rota_template import TemplateGenerationOptions, generate_empty_template

    with sessions() as s:
        included = add_unit(s, "UNIT_I")
        excluded = add_unit(s, "UNIT_II")
        pac_sr, pac_senior = group(s, "pac_sr"), group(s, "pac_senior")
        add_member(s, included, "SR", "3RD_CALL", [(pac_sr, date(2026, 1, 1), None)])
        add_member(s, included, "Senior", "4TH_CALL", [(pac_senior, date(2026, 1, 1), None)])
        add_member(s, included, "First", "1ST_CALL")
        write_rules(s, rule_changes)
        _period, scope = monthly_setup(s, MONTH)
        update_scope_units(s, scope, [included.id], [excluded.id], True, True, "ready")
        generate_empty_template(
            s, MONTH,
            TemplateGenerationOptions(duty_keys=list(rule_changes), starts_on=date(2026, 5, 4),
                                      ends_on=date(2026, 5, 4)),
        )
        s.commit()
        return {slot.duty_type: slot.call_level for slot in s.scalars(select(DutySlot))}


def test_b_template_multi_level_duty_slot_has_no_call_level() -> None:
    engine, sessions = make_sessions()
    levels = _template_world(sessions, {
        "MAIN_PAC_3RD": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                         "allowed_cluster_keys": ["pac_sr", "pac_senior"]},
    })
    assert "MAIN_PAC_3RD" in levels
    assert levels["MAIN_PAC_3RD"] is None


def test_b_template_single_level_duty_slot_is_stamped() -> None:
    engine, sessions = make_sessions()
    levels = _template_world(sessions, {
        "MAIN_PAC_SENIOR": {"active": True, "allowed_call_levels": ["4TH_CALL"], "allowed_cluster_keys": []},
        "MAIN_1ST_24HR": {"allowed_call_levels": [], "allowed_cluster_keys": []},
    })
    assert levels["MAIN_PAC_SENIOR"] == "4TH_CALL"
    assert levels["MAIN_1ST_24HR"] == "1ST_CALL"


def test_b_template_group_of_same_level_stays_single_level() -> None:
    engine, sessions = make_sessions()
    levels = _template_world(sessions, {
        "MAIN_PAC_SR_A": {"active": True, "allowed_call_levels": ["3RD_CALL"],
                          "allowed_cluster_keys": ["3rd_call_a", "pac_sr"]},
    })
    assert levels["MAIN_PAC_SR_A"] == "3RD_CALL"


# --------------------------------------------------------------------------- C. API


@pytest.fixture
def api():
    engine, sessions = make_sessions()
    admin = UserAccount(id=uuid4(), username="rules-admin", display_name="Rules Admin", role="computer_admin",
                        password_hash="x")
    with sessions() as s:
        s.add(admin)
        s.commit()
        s.refresh(admin)
        s.expunge(admin)
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


def payload_from(read: dict, base_revision) -> dict:
    keys = ("duty_rules", "duty_count_limits", "rest_rules", "unit_staffing_rules", "notes")
    body = {k: read[k] for k in keys}
    body["base_revision"] = base_revision
    return body


def duty(body: dict, key: str) -> dict:
    return next(r for r in body["duty_rules"] if r["key"] == key)


def seed_pac_members(sessions) -> dict:
    today = date.today()
    with sessions() as s:
        unit = add_unit(s)
        pac_sr, pac_senior = group(s, "pac_sr"), group(s, "pac_senior")
        sr = add_member(s, unit, "SR", "3RD_CALL", [(pac_sr, today - timedelta(days=30), None)])
        add_member(s, unit, "Old SR", "3RD_CALL",
                   [(pac_sr, today - timedelta(days=90), today - timedelta(days=60))])
        senior = add_member(s, unit, "Senior", "4TH_CALL", [(pac_senior, today - timedelta(days=30), None)])
        add_member(s, unit, "Loose Fourth", "4TH_CALL")
        add_member(s, unit, "Second", "2ND_CALL")
        return {"sr": sr.id, "senior": senior.id}


def codes(problems, severity=None) -> list[str]:
    return [p["code"] for p in problems if severity is None or p["severity"] == severity]


def test_c_get_has_revision_and_groups_with_member_counts(api) -> None:
    client, sessions, _ = api
    seed_pac_members(sessions)
    read = client.get(RULES).json()
    assert isinstance(read["revision"], str) and read["revision"]
    groups = {g["key"]: g for g in read["groups"]}
    for field in ("key", "name", "call_level", "active", "members"):
        assert field in groups["pac_sr"]
    assert groups["pac_sr"]["members"] == 1  # the expired membership is not counted
    assert groups["pac_senior"]["members"] == 1
    assert groups["pac_senior"]["call_level"] == "4TH_CALL"
    assert groups["3rd_call_c"]["members"] == 0
    assert client.get(RULES).json()["revision"] == read["revision"]


def test_c_check_effective_levels_and_eligible_now_for_two_groups(api) -> None:
    client, sessions, _ = api
    seed_pac_members(sessions)
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    d = duty(body, "MAIN_PAC_3RD")
    d.update(active=True, allowed_call_levels=["3RD_CALL"], allowed_cluster_keys=["pac_sr", "pac_senior"],
             excluded_cluster_keys=[])
    res = client.post(f"{RULES}/check", json=body)
    assert res.status_code == 200, res.text
    info = res.json()["duties"]["MAIN_PAC_3RD"]
    assert sorted(info["effective_call_levels"]) == ["3RD_CALL", "4TH_CALL"]
    # Two levels = a pool: members of both levels are eligible; the check notes the pool (info).
    assert info["eligible_now"] == 2
    assert {k: v for k, v in info["eligible_by_level"].items() if v} == {"3RD_CALL": 1, "4TH_CALL": 1}
    problem = next(p for p in res.json()["problems"]
                   if p["duty_key"] == "MAIN_PAC_3RD" and p["code"] == "call_level_pool")
    assert problem["severity"] == "info"
    assert problem["message"] == "Main PAC 3rd Call: open to 3rd call and 4th call (pool)"
    assert not [p for p in res.json()["problems"] if p["code"] == "call_level_not_single"]
    first = res.json()["duties"]["MAIN_2ND_24HR"]
    assert first["effective_call_levels"] == ["2ND_CALL"]
    assert first["eligible_now"] == 1


def test_c_check_does_not_save(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    body["notes"] = "check only"
    assert client.post(f"{RULES}/check", json=body).status_code == 200
    after = client.get(RULES).json()
    assert after["revision"] == read["revision"] and after["notes"] != "check only"


@pytest.mark.parametrize(
    "code,mutate",
    [
        ("unknown_group", lambda b: duty(b, "MAIN_PAC_3RD").update(allowed_cluster_keys=["no_such_group"])),
        ("allowed_and_excluded", lambda b: duty(b, "MAIN_PAC_3RD").update(
            allowed_cluster_keys=["pac_sr"], excluded_cluster_keys=["pac_sr"])),
        ("unknown_call_level", lambda b: duty(b, "MAIN_PAC_3RD").update(allowed_call_levels=["9TH_CALL"])),
        ("unknown_duty", lambda b: b["duty_rules"].append({**duty(b, "MAIN_PAC_3RD"), "key": "NOT_A_DUTY",
                                                            "label": "Ghost duty"})),
        ("bad_group", lambda b: duty(b, "MAIN_PAC_3RD").update(group="no_such_category")),
        ("bad_hours", lambda b: duty(b, "MAIN_PAC_3RD").update(duration_hours=99)),
    ],
)
def test_c_check_error_codes(api, code, mutate) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    mutate(body)
    res = client.post(f"{RULES}/check", json=body)
    assert res.status_code == 200, res.text
    problems = res.json()["problems"]
    assert code in codes(problems, "error"), problems
    match = next(p for p in problems if p["code"] == code)
    for field in ("duty_key", "field", "code", "severity", "message", "fix"):
        assert field in match


def test_c_check_inactive_group_warning(api) -> None:
    client, sessions, _ = api
    seed_pac_members(sessions)
    with sessions() as s:
        group(s, "pac_senior").active = False
        s.commit()
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    duty(body, "MAIN_PAC_3RD").update(active=True, allowed_cluster_keys=["pac_sr", "pac_senior"])
    res = client.post(f"{RULES}/check", json=body).json()
    hits = [p for p in res["problems"] if p["code"] == "inactive_group"]
    assert hits and all(p["severity"] == "warning" for p in hits)
    assert any(p["duty_key"] == "MAIN_PAC_3RD" for p in hits)
    info = res["duties"]["MAIN_PAC_3RD"]
    assert sorted(info["effective_call_levels"]) == ["3RD_CALL"]
    assert info["eligible_now"] == 1


def test_c_check_empty_group_and_nobody_eligible_warnings(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    duty(body, "MAIN_PAC_PG").update(active=True, allowed_cluster_keys=["3rd_call_c"])
    res = client.post(f"{RULES}/check", json=body).json()
    empty = [p for p in res["problems"] if p["code"] == "empty_group" and p["duty_key"] == "MAIN_PAC_PG"]
    nobody = [p for p in res["problems"] if p["code"] == "nobody_eligible" and p["duty_key"] == "MAIN_PAC_PG"]
    assert empty and empty[0]["severity"] == "warning"
    assert nobody and nobody[0]["severity"] == "warning"
    assert res["duties"]["MAIN_PAC_PG"]["eligible_now"] == 0


def test_c_check_label_duplicate_warning(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    duty(body, "MAIN_PAC_3RD")["label"] = duty(body, "MAIN_PAC_SENIOR")["label"]
    problems = client.post(f"{RULES}/check", json=body).json()["problems"]
    hits = [p for p in problems if p["code"] == "label_duplicate"]
    assert hits and hits[0]["severity"] == "warning"


def test_c_check_guardrail_warning(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    body["unit_staffing_rules"].update(warning_unavailable_percent=50, hard_block_unavailable_percent=20)
    res = client.post(f"{RULES}/check", json=body)
    assert res.status_code == 200, res.text
    hits = [p for p in res.json()["problems"] if p["code"] == "guardrail"]
    assert hits and hits[0]["severity"] == "warning"


def test_c_put_with_three_errors_returns_422_listing_all(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    duty(body, "MAIN_PAC_3RD")["allowed_cluster_keys"] = ["no_such_group"]
    duty(body, "MAIN_PAC_SENIOR").update(allowed_cluster_keys=["pac_senior"], excluded_cluster_keys=["pac_senior"])
    duty(body, "MAIN_1ST_24HR")["allowed_call_levels"] = ["9TH_CALL"]
    res = client.put(RULES, json=body)
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "invalid_rules"
    errors = [p for p in detail["problems"] if p["severity"] == "error"]
    assert len(errors) == 3, errors
    assert sorted(p["code"] for p in errors) == ["allowed_and_excluded", "unknown_call_level", "unknown_group"]
    assert client.get(RULES).json()["revision"] == read["revision"]


def test_c_put_with_only_warnings_saves(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    body["notes"] = "warnings only"
    duty(body, "MAIN_PAC_PG").update(active=True, allowed_cluster_keys=["3rd_call_c"])  # empty group
    check = client.post(f"{RULES}/check", json=body).json()
    assert check["problems"] and not codes(check["problems"], "error")
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["notes"] == "warnings only"
    assert saved["revision"] != read["revision"]
    assert "groups" in saved
    assert client.get(RULES).json()["revision"] == saved["revision"]


def test_c_put_stale_base_revision_409(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, "stale-revision")
    body["notes"] = "should not save"
    res = client.put(RULES, json=body)
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "stale_rules"
    assert detail["current_revision"] == read["revision"]
    assert client.get(RULES).json()["notes"] != "should not save"


def test_c_put_null_base_revision_is_accepted(api) -> None:
    client, sessions, _ = api
    read = client.get(RULES).json()
    body = payload_from(read, None)
    body["notes"] = "no base"
    assert client.put(RULES, json=body).status_code == 200


def _save(client, notes, mutate=None):
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    body["notes"] = notes
    if mutate:
        mutate(body)
    res = client.put(RULES, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_c_versions_list_get_and_before_history(api) -> None:
    client, sessions, _ = api
    _save(client, "first save", lambda b: duty(b, "MAIN_PAC_3RD").update(label="Renamed PAC 3rd"))
    second = _save(client, "second save")
    res = client.get(f"{RULES}/versions")
    assert res.status_code == 200
    versions = res.json()
    assert len(versions) == 3  # "Before history" + two saves
    for field in ("version_id", "saved_at", "saved_by", "revision", "changed_duties", "note"):
        assert field in versions[0]
    saved_at = [v["saved_at"] for v in versions]
    assert saved_at == sorted(saved_at, reverse=True)
    assert versions[0]["revision"] == second["revision"]
    assert any("Before history" in (v["note"] or "") for v in versions)
    renamed = versions[1]
    assert any("PAC 3rd" in label for label in renamed["changed_duties"]), renamed
    assert "Rules Admin" in str(versions[0]["saved_by"]) or "rules-admin" in str(versions[0]["saved_by"])
    one = client.get(f"{RULES}/versions/{renamed['version_id']}")
    assert one.status_code == 200
    data = one.json()
    for field in ("version_id", "saved_at", "saved_by", "rules"):
        assert field in data
    assert data["rules"]["notes"] == "first save"


def test_c_restore_creates_new_version_and_applies_rules(api) -> None:
    client, sessions, _ = api
    _save(client, "version A")
    current = _save(client, "version B")
    versions = client.get(f"{RULES}/versions").json()
    target = next(v for v in versions if v["revision"] != current["revision"]
                  and client.get(f"{RULES}/versions/{v['version_id']}").json()["rules"]["notes"] == "version A")
    res = client.post(f"{RULES}/versions/{target['version_id']}/restore",
                      json={"base_revision": current["revision"]})
    assert res.status_code == 200, res.text
    after = client.get(RULES).json()
    assert after["notes"] == "version A"
    assert len(client.get(f"{RULES}/versions").json()) == len(versions) + 1


def test_c_restore_stale_409_and_unknown_404(api) -> None:
    client, sessions, _ = api
    current = _save(client, "only")
    versions = client.get(f"{RULES}/versions").json()
    vid = versions[-1]["version_id"]
    stale = client.post(f"{RULES}/versions/{vid}/restore", json={"base_revision": "stale-revision"})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_rules"
    assert client.get(RULES).json()["revision"] == current["revision"]
    unknown = str(uuid4()) if not str(vid).isdigit() else "987654"
    assert client.get(f"{RULES}/versions/{unknown}").status_code == 404
    missing = client.post(f"{RULES}/versions/{unknown}/restore", json={"base_revision": current["revision"]})
    assert missing.status_code == 404


def test_c_eligibility_gaps(api) -> None:
    client, sessions, _ = api
    with sessions() as s:
        unit = add_unit(s)
        add_member(s, unit, "First", "1ST_CALL")
    res = client.get("/api/v1/admin/rota-rules/eligibility-gaps?month=2026-11")
    assert res.status_code == 200, res.text
    gaps = {g["duty_key"]: g for g in res.json()}
    assert "MAIN_2ND_24HR" in gaps
    assert gaps["MAIN_2ND_24HR"]["label"] and gaps["MAIN_2ND_24HR"]["reason"]
    assert "MAIN_1ST_24HR" not in gaps
    assert "PAC" not in gaps  # inactive duties are not listed


def test_c_non_admin_gets_403_everywhere(api) -> None:
    client, sessions, state = api
    read = client.get(RULES).json()
    body = payload_from(read, read["revision"])
    state["user"] = UserAccount(id=uuid4(), username="board", display_name="Board", role="rota_board_member")
    vid = str(uuid4())
    calls = [
        client.get(RULES),
        client.post(f"{RULES}/check", json=body),
        client.put(RULES, json=body),
        client.get(f"{RULES}/versions"),
        client.get(f"{RULES}/versions/{vid}"),
        client.post(f"{RULES}/versions/{vid}/restore", json={"base_revision": read["revision"]}),
        client.get("/api/v1/admin/rota-rules/eligibility-gaps?month=2026-11"),
    ]
    assert [c.status_code for c in calls] == [403] * len(calls)
