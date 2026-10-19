from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base
from app.models import Person, PersonAlias, PersonDesignation
from app.services.members import StalePreviewError
from app.services.roster_reconciliation import (
    extract_department_roster,
    preview_roster_reconciliation,
    reconcile_department_roster,
)


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


def test_reconcile_department_roster_previews_and_merges_only_certain_matches(tmp_path: Path) -> None:
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
        fuzzy = Person(canonical_name="Antrofelix")
        exact = Person(canonical_name="Antrofelix M")
        alias_target = Person(canonical_name="Karthik Pandian S")
        similar = Person(canonical_name="Jeeva Priscila D M")
        twin_a = Person(canonical_name="Allan Deepak")
        twin_b = Person(canonical_name="ALLAN DEEPAK")
        session.add_all([fuzzy, exact, alias_target, similar, twin_a, twin_b])
        session.flush()
        session.add(PersonAlias(person=alias_target, alias="Karthikpandian S", source="test"))
        session.commit()
        before = sorted(session.scalars(select(Person.canonical_name)))

        preview = preview_roster_reconciliation(session, roster_path)
        rows = {row["roster_name"]: row for row in preview.rows}
        assert sorted(session.scalars(select(Person.canonical_name))) == before  # preview changes nothing
        assert rows["Antrofelix M"]["action"] == "keep"
        assert rows["Karthikpandian S"]["action"] == "rename"
        assert rows["Allan Deepak"]["action"] == "merge"
        assert rows["Ramamani M"]["action"] == "create"
        # Similar, not identical: listed for review with the candidate, never merged or created.
        assert rows["Jeeva Priscilla D M"]["status"] == "needs_review"
        assert rows["Jeeva Priscilla D M"]["candidates"][0]["name"] == "Jeeva Priscila D M"

        with pytest.raises(StalePreviewError):
            reconcile_department_roster(session, roster_path, token="0" * 32)

        result = reconcile_department_roster(session, roster_path, token=preview.preview_token)

        assert result.merged_people == 1
        assert result.renamed_people == 1
        assert result.created_people == 1
        names = set(session.scalars(select(Person.canonical_name)))
        assert names == {"Antrofelix", "Antrofelix M", "Karthikpandian S", "Jeeva Priscila D M",
                         "Allan Deepak", "Ramamani M"}
        designation = session.scalars(
            select(PersonDesignation).join(Person).where(Person.canonical_name == "Ramamani M")
        ).one()
        assert designation.designation == "PROFESSOR"
