"""End-to-end reset rehearsal against a newly created loopback PostgreSQL database."""

import argparse
import importlib.util
from pathlib import Path
import re
import sys
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text

from app.core.config import settings

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "verified_backup", ROOT / "tools/backup_clean_database.py"
)
backup = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = backup
spec.loader.exec_module(backup)


@pytest.fixture
def source_database(tmp_path):
    local = backup.make_url(settings.sqlalchemy_database_url)
    if local.host not in {"localhost", "127.0.0.1", "::1"}:
        pytest.skip("Requires loopback-only local PostgreSQL")
    name = "duty_rota_reset_rehearsal_" + uuid4().hex
    admin = create_engine(local, isolation_level="AUTOCOMMIT")
    with admin.connect() as db:
        db.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0'))
    source = local.set(database=name)
    engine = create_engine(source)
    try:
        with engine.begin() as db:
            db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
            db.execute(text("INSERT INTO alembic_version VALUES ('20261020_0025')"))
            # Minimal parents for migrations that reference application tables (0029).
            for parent in ("persons", "units", "rota_periods"):
                db.execute(text(f"CREATE TABLE {parent} (id UUID PRIMARY KEY)"))
            db.execute(text("CREATE TABLE sentinel (id SERIAL PRIMARY KEY, value TEXT NOT NULL)"))
            db.execute(
                text(
                    "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT REFERENCES sentinel(id))"
                )
            )
            db.execute(
                text("INSERT INTO sentinel(value) VALUES ('restore exactly'),('second row')")
            )
            db.execute(text("INSERT INTO child VALUES (1,1)"))
        url_file = tmp_path / "source_url.txt"
        url_file.write_text(
            source.set(drivername="postgresql").render_as_string(hide_password=False),
            encoding="utf-8",
        )
        yield (
            engine,
            argparse.Namespace(
                source_file=url_file,
                pg_bin=Path(r"C:\Program Files\PostgreSQL\18\bin"),
                clean_production=True,
                backup_root=tmp_path / "backups",
            ),
        )
    finally:
        engine.dispose()
        assert re.fullmatch(r"duty_rota_reset_rehearsal_[0-9a-f]{32}", name)
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


def test_backup_restore_migrate_and_clean_exactly(source_database):
    import json
    import subprocess

    engine, args = source_database
    directory = backup.execute(args)
    manifest = json.loads((directory / "manifest.json").read_text())
    assert manifest["status"] == "production_cleaned"
    assert manifest["restore_verified"]["application_rows"] == 3
    assert manifest["restore_verified"]["all_table_hashes_match"]
    assert manifest["restore_verified"]["all_sequence_values_match"]
    assert manifest["final_migration"] == ["20261022_0029"]
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM sentinel")) == 0
        assert db.scalar(text("SELECT count(*) FROM child")) == 0
        assert db.scalar(text("SELECT last_value FROM sentinel_id_seq")) == 1
        assert not db.scalar(text("SELECT is_called FROM sentinel_id_seq"))
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "20261022_0029"
        assert db.scalar(text("SELECT count(*) FROM member_merges")) == 0
    # The shipped restore helper must refuse the existing schema, then restore
    # the original exact contents into a separate empty database.
    helper = [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(directory / "restore.ps1"),
        "-TargetConnectionFile",
        str(args.source_file),
    ]
    refused = subprocess.run(helper, capture_output=True, timeout=30)
    assert refused.returncode != 0
    assert b"Target is not empty" in refused.stderr
    replacement = "duty_rota_restore_kit_" + uuid4().hex
    admin = create_engine(
        engine.url.set(database=backup.make_url(settings.sqlalchemy_database_url).database),
        isolation_level="AUTOCOMMIT",
    )
    restored_engine = None
    try:
        with admin.connect() as db:
            db.execute(text(f'CREATE DATABASE "{replacement}" TEMPLATE template0'))
        target = engine.url.set(database=replacement)
        args.source_file.write_text(
            target.set(drivername="postgresql").render_as_string(hide_password=False),
            encoding="utf-8",
        )
        restored = subprocess.run(helper, capture_output=True, timeout=60)
        assert restored.returncode == 0, restored.stderr.decode(errors="replace")
        restored_engine = create_engine(target)
        with restored_engine.connect() as db:
            assert backup.inventory(db) == manifest["before"]
    finally:
        if restored_engine is not None:
            restored_engine.dispose()
        assert re.fullmatch(r"duty_rota_restore_kit_[0-9a-f]{32}", replacement)
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE IF EXISTS "{replacement}" WITH (FORCE)'))
        admin.dispose()


def test_restore_verification_failure_preserves_source(source_database, monkeypatch):
    import json

    engine, args = source_database
    actual = backup.inventory

    def mismatch(connection):
        result = actual(connection)
        if connection.engine.url.database.startswith("duty_rota_restore_verify_"):
            result["public.sentinel"]["sha256"] = "deliberately wrong"
        return result

    monkeypatch.setattr(backup, "inventory", mismatch)
    with pytest.raises(RuntimeError):
        backup.execute(args)
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM sentinel")) == 2
        assert db.scalar(text("SELECT count(*) FROM child")) == 1
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "20261020_0025"
    manifest = json.loads(next(args.backup_root.glob("*/manifest.json")).read_text())
    assert manifest["status"] == "failed_production_transaction_rolled_back"
    assert "Restore comparison failed" in manifest["sanitized_error"]


def test_production_failure_rolls_back_migration_and_clear(source_database, monkeypatch):
    engine, args = source_database
    actual = backup.command.upgrade
    injected = []

    def fail_production(config, revision):
        connection = config.attributes["connection"]
        actual(config, revision)
        if connection.engine.url.database.startswith("duty_rota_reset_rehearsal_"):
            injected.append(True)
            raise RuntimeError("Injected production migration failure")

    monkeypatch.setattr(backup.command, "upgrade", fail_production)
    with pytest.raises(RuntimeError):
        backup.execute(args)
    assert injected == [True]
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM sentinel")) == 2
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "20261020_0025"
        assert db.scalar(text("SELECT to_regclass('public.member_merges')")) is None
