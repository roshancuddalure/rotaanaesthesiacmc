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
