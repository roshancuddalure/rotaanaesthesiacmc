from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base
from app.models import Person, PersonAlias
from app.services.roster_reconciliation import extract_department_roster, reconcile_department_roster


def create_test_roster(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "OVERALL MARCH 26"
    worksheet.append(["ANAESTHESIA DEPARTMENT", "Dr. Antrofelix.M", "PROFESSORS-2"])
    worksheet.append(["Dr. Karthikpandian S", "Dr. Jeeva Priscilla D. M", None])
    for sheet_name in ("ANAESTHESIA", "CARDIAC ANAESTHESIA", "NEURO ANAESTHESIA"):
        workbook.create_sheet(sheet_name)
    workbook["CARDIAC ANAESTHESIA"].append(["1", "Dr. Allan  Deepak", "123", "ASST. PROFESSOR"])
    workbook["NEURO ANAESTHESIA"].append(["1", "Ramamani M", "123", "Professor"])
    workbook.save(path)


def test_extract_department_roster_cleans_roster_names(tmp_path: Path) -> None:
    roster_path = tmp_path / "roster.xlsx"
    create_test_roster(roster_path)

    entries = extract_department_roster(roster_path)
    names = {entry.canonical_name for entry in entries}

    assert "Antrofelix M" in names
    assert "Karthikpandian S" in names
    assert "Allan Deepak" in names
    assert "ANAESTHESIA DEPARTMENT" not in names


def test_reconcile_department_roster_merges_to_trusted_names(tmp_path: Path) -> None:
    roster_path = tmp_path / "roster.xlsx"
    create_test_roster(roster_path)

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    with session_factory() as session:
        existing = Person(canonical_name="Antrofelix")
        duplicate = Person(canonical_name="Antrofelix M")
        alias_target = Person(canonical_name="Karthik Pandian S")
        session.add_all([existing, duplicate, alias_target])
        session.flush()
        session.add(PersonAlias(person=alias_target, alias="Karthikpandian S", source="test"))
        session.commit()

        result = reconcile_department_roster(session, roster_path)

        assert result.merged_people == 1
        assert result.renamed_people >= 1
        assert result.created_people >= 2
        names = set(session.scalars(select(Person.canonical_name)))
        assert "Antrofelix M" in names
        assert "Karthikpandian S" in names
        assert "Antrofelix" not in names
