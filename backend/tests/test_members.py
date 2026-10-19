from datetime import date, datetime, timedelta
from uuid import uuid4
from app.models import UserAccount

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.api.v1.auth import current_user, require_admin
from app.main import app
from app.models import DutyAssignment, DutySlot, Person, PersonAlias, PersonDesignation, RotaPeriod
from app.services.members import (
    auto_merge_duplicate_candidates,
    delete_invalid_members,
    duplicate_candidates,
    invalid_members,
    merge_people,
    normalize_dirty_member_names,
    plan_auto_merge,
    StalePreviewError,
)


def test_duplicate_candidates_use_aliases_and_normalized_names() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        first = Person(canonical_name="Abishek V J")
        second = Person(canonical_name="ABISHEK VJ")
        first.aliases.append(PersonAlias(alias="Dr Abishek VJ", source="manual"))
        session.add_all([first, second])
        session.commit()

        candidates = duplicate_candidates(session)

        assert len(candidates) == 1
        assert {person.canonical_name for person in candidates[0].people} == {
            "Abishek V J",
            "ABISHEK VJ",
        }


def test_auto_merge_duplicate_candidates_merges_exact_compact_groups() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        first = Person(canonical_name="Divya AJ")
        second = Person(canonical_name="DIVYA A J")
        third = Person(canonical_name="Unrelated Person")
        session.add_all([first, second, third])
        session.commit()

        plan = plan_auto_merge(session)
        assert len(plan["groups"]) == 1
        assert session.scalar(select(func.count()).select_from(Person)) == 3  # preview changes nothing

        result = auto_merge_duplicate_candidates(session, plan["preview_token"])

        assert result.merged_groups == 1
        assert result.merged_people == 1
        assert result.remaining_groups == 0
        names = set(session.scalars(select(Person.canonical_name)))
        assert "Unrelated Person" in names
        assert len(names & {"Divya AJ", "DIVYA A J"}) == 1


def test_auto_merge_never_merges_on_a_shared_alias_and_needs_a_fresh_token() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        first = Person(canonical_name="Sujil Ebenezar Sam")
        second = Person(canonical_name="Samcharles D")
        first.aliases.append(PersonAlias(alias="Sam", source="historical_analysis_variant"))
        second.aliases.append(PersonAlias(alias="SAM", source="manual"))
        session.add_all([first, second])
        session.commit()

        plan = plan_auto_merge(session)
        assert plan["groups"] == []
        assert len(plan["needs_review"]) == 1
        result = auto_merge_duplicate_candidates(session, plan["preview_token"])
        assert result.merged_people == 0
        assert session.scalar(select(func.count()).select_from(Person)) == 2

        session.add(Person(canonical_name="SAMCHARLES D"))
        session.commit()
        with pytest.raises(StalePreviewError):
            auto_merge_duplicate_candidates(session, plan["preview_token"])
        assert session.scalar(select(func.count()).select_from(Person)) == 3


def test_merge_people_moves_assignments_aliases_and_designations() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        target = Person(canonical_name="Abishek V J")
        source = Person(canonical_name="ABISHEK VJ")
        source.aliases.append(PersonAlias(alias="Abishek", source="historical_import"))
        source.designations.append(
            PersonDesignation(
                designation="Senior Resident",
                effective_from=date(2026, 5, 1),
            )
        )
        period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
            status="historical",
        )
        starts_at = datetime(2026, 5, 2, 8)
        slot = DutySlot(
            rota_period=period,
            duty_date=starts_at.date(),
            duty_type="MAIN_1ST_24HR",
            slot_label="Main 1st Call",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=24),
            is_24hr=True,
        )
        session.add(DutyAssignment(person=source, duty_slot=slot))
        session.add(target)
        session.commit()

        merged = merge_people(session, target.id, [source.id])

        assert merged.canonical_name == "Abishek V J"
        assert session.scalar(select(Person).where(Person.canonical_name == "ABISHEK VJ")) is None
        assignment = session.scalars(select(DutyAssignment)).one()
        assert assignment.person_id == target.id
        aliases = {alias.alias for alias in session.scalars(select(PersonAlias))}
        assert {"ABISHEK VJ", "Abishek"} <= aliases
        designation = session.scalars(select(PersonDesignation)).one()
        assert designation.person_id == target.id


def test_invalid_member_cleanup_removes_bad_imported_names() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        valid = Person(canonical_name="Valid Person")
        invalid = Person(canonical_name="DATE")
        period = RotaPeriod(
            name="May 2026",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 31),
            status="historical",
        )
        starts_at = datetime(2026, 5, 2, 8)
        slot = DutySlot(
            rota_period=period,
            duty_date=starts_at.date(),
            duty_type="MAIN_1ST_24HR",
            slot_label="Main 1st Call",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=24),
            is_24hr=True,
        )
        session.add_all(
            [
                valid,
                DutyAssignment(person=invalid, duty_slot=slot),
            ]
        )
        session.commit()

        assert [person.canonical_name for person in invalid_members(session)] == ["DATE"]
        assert delete_invalid_members(session) == 1
        assert session.scalar(select(Person).where(Person.canonical_name == "DATE")) is None
        assert session.scalar(select(Person).where(Person.canonical_name == "Valid Person")) is not None
        assert session.scalars(select(DutyAssignment)).all() == []


def test_name_cleanup_preserves_real_name_with_noise_suffix() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Kiruthiga - Till sept 27"))
        session.commit()

        assert normalize_dirty_member_names(session) == 1

        person = session.scalars(select(Person)).one()
        assert person.canonical_name == "Kiruthiga"
        assert person.aliases[0].alias == "Kiruthiga - Till sept 27"


def test_name_cleanup_reports_collision_instead_of_merging() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all([Person(canonical_name="Kiruthiga - Till sept 27"), Person(canonical_name="Kiruthiga")])
        session.commit()

        assert normalize_dirty_member_names(session) == 0
        assert sorted(session.scalars(select(Person.canonical_name))) == ["Kiruthiga", "Kiruthiga - Till sept 27"]


def test_member_api_lists_full_roster_and_requires_explicit_restore() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as session:
        session.add_all(
            [Person(canonical_name=f"Member {index:03d}") for index in range(305)]
            + [Person(canonical_name="Zed Historical", active_status="historical")]
        )
        session.commit()

    def override_get_db():
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: None
    app.dependency_overrides[require_admin] = lambda: UserAccount(id=uuid4(),username="test",display_name="Test admin",role="computer_admin")
    try:
        client = TestClient(app)

        listed = client.get("/api/v1/admin/members")
        assert listed.status_code == 200
        assert len(listed.json()) == 306
        assert any(member["canonical_name"] == "Zed Historical" for member in listed.json())

        revived = client.post(
            "/api/v1/admin/members",
            json={"canonical_name": "zed historical", "active_status": "active"},
        )
        assert revived.status_code == 409
        person_id = next(m["id"] for m in listed.json() if m["canonical_name"] == "Zed Historical")
        restored = client.post(f"/api/v1/admin/members/{person_id}/restore")
        assert restored.status_code == 200
        assert restored.json()["active_status"] == "active"

        duplicate = client.post(
            "/api/v1/admin/members",
            json={"canonical_name": "Zed Historical", "active_status": "active"},
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"] == "Member already exists as active: Zed Historical"
    finally:
        app.dependency_overrides.clear()


def test_member_api_archives_and_restores_member_with_timestamp() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as session:
        person = Person(canonical_name="Archive Candidate", active_status="active")
        session.add(person)
        session.commit()
        person_id = str(person.id)

    def override_get_db():
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: None
    app.dependency_overrides[require_admin] = lambda: UserAccount(id=uuid4(),username="test",display_name="Test admin",role="computer_admin")
    try:
        client = TestClient(app)

        archived = client.post(f"/api/v1/admin/members/{person_id}/archive")
        assert archived.status_code == 200
        archived_payload = archived.json()
        assert archived_payload["active_status"] == "archived"
        assert archived_payload["archived_at"] is not None

        listed = client.get("/api/v1/admin/members")
        assert listed.status_code == 200
        assert any(
            member["canonical_name"] == "Archive Candidate"
            and member["active_status"] == "archived"
            for member in listed.json()
        )

        restored = client.post(f"/api/v1/admin/members/{person_id}/restore")
        assert restored.status_code == 200
        restored_payload = restored.json()
        assert restored_payload["active_status"] == "active"
        assert restored_payload["archived_at"] is None
    finally:
        app.dependency_overrides.clear()
