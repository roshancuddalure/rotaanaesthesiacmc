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
from app.models import LeaveRequest, Person
from app.services.auth import seed_superadmin
from app.services.leave import leave_summary


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

