from collections.abc import Generator
from contextlib import contextmanager
from datetime import date
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.models import Person
from app.services.auth import seed_superadmin
from app.services.call_clusters import active_cluster_keys_for_person


@contextmanager
def cluster_client() -> Generator[tuple[TestClient, sessionmaker[Session]], None, None]:
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
                Person(canonical_name="Schell Ready", call_level="3RD_CALL"),
                Person(canonical_name="Shift Ready", call_level="3RD_CALL"),
                Person(canonical_name="First Call Person", call_level="1ST_CALL"),
            ]
        )
        seed_session.commit()

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), testing_session
    finally:
        app.dependency_overrides.clear()


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/sign-in",
        json={"username": "rotachief", "password": "rotateam"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_admin_can_create_update_and_assign_call_cluster_members() -> None:
    with cluster_client() as (client, testing_session):
        headers = auth_headers(client)
        members = client.get("/api/v1/admin/members", headers=headers).json()
        person_id = next(member["id"] for member in members if member["canonical_name"] == "Schell Ready")

        created = client.post(
            "/api/v1/admin/call-clusters",
            headers=headers,
            json={
                "key": "3rd Call Schell",
                "name": "3rd Call - Schell Eligible",
                "call_level": "3rd call",
                "description": "Can cover Schell duty",
            },
        )
        assert created.status_code == 200
        cluster = created.json()
        assert cluster["key"] == "3rd_call_3rd_call_schell_eligible"
        assert cluster["call_level"] == "3RD_CALL"
        assert cluster["member_count"] == 0

        rename = client.put(
            f"/api/v1/admin/call-clusters/{cluster['id']}",
            headers=headers,
            json={
                "key": cluster["key"],
                "name": "3rd Call - Schell Duty Pool",
                "call_level": "3rd call",
                "description": "Can cover Schell duty",
            },
        )
        assert rename.status_code == 200
        assert rename.json()["key"] == cluster["key"]

        changed_key = client.put(
            f"/api/v1/admin/call-clusters/{cluster['id']}",
            headers=headers,
            json={
                "key": "typo_schell",
                "name": "3rd Call - Schell Duty Pool",
                "call_level": "3rd call",
            },
        )
        assert changed_key.status_code == 400
        assert "system ID cannot be changed" in changed_key.json()["detail"]

        updated = client.put(
            f"/api/v1/admin/call-clusters/{cluster['id']}/members",
            headers=headers,
            json={
                "members": [
                    {
                        "person_id": person_id,
                        "effective_from": "2026-05-01",
                        "effective_to": "2026-05-31",
                        "notes": "May eligibility",
                    }
                ]
            },
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["member_count"] == 1
        assert body["members"][0]["canonical_name"] == "Schell Ready"

        listed = client.get("/api/v1/admin/call-clusters", headers=headers)
        assert listed.status_code == 200
        assert listed.json()[0]["member_count"] == 1

        with testing_session() as session:
            assert active_cluster_keys_for_person(session, UUID(person_id), date(2026, 5, 15)) == {
                "3rd_call_3rd_call_schell_eligible"
            }
            assert active_cluster_keys_for_person(session, UUID(person_id), date(2026, 6, 1)) == set()


def test_call_cluster_rejects_members_outside_parent_call() -> None:
    with cluster_client() as (client, _testing_session):
        headers = auth_headers(client)
        members = client.get("/api/v1/admin/members", headers=headers).json()
        wrong_person_id = next(member["id"] for member in members if member["canonical_name"] == "First Call Person")

        created = client.post(
            "/api/v1/admin/call-clusters",
            headers=headers,
            json={
                "key": "3rd Call Schell",
                "name": "3rd Call - Schell Eligible",
                "call_level": "3rd call",
            },
        )
        assert created.status_code == 200
        cluster = created.json()

        response = client.put(
            f"/api/v1/admin/call-clusters/{cluster['id']}/members",
            headers=headers,
            json={
                "members": [
                    {
                        "person_id": wrong_person_id,
                        "effective_from": "2026-05-01",
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert "must belong to 3RD_CALL" in response.json()["detail"]


def test_rota_rules_reject_unknown_engine_markers() -> None:
    with cluster_client() as (client, _testing_session):
        headers = auth_headers(client)
        response = client.get("/api/v1/admin/rota-rules/phase-one", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        payload.pop("rule_version")

        payload["duty_rules"][0]["allowed_call_levels"] = ["Not a real call"]
        bad_call = client.put("/api/v1/admin/rota-rules/phase-one", headers=headers, json=payload)
        assert bad_call.status_code == 400
        assert "Unknown allowed call level" in bad_call.json()["detail"]

        response = client.get("/api/v1/admin/rota-rules/phase-one", headers=headers)
        payload = response.json()
        payload.pop("rule_version")
        payload["duty_rules"][0]["allowed_cluster_keys"] = ["misspelled_group_key"]
        bad_group = client.put("/api/v1/admin/rota-rules/phase-one", headers=headers, json=payload)
        assert bad_group.status_code == 400
        assert "Unknown allowed eligibility group" in bad_group.json()["detail"]
