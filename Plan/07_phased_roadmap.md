# Phased Roadmap

This roadmap breaks the system into buildable phases so work can continue safely across sessions.

## Phase 0 - Project Foundation

Goal: make the project ready for repeatable development.

Checklist:

- [x] Create planning folder.
- [x] Record product understanding.
- [x] Record initial architecture and tech stack.
- [x] Record domain rules and decision trees.
- [x] Record user answers and confirmed decisions.
- [x] Record evidence-based operating principles.
- [x] Initialize Git repository.
- [x] Create first Git commit.
- [x] Create base project scaffold.
- [x] Add README for developers.

Deliverable:

- A clean repository with planning docs and initial scaffold.

## Phase 1 - Data Model and Domain Core

Goal: define the domain in code before UI complexity starts.

Checklist:

- [x] Create Python backend project structure.
- [x] Add PostgreSQL-ready schema models.
- [x] Define duty type enum/config.
- [x] Define call level enum/config.
- [x] Define person, alias, unit, posting, leave, duty slot, and assignment models.
- [x] Define configurable rule settings for duty limits and spacing.
- [x] Add rule version/effective-date structure.
- [x] Add pytest setup.

Deliverable:

- Domain model and test skeleton.

## Phase 2 - Historical Import Engine

Goal: import Jan 2025 to May 2026 historical data into the new system.

Status: historical rota/unitwise parsing and normalized import are working locally, with traceability and admin mapping review in place.

Checklist:

- [x] Build rota Excel parser.
- [x] Build unitwise Excel parser.
- [x] Implement date reconstruction.
- [x] Implement duty classification rules.
- [ ] Implement PAC block override.
- [x] Implement name cleaning and alias mapping.
- [ ] Implement special posting extraction.
- [x] Add admin-editable duty/unit/posting mapping configuration.
- [x] Store import batches and source traceability.
- [ ] Produce import validation report.
- [x] Seed historical records.

Deliverable:

- Historical data loaded into normalized tables with traceable records.

## Phase 3 - Admin UI Foundation

Goal: give rota admins a usable web interface.

Checklist:

- [x] Create Vite + TypeScript frontend.
- [x] Create FastAPI JSON endpoints.
- [x] Add admin-only authentication placeholder or simple login.
- [x] Add dashboard shell/navigation.
- [ ] Add people list and person profile.
- [x] Add department members management foundation.
- [x] Add name deduplication review foundation.
- [x] Add trusted roster reconciliation.
- [ ] Add alias review screen.
- [ ] Add import center and import status screen.
- [ ] Add validation issues screen.

Deliverable:

- Admin web app can browse imported data and review issues.

## Phase 4 - Leave and Availability

Goal: prevent duty allocation conflicts with leave.

Checklist:

- [ ] Add leave entry/import UI.
- [ ] Add leave types without balance calculation.
- [ ] Add approved/pending leave state.
- [ ] Add date availability checks.
- [ ] Add conflict detection against duty assignments.
- [ ] Log overrides if admin bypass is allowed.

Deliverable:

- Leave blocks are visible and enforced during rota creation/validation.

## Phase 5 - Rota Creation and Validation

Goal: allow admins to create new monthly rotas safely.

Checklist:

- [ ] Create monthly rota period setup.
- [ ] Generate duty slots from template/config.
- [ ] Add rota board/calendar interface.
- [ ] Add manual assignment workflow.
- [ ] Validate call level eligibility.
- [ ] Validate at least 24 hours between 24-hour duties.
- [ ] Validate configurable duty limits.
- [ ] Validate leave conflicts.
- [ ] Show warnings and explanations.

Deliverable:

- Admin can create and validate a monthly rota draft.

## Phase 6 - Assisted Allocation

Goal: suggest suitable people for empty duty slots.

Checklist:

- [ ] Build candidate eligibility engine.
- [ ] Score candidates by duty count, weekend burden, spacing, leave, unit/campus rules, and call level.
- [ ] Show why each candidate is suggested or blocked.
- [ ] Allow admin to accept, reject, or override suggestions.
- [ ] Later evaluate OR-Tools if full optimization is needed.

Deliverable:

- Admin gets explainable candidate suggestions while retaining control.

## Phase 7 - Export and Reports

Goal: produce final outputs for departmental use.

Checklist:

- [ ] Export finalized rota to Excel.
- [ ] Match familiar department spreadsheet layout where possible.
- [ ] Export analysis tables to Excel.
- [x] Build dashboard analytics.
- [ ] Add self-contained offline HTML report export if feasible.
- [ ] Add report audit metadata: date generated, source/rule version, filters.

Deliverable:

- Final rota and analysis can be shared outside the app.

## Phase 8 - Deployment and Hardening

Goal: make the app reliable for team use.

Checklist:

- [x] Dockerize backend/frontend/database.
- [ ] Add backup and restore workflow.
- [ ] Add production configuration.
- [ ] Add proper authentication.
- [ ] Add role expansion if needed.
- [ ] Add audit event review.
- [ ] Add error monitoring/logging.
- [ ] Add deployment documentation.

Deliverable:

- Deployable admin web app with persistent database and backups.
