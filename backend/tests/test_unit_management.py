from collections.abc import Generator
from contextlib import contextmanager
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import Person, PersonPosting, Unit
from app.services.auth import seed_superadmin


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
        assert len(month["assignments"]) == 1
        assert month["assignments"][0]["source"] == "unit_board"
        assert month["validation_issues"] == []

        main_summary = next(summary for summary in month["unit_summaries"] if summary["unit_id"] == main_id)
        assert main_summary["assigned_members"] == 1
        assert main_summary["people_with_leave"] == 1
        assert main_summary["leave_days"] == 3
        assert main_summary["leave_by_call_level"] == {"3RD_CALL": 3}


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
