# Architecture and Tech Stack

## Recommendation

Use a web app with a Python backend domain engine, PostgreSQL database, and a TypeScript frontend. Keep the frontend framework-light initially, but do not avoid structure where it protects maintainability.

Recommended stack:

- Backend: Python with FastAPI.
- Domain/data processing: Python modules using pandas/openpyxl for Excel imports.
- Database: PostgreSQL.
- ORM/migrations: SQLAlchemy 2.x plus Alembic.
- Background jobs: start simple with in-process jobs; later use Redis + RQ/Celery if imports and generation become heavy.
- Frontend: TypeScript, Vite, plain component modules or a small framework only if needed.
- Styling: plain CSS with a small design system, no heavy UI framework at first.
- Testing: pytest for backend/domain rules, Playwright for end-to-end web checks.
- Deployment: Docker Compose initially; later a VPS or cloud deployment with managed PostgreSQL.

Confirmed MVP needs that shape the stack:

- admin-facing web app,
- historical seed import for Jan 2025-May 2026,
- new monthly rota creation,
- Excel export,
- configurable duty limits,
- hard 24-hour spacing validation,
- possible offline HTML report export.

## Why This Stack Fits

### Python for the hard work

The hardest part is not rendering pages. It is parsing messy Excel files, reconstructing dates, classifying duty labels, deduplicating names, and running rule-heavy analysis. Python is the best fit here.

### PostgreSQL for trustworthy records

The system needs durable history, audit trails, constraints, imports, leave requests, assignments, overrides, and reports. PostgreSQL is appropriate and avoids painting us into a corner.

### TypeScript for the web layer

The frontend needs responsive tables, filters, forms, calendars, validation states, and dashboards. TypeScript catches many bugs early.

### Framework-light frontend

Since you are not comfortable with frameworks, we can begin with Vite + TypeScript + plain DOM/component modules. That keeps the mental model simple while still giving us bundling, type checking, and a clean project structure.

If the UI becomes large, we can later consider React/Svelte/Vue. That decision can wait.

## Proposed High-Level Architecture

```
Browser UI
  |
  | HTTP JSON APIs
  v
FastAPI backend
  |
  | service layer
  v
Domain engine
  |
  | parsed records, rule results, validation results
  v
PostgreSQL
```

## Main Backend Modules

### import_pipeline

Responsible for:

- Excel file upload.
- Text/notepad list upload.
- file type detection.
- sheet preview.
- source row/cell preservation.
- import batch creation.
- import validation report.

### parsing

Responsible for:

- rota file parsing,
- unitwise file parsing,
- leave sheet parsing,
- text list parsing,
- date reconstruction,
- cell/name cleanup.

### rules

Responsible for:

- duty label classification,
- main 24-hour inclusion/exclusion,
- weekend detection,
- PAC block override,
- call level mapping,
- promotion detection,
- eligibility checks,
- leave conflict checks.

### people

Responsible for:

- canonical person records,
- aliases,
- possible duplicate review,
- unit and call level history,
- active/inactive state.

### rota

Responsible for:

- monthly rota periods,
- duty slots,
- assignments,
- draft versus published state,
- manual overrides,
- conflict validation.

### leave

Responsible for:

- leave requests,
- approval workflow,
- leave types,
- availability calendars,
- rota conflict checks.

### analytics

Responsible for:

- per-person statistics,
- duty type summaries,
- weekend analysis,
- dashboard data,
- report exports.

### export

Responsible for:

- final rota Excel export,
- analysis Excel export,
- optional self-contained offline HTML report export,
- export metadata and reproducibility notes.

### audit

Responsible for:

- source import audit,
- user changes,
- manual overrides,
- rule version used,
- explanations for computed results.

## Initial Database Concepts

- users
- persons
- person_aliases
- units
- campuses
- call_levels
- person_month_status
- leave_requests
- leave_types
- import_batches
- source_files
- parsed_cells or parsed_rows
- duty_periods
- duty_types
- duty_slots
- duty_assignments
- assignment_validation_issues
- rule_versions
- audit_events

## Data Flow

1. Admin uploads rota Excel, unitwise Excel, leave sheet, or text list.
2. Backend stores the original file and creates an import batch.
3. Parser extracts raw records while preserving source coordinates.
4. Rule engine classifies duties and flags uncertainty.
5. Name resolver maps names to canonical people or asks for review.
6. Valid records are stored as normalized duty slots and assignments.
7. Analytics engine computes dashboards from normalized records.
8. UI shows import warnings, rota calendar, people, leave, and analysis.

## Rota Generation Strategy

Build rota creation in stages. Start with manual creation plus strict validation, then add rule-aware assistance:

1. Import and analyze existing rotas.
2. Add leave and availability constraints.
3. Validate manually created rotas.
4. Suggest candidates for empty slots.
5. Later add optimizer-assisted generation.

This staged approach is safer because the rule space is complex and departmental preferences may be partly informal.

## Possible Optimizer Later

When we are ready for assisted generation:

- Use Google OR-Tools from Python.
- Model duty slots, eligible people, leave blocks, weekend balancing, max duties, spacing rules, and soft fairness penalties.
- Keep manual override ability.
- Always show why a candidate was selected or rejected.

## Frontend Screens

Initial MVP screens:

- Dashboard overview.
- People and aliases.
- Unitwise monthly roster.
- Leave calendar and approvals.
- Import center.
- Monthly rota board.
- Validation issues.
- Analytics reports.
- Person profile.
- Admin settings/rule configuration.
