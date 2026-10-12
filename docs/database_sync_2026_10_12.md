# Public database sync — 12 October 2026

The user requested checking the May SQL backup against the current commit and syncing the connected public PostgreSQL database. After comparison, the user explicitly selected the **current local database, including newer records**, as the data source.

## Sources and compatibility

- Repository commit: `c20da67` (`dutyrota oct v1`).
- Supplied historical backup: `backups/duty_rota_2026_05_07.sql`, revision `20260506_0006`.
- The supplied `db oct26.txt` contains a PostgreSQL connection URL, rather than a website URL. Credentials were read from the file and were not written into this report or command output.
- Local database revision: `20261012_0018`, including the pending member-profile migration.
- Final public database revision: **`20260514_0017`**, matching the committed application's migration head.

Every historical duty, slot, unit, alias, designation, and posting in the May backup was already present locally. Local data additionally contained 837 slots, 208 postings, 153 leave records, one extra member, and changed values for 15 member records. Therefore the original May dump was not replayed over the newer local data.

## Merge performed

- Added **49,340 records** and updated **9 matching member/configuration records**, using local values as selected by the user.
- Matched records by primary and unique business keys, retained public identities for matching records, and remapped their dependent foreign keys and structured JSON identifiers.
- Preserved public-only records, including the October 2026 draft and its scope.
- Preserved both login accounts present immediately before the merge, including their passwords, roles, and active statuses. One additional source account was imported.
- Preserved all three preexisting public sessions. Local sessions and password-reset tokens were excluded.
- Preserved all 753 alias rows, including case variants, without collapsing distinct source records.
- Applied the data merge in one transaction with foreign-key/unique constraints enabled and row-count checks before commit. No data records were deleted.

Public data changed during the audit: two new matching member records and another account appeared. A fresh export was captured under locks immediately before the merge, so these records were included in protection and identity matching.

The local pending profile migration was initially applied during preparation. Both new profile tables were confirmed empty, and that migration was subsequently reversed on the public database to keep it aligned with committed code. No profile records were removed. The committed Alembic `upgrade head` path was then verified successfully. The local working database remains at revision `20261012_0018`; publishing the pending feature code and its migration is a separate deployment task.

## Verified final data

| Table | Public records |
| --- | ---: |
| persons | 313 |
| units | 8 |
| person_aliases | 753 |
| person_designations | 222 |
| person_postings | 3,831 |
| leave_requests | 153 |
| duty_slots | 15,051 |
| duty_assignments | 14,448 |
| rota_periods | 19 |
| user_accounts | 3 |
| user_sessions | 3 |

Read-back comparison verified all selected local domain records after identity remapping. Public account credentials/roles and session records were separately checked against the locked pre-merge export.

The analysis query from an isolated checkout of **committed code** successfully reported:

- 17 historical months;
- 14,448 counted duty records;
- 310 personnel represented in historical analysis;
- 8,139 counted 24-hour duties;
- 2,355 weekend 24-hour duties (28.9%).

Draft June/October periods remain separate from official historical analysis.

## Recovery and audit artifacts

Ignored private artifacts are stored under `Debug/db_sync_20261012/`:

- `public_before_sync.json.gz` — initial public recovery export;
- `public_pre_merge_locked.json.gz` — fresh export immediately before data writes;
- `public_before_data_sync_commit_compatible.json.gz` — pre-merge records with schema revision metadata aligned to the committed app;
- `local_before_sync.json.gz` — local source export;
- `comparison.json`, `backup_local_overlap.json`, `merge_plan.json`, `merge_result.json`;
- `verification.json`, `account_preservation.json`, `commit_compatibility.json`, `committed_statistics.json`.

The recovery files are structured PostgreSQL COPY-data JSON/gzip exports, not plain SQL dumps. They contain private database records and must remain outside version control. No connection URL is included in export metadata. `verification.json` records the read-back stage before reversal of the empty pending profile migration; `commit_compatibility.json` records the final public schema version.

The public database was synced; no website deployment or source-code commit was performed. Only a PostgreSQL connection URL was supplied, so external website HTTP behavior was not tested.
