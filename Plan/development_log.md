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
