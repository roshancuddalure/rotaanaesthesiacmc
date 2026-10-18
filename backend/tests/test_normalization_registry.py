"""Shared identity and unit lifecycle acceptance checks."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import Person, Unit, UserAccount
from app.services.normalization import member_key, resolve_member, unit_key


@pytest.fixture
def registry():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    operator = UserAccount(
        id=uuid4(), username="registry", display_name="Registry Operator", role="computer_admin"
    )

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[current_user] = lambda: operator
    try:
        yield TestClient(app), sessions, operator
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_identity_keys_preserve_unicode_and_titles_only_at_boundary():
    from app.services.imports import clean_person_name, is_valid_person_name

    assert clean_person_name("Drew Smith") == "Drew Smith"
    assert clean_person_name("Mridula Kumar") == "Mridula Kumar"
    assert is_valid_person_name("ரவி")
    assert member_key(" Dr.  Asha A. J. ") == member_key("Asha AJ")
    assert member_key("Drew") == "drew"
    assert member_key("ரவி") != ""
    assert member_key("Renée") != member_key("Renee")
    assert unit_key("Unit IV") == unit_key("U4") == unit_key("Unit 04")
    assert unit_key("Main Unit IV") != unit_key("Ranipet Unit 4")


def test_similar_names_are_candidates_not_automatic_matches(registry):
    _, sessions, _ = registry
    with sessions() as db:
        db.add(Person(canonical_name="Doctor Example"))
        db.commit()
        result = resolve_member(db, "Doctor Exampl")
        assert result["person_id"] is None
        assert result["candidates"]


def test_alias_collision_is_ambiguous(registry):
    _, sessions, _ = registry
    with sessions() as db:
        a = Person(canonical_name="Asha A J")
        b = Person(canonical_name="Asha AJ")
        db.add_all([a, b])
        db.commit()
        result = resolve_member(db, "Dr. Asha AJ")
        assert result["state"] == "ambiguous"
        assert len(result["candidates"]) == 2


def test_unit_create_alias_rename_archive_restore_and_stale_edit(registry):
    client, sessions, _ = registry
    payload = {
        "name": "Unit IV",
        "campus": "Main",
        "aliases": ["Main U4"],
        "minimum_free_people": 1,
    }
    response = client.post("/api/v1/normalization/units", json=payload)
    assert response.status_code == 200, response.text
    unit = response.json()
    assert unit["code"] == "MAIN_UNIT_4"
    duplicate = client.post("/api/v1/normalization/units", json={**payload, "name": "Unit 4"})
    assert duplicate.status_code == 409
    updated = client.put(
        f"/api/v1/normalization/units/{unit['id']}",
        json={**unit, "name": "General Unit IV", "active_status": "archived"},
    )
    assert updated.status_code == 200, updated.text
    assert "Main Unit IV" in updated.json()["aliases"]
    assert client.put(f"/api/v1/normalization/units/{unit['id']}", json=unit).status_code == 409
    restored = client.put(
        f"/api/v1/normalization/units/{unit['id']}",
        json={**updated.json(), "active_status": "active"},
    )
    assert restored.status_code == 200
    with sessions() as db:
        assert len(list(db.scalars(select(Unit)))) == 1


def test_unit_creation_requires_admin(registry):
    client, _, user = registry
    user.role = "rota_board_member"
    assert client.get("/api/v1/normalization/units").status_code == 200
    assert client.post("/api/v1/normalization/units", json={"name": "Forbidden"}).status_code == 403


def test_same_number_across_campuses_stays_ambiguous_and_aliases_have_one_owner(registry):
    client, sessions, _ = registry
    main = client.post(
        "/api/v1/normalization/units",
        json={"name": "Unit IV", "campus": "Main", "aliases": ["Main U4"]},
    )
    other = client.post("/api/v1/normalization/units", json={"name": "Unit 4", "campus": "Ranipet"})
    assert main.status_code == other.status_code == 200
    from app.services.operational_import import resolve_unit

    with sessions() as db:
        assert resolve_unit(db, "Unit 4")["state"] == "ambiguous"
        assert resolve_unit(db, "Main U04")["unit_id"] == main.json()["id"]
    assert (
        client.put(
            f"/api/v1/normalization/units/{other.json()['id']}",
            json={**other.json(), "aliases": ["Main U4"]},
        ).status_code
        == 409
    )
