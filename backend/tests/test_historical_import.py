from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.models import AdminMapping, DutyAssignment, ImportWarning, PersonPosting
from app.services.historical_import import import_historical_sources


def create_rota(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["A1"] = "DATE"
    worksheet["B1"] = datetime(2026, 1, 5)
    worksheet["A2"] = "DAY"
    worksheet["B2"] = "Friday"
    worksheet["A3"] = "Main 1st Call"
    worksheet["B3"] = "Dr Assigned"
    worksheet["A4"] = "JUNIOR-1"
    worksheet["B4"] = "Dr Skipped"
    workbook.save(path)


def create_unitwise(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["B1"] = "UNIT I"
    worksheet["A2"] = "5th calls"
    worksheet["B2"] = "Dr Assigned"
    workbook.save(path)


def test_import_historical_sources_uses_admin_mappings(tmp_path: Path) -> None:
    create_rota(tmp_path / "May Rota 2026.xlsx")
    unitwise_dir = tmp_path / "unitwise"
    unitwise_dir.mkdir()
    create_unitwise(unitwise_dir / "May 2026.xlsx")

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all(
            [
                AdminMapping(
                    mapping_type="duty_label",
                    source_label="Main 1st Call",
                    target_key="MAIN_1ST_24HR",
                    target_label="Main 1st Call",
                    status="reviewed",
                ),
                AdminMapping(
                    mapping_type="duty_label",
                    source_label="JUNIOR-1",
                    target_key=None,
                    status="needs_review",
                ),
                AdminMapping(
                    mapping_type="unit_label",
                    source_label="UNIT I",
                    target_key="UNIT_I",
                    target_label="Unit I",
                    status="reviewed",
                ),
                AdminMapping(
                    mapping_type="posting_label",
                    source_label="5th calls",
                    target_key="5TH_CALLS",
                    target_label="5th calls",
                    status="reviewed",
                ),
            ]
        )
        session.commit()

        summary = import_historical_sources(session, tmp_path)

        assert summary.duty_assignments_created == 1
        assert summary.skipped_assignments == 1
        assert summary.postings_created == 1

        assignment = session.scalars(select(DutyAssignment)).one()
        assert assignment.duty_slot.duty_type == "MAIN_1ST_24HR"
        assert assignment.person.canonical_name == "Assigned"

        posting = session.scalars(select(PersonPosting)).one()
        assert posting.unit.code == "UNIT_I"
        assert posting.posting_type == "5TH_CALLS"

        warning_codes = {warning.code for warning in session.scalars(select(ImportWarning))}
        assert "UNMAPPED_DUTY_LABEL" in warning_codes
