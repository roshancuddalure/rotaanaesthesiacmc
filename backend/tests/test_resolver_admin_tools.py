"""Admin member tools go through preview + confirm (docs/member_resolution_audit.md, paths 7-9, 12)."""

from functools import partial
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1 import members as members_api
from app.api.v1.auth import current_user, require_admin
from app.db.session import Base, get_db
from app.main import app
from app.models import Person, PersonAlias, UserAccount
from app.services import roster_reconciliation, unitwise_call_levels
from app.services.members import AliasOwnedError, ensure_person_alias, merge_people


@pytest.fixture
def env():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    def override_get_db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: None
    app.dependency_overrides[require_admin] = lambda: UserAccount(
        id=uuid4(), username="test", display_name="Test admin", role="computer_admin")
    try:
        yield TestClient(app), factory
    finally:
        app.dependency_overrides.clear()


def add(factory, *people: Person) -> None:
    with factory() as session:
        session.add_all(people)
        session.commit()


def names(factory) -> list[str]:
    with factory() as session:
        return sorted(session.scalars(select(Person.canonical_name)))


def levels(factory) -> dict[str, str | None]:
    with factory() as session:
        return {p.canonical_name: p.call_level for p in session.scalars(select(Person))}


# -- prefill call levels -------------------------------------------------------------------

def test_prefill_route_preview_changes_nothing_and_stale_token_is_409(env, tmp_path: Path, monkeypatch) -> None:
    client, factory = env
    workbook = Workbook()
    workbook.active.append(["4th calls", "Amit Mathew", "Bernice"])
    path = tmp_path / "unitwise.xlsx"
    workbook.save(path)
    monkeypatch.setattr(members_api, "preview_call_level_prefill",
                        partial(unitwise_call_levels.preview_call_level_prefill, path=path))
    monkeypatch.setattr(members_api, "prefill_call_levels_from_unitwise",
                        partial(unitwise_call_levels.prefill_call_levels_from_unitwise, path=path))
    add(factory, Person(canonical_name="Amit Mathew"), Person(canonical_name="Bernice Theodore Y"))

    preview = client.post("/api/v1/admin/members/prefill-call-levels", json={})
    assert preview.status_code == 200
    body = preview.json()
    assert body["mode"] == "preview" and body["changes"] == 1 and body["needs_review"] == 1
    review = next(r for r in body["rows"] if r["raw_name"] == "Bernice")
    assert review["candidates"][0]["name"] == "Bernice Theodore Y"
    assert levels(factory) == {"Amit Mathew": None, "Bernice Theodore Y": None}

    missing = client.post("/api/v1/admin/members/prefill-call-levels", json={"confirm": True})
    assert missing.status_code == 422

    # Data changes after the preview: the old token no longer applies.
    add(factory, Person(canonical_name="Amit Mathew K"))
    with factory() as session:
        session.add(PersonAlias(person=session.scalars(select(Person).where(
            Person.canonical_name == "Bernice Theodore Y")).one(), alias="Bernice", source="manual"))
        session.commit()
    stale = client.post("/api/v1/admin/members/prefill-call-levels",
                        json={"confirm": True, "preview_token": body["preview_token"]})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_preview"
    assert levels(factory)["Amit Mathew"] is None

    fresh = client.post("/api/v1/admin/members/prefill-call-levels", json={}).json()
    applied = client.post("/api/v1/admin/members/prefill-call-levels",
                          json={"confirm": True, "preview_token": fresh["preview_token"]})
    assert applied.status_code == 200 and applied.json()["mode"] == "applied"
    assert levels(factory) == {"Amit Mathew": "4TH_CALL", "Bernice Theodore Y": "4TH_CALL", "Amit Mathew K": None}


def test_prefill_route_missing_workbook_is_not_a_500(env, tmp_path: Path, monkeypatch) -> None:
    client, _ = env
    monkeypatch.setattr(members_api, "preview_call_level_prefill",
                        partial(unitwise_call_levels.preview_call_level_prefill, path=tmp_path / "none.xlsx"))
    response = client.post("/api/v1/admin/members/prefill-call-levels", json={})
    assert response.status_code == 404
    assert "workbook" in response.json()["detail"]


# -- roster reconciliation -----------------------------------------------------------------

def test_reconcile_route_never_merges_fuzzy_matches(env, tmp_path: Path, monkeypatch) -> None:
    client, factory = env
    workbook = Workbook()
    workbook.active.title = "OVERALL MARCH 26"
    workbook.active.append(["Dr. Vinobarathi E", "Dr. Antrofelix M"])
    path = tmp_path / "roster.xlsx"
    workbook.save(path)
    monkeypatch.setattr(members_api, "preview_roster_reconciliation",
                        partial(roster_reconciliation.preview_roster_reconciliation, path=path))
    monkeypatch.setattr(members_api, "reconcile_department_roster",
                        partial(roster_reconciliation.reconcile_department_roster, path=path))
    add(factory, Person(canonical_name="Vinobharathi E"), Person(canonical_name="Antrofelix"),
        Person(canonical_name="ANTROFELIX M"))

    body = client.post("/api/v1/admin/members/reconcile-trusted-roster", json={}).json()
    rows = {row["roster_name"]: row for row in body["rows"]}
    assert body["mode"] == "preview"
    assert rows["Vinobarathi E"]["status"] == "needs_review"
    assert rows["Vinobarathi E"]["candidates"][0]["name"] == "Vinobharathi E"
    assert rows["Antrofelix M"]["action"] == "rename"
    assert names(factory) == ["ANTROFELIX M", "Antrofelix", "Vinobharathi E"]

    stale = client.post("/api/v1/admin/members/reconcile-trusted-roster",
                        json={"confirm": True, "preview_token": "x" * 32})
    assert stale.status_code == 409

    applied = client.post("/api/v1/admin/members/reconcile-trusted-roster",
                          json={"confirm": True, "preview_token": body["preview_token"]})
    assert applied.status_code == 200
    assert applied.json()["merged_people"] == 0 and applied.json()["created_people"] == 0
    assert names(factory) == ["Antrofelix", "Antrofelix M", "Vinobharathi E"]


# -- auto-merge ----------------------------------------------------------------------------

def test_auto_merge_route_preview_confirm_and_alias_groups_untouched(env) -> None:
    client, factory = env
    sam = Person(canonical_name="Sujil Ebenezar Sam")
    sam.aliases.append(PersonAlias(alias="Sam", source="historical_analysis_variant"))
    other = Person(canonical_name="Samcharles D")
    other.aliases.append(PersonAlias(alias="SAM", source="manual"))
    add(factory, sam, other, Person(canonical_name="Divya AJ"), Person(canonical_name="DIVYA A J"))

    preview = client.post("/api/v1/admin/members/auto-merge-duplicates", json={}).json()
    assert preview["mode"] == "preview" and preview["merged_people"] == 1
    assert len(preview["groups"]) == 1 and len(preview["needs_review"]) == 1
    assert len(names(factory)) == 4

    assert client.post("/api/v1/admin/members/auto-merge-duplicates",
                       json={"confirm": True, "preview_token": "stale"}).status_code == 409
    applied = client.post("/api/v1/admin/members/auto-merge-duplicates",
                          json={"confirm": True, "preview_token": preview["preview_token"]})
    assert applied.status_code == 200 and applied.json()["merged_people"] == 1
    remaining = names(factory)
    assert {"Sujil Ebenezar Sam", "Samcharles D"} <= set(remaining) and len(remaining) == 3


# -- invalid-name cleanup ------------------------------------------------------------------

def test_cleanup_route_previews_collisions_and_applies_with_token(env) -> None:
    client, factory = env
    add(factory, Person(canonical_name="Kiruthiga - Till sept 27"), Person(canonical_name="Kiruthiga"),
        Person(canonical_name="Anand Raj - Till oct 12"), Person(canonical_name="DATE"))

    preview = client.post("/api/v1/admin/members/cleanup-invalid", json={}).json()
    assert preview["mode"] == "preview"
    assert [r["cleaned_name"] for r in preview["renames"]] == ["Anand Raj"]
    assert preview["collisions"][0]["colliding_with"][0]["name"] == "Kiruthiga"
    assert [p["name"] for p in preview["to_delete"]] == ["DATE"]
    assert len(names(factory)) == 4

    assert client.post("/api/v1/admin/members/cleanup-invalid", json={"confirm": True}).status_code == 422
    applied = client.post("/api/v1/admin/members/cleanup-invalid",
                          json={"confirm": True, "preview_token": preview["preview_token"]})
    assert applied.status_code == 200
    assert names(factory) == ["Anand Raj", "Kiruthiga", "Kiruthiga - Till sept 27"]


# -- aliases -------------------------------------------------------------------------------

def test_alias_owned_by_another_member_is_not_silently_moved(env) -> None:
    _, factory = env
    with factory() as session:
        owner = Person(canonical_name="Sujil Ebenezar Sam")
        owner.aliases.append(PersonAlias(alias="Sam", source="manual"))
        other = Person(canonical_name="Samcharles D")
        session.add_all([owner, other])
        session.commit()

        with pytest.raises(AliasOwnedError, match='"Sam" already belongs to Sujil Ebenezar Sam'):
            ensure_person_alias(session, other, "Sam")
        session.rollback()
        alias = session.scalars(select(PersonAlias)).one()
        assert alias.person.canonical_name == "Sujil Ebenezar Sam"

        ensure_person_alias(session, other, "Sam", reassign=True)
        session.commit()
        assert session.scalars(select(PersonAlias)).one().person.canonical_name == "Samcharles D"


def test_merge_still_moves_the_sources_aliases(env) -> None:
    _, factory = env
    with factory() as session:
        target = Person(canonical_name="Vinobharathi E")
        source = Person(canonical_name="Vinobarathi")
        source.aliases.append(PersonAlias(alias="Vino", source="manual"))
        session.add_all([target, source])
        session.commit()
        merge_people(session, target.id, [source.id])
        aliases = {a.alias: a.person.canonical_name for a in session.scalars(select(PersonAlias))}
        assert aliases == {"Vino": "Vinobharathi E", "Vinobarathi": "Vinobharathi E"}


# -- create --------------------------------------------------------------------------------

def test_create_near_duplicate_needs_confirm_distinct(env) -> None:
    client, factory = env
    add(factory, Person(canonical_name="Vinobharathi E", active_status="historical"))

    blocked = client.post("/api/v1/admin/members", json={"canonical_name": "Vinobarathi E"})
    assert blocked.status_code == 409
    detail = blocked.json()["detail"]
    assert detail["code"] == "near_duplicate"
    assert "Vinobarathi E" in detail["message"] and "Vinobharathi E (historical)" in detail["message"]
    assert detail["existing"][0]["name"] == "Vinobharathi E"
    assert names(factory) == ["Vinobharathi E"]

    created = client.post("/api/v1/admin/members",
                          json={"canonical_name": "Vinobarathi E", "confirm_distinct": True})
    assert created.status_code == 200
    assert names(factory) == ["Vinobarathi E", "Vinobharathi E"]

    unrelated = client.post("/api/v1/admin/members", json={"canonical_name": "Ramamani M"})
    assert unrelated.status_code == 200
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Person)) == 3


def test_alias_route_still_blocks_alias_owned_by_another(env) -> None:
    client, factory = env
    owner = Person(canonical_name="Sujil Ebenezar Sam")
    owner.aliases.append(PersonAlias(alias="Sam", source="manual"))
    other = Person(canonical_name="Samcharles D")
    add(factory, owner, other)
    with factory() as session:
        other_id = session.scalars(select(Person.id).where(Person.canonical_name == "Samcharles D")).one()
    response = client.post(f"/api/v1/admin/members/{other_id}/aliases", json={"alias": "Sam"})
    assert response.status_code == 409
    assert "Sam" in response.json()["detail"]
