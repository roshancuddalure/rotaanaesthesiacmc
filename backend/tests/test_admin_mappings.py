from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1 import admin_mappings
from app.db.session import Base, get_db
from app.main import app


def create_rota_workbook(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["A1"] = "DATE"
    worksheet["B1"] = 1
    worksheet["A2"] = "DAY"
    worksheet["B2"] = "Monday"
    worksheet["A3"] = "Cesar call A"
    worksheet["B3"] = "Dr Test"
    worksheet["A4"] = "JUNIOR-1"
    worksheet["B4"] = "Dr Another"
    workbook.save(path)


def create_unitwise_workbook(path: Path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["B1"] = "UNIT I"
    worksheet["A2"] = "5th calls"
    worksheet["B2"] = "Dr Senior"
    workbook.save(path)


@contextmanager
def client_with_database() -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_create_and_update_admin_mapping() -> None:
    with client_with_database() as client:
        response = client.post(
            "/api/v1/admin/mappings",
            json={
                "mapping_type": "duty_label",
                "source_label": "JUNIOR-1",
                "target_key": "NEURO_DEPT",
                "target_label": "Neuro Department",
                "status": "reviewed",
            },
        )
        assert response.status_code == 200
        mapping_id = response.json()["id"]

        response = client.put(
            f"/api/v1/admin/mappings/{mapping_id}",
            json={
                "target_key": "SHIFT",
                "target_label": "Shift",
                "status": "reviewed",
                "notes": "Changed by admin",
            },
        )

        assert response.status_code == 200
        assert response.json()["target_key"] == "SHIFT"

        response = client.get("/api/v1/admin/mappings?mapping_type=duty_label")
        assert response.status_code == 200
        assert response.json()[0]["source_label"] == "JUNIOR-1"


def test_scan_historical_mappings_creates_drafts(tmp_path: Path, monkeypatch) -> None:
    create_rota_workbook(tmp_path / "May Rota 2026.xlsx")
    unitwise_dir = tmp_path / "unitwise"
    unitwise_dir.mkdir()
    create_unitwise_workbook(unitwise_dir / "May 2026.xlsx")
    monkeypatch.setattr(admin_mappings, "HISTORICAL_DIR", tmp_path)

    with client_with_database() as client:
        response = client.post("/api/v1/admin/mappings/scan-historical")

        assert response.status_code == 200
        assert response.json()["created"] == 4

        response = client.get("/api/v1/admin/mappings")
        labels = {mapping["source_label"]: mapping for mapping in response.json()}

        assert labels["Cesar call A"]["target_key"] == "CAESAR_A_12HR"
        assert labels["JUNIOR-1"]["status"] == "needs_review"
        assert labels["UNIT I"]["mapping_type"] == "unit_label"
        assert labels["5th calls"]["mapping_type"] == "posting_label"
