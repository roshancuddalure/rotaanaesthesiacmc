from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import xlsxwriter
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, PersonPosting, Unit, UnitCallMinimum
from app.services.auth import seed_superadmin
from app.services.rota_setup import monthly_setup, update_scope_units
from app.services.rota_rules import default_phase_one_rules
from app.services.rota_template import (
    TemplateGenerationOptions,
    clear_template_cache,
    generate_empty_template,
    template_month,
    write_call_wise_template_export,
    write_eagle_eye_matrix,
)


def seed_template_context(session: Session) -> tuple[Unit, Unit, Person]:
    included = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
    excluded = Unit(code="UNIT_II", name="Unit II", campus="MAIN")
    person = Person(canonical_name="Template Member", call_level="1ST_CALL")
    session.add_all([included, excluded, person])
    session.flush()
    session.add(
        PersonPosting(
            person=person,
            unit=included,
            posting_type="1ST_CALL",
            starts_on=date(2026, 5, 1),
            source="unit_board",
        )
    )
    session.add(
        LeaveRequest(
            person=person,
            leave_type="ANNUAL_LEAVE",
            leave_slot="FULL_DAY",
            starts_on=date(2026, 5, 1),
            ends_on=date(2026, 5, 1),
            status="approved",
        )
    )
    session.commit()
    return included, excluded, person


def lock_month_scope(session: Session, included: Unit, excluded: Unit) -> None:
    _period, scope = monthly_setup(session, "2026-05")
    update_scope_units(
        session,
        scope,
        [included.id],
        [excluded.id],
        True,
        True,
        "Ready for template generation",
    )


def test_generate_empty_template_preserves_mandatory_and_blocks_adjustable_slots() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, _person = seed_template_context(session)
        lock_month_scope(session, included, excluded)

        result = generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR", "PAC"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        slots = session.query(DutySlot).all()
        assert result["latest_run"]["created_slots"] == 1
        assert result["latest_run"]["needs_review_slots"] == 1
        assert result["latest_run"]["blocked_slots"] == 1
        assert len(slots) == 1
        assert slots[0].unit_id == included.id
        assert slots[0].duty_type == "MAIN_1ST_24HR"
        assert slots[0].template_status == "needs_review"
        assert excluded.id not in {slot.unit_id for slot in slots}


def test_generate_empty_template_requires_locked_scope() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, _excluded, _person = seed_template_context(session)
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [included.id], [], True, False)

        try:
            generate_empty_template(
                session,
                "2026-05",
                TemplateGenerationOptions(duty_keys=["MAIN_1ST_24HR"]),
            )
        except ValueError as exc:
            assert "scope must be locked" in str(exc)
        else:
            raise AssertionError("Unlocked generation scope should block template generation")


def test_generate_empty_template_balances_duties_across_units() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit_a = Unit(code="UNIT_A", name="Unit A", campus="MAIN", minimum_free_people=0)
        unit_b = Unit(code="UNIT_B", name="Unit B", campus="MAIN", minimum_free_people=0)
        people = [
            Person(canonical_name="A First", call_level="1ST_CALL"),
            Person(canonical_name="B First", call_level="1ST_CALL"),
        ]
        session.add_all([unit_a, unit_b, *people])
        session.flush()
        session.add_all(
            [
                PersonPosting(person=people[0], unit=unit_a, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
                PersonPosting(person=people[1], unit=unit_b, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
            ]
        )
        session.commit()
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [unit_a.id, unit_b.id], [], True, True, "Balance test")

        result = generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 4),
            ),
        )

        counts = {
            unit.code: session.query(DutySlot).filter(DutySlot.unit_id == unit.id).count()
            for unit in [unit_a, unit_b]
        }
        assert result["latest_run"]["created_slots"] == 4
        assert counts == {"UNIT_A": 2, "UNIT_B": 2}


def test_generate_empty_template_uses_unit_minimum_free_people() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        strict = Unit(code="STRICT", name="Strict Unit", campus="MAIN", minimum_free_people=1)
        flexible = Unit(code="FLEX", name="Flexible Unit", campus="MAIN", minimum_free_people=0)
        strict_person = Person(canonical_name="Strict First", call_level="1ST_CALL")
        flexible_person = Person(canonical_name="Flexible First", call_level="1ST_CALL")
        session.add_all([strict, flexible, strict_person, flexible_person])
        session.flush()
        session.add_all(
            [
                PersonPosting(person=strict_person, unit=strict, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
                PersonPosting(person=flexible_person, unit=flexible, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
            ]
        )
        session.commit()
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [strict.id, flexible.id], [], True, True, "Minimum free test")

        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        slot = session.query(DutySlot).filter(DutySlot.source == "phase4_template").one()
        assert slot.unit_id == flexible.id


def test_generate_empty_template_uses_call_wise_unit_minimum_free_people() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        strict = Unit(code="STRICT", name="Strict Unit", campus="MAIN", minimum_free_people=0)
        flexible = Unit(code="FLEX", name="Flexible Unit", campus="MAIN", minimum_free_people=0)
        strict_first = Person(canonical_name="Strict First", call_level="1ST_CALL")
        strict_third = Person(canonical_name="Strict Third", call_level="3RD_CALL")
        flexible_first = Person(canonical_name="Flexible First", call_level="1ST_CALL")
        session.add_all([strict, flexible, strict_first, strict_third, flexible_first])
        session.flush()
        session.add_all(
            [
                PersonPosting(person=strict_first, unit=strict, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
                PersonPosting(person=strict_third, unit=strict, posting_type="3RD_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
                PersonPosting(person=flexible_first, unit=flexible, posting_type="1ST_CALL", starts_on=date(2026, 5, 1), source="unit_board"),
                UnitCallMinimum(unit=strict, call_level="1ST_CALL", minimum_free_people=1),
            ]
        )
        session.commit()
        _period, scope = monthly_setup(session, "2026-05")
        update_scope_units(session, scope, [strict.id, flexible.id], [], True, True, "Call minimum free test")

        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        slot = session.query(DutySlot).filter(DutySlot.source == "phase4_template").one()
        assert slot.unit_id == flexible.id


def test_template_month_excludes_historical_import_slots() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, _person = seed_template_context(session)
        lock_month_scope(session, included, excluded)
        period, _scope = monthly_setup(session, "2026-05")
        starts_at = datetime.combine(date(2026, 5, 1), time(hour=8))
        session.add(
            DutySlot(
                rota_period=period,
                unit=None,
                duty_date=date(2026, 5, 1),
                duty_type="HISTORICAL_IMPORTED_CALL",
                slot_label="legacy:row",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=24),
                is_24hr=True,
                source="historical_analysis_import",
            )
        )
        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        result = template_month(session, "2026-05")

        assert result["summary"]["total_slots"] == 1
        assert [slot["unit_code"] for slot in result["slots"]] == ["UNIT_I"]


def test_clear_template_cache_removes_generated_slots_and_runs_only() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, _person = seed_template_context(session)
        lock_month_scope(session, included, excluded)
        period, _scope = monthly_setup(session, "2026-05")
        starts_at = datetime.combine(date(2026, 5, 1), time(hour=8))
        session.add(
            DutySlot(
                rota_period=period,
                unit=None,
                duty_date=date(2026, 5, 1),
                duty_type="HISTORICAL_IMPORTED_CALL",
                slot_label="legacy:row",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=24),
                is_24hr=True,
                source="historical_analysis_import",
            )
        )
        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )

        result = clear_template_cache(session, "2026-05")
        remaining_slots = session.query(DutySlot).all()

        assert result["cleared_slots"] == 1
        assert result["cleared_runs"] == 1
        assert len(remaining_slots) == 1
        assert remaining_slots[0].source == "historical_analysis_import"


def test_clear_template_cache_blocks_assigned_generated_slots() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, person = seed_template_context(session)
        lock_month_scope(session, included, excluded)
        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )
        slot = session.query(DutySlot).filter(DutySlot.source == "phase4_template").one()
        session.add(DutyAssignment(duty_slot=slot, person=person, source="manual_rota_board"))
        session.commit()

        try:
            clear_template_cache(session, "2026-05")
        except ValueError as exc:
            assert "have assignments" in str(exc)
        else:
            raise AssertionError("Assigned template slots should block cache clearing")


def test_clear_template_cache_can_remove_assignments_when_explicitly_requested() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        included, excluded, person = seed_template_context(session)
        lock_month_scope(session, included, excluded)
        generate_empty_template(
            session,
            "2026-05",
            TemplateGenerationOptions(
                duty_keys=["MAIN_1ST_24HR"],
                starts_on=date(2026, 5, 1),
                ends_on=date(2026, 5, 1),
            ),
        )
        slot = session.query(DutySlot).filter(DutySlot.source == "phase4_template").one()
        session.add(DutyAssignment(duty_slot=slot, person=person, source="manual_rota_board"))
        session.commit()

        result = clear_template_cache(session, "2026-05", clear_assignments=True)

        assert result["cleared_slots"] == 1
        assert result["cleared_assignments"] == 1
        assert session.query(DutyAssignment).count() == 0
        assert session.query(DutySlot).filter(DutySlot.source == "phase4_template").count() == 0


@contextmanager
def template_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        included, excluded, _person = seed_template_context(seed_session)
        lock_month_scope(seed_session, included, excluded)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return response.json()["token"]


def test_rota_template_api_generates_and_returns_template_month() -> None:
    with template_client() as client:
        token = sign_in(client)
        response = client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "duty_keys": ["MAIN_1ST_24HR", "PAC"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-01",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["latest_run"]["created_slots"] == 1
        assert payload["latest_run"]["blocked_slots"] == 1
        assert payload["summary"]["needs_review_slots"] == 1
        assert payload["slots"][0]["unit_code"] == "UNIT_I"


def test_rota_template_api_clears_cache() -> None:
    with template_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers=headers,
            json={
                "duty_keys": ["MAIN_1ST_24HR"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-01",
            },
        )

        response = client.delete("/api/v1/rota-template/cache?month=2026-05", headers=headers)

        assert response.status_code == 200
        assert response.json()["cleared_slots"] == 1
        month = client.get("/api/v1/rota-template/month?month=2026-05", headers=headers).json()
        assert month["summary"]["total_slots"] == 0


def test_rota_template_api_clears_cache_with_assignments_when_requested() -> None:
    with template_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        generated = client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers=headers,
            json={
                "duty_keys": ["MAIN_1ST_24HR"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-02",
            },
        ).json()
        slot_id = generated["slots"][0]["id"]
        person_id = client.get("/api/v1/admin/members", headers=headers).json()[0]["id"]
        assigned = client.post(
            f"/api/v1/rota-assignments/slots/{slot_id}/assign",
            headers=headers,
            json={"person_id": person_id, "override_reason": "Test setup assignment before clear"},
        )
        assert assigned.status_code == 200

        blocked = client.delete("/api/v1/rota-template/cache?month=2026-05", headers=headers)
        assert blocked.status_code == 400

        cleared = client.delete(
            "/api/v1/rota-template/cache?month=2026-05&clear_assignments=true",
            headers=headers,
        )
        assert cleared.status_code == 200
        assert cleared.json()["cleared_assignments"] == 1


def test_rota_template_eagle_eye_export_downloads_workbook() -> None:
    with template_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers=headers,
            json={
                "duty_keys": ["MAIN_1ST_24HR", "RC_12HR", "PB_SHIFT"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-02",
            },
        )

        response = client.get("/api/v1/rota-template/eagle-eye-export?month=2026-05", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert "eagle-eye-rota-template-2026-05.xlsx" in response.headers["content-disposition"]
        assert response.content.startswith(b"PK")
        workbook = load_workbook(BytesIO(response.content))
        sheet = workbook["Eagle Eye"]
        assert sheet.cell(row=1, column=1).value == "Duty"
        assert sheet.cell(row=1, column=2).value == "2026-05-01\nFriday"
        assert sheet.cell(row=1, column=3).value == "2026-05-02\nSaturday"
        assert sheet.cell(row=2, column=1).value == "MAIN CALLS"
        assert sheet.cell(row=3, column=1).value == "Main 1st Call"
        assert sheet.cell(row=2, column=1).fill.fgColor.rgb in {"FFD9EAF7", "00D9EAF7"}
        assert sheet.cell(row=1, column=3).fill.fgColor.rgb in {"FFFFE699", "00FFE699"}


def test_rota_template_call_wise_export_downloads_workbook() -> None:
    with template_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        client.post(
            "/api/v1/rota-template/generate?month=2026-05",
            headers=headers,
            json={
                "duty_keys": ["MAIN_1ST_24HR"],
                "starts_on": "2026-05-01",
                "ends_on": "2026-05-02",
            },
        )

        response = client.get("/api/v1/rota-template/call-wise-export?month=2026-05", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert "call-wise-rota-template-2026-05.xlsx" in response.headers["content-disposition"]
        assert response.content.startswith(b"PK")
        workbook = load_workbook(BytesIO(response.content))
        sheet = workbook["1st Call"]
        assert sheet.cell(row=1, column=1).value == "Duty"
        assert sheet.cell(row=1, column=2).value == "2026-05-01\nFriday"
        assert sheet.cell(row=1, column=3).value == "2026-05-02\nSaturday"
        assert sheet.cell(row=2, column=1).value == "Main 1st Call"
        assert sheet.cell(row=2, column=2).value == "Unit 1"
        assert sheet.cell(row=1, column=3).fill.fgColor.rgb in {"FFFFE699", "00FFE699"}


def test_eagle_eye_export_groups_duties_with_divider_rows() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_I", name="Unit I", campus="MAIN")
        period, _scope = monthly_setup(session, "2026-05")
        starts_at = datetime.combine(date(2026, 5, 2), time(hour=8))
        slots = [
            DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=date(2026, 5, 2),
                duty_type="MAIN_1ST_24HR",
                slot_label="unit:main",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=24),
                is_24hr=True,
                source="phase4_template",
            ),
            DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=date(2026, 5, 2),
                duty_type="RC_12HR",
                slot_label="unit:rc",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=12),
                is_24hr=False,
                source="phase4_template",
            ),
            DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=date(2026, 5, 2),
                duty_type="PB_SHIFT",
                slot_label="unit:shift",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=8),
                is_24hr=False,
                source="phase4_template",
            ),
        ]
        session.add_all([unit, *slots])
        session.flush()

        output = BytesIO()
        workbook = xlsxwriter.Workbook(output, {"in_memory": True})
        write_eagle_eye_matrix(workbook, slots, default_phase_one_rules())
        workbook.close()

    workbook = load_workbook(BytesIO(output.getvalue()))
    sheet = workbook["Eagle Eye"]
    assert sheet.cell(row=2, column=1).value == "MAIN CALLS"
    assert sheet.cell(row=3, column=1).value == "Main 1st Call"
    assert sheet.cell(row=4, column=1).value == "RC CALLS"
    assert sheet.cell(row=5, column=1).value == "RC 12hr"
    assert sheet.cell(row=6, column=1).value == "SHIFTS"
    assert sheet.cell(row=7, column=1).value == "PB Shift"
    assert sheet.cell(row=2, column=1).fill.fgColor.rgb in {"FFD9EAF7", "00D9EAF7"}
    assert sheet.cell(row=1, column=2).fill.fgColor.rgb in {"FFFFE699", "00FFE699"}
    assert sheet.cell(row=3, column=2).value == "Unit 1"


def test_call_wise_export_splits_slots_by_required_person_call_level() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        unit = Unit(code="UNIT_III", name="Unit III", campus="MAIN")
        period, _scope = monthly_setup(session, "2026-05")
        starts_at = datetime.combine(date(2026, 5, 2), time(hour=8))
        slots = [
            DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=date(2026, 5, 2),
                duty_type="MAIN_1ST_24HR",
                slot_label="unit:main-1",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=24),
                is_24hr=True,
                source="phase4_template",
            ),
            DutySlot(
                rota_period=period,
                unit=unit,
                duty_date=date(2026, 5, 2),
                duty_type="MAIN_3RD_24HR",
                slot_label="unit:main-3",
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=24),
                is_24hr=True,
                source="phase4_template",
            ),
        ]
        session.add_all([unit, *slots])
        session.flush()

        output = BytesIO()
        workbook = xlsxwriter.Workbook(output, {"in_memory": True})
        write_call_wise_template_export(workbook, slots, default_phase_one_rules())
        workbook.close()

    workbook = load_workbook(BytesIO(output.getvalue()))
    assert "1st Call" in workbook.sheetnames
    assert "3rd Call" in workbook.sheetnames
    assert workbook["1st Call"].cell(row=2, column=1).value == "Main 1st Call"
    assert workbook["3rd Call"].cell(row=2, column=1).value == "Main 3rd Call"
    assert workbook["3rd Call"].cell(row=2, column=2).value == "Unit 3"
    assert workbook["3rd Call"].cell(row=1, column=2).value == "2026-05-02\nSaturday"
    assert workbook["3rd Call"].cell(row=1, column=2).fill.fgColor.rgb in {"FFFFE699", "00FFE699"}
    assert workbook["3rd Call"].cell(row=2, column=2).fill.fgColor.rgb in {"FFFFF2CC", "00FFF2CC"}
