# Duty Rota Software — Developer Handbook

CMC Vellore, Department of Anaesthesia — rota board web application.

| | |
|---|---|
| Handbook version | 1.0 (inspection of commit `a231ddf`, 17 Oct 2026) |
| Audience | Developers taking over maintenance and development |
| Companion document | [`INSPECTION_REPORT_2026-10.md`](INSPECTION_REPORT_2026-10.md) — all known bugs and risks, with IDs (S1, B2, P1, ...) that are referenced here and in code comments |
| End-user guide | [`Plan/Website complete user guide.md`](../Plan/Website%20complete%20user%20guide.md) |

> **Read first:** the inspection found critical security problems (public repository containing
> credentials and a database dump, unauthenticated destructive endpoints, and a password-reset flow
> that lets anyone take over any account). Fix the items under "Immediate actions" in the
> inspection report before you add features.

---

## Contents

1. [What the system does](#1-what-the-system-does)
2. [Quick start](#2-quick-start)
3. [Repository layout](#3-repository-layout)
4. [Architecture](#4-architecture)
5. [Domain glossary](#5-domain-glossary)
6. [Data model](#6-data-model)
7. [The monthly rota workflow, end to end](#7-the-monthly-rota-workflow-end-to-end)
8. [Core algorithms](#8-core-algorithms)
9. [Leave, units and imports](#9-leave-units-and-imports)
10. [Historical data and the analysis dashboard](#10-historical-data-and-the-analysis-dashboard)
11. [Authentication and roles](#11-authentication-and-roles)
12. [API reference](#12-api-reference)
13. [Frontend guide](#13-frontend-guide)
14. [Testing](#14-testing)
15. [Deployment and operations](#15-deployment-and-operations)
16. [How-to recipes](#16-how-to-recipes)
17. [Conventions and gotchas](#17-conventions-and-gotchas)
18. [Further documentation](#18-further-documentation)

---

## 1. What the system does

The rota board of the Anaesthesia department (~220 doctors across several units and two campuses)
uses this app to:

1. **Maintain department members** — canonical names, aliases (spelling variants seen in
   spreadsheets), designations and the default call level of each doctor.
2. **Record leave** — manually or by importing the monthly leave spreadsheet.
3. **Post members to units** each month (Unit Management board), at a call level
   (1st call … 5th call) or to special postings (DRP, SICU, Pain).
4. **Generate the monthly duty rota** in two stages:
   - *Template generation* creates every duty slot for every day of the month and decides
     **which unit** must staff it, balancing fairness between units and unit staffing safety.
   - *Assignment* puts a **person** from that unit into each slot — manually from ranked
     suggestions, or by "safe auto-fill".
5. **Review** the month (warnings, overrides, fairness, swap/exchange requests), **publish** it
   with an approval note, and **export** it to Excel.
6. **Analyse** historical duty load (Jan 2025 – May 2026 imported from the old spreadsheets)
   together with published months.

Confirmed product decisions are recorded in [`Plan/05_confirmed_decisions.md`](../Plan/05_confirmed_decisions.md).
The most important ones: admin-only users (no individual staff logins), Excel as the final
output, at least 24 hours between two 24-hour duties for the same person (hard rule, overridable
only with an explicit reason), and configurable duty limits.

---

## 2. Quick start

### Prerequisites

- Windows (the helper scripts are PowerShell), Python 3.11+ (3.12 used in Docker), Node 22,
  PostgreSQL 16 (local install or Docker Desktop).

### One command (Windows)

```powershell
.\launch.bat            # or: powershell -ExecutionPolicy Bypass -File .\start.ps1
```

`start.ps1` creates `backend/.venv` if needed, installs backend/frontend dependencies, uses a
running local PostgreSQL or starts the `db` service from `docker-compose.yml`, runs
`alembic upgrade head`, opens two PowerShell windows (Uvicorn on :8000 with `--reload`, Vite on
:5173) and opens the browser.

### Manual

```powershell
# database
docker compose up -d db

# backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173 ; /api is proxied to 127.0.0.1:8000
```

### Configuration (`.env` at repo root or `backend/`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://duty_rota:duty_rota@localhost:5432/duty_rota` | `postgres://` and `postgresql://` are rewritten to the psycopg driver automatically |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Added to the CORS allow-list |
| `APP_ENV`, `APP_NAME` | `development`, `Duty Rota Software` | Informational only (no behaviour depends on `APP_ENV`) |
| `VITE_API_BASE_URL` (frontend build) | empty | Leave empty for same-origin (Vite proxy / Railway) |

### First login

On an empty database call `POST /api/v1/auth/seed-superadmin` once. It creates the user
`rotachief` with the default password documented in `Plan/05_confirmed_decisions.md`.
**Change it immediately**, and see inspection issues S2 and S4 before deploying anywhere.

### Source data the import features expect (not in git)

| Path | Used by |
|---|---|
| `data/source/historical/*.xlsx` | monthly rota workbooks (historical import, mapping scan) |
| `data/source/historical/unitwise/*.xlsx` | monthly unitwise posting workbooks; `May 2026.xlsx` is used for call-level prefill |
| `Plan/Data/ANAESTHESIA department doctors(namelist).xlsx` | trusted department roster (reconcile / reset) |
| `Plan/Data/CMC_Duty_Analysis_v5.html` | reference report used to compare historical totals |

`data/source/**` is git-ignored, so obtain these files from the department. They are **not**
in the Docker image (issue D1).

---

## 3. Repository layout

```text
backend/
  app/
    main.py                FastAPI app factory, CORS, 500 handler, static frontend mount
    core/config.py         Settings (pydantic-settings)
    db/session.py          Engine, SessionLocal, Base, get_db dependency
    api/routes.py          Mounts all v1 routers under /api
    api/v1/*.py            HTTP layer: request/response models, auth dependencies, error mapping
    services/*.py          Business logic (all real work happens here)
    models/*.py            SQLAlchemy 2.0 ORM models
    domain/*.py            Static vocabularies: call levels, duty types; unused validator
  alembic/versions/        17 migrations (0001 … 0017)
  tests/                   pytest suite (157 tests, SQLite in-memory)
  analysis_rebuild_output*/  old committed artefacts of the historical dry run
frontend/
  src/main.ts              The whole SPA (~9.4k lines)
  src/services/api.ts      Typed API client (~2k lines)
  src/styles.css           All styling (~4.8k lines)
  vite.config.ts           Dev proxy /api -> :8000
Plan/                      Product planning, decisions, roadmaps, development log, user guide
docs/                      Algorithm/policy notes, deployment notes, this handbook
Dockerfile, railway.json   Single-container production build (Railway)
docker-compose.yml         Local db + backend + frontend containers
start.ps1, launch.bat      Windows one-command launcher
data/source/historical/    Source spreadsheets (git-ignored)
backups/, cred/, Debug/    Must not be in git (see inspection issue S1)
```

---

## 4. Architecture

```mermaid
flowchart LR
    subgraph Browser
      SPA["main.ts SPA<br/>innerHTML rendering<br/>token in localStorage"]
    end
    subgraph Server["FastAPI (uvicorn)"]
      API["api/v1 routers<br/>auth deps, pydantic I/O"]
      SVC["services/*<br/>rules, generation, safety,<br/>imports, analysis, exports"]
      ORM["models/* (SQLAlchemy)"]
    end
    DB[(PostgreSQL)]
    FS[/"Excel files on disk<br/>data/source, Plan/Data"/]
    SPA -- "fetch /api/... Bearer token" --> API --> SVC --> ORM --> DB
    SVC -- "openpyxl / pandas read" --> FS
    SVC -- "xlsxwriter" --> XLSX["Excel downloads"]
```

**Layers**

- **API layer (`app/api/v1`)** is thin: it declares pydantic request/response models, applies
  `Depends(current_user)` / `Depends(require_admin)` (when present), validates the `month`
  query parameter with `month_bounds()`, calls one service function and maps service exceptions
  (`ValueError`, `RotaAssignmentError`, `RotaReviewError`, `RotaPublishError`) to HTTP errors.
- **Service layer (`app/services`)** contains all business rules. Services receive a
  `Session` and **commit themselves**. Many responses are plain `dict` payloads built by
  `*_to_dict` helpers; the API wraps them in loose pydantic models (`dict[str, object]`).
- **Persistence**: SQLAlchemy 2.0 typed ORM, UUID primary keys, naive UTC timestamps
  (`datetime.utcnow`), JSON columns for audit snapshots. Schema changes go through Alembic.
- **No background jobs, no cache, no message queue.** Every operation, including full-month
  generation and auto-fill, runs synchronously inside the HTTP request.

**Deployment shapes**

| Shape | How |
|---|---|
| Local dev | Vite :5173 (proxy) + Uvicorn :8000 + Postgres :5432 |
| docker-compose | three containers: `db`, `backend` (backend/Dockerfile), `frontend` |
| Production (Railway) | root `Dockerfile` builds the frontend, copies `dist/` to `backend/static`, FastAPI serves it at `/`; `docker-entrypoint.sh` runs `alembic upgrade head` on every start; Railway Postgres via `DATABASE_URL` |

---

## 5. Domain glossary

| Term | Meaning in this codebase |
|---|---|
| **Member / Person** | A doctor in the department (`persons`). `active_status`: `active`, `archived`, `historical` (created by the historical importer). |
| **Alias** | Another spelling of a member's name seen in spreadsheets; used by every importer to resolve names. |
| **Designation** | Dated job title (e.g. ASSISTANT PROFESSOR), from the trusted roster. |
| **Call level** | Seniority ladder for on-call duties: `1ST_CALL` (junior PG) → `2ND_CALL` → `3RD_CALL` → `4TH_CALL`/`CO_4TH_CALL` → `5TH_CALL`. Normalised by `services/rota_call_levels.normalize_call_level`. |
| **Unit** | Clinical unit (Unit I…VI, cardiac, neuro, …). Each has `minimum_free_people`. |
| **Posting** | `person_postings` row: member X is in unit Y at call level Z from date A to B. Source `unit_board` = the Unit Management board (authoritative for new rotas). |
| **Special posting** | DRP, SICU, PAIN: a posting with no unit. |
| **Duty type** | Key from `domain/duty_types.py`, e.g. `MAIN_1ST_24HR`, `RC_3RD_24HR`, `CB_PAEDS`, `MAIN_PAC_SR_A`, `CHAD`. |
| **Duty family / group** | `main` (main campus), `cb` (CB / Centenary calls), `caesar`, `rc` (Ranipet campus), `schell`, `floating`, `fifth_call`, `cart`, `pac` (pre-anaesthetic clinic), `shift`, `chad`, `ruhsa`, `paeds`, `neuro`. Used for fairness and export grouping. |
| **Main 24-hour duties** | `MAIN_24HR_KEYS` — the duties that count in the headline "24hr" analysis totals. |
| **Eligibility group (call cluster)** | Sub-group within a call level, e.g. 3rd Call A/B/C; PAC duties are restricted to particular groups. |
| **Rule set** | `RotaPhaseOneRules` JSON: per-duty rules + monthly limits + rest rules + staffing thresholds. |
| **Rota period** | One month (`rota_periods`). Status `draft`, `published`, or `historical`. |
| **Generation scope** | Which units take part in this month's generation; must be **locked** before generating. |
| **Template / slot** | A `duty_slots` row (`source="phase4_template"`): a duty on a date, already allocated to a unit, waiting for a person. |
| **Forced allocation** | A slot given to the "least damaging" unit when every unit was hard-blocked; always needs review. |
| **Vertical shuffle** | Post-generation swap of units between same-duty slots on different days to reduce clustering. |
| **Safety** | Per-slot staffing status: `safe`, `needs_review`, `hard_blocked`. |
| **Override** | Free-text reason required to save an assignment that has warnings/errors. |
| **Exchange** | A swap request: replace the person on an assignment with another member, approved/rejected later. |
| **Eagle Eye export** | Excel matrix of duty × date showing the allocated unit. |

---

## 6. Data model

30 tables; created by migrations 0001–0017. Grouped:

```mermaid
erDiagram
    persons ||--o{ person_aliases : has
    persons ||--o{ person_designations : has
    persons ||--o{ person_postings : "posted via"
    units ||--o{ person_postings : contains
    units ||--o{ unit_call_minimums : has
    persons ||--o{ leave_requests : takes
    persons ||--o{ person_call_cluster_memberships : in
    call_clusters ||--o{ person_call_cluster_memberships : groups
    rota_periods ||--|| monthly_generation_scopes : scoped_by
    monthly_generation_scopes ||--o{ monthly_generation_scope_units : includes
    rota_periods ||--o{ duty_slots : contains
    units ||--o{ duty_slots : staffs
    duty_slots ||--o{ duty_assignments : filled_by
    persons ||--o{ duty_assignments : works
    rota_periods ||--o{ rota_template_generation_runs : generated_by
    rota_template_generation_runs ||--o{ rota_template_generation_events : logs
    rota_periods ||--o{ rota_auto_fill_runs : auto_filled_by
    rota_auto_fill_runs ||--o{ rota_auto_fill_events : logs
    rota_periods ||--o{ rota_exchange_requests : has
    duty_slots ||--o{ rota_review_decisions : decided
    rota_periods ||--o{ rota_publish_approvals : published_by
    rule_versions ||--o{ rule_settings : has
    user_accounts ||--o{ user_sessions : has
    user_accounts ||--o{ password_reset_tokens : has
    import_batches ||--o{ import_source_records : has
    import_batches ||--o{ import_warnings : has
```

| Area | Tables | Notes |
|---|---|---|
| People | `persons`, `person_aliases`, `person_designations` | `canonical_name` unique; `alias` globally unique |
| Units & postings | `units`, `unit_call_minimums`, `person_postings` | `person_postings.source`: `unit_board`, `historical_import`, `historical_analysis_import` |
| Leave | `leave_requests` | `leave_slot` FULL_DAY/AM/PM/NIGHT; `status` approved (blocking), requested / imported_pending_review (warning), cancelled |
| Rota | `rota_periods`, `monthly_generation_scope(_units)`, `duty_slots`, `duty_assignments` | slot unique on (period, date, duty_type, slot_label); generated slot label = `"<UNIT_CODE>:primary"` |
| Audit | `rota_template_generation_runs/events`, `rota_auto_fill_runs/events`, `rota_review_decisions`, `rota_exchange_requests`, `rota_publish_approvals` | JSON `details`/`summary` snapshots |
| Rules | `rule_versions`, `rule_settings`, `call_clusters`, `person_call_cluster_memberships` | one rule version + one JSON setting in practice |
| Imports | `admin_mappings`, `import_batches`, `import_source_records`, `import_warnings` | traceability back to sheet/row/column |
| Auth | `user_accounts`, `user_sessions`, `password_reset_tokens` | token hashes only |

Foreign keys mostly have **no** `ON DELETE` behaviour (exceptions: auto-fill events/exchanges
`SET NULL`, review decisions `CASCADE` on slot). Any code that deletes people, units, periods or
slots must delete or re-point dependants explicitly (see issue B4).

---

## 7. The monthly rota workflow, end to end

```mermaid
flowchart TD
    A[Members & call levels<br/>Department Members] --> B[Leave for the month<br/>Leave screen / import]
    B --> C[Unit postings for the month<br/>Unit Management board / import]
    C --> D[Rota Setup<br/>include/exclude units, LOCK scope]
    D --> E[Rota Template<br/>generate slots + unit allocation]
    E --> F[Assign people<br/>manual with suggestions / safe auto-fill]
    F --> G[Rota Review<br/>accept warnings, exchanges, fairness]
    G --> H[Publish & Export<br/>checklist, approval note, Excel]
    H --> I[Analysis<br/>published months join historical data]
```

| Step | Screen (`data-view`) | Endpoints | Service |
|---|---|---|---|
| 1 Members | `members` | `/admin/members/*` | `members.py`, `roster_reconciliation.py` |
| 2 Leave | `leave` | `/leave/*` | `leave.py`, `leave_import.py` |
| 3 Unit board | `units` | `/unit-management/*`, `/units` | `unit_management.py`, `unit_assignment_import.py` |
| 4 Setup | `rota-setup` | `/rota-setup/month*` | `rota_setup.py` |
| 5 Template | `rota-template` | `/rota-template/*`, `/rota-safety/month`, `/rota-candidates/*` | `rota_template.py`, `rota_safety.py`, `rota_candidates.py` |
| 6 Assign | `rota-template` (day modal) | `/rota-assignments/*`, `/rota-auto-fill/*` | `rota_assignment.py`, `rota_auto_fill.py` |
| 7 Review | `rota-review` | `/rota-review/*` | `rota_review.py` |
| 8 Publish | `rota-publish` | `/rota-publish/*` | `rota_publish.py` |
| Admin | `rota-rules`, `call-clusters`, `mappings`, `imports`, `accounts`, `diagnostics` | see §12 | |

What happens in each step:

1. **Setup** — `GET /rota-setup/month?month=YYYY-MM` gets or creates the `RotaPeriod` ("June
   2026") and an empty scope, and computes per-unit readiness (members posted, call-level
   distribution, leave). The board selects included units and locks the scope.
2. **Generate** — `POST /rota-template/generate` requires a locked scope. By default it removes
   the month's previous generated slots (refuses if any has an assignment) and creates one slot
   per (day × mandatory active duty), each allocated to one included unit (§8.1). Every decision
   is logged as a generation event and summarised in Allocation Statistics.
3. **Assign** — the day modal shows each slot with its safety status (§8.2) and ranked candidates
   (§8.4). Saving calls `POST /rota-assignments/slots/{id}/assign`; warnings require an override
   reason, `blocked` results cannot be saved (§8.3). Safe auto-fill (§8.5) can fill the clean ones.
4. **Review** — lists open slots, template-review slots, staffing warnings/hard blocks and
   override assignments; warnings can be accepted with a note; exchanges can be requested and
   approved/rejected; workload and call-level fairness tables flag over/under-assigned members.
5. **Publish** — the checklist blocks on: unlocked scope, no slots, open slots, hard-blocked
   items, pending exchanges. Remaining warnings/overrides require explicit confirmation. Publishing
   stores a `RotaPublishApproval` and sets the period to `published`; the final Excel export is
   then available. (Publishing does not freeze the data — issue B1.)

---

## 8. Core algorithms

### 8.1 Template generation — unit allocation (`services/rota_template.py`)

Input: locked scope (included units), rule set (`selected_duty_rules`: mandatory active duties
unless specific `duty_keys` are requested), the month's postings and leave, any existing slots.

For each **day** (optionally weekdays/weekends only, optional sub-range) and each **duty**
(families rotated by day — `duty_rules_for_day`), `choose_balanced_unit`:

1. Skips units excluded by the rule's `allowed_units` / `excluded_units`.
2. Computes **pressure** for the unit (`pressure_for_slot`): members at the required call level
   on that date; minus members on blocking leave for that time; minus slots the unit already holds
   that day; minus previous-day 24h slots at that call level. `hard_block` if no members, if
   members left after this slot < unit/call minimum (`unit_call_minimums` overrides
   `units.minimum_free_people`), or if the unavailable % ≥ hard threshold (default 40 %);
   `warning` at ≥ warning threshold (default 30 %).
3. Computes a **fairness snapshot** — the unit's target deficit and overage for total slots,
   duty family, family + call bucket, exact duty and call bucket. Targets are weighted by the
   **fairness policy** (`allocation_target_weights`):
   - `equal_unit` — every unit the same share;
   - `equal_people` — share proportional to active eligible people;
   - `hybrid` (default) — roughly half equal share, half proportional.
4. Picks the minimum by a lexicographic key: (weekend spread on weekends) → largest deficits →
   smallest overages → weekend/weekly family clustering → legacy `allocation_score`.
5. If **every** unit is hard-blocked, the least-damaging unit is chosen (no members first, then
   shortage, unavailability, …) and the slot is marked as a forced allocation (`needs_review`,
   reason prefixed "Forced minimal-damage allocation").

Afterwards `optimize_template_slot_layout` performs up to 200 greedy pairwise swaps between
same-duty slots on different days when this lowers the clustering score
(`template_pattern_score`: same unit, same family, same day; same duty on consecutive days)
without worsening either slot's available members or unavailable %.

Design notes and incident history: [`docs/unit_slot_fairness_policy_modes.md`](unit_slot_fairness_policy_modes.md),
[`docs/unit_duty_family_distribution_plan.md`](unit_duty_family_distribution_plan.md),
[`docs/unit_slot_imbalance_incident_report_2026_05.md`](unit_slot_imbalance_incident_report_2026_05.md),
[`docs/rota_generation_and_assignment_algorithm_validation.md`](rota_generation_and_assignment_algorithm_validation.md).

### 8.2 Slot safety (`services/rota_safety.py`)

For one slot: unit members active on that date (from **all** posting sources — issue B5) →
filter by required call level (slot call level, else rule `allowed_call_levels`, else inferred
from the duty key) → filter by eligibility-group rules. Each eligible person is:

- **hard-blocked** by approved leave overlapping the slot, another same-day duty that blocks
  the day (24h duties, or rules with `blocks_elective_same_day`), or a 24h duty on the previous
  calendar day (`blocks_elective_next_day`);
- **warning** if only pending leave (`requested`, `imported_pending_review`) overlaps;
- **available** otherwise.

The slot status uses the same minimum/percentage thresholds as generation (`safety_status`).
Limitation: rest is only checked backwards one day and within the month (issue B2).

### 8.3 Assignment validation (`services/rota_assignment.py`)

`validate_assignment` combines slot safety for the chosen person with:

| Result | Causes |
|---|---|
| `blocked` (cannot save) | slot already full and not replacing; call-level mismatch; eligibility-group mismatch |
| `needs_override` (reason required) | inactive member; not posted to the slot's unit on that date; leave/same-day/rest blockers; slot staffing warning or hard block; monthly limits exceeded (`max_24hr_per_month`, `max_weekend_24hr_per_month`, `max_same_group_per_month`, `max_same_campus_per_month`) |
| `clear` | none of the above |

### 8.4 Candidate ranking (`services/rota_candidates.py`)

Pool = everyone from the slot-safety lists. Each candidate is validated as above, then scored —
**lower is better**: status (eligible 0, review 35, blocked 1000) + monthly burden (same
weekday/weekend type ×30, total ×6, 24h ×10, weekend 24h ×12, same family ×5, same campus ×2) +
fairness (×7 per duty above the month average) + rest (80 if the nearest duty gap is below
`minimum_gap_after_24hr_hours`, 15 if within +12 h) + slot staffing (10/25) + override (20).
Sorted by status, score, then name. (Two components are counted twice — issue B20.)

### 8.5 Safe auto-fill (`services/rota_auto_fill.py`)

Walks the month's slots in date order. Skips filled slots; in strict mode skips slots whose
required call level is ambiguous; assigns the first candidate that is `eligible`, validates
`clear`, needs no override and (strict) matches the single required call level. Every decision
is an auto-fill event. It is greedy (no look-ahead) and slow on full months (issue P1).

### 8.6 Publish checklist (`services/rota_publish.py`)

Built from `rota_review_month`. Blockers: scope not locked, zero slots, open slots,
hard-blocked review items, pending/needs-override exchanges. Warnings: unaccepted review items,
assignments with override reasons — publish requires `confirm_warnings=true` when present.

---

## 9. Leave, units and imports

### Leave (`services/leave.py`, `services/leave_import.py`)

- Manual leave can only be added for `active` members; end ≥ start.
- Import accepts `.xlsx/.xlsm/.xls/.csv`. Each sheet is read as a table (header auto-detected
  within the first 25 rows; columns matched by name: name/person/doctor/member/staff, start/from/date,
  end/to, type, slot/session, status, notes) or as a wide calendar (one column per day).
  Half-day markers inside name cells become `leave_slot`.
- Preview shows match status per row; **apply** inserts only rows that matched a member with no
  issues (duplicates and existing leave are flagged and skipped).

### Unit Management (`services/unit_management.py`, `services/unit_assignment_import.py`)

- Board postings (`source="unit_board"`) are the authoritative membership used by generation.
  Validation flags inactive members, members in more than one unit in the month, overlapping
  primary postings, and missing unit/posting type.
- Unit settings: unit-level `minimum_free_people` and per-call-level minimums (validated against
  the month's member counts).
- Unitwise import: Excel grid (units as columns, posting labels as row sections, optional date
  ranges such as "1-15", "1st to 15th" or "2026-06-01 to 2026-06-15" in the name or a date
  row) or pasted text. Names and unit labels are matched with scored fuzzy
  matching (`MEMBER_AUTO_MATCH_THRESHOLD = 0.88`, `UNIT_AUTO_MATCH_THRESHOLD = 0.80`, minimum
  gap to the runner-up 0.04). The preview UI lets the user resolve rows manually; on apply,
  manual corrections are learned as aliases (`unit_import_learning`) and unit mappings.
  `replace_existing=true` first deletes the month's board postings (issue B6).

### Admin mappings (`api/v1/admin_mappings.py`)

`scan-historical` reads the duty labels (column A of each rota workbook) and unit/posting
labels (unitwise workbooks) and seeds `admin_mappings` with suggested targets
(`classify_duty_label`). Admins review targets in the Mappings screen.

### Department roster (`services/roster_reconciliation.py`, `services/department_roster_reset.py`)

- **Reconcile** (safe-ish): rename matches to the roster spelling, merge duplicates, add aliases
  and designations, create missing members.
- **Reset** (destructive): deletes almost all data and recreates members from the roster.
  Do not use on a live database (issues B4, S3).
- **Prefill call levels**: reads section labels ("1st call PGs (2025)" → `1ST_CALL`, …) from the
  May 2026 unitwise workbook.

---

## 10. Historical data and the analysis dashboard

**Pipeline** (`services/historical_analysis_dry_run.py`, also a CLI):

```powershell
cd backend
python -m app.services.historical_analysis_dry_run                     # dry run -> Plan/Data/analysis_rebuild/*.csv
python -m app.services.historical_analysis_dry_run --apply-alias-suggestions
python -m app.services.historical_analysis_dry_run --import-matched-history
```

1. Parse each monthly rota workbook (`imports.parse_rota_workbook`): row 1 dates, row 2
   weekdays, column A duty labels, cells = names; stop at the "Consultant"/"Professor" row.
   Labels are classified with date-aware rules (meanings changed in Nov 2025).
2. Resolve every name with `CanonicalNameResolver` against canonical members (DB, else the
   roster workbook/reference HTML) plus `MANUAL_ALIAS_OVERRIDES`. Outcomes: matched, ambiguous,
   unmatched, invalid — all written to CSVs for review.
3. Import: purge earlier historical slots/assignments/postings/batches, then create `historical`
   periods (named `YYYY-MM`), slots (`historical_analysis_import`), assignments and postings.

Alias decisions are documented in `Plan/Alias/Alias_Resolution_Summary.md` (authoritative).

**Dashboard** (`services/analysis.py`, `GET /analysis/dashboard`): includes periods with status
`historical`, `approved`, `published` or `finalized`, so drafts never count. It computes
per-person totals (all 24h, main 24h, weekend, by duty category, CART/Schell, 5th call,
shifts/PAC), month and weekday statistics, postings, and promotions (call levels are made
monotonic over time). `preflight` lists data-quality blockers; `manual-review` summarises the
dry-run CSVs.

---

## 11. Authentication and roles

- `POST /auth/sign-in` → random token (32 bytes, URL-safe). Only its SHA-256 is stored in
  `user_sessions`; sessions expire after 12 hours. The SPA stores the token in `localStorage`
  and sends `Authorization: Bearer …`. Sign-out only deletes it client-side.
- Passwords: PBKDF2-SHA256, 260,000 iterations, 16-byte salt (`services/auth.py`).
- Roles: `rota_board_member`, `computer_admin`, `superadmin`. `require_admin` accepts the last
  two. The frontend hides "Admin tools" for board members, but **the backend does not protect
  the members, mappings, historical import or analysis endpoints at all** (issue S3), and every
  rota action (including publish) is open to any signed-in role (S6).
- Password reset currently returns the token to the caller (S2). Change-password enforces ≥ 8
  characters; account creation and reset do not.

---

## 12. API reference

All paths are prefixed by the host. Auth column: `NONE` = no authentication,
`user` = any signed-in account, `admin` = computer admin or superadmin. Interactive docs:
`/docs` (Swagger) and `/redoc` on any running backend. Month parameters are `month=YYYY-MM`.

| Tag | Method | Path | Auth |
|---|---|---|---|
| health | GET | `/api/health` | NONE |
| metadata | GET | `/api/v1/metadata` | NONE |
| auth | POST | `/api/v1/auth/sign-in` | NONE |
| auth | POST | `/api/v1/auth/seed-superadmin` | NONE |
| auth | POST | `/api/v1/auth/forgot-password` | NONE |
| auth | POST | `/api/v1/auth/reset-password` | NONE |
| auth | GET / PUT | `/api/v1/auth/me` | user |
| auth | POST | `/api/v1/auth/change-password` | user |
| auth | GET / POST | `/api/v1/auth/accounts` | admin |
| members | GET / POST | `/api/v1/admin/members` | NONE |
| members | PUT | `/api/v1/admin/members/{person_id}` | NONE |
| members | POST | `/api/v1/admin/members/{person_id}/aliases` | NONE |
| members | POST | `/api/v1/admin/members/{person_id}/designations` | NONE |
| members | POST | `/api/v1/admin/members/{person_id}/archive` | NONE |
| members | POST | `/api/v1/admin/members/{person_id}/restore` | NONE |
| members | GET | `/api/v1/admin/members/audit` | NONE |
| members | GET | `/api/v1/admin/members/dedupe-candidates` | NONE |
| members | GET | `/api/v1/admin/members/invalid` | NONE |
| members | POST | `/api/v1/admin/members/merge` | NONE |
| members | POST | `/api/v1/admin/members/auto-merge-duplicates` | NONE |
| members | POST | `/api/v1/admin/members/cleanup-invalid` | NONE |
| members | POST | `/api/v1/admin/members/reconcile-trusted-roster` | NONE |
| members | POST | `/api/v1/admin/members/reset-from-trusted-roster` | NONE (destructive) |
| members | POST | `/api/v1/admin/members/prefill-call-levels` | NONE |
| admin mappings | GET / POST | `/api/v1/admin/mappings` | NONE |
| admin mappings | GET | `/api/v1/admin/mappings/options` | NONE |
| admin mappings | PUT | `/api/v1/admin/mappings/{mapping_id}` | NONE |
| admin mappings | POST | `/api/v1/admin/mappings/scan-historical` | NONE |
| historical imports | GET | `/api/v1/admin/imports/historical/status` | NONE |
| historical imports | POST | `/api/v1/admin/imports/historical/run` | NONE |
| analysis | GET | `/api/v1/analysis/dashboard` | NONE |
| analysis | GET | `/api/v1/analysis/preflight` | NONE |
| analysis | GET | `/api/v1/analysis/manual-review` | NONE |
| diagnostics | GET | `/api/v1/diagnostics/summary` | admin |
| call clusters | GET / POST | `/api/v1/admin/call-clusters` | admin |
| call clusters | PUT | `/api/v1/admin/call-clusters/{cluster_id}` | admin |
| call clusters | GET / PUT | `/api/v1/admin/call-clusters/{cluster_id}/members` | admin |
| rota rules | GET / PUT | `/api/v1/admin/rota-rules/phase-one` | admin |
| leave | GET / POST | `/api/v1/leave/requests` | user |
| leave | PUT | `/api/v1/leave/requests/{leave_id}` | user |
| leave | POST | `/api/v1/leave/requests/{leave_id}/cancel` | user |
| leave | GET | `/api/v1/leave/calendar` | user |
| leave | GET | `/api/v1/leave/pressure` | user |
| leave | POST | `/api/v1/leave/import-preview` (multipart `file`) | user |
| leave | POST | `/api/v1/leave/import-apply` (multipart `file`) | user |
| unit management | GET | `/api/v1/units` | user |
| unit management | GET | `/api/v1/unit-management/month` | user |
| unit management | PUT | `/api/v1/unit-management/units/{unit_id}/settings` | user |
| unit management | POST | `/api/v1/unit-management/assignments` | user |
| unit management | PUT / DELETE | `/api/v1/unit-management/assignments/{assignment_id}` | user |
| unit management | POST | `/api/v1/unit-management/import-preview` (multipart `file`, `resolutions_json`) | user |
| unit management | POST | `/api/v1/unit-management/import-apply` (multipart) | user |
| rota setup | GET | `/api/v1/rota-setup/month` | user |
| rota setup | PUT | `/api/v1/rota-setup/month/scope` | user |
| rota setup | POST | `/api/v1/rota-setup/month/clone-previous` | user |
| rota template | GET | `/api/v1/rota-template/month` | user |
| rota template | POST | `/api/v1/rota-template/generate` | user |
| rota template | DELETE | `/api/v1/rota-template/cache` (`clear_assignments`) | user |
| rota template | GET | `/api/v1/rota-template/allocation-statistics` | user |
| rota template | GET | `/api/v1/rota-template/eagle-eye-export` | user |
| rota template | GET | `/api/v1/rota-template/call-wise-export` | user |
| rota safety | GET | `/api/v1/rota-safety/month` | user |
| rota candidates | GET | `/api/v1/rota-candidates/month` | user |
| rota candidates | GET | `/api/v1/rota-candidates/slots/{slot_id}` | user |
| rota assignments | POST | `/api/v1/rota-assignments/slots/{slot_id}/assign` | user |
| rota assignments | DELETE | `/api/v1/rota-assignments/assignments/{assignment_id}` | user |
| rota auto fill | GET | `/api/v1/rota-auto-fill/month` | user |
| rota auto fill | POST | `/api/v1/rota-auto-fill/draft` | user |
| rota review | GET | `/api/v1/rota-review/month` | user |
| rota review | POST | `/api/v1/rota-review/slots/{slot_id}/decisions` | user |
| rota review | POST | `/api/v1/rota-review/exchanges` | user |
| rota review | POST | `/api/v1/rota-review/exchanges/{exchange_id}/approve` | user |
| rota review | POST | `/api/v1/rota-review/exchanges/{exchange_id}/reject` | user |
| rota publish | GET | `/api/v1/rota-publish/month` | user |
| rota publish | POST | `/api/v1/rota-publish/publish` | user |
| rota publish | GET | `/api/v1/rota-publish/export` | user |

(85 route/method combinations; 32 without authentication.)

Error format: `{"detail": "message"}`; assignment validation failures return
`{"detail": {"message": ..., "validation": {...}}}` with status 409; unhandled errors return
500 with a generic message (traceback in the server log).

---

## 13. Frontend guide

- **No framework.** `main.ts` keeps module-level state variables and renders each screen with
  `innerHTML` template strings. One big `bindViewEvents()` registers delegated listeners that
  dispatch on element `id`s and `data-*` attributes. Read the header comment of `main.ts` for a
  map of the file.
- **Adding a screen:** add an entry to `NAV_ITEMS`, a branch in `navigateToView()`, an
  `async function renderX()` that sets the header (`setHeader`), loads data via
  `services/api.ts`, writes `viewRoot.innerHTML`, and add handlers in `bindViewEvents()`.
- **Always escape** server strings with `escapeHtml()` (several places currently do not — S5).
- **Preserve UX helpers:** `preserveViewport()` keeps scroll position across re-renders;
  `setButtonLoading`/`resetButton`; `showToast`; `confirmAction` (native `confirm`).
- **Persisted UI preferences** in `localStorage`: auth token, template fast mode, template
  overview mode, day-modal view mode, suggestions expanded.
- **Types:** keep `services/api.ts` interfaces in sync with backend responses by hand.
- Build: `npm run build` (runs `tsc` then `vite build`); type-check only: `npx tsc --noEmit`.

---

## 14. Testing

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q -p no:cacheprovider     # 157 tests, ~75 s
cd ..\frontend
npx tsc --noEmit
```

- Tests use in-memory SQLite (`StaticPool`) and override `get_db`, so no PostgreSQL is
  needed. Consequence: **foreign-key and PostgreSQL-specific behaviour is not tested**
  (SQLite does not enforce FKs by default) — e.g. issue B4 is invisible to the suite.
- Heaviest coverage: rota template (≈1.5k lines of tests), unit management, leave, safety,
  publish/review flows. No frontend tests; no CI pipeline.
- Recommended additions: a PostgreSQL test job (docker service) and an auth test asserting
  that every non-public route returns 401 without a token.

---

## 15. Deployment and operations

**Railway (current production):** one web service built from the root `Dockerfile` + one
PostgreSQL service. Variables: `APP_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
`FRONTEND_ORIGIN=https://<service>.up.railway.app`. Health check `/api/health`. Migrations run on
every container start. Details and past incidents: [`Plan/12_railway_deployment_notes.md`](../Plan/12_railway_deployment_notes.md),
[`docs/RAILWAY_DEPLOYMENT.md`](RAILWAY_DEPLOYMENT.md) (both mention an older repository name).

**Migrations:**

```powershell
cd backend
alembic revision -m "describe change"      # write upgrade/downgrade by hand (match existing style)
alembic upgrade head
```

Keep model and migration in sync; tests create tables from the models, not from migrations.

**Backups:** there is no automated backup. Use `pg_dump` against Railway (TCP proxy) on a
schedule and store dumps outside the repository (never commit them — issue S1).

**Logs:** application logs go to stdout (Railway logs). Unit management and imports log
timings at INFO.

**Production limitations to know:** the import/reconcile features need files that are not in
the image (D1); long operations (generation, auto-fill, historical import) run inside the
request and can hit proxy timeouts (P1).

---

## 16. How-to recipes

**Add a new duty type**
1. Add it to `DUTY_TYPES` in `app/domain/duty_types.py` (and `MAIN_24HR_KEYS` if it counts as a
   main 24h duty). Rules pick it up automatically on next read (`get_phase_one_rules`).
2. If it needs eligibility limits, add defaults in `PAC_SUBDIVISION_RULES`-style dicts in
   `rota_rules.py` or configure it in the Rota Rules screen.
3. Teach the historical parser: `classify_duty_label` in `services/imports.py`.
4. Update frontend groupings (`DUTY_GROUPS`, `DUTY_TEMPLATE_GROUP_ORDER/LABELS`) and export
   labels (`EAGLE_EYE_GROUP_LABELS`) if it is a new family.
5. Add/adjust tests in `tests/test_rota_template.py`.

**Add a rule setting**: extend the pydantic model in `services/rota_rules.py` (with a default so
old JSON still validates), use it in the service, add the field to `RotaPhaseOneRules` in
`api.ts` and to the Rota Rules form in `renderRotaRules()` / the `rule-*` submit handler.

**Add an endpoint**: service function in `services/`, router function in `api/v1/` **with an
auth dependency**, register the router in `api/routes.py` if new, client function in `api.ts`,
tests in `tests/`.

**Add a column/table**: model change + Alembic migration + any `*_to_dict`/read models + tests.
If it references `persons`, `units`, `rota_periods` or `duty_slots`, update merges and the
roster reset (B4).

---

## 17. Conventions and gotchas

- Month strings are always `YYYY-MM`; `month_bounds()` validates them.
- Many GET endpoints **create rows** on first access (rota period, scope, default rules and
  clusters). Do not assume reads are side-effect free.
- `normalize_call_level` folds Co-1st into 1st call and returns unknown strings unchanged.
- `person_postings.posting_type` holds a call level for board postings but a free label for
  historical ones.
- Template slot labels are `"<UNIT_CODE>:primary"`; uniqueness is per (period, date, duty, label).
- Datetimes are naive UTC; the frontend default month uses UTC (`toISOString`).
- Services commit internally; when composing services in one request, earlier commits are not
  rolled back if a later step fails.
- Several files hard-code dataset specifics (roster sheet names, May 2026 workbook, manual alias
  overrides, effective dates). Search for `2026` before re-using code for a new year.

---

## 18. Further documentation

| Document | Content |
|---|---|
| `Plan/README.md`, `Plan/08_new_session_checklist.md` | planning index and what to read before changing behaviour |
| `Plan/01…07_*.md` | product understanding, architecture choices, domain rules, open questions, decisions, principles, roadmap |
| `Plan/09_system_manual_and_brainstorming_summary.md` | system manual summary |
| `Plan/development_log.md` | dated log of every change and verification (keep updating it) |
| `Plan/Website complete user guide.md` | end-user guide for the rota board |
| `Plan/Rota generator/`, `Plan/leave management engine/`, `Plan/unit management engine/` | feature plans |
| `docs/rota_*.md`, `docs/unit_*.md` | algorithm research, validation, fairness policies, incident report |
| `docs/INSPECTION_REPORT_2026-10.md` | issue register from this inspection |
