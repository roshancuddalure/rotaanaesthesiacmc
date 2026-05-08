# Development Log

## 2026-05-05

Initial planning session started.

Reference files reviewed:

- CMC Anaesthesia Duty Analysis Guide.
- Existing self-contained HTML analysis report for Jan 2025 to May 2026.

Key observations:

- The domain is rule-heavy and needs a dedicated backend rule engine.
- Existing analysis already defines parsing rules, duty classification, weekend counting, name deduplication, call level tracking, special posting extraction, date reconstruction, dashboard sections, and mobile/offline constraints.
- The new product should separate imports, normalized data, rule processing, rota planning, leave management, and reporting.
- The repo currently only had `plan and requirements.txt`; a formal `plan` folder was created to preserve project memory.

Initial direction:

- Use Python/FastAPI for backend and domain processing.
- Use PostgreSQL for durable structured records.
- Use TypeScript/Vite with framework-light frontend initially.
- Start with import, normalization, validation, and analysis before attempting full auto-generation.
- Keep every computed result explainable from source file and rule version.

Pending:

- Clarify MVP scope.
- Clarify user roles and permissions.
- Clarify leave rules.
- Clarify rota generation hard and soft constraints.
- Decide whether historical 2025-2026 data should be imported as seed data.

Follow-up answers received from `Plan/QA/1.txt`:

- MVP should support both import/analysis and new rota creation.
- Initial users are rota admins only.
- Final output should export to Excel.
- Leave balance calculation is not needed now, but can be added later.
- At least 24 hours should separate two 24-hour duties for the same person.
- Duty limits should be configurable through the admin panel.
- Historical Jan 2025-May 2026 data should be imported as seed data.
- Offline self-contained HTML report export is desirable if feasible.

Universal project rule recorded from `d:\Coding\AI training\universal rule.txt`:

- Work must be evidence-based, with no unsupported guesswork.
- Use project docs, supplied files, code, and official references as evidence.
- Log learned knowledge, decisions, and solutions in appropriate project files.
- If knowledge is missing, perform a learning pass before implementation and record the conclusion.

Added planning files:

- `Plan/05_confirmed_decisions.md`
- `Plan/06_project_operating_principles.md`
- `Plan/07_phased_roadmap.md`
- `Plan/08_new_session_checklist.md`

Full skeleton request completed:

- Added repository `README.md`.
- Added `.env.example` and Docker Compose with PostgreSQL, backend, and frontend services.
- Added FastAPI backend skeleton under `backend/`.
- Added SQLAlchemy session/base and initial person/alias models.
- Added Alembic migration skeleton.
- Added domain constants for duty types and call levels.
- Added first hard-rule validator for 24-hour duty spacing.
- Added pytest test skeleton for health and spacing validation.
- Added Vite + TypeScript frontend skeleton under `frontend/`.
- Added API metadata loading in the frontend to prove backend/frontend contract shape.
- Updated roadmap checklists for completed scaffold items.

Verification:

- `python -m compileall backend\app backend\tests` passed.
- `python -m pytest backend\tests` could not run because `pytest` is not installed in the current Python environment yet.

Local PostgreSQL setup completed:

- Read local PostgreSQL password from the user-provided credential file.
- Created ignored repo-root `.env` for local development.
- Installed backend development dependencies into `backend\.venv`.
- Created local PostgreSQL database `duty_rota` on `localhost:5432`.
- Updated backend settings to load both repo-root and backend-local `.env` files so commands work from either project root or `backend/`.
- Verified backend SQLAlchemy engine connects to `duty_rota`.
- `cd backend; .\.venv\Scripts\python.exe -m pytest tests` passed with 3 tests.

Phase 1 data model completed:

- Added SQLAlchemy models for units, postings, leave requests, rota periods, duty slots, duty assignments, rule versions, and rule settings.
- Linked people to postings, leave requests, and duty assignments through ORM relationships.
- Added initial Alembic migration `20260505_0001_initial_domain_schema.py` covering persons, aliases, and the new Phase 1 domain tables.
- Applied the migration to local PostgreSQL database `duty_rota`; Alembic current revision is `20260505_0001`.
- Added `tests/test_models.py` to create the schema in memory and verify core relationships and JSON rule setting storage.
- Updated `.gitignore` to ignore Python editable-install metadata via `*.egg-info/`.
- Made settings resolve env files from the repository/backend paths instead of relying only on the shell working directory.
- Verification passed:
  - `cd backend; .\.venv\Scripts\python.exe -m ruff check app tests`
  - `cd backend; .\.venv\Scripts\python.exe -m pytest tests` with 4 tests.
  - `cd backend; $env:DATABASE_URL='local PostgreSQL URL'; .\.venv\Scripts\python.exe -m alembic current`

Note:

- `compileall` was not used as a final verification because existing `__pycache__` directories produced Windows permission errors while writing `.pyc` files. Pytest and Ruff passed after the code changes.

## 2026-05-06

Phase 2 historical import foundation started.

Evidence:

- Roadmap identifies Phase 2 as the next phase after completed Phase 1 domain model work.
- The workspace does not currently contain the actual Jan 2025-May 2026 rota/unitwise Excel files.

Changes:

- Added ignored `data/source/historical/` folder for local historical source files, with `.gitkeep` retained in Git.
- Added import traceability models for import batches, source records, and warnings.
- Added Alembic migration `20260506_0002_import_traceability.py`.
- Expanded import services with Excel workbook profiling, source-cell extraction with sheet/row/column provenance, person-name cleanup, duty-label classification, and month reconstruction helpers.
- Added tests for import helpers and traceability model relationships.

Pending:

- Add the real historical rota/unitwise Excel files under `data/source/historical/`.
- Inspect workbook layouts and implement layout-specific rota and unitwise parsers.

Launch simplification:

- Added repo-root `start.ps1` so the local app can be started with one command.
- Added `launch.bat` as a Windows-friendly wrapper around `start.ps1`.
- The launcher creates the backend virtual environment if missing, installs backend dependencies, installs frontend dependencies if needed, starts PostgreSQL through Docker when available, starts FastAPI and Vite in separate PowerShell windows, and opens `http://localhost:5173`.
- Improved `start.ps1` after launch testing feedback: backend dependencies are only installed when missing, pip version checks are suppressed, Docker PostgreSQL readiness is checked, and Alembic migrations are applied before the backend starts.
- Improved launch database detection after Docker-not-found feedback: the launcher now first checks whether the configured database is already reachable and reports it as linked instead of warning about missing Docker.
- Fixed launcher dependency check after NumPy/OpenBLAS memory allocation failed while importing pandas. The launcher now uses `importlib.util.find_spec` to check installed packages without importing heavy modules.

Historical file inspection:

- User added historical monthly rota Excel files and unitwise Excel files under `data/source/historical/`.
- Found 17 monthly rota workbooks and 16 unitwise workbooks.
- Monthly rota pattern: row 1 contains date cells, row 2 weekday labels, column A duty labels, and day assignments across columns.
- Unitwise pattern: row 1 unit labels, column A posting/call-level group labels, and names across unit columns.
- Some rota date cells are day/month swapped by Excel formatting, so date reconstruction now uses the inferred workbook month plus the date cell components.
- Added parse helpers that produce traceable draft rota assignments and unitwise postings with source file, sheet, row, column, raw value, cleaned value, duty type, and reconstructed date/time.
- Real-file parser scan result:
  - 14,184 rota assignments parsed.
  - 3,178 unitwise postings parsed.
  - 5 unmapped rota labels remain: `JUNIOR-1`, `JUNIOR -2`, and `DM CO -CALL`.
- Clear duty-label variants such as `Cesar`, `RC First call`, and `CB C/S AM CAL` are now normalized.

Pending:

- Confirm how `JUNIOR-1`, `JUNIOR -2`, and `DM CO -CALL` should be classified.
- Persist parsed draft records into normalized database tables.
- Build import validation report and alias review workflow.

Admin mapping panel:

- User confirmed that every mapping and unit/posting placement should be comprehensively editable in the frontend admin panel before being used by the rota board.
- Added `admin_mappings` database table and Alembic migration `20260506_0003_admin_mappings.py`.
- Added admin mapping API endpoints:
  - list mapping rows,
  - create mapping rows,
  - update mapping targets/status/notes,
  - scan historical files and seed draft mappings.
- Added frontend Mappings section with filtering by duty/unit/posting mapping, scan action, editable target key/label, status, notes, and save.
- Seeded the local database from historical files:
  - 324 total mapping rows,
  - 172 duty-label mappings,
  - 8 unit-label mappings,
  - 144 posting-label mappings,
  - 3 `needs_review` rows: `DM CO -CALL`, `JUNIOR -2`, `JUNIOR-1`.

Historical import pipeline:

- Added `historical_import` service that consumes admin mappings rather than hardcoded parser guesses.
- The importer creates/reuses rota periods, people, units, duty slots, duty assignments, person postings, import batches, source records, and import warnings.
- Unmapped duty rows now remain traceable draft assignments in parsing, so admin mappings can later fix them; rows without a target mapping are skipped during normalized import and recorded as warnings.
- Added backend endpoints for historical import status and running the historical import.
- Added frontend Imports section with normalized counts and a historical import action.
- Ran historical import against local database:
  - 17 rota files,
  - 16 unitwise files,
  - 17 periods created,
  - 1,715 people created,
  - 8 units created,
  - 14,159 duty slots created,
  - 14,184 duty assignments created,
  - 3,167 postings created,
  - 17,494 source records created,
  - 137 warnings created,
  - 132 assignments skipped because mapping targets are still unresolved.

Current local database status:

- 1,715 people.
- 8 units.
- 14,159 duty slots.
- 14,184 duty assignments.
- 3,167 person postings.
- 33 import batches.
- 137 import warnings.

Analysis dashboard:

- Reviewed existing standalone report `CMC_Duty_Analysis_v5.html` as evidence for dashboard coverage.
- Added dynamic backend analysis API at `/api/v1/analysis/dashboard`.
- Analysis includes summary totals, month statistics, day-of-week distribution, duty category totals, person-level totals, weekend totals, 5th-call counts, posting buckets, unit/call-level timelines, and promotion/call-level changes.
- Analysis uses only periods with analysis-ready statuses: `historical`, `approved`, `published`, or `finalized`; draft periods are excluded so month-end approval controls when new data appears.
- Added native frontend Analysis section with dashboard cards, month and day charts, category totals, top duty lists, person table, and promotion table.
- Live local analysis check returned:
  - 1,715 personnel,
  - 956 active personnel,
  - 14,184 total assignment records,
  - 8,137 counted 24-hour duties,
  - 2,376 weekend 24-hour duties,
  - 17 analysis-ready months.

Department members and deduplication:

- User requested a dedicated pass section to deduplicate names and maintain department member designations/promotions.
- Added `person_designations` table and migration `20260506_0004_department_members.py`.
- Added member management API:
  - list/create/update members,
  - add aliases,
  - add designation history,
  - list dedupe candidates,
  - merge duplicate people into a canonical member.
- Added dedupe merge service that moves duty assignments, postings, leave requests, designations, and aliases to the selected canonical person. Source canonical names are preserved as aliases.
- Added frontend Department Members section with member list, designation entry, and duplicate candidate merge workflow.
- Applied migration locally.
- Current local member state:
  - 1,715 member records from historical import,
  - 0 designation records entered so far,
  - 379 dedupe candidate groups detected.
  - Example duplicate groups include variants of `Divya AJ`, `Karthik Pandian`, `Praveen BD`, `Anisha Joy`, and `Antrofelix`.

Guide-driven member cleanup and duty framework update:

- Reviewed `d:\00 ANESTHESIA CMC\rota\algo\CMC_Anaesthesia_Duty_Analysis_Guide.md`.
- Recorded the guide's key duty framework and name-cleaning rules in `Plan/03_domain_rules_and_decision_trees.md`.
- Strengthened parser name validation so non-person spreadsheet values are discarded before creating member records:
  - date/day/unit headers,
  - campus/posting labels,
  - ICU/SICU/DRP/PAC labels,
  - date ranges,
  - pure numeric artifacts,
  - x/xxxx placeholders,
  - guide-listed placeholders such as AADIL/HARISH/PRABHU.
- Added cleaning for suffix noise such as `SICU ONLY`, `MICU 5-15`, `BP 16-31`, and `- Till sept 27`.
- Unitwise parser now splits comma/slash-separated posting cells into separately cleaned names.
- Added cleanup endpoint and frontend button for invalid department members.
- Ran cleanup on local database:
  - invalid members before cleanup: 62,
  - dirty names normalized: 18,
  - invalid members deleted: 62,
  - invalid members after cleanup: 0,
  - current member records: 1,617,
  - current dedupe candidates: 374.
- Added duty framework refinements from the guide:
  - `SCHELL_AND_FLOATING` rows split into `SCHELL_24HR` and `FLOATING_24HR`,
  - `RC_CO_12HR` and `CB_PAEDS` added to duty type metadata,
  - RC co-call 12hr, CB co-call 12hr, shifts, PAC, and Neuro department treated as non-24hr windows.
- Updated `README.md` with the one-command launch instructions.

Login and privilege framework:

- Added auth tables for login accounts, sessions, and password reset tokens.
- Added PBKDF2 password hashing and bearer-token sessions using the Python standard library.
- Seeded default local superadmin:
  - username: `rotachief`,
  - password: `rotateam`,
  - role: `superadmin`.
- Added auth API:
  - sign in,
  - current user,
  - account creation/listing for admin roles,
  - forgot password,
  - reset password.
- Added role model:
  - rota board member,
  - computer admin,
  - superadmin.
- Added protected diagnostics API at `/api/v1/diagnostics/summary`; access requires computer admin or superadmin privilege.
- Added frontend sign-in, forgot-password/reset, account management, diagnostics, and sign-out flows.
- Applied auth migration locally and seeded the superadmin account.

Trusted roster reconciliation:

- User provided `Plan/Data/ANAESTHESIA department doctors(namelist).xlsx` as the corrected full-name reference.
- Added repeatable roster reconciliation service that extracts current roster names from the workbook, strips titles/status suffixes, and canonicalizes names.
- Added frontend Department Members action: `Reconcile Trusted Roster`.
- Added backend endpoint `/api/v1/admin/members/reconcile-trusted-roster`.
- Matching is conservative:
  - exact compact-name matches,
  - safe prefix matches for missing initials/spaces,
  - high-confidence similarity only.
- Previous imported names are preserved as aliases before rename/merge.
- Added tests for roster extraction and reconciliation.
- Applied reconciliation to the local database:
  - trusted roster entries processed: 238,
  - matched people: 232,
  - created missing trusted roster people: 6,
  - renamed people: 8,
  - merged people in the final completed pass: 33,
  - aliases created in final pass: 32,
  - designations created in final pass: 2.
- After the completed roster pass and invalid-name cleanup:
  - people: 1,444,
  - aliases: 502,
  - designations: 14,
  - invalid member names: 0,
  - dedupe candidate groups: 288.

Project learning and manual summary:

- User requested a pause for learning/brainstorming to avoid confusion before implementing the remaining system.
- Reviewed `Plan/Main features we need.txt` and `Plan/Rules for rota creator.txt`.
- Added `Plan/09_system_manual_and_brainstorming_summary.md` as the shared manual for:
  - what the system is,
  - how current sections work,
  - remaining major product features,
  - rota creator rules,
  - recommended planning/learning steps,
  - implementation order from here.
- Updated roadmap status to reflect completed login, dashboard shell, historical seeding, name cleanup, and trusted roster reconciliation.

Analysis action planning:

- User clarified that the next priority is a clean, fully debugged Analysis section with no duplicate names and only valid names.
- User asked for an extensive action plan before cleanup/implementation.
- Added `Plan/10_analysis_section_action_plan.md` with 168 action items covering:
  - data cleanliness,
  - canonical names and aliases,
  - analysis data scope,
  - duty classification rules,
  - member-level metrics,
  - fairness/balance metrics,
  - month-level metrics,
  - leave/availability integration hooks,
  - validation/preflight gates,
  - UI organization,
  - exports,
  - backend/frontend structure,
  - cleanup execution order,
  - acceptance criteria.

Analysis first implementation slice:

- Added backend `/api/v1/analysis/preflight`.
- Added preflight quality checks for:
  - invalid member names,
  - duplicate member candidate groups,
  - unresolved duty mappings,
  - unknown duty types,
  - empty included analysis periods.
- Added Analysis data-quality gate panel in the frontend.
- Added conservative exact duplicate auto-merge for department members.
- Added frontend Department Members action: `Auto-Merge Exact Duplicates`.
- Added tests for analysis preflight and duplicate auto-merge.
- Ran local cleanup sequence:
  - trusted roster reconciliation,
  - invalid-name cleanup,
  - exact duplicate auto-merge.
- Local cleanup result:
  - people: 1,098,
  - aliases: 849,
  - designations: 16,
  - invalid member names: 0,
  - duplicate candidate groups: 0.
- Analysis after cleanup:
  - analysis periods: 17,
  - analysis person rows: 1,044,
  - total records: 14,119,
  - total counted 24-hour duties: 8,133,
  - weekend counted 24-hour duties: 2,372.
- Remaining Analysis preflight blocker:
  - unresolved duty mappings for `DM CO -CALL`, `JUNIOR-1`, and `JUNIOR -2`.

Clean roster reset:

- User requested clearing accumulated historical/imported data because repeated cleanup passes were creating confusion.
- Added repeatable trusted roster reset service using the current roster sheets from `Plan/Data/ANAESTHESIA department doctors(namelist).xlsx`.
- The reset keeps login accounts and code intact, but clears operational/import/member/rota tables:
  - duty assignments,
  - duty slots,
  - postings,
  - leave requests,
  - member designations,
  - aliases,
  - persons,
  - units,
  - rota periods,
  - admin mappings,
  - import warnings/source records/batches,
  - rule settings/versions.
- Added backend endpoint `/api/v1/admin/members/reset-from-trusted-roster`.
- Added tests for clean roster extraction and operational data reset.
- Applied reset locally.
- Local reset result:
  - created members: 222,
  - created position/designation rows: 222,
  - aliases: 0,
  - duplicate names: 0,
  - invalid member names: 0.
- Historical analysis data is intentionally empty after reset:
  - analysis periods: 0,
  - analysis person rows: 0,
  - total records: 0.
- Analysis preflight is now `ready` because there are no invalid names, duplicates, unresolved mappings, or unknown duty types in the reset database.

Department Members UX and debug audit:

- Added backend member audit endpoint at `/api/v1/admin/members/audit`.
- Audit reports:
  - total members,
  - active/inactive members,
  - aliases,
  - designations,
  - invalid member names,
  - duplicate groups,
  - missing designations,
  - position breakdown,
  - designation source breakdown,
  - clean/needs-review status.
- Upgraded frontend Department Members page:
  - roster audit panel,
  - instant client-side search by name or position,
  - position filter,
  - sort by name/position/status,
  - visible-member count,
  - position breakdown,
  - clearer position/source display in the table.
- Live debug audit after reset:
  - total members: 222,
  - active members: 222,
  - inactive members: 0,
  - aliases: 0,
  - designations: 222,
  - invalid names: 0,
  - duplicate groups: 0,
  - missing designations: 0,
  - audit status: clean.

Member call-level prefill and editing:

- Added editable `call_level` column to `persons` with Alembic migration `20260506_0006_person_call_level.py`.
- Added unitwise call-level prefill service using `data/source/historical/unitwise/May 2026.xlsx`.
- Parsed only call-level sections from the unitwise sheet:
  - 5th calls,
  - 4th calls,
  - 3rd call SR/APs,
  - DM/PDF,
  - 2nd call SRs,
  - 2nd/3rd call PG year groups,
  - 1st call PGs.
- Pain call, ICU posting, DRP, and other posting rows are not forced into call level.
- Added safer matching tests so similar names with different initials are not cross-matched.
- Added backend endpoint `/api/v1/admin/members/prefill-call-levels`.
- Added frontend Members action `Prefill Call Levels`.
- Added editable Call Level column in Department Members.
- Added call-level filter and sort.
- Moved designation/position stats into a collapsible menu.
- Applied migration locally and ran May 2026 unitwise prefill.
- Prefill result:
  - unitwise call entries: 186,
  - matched members: 159,
  - unmatched entries left unassigned: 27,
  - members without call level after prefill: 63.
- Current call-level audit:
  - 5TH_CALL: 15,
  - 4TH_CALL: 22,
  - 3RD_CALL_SR_AP: 40,
  - DM_PDF: 7,
  - 2ND_CALL_SR: 6,
  - 2ND_CALL_PG_2022: 1,
  - 3RD_CALL_PG_2023: 18,
  - 2ND_CALL_PG_2023: 10,
  - 2ND_CALL_PG_2024: 14,
  - 1ST_CALL_PG_2025: 26.

Call-level UX simplification:

- User requested removing current designation from the main Members table and showing call levels as simple premium labels.
- Simplified the Members table to:
  - Member,
  - Status,
  - Call Level.
- Current designation/position remains stored and visible only in the collapsible stats panel.
- Simplified editable call-level options to:
  - Unassigned,
  - 1st Call,
  - 2nd Call,
  - 3rd Call,
  - 4th Call,
  - 5th Call.
- Normalized backend stored call-level values to:
  - `1ST_CALL`,
  - `2ND_CALL`,
  - `3RD_CALL`,
  - `4TH_CALL`,
  - `5TH_CALL`.
- Reran May 2026 unitwise prefill using simplified levels.
- Current simplified call-level audit:
  - 1ST_CALL: 26,
  - 2ND_CALL: 31,
  - 3RD_CALL: 65,
  - 4TH_CALL: 22,
  - 5TH_CALL: 15,
  - unassigned: 63.

Members table spacing and sorting:

- Adjusted Department Members table column widths:
  - Member: primary wide column,
  - Status: compact column,
  - Call Level: fixed control column.
- Removed wasted middle whitespace from the simplified roster table.
- Added clickable column-header sorting for:
  - Member,
  - Status,
  - Call Level.
- Clicking the same header toggles ascending/descending direction.
- Removed the separate sort dropdown because sorting now lives directly on the table columns.

Members premium responsive cleanup:

- User requested removing unnecessary visible action buttons and reducing wasted table width.
- Moved maintenance actions into a compact `Admin tools` disclosure.
- Kept the primary filter row focused on search, position filter, call-level filter, and clear.
- Tightened roster table columns:
  - Member: 50%,
  - Status: 18%,
  - Call Level: 32%.
- Added status pill/dot treatment.
- Added responsive card layout for member rows on narrow screens.
- Kept call-level editing available directly from both table and mobile card layouts.

Members command-panel compaction:

- User requested a more compact premium top area with mild compliant color for count boxes.
- Replaced the larger audit/card section plus duplicate metric cards with a compact roster command panel.
- Audit counts now render as small green-tinted chips:
  - visible,
  - members,
  - invalid,
  - duplicates,
  - unassigned calls.
- Filters and Admin tools now sit inside the same compact panel.
- Removed the separate large visible/dedupe/invalid metric cards from the Members screen.

Historical analysis dry-run rebuild:

- User requested a dry-run first before changing the main software Analysis section.
- Added a standalone backend dry-run service:
  - `backend/app/services/historical_analysis_dry_run.py`.
- The dry run scans:
  - 17 monthly rota files from Jan 2025 to May 2026,
  - 16 unitwise files,
  - current 222 canonical Department Members from the database,
  - reference dashboard data from `Plan/Data/CMC_Duty_Analysis_v5.html`.
- The dry run does not write to operational database tables.
- It writes audit files to:
  - `Plan/Data/analysis_rebuild/summary.json`,
  - `Plan/Data/analysis_rebuild/README.md`,
  - `Plan/Data/analysis_rebuild/matched_duties.csv`,
  - `Plan/Data/analysis_rebuild/matched_postings.csv`,
  - `Plan/Data/analysis_rebuild/skipped_names.csv`,
  - `Plan/Data/analysis_rebuild/parser_warnings.csv`,
  - `Plan/Data/analysis_rebuild/monthly_tallies.csv`,
  - `Plan/Data/analysis_rebuild/person_tallies.csv`,
  - `Plan/Data/analysis_rebuild/reference_month_comparison.csv`.
- Latest dry-run results:
  - canonical members: 222,
  - rota files: 17,
  - unitwise files: 16,
  - periods detected: Jan 2025 through May 2026,
  - raw rota assignments parsed: 14,274,
  - matched rota assignments: 9,020,
  - skipped rota assignments: 5,254,
  - unique matched duty members: 195,
  - matched 24-hour assignments: 5,865,
  - matched weekend 24-hour assignments: 1,660,
  - raw unitwise postings parsed: 3,187,
  - matched unitwise postings: 2,184,
  - skipped unitwise postings: 1,003,
  - unique matched posting members: 204.
- Reference HTML totals:
  - personnel: 328,
  - 24-hour duties: 7,973,
  - weekend duties: 2,309,
  - months: 17.
- Difference is expected because the new dry run imports only duties linked to current canonical Department Members and skips historical/unknown names.

Historical name-variant resolver pass:

- User asked whether variants can be fixed to canonical Department Members.
- Added stricter but more capable variant matching in `historical_analysis_dry_run.py`:
  - unique first-name variants,
  - ordered token variants,
  - first-name plus initials,
  - unique token matches where the token exists inside the canonical full name,
  - ambiguous ties remain skipped.
- Added `alias_suggestions.csv` to make proposed aliases reviewable before saving them into the database.
- Removed an unsafe broad-prefix rule after it mapped `Divyalakshmi` to `Divya J`; that name now remains skipped unless manually approved.
- Latest safer variant pass:
  - matched rota assignments: 11,438,
  - skipped rota assignments: 2,836,
  - unique matched duty members: 213,
  - matched 24-hour assignments: 7,457,
  - matched weekend 24-hour assignments: 2,145,
  - matched unitwise postings: 2,547,
  - skipped unitwise postings: 640.
- This is now close to the reference HTML 24-hour total of 7,973, while still excluding names that are not safely resolvable to one of the 222 canonical members.

Historical alias application:

- User approved proceeding with variant fixing.
- Removed the generic fuzzy matcher before applying aliases because preview showed unsafe proposals such as `Joseph A` resolving to `Jennifer A`.
- Kept only structured/safe match reasons for official aliases:
  - unique first-name,
  - ordered token variant,
  - first/last,
  - first-name plus last initial,
  - compact exact.
- Added official alias application CLI:
  - `python -m app.services.historical_analysis_dry_run --apply-alias-suggestions --alias-suggestions <csv>`.
- Applied safer alias suggestions to the database:
  - rows read: 753,
  - aliases created: 753,
  - conflicts: 0,
  - invalid aliases skipped: 0.
- Member audit after alias application:
  - members: 222,
  - aliases: 753,
  - invalid members: 0,
  - duplicate groups: 0,
  - status: clean.
- Dry-run after saved aliases:
  - matched rota assignments: 11,299,
  - skipped rota assignments: 2,975,
  - matched 24-hour assignments: 7,389,
  - matched weekend 24-hour assignments: 2,117,
  - matched unitwise postings: 2,388.
- Remaining skipped names are mostly not safely resolvable to exactly one current canonical Department Member and should be handled by manual review or a separate historical/alumni members layer.

Analysis import and manual review:

- User approved importing the cleaned historical data into the Analysis section while keeping unresolved names in Manual Review.
- Added matched-history import support to `historical_analysis_dry_run.py`:
  - imports matched duties to `RotaPeriod`, `DutySlot`, and `DutyAssignment`,
  - imports matched unitwise rows to `Unit` and `PersonPosting`,
  - uses only existing canonical Department Members,
  - skips `UNMAPPED` duty rows rather than polluting official analysis,
  - is idempotent on repeat runs.
- Imported cleaned historical analysis data locally:
  - periods created: 17,
  - units created: 8,
  - duty assignments imported: 11,299 initially,
  - then removed 80 `UNMAPPED` imported assignments/slots from official analysis,
  - final imported official assignment records: 11,219,
  - unitwise postings imported: 2,388.
- Current Analysis backend summary:
  - personnel rows: 218,
  - active personnel with counted 24-hour duties: 194,
  - total official assignment records: 11,219,
  - counted 24-hour duties, excluding CART and 5th call: 6,554,
  - weekend counted 24-hour duties: 1,879,
  - analysis months: 17.
- Analysis preflight after import:
  - status: ready,
  - invalid members: 0,
  - duplicate groups: 0,
  - unresolved duty mappings: 0,
  - unknown duty types: 0,
  - empty periods: 0.
- Added Manual Review API:
  - `/api/v1/analysis/manual-review`.
- Manual Review reads the dry-run review artifacts and reports:
  - skipped unresolved names,
  - ambiguous names,
  - parser warnings,
  - unmapped duty labels.
- Added a collapsible Manual Review subsection in the frontend Analysis page.
- Current Manual Review summary:
  - skipped rows: 3,774,
  - unique skipped-name groups: 590,
  - parser warnings: 180,
  - unmapped duty label warnings: 5.
- Verification:
  - `backend: pytest tests/test_analysis.py tests/test_members.py` passed.
  - `frontend: npm run build` passed after rerunning with Windows/Vite sandbox escalation.

Analysis rule reconciliation against guide/reference:

- User reported discrepancies between current Analysis and `CMC_Duty_Analysis_v5.html` and asked to reconfirm 24-hour rules from `CMC_Anaesthesia_Duty_Analysis_Guide.md`.
- Re-read the guide and confirmed:
  - main 24-hour total includes only MAIN/CB/RC 24-hour calls, CAESAR_B, SCHELL, and FLOATING,
  - FIFTH_CALL is 24-hour duration but excluded from main total,
  - CART is 24-hour duration but excluded from main total,
  - PAC, SHIFT, CAESAR_A, CB_CO_12HR, RC_12HR, RC_CO_12HR, CHAD, RUHSA, and NEURO_DEPT are excluded from main 24-hour total.
- Fixed parser date reconstruction to follow the guide:
  - when Excel date cells are bad/missing, reconstruct duty date from weekday row and occurrence in the month.
- Added PAC block override:
  - Main 1st/2nd rows after the Schell row are classified as PAC.
- Fixed analysis category counters:
  - CB_PAEDS no longer inflates CB 24-hour category totals,
  - RC_CO_12HR no longer inflates RC 24-hour category totals and is grouped with RC 12hr separate counts.
- Fixed dry-run reference comparison:
  - now compares current main 24-hour total to reference main 24-hour total, not all 24-hour-duration rows.
- Rebuilt dry-run outputs and reimported corrected official analysis data.
- Current corrected official Analysis summary:
  - official records: 11,271,
  - main counted 24-hour duties: 6,534,
  - weekend main counted 24-hour duties: 1,871,
  - analysis preflight: ready.
- Reference HTML comparison after rule correction:
  - reference main 24-hour duties: 7,973,
  - current canonical-member main 24-hour duties: 6,534,
  - gap: -1,439,
  - reference weekend 24-hour duties: 2,309,
  - current canonical-member weekend 24-hour duties: 1,871,
  - gap: -438.
- Conclusion:
  - remaining gap is primarily scope/name-policy driven, because the reference dashboard includes 328 personnel while the official current software analysis is restricted to the 222 canonical Department Members plus safe aliases.
  - To match the old HTML exactly, the app needs a separate historical/alumni member scope or explicit approval to include non-current historical names.
- Manual Review now exposes the reference comparison totals and month-by-month deltas inside the Analysis page.
- Verification:
  - backend `pytest tests` passed: 35 tests,
  - frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Rota Board UX Phase 1

Goal:

- Shift the main frontend away from a computer-admin/debug console and toward a rota-board working interface.
- Hide manual review, duplicate cleanup, alias review, import diagnostics, mapping controls, and raw admin machinery from rota board users.

Implemented:

- Added `Plan/11_rota_board_ux_plan.md` as the dedicated UX direction and phase tracker.
- Changed frontend shell branding from `Admin console` to `Rota board`.
- Board-facing navigation now shows:
  - Overview,
  - Duty Analysis,
  - Department Members,
  - coming-soon board tools.
- Admin-only navigation now appears under an `Admin tools` group for `computer_admin` and `superadmin`:
  - Mappings,
  - Historical Import,
  - Login Accounts,
  - Diagnostics.
- Overview now shows board-relevant duty metrics instead of mapping/import counts:
  - total 24hr duties,
  - weekend 24hr duties,
  - active personnel,
  - months analysed,
  - top total duty load,
  - top weekend duty load.
- Department Members now hides audit/cleanup/duplicate/reconciliation tools for rota board users.
- Department Members call-level control is read-only for rota board users and editable only for admin roles.
- Direct frontend access to hidden admin views redirects non-admin users back to Overview.
- Frontend historical import type was updated to match the cleaned historical-analysis import response shape.

Small correctness fixes found during verification:

- `call_level_from_posting()` now handles underscore/hyphen posting types such as `1ST_CALL`.
- Bare `Priyadarshini` is no longer swallowed by a broad exact alias and remains context-resolved.
- Bare `Joanna` maps to historical `Joanna`; `Joanna Emmanuel` remains a distinct full-name alias.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-08 - Rota Generator Phase 11 QA Sweep

Goal:

- Debug and harden the rota workflow after the feature phases, with a focus on build health, backend correctness, migration state, and documented acceptance checks before real-data walkthroughs.

Fixed:

- Cleaned up accumulated backend Ruff failures from older historical-analysis code.
- Removed an unused manual-review source read in `backend/app/services/analysis.py`.
- Removed duplicate historical name-alias keys in `backend/app/services/historical_analysis_dry_run.py`, preserving the effective runtime values Python was already using.

Verification:

- Backend Ruff passed across the full backend package: `ruff check --no-cache .`.
- Full backend test suite passed: `pytest`, 89 tests.
- Local database migration state is current at Alembic head `20260508_0012`.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.
- Running frontend responded locally with HTTP 200 at `http://127.0.0.1:5173`.

Notes:

- Pytest still reports cache write warnings because `.pytest_cache` is permission-restricted in the local environment; the tests themselves pass.
- Browser-level visual QA remains a manual/user-acceptance step because the project does not yet include automated browser screenshot tests.
- The next real debug pass should use actual monthly leave sheets, actual department member data, and a full month setup through publish/export.

## 2026-05-08 - Rota Generator Phase 9

Goal:

- Give the rota board a review surface for warnings, overrides, workload, and exchange approvals before the rota moves toward publish/export.

Implemented:

- Added `RotaExchangeRequest` audit model and Alembic migration:
  - `backend/alembic/versions/20260508_0011_rota_review_exchange.py`.
- Added `backend/app/services/rota_review.py`.
- Review dashboard now combines:
  - generated rota slots,
  - safety status,
  - candidate suggestions,
  - saved assignments,
  - override reasons,
  - person-wise monthly duty load,
  - exchange request audit rows.
- Added API routes:
  - `GET /api/v1/rota-review/month`,
  - `POST /api/v1/rota-review/exchanges`,
  - `POST /api/v1/rota-review/exchanges/{exchange_id}/approve`,
  - `POST /api/v1/rota-review/exchanges/{exchange_id}/reject`.
- Exchange requests record:
  - original assignment,
  - target member,
  - requester,
  - approver/rejector,
  - request and decision reasons,
  - validation snapshot,
  - applied assignment ID after approval.
- Approved exchanges reuse the validated assignment workflow and save assignments with source `exchange_approved`.
- Added frontend API types/functions for Rota Review.
- Added the `Rota Review` navigation view with:
  - review and safety metrics,
  - warnings/open-slots table,
  - person-wise duty-load table,
  - exchange request form,
  - approve/reject controls for pending exchange requests.
- Applied local database migration to Alembic head `20260508_0011`.
- Added focused tests in `backend/tests/test_rota_review.py`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Focused review tests passed: `pytest tests/test_rota_review.py`, 3 tests.
- Rota-focused backend suite passed: assignment, auto-fill, candidates, review, safety, and template tests, 17 tests.
- Full backend test suite passed: `pytest`, 86 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 9 now creates traceable board corrections and approved exchanges, but final publish locking/export remains Phase 10.

## 2026-05-08 - Rota Generator Phase 10

Goal:

- Add final publish approval and export so the rota board can produce a defensible Excel output from the reviewed rota.

Implemented:

- Added `RotaPublishApproval` audit model and Alembic migration:
  - `backend/alembic/versions/20260508_0012_rota_publish_approvals.py`.
- Added `backend/app/services/rota_publish.py`.
- Publish checklist now blocks final approval when:
  - monthly unit scope is not locked,
  - no generated slots exist,
  - slots remain open,
  - hard safety blockers remain,
  - exchange requests are still pending.
- Publish checklist allows warnings and override assignments only when the board confirms them.
- Publishing records:
  - approver,
  - approval note,
  - warning confirmation,
  - checklist snapshot,
  - rule version metadata,
  - publish timestamp.
- Publishing marks the rota period status as `published`.
- Added final Excel export after publish with workbook sheets:
  - Summary,
  - Final Rota,
  - Duty Counts,
  - Unit Safety,
  - Review Items,
  - Leave Safety Conflicts,
  - Exchange Audit.
- Added API routes:
  - `GET /api/v1/rota-publish/month`,
  - `POST /api/v1/rota-publish/publish`,
  - `GET /api/v1/rota-publish/export`.
- Added frontend API types/functions for publish and Excel download.
- Added the `Publish & Export` navigation view with:
  - publish readiness metrics,
  - clear checks,
  - blockers,
  - warnings,
  - approval note and warning confirmation,
  - final Excel download.
- Applied local database migration to Alembic head `20260508_0012`.
- Added focused tests in `backend/tests/test_rota_publish.py`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Focused publish tests passed: `pytest tests/test_rota_publish.py`, 3 tests.
- Rota-focused backend suite passed: publish, review, assignment, auto-fill, candidates, safety, and template tests, 20 tests.
- Full backend test suite passed: `pytest`, 89 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 10 creates a publishable/exportable rota, but visual QA, workflow debugging, and edge-case hardening remain intentionally deferred to Phase 11.

- Backend `pytest -q` passed: 50 tests.

## 2026-05-07 - Rota Board UX Phase 2

Goal:

- Polish the board-facing frontend so it reads as a rota-board workload review tool, not an admin/debug console.

Implemented:

- Added a stronger Overview hierarchy with a workload summary header, period label, and direct actions for Duty Analysis and Department Members.
- Added board insight cards for highest total duty load, highest weekend duty load, and active personnel coverage.
- Highlighted key board metrics:
  - total 24hr duties,
  - weekend 24hr duties,
  - weekend share,
  - average 24hr duties per active person.
- Renamed Analysis tabs to board-facing labels:
  - Board Summary,
  - People,
  - Weekend Load,
  - Duty Mix,
  - CART / Schell,
  - PAC / Shifts,
  - Call Changes.
- Renamed overview analysis headings and `Total records` wording to `Assignments reviewed`.
- Grouped individual person popup metrics into:
  - Duty Load,
  - Campus Calls,
  - Special Duties.
- Department Members now shows active, historical, and call-level summary chips for board users.
- Renamed Department Members position disclosure to `Position Mix`.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Rota Board UX Phase 3

Goal:

- Convert the board-facing frontend to work cleanly on phone and tablet widths.

Implemented:

- Added mobile card fallbacks for wide Analysis tables in:
  - Weekend Load,
  - Duty Mix,
  - CART / Schell,
  - 5th Call,
  - PAC / Shifts,
  - Postings,
  - Call Changes.
- Preserved the richer desktop table views while hiding them on mobile where card fallbacks exist.
- Made the individual person popup behave like a full-screen mobile sheet.
- Improved mobile analysis tabs with larger touch targets and horizontal snap scrolling.
- Added a mobile-only bottom navigation bar for Overview, Analysis, and Members.
- Synced active state between sidebar navigation and mobile bottom navigation.
- Improved mobile analysis search, count wrapping, card row wrapping, and long text overflow handling.
- Reduced mobile chart height and bar width so graphs fit smaller screens better.
- Improved mobile topbar/member/filter layouts for touch use.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Leave Management Engine Planning

Goal:

- Convert the rough leave-management note into a 360-degree planning document before implementation.

Created:

- `Plan/leave management engine/01_leave_management_engine_planning_report.md`
- `Plan/leave management engine/02_leave_engine_reference_notes.md`

Planning decisions recommended:

- Use CSV as the official upload template.
- Support XLSX as a convenience upload converted into the same internal row schema.
- Map leave only to canonical Department Members.
- Keep manual leave entry/editing selector-based, not free text.
- Treat approved leave as a hard rota conflict.
- Treat pending/requested leave as a warning unless the department decides otherwise.
- Build unit-wise and call-level leave pressure dashboards.
- Keep entitlement/balance calculation out of MVP unless explicitly requested.

Implementation recommendation:

- Start with manual leave API and calendar storage first.
- Add import preview after the core leave model works.
- Integrate with rota generation only after leave conflicts and daily blocks are reliable.

## 2026-05-07 - Leave Engine First Layer

Goal:

- Build the first usable leave-management layer before final leave slot/call-level slot rules are provided.

Implemented:

- Added `Plan/leave management engine/03_leave_engine_first_layer_action_plan.md`.
- Extended `LeaveRequest` with:
  - `leave_slot`,
  - `raw_person_name`,
  - `updated_at`.
- Added Alembic migration:
  - `backend/alembic/versions/20260507_0007_leave_first_layer.py`.
- Added leave service helpers for:
  - month bounds,
  - inclusive leave-day counting,
  - month overlap filtering,
  - daily leave calendar entries,
  - monthly leave summary,
  - unit/call-level context lookup.
- Added authenticated leave API routes:
  - `GET /api/v1/leave/requests`,
  - `POST /api/v1/leave/requests`,
  - `PUT /api/v1/leave/requests/{leave_id}`,
  - `POST /api/v1/leave/requests/{leave_id}/cancel`,
  - `GET /api/v1/leave/calendar`.
- Added frontend leave API types and functions.
- Added board-facing `Leave` navigation in sidebar and mobile bottom nav.
- Added first Leave screen with:
  - month selector,
  - summary metrics,
  - call-level/unit breakdown,
  - manual leave form using Department Member dropdown,
  - month calendar pressure cards,
  - leave list and mobile cards,
  - cancel action.
- Kept leave entry selector-based; no free-text member creation in the board UI.
- Fixed the historical name-resolution regression where bare `Joanna` must map to historical `Joanna`, not `Joanna Emmanuel`.

Verification:

- Backend `pytest -q` passed: 52 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Follow-up migration deployment work:

- Applied local database migration to Alembic head `20260507_0007`.
- Updated backend Docker image build to include:
  - `alembic.ini`,
  - `backend/alembic`,
  - `backend/docker-entrypoint.sh`.
- Added Docker entrypoint that runs `alembic upgrade head` before starting Uvicorn.
- This makes fresh Docker deployments auto-apply database migrations when the backend container starts.
- Re-verified backend tests after migration deployment change: `pytest -q` passed, 52 tests.

Leave section runtime fix:

- Fixed a frontend calendar crash caused by local-time date arithmetic rolling ISO dates backward in UTC.
- `addDaysIso()` now uses UTC-safe date math.
- Leave calendar day labels now render with UTC date formatting to avoid timezone date shifts.
- Verification:
  - frontend `npm run build` passed,
  - backend `pytest tests/test_leave.py -q` passed.

## 2026-05-07 - Unit Management Planning

Goal:

- Plan the Unit Management system before implementation, because it must drive leave-aware and elective-staffing-aware rota slot generation.

Created:

- `Plan/unit management engine/01_unit_management_interface_and_workflow_plan.md`
- `Plan/unit management engine/02_unit_management_first_layer_action_plan.md`

Planning direction:

- Unit Management should assign Department Members to monthly units by call level/posting type.
- It should use existing `Unit` and `PersonPosting` models as the foundation.
- It should calculate daily unit availability from:
  - monthly unit assignments,
  - leave requests,
  - duty assignments,
  - future post-duty/rest rules.
- First implementation layer should be manual assignment board plus basic validation.
- Final rota-generator slot adjustment should wait until unit staffing thresholds and duty-to-elective blocking rules are confirmed.

## 2026-05-07 - Unit Management First Layer

Implemented:

- Added `backend/app/services/unit_management.py` for:
  - active units,
  - monthly unit assignment lookup,
  - posting type normalization,
  - leave-aware unit summaries,
  - basic monthly assignment validation.
- Added authenticated Unit Management API routes:
  - `GET /api/v1/units`,
  - `GET /api/v1/unit-management/month`,
  - `POST /api/v1/unit-management/assignments`,
  - `PUT /api/v1/unit-management/assignments/{assignment_id}`,
  - `DELETE /api/v1/unit-management/assignments/{assignment_id}`.
- Added frontend Unit Management section with:
  - month selector,
  - assignment metrics,
  - validation panel,
  - add/edit assignment form,
  - unit/call-level grouped member cards,
  - assignment table for desktop,
  - responsive mobile cards.
- Fixed mobile bottom nav layout to support all five board sections.
- Kept the workflow Department Member based; no alias/debug review UI is exposed on the rota-board screen.
- Added `backend/tests/test_unit_management.py`.

Verification:

- Backend `pytest -q` passed: 54 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Unit Management Phase 2

User clarification:

- The Unit Management board must start fresh for a month and should not show already-imported/historical unitwise assignments.
- Assignments added by the rota team should still be recorded and reloadable.
- Unit cards should open a popup where members can be added, removed, edited, or moved to another unit.
- Validation warnings should be collapsible instead of taking over vertical page space.

Implemented:

- Unit Management now filters monthly assignments to `PersonPosting.source == "unit_board"`.
- New Unit Management assignments are saved with `source = "unit_board"`.
- Historical/imported postings remain available for other analysis/import flows but no longer populate the Unit Management board.
- Unit cards now open a unit-specific popup.
- The popup includes:
  - leave-aware unit summary,
  - collapsible unit validation,
  - editable assignment rows,
  - add-member form,
  - remove action,
  - unit move control.
- Replaced the page-level add/edit workflow with popup-based unit editing.
- Made the main validation section collapsible.
- Added test coverage to confirm historical/imported postings are ignored by Unit Management.

Verification:

- Backend `pytest tests/test_unit_management.py -q` passed.
- Backend `pytest -q` passed: 54 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Rota Generator Phase Plan And Phase 1

Goal:

- Record the rota generator phase action plan and start Phase 1 implementation.
- Phase 1 should create a flexible rule foundation before monthly unit scope, leave-aware slot generation, and assignment logic are built.

Planning:

- Added `Plan/Rota generator/03_phase_action_plan.md`.
- The plan divides the rota generator into 10 phases:
  - rule foundation,
  - monthly rota period and unit scope,
  - leave import and leave pressure,
  - leave-aware empty slot template generation,
  - availability and unit safety,
  - manual assignment with validation,
  - candidate suggestions,
  - safe auto-fill,
  - review/override/exchange,
  - publish/export.

Implemented Phase 1:

- Added `backend/app/services/rota_rules.py`.
- Added default Phase 1 rota rule bundle from the confirmed duty dictionary.
- Stored the rule bundle through existing `RuleVersion` and `RuleSetting` tables under key `rota_generator.phase1`.
- Added configurable duty fields:
  - label,
  - group,
  - duration,
  - 24-hour and main-count flags,
  - mandatory/adjustable flags,
  - same-day and next-day elective blocking flags,
  - active flag,
  - allowed call-level placeholders.
- Added default guardrails:
  - 24-hour minimum rest gap after 24-hour duty,
  - post-24hr next-day elective blocking,
  - 30 percent warning threshold,
  - 40 percent hard block threshold,
  - minimum available unit count.
- Added admin API:
  - `GET /api/v1/admin/rota-rules/phase-one`,
  - `PUT /api/v1/admin/rota-rules/phase-one`.
- Added frontend API types and functions for Phase 1 rules.
- Added admin-only `Rota Rules` navigation entry.
- Added frontend `Rota Rules` screen for editing:
  - rest hours,
  - unit staffing thresholds,
  - monthly duty limit placeholders,
  - duty dictionary labels/groups/durations,
  - mandatory/adjustable/elective-blocking/active flags,
  - allowed call-level CSV.
- Added focused backend tests in `backend/tests/test_rota_rules.py`.

Verification:

- Backend focused tests passed: `pytest tests/test_rota_rules.py -q`.
- Backend full test suite passed: `pytest -q`, 57 tests.
- Ruff passed for new backend files with `--no-cache`.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- No new database table was added for Phase 1. The first rule bundle uses the already existing versioned rule storage so the structure can evolve safely after rota-board feedback.

## 2026-05-07 - Rota Generator Phase 2

User decision:

- Broad debugging, older lint cleanup, visual QA, and hardening should be handled in Phase 11.
- The forward build should continue through the rota-generator phases first.

Planning:

- Updated `Plan/Rota generator/03_phase_action_plan.md` to add Phase 11: Debugging, QA, And Hardening.

Implemented Phase 2:

- Added monthly generation scope database models:
  - `MonthlyGenerationScope`,
  - `MonthlyGenerationScopeUnit`.
- Added Alembic migration:
  - `backend/alembic/versions/20260507_0008_monthly_generation_scope.py`.
- Added `backend/app/services/rota_setup.py` for:
  - creating/getting a monthly rota period,
  - creating/getting a monthly generation scope,
  - including/excluding units for a month,
  - locking/unlocking the unit scope with reason support,
  - cloning the previous month's unit scope,
  - unit readiness summary based on Unit Management assignments and leave pressure.
- Added API routes:
  - `GET /api/v1/rota-setup/month`,
  - `PUT /api/v1/rota-setup/month/scope`,
  - `POST /api/v1/rota-setup/month/clone-previous`.
- Added frontend API types/functions for monthly rota setup.
- Added board-facing `Rota Setup` navigation item.
- Added Rota Setup screen with:
  - month selector,
  - included/excluded/unselected unit control,
  - clone previous month action,
  - lock scope checkbox,
  - lock/unlock reason,
  - excluded-units-in-safety toggle,
  - readiness table with assigned members, call mix, leave pressure, and warnings.
- Added backend tests in `backend/tests/test_rota_setup.py`.
- Applied local database migration to Alembic head `20260507_0008`.

Verification:

- Focused backend tests passed: `pytest tests/test_rota_setup.py tests/test_rota_rules.py -q`, 6 tests.
- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest -q`, 60 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - Rota Generator Phase 3

Goal:

- Add leave import preview and generator-facing leave pressure data before leave-aware slot generation begins.

Implemented Phase 3:

- Added `backend/app/services/leave_import.py`.
- Leave import preview supports CSV/XLS/XLSX files.
- Preview recognizes common column names:
  - name/person/doctor/member,
  - start/from/date,
  - end/to,
  - type/category,
  - slot/session,
  - status,
  - notes/reason/remarks.
- Preview matches names against canonical Department Members and saved aliases.
- Preview reports:
  - matched rows,
  - unresolved rows,
  - invalid rows,
  - parsed start/end dates,
  - leave type/slot/status,
  - row-level issues.
- Added generator-facing leave pressure calculation in `backend/app/services/leave.py`.
- Leave pressure exposes:
  - daily total leave pressure,
  - blocking approved-leave count,
  - unit totals,
  - call-level totals,
  - per-day blocker rows for the future generator.
- Added API routes:
  - `POST /api/v1/leave/import-preview`,
  - `GET /api/v1/leave/pressure`.
- Added frontend API types/functions for leave import preview and pressure.
- Updated Leave screen:
  - import-preview upload panel,
  - matched/unresolved/invalid preview table,
  - generator leave pressure panel,
  - busiest leave-pressure days.
- Added tests for:
  - leave pressure blockers,
  - import preview matching,
  - upload preview API.

Verification:

- Focused backend tests passed: `pytest tests/test_leave.py -q`, 5 tests.
- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest -q`, 63 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 3 intentionally previews imported leave but does not yet commit imported rows in bulk. The commit/apply workflow should come after the rota board approves the exact leave import template and review behavior.

## 2026-05-07 - Rota Generator Phase 3B

Goal:

- Upgrade the leave parser before Phase 4 because the real department leave workbook uses a wide date-column format, not only a simple table.

Evidence:

- Inspected `Plan/Data/MAY 2026 LEAVE DETAILS.xlsx`.
- The workbook has multiple sheets (`MAY 26`, `MAY 2026`).
- It stores dates across columns with names under each date, split across the month.
- This requires a wide-calendar parser in addition to simple CSV/XLSX table parsing.

Planning:

- Added Phase 3B to `Plan/Rota generator/03_phase_action_plan.md`.

Implemented:

- Upgraded `backend/app/services/leave_import.py`:
  - multi-sheet Excel parsing,
  - table-header auto-detection,
  - wide date-column calendar detection,
  - weekday/noise row filtering,
  - name extraction under date columns,
  - consecutive date compression into leave ranges,
  - source sheet and source format metadata,
  - parser warnings per sheet,
  - duplicate leave-row detection.
- Extended leave import preview API response with:
  - `sheets`,
  - `source_formats`,
  - `parser_warnings`,
  - row-level `sheet_name`,
  - row-level `source_format`,
  - row-level `confidence`.
- Updated frontend preview table to show source sheet, parser format, confidence, and parser warnings.
- Added test coverage for wide calendar-style Excel parsing.

Verification:

- Focused leave tests passed: `pytest tests/test_leave.py -q`, 6 tests.
- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest -q`, 64 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- The parser is still preview-only. Bulk apply/import should be added only after the rota board confirms how unresolved and duplicate rows should be handled.

## 2026-05-07 - Rota Generator Phase 3C

Goal:

- Turn the advanced leave parser into a safe apply workflow that updates the monthly Leave calendar from confidently matched CSV/XLS/XLSX rows.

Learning/reference pass:

- Reviewed official pandas CSV/Excel docs for file-like inputs, multi-sheet Excel handling, and header-less reads.
- Reviewed openpyxl workbook loading and merged-cell behavior.
- Reviewed Python `difflib.SequenceMatcher` for conservative near-match suggestions.

Implemented:

- Added Phase 3C to `Plan/Rota generator/03_phase_action_plan.md`.
- Upgraded name cleaning in `backend/app/services/leave_import.py`:
  - strips common titles such as Dr/Prof,
  - normalizes punctuation and spacing,
  - removes slot markers from name cells,
  - preserves raw names for audit.
- Strengthened name matching:
  - automatic import only uses canonical Department Member or alias exact normalized matches,
  - uncertain near matches are shown as suggestions but are not auto-imported.
- Added slot parsing:
  - explicit slot columns,
  - AM/PM/FN/AN/NIGHT/FULL DAY values,
  - parenthesized/suffixed name-cell markers such as `Name (AM)`.
- Added XLSX merged-cell support using openpyxl so wide leave workbooks can be read more reliably.
- Added duplicate detection:
  - duplicate rows inside the uploaded file,
  - existing matching leave already stored in the database.
- Added `apply_leave_import()` service:
  - creates `LeaveRequest` rows only for safe matched preview rows,
  - skips unresolved/invalid/duplicate/uncertain rows,
  - stores import source and raw person name.
- Added API route:
  - `POST /api/v1/leave/import-apply`.
- Added frontend API function:
  - `applyLeaveImport()`.
- Added Leave screen action:
  - `Apply Matched Rows` after preview.
- After apply, the monthly leave calendar and pressure panels reload from saved leave records.
- Added tests for:
  - slot extraction from name cells,
  - wide-calendar Excel parsing,
  - safe apply service,
  - apply API updating the calendar.

Real-file smoke test:

- Ran the parser against `Plan/Data/MAY 2026 LEAVE DETAILS.xlsx`.
- Result:
  - total rows: 177,
  - matched rows: 151,
  - unresolved rows: 26,
  - invalid rows: 0,
  - sheets detected: `MAY 26`, `MAY 2026`,
  - source format: `wide_calendar`,
  - parser warnings: none.

Verification:

- Focused leave tests passed: `pytest tests/test_leave.py -q`, 9 tests.
- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest -q`, 67 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- The apply workflow intentionally imports only safe exact/alias matches. Suggested fuzzy matches remain review-only to protect the rota calendar from wrong-person leave records.

## 2026-05-07 - Phase 3C Parser Tightening

Goal:

- Reduce noisy leave-import rows and make name/slot extraction more precise before calendar updates.

Implemented:

- Hardened CSV reading with delimiter sniffing and encoding fallbacks.
- Added Unicode and hidden-character cleanup for Excel/CSV cells.
- Expanded accepted name/date/type/slot column aliases.
- Expanded slot normalization for first-half/second-half/session-style values.
- Added leave-type normalization for common leave codes such as AL, CL, EL, SL, ML, LOP, and LWP.
- Added stricter noise filters for repeated headers, summary rows, weekdays, months, NIL/no-leave cells, leave-code-only cells, dates, and numeric-only cells.
- Improved name cleanup:
  - strips row numbers and list markers,
  - removes bracketed slot/status/leave-code annotations,
  - removes trailing leave annotations such as `Casual Leave`, `CL`, `Approved`,
  - keeps raw imported text for audit.
- Improved fuzzy suggestion scoring so multiple aliases for the same person do not suppress a good suggestion.
- Added ambiguity protection for normalized keys shared by more than one department member.
- Improved wide-calendar grouping so adjacent days still group when one cell has harmless annotations.

Verification:

- Focused leave tests passed: `pytest tests/test_leave.py`, 11 tests.
- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest`, 69 tests.
- Real May workbook smoke test now drops header/event noise:
  - total rows: 170,
  - matched rows: 151,
  - unresolved rows: 19,
  - invalid rows: 0,
  - parser warnings: none.

Notes:

- The stricter parser still only auto-applies rows with exact canonical/alias matches and no issues. Noisy, ambiguous, duplicate, or suggested-only rows remain review-only.

## 2026-05-07 - Rota Generator Phase 4

Goal:

- Generate the leave-aware empty monthly duty-slot template after monthly units and leave pressure are known.

Implemented:

- Added template generation audit models:
  - `RotaTemplateGenerationRun`,
  - `RotaTemplateGenerationEvent`.
- Added generated-slot metadata on `DutySlot`:
  - `template_status`,
  - `template_reason`,
  - `generation_run_id`.
- Added Alembic migration:
  - `backend/alembic/versions/20260507_0009_rota_template_generation.py`.
- Added `backend/app/services/rota_template.py`:
  - uses the locked monthly unit scope,
  - generates slots only for included units,
  - defaults to active mandatory duty rules,
  - allows selected duty keys for the template editor,
  - checks active leave pressure per unit/date before creating a slot,
  - creates normal `ready` slots for safe dates,
  - creates `needs_review` slots for mandatory duties under warning/hard pressure,
  - skips unsafe adjustable slots and records a blocked event,
  - records explanations for created, skipped, and blocked decisions.
- Added API routes:
  - `GET /api/v1/rota-template/month`,
  - `POST /api/v1/rota-template/generate`.
- Added frontend API types/functions for Rota Template.
- Added board-facing `Rota Template` screen with:
  - month selector,
  - included-unit summary,
  - date-window controls,
  - weekday/weekend toggles,
  - replace-existing-generated-slots toggle,
  - duty template checklist,
  - generated empty slots table,
  - latest generation decision log.
- Added tests in `backend/tests/test_rota_template.py`.
- Applied local database migration to Alembic head `20260507_0009`.

Verification:

- Focused Phase 4 tests passed: `pytest tests/test_rota_template.py`, 3 tests.
- Full backend test suite passed: `pytest`, 72 tests.
- New-code Ruff passed with `--no-cache`.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 4 still generates empty slots only. Person assignment, unit availability recalculation after assignment, and candidate ranking remain Phase 5 onward.

## 2026-05-07 - Leave Calendar Day Popup

Goal:

- Make each leave-management calendar day open a detailed popup showing who requested leave on that date, grouped by department call level.

Implemented:

- Converted leave calendar day cards into accessible clickable controls.
- Added a leave-day modal in `frontend/src/main.ts`.
- Grouped day entries by `call_level` from Department Member data.
- Each person row shows:
  - member name,
  - matched unit/posting,
  - leave type,
  - leave slot,
  - leave status.
- Added modal close support through close button, backdrop click, and Escape.
- Added frontend styles for the call-wise leave popup.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-07 - UX Wording And Statistic Help

Goal:

- Remove confusing internal code-style wording from user-facing leave screens and add brief hover explanations for statistic titles.

Implemented:

- Added reusable statistic label and `?` help icon helpers in `frontend/src/main.ts`.
- Added hover descriptions to the main metric cards across:
  - Overview,
  - Duty Analysis,
  - Historical Import,
  - Leave,
  - Unit Management,
  - Rota Rules,
  - Rota Setup,
  - Rota Template,
  - Diagnostics.
- Cleaned leave-day popup labels:
  - `imported_pending_review` now displays as `Imported, Pending Review`,
  - call/posting values display as readable call levels,
  - unit names display in normal user-facing casing.
- Cleaned leave import preview labels for match status/source/method.
- Added CSS for compact `?` help icons without disrupting metric/card layout.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## 2026-05-08 - Rota Generator Phase 5

Goal:

- Add the availability and unit safety engine so every generated slot can show staffing impact before a person is assigned.

Implemented:

- Added `backend/app/services/rota_safety.py`.
- Safety checks now calculate each slot's eligible unit/call-level pool from Unit Management postings.
- The safety engine subtracts:
  - approved leave that overlaps the duty timing,
  - same-day blocking duty assignments,
  - previous-day 24-hour duty rest blockers.
- Review-pending/imported leave is shown as `Needs Review` without removing the person from the available pool.
- Phase 1 unit staffing thresholds drive `Safe`, `Needs Review`, and `Hard Blocked` statuses.
- Added unit-day safety summaries with slot counts and minimum available eligible members.
- Added API route:
  - `GET /api/v1/rota-safety/month`.
- Added frontend API types/functions for Rota Safety.
- Updated the Rota Template screen with:
  - safety metric cards,
  - per unit/day safety table,
  - per-slot safety column beside template status,
  - readable `Safe`, `Needs Review`, and `Hard Blocked` labels.
- Added focused backend tests in `backend/tests/test_rota_safety.py`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Full backend test suite passed: `pytest`, 75 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 5 is calculation and visibility only. Phase 6 should connect the same engine to manual assign/replace/clear actions so validation and safety refresh happen immediately after each assignment.

## 2026-05-08 - Rota Generator Phase 6

Goal:

- Let the rota board manually build assignments into generated slots while enforcing leave, rest, call-level, count-limit, and staffing safety checks.

Implemented:

- Added `backend/app/services/rota_assignment.py`.
- Added manual assignment API routes:
  - `POST /api/v1/rota-assignments/slots/{slot_id}/assign`,
  - `DELETE /api/v1/rota-assignments/assignments/{assignment_id}`.
- Manual assignment supports:
  - assigning an open slot,
  - replacing an existing slot assignment,
  - clearing a saved assignment.
- Validation now checks:
  - approved leave conflicts,
  - review-pending/imported leave warnings,
  - same-day blocking duty conflicts,
  - previous-day 24-hour rest blockers,
  - active unit membership for the slot date,
  - call-level eligibility,
  - monthly 24-hour/weekend/group/campus duty count limits when configured,
  - unit staffing safety status from the Phase 5 engine.
- Assignments with warning/error validation issues require an override reason before saving.
- Updated safety calculation so the assignment already saved on the same slot does not incorrectly block that slot's own safety display.
- Extended Rota Template slot responses with saved assignments.
- Added frontend API types/functions for assign/clear.
- Updated the Rota Template generated slots table with:
  - current assigned member display,
  - assign/replace member selector,
  - override reason field,
  - clear assignment action,
  - assigned/open slot summary metrics.
- Improved frontend API error handling so validation messages from the backend are shown to the user.
- Added focused backend tests in `backend/tests/test_rota_assignment.py`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Focused assignment/safety tests passed: `pytest tests/test_rota_assignment.py tests/test_rota_safety.py`, 7 tests.
- Full backend test suite passed: `pytest`, 79 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 6 uses safety candidates from Unit Management. Phase 7 should turn these candidate pools into ranked, explainable suggestions using fairness and duty burden scoring.

## 2026-05-08 - Rota Generator Phase 7

Goal:

- Add ranked, explainable candidate suggestions so the rota board can quickly choose sensible people for each generated slot before auto-fill exists.

Implemented:

- Added `backend/app/services/rota_candidates.py`.
- Added candidate API routes:
  - `GET /api/v1/rota-candidates/slots/{slot_id}`,
  - `GET /api/v1/rota-candidates/month`.
- Candidate pools now separate:
  - eligible candidates,
  - candidates needing review,
  - blocked candidates.
- Candidate ranking now scores:
  - person-specific safety status,
  - total current monthly duty burden,
  - 24-hour burden,
  - weekend 24-hour burden,
  - same duty group burden,
  - same campus burden,
  - nearest rest gap,
  - staffing pressure,
  - override/validation state,
  - fairness against current assigned-member average.
- Every candidate returns plain-language reasons explaining load, blockers, rest gap, fairness, and validation issues.
- Added frontend API types/functions for Rota Candidate Suggestions.
- Updated the Rota Template screen with:
  - candidate summary metrics,
  - top candidate suggestion cards per slot,
  - `Use` action for safe suggestions,
  - `Review` action that selects a risky candidate into the manual assignment controls,
  - `Reject` action that hides a suggestion for the current session.
- Added focused backend tests in `backend/tests/test_rota_candidates.py`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Focused candidate/assignment/safety tests passed: `pytest tests/test_rota_candidates.py tests/test_rota_assignment.py tests/test_rota_safety.py`, 9 tests.
- Full backend test suite passed: `pytest`, 81 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 7 suggestions are advisory and still save through the Phase 6 validated assignment endpoint. Phase 8 should use these rankings to safely auto-fill only low-risk empty slots.

## 2026-05-08 - Rota Generator Phase 8

Goal:

- Create a first draft rota by automatically filling only slots with safe, clear, top-ranked candidates while leaving every risky slot open for board review.

Implemented:

- Added auto-fill audit models:
  - `RotaAutoFillRun`,
  - `RotaAutoFillEvent`.
- Added Alembic migration:
  - `backend/alembic/versions/20260508_0010_rota_auto_fill.py`.
- Added `backend/app/services/rota_auto_fill.py`.
- Safe auto-fill now:
  - scans generated duty slots,
  - skips slots that already have an active assignment,
  - gets ranked candidates from the Phase 7 engine,
  - assigns only candidates with `eligible` status, clear validation, and no override requirement,
  - leaves review-needed or blocked slots open,
  - records an event for each assigned, skipped, or blocked decision.
- Auto-filled assignments use source `safe_auto_fill_draft`.
- Auto-fill audit event links use `ON DELETE SET NULL` so later clearing assignments or regenerating slots does not break historical reports.
- Added API routes:
  - `GET /api/v1/rota-auto-fill/month`,
  - `POST /api/v1/rota-auto-fill/draft`.
- Added frontend API types/functions for safe auto-fill.
- Updated the Rota Template screen with:
  - `Safe Auto-Fill` action,
  - auto-fill result toast,
  - latest auto-fill summary metrics,
  - latest auto-fill decision report table.
- Added focused backend tests in `backend/tests/test_rota_auto_fill.py`.
- Applied local database migration to Alembic head `20260508_0010`.

Verification:

- New-code Ruff passed with `--no-cache`.
- Focused auto-fill/candidate/assignment/safety tests passed: `pytest tests/test_rota_auto_fill.py tests/test_rota_candidates.py tests/test_rota_assignment.py tests/test_rota_safety.py`, 11 tests.
- Full backend test suite passed: `pytest`, 83 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

Notes:

- Phase 8 deliberately does not fill any slot that needs an override. Phase 9 should provide a review dashboard for those remaining warnings/errors and board corrections.

## 2026-05-08 - Rota Template Calendar UX Refinement

Goal:

- Make generated rota slots and saved assignments easier for users to review by showing them in a calendar-style interface similar to Leave Management.

Implemented:

- Replaced the main generated-slot table on the Rota Template screen with a clickable rota calendar.
- Each day card now shows assigned slots versus total generated slots.
- Day cards use visual states for open, assigned, review-needed, and hard-blocked rota days.
- Added a rota day popup with:
  - slot totals,
  - assigned and open counts,
  - safety counts,
  - unit-grouped slot cards,
  - current assigned member,
  - safety details,
  - suggested members,
  - manual assignment controls.
- Rota day popups close on backdrop click, close button, Escape, or after assignment changes refresh the template.

Verification:

- Frontend `npm run build` passed after Windows/Vite sandbox escalation.
