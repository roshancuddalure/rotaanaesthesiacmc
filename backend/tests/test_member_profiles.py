from datetime import timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import Person, PersonCallChange, PersonComment, PersonPosting, Unit, UserAccount
from app.services.member_import import preview_member_import, apply_member_import
from app.services.member_profiles import call_level_on, local_today, record_call_change
from app.services.members import merge_people
from app.services.rota_safety import member_call_level, member_contexts_for_day
from app.services.unit_management import unit_call_member_counts


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Person(id=UUID(int=1), canonical_name="Profile Doctor", call_level="1ST_CALL"))
        session.add(
            UserAccount(
                id=UUID(int=2),
                username="hod",
                display_name="Department HOD",
                role="hod",
                password_hash="test-only",
            )
        )
        session.add(
            UserAccount(
                id=UUID(int=3),
                username="admin",
                display_name="Department Admin",
                role="superadmin",
                password_hash="test-only",
            )
        )
        session.commit()
        yield session
    engine.dispose()


def test_dated_call_changes_sync_safety_and_unit_counts(db):
    person = db.get(Person, UUID(int=1))
    today = local_today()
    future = today + timedelta(days=30)
    record_call_change(db, person, "2ND_CALL", future, "Promotion approved", actor_id=UUID(int=2))
    db.commit()
    assert person.call_level == "1ST_CALL"
    assert call_level_on(person, today) == "1ST_CALL"
    assert call_level_on(person, future) == "2ND_CALL"
    unit = Unit(code="UNIT_I", name="Unit I")
    posting = PersonPosting(person=person, unit=unit, posting_type="1ST_CALL", starts_on=today)
    db.add(posting)
    db.commit()
    before = member_contexts_for_day([posting], today)
    after = member_contexts_for_day([posting], future)
    assert member_call_level(before[0]) == "1ST_CALL"
    assert member_call_level(after[0]) == "2ND_CALL"
    month = (future.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    counts = unit_call_member_counts([posting], month)
    assert counts[(unit.id, "2ND_CALL")] == 1
    with pytest.raises(ValueError, match="later call change"):
        record_call_change(db, person, "3RD_CALL", today, "Backdated competing change")
    db.rollback()


def test_existing_call_level_can_get_its_first_known_effective_date(db):
    person = db.get(Person, UUID(int=1))
    effective = local_today() - timedelta(days=100)
    record_call_change(db, person, "1ST_CALL", effective, "First-call appointment effective date confirmed by HOD", actor_id=UUID(int=2))
    db.commit()
    baseline = db.scalars(select(PersonCallChange)).one()
    assert baseline.effective_from == effective
    assert baseline.to_call_level == "1ST_CALL"
    with pytest.raises(ValueError, match="already effective"):
        record_call_change(db, person, "1ST_CALL", local_today(), "Duplicate level")
    db.rollback()


def test_hod_profiles_comments_promotions_and_board_privacy(db):
    factory = sessionmaker(bind=db.get_bind())

    def override_db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)
    person_id = str(UUID(int=1))
    profile_url = f"/api/v1/members/{person_id}"
    try:
        assert client.get(profile_url + "/profile").status_code == 401
        hod = db.get(UserAccount, UUID(int=2))
        app.dependency_overrides[current_user] = lambda: hod
        response = client.post(
            profile_url + "/comments", json={"body": "Approved for second call from next month."}
        )
        assert response.status_code == 200, response.text
        assert response.json()["comments"][0]["role"] == "hod"
        assert response.json()["comments"][0]["author"] == "Department HOD"
        promoted = client.post(
            profile_url + "/call-changes",
            json={
                "call_level": "2ND_CALL",
                "effective_from": local_today().isoformat(),
                "reason": "Training completed, HOD approved",
            },
        )
        assert promoted.status_code == 200, promoted.text
        assert promoted.json()["current_call_level"] == "2ND_CALL"
        assert promoted.json()["call_history"][0]["author"] == "Department HOD"
        assert client.get("/api/v1/admin/members/import/history").status_code == 403
        assert client.post(profile_url + "/comments", json={"body": "   "}).status_code == 422
        app.dependency_overrides[current_user] = lambda: UserAccount(role="rota_board_member")
        board = client.get(profile_url + "/profile")
        assert board.status_code == 200
        assert board.json()["comments"] == [] and board.json()["can_manage"] is False
        assert client.post(profile_url + "/comments", json={"body": "Blocked"}).status_code == 403
        assert (
            client.post(
                profile_url + "/call-changes",
                json={
                    "call_level": "3RD_CALL",
                    "effective_from": "2026-10-12",
                    "reason": "Blocked",
                },
            ).status_code
            == 403
        )
    finally:
        app.dependency_overrides.clear()


def test_member_upload_records_call_changes_and_invalidates_preview(db):
    person = db.get(Person, UUID(int=1))
    data = b"name,call_level\nProfile Doctor,2nd call\n"
    options = {"confirm_call_changes": True}
    preview = preview_member_import(db, "members.csv", data, options)
    apply_member_import(db, "members.csv", data, options, preview["preview_hash"], "admin")
    change = db.scalars(select(PersonCallChange)).one()
    assert change.from_call_level == "1ST_CALL" and change.to_call_level == "2ND_CALL"
    assert change.source == "member_excel_import"
    preview = preview_member_import(db, "members.csv", data, options)
    record_call_change(
        db, person, "3RD_CALL", local_today() + timedelta(days=40), "Scheduled training promotion"
    )
    db.commit()
    with pytest.raises(ValueError, match="changed"):
        apply_member_import(db, "members.csv", data, options, preview["preview_hash"], "admin")


def test_merge_keeps_comments_and_source_call_history_without_overriding_target(db):
    target = db.get(Person, UUID(int=1))
    source = Person(canonical_name="Profile Variant", call_level="3RD_CALL")
    db.add(source)
    db.flush()
    record_call_change(db, source, "4TH_CALL", local_today(), "Old record")
    db.add(
        PersonComment(
            person_id=source.id,
            author_id=UUID(int=2),
            author_name="HOD",
            author_role="hod",
            body="Source comment",
        )
    )
    db.commit()
    merge_people(db, target.id, [source.id])
    assert db.scalars(select(PersonComment)).one().person_id == target.id
    assert db.scalars(select(PersonCallChange)).one().source.startswith("merged:")
    assert call_level_on(target) == "1ST_CALL"


def test_cleanup_removes_invalid_member_profile_rows(db):
    from app.services.members import delete_invalid_members
    invalid = Person(canonical_name="DATE", call_level="1ST_CALL")
    db.add(invalid)
    db.flush()
    record_call_change(db, invalid, "2ND_CALL", local_today(), "Invalid source cleanup test")
    db.add(PersonComment(person_id=invalid.id, author_id=UUID(int=2), author_name="HOD", author_role="hod", body="Cleanup test"))
    db.commit()
    assert delete_invalid_members(db) == 1
    assert db.scalars(select(PersonCallChange)).all() == []
    assert db.scalars(select(PersonComment)).all() == []


def test_hod_role_can_be_created_and_authenticated(db):
    from app.services.auth import authenticate, hash_secret
    hod = db.get(UserAccount, UUID(int=2))
    hod.password_hash = hash_secret("hod-password")
    db.commit()
    user = authenticate(db, "hod", "hod-password")
    assert user.role == "hod"
