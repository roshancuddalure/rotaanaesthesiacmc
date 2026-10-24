"""Superadmin allocation (docs/superadmin_override_contract.md §1). In-memory SQLite only."""

from __future__ import annotations

import time as clock
from datetime import date, datetime, time, timedelta
from uuid import UUID, uuid4

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
    ExtraDutyBatch,
    ExtraDutyRecord,
    LeaveRequest,
    NormalizationEvent,
    Person,
    PersonPosting,
    RotaPeriod,
    Unit,
    UserAccount,
)
from app.services.extra_duty import ledger_balance
from app.services.extra_duty_verify import check_month
from app.services.rota_rules import get_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.superadmin_allocation import SUPERADMIN_SOURCE

MONTH = "2026-05"
BASE = "/api/v1/superadmin-allocation"
DAY = date(2026, 5, 12)


def user(role: str) -> UserAccount:
    return UserAccount(id=uuid4(), username=role, display_name=f"{role} user", role=role, password_hash="x")


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


def make_slot(db, period, unit, day, duty_type="MAIN_1ST_24HR", *, hour=8, hours=24, call_level="1ST_CALL", label=None):
    start = datetime.combine(day, time(hour))
    slot = DutySlot(rota_period=period, unit=unit, duty_date=day, duty_type=duty_type, call_level=call_level,
                    slot_label=label or f"{unit.code}:{duty_type}:{day}:{hour}", starts_at=start,
                    ends_at=start + timedelta(hours=hours), is_24hr=hours >= 24, source="phase4_template",
                    template_status="ready")
    db.add(slot)
    db.flush()
    return slot


def make_person(db, name, unit, level="1ST_CALL"):
    person = Person(canonical_name=name, call_level=level)
    db.add(person)
    db.flush()
    if unit is not None:
        db.add(PersonPosting(person=person, unit=unit, posting_type=level, starts_on=date(2026, 4, 1),
                             source="unit_board"))
    db.flush()
    return person


def seed(sessions) -> dict:
    with sessions() as db:
        get_phase_one_rules(db)
        u1 = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        u2 = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
        db.add_all([u1, u2])
        db.flush()
        period, _scope = monthly_setup(db, MONTH)
        slot = make_slot(db, period, u1, DAY)
        holder = make_person(db, "Hana Holder", u1)
        leave = make_person(db, "Lena Leave", u1)
        rester = make_person(db, "Rita Rest", u1)
        busy = make_person(db, "Bob Busy", u1)
        second = make_person(db, "Sam Second", u2, "2ND_CALL")
        unposted = make_person(db, "Uma Unposted", None)
        archived = make_person(db, "Arch Archived", u1)
        archived.active_status = "archived"
        held = DutyAssignment(duty_slot=slot, person=holder, status="assigned", source="extra_duty_layer")
        db.add(held)
        db.add(LeaveRequest(person=leave, leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", starts_on=DAY,
                            ends_on=DAY, status="approved"))
        prev = make_slot(db, period, u2, DAY - timedelta(days=1), "MAIN_2ND_24HR", call_level="2ND_CALL")
        db.add(DutyAssignment(duty_slot=prev, person=rester, status="assigned", source="manual"))
        same = make_slot(db, period, u2, DAY, "OT_DAY", hour=8, hours=8, call_level=None)
        db.add(DutyAssignment(duty_slot=same, person=busy, status="assigned", source="manual"))
        db.flush()
        batch = ExtraDutyBatch(rota_period_id=period.id, month=MONTH, status="applied", plan_hash="p" * 64,
                               context_hash="c" * 64, summary={}, decisions=[], before_image=[])
        db.add(batch)
        db.flush()
        record = ExtraDutyRecord(batch_id=batch.id, person_id=holder.id, assignment_id=held.id, slot_id=slot.id,
                                 month=MONTH, duty_date=DAY, duty_type=slot.duty_type, home_unit_id=u1.id,
                                 assigned_unit_id=u1.id, fallback_used=False,
                                 overridden_rules=["unit_safety_hard_block"], justice={}, status="active")
        db.add(record)
        db.commit()
        return {k: v.id for k, v in dict(
            u1=u1, u2=u2, period=period, slot=slot, holder=holder, leave=leave, rester=rester, busy=busy,
            second=second, unposted=unposted, archived=archived, held=held, record=record).items()}


def allocate(client, ids, person_key, reason="Cover for the emergency list", **extra):
    return client.post(BASE, json={"slot_id": str(ids["slot"]), "person_id": str(ids[person_key]),
                                   "reason": reason, **extra})


# ------------------------------------------------------------------------------------- access


@pytest.mark.parametrize("role", ["computer_admin", "rota_board_member", "hod"])
def test_non_superadmin_is_403(api, role):
    client, sessions, state = api
    ids = seed(sessions)
    state["user"] = user(role)
    assert client.get(f"{BASE}/options", params={"slot_id": str(ids["slot"])}).status_code == 403
    assert allocate(client, ids, "second").status_code == 403
    assert client.post(f"{BASE}/{uuid4()}/undo", json={}).status_code == 403
    with sessions() as db:
        assert db.scalar(select(ExtraDutyBatch).where(ExtraDutyBatch.summary.is_not(None)).limit(1)).summary == {}


def test_not_found_and_validation(api):
    client, sessions, _state = api
    ids = seed(sessions)
    assert client.get(f"{BASE}/options", params={"slot_id": str(uuid4())}).status_code == 404
    response = client.post(BASE, json={"slot_id": str(uuid4()), "person_id": str(ids["second"]), "reason": "valid reason"})
    assert response.status_code == 404 and response.json()["detail"]["code"] == "slot_not_found"
    response = client.post(BASE, json={"slot_id": str(ids["slot"]), "person_id": str(uuid4()), "reason": "valid reason"})
    assert response.status_code == 404 and response.json()["detail"]["code"] == "person_not_found"
    response = allocate(client, ids, "second", reason="abc ")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "invalid_reason"
    assert allocate(client, ids, "second", reason="x" * 501).status_code == 422
    response = allocate(client, ids, "archived")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "inactive_member"


# ------------------------------------------------------------------------------------ options


def test_options_list_statuses_and_reasons(api):
    client, sessions, _state = api
    ids = seed(sessions)
    response = client.get(f"{BASE}/options", params={"slot_id": str(ids["slot"])})
    assert response.status_code == 200
    body = response.json()
    slot = body["slot"]
    assert slot["id"] == str(ids["slot"]) and slot["unit_name"] == "Unit I" and slot["is_24hr"] is True
    assert slot["duty_date"] == DAY.isoformat() and slot["call_level"] == "1ST_CALL" and slot["duty_label"]
    assert [c["person_name"] for c in slot["current"]] == ["Hana Holder"]
    people = {p["person_name"]: p for p in body["people"]}
    assert "Arch Archived" not in people  # only active members
    statuses = [p["status"] for p in body["people"]]
    assert statuses == sorted(statuses, key=lambda s: s != "available")  # available first
    available_names = [p["person_name"] for p in body["people"] if p["status"] == "available"]
    assert available_names == sorted(available_names, key=str.lower)

    lena = people["Lena Leave"]
    assert lena["status"] == "blocked" and lena["blocked"][0]["code"] == "on_leave"
    assert "On approved leave 12 May" in lena["blocked"][0]["detail"]
    rita = people["Rita Rest"]
    assert rita["status"] == "blocked" and rita["blocked"][0]["code"] == "rest_after_24hr"
    assert rita["blocked"][0]["detail"].startswith("Resting after 24-hour duty on 11 May")
    bob = people["Bob Busy"]
    assert bob["status"] == "blocked" and bob["blocked"][0]["code"] == "overlapping_duty"
    assert bob["blocked"][0]["detail"].startswith("Already on ") and "08:00–16:00 that day" in bob["blocked"][0]["detail"]

    hana = people["Hana Holder"]
    assert hana["status"] == "available" and hana["note"] == "Already on this duty"
    sam = people["Sam Second"]
    # Strict call level (limits contract section 1): a different level is its own status.
    assert sam["status"] == "cross_level" and sam["unit_name"] == "Unit II" and sam["call_level"] == "2ND_CALL"
    assert sam["warning"] == "Different call level: needs 1st call, Sam Second is 2nd call"
    codes = {o["code"] for o in sam["overrides"]}
    assert {"call_level_mismatch", "not_posted"} <= codes
    uma = people["Uma Unposted"]
    assert uma["unit_id"] is None and "not_posted" in {o["code"] for o in uma["overrides"]}
    assert all(set(p) >= {"person_id", "person_name", "call_level", "unit_id", "unit_name", "status", "blocked",
                          "overrides", "month_duties"} for p in body["people"])


def test_options_fast_for_two_hundred_people(api):
    client, sessions, _state = api
    ids = seed(sessions)
    with sessions() as db:
        u1 = db.get(Unit, ids["u1"])
        period = db.get(RotaPeriod, ids["period"])
        people = [make_person(db, f"Member {i:03d}", u1) for i in range(200)]
        for i, person in enumerate(people[:120]):
            s = make_slot(db, period, u1, date(2026, 5, 1) + timedelta(days=i % 28), "OT_DAY", hour=8 + i % 3,
                          hours=4, call_level=None, label=f"perf-{i}")
            db.add(DutyAssignment(duty_slot=s, person=person, status="assigned", source="manual"))
        db.commit()
    started = clock.perf_counter()
    response = client.get(f"{BASE}/options", params={"slot_id": str(ids["slot"])})
    elapsed = clock.perf_counter() - started
    assert response.status_code == 200 and len(response.json()["people"]) >= 200
    assert elapsed < 2.0, elapsed


# ----------------------------------------------------------------------------------- allocate


def test_allocate_overrides_and_replaces_holder(api):
    client, sessions, state = api
    ids = seed(sessions)
    refused = allocate(client, ids, "second")  # different call level: needs confirmation
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "cross_level_confirmation_required"
    response = allocate(client, ids, "second", confirm_cross_level=True)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) >= {"assignment_id", "batch_id", "slot_id", "person_id", "person_name", "overrides", "post_publish"}
    assert body["person_name"] == "Sam Second" and body["post_publish"] is False
    override_codes = [o["code"] for o in body["overrides"]]
    assert {"call_level_mismatch", "not_posted"} <= set(override_codes)

    with sessions() as db:
        new = db.get(DutyAssignment, UUID(body["assignment_id"]))
        assert new.source == SUPERADMIN_SOURCE and new.status == "assigned"
        assert new.override_reason == "Superadmin allocation: Cover for the emergency list"
        held = db.get(DutyAssignment, ids["held"])
        assert held.status == "cancelled"
        old = db.get(ExtraDutyRecord, ids["record"])
        assert old.status == "void" and old.void_reason == "replaced"
        batch = db.get(ExtraDutyBatch, UUID(body["batch_id"]))
        assert batch.status == "applied"
        summary = batch.summary
        assert summary["mode"] == "superadmin_allocation" and summary["filled"] == 1
        assert summary["ledger_records"] == 1 and summary["post_publish"] is False
        assert summary["by"] == state["user"].display_name and summary["reason"] == "Cover for the emergency list"
        assert len(batch.decisions) == 1 and batch.decisions[0]["person_name"] == "Sam Second"
        assert batch.decisions[0]["replaced"][0]["person_name"] == "Hana Holder"
        image = batch.before_image[0]
        assert image["cancelled_assignments"][0]["assignment_id"] == str(ids["held"])
        records = list(db.scalars(select(ExtraDutyRecord).where(ExtraDutyRecord.batch_id == batch.id)))
        assert len(records) == 1
        record = records[0]
        assert record.status == "active" and record.overridden_rules[0] == "superadmin_allocation"
        assert set(override_codes) <= set(record.overridden_rules)
        assert "superadmin_cross_level" in record.overridden_rules
        assert record.assignment_id == new.id and "ledger_count" in record.justice
        event = db.scalar(select(NormalizationEvent).where(NormalizationEvent.action == "superadmin_allocation"))
        assert event is not None and event.entity_id == new.id
        # Justice: the allocation counts in the ledger.
        assert ledger_balance(db, [ids["second"]], date(2026, 6, 1))[ids["second"]]["count"] == 1
        # The independent checker exempts it from call level / posting but checks the rest.
        result = check_month(db, MONTH, assignment_ids=[new.id])
        assert result["ok"], result["violations"]
        assert result["superadmin_exempt"] == 1


def test_allocate_unposted_member(api):
    client, sessions, _state = api
    ids = seed(sessions)
    response = allocate(client, ids, "unposted")
    assert response.status_code == 200, response.text
    assert "not_posted" in {o["code"] for o in response.json()["overrides"]}


@pytest.mark.parametrize("person_key,code,text", [
    ("leave", "on_leave", "On approved leave 12 May"),
    ("rester", "rest_after_24hr", "Resting after 24-hour duty on 11 May"),
    ("busy", "overlapping_duty", "that day"),
])
def test_strict_rules_refuse_and_write_nothing(api, person_key, code, text):
    client, sessions, _state = api
    ids = seed(sessions)
    response = allocate(client, ids, person_key)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "strict_blocked"
    assert detail["blocked"][0]["code"] == code and text in detail["blocked"][0]["detail"]
    assert text in detail["message"]
    with sessions() as db:
        assert db.get(DutyAssignment, ids["held"]).status == "assigned"
        assert db.get(ExtraDutyRecord, ids["record"]).status == "active"
        assert db.scalar(select(ExtraDutyBatch).where(ExtraDutyBatch.month == MONTH,
                                                      ExtraDutyBatch.plan_hash != "p" * 64)) is None
        assert db.scalar(select(DutyAssignment).where(DutyAssignment.source == SUPERADMIN_SOURCE)) is None


def test_rest_before_next_day_is_strict(api):
    """Forward direction: a 24-hour allocation the day before an existing duty is refused."""
    client, sessions, _state = api
    ids = seed(sessions)
    with sessions() as db:
        period = db.get(RotaPeriod, ids["period"])
        nxt = make_slot(db, period, db.get(Unit, ids["u2"]), DAY + timedelta(days=1), "OT_DAY", hours=8, call_level=None)
        db.add(DutyAssignment(duty_slot=nxt, person_id=ids["second"], status="assigned", source="manual"))
        db.commit()
    response = allocate(client, ids, "second")
    assert response.status_code == 409
    assert response.json()["detail"]["blocked"][0]["code"] == "rest_after_24hr"


def test_without_replace_full_slot_is_refused(api):
    client, sessions, _state = api
    ids = seed(sessions)
    response = allocate(client, ids, "second", replace_existing=False)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "slot_full"
    with sessions() as db:
        assert db.get(DutyAssignment, ids["held"]).status == "assigned"


def test_published_month_stays_published(api):
    client, sessions, _state = api
    ids = seed(sessions)
    with sessions() as db:
        db.get(RotaPeriod, ids["period"]).status = "published"
        db.commit()
    response = allocate(client, ids, "second", confirm_cross_level=True)
    assert response.status_code == 200, response.text
    assert response.json()["post_publish"] is True
    with sessions() as db:
        assert db.get(RotaPeriod, ids["period"]).status == "published"
        batch = db.get(ExtraDutyBatch, UUID(response.json()["batch_id"]))
        assert batch.summary["post_publish"] is True


# --------------------------------------------------------------------------------------- undo


def test_undo_restores_replaced_holder(api):
    client, sessions, _state = api
    ids = seed(sessions)
    body = allocate(client, ids, "second", confirm_cross_level=True).json()
    # The planner's undo does not handle superadmin batches; it refuses rather than half-undoing.
    planner = client.post(f"/api/v1/extra-duty/batches/{body['batch_id']}/undo", json={"dry_run": False})
    assert planner.status_code == 409
    dry = client.post(f"{BASE}/{body['batch_id']}/undo", json={"dry_run": True}).json()
    assert dry["conflicts"] == [] and dry["would_restore"] == 1
    response = client.post(f"{BASE}/{body['batch_id']}/undo", json={})
    assert response.status_code == 200, response.text
    assert response.json()["restored"] == 1 and response.json()["removed"] == 1
    with sessions() as db:
        assert db.get(DutyAssignment, UUID(body["assignment_id"])) is None
        assert db.get(DutyAssignment, ids["held"]).status == "assigned"
        record = db.scalar(select(ExtraDutyRecord).where(ExtraDutyRecord.batch_id == UUID(body["batch_id"])))
        assert record.status == "void" and record.void_reason == "undone"
        assert db.get(ExtraDutyBatch, UUID(body["batch_id"])).status == "undone"
        assert ledger_balance(db, [ids["second"]], date(2026, 6, 1))[ids["second"]]["count"] == 0
    again = client.post(f"{BASE}/{body['batch_id']}/undo", json={})
    assert again.status_code == 200 and again.json()["already_undone"] is True


def test_undo_conflict_when_allocation_changed(api):
    client, sessions, _state = api
    ids = seed(sessions)
    body = allocate(client, ids, "second", confirm_cross_level=True).json()
    with sessions() as db:
        db.get(DutyAssignment, UUID(body["assignment_id"])).status = "cancelled"
        db.commit()
    response = client.post(f"{BASE}/{body['batch_id']}/undo", json={})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "undo_conflict"
    with sessions() as db:
        assert db.get(DutyAssignment, ids["held"]).status == "cancelled"


def test_reallocating_current_holder_reuses_row_and_undo_reverts(api):
    client, sessions, _state = api
    ids = seed(sessions)
    body = allocate(client, ids, "holder").json()
    assert body["assignment_id"] == str(ids["held"])
    with sessions() as db:
        row = db.get(DutyAssignment, ids["held"])
        assert row.source == SUPERADMIN_SOURCE and row.status == "assigned"
        assert db.get(ExtraDutyRecord, ids["record"]).status == "void"
    assert client.post(f"{BASE}/{body['batch_id']}/undo", json={}).status_code == 200
    with sessions() as db:
        row = db.get(DutyAssignment, ids["held"])
        assert row.source == "extra_duty_layer" and row.status == "assigned"
