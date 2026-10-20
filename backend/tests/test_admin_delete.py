"""Admin delete with recycle bin (docs/admin_delete_contract.md)."""

from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import (DeletedRecord, DutyAssignment, DutySlot, LeaveRequest, MemberActivity,
                        MemberCallLevelChange, MemberResolutionRule, Person, PersonAlias, PersonComment,
                        PersonDesignation, PersonPosting, RotaReviewDecision, RotaPeriod, Unit, UserAccount)
from app.services import recycle_bin

TODAY = date(2026, 10, 20)
BIN = "/api/v1/admin/recycle-bin"


@pytest.fixture
def env(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    user = UserAccount(id=uuid4(), username="admin", display_name="Bin admin", role="computer_admin",
                       password_hash="x")
    with sessions() as db:
        db.add(UserAccount(id=user.id, username="admin", display_name="Bin admin", role="computer_admin",
                           password_hash="x"))
        db.commit()
    monkeypatch.setattr(recycle_bin, "local_today", lambda: TODAY)

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: user
    try:
        yield TestClient(app), sessions, user
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def add(sessions, *objects):
    with sessions() as db:
        db.add_all(objects)
        db.commit()
        return [o.id for o in objects]


def person(sessions, name) -> UUID:
    return add(sessions, Person(canonical_name=name))[0]


def duty(sessions, person_id, day, source="past_duty_upload", label="primary", slot_id=None):
    with sessions() as db:
        if slot_id is None:
            start = datetime.combine(day, datetime.min.time())
            slot = DutySlot(duty_date=day, duty_type="MAIN_1ST_24HR", slot_label=label, source=source,
                            starts_at=start, ends_at=start + timedelta(hours=24))
            db.add(slot)
            db.flush()
            slot_id = slot.id
        assignment = DutyAssignment(duty_slot_id=slot_id, person_id=person_id, source=source)
        db.add(assignment)
        db.commit()
        return assignment.id, slot_id


def preview(client, kind, ids=None, month=None):
    body = {"kind": kind}
    if month:
        body["month"] = month
    else:
        body["ids"] = [str(i) for i in ids]
    response = client.post("/api/v1/admin/delete/preview", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def do_delete(client, kind, ids=None, month=None):
    data = preview(client, kind, ids, month)
    body = {"kind": kind, "preview_token": data["preview_token"]}
    if month:
        body["month"] = month
        body["confirm_phrase"] = data["confirm_phrase"]
    else:
        body["ids"] = [str(i) for i in ids]
    response = client.post("/api/v1/admin/delete", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def restore(client, batch_id):
    return client.post(f"{BIN}/{batch_id}/restore", json={})


def count(sessions, model):
    with sessions() as db:
        return db.scalar(select(func.count()).select_from(model))


# -- access ---------------------------------------------------------------------------------------

def test_non_admin_is_403_on_every_route(env):
    client, _, user = env
    user.role = "viewer"
    batch = uuid4()
    assert client.post("/api/v1/admin/delete/preview", json={"kind": "leave", "ids": []}).status_code == 403
    assert client.post("/api/v1/admin/delete", json={"kind": "leave", "ids": [], "preview_token": "x"}).status_code == 403
    assert client.get(BIN).status_code == 403
    assert client.post(f"{BIN}/{batch}/restore", json={}).status_code == 403
    assert client.request("DELETE", f"{BIN}/{batch}", json={"confirm": True}).status_code == 403
    assert client.get("/api/v1/admin/past-duties/recorded?month=2026-10").status_code == 403


def test_selection_validation(env):
    client, sessions, _ = env
    bad = [{"kind": "leave"}, {"kind": "leave", "ids": [], "month": "2026-10"},
           {"kind": "member", "month": "2026-10"}, {"kind": "leave", "month": "2026-13"}]
    for body in bad:
        response = client.post("/api/v1/admin/delete/preview", json=body)
        assert response.status_code == 422, body
    assert client.post("/api/v1/admin/delete/preview", json={"kind": "nope", "ids": []}).status_code == 422


# -- members --------------------------------------------------------------------------------------

def test_member_with_links_is_blocked_and_not_deleted(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    duty(sessions, asha, TODAY - timedelta(days=3))
    add(sessions, LeaveRequest(person_id=asha, leave_type="ANNUAL", starts_on=TODAY, ends_on=TODAY))
    data = preview(client, "member", [asha])
    assert data["count"] == 0
    assert data["blocked"][0]["label"] == "Asha AJ"
    assert "1 duty and 1 leave record" in data["blocked"][0]["reason"]
    response = client.post("/api/v1/admin/delete", json={"kind": "member", "ids": [str(asha)],
                                                         "preview_token": data["preview_token"]})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "nothing_to_delete"
    assert count(sessions, Person) == 1


def test_member_delete_and_restore_intact(env):
    client, sessions, user = env
    bala = person(sessions, "Bala M")
    other = person(sessions, "Other Person")
    add(sessions, PersonAlias(person_id=bala, alias="Bala"),
        PersonDesignation(person_id=bala, designation="SR", effective_from=TODAY),
        MemberCallLevelChange(person_id=bala, call_level="3RD_CALL", effective_from=TODAY),
        PersonComment(person_id=bala, author_id=user.id, author_name="Bin admin", author_role="admin", body="note"),
        MemberResolutionRule(form="Bala", form_key="bala", person_id=bala),
        MemberActivity(person_id=bala, operator_name="x", action="edited", details={}))
    data = preview(client, "member", [bala, uuid4()])
    assert data["count"] == 1 and data["items"] == [{"id": str(bala), "label": "Bala M"}]
    assert data["effects"]["linked_records"] == 6
    assert data["confirm_phrase"] is None
    assert data["blocked"][0]["reason"].startswith("Not found")

    result = do_delete(client, "member", [bala])
    assert result["deleted"] == 1
    with sessions() as db:
        assert db.get(Person, bala) is None
        assert db.get(Person, other) is not None
        assert db.scalar(select(func.count()).select_from(PersonAlias)) == 0
        assert db.scalar(select(func.count()).select_from(MemberResolutionRule)) == 0
        activity = db.scalars(select(MemberActivity).where(MemberActivity.person_id == bala)).all()
        assert [a.action for a in activity] == ["member_deleted"]

    entries = client.get(BIN).json()
    assert entries[0]["batch_id"] == result["batch_id"] and entries[0]["kind"] == "member"
    assert entries[0]["labels"] == ["Bala M"] and entries[0]["deleted_by"] == "Bin admin"
    assert entries[0]["restored_at"] is None

    restored = restore(client, result["batch_id"]).json()
    assert restored == {"restored": 1, "failed": []}
    with sessions() as db:
        back = db.get(Person, bala)
        assert back.canonical_name == "Bala M"
        assert [a.alias for a in back.aliases] == ["Bala"]
        assert len(back.designations) == 1 and len(back.call_level_changes) == 1
        assert db.scalar(select(func.count()).select_from(PersonComment)) == 1
        assert db.scalars(select(MemberResolutionRule)).one().person_id == bala
        actions = sorted(a.action for a in db.scalars(select(MemberActivity).where(MemberActivity.person_id == bala)))
        assert actions == ["edited", "member_deleted", "member_restored"]
    again = restore(client, result["batch_id"])
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_restored"
    assert client.get(BIN).json()[0]["restored_by"] == "Bin admin"


def test_member_restore_conflict_reported(env):
    client, sessions, _ = env
    bala = person(sessions, "Bala M")
    result = do_delete(client, "member", [bala])
    person(sessions, "Bala M")  # someone recreated the member meanwhile
    restored = restore(client, result["batch_id"]).json()
    assert restored["restored"] == 0
    assert restored["failed"] == [{"label": "Bala M", "reason": "A member named Bala M now exists"}]
    with sessions() as db:
        assert db.get(Person, bala) is None


# -- leave ----------------------------------------------------------------------------------------

def seed_leave(sessions):
    asha = person(sessions, "Asha AJ")
    ids = add(sessions,
              LeaveRequest(person_id=asha, leave_type="ANNUAL", starts_on=date(2026, 10, 3), ends_on=date(2026, 10, 4)),
              LeaveRequest(person_id=asha, leave_type="CASUAL", starts_on=date(2026, 10, 9), ends_on=date(2026, 10, 9)),
              LeaveRequest(person_id=asha, leave_type="ANNUAL", starts_on=date(2026, 11, 1), ends_on=date(2026, 11, 2)))
    return asha, ids


def test_leave_preview_delete_by_ids_and_restore(env):
    client, sessions, _ = env
    asha, ids = seed_leave(sessions)
    data = preview(client, "leave", [ids[0]])
    assert data["items"][0]["label"] == "Asha AJ · Annual leave · 3–4 Oct 2026"
    result = do_delete(client, "leave", [ids[0]])
    assert result["deleted"] == 1 and count(sessions, LeaveRequest) == 2
    assert restore(client, result["batch_id"]).json() == {"restored": 1, "failed": []}
    with sessions() as db:
        leave = db.get(LeaveRequest, ids[0])
        assert leave.starts_on == date(2026, 10, 3) and leave.person_id == asha


def test_leave_month_delete_needs_phrase(env):
    client, sessions, _ = env
    _, ids = seed_leave(sessions)
    data = preview(client, "leave", month="2026-10")
    assert data["count"] == 2 and data["confirm_phrase"] == "DELETE LEAVE 2026-10"
    body = {"kind": "leave", "month": "2026-10", "preview_token": data["preview_token"]}
    for phrase in (None, "delete leave 2026-10"):
        response = client.post("/api/v1/admin/delete", json={**body, "confirm_phrase": phrase})
        assert response.status_code == 422 and response.json()["detail"]["code"] == "confirm_phrase"
    assert count(sessions, LeaveRequest) == 3
    response = client.post("/api/v1/admin/delete", json={**body, "confirm_phrase": "DELETE LEAVE 2026-10"})
    assert response.status_code == 200 and response.json()["deleted"] == 2
    assert count(sessions, LeaveRequest) == 1


def test_stale_token_is_409(env):
    client, sessions, _ = env
    asha, ids = seed_leave(sessions)
    data = preview(client, "leave", month="2026-10")
    add(sessions, LeaveRequest(person_id=asha, leave_type="SICK", starts_on=date(2026, 10, 20), ends_on=date(2026, 10, 20)))
    response = client.post("/api/v1/admin/delete", json={
        "kind": "leave", "month": "2026-10", "preview_token": data["preview_token"],
        "confirm_phrase": data["confirm_phrase"]})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "stale_preview"
    assert count(sessions, LeaveRequest) == 4
    response = client.post("/api/v1/admin/delete", json={"kind": "leave", "ids": [str(ids[0])], "preview_token": "bad"})
    assert response.status_code == 409


def test_leave_restore_fails_when_member_gone_or_duplicate(env):
    client, sessions, _ = env
    asha, ids = seed_leave(sessions)
    first = do_delete(client, "leave", [ids[0]])
    second = do_delete(client, "leave", [ids[1]])
    # An identical leave was recorded again after the delete.
    add(sessions, LeaveRequest(person_id=asha, leave_type="ANNUAL", starts_on=date(2026, 10, 3), ends_on=date(2026, 10, 4)))
    result = restore(client, first["batch_id"]).json()
    assert result == {"restored": 0, "failed": [{"label": "Asha AJ · Annual leave · 3–4 Oct 2026",
                                                 "reason": "An identical leave record now exists"}]}
    # The member is gone (simulated merge): the second leave cannot come back.
    with sessions() as db:
        db.query(LeaveRequest).delete()
        db.query(Person).delete()
        db.commit()
    result = restore(client, second["batch_id"]).json()
    assert result["restored"] == 0 and result["failed"][0]["reason"] == "Its member was deleted or merged"
    # Failed items stay in the bin and can be retried.
    assert restore(client, second["batch_id"]).status_code == 200


# -- postings -------------------------------------------------------------------------------------

def test_posting_month_delete_and_restore(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    unit = add(sessions, Unit(code="MAIN", name="Main OT"))[0]
    ids = add(sessions,
              PersonPosting(person_id=asha, unit_id=unit, posting_type="3RD_CALL", starts_on=date(2026, 10, 1),
                            ends_on=date(2026, 10, 31), source="unit_board"),
              PersonPosting(person_id=asha, posting_type="PAIN", starts_on=date(2026, 11, 1)))
    data = preview(client, "posting", month="2026-10")
    assert data["count"] == 1 and data["confirm_phrase"] == "DELETE POSTINGS 2026-10"
    assert data["items"][0]["label"] == "Asha AJ · Main OT (3RD_CALL) · 1–31 Oct 2026"
    result = do_delete(client, "posting", month="2026-10")
    assert result["deleted"] == 1 and count(sessions, PersonPosting) == 1
    assert restore(client, result["batch_id"]).json()["restored"] == 1
    with sessions() as db:
        assert db.get(PersonPosting, ids[0]).unit_id == unit


def test_unit_board_delete_goes_to_bin(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    posting = add(sessions, PersonPosting(person_id=asha, posting_type="PAIN", starts_on=date(2026, 10, 1),
                                          ends_on=date(2026, 10, 31), source="unit_board"))[0]
    response = client.delete(f"/api/v1/unit-management/assignments/{posting}")
    assert response.status_code == 200 and response.json() == {"status": "deleted"}
    assert count(sessions, PersonPosting) == 0
    entries = client.get(BIN).json()
    assert len(entries) == 1 and entries[0]["kind"] == "posting"
    assert restore(client, entries[0]["batch_id"]).json()["restored"] == 1
    assert count(sessions, PersonPosting) == 1


# -- past duties ----------------------------------------------------------------------------------

def test_past_duty_refuses_today_and_future(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    today_id, _ = duty(sessions, asha, TODAY)
    future_id, _ = duty(sessions, asha, TODAY + timedelta(days=2))
    data = preview(client, "past_duty", [today_id, future_id])
    assert data["count"] == 0
    assert {b["reason"] for b in data["blocked"]} == {"Not a past duty (dated today or later)"}
    month = preview(client, "past_duty", month="2026-10")
    assert month["count"] == 0 and month["confirm_phrase"] == "DELETE PAST DUTIES 2026-10"


def test_past_duty_removes_empty_upload_slot_and_restores(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    bala = person(sessions, "Bala M")
    day = TODAY - timedelta(days=5)
    a1, upload_slot = duty(sessions, asha, day, label="up")
    a2, _ = duty(sessions, bala, day, slot_id=upload_slot)
    a3, template_slot = duty(sessions, asha, day - timedelta(days=1), source="phase4_template", label="tpl")
    with sessions() as db:
        period = RotaPeriod(name="Oct", starts_on=date(2026, 10, 1), ends_on=date(2026, 10, 31))
        db.add(period)
        db.flush()
        db.add(RotaReviewDecision(rota_period_id=period.id, duty_slot_id=upload_slot, issue_code="X", note="ok"))
        db.commit()

    data = preview(client, "past_duty", [a1, a2, a3])
    assert data["count"] == 3 and data["effects"] == {"extra_slots": 1}
    assert data["items"][0]["label"].endswith("· 15 Oct 2026") or data["items"][0]["label"].endswith("14 Oct 2026")
    result = do_delete(client, "past_duty", [a1, a2, a3])
    assert result["deleted"] == 3
    with sessions() as db:
        assert db.get(DutySlot, upload_slot) is None
        assert db.get(DutySlot, template_slot) is not None  # live template slot stays
        assert db.scalar(select(func.count()).select_from(DutyAssignment)) == 0
        assert db.scalar(select(func.count()).select_from(RotaReviewDecision)) == 0
    assert restore(client, result["batch_id"]).json() == {"restored": 3, "failed": []}
    with sessions() as db:
        assert db.get(DutySlot, upload_slot) is not None
        assert {a.id for a in db.scalars(select(DutyAssignment))} == {a1, a2, a3}
        assert db.scalar(select(func.count()).select_from(RotaReviewDecision)) == 1


def test_past_duty_partial_slot_kept_and_slot_gone_reported(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    bala = person(sessions, "Bala M")
    day = TODAY - timedelta(days=2)
    a1, slot = duty(sessions, asha, day)
    duty(sessions, bala, day, slot_id=slot)
    data = preview(client, "past_duty", [a1])
    assert data["effects"] == {"extra_slots": 0}
    result = do_delete(client, "past_duty", [a1])
    with sessions() as db:
        assert db.get(DutySlot, slot) is not None
        db.query(DutyAssignment).delete()
        db.query(DutySlot).delete()
        db.commit()
    restored = restore(client, result["batch_id"]).json()
    assert restored["failed"][0]["reason"] == "Its duty slot is gone"


def test_past_duty_month_delete(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    duty(sessions, asha, date(2026, 10, 1), label="a")
    duty(sessions, asha, date(2026, 10, 2), label="b")
    duty(sessions, asha, TODAY, label="c")
    duty(sessions, asha, date(2026, 9, 30), label="d")
    result = do_delete(client, "past_duty", month="2026-10")
    assert result["deleted"] == 2
    assert count(sessions, DutyAssignment) == 2


def test_recorded_past_duties(env):
    client, sessions, _ = env
    asha = person(sessions, "Asha AJ")
    a1, _ = duty(sessions, asha, date(2026, 10, 2), label="a")
    duty(sessions, asha, date(2026, 10, 1), label="b")
    duty(sessions, asha, TODAY, label="c")
    response = client.get("/api/v1/admin/past-duties/recorded?month=2026-10")
    assert response.status_code == 200
    data = response.json()
    assert data["truncated"] is False
    assert [i["date"] for i in data["items"]] == ["2026-10-01", "2026-10-02"]
    item = data["items"][1]
    assert item["id"] == str(a1) and item["member_name"] == "Asha AJ" and item["duty_type"] == "MAIN_1ST_24HR"
    assert item["source"] == "past_duty_upload" and item["status"] == "assigned" and item["duty_label"]
    assert client.get("/api/v1/admin/past-duties/recorded?month=2026-12").json()["items"] == []
    assert client.get("/api/v1/admin/past-duties/recorded?month=oct").status_code == 422


# -- bin housekeeping -----------------------------------------------------------------------------

def test_purge_now_and_unknown_batch(env):
    client, sessions, _ = env
    _, ids = seed_leave(sessions)
    result = do_delete(client, "leave", ids[:2])
    batch = result["batch_id"]
    assert client.request("DELETE", f"{BIN}/{batch}", json={"confirm": False}).status_code == 422
    response = client.request("DELETE", f"{BIN}/{batch}", json={"confirm": True})
    assert response.status_code == 200 and response.json() == {"purged": 2}
    assert count(sessions, DeletedRecord) == 0
    assert client.request("DELETE", f"{BIN}/{batch}", json={"confirm": True}).status_code == 404
    assert restore(client, batch).status_code == 404


def test_entries_purged_after_30_days_on_list(env, monkeypatch):
    client, sessions, _ = env
    _, ids = seed_leave(sessions)
    do_delete(client, "leave", [ids[0]])
    assert len(client.get(BIN).json()) == 1
    later = datetime.utcnow() + timedelta(days=29)
    monkeypatch.setattr(recycle_bin, "utcnow", lambda: later)
    assert len(client.get(BIN).json()) == 1
    later = datetime.utcnow() + timedelta(days=31)
    monkeypatch.setattr(recycle_bin, "utcnow", lambda: later)
    assert client.get(BIN).json() == []
    assert count(sessions, DeletedRecord) == 0
