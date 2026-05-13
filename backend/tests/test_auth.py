from collections.abc import Generator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db.session import Base, get_db
from app.main import app
from app.services.auth import seed_superadmin


@contextmanager
def auth_client() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    with testing_session() as seed_session:
        seed_superadmin(seed_session)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_superadmin_sign_in_and_create_account() -> None:
    with auth_client() as client:
        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "rotateam"},
        )
        assert response.status_code == 200
        token = response.json()["token"]
        assert response.json()["user"]["role"] == "superadmin"

        response = client.post(
            "/api/v1/auth/accounts",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "username": "board1",
                "display_name": "Board Member",
                "password": "secret123",
                "role": "rota_board_member",
            },
        )
        assert response.status_code == 200
        assert response.json()["role"] == "rota_board_member"

        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "board1", "password": "secret123"},
        )
        assert response.status_code == 200


def test_forgot_and_reset_password() -> None:
    with auth_client() as client:
        response = client.post("/api/v1/auth/forgot-password", json={"username": "rotachief"})
        assert response.status_code == 200
        token = response.json()["reset_token"]

        response = client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "new_password": "newpass123"},
        )
        assert response.status_code == 200

        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "newpass123"},
        )
        assert response.status_code == 200


def test_authenticated_user_can_change_password() -> None:
    with auth_client() as client:
        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "rotateam"},
        )
        token = response.json()["token"]

        response = client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "wrongpass", "new_password": "newpass123"},
        )
        assert response.status_code == 400

        response = client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "rotateam", "new_password": "short"},
        )
        assert response.status_code == 400

        response = client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "rotateam", "new_password": "newpass123"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "password_changed"

        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "rotateam"},
        )
        assert response.status_code == 401

        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "newpass123"},
        )
        assert response.status_code == 200


def test_authenticated_user_can_update_profile() -> None:
    with auth_client() as client:
        response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "rotateam"},
        )
        token = response.json()["token"]

        response = client.put(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"display_name": "", "email": "chief@example.com"},
        )
        assert response.status_code == 400

        response = client.put(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"display_name": "Updated Chief", "email": "chief@example.com"},
        )
        assert response.status_code == 200
        assert response.json()["display_name"] == "Updated Chief"
        assert response.json()["email"] == "chief@example.com"

        response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["display_name"] == "Updated Chief"


def test_diagnostics_requires_admin_privilege() -> None:
    with auth_client() as client:
        superadmin_response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "rotachief", "password": "rotateam"},
        )
        superadmin_token = superadmin_response.json()["token"]

        response = client.get(
            "/api/v1/diagnostics/summary",
            headers={"Authorization": f"Bearer {superadmin_token}"},
        )
        assert response.status_code == 200
        assert "database_counts" in response.json()

        client.post(
            "/api/v1/auth/accounts",
            headers={"Authorization": f"Bearer {superadmin_token}"},
            json={
                "username": "board2",
                "display_name": "Board Member 2",
                "password": "secret123",
                "role": "rota_board_member",
            },
        )
        board_response = client.post(
            "/api/v1/auth/sign-in",
            json={"username": "board2", "password": "secret123"},
        )
        board_token = board_response.json()["token"]

        response = client.get(
            "/api/v1/diagnostics/summary",
            headers={"Authorization": f"Bearer {board_token}"},
        )
        assert response.status_code == 403
