# Duty Rota Software

Admin-facing web app for CMC Anaesthesia duty rota import, creation, validation, leave conflict checks, historical analysis, and Excel/report export.

## Current Status

Phase 0 foundation is in progress. The repository currently contains:

- project planning and decision logs in `Plan/`,
- FastAPI backend skeleton in `backend/`,
- framework-light Vite/TypeScript frontend skeleton in `frontend/`,
- PostgreSQL Docker Compose setup,
- initial domain enums, settings, routes, and test skeleton.

## Confirmed Direction

- Admin-only first version.
- Support both historical import/analysis and new monthly rota creation.
- Use Python/FastAPI for parsing, rules, validation, analytics, and exports.
- Use PostgreSQL for durable data.
- Use TypeScript/Vite with plain component modules for the frontend.
- Export final rota output to Excel.
- Import Jan 2025-May 2026 historical data as seed data.
- Enforce at least 24 hours between two 24-hour duties.
- Keep duty limits configurable in the admin panel.

## Repository Layout

```text
backend/          FastAPI backend and domain engine skeleton
frontend/         Vite + TypeScript admin UI skeleton
Plan/             planning docs, roadmap, decisions, logs
docker-compose.yml
.env.example
```

## Backend

Planned local commands:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload
pytest
```

## Frontend

Planned local commands:

```powershell
cd frontend
npm install
npm run dev
```

## Docker

Planned local command:

```powershell
docker compose up --build
```

## Evidence Rule

Before changing architecture or domain behavior, read:

- `Plan/05_confirmed_decisions.md`
- `Plan/06_project_operating_principles.md`
- `Plan/07_phased_roadmap.md`
- `Plan/08_new_session_checklist.md`

Important discoveries and implementation decisions must be logged in `Plan/development_log.md`.

