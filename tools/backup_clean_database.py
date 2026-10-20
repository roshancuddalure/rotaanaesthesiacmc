"""Verified PostgreSQL backup, restore drill and optional transactional application reset.

Reads credentials from a local file; never places them in command-line arguments/logs.
Default behavior is backup-only. --clean-production explicitly authorizes data clearing.
The source is write-locked during the snapshot/restore drill; schedule a maintenance window.
"""

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from app.core.config import settings  # noqa: E402


def alembic_config(connection=None):
    config = Config(str(ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend" / "alembic"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def pg_environment(url):
    return {
        **os.environ,
        "PGHOST": url.host or "localhost",
        "PGPORT": str(url.port or 5432),
        "PGUSER": url.username or "",
        "PGPASSWORD": url.password or "",
        "PGDATABASE": url.database or "",
        "PGSSLMODE": "require"
        if url.host not in {"localhost", "127.0.0.1", "::1"}
        else "prefer",
        "PGCONNECT_TIMEOUT": "20",
        "PGAPPNAME": "duty-rota-verified-backup",
    }


def pg_run(binary, args, url, timeout=600):
    result = subprocess.run(
        [str(binary), *args],
        env=pg_environment(url),
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode:
        # Avoid library error strings or DSNs in logs. Tool diagnostics are sanitized.
        error = result.stderr.decode("utf-8", errors="replace")
        for secret in [url.password, url.render_as_string(hide_password=False)]:
            if secret:
                error = error.replace(secret, "[REDACTED]")
        raise RuntimeError(f"{binary.name} failed: {error[:1200]}")
    return result.stdout


def table_names(connection):
    return [
        (row[0], row[1])
        for row in connection.execute(
            text(
                "SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') "
                "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' ORDER BY 1,2"
            )
        )
    ]


def qualified(connection, table):
    quote = connection.dialect.identifier_preparer.quote
    return ".".join(quote(part) for part in table)


def inventory(connection):
    result = {}
    for table in table_names(connection):
        name = qualified(connection, table)
        digest, count = hashlib.sha256(), 0
        rows = connection.execute(
            text(
                f'SELECT to_jsonb(t)::text FROM {name} t ORDER BY to_jsonb(t)::text COLLATE "C"'
            ),
            execution_options={"stream_results": True},
        )
        for row in rows:
            encoded = row[0].encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
            count += 1
        result[".".join(table)] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def sequence_inventory(connection):
    names = connection.execute(
        text(
            "SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2"
        )
    ).all()
    return {
        ".".join(name): list(
            connection.execute(
                text(f"SELECT last_value,is_called FROM {qualified(connection, name)}")
            ).one()
        )
        for name in names
    }


def write_manifest(path, manifest):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_restore_kit(destination, manifest):
    (destination / "SHA256SUMS.txt").write_text(
        f"{manifest['dump_sha256']}  {manifest['dump']}\n", encoding="utf-8"
    )
    (destination / "RESTORE.md").write_text(
        "# Verified PostgreSQL restore point\n\n"
        f"Created: {manifest['created_at_ist']} (Asia/Kolkata).\n\n"
        "The custom-format dump contains the original application schema and all table data, "
        "including account password hashes, sessions, configuration and audit/history records. "
        "Treat this directory as confidential. Connection passwords are not saved in this kit.\n\n"
        f"Original Alembic revision: {', '.join(manifest['original_migration'])}.\n\n"
        "## Restore safely\n\n"
        "1. Stop application traffic/writes. Provision an EMPTY replacement PostgreSQL 18 database "
        "(do not run migrations or seed it first). Keep the cleaned production database until "
        "the replacement has been checked.\n"
        "2. Save that empty target's PostgreSQL connection URL as one line in a private local file.\n"
        "3. From PowerShell run `./restore.ps1 -TargetConnectionFile 'C:\\private\\restore-url.txt'`. "
        "The script verifies the archive SHA-256, refuses a nonempty target and restores in one transaction.\n"
        "4. Compare restored tables and counts with `manifest.json`; inspect representative members, "
        "assignments and accounts before resuming service. A complete restore drill with exact per-table "
        "content hashes was performed before production cleaning; its result is recorded in the manifest.\n"
        "5. Point the application at the restored database. Use code compatible with the original "
        "migration revision. Apply later migrations only AFTER preserving/verifying this restored point.\n\n"
        "The helper restores without original ownership/ACLs so it works under the target owner. "
        "Configure target database roles/grants and TLS for your deployment. Cluster-wide roles, "
        "Railway service configuration and application binaries are outside a single-database dump.\n\n"
        "Restoring into the existing migrated schema is intentionally refused. Replacing an existing "
        "production database requires its own fresh backup and an explicitly planned cutover.\n",
        encoding="utf-8",
    )
    (destination / "restore.ps1").write_text(
        r"""param(
    [Parameter(Mandatory=$true)][string]$TargetConnectionFile,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$archive = Join-Path $PSScriptRoot $manifest.dump
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.dump_sha256) {
    throw 'Backup checksum mismatch. Restore refused.'
}
$url = [Uri]((Get-Content -LiteralPath $TargetConnectionFile -Raw).Trim())
if ($url.Scheme -notin @('postgresql','postgres') -or $url.Query) { throw 'Use a plain PostgreSQL URL with no query options; TLS is enforced for remote hosts.' }
$parts = $url.UserInfo.Split(':',2)
if ($parts.Length -ne 2) { throw 'Target URL must contain a user and password.' }
$keys = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME')
$saved = @{}
foreach ($key in $keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
try {
    $env:PGHOST = $url.Host
    $env:PGPORT = if ($url.Port -gt 0) { [string]$url.Port } else { '5432' }
    $env:PGUSER = [Uri]::UnescapeDataString($parts[0])
    $env:PGPASSWORD = [Uri]::UnescapeDataString($parts[1])
    $env:PGDATABASE = [Uri]::UnescapeDataString($url.AbsolutePath.TrimStart('/'))
    $env:PGSSLMODE = if ($url.Host -in @('localhost','127.0.0.1','::1')) { 'prefer' } else { 'require' }
    $env:PGCONNECT_TIMEOUT = '20'
    $env:PGAPPNAME = 'duty-rota-explicit-restore'
    $sql = "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'"
    $count = & (Join-Path $PgBin 'psql.exe') --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$sql
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($count) -or [int]$count.Trim() -ne 0) {
        throw 'Target is not empty or could not be checked. Restore refused; provision a new empty database.'
    }
    & (Join-Path $PgBin 'pg_restore.exe') --exit-on-error --single-transaction --no-owner --no-acl --dbname=$env:PGDATABASE $archive
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed; PostgreSQL rolled back the restore transaction.' }
    Write-Output 'Restore committed. Validate counts and application access before redirecting production traffic.'
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
}
""",
        encoding="utf-8-sig",
    )


def migration_fingerprint():
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((ROOT / "backend/alembic/versions").glob("*.py"))
    }


def execute(args):
    source_text = args.source_file.read_text(encoding="utf-8-sig").strip()
    if not re.fullmatch(r"postgres(?:ql)?(?:\+psycopg)?://\S+", source_text):
        raise RuntimeError("Connection file must contain exactly one PostgreSQL URL")
    source = make_url(source_text).set(drivername="postgresql+psycopg")
    if not source.host or not source.database or not source.username:
        raise RuntimeError("Connection file must identify a host, database and user")
    local = make_url(settings.sqlalchemy_database_url)
    if local.host not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError(
            "Restore verification requires a loopback-only local PostgreSQL server"
        )
    dump_bin, restore_bin = args.pg_bin / "pg_dump.exe", args.pg_bin / "pg_restore.exe"
    if not dump_bin.is_file() or not restore_bin.is_file():
        raise RuntimeError("PostgreSQL dump/restore executables were not found")
    stamp = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d-%B-%Y_%H-%M-%S_IST")
    destination = (args.backup_root / f"production_{stamp}").resolve()
    destination.mkdir(parents=True, exist_ok=False)
    (destination / ".gitignore").write_text("*\n", encoding="utf-8")
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
    dump_path = destination / f"duty_rota_{stamp}.dump"
    manifest_path = destination / "manifest.json"
    scripts = ScriptDirectory.from_config(alembic_config())
    heads = scripts.get_heads()
    if len(heads) != 1:
        raise RuntimeError("Expected exactly one migration head")
    fingerprint = migration_fingerprint()
    manifest = {
        "created_at_ist": stamp,
        "source": {
            "host": source.host,
            "port": source.port or 5432,
            "database": source.database,
        },
        "dump": dump_path.name,
        "target_migration": heads[0],
        "migration_files_sha256": fingerprint,
        "status": "started",
        "clean_requested": args.clean_production,
        "retained_data_table": "public.alembic_version",
        "connection_credentials_included": False,
    }
    write_manifest(manifest_path, manifest)
    print(f"Backup directory: {destination}", flush=True)
    print(
        f"Target: {source.host}:{source.port or 5432}/{source.database}; migration head {heads[0]}",
        flush=True,
    )
    source_engine = create_engine(
        source,
        connect_args={
            "connect_timeout": 20,
            "sslmode": pg_environment(source)["PGSSLMODE"],
        },
    )
    local_admin = create_engine(local, isolation_level="AUTOCOMMIT")
    verification_name = "duty_rota_restore_verify_" + uuid4().hex
    verification_url = local.set(database=verification_name)
    verification_created = False
    committed = False
    commit_started = False
    try:
        with source_engine.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as connection:
            with connection.begin():
                connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
                connection.execute(text("SET LOCAL lock_timeout='15s'"))
                connection.execute(
                    text("SET LOCAL idle_in_transaction_session_timeout='15min'")
                )
                connection.execute(text("SELECT pg_advisory_xact_lock(716241860025)"))
                tables = table_names(connection)
                if not tables or any(schema != "public" for schema, _ in tables):
                    raise RuntimeError(
                        "Expected application tables in public only; refusing ambiguous scope"
                    )
                # SHARE permits snapshot readers/pg_dump but blocks inserts, updates, deletes and DDL.
                connection.execute(
                    text(
                        "LOCK TABLE "
                        + ",".join(qualified(connection, t) for t in tables)
                        + " IN SHARE MODE"
                    )
                )
                snapshot = connection.scalar(text("SELECT pg_export_snapshot()"))
                manifest["original_migration"] = list(
                    connection.execute(
                        text("SELECT version_num FROM public.alembic_version")
                    ).scalars()
                )
                if len(manifest["original_migration"]) != 1:
                    raise RuntimeError("Expected one production migration version")
                list(
                    scripts.iterate_revisions(
                        heads[0], manifest["original_migration"][0]
                    )
                )
                print(
                    "Production writes locked; creating consistent full backup…",
                    flush=True,
                )
                manifest["before"] = inventory(connection)
                manifest["sequences_before"] = sequence_inventory(connection)
                pg_run(
                    dump_bin,
                    [
                        "--format=custom",
                        "--compress=6",
                        "--snapshot=" + snapshot,
                        "--file=" + str(dump_path),
                    ],
                    source,
                )
                manifest["dump_bytes"] = dump_path.stat().st_size
                manifest["dump_sha256"] = hashlib.sha256(
                    dump_path.read_bytes()
                ).hexdigest()
                write_restore_kit(destination, manifest)
                listing = pg_run(restore_bin, ["--list", str(dump_path)], source)
                (destination / "archive_contents.txt").write_bytes(listing)
                manifest["status"] = "backup_created"
                write_manifest(manifest_path, manifest)
                print(
                    f"Backup created ({manifest['dump_bytes']} bytes). Restoring into isolated local database…",
                    flush=True,
                )
                with local_admin.connect() as admin:
                    admin.execute(
                        text(
                            f'CREATE DATABASE "{verification_name}" TEMPLATE template0'
                        )
                    )
                verification_created = True
                pg_run(
                    restore_bin,
                    [
                        "--exit-on-error",
                        "--single-transaction",
                        "--no-owner",
                        "--no-acl",
                        "--dbname=" + verification_name,
                        str(dump_path),
                    ],
                    verification_url,
                )
                verify_engine = create_engine(verification_url)
                try:
                    with verify_engine.connect() as verify:
                        verify.execute(text("SET TIME ZONE 'UTC'"))
                        restored = inventory(verify)
                        restored_sequences = sequence_inventory(verify)
                    if (
                        restored != manifest["before"]
                        or restored_sequences != manifest["sequences_before"]
                    ):
                        raise RuntimeError(
                            "Restore comparison failed; production remains unchanged"
                        )
                    manifest["restore_verified"] = {
                        "all_table_hashes_match": True,
                        "all_row_counts_match": True,
                        "all_sequence_values_match": True,
                        "tables": len(restored),
                        "application_rows": sum(
                            t["rows"]
                            for name, t in restored.items()
                            if name != "public.alembic_version"
                        ),
                    }
                    with verify_engine.begin() as verify:
                        command.upgrade(alembic_config(verify), "head")
                        verified_migrated_tables = table_names(verify)
                        if args.clean_production:
                            data_tables = [
                                t
                                for t in verified_migrated_tables
                                if t != ("public", "alembic_version")
                            ]
                            verify.execute(
                                text(
                                    "TRUNCATE TABLE "
                                    + ",".join(
                                        qualified(verify, t) for t in data_tables
                                    )
                                    + " RESTART IDENTITY"
                                )
                            )
                            final_local = inventory(verify)
                            if any(
                                t["rows"]
                                for name, t in final_local.items()
                                if name != "public.alembic_version"
                            ):
                                raise RuntimeError(
                                    "Local clean rehearsal left application rows"
                                )
                    manifest["migration_rehearsal_passed"] = True
                    manifest["clean_rehearsal_passed"] = args.clean_production
                finally:
                    verify_engine.dispose()
                manifest["status"] = "restore_verified"
                write_manifest(manifest_path, manifest)
                print(
                    f"Restore verified: {len(restored)} tables match exactly. Migration rehearsal passed.",
                    flush=True,
                )
                if args.clean_production:
                    if migration_fingerprint() != fingerprint:
                        raise RuntimeError(
                            "Migration files changed during verification; refusing production mutation"
                        )
                    if (
                        hashlib.sha256(dump_path.read_bytes()).hexdigest()
                        != manifest["dump_sha256"]
                    ):
                        raise RuntimeError(
                            "Backup checksum changed; refusing production mutation"
                        )
                    if table_names(connection) != tables:
                        raise RuntimeError(
                            "Production table inventory changed during backup; refusing mutation"
                        )
                    print(
                        "Verified backup retained. Applying migrations and clearing application data in one transaction…",
                        flush=True,
                    )
                    command.upgrade(alembic_config(connection), "head")
                    migrated_tables = table_names(connection)
                    if migrated_tables != verified_migrated_tables:
                        raise RuntimeError(
                            "Production migration table inventory differs from verified rehearsal"
                        )
                    data_tables = [
                        t for t in migrated_tables if t != ("public", "alembic_version")
                    ]
                    connection.execute(
                        text(
                            "TRUNCATE TABLE "
                            + ",".join(qualified(connection, t) for t in data_tables)
                            + " RESTART IDENTITY"
                        )
                    )
                    after = inventory(connection)
                    if any(
                        t["rows"]
                        for name, t in after.items()
                        if name != "public.alembic_version"
                    ):
                        raise RuntimeError(
                            "Production clean verification failed; transaction will roll back"
                        )
                    version = list(
                        connection.execute(
                            text("SELECT version_num FROM public.alembic_version")
                        ).scalars()
                    )
                    if version != heads:
                        raise RuntimeError(
                            "Production migration head verification failed"
                        )
                    manifest["after"] = after
                    manifest["final_migration"] = version
                    manifest["status"] = "ready_to_commit"
                    write_manifest(manifest_path, manifest)
                commit_started = True
            # Source transaction has now committed; never report committed before this point.
            committed = True
        manifest["status"] = (
            "production_cleaned" if args.clean_production else "backup_verified"
        )
        write_manifest(manifest_path, manifest)
        print(
            f"Completed: {manifest['status']}. Backup SHA-256: {manifest['dump_sha256']}",
            flush=True,
        )
    except Exception as error:
        manifest["status"] = (
            "production_committed_followup_failed"
            if committed
            else "commit_result_requires_verification"
            if commit_started
            else "failed_production_transaction_rolled_back"
        )
        manifest["error_type"] = type(error).__name__
        safe_error = str(error)
        for secret in [source_text, source.password, local.password]:
            if secret:
                safe_error = safe_error.replace(secret, "[REDACTED]")
        manifest["sanitized_error"] = safe_error[:2000]
        write_manifest(manifest_path, manifest)
        # Connection failures can contain secrets, so callers only see the exception type.
        print(
            f"Stopped safely ({type(error).__name__}); inspect the sanitized manifest. No unverified reset was committed.",
            flush=True,
        )
        raise RuntimeError(type(error).__name__) from None
    finally:
        source_engine.dispose()
        if verification_created:
            assert re.fullmatch(
                r"duty_rota_restore_verify_[0-9a-f]{32}", verification_name
            )
            with local_admin.connect() as admin:
                admin.execute(text(f'DROP DATABASE "{verification_name}" WITH (FORCE)'))
        local_admin.dispose()
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, required=True)
    parser.add_argument(
        "--pg-bin", type=Path, default=Path(r"C:\Program Files\PostgreSQL\18\bin")
    )
    parser.add_argument("--clean-production", action="store_true")
    parser.add_argument("--backup-root", type=Path, default=ROOT / "backups")
    execute(parser.parse_args())
