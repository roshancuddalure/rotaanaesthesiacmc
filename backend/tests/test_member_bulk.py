"""Archive-all (preview, typed confirmation, undo by batch) and reviewed suspected duplicates."""

from datetime import date, datetime, timedelta
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
from app.models import (DutyAssignment, DutySlot, LeaveRequest, MemberActivity, Person, PersonAlias,
                        PersonPosting, UserAccount)

BASE = "/api/v1/admin/members"
PHRASE = "ARCHIVE ALL MEMBERS"


@pytest.fixture
def env():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    user = UserAccount(id=uuid4(), username="admin", display_name="Bulk admin", role="computer_admin")

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


def add_person(sessions, name, status="active", **kw) -> UUID:
    with sessions() as db:
        person = Person(canonical_name=name, active_status=status,
                        archived_at=datetime.utcnow() if status == "archived" else None, **kw)
        db.add(person)
        db.commit()
        return person.id


def add_duty(sessions, person_id, day: date, label="primary"):
    with sessions() as db:
        start = datetime.combine(day, datetime.min.time())
        slot = DutySlot(duty_date=day, duty_type="MAIN_1ST_24HR", slot_label=label,
                        starts_at=start, ends_at=start + timedelta(hours=24))
        db.add(slot)
        db.flush()
        db.add(DutyAssignment(duty_slot_id=slot.id, person_id=person_id))
        db.commit()


def seed(sessions):
    """Two active members with history, one already archived member."""
    a = add_person(sessions, "Asha Kumar")
    b = add_person(sessions, "Bala Murugan")
    old = add_person(sessions, "Old Member", status="archived")
    add_duty(sessions, a, date.today() - timedelta(days=30), "a-past")
    add_duty(sessions, a, date.today() + timedelta(days=5), "a-future")
    add_duty(sessions, b, date.today() + timedelta(days=6), "b-future")
    add_duty(sessions, old, date.today() + timedelta(days=7), "old-future")
    with sessions() as db:
        db.add(LeaveRequest(person_id=a, leave_type="CASUAL", starts_on=date.today(), ends_on=date.today()))
        db.add(PersonPosting(person_id=b, posting_type="UNIT", starts_on=date.today()))
        db.add(PersonAlias(person_id=a, alias="Asha K"))
        db.commit()
    return a, b, old


def links(sessions):
    with sessions() as db:
        return (sorted((str(r.duty_slot_id), str(r.person_id)) for r in db.scalars(select(DutyAssignment))),
                sorted(str(r.person_id) for r in db.scalars(select(LeaveRequest))),
                sorted(str(r.person_id) for r in db.scalars(select(PersonPosting))),
                sorted((r.alias, str(r.person_id)) for r in db.scalars(select(PersonAlias))))


def statuses(sessions):
    with sessions() as db:
        return {p.canonical_name: p.active_status for p in db.scalars(select(Person))}


def archive(client):
    preview = client.get(f"{BASE}/archive-all/preview").json()
    return client.post(f"{BASE}/archive-all", json={"preview_token": preview["preview_token"],
                                                     "confirm_phrase": PHRASE})


# -- archive all -------------------------------------------------------------------------------

def test_preview_counts(env):
    client, sessions, _ = env
    seed(sessions)
    body = client.get(f"{BASE}/archive-all/preview").json()
    assert body["members"] == 2 and body["linked_duties"] == 3 and body["future_duties"] == 2
    assert body["leave"] == 1 and body["postings"] == 1
    assert body["confirm_phrase"] == PHRASE and body["preview_token"]


def test_non_admin_is_403_on_every_route(env):
    client, sessions, user = env
    a, b, _ = seed(sessions)
    user.role = "rota_board_member"
    assert client.get(f"{BASE}/archive-all/preview").status_code == 403
    assert client.post(f"{BASE}/archive-all", json={"preview_token": "x", "confirm_phrase": PHRASE}).status_code == 403
    assert client.post(f"{BASE}/archive-all/{uuid4()}/restore").status_code == 403
    assert client.get(f"{BASE}/archive-all/batches").status_code == 403
    assert client.get(f"{BASE}/suspected-duplicates").status_code == 403
    assert client.post(f"{BASE}/suspected-duplicates/dismiss",
                       json={"person_ids": [str(a), str(b)]}).status_code == 403
    assert client.get(f"{BASE}/dedupe-candidates").status_code == 403
    assert client.post(f"{BASE}/merge", json={"target_person_id": str(a),
                                              "source_person_ids": [str(b)]}).status_code == 403
    assert statuses(sessions)["Asha Kumar"] == "active"


def test_wrong_phrase_422_and_stale_token_409(env):
    client, sessions, _ = env
    seed(sessions)
    token = client.get(f"{BASE}/archive-all/preview").json()["preview_token"]
    wrong = client.post(f"{BASE}/archive-all", json={"preview_token": token, "confirm_phrase": "archive"})
    assert wrong.status_code == 422
    assert wrong.json()["detail"] == {"code": "confirm_phrase", "message": "Type ARCHIVE ALL MEMBERS to confirm"}
    assert client.post(f"{BASE}/archive-all", json={"preview_token": token}).status_code == 422
    missing = client.post(f"{BASE}/archive-all", json={"confirm_phrase": PHRASE})
    assert missing.status_code == 409 and missing.json()["detail"]["code"] == "stale_preview"
    add_person(sessions, "New Arrival")
    stale = client.post(f"{BASE}/archive-all", json={"preview_token": token, "confirm_phrase": PHRASE})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_preview"
    assert set(statuses(sessions).values()) == {"active", "archived"}
    assert statuses(sessions)["Asha Kumar"] == "active"


def test_archive_all_keeps_links_records_activity_and_restores_by_batch(env):
    client, sessions, _ = env
    a, b, old = seed(sessions)
    before_links = links(sessions)
    response = archive(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["archived"] == 2
    batch_id = body["batch_id"]
    assert set(statuses(sessions).values()) == {"archived"}
    assert links(sessions) == before_links
    with sessions() as db:
        rows = db.scalars(select(MemberActivity).where(MemberActivity.action == "member_archived_all")).all()
        assert {r.person_id for r in rows} == {a, b}
        assert all(r.details["batch_id"] == batch_id for r in rows)
        assert all(p.archived_at is not None for p in db.scalars(select(Person)))

    # One member is manually restored after the batch: restore skips it.
    assert client.post(f"{BASE}/{b}/restore").status_code == 200
    restored = client.post(f"{BASE}/archive-all/{batch_id}/restore")
    assert restored.status_code == 200
    assert restored.json() == {"batch_id": batch_id, "restored": 1, "skipped": 1}
    assert statuses(sessions) == {"Asha Kumar": "active", "Bala Murugan": "active", "Old Member": "archived"}
    with sessions() as db:
        assert db.get(Person, a).archived_at is None
        restore_rows = db.scalars(select(MemberActivity).where(MemberActivity.action == "member_restored_batch")).all()
        assert [(r.person_id, r.details["batch_id"]) for r in restore_rows] == [(a, batch_id)]
    assert links(sessions) == before_links

    again = client.post(f"{BASE}/archive-all/{batch_id}/restore").json()
    assert again["restored"] == 0
    assert client.post(f"{BASE}/archive-all/{uuid4()}/restore").status_code == 404

    batches = client.get(f"{BASE}/archive-all/batches").json()
    assert len(batches) == 1
    assert batches[0]["batch_id"] == batch_id and batches[0]["archived"] == 2 and batches[0]["restored"] == 1
    assert batches[0]["operator_name"] == "Bulk admin" and datetime.fromisoformat(batches[0]["at"])


def test_restore_returns_previous_status_and_batches_newest_first(env):
    client, sessions, _ = env
    add_person(sessions, "First Person")
    first = archive(client).json()["batch_id"]
    client.post(f"{BASE}/archive-all/{first}/restore")
    add_person(sessions, "Second Person")
    second = archive(client).json()
    assert second["archived"] == 2
    # Re-archived by the second batch: the first batch must not restore it again.
    assert client.post(f"{BASE}/archive-all/{first}/restore").json()["restored"] == 0
    batches = client.get(f"{BASE}/archive-all/batches").json()
    assert [b["batch_id"] for b in batches] == [second["batch_id"], first]


def test_archive_all_with_no_active_members(env):
    client, sessions, _ = env
    body = client.get(f"{BASE}/archive-all/preview").json()
    assert body["members"] == 0
    assert archive(client).json()["archived"] == 0


# -- suspected duplicates -----------------------------------------------------------------------

def test_suspected_duplicates_dismiss_and_merge(env):
    client, sessions, _ = env
    jasmin = add_person(sessions, "Jasmin J", status="historical")
    jasmine = add_person(sessions, "Jasmine J")
    add_duty(sessions, jasmin, date.today(), "j1")
    add_person(sessions, "Completely Different")
    pairs = client.get(f"{BASE}/suspected-duplicates")
    assert pairs.status_code == 200
    found = pairs.json()
    assert len(found) == 1
    pair = found[0]
    assert pair["pair_id"] == ":".join(sorted([str(jasmin), str(jasmine)]))
    assert pair["similarity"] >= 0.86 and pair["reason"]
    # Active is preferred over the member with more duties.
    assert pair["suggested_target_id"] == str(jasmine)
    people = {p["canonical_name"]: p for p in pair["people"]}
    assert people["Jasmin J"]["duties"] == 1 and people["Jasmin J"]["active_status"] == "historical"
    assert set(people["Jasmine J"]) == {"id", "canonical_name", "active_status", "call_level", "duties",
                                        "postings", "leave", "aliases"}

    dismissed = client.post(f"{BASE}/suspected-duplicates/dismiss",
                            json={"person_ids": [str(jasmine), str(jasmin)], "note": "Two residents"})
    assert dismissed.status_code == 200 and dismissed.json()["pair_id"] == pair["pair_id"]
    assert client.get(f"{BASE}/suspected-duplicates").json() == []
    # Dismissing again is harmless.
    assert client.post(f"{BASE}/suspected-duplicates/dismiss",
                       json={"person_ids": [str(jasmin), str(jasmine)]}).status_code == 200
    assert client.post(f"{BASE}/suspected-duplicates/dismiss",
                       json={"person_ids": [str(jasmin), str(uuid4())]}).status_code == 404


def test_merge_removes_pair_and_shared_key_or_alias_is_found(env):
    client, sessions, _ = env
    a = add_person(sessions, "Dr. Ravi Shankar")
    b = add_person(sessions, "Ravi Shankar")
    c = add_person(sessions, "Priya Nair")
    d = add_person(sessions, "P Nair Menon")
    with sessions() as db:
        db.add(PersonAlias(person_id=d, alias="Priya N."))
        db.commit()
    found = client.get(f"{BASE}/suspected-duplicates").json()
    ids = {frozenset(p["pair_id"].split(":")) for p in found}
    assert frozenset({str(a), str(b)}) in ids
    assert frozenset({str(c), str(d)}) in ids
    same = next(p for p in found if set(p["pair_id"].split(":")) == {str(a), str(b)})
    assert same["similarity"] == 1.0 and same["reason"] == "Same name"
    assert found[0]["similarity"] >= found[-1]["similarity"]

    merged = client.post(f"{BASE}/merge", json={"target_person_id": same["suggested_target_id"],
                                                "source_person_ids": [str(a if same["suggested_target_id"] == str(b) else b)]})
    assert merged.status_code == 200, merged.text
    with sessions() as db:
        assert db.scalars(select(MemberActivity).where(MemberActivity.action == "members_merged")).first()
    ids = {frozenset(p["pair_id"].split(":")) for p in client.get(f"{BASE}/suspected-duplicates").json()}
    assert frozenset({str(a), str(b)}) not in ids


def test_people_the_name_rules_tell_apart_are_not_offered_for_merge(env):
    # The alias rules say "Priyadarshini" means one of these two by call level, so they are
    # known to be different people even though their names are very similar.
    from app.models import MemberResolutionRule

    client, sessions, _ = env
    from app.models import PersonAlias

    first = add_person(sessions, "Priyadharshini S")
    second = add_person(sessions, "Priyadarshini Kalahasthi")
    pair = ":".join(sorted([str(first), str(second)]))
    with sessions() as db:
        # Saved short spellings make the two records look alike (as in the real roster).
        db.add_all([PersonAlias(person_id=first, alias="Priyadharshini", source="test"),
                    PersonAlias(person_id=second, alias="Priyadarshini", source="test")])
        db.commit()
    assert pair in {p["pair_id"] for p in client.get(f"{BASE}/suspected-duplicates").json()}
    with sessions() as db:
        for person_id, level in ((first, "1ST_CALL"), (second, "3RD_CALL")):
            db.add(MemberResolutionRule(form="Priyadarshini", form_key="priyadarshini", person_id=person_id,
                                        call_levels=[level], duty_areas=[], requires_context=False, priority=10,
                                        active=True, source="test", version=1))
        db.commit()
    assert pair not in {p["pair_id"] for p in client.get(f"{BASE}/suspected-duplicates").json()}
