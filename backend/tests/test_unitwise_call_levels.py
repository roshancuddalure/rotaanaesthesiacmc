from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import Person
from app.services.unitwise_call_levels import extract_unitwise_call_levels, prefill_call_levels_from_unitwise


def make_unitwise(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append([None, "UNIT I", "UNIT II"])
    worksheet.append(["4th calls ", "Bernice", "Noble "])
    worksheet.append([None, "Amit Mathew ", None])
    worksheet.append(["Pain call", "May 1-15", "16-31"])
    worksheet.append(["Main campus", "Not A Call", None])
    workbook.save(path)


def test_extract_unitwise_call_levels_stops_at_non_call_sections(tmp_path: Path) -> None:
    path = tmp_path / "unitwise.xlsx"
    make_unitwise(path)

    entries = extract_unitwise_call_levels(path)

    assert [(entry.cleaned_name, entry.call_level) for entry in entries] == [
        ("Bernice", "4TH_CALL"),
        ("Noble", "4TH_CALL"),
        ("Amit Mathew", "4TH_CALL"),
    ]


def test_prefill_call_levels_matches_roster_people(tmp_path: Path) -> None:
    path = tmp_path / "unitwise.xlsx"
    make_unitwise(path)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all(
            [
                Person(canonical_name="Bernice Theodore Y"),
                Person(canonical_name="Noble E Cherian"),
                Person(canonical_name="Amit Mathew"),
            ]
        )
        session.commit()

        result = prefill_call_levels_from_unitwise(session, path)

        assert result.matched == 3
        rows = {person.canonical_name: person.call_level for person in session.scalars(select(Person))}
    assert rows == {
        "Bernice Theodore Y": "4TH_CALL",
        "Noble E Cherian": "4TH_CALL",
        "Amit Mathew": "4TH_CALL",
    }


def test_prefill_call_levels_does_not_cross_match_wrong_initial(tmp_path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["DM/PDF", "Priyadharshini K"])
    path = tmp_path / "unitwise.xlsx"
    workbook.save(path)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Priyadharshini S"))
        session.commit()

        result = prefill_call_levels_from_unitwise(session, path)

        assert result.matched == 0
        person = session.scalars(select(Person)).one()
        assert person.call_level is None
