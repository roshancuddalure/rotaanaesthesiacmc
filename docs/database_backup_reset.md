# Verified database backup and clean reset

`tools/backup_clean_database.py` reads a PostgreSQL URL from a private local file.
Backup-only is the default; `--clean-production` explicitly enables destructive data clearing.
Run through the backend Python environment, with PostgreSQL 18 client tools and a local
PostgreSQL server available for an isolated restore drill.

The tool obtains write-blocking table locks, exports a consistent snapshot and creates a
custom-format pg_dump archive. It restores that archive into a newly generated local database
and compares exact row counts, per-table SHA-256 content digests and sequence states. It then
rehearses migrations and cleaning on that copy. Only after those checks succeed may it migrate
and truncate the source in one transaction. Existing table definitions are preserved;
application rows, including accounts, sessions, history, audit, configuration and recycle-bin
records, are removed. `alembic_version` remains as migration metadata.

This is a maintenance operation: writes are blocked during backup and verification. Reads may
continue until transactional DDL requires stronger locks. Unavailable locks, differing content,
modified migrations or any execution failure stop the reset. PostgreSQL rolls back transactional
DDL and truncation together on failure. A lost connection during COMMIT may leave an uncertain
result; inspect the manifest and independently check the source before any retry.

Backups are dated using Asia/Kolkata time, with day, month and year in their directory and dump
names. Each backup includes a manifest, archive listing, checksum, restore runbook and PowerShell
restore helper. On Windows the directory's ACL is restricted to the current user, SYSTEM and
Administrators. Backups contain sensitive application data; keep them private and maintain an
additional protected off-machine copy. Never commit connection files or backups to Git.

The restore helper checks SHA-256 and refuses a target containing application objects. Restore
into a fresh empty PostgreSQL database, verify it, then perform an explicit production cutover.
The helper uses one restore transaction and restores without original ownership or ACLs;
deployment role grants must be configured separately. Cluster-wide roles, hosting configuration
and application binaries are not included in a single-database backup. Keep application code
compatible with the backup's original migration revision when restoring that exact point.

Tests in `backend/tests/test_backup_clean_database.py` create disposable loopback databases.
They exercise successful backup/restore/clean, the shipped PowerShell restore helper, refusal
of nonempty restore targets, exact restored hashes, verification mismatch protection and rollback
of production-like migration failures. No real operational data is used by these tests.
