# Backend

FastAPI backend and Python domain engine for the duty rota software.

## Responsibilities

- Import Excel/text source files.
- Normalize people, aliases, units, call levels, postings, leave, and duties.
- Run rota validation rules.
- Provide admin APIs.
- Produce Excel and report exports.

## Structure

```text
app/api/        HTTP routes
app/core/       settings and app infrastructure
app/db/         SQLAlchemy session/base
app/domain/     domain enums and validation rules
app/models/     SQLAlchemy models
app/services/   application services
tests/          pytest tests
```

## Planned Commands

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload
pytest
```

