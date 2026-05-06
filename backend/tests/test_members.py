from datetime import date, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import DutyAssignment, DutySlot, Person, PersonAlias, PersonDesignation, RotaPeriod
from app.services.members import (
    auto_merge_duplicate_candidates,
    delete_invalid_members,
    duplicate_candidates,
    invalid_members,
    merge_people,
    normalize_dirty_member_names,
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

        result = auto_merge_duplicate_candidates(session)

        assert result.merged_groups == 1
        assert result.merged_people == 1
        assert result.remaining_groups == 0
        names = set(session.scalars(select(Person.canonical_name)))
        assert "Unrelated Person" in names
        assert len(names & {"Divya AJ", "DIVYA A J"}) == 1


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
