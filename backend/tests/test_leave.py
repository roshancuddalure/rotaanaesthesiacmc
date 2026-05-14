from collections.abc import Generator
from contextlib import contextmanager
from datetime import date
from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import LeaveRequest, Person
from app.services.auth import seed_superadmin
from app.services.leave import leave_pressure, leave_summary
from app.services.leave_import import apply_leave_import, preview_leave_import


@contextmanager
def leave_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)
        seed_session.add_all(
            [
                Person(canonical_name="Sujil", call_level="3RD_CALL"),
                Person(canonical_name="Jeenu Ann Jose", call_level="4TH_CALL"),
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


def test_leave_summary_counts_active_and_blocking_leave() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        person = Person(canonical_name="Sujil", call_level="3RD_CALL")
        cancelled_person = Person(canonical_name="Cancelled Person", call_level="2ND_CALL")
        session.add_all(
            [
                LeaveRequest(
                    person=person,
                    leave_type="ANNUAL_LEAVE",
                    leave_slot="FULL_DAY",
                    starts_on=date(2026, 6, 10),
                    ends_on=date(2026, 6, 12),
                    status="approved",
                ),
                LeaveRequest(
                    person=cancelled_person,
                    leave_type="ANNUAL_LEAVE",
                    leave_slot="FULL_DAY",
                    starts_on=date(2026, 6, 11),
                    ends_on=date(2026, 6, 11),
                    status="cancelled",
                ),
            ]
        )
        session.commit()

        summary = leave_summary(session, "2026-06")

        assert summary["total_requests"] == 1
        assert summary["blocking_requests"] == 1
        assert summary["people_on_leave"] == 1
        assert summary["total_leave_days"] == 3
        assert summary["call_level_counts"] == {"3RD_CALL": 3}


def test_leave_pressure_exposes_daily_generation_blockers() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        person = Person(canonical_name="Sujil", call_level="3RD_CALL")
        session.add(
            LeaveRequest(
                person=person,
                leave_type="ANNUAL_LEAVE",
                leave_slot="FULL_DAY",
                starts_on=date(2026, 6, 10),
                ends_on=date(2026, 6, 10),
                status="approved",
            )
        )
        session.commit()

        pressure = leave_pressure(session, "2026-06")

        assert pressure["days"][0]["date"] == "2026-06-10"
        assert pressure["days"][0]["blocking_people"] == 1
        assert pressure["call_level_totals"] == {"3RD_CALL": 1}
        assert pressure["blockers"][0]["is_blocking"] is True


def test_leave_import_preview_matches_canonical_members() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Sujil", call_level="3RD_CALL"))
        session.commit()
        content = (
            "Name,From,To,Type,Status\n"
            "Sujil,10/06/2026,12/06/2026,Annual Leave,Approved\n"
            "Unknown,11/06/2026,11/06/2026,Annual Leave,Approved\n"
        ).encode()

        preview = preview_leave_import(session, "leave.csv", content, "2026-06")

        assert preview["total_rows"] == 2
        assert preview["matched_rows"] == 1
        assert preview["unresolved_rows"] == 1
        assert preview["rows"][0]["person_name"] == "Sujil"
        assert preview["rows"][1]["preview_status"] == "needs_review"


def test_leave_import_preview_does_not_match_archived_or_historical_members() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all(
            [
                Person(canonical_name="Active Person", active_status="active", call_level="3RD_CALL"),
                Person(canonical_name="Archived Person", active_status="archived", call_level="3RD_CALL"),
                Person(canonical_name="Historical Person", active_status="historical", call_level="3RD_CALL"),
            ]
        )
        session.commit()
        content = (
            "Name,From,To,Type,Status\n"
            "Active Person,10/06/2026,10/06/2026,Annual Leave,Approved\n"
            "Archived Person,11/06/2026,11/06/2026,Annual Leave,Approved\n"
            "Historical Person,12/06/2026,12/06/2026,Annual Leave,Approved\n"
        ).encode()

        preview = preview_leave_import(session, "leave.csv", content, "2026-06")

        assert preview["matched_rows"] == 1
        assert preview["unresolved_rows"] == 2
        assert preview["rows"][0]["person_name"] == "Active Person"
        assert preview["rows"][1]["person_id"] is None
        assert preview["rows"][1]["issues"] == ["Unresolved department member"]
        assert preview["rows"][2]["person_id"] is None
        assert preview["rows"][2]["issues"] == ["Unresolved department member"]


def test_leave_import_preview_extracts_slot_from_name_cell() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Sujil", call_level="3RD_CALL"))
        session.commit()
        content = "Name,From,To\nDr Sujil (AM),10/06/2026,10/06/2026\n".encode()

        preview = preview_leave_import(session, "leave.csv", content, "2026-06")

        assert preview["matched_rows"] == 1
        assert preview["rows"][0]["cleaned_person_name"] == "Sujil"
        assert preview["rows"][0]["leave_slot"] == "AM"
        assert preview["rows"][0]["match_method"] == "normalized_exact"


def test_leave_import_preview_cleans_annotations_and_skips_noise_rows() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Sujil", call_level="3RD_CALL"))
        session.commit()
        content = (
            "Name,From,To,Slot,Status\n"
            '"1. Dr. Sujil - Casual Leave (PM)",10/06/2026,10/06/2026,,Approved\n'
            "Name,From,To,Slot,Status\n"
            "NIL,10/06/2026,10/06/2026,,Approved\n"
            "Total,10/06/2026,10/06/2026,,Approved\n"
        ).encode()

        preview = preview_leave_import(session, "leave.csv", content, "2026-06")

        assert preview["total_rows"] == 1
        assert preview["matched_rows"] == 1
        assert preview["rows"][0]["cleaned_person_name"] == "Sujil"
        assert preview["rows"][0]["leave_slot"] == "PM"


def test_leave_import_preview_parses_wide_calendar_excel() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all(
            [
                Person(canonical_name="Sujil", call_level="3RD_CALL"),
                Person(canonical_name="Jeenu Ann Jose", call_level="4TH_CALL"),
            ]
        )
        session.commit()
        frame = pd.DataFrame(
            [
                ["MAY", "2026", "", ""],
                ["CONSULTANT", "", "", ""],
                ["", date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3)],
                ["S.NO", "FRIDAY", "SATURDAY", "SUNDAY"],
                [1, "Sujil", "Sujil", ""],
                [2, "", "Jeenu Ann Jose", "Jeenu Ann Jose"],
            ]
        )
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            frame.to_excel(writer, sheet_name="MAY 26", index=False, header=False)

        preview = preview_leave_import(session, "leave.xlsx", buffer.getvalue(), "2026-05")

        assert preview["total_rows"] == 2
        assert preview["matched_rows"] == 2
        assert preview["source_formats"] == ["wide_calendar"]
        assert preview["rows"][0]["starts_on"] == "2026-05-01"
        assert preview["rows"][0]["ends_on"] == "2026-05-02"


def test_leave_import_preview_ignores_wide_calendar_noise_cells() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Sujil", call_level="3RD_CALL"))
        session.commit()
        frame = pd.DataFrame(
            [
                ["", date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3)],
                ["S.NO", "FRIDAY", "SATURDAY", "SUNDAY"],
                [1, "NIL", "Dr Sujil - CL", "Sujil PM"],
                [2, "Total", "Leave", "Approved"],
            ]
        )
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            frame.to_excel(writer, sheet_name="MAY 26", index=False, header=False)

        preview = preview_leave_import(session, "leave.xlsx", buffer.getvalue(), "2026-05")

        assert preview["total_rows"] == 2
        assert preview["matched_rows"] == 2
        assert {row["leave_slot"] for row in preview["rows"]} == {"FULL_DAY", "PM"}


def test_apply_leave_import_creates_only_safe_matched_rows() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Person(canonical_name="Sujil", call_level="3RD_CALL"))
        session.commit()
        content = (
            "Name,From,To,Slot,Status\n"
            "Sujil,10/06/2026,10/06/2026,PM,Approved\n"
            "Unknown,11/06/2026,11/06/2026,AM,Approved\n"
        ).encode()

        result = apply_leave_import(session, "leave.csv", content, "2026-06")

        saved = session.query(LeaveRequest).all()
        assert result["created_rows"] == 1
        assert result["skipped_rows"] == 1
        assert len(saved) == 1
        assert saved[0].leave_slot == "PM"
        assert saved[0].source == "import"


def test_leave_api_create_list_calendar_and_cancel() -> None:
    with leave_client() as client:
        token = sign_in(client)
        members = client.get(
            "/api/v1/admin/members",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        sujil_id = next(member["id"] for member in members if member["canonical_name"] == "Sujil")

        response = client.post(
            "/api/v1/leave/requests",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "person_id": sujil_id,
                "leave_type": "ANNUAL_LEAVE",
                "leave_slot": "FULL_DAY",
                "starts_on": "2026-06-10",
                "ends_on": "2026-06-12",
                "status": "approved",
                "notes": "Family function",
            },
        )
        assert response.status_code == 200
        leave_id = response.json()["id"]
        assert response.json()["days"] == 3

        response = client.get(
            "/api/v1/leave/calendar?month=2026-06",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        calendar = response.json()
        assert calendar["summary"]["total_leave_days"] == 3
        assert len(calendar["days"]["2026-06-10"]) == 1

        response = client.post(
            f"/api/v1/leave/requests/{leave_id}/cancel",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"

        response = client.get(
            "/api/v1/leave/calendar?month=2026-06",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.json()["summary"]["total_leave_days"] == 0


def test_leave_api_rejects_archived_and_historical_members() -> None:
    with leave_client() as client:
        token = sign_in(client)
        headers = {"Authorization": f"Bearer {token}"}
        members = client.get("/api/v1/admin/members", headers=headers).json()
        sujil_id = next(member["id"] for member in members if member["canonical_name"] == "Sujil")
        jeenu_id = next(member["id"] for member in members if member["canonical_name"] == "Jeenu Ann Jose")

        archived = client.post(f"/api/v1/admin/members/{sujil_id}/archive", headers=headers)
        assert archived.status_code == 200

        historical_payload = next(member for member in members if member["id"] == jeenu_id)
        historical_payload["active_status"] = "historical"
        historical = client.put(
            f"/api/v1/admin/members/{jeenu_id}",
            headers=headers,
            json={
                "canonical_name": historical_payload["canonical_name"],
                "active_status": "historical",
                "call_level": historical_payload["call_level"],
            },
        )
        assert historical.status_code == 200

        for person_id in (sujil_id, jeenu_id):
            response = client.post(
                "/api/v1/leave/requests",
                headers=headers,
                json={
                    "person_id": person_id,
                    "leave_type": "ANNUAL_LEAVE",
                    "leave_slot": "FULL_DAY",
                    "starts_on": "2026-06-10",
                    "ends_on": "2026-06-10",
                    "status": "approved",
                },
            )
            assert response.status_code == 400
            assert response.json()["detail"] == "Leave can only be assigned to active members"


def test_leave_import_preview_api() -> None:
    with leave_client() as client:
        token = sign_in(client)
        response = client.post(
            "/api/v1/leave/import-preview?month=2026-06",
            headers={"Authorization": f"Bearer {token}"},
            files={
                "file": (
                    "leave.csv",
                    b"Name,From,To\nSujil,10/06/2026,10/06/2026\nMissing,11/06/2026,11/06/2026\n",
                    "text/csv",
                )
            },
        )

        assert response.status_code == 200
        assert response.json()["matched_rows"] == 1
        assert response.json()["unresolved_rows"] == 1


def test_leave_import_apply_api_updates_calendar() -> None:
    with leave_client() as client:
        token = sign_in(client)
        response = client.post(
            "/api/v1/leave/import-apply?month=2026-06",
            headers={"Authorization": f"Bearer {token}"},
            files={
                "file": (
                    "leave.csv",
                    b"Name,From,To,Slot,Status\nSujil,10/06/2026,10/06/2026,AM,Approved\nMissing,11/06/2026,11/06/2026,PM,Approved\n",
                    "text/csv",
                )
            },
        )

        assert response.status_code == 200
        assert response.json()["created_rows"] == 1
        assert response.json()["skipped_rows"] == 1

        calendar = client.get(
            "/api/v1/leave/calendar?month=2026-06",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert calendar["summary"]["total_requests"] == 1
        assert calendar["days"]["2026-06-10"][0]["leave_slot"] == "AM"
