"""Read-only named PostgreSQL backup with an exact-content local restore drill."""

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from uuid import uuid4
from zoneinfo import ZoneInfo

from backup_clean_database import (
    ROOT,
    inventory,
    pg_run,
    settings,
    write_manifest,
    write_restore_kit,
)
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def run(source_file, name):
    if not name or name in {".", ".."} or any(c in name for c in '<>:"/\\|?*'):
        raise ValueError("Invalid backup name")
    destination = ROOT / "backups" / name
    destination.mkdir(exist_ok=False)
    (destination / ".gitignore").write_text("*\n")
    if os.name == "nt":
        identity = subprocess.check_output(["whoami"], text=True).strip()
        subprocess.run(
            [
                "icacls",
                str(destination),
                "/inheritance:r",
                "/grant:r",
                f"{identity}:(OI)(CI)F",
                "SYSTEM:(OI)(CI)F",
                "Administrators:(OI)(CI)F",
            ],
            capture_output=True,
            check=True,
        )
    source = make_url(source_file.read_text(encoding="utf-8-sig").strip()).set(
        drivername="postgresql+psycopg"
    )
    local = make_url(settings.sqlalchemy_database_url)
    assert local.host in {"localhost", "127.0.0.1", "::1"}
    remote = create_engine(
        source, connect_args={"sslmode": "require", "connect_timeout": 20}
    )
    admin = create_engine(local, isolation_level="AUTOCOMMIT")
    temporary = "duty_rota_snapshot_verify_" + uuid4().hex
    created = False
    verify_engine = None
    archive = destination / (name + ".dump")
    manifest = {
        "backup_label": name,
        "created_at_ist": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        "dump": archive.name,
        "status": "started",
        "production_data_changed": False,
        "snapshot_mode": "repeatable-read read-only exported snapshot",
        "clean_requested": False,
    }
    manifest_path = destination / "manifest.json"
    write_manifest(manifest_path, manifest)
    binaries = Path(r"C:\Program Files\PostgreSQL\18\bin")
    try:
        with remote.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as db:
            with db.begin():
                db.execute(text("SET TRANSACTION READ ONLY"))
                db.execute(text("SET LOCAL TIME ZONE 'UTC'"))
                db.execute(
                    text("SET LOCAL idle_in_transaction_session_timeout='15min'")
                )
                manifest["original_migration"] = list(
                    db.execute(
                        text("SELECT version_num FROM alembic_version")
                    ).scalars()
                )
                snapshot = db.scalar(text("SELECT pg_export_snapshot()"))
                print("Creating consistent read-only archive…", flush=True)
                pg_run(
                    binaries / "pg_dump.exe",
                    [
                        "--format=custom",
                        "--compress=6",
                        "--lock-wait-timeout=20s",
                        "--snapshot=" + snapshot,
                        "--file=" + str(archive),
                    ],
                    source,
                )
                manifest["dump_bytes"] = archive.stat().st_size
                manifest["dump_sha256"] = hashlib.sha256(
                    archive.read_bytes()
                ).hexdigest()
                manifest["status"] = "archive_created"
                write_manifest(manifest_path, manifest)
                (destination / "archive_contents.txt").write_bytes(
                    pg_run(
                        binaries / "pg_restore.exe", ["--list", str(archive)], source
                    )
                )
                print(
                    "Archive created; computing source snapshot content hashes…",
                    flush=True,
                )
                manifest["before"] = inventory(db)
        write_manifest(manifest_path, manifest)
        print("Restoring archive into an isolated local database…", flush=True)
        with admin.connect() as db:
            db.execute(text(f'CREATE DATABASE "{temporary}" TEMPLATE template0'))
        created = True
        pg_run(
            binaries / "pg_restore.exe",
            [
                "--exit-on-error",
                "--single-transaction",
                "--no-owner",
                "--no-acl",
                "--dbname=" + temporary,
                str(archive),
            ],
            local.set(database=temporary),
        )
        verify_engine = create_engine(local.set(database=temporary))
        with verify_engine.connect() as db:
            db.execute(text("SET TIME ZONE 'UTC'"))
            restored = inventory(db)
        if restored != manifest["before"]:
            raise RuntimeError(
                "Restored table counts/content differ from source snapshot"
            )
        manifest["restore_verified"] = {
            "all_table_hashes_match": True,
            "all_row_counts_match": True,
            "tables": len(restored),
            "application_rows": sum(
                v["rows"] for k, v in restored.items() if k != "public.alembic_version"
            ),
        }
        manifest["sequence_note"] = (
            "Sequence state is included in pg_dump; live sequences are not MVCC snapshot values and were not compared against the changing source."
        )
        manifest["status"] = "backup_verified"
        write_restore_kit(destination, manifest)
        restore_notes = destination / "RESTORE.md"
        notes = restore_notes.read_text(encoding="utf-8")
        notes = notes.replace(
            "was performed before production cleaning",
            "was performed for this read-only backup",
        )
        restore_notes.write_text(
            notes
            + "\nThis backup did not clear data or run production migrations. Live writes were allowed during the consistent snapshot backup.\n",
            encoding="utf-8",
        )
        write_manifest(manifest_path, manifest)
        print(
            json.dumps(
                {
                    "backup": str(archive),
                    "bytes": manifest["dump_bytes"],
                    "sha256": manifest["dump_sha256"],
                    "verification": manifest["restore_verified"],
                    "production_data_changed": False,
                },
                indent=2,
            ),
            flush=True,
        )
    except Exception as error:
        manifest["status"] = "verification_failed"
        manifest["error_type"] = type(error).__name__
        write_manifest(manifest_path, manifest)
        print("Backup stopped:", type(error).__name__, flush=True)
        raise SystemExit(1) from None
    finally:
        remote.dispose()
        if verify_engine:
            verify_engine.dispose()
        if created:
            assert re.fullmatch(r"duty_rota_snapshot_verify_[0-9a-f]{32}", temporary)
            with admin.connect() as db:
                db.execute(text(f'DROP DATABASE "{temporary}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    run(args.source_file, args.name)
