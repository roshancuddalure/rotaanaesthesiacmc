from collections.abc import Generator
from contextlib import contextmanager
from datetime import date
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import Person, PersonPosting, Unit
from app.services.auth import seed_superadmin
from app.services.unit_assignment_import import normalize_import_posting, parse_unitwise_excel_upload


@contextmanager
def unit_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        sujil = Person(canonical_name="Sujil", call_level="3RD_CALL")
        jeenu = Person(canonical_name="Jeenu Ann Jose", call_level="4TH_CALL")
        main = Unit(code="MAIN", name="Main OT", campus="CMC")
        cardiac = Unit(code="CARDIAC", name="Cardiac OT", campus="CMC")
        seed_session.add_all(
            [
                sujil,
                jeenu,
                main,
                cardiac,
                PersonPosting(
                    person=jeenu,
                    unit=main,
                    posting_type="4TH_CALL",
                    starts_on=date(2026, 6, 1),
                    ends_on=date(2026, 6, 30),
                    source="historical_import",
                ),
            ]
        )
        seed_session.commit()

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


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def seeded_ids(client: TestClient, token: str) -> tuple[str, str, str]:
    members = client.get("/api/v1/admin/members", headers=auth_headers(token)).json()
    units = client.get("/api/v1/units", headers=auth_headers(token)).json()
    sujil_id = next(member["id"] for member in members if member["canonical_name"] == "Sujil")
    main_id = next(unit["id"] for unit in units if unit["code"] == "MAIN")
    cardiac_id = next(unit["id"] for unit in units if unit["code"] == "CARDIAC")
    return sujil_id, main_id, cardiac_id


def test_unit_management_month_lists_assignment_and_leave_summary() -> None:
    with unit_client() as client:
        token = sign_in(client)
        sujil_id, main_id, _cardiac_id = seeded_ids(client, token)

        response = client.post(
            "/api/v1/unit-management/assignments",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "unit_id": main_id,
                "posting_type": "3rd call",
                "starts_on": "2026-06-01",
                "ends_on": "2026-06-30",
                "notes": "June main OT posting",
            },
        )
        assert response.status_code == 200
        assignment = response.json()
        assert assignment["posting_type"] == "3RD_CALL"
        assert assignment["person"]["canonical_name"] == "Sujil"
        assert assignment["source"] == "unit_board"

        leave_response = client.post(
            "/api/v1/leave/requests",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "leave_type": "ANNUAL_LEAVE",
                "leave_slot": "FULL_DAY",
                "starts_on": "2026-06-10",
                "ends_on": "2026-06-12",
                "status": "approved",
            },
        )
        assert leave_response.status_code == 200

        response = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        )
        assert response.status_code == 200
        month = response.json()
        assert month["month"] == "2026-06"
        assert next(unit for unit in month["units"] if unit["id"] == main_id)["minimum_free_people"] == 1
        assert len(month["assignments"]) == 1
        assert month["assignments"][0]["source"] == "unit_board"
        assert month["validation_issues"] == []

        main_summary = next(summary for summary in month["unit_summaries"] if summary["unit_id"] == main_id)
        assert main_summary["assigned_members"] == 1
        assert main_summary["people_with_leave"] == 1
        assert main_summary["leave_days"] == 3
        assert main_summary["leave_by_call_level"] == {"3RD_CALL": 3}


def test_unit_management_updates_unit_minimum_free_people() -> None:
    with unit_client() as client:
        token = sign_in(client)
        _sujil_id, main_id, _cardiac_id = seeded_ids(client, token)

        response = client.put(
            f"/api/v1/unit-management/units/{main_id}/settings",
            headers=auth_headers(token),
            json={"minimum_free_people": 3},
        )

        assert response.status_code == 200
        assert response.json()["minimum_free_people"] == 3

        month = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        ).json()
        assert next(unit for unit in month["units"] if unit["id"] == main_id)["minimum_free_people"] == 3


def test_unit_management_updates_and_validates_call_wise_minimums() -> None:
    with unit_client() as client:
        token = sign_in(client)
        sujil_id, main_id, _cardiac_id = seeded_ids(client, token)

        create_response = client.post(
            "/api/v1/unit-management/assignments",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "unit_id": main_id,
                "posting_type": "3rd call",
                "starts_on": "2026-06-01",
                "ends_on": "2026-06-30",
            },
        )
        assert create_response.status_code == 200

        response = client.put(
            f"/api/v1/unit-management/units/{main_id}/settings?month=2026-06",
            headers=auth_headers(token),
            json={
                "minimum_free_people": 1,
                "call_minimums": [{"call_level": "3rd call", "minimum_free_people": 1}],
            },
        )
        assert response.status_code == 200

        month = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        ).json()
        call_row = next(
            row
            for row in month["unit_call_minimums"]
            if row["unit_id"] == main_id and row["call_level"] == "3RD_CALL"
        )
        assert call_row["assigned_members"] == 1
        assert call_row["minimum_free_people"] == 1
        assert call_row["max_allowed"] == 1

        blocked = client.put(
            f"/api/v1/unit-management/units/{main_id}/settings?month=2026-06",
            headers=auth_headers(token),
            json={
                "minimum_free_people": 1,
                "call_minimums": [{"call_level": "3rd call", "minimum_free_people": 2}],
            },
        )
        assert blocked.status_code == 400
        assert "cannot exceed assigned members" in blocked.json()["detail"]


def test_unit_management_flags_overlapping_primary_assignment_and_allows_update_delete() -> None:
    with unit_client() as client:
        token = sign_in(client)
        sujil_id, main_id, cardiac_id = seeded_ids(client, token)

        first = client.post(
            "/api/v1/unit-management/assignments",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "unit_id": main_id,
                "posting_type": "3RD_CALL",
                "starts_on": "2026-06-01",
                "ends_on": "2026-06-30",
            },
        )
        assert first.status_code == 200

        second = client.post(
            "/api/v1/unit-management/assignments",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "unit_id": cardiac_id,
                "posting_type": "3RD_CALL",
                "starts_on": "2026-06-15",
                "ends_on": "2026-06-20",
            },
        )
        assert second.status_code == 200
        second_id = second.json()["id"]

        response = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        )
        issues = response.json()["validation_issues"]
        assert any(issue["code"] == "OVERLAPPING_PRIMARY_ASSIGNMENT" for issue in issues)
        assert any(issue["code"] == "MULTIPLE_UNITS_IN_MONTH" for issue in issues)

        updated = client.put(
            f"/api/v1/unit-management/assignments/{second_id}",
            headers=auth_headers(token),
            json={
                "person_id": sujil_id,
                "unit_id": cardiac_id,
                "posting_type": "PAIN",
                "starts_on": "2026-06-15",
                "ends_on": "2026-06-20",
                "notes": "Special posting",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["posting_type"] == "PAIN"

        response = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        )
        issues = response.json()["validation_issues"]
        assert not any(issue["code"] == "OVERLAPPING_PRIMARY_ASSIGNMENT" for issue in issues)
        assert any(issue["code"] == "MULTIPLE_UNITS_IN_MONTH" for issue in issues)

        deleted = client.delete(
            f"/api/v1/unit-management/assignments/{second_id}",
            headers=auth_headers(token),
        )
        assert deleted.status_code == 200
        assert deleted.json() == {"status": "deleted"}

        response = client.get(
            "/api/v1/unit-management/month?month=2026-06",
            headers=auth_headers(token),
        )
        assert len(response.json()["assignments"]) == 1


def unitwise_workbook_bytes() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "June"
    worksheet["A1"] = ""
    worksheet["B1"] = "Main OT"
    worksheet["C1"] = "Cardiac OT"
    worksheet["A2"] = "3rd calls"
    worksheet["B2"] = "Dr Sujil"
    worksheet["A3"] = "4th calls"
    worksheet["C3"] = "Dr Jeenu Ann Jose"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_unit_management_imports_unitwise_excel_preview_and_apply() -> None:
    with unit_client() as client:
        token = sign_in(client)
        headers = auth_headers(token)

        preview = client.post(
            "/api/v1/unit-management/import-preview?month=2026-06",
            headers=headers,
            files={
                "file": (
                    "June 2026.xlsx",
                    unitwise_workbook_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert preview.status_code == 200
        body = preview.json()
        assert body["matched_rows"] == 2
        assert body["rows"][0]["posting_type"] == "3RD_CALL"
        assert body["rows"][0]["unit_name"] == "Main OT"

        applied = client.post(
            "/api/v1/unit-management/import-apply?month=2026-06&replace_existing=true",
            headers=headers,
            files={
                "file": (
                    "June 2026.xlsx",
                    unitwise_workbook_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert applied.status_code == 200
        assert applied.json()["created_rows"] == 2

        month = client.get("/api/v1/unit-management/month?month=2026-06", headers=headers).json()
        assert len(month["assignments"]) == 2
        assert {assignment["posting_type"] for assignment in month["assignments"]} == {
            "3RD_CALL",
            "4TH_CALL",
        }


def test_unit_management_imports_notepad_unitwise_list() -> None:
    with unit_client() as client:
        token = sign_in(client)
        headers = auth_headers(token)
        content = b"""
Main OT
3rd calls: Dr Sujil
Cardiac OT
4th calls: Dr Jeenu Ann Jose
"""

        preview = client.post(
            "/api/v1/unit-management/import-preview?month=2026-06",
            headers=headers,
            files={"file": ("unitwise.txt", content, "text/plain")},
        )
        assert preview.status_code == 200
        body = preview.json()
        assert body["matched_rows"] == 2
        assert body["source_formats"] == ["text_unitwise"]


def split_month_unitwise_workbook_bytes() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "June"
    worksheet["A1"] = ""
    worksheet["B1"] = "Main OT"
    worksheet["C1"] = "Cardiac OT"
    worksheet["A2"] = "3rd call SR/APs"
    worksheet["B2"] = "Dr Sujil (June 1-15)"
    worksheet["C2"] = "Dr Sujil (June 16-30)"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_unit_management_import_allows_non_overlapping_split_month_unit_assignments() -> None:
    with unit_client() as client:
        token = sign_in(client)
        headers = auth_headers(token)

        preview = client.post(
            "/api/v1/unit-management/import-preview?month=2026-06",
            headers=headers,
            files={
                "file": (
                    "June 2026.xlsx",
                    split_month_unitwise_workbook_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert preview.status_code == 200
        body = preview.json()
        assert body["matched_rows"] == 2
        assert [row["posting_type"] for row in body["rows"]] == ["3RD_CALL", "3RD_CALL"]
        assert [(row["starts_on"], row["ends_on"]) for row in body["rows"]] == [
            ("2026-06-01", "2026-06-15"),
            ("2026-06-16", "2026-06-30"),
        ]
        assert all("overlapping dates" not in " ".join(row["issues"]) for row in body["rows"])

        applied = client.post(
            "/api/v1/unit-management/import-apply?month=2026-06&replace_existing=true",
            headers=headers,
            files={
                "file": (
                    "June 2026.xlsx",
                    split_month_unitwise_workbook_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert applied.status_code == 200
        assert applied.json()["created_rows"] == 2

        month = client.get("/api/v1/unit-management/month?month=2026-06", headers=headers).json()
        assert [(row["starts_on"], row["ends_on"]) for row in month["assignments"]] == [
            ("2026-06-01", "2026-06-15"),
            ("2026-06-16", "2026-06-30"),
        ]


def test_unit_management_import_preview_returns_parser_warnings_without_crashing() -> None:
    with unit_client() as client:
        token = sign_in(client)
        headers = auth_headers(token)

        preview = client.post(
            "/api/v1/unit-management/import-preview?month=2026-06",
            headers=headers,
            files={"file": ("unitwise.txt", b"Unknown heading without unit context\n", "text/plain")},
        )

        assert preview.status_code == 200
        body = preview.json()
        assert body["matched_rows"] == 0
        assert body["parser_warnings"]


def test_unitwise_import_normalizes_real_call_and_special_posting_labels() -> None:
    examples = {
        "3rd call SR/APs": "3RD_CALL",
        "DM/PDF": "3RD_CALL",
        "3rd calls/Paeds call (DM/PDF)": "3RD_CALL",
        "2nd call SRs": "2ND_CALL",
        "2nd call PGs (2024)": "2ND_CALL",
        "2022 3rd calls": "3RD_CALL",
        "1st call PGs (2025)": "1ST_CALL",
        "Pain Call": "PAIN",
        "PAC Main campus": "PAC",
        "ICU POSTINGS": "SICU",
        "DRP (April - June 2026)": "DRP",
    }

    assert {label: normalize_import_posting(label) for label in examples} == examples


def test_unitwise_import_keeps_pain_campus_rows_under_pain_call() -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["A1"] = ""
    worksheet["B1"] = "May 1-15"
    worksheet["C1"] = "16-31"
    worksheet["A2"] = "Pain call"
    worksheet["A3"] = "Main campus"
    worksheet["B3"] = "Mizpah, Jona Samraj"
    worksheet["C3"] = "Shanmuga, Sampanna"
    worksheet["A4"] = "Ranipet"
    worksheet["B4"] = "Shanmuga, Sampanna"
    worksheet["C4"] = "Mizpah, Jona Samraj"
    output = BytesIO()
    workbook.save(output)

    parsed = parse_unitwise_excel_upload("May 2026.xlsx", output.getvalue())

    assert {posting.posting_label for posting in parsed.postings} == {"Pain call"}
    assert {normalize_import_posting(posting.posting_label) for posting in parsed.postings} == {"PAIN"}
