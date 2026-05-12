# Railway Deployment

This project is a monorepo with two deployable Railway services:

- `backend`: FastAPI API, Alembic migrations, PostgreSQL connection.
- `frontend`: Vite static build served by Vite preview.

## 1. Push The Repo To GitHub

From the project root:

```powershell
git status
git add backend/app/core/config.py backend/app/db/session.py backend/alembic/env.py backend/Dockerfile frontend/Dockerfile docs/RAILWAY_DEPLOYMENT.md
git commit -m "Prepare Railway deployment"
git push origin main
```

Use your branch name instead of `main` if needed.

## 2. Create Railway Services From GitHub

1. Create a Railway project.
2. Add a PostgreSQL database service.
3. Add a GitHub repo service for the backend.
4. Set the backend service root directory to `backend`.
5. Add another GitHub repo service for the frontend.
6. Set the frontend service root directory to `frontend`.
7. Generate a public domain for both the backend and frontend services.

Railway uses the `Dockerfile` found inside each service root.

## 3. Backend Variables

Set these on the backend service:

```env
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
FRONTEND_ORIGIN=https://your-frontend.up.railway.app
```

Replace `Postgres` with the actual name of your Railway PostgreSQL service if Railway shows a different service name.

The backend Docker image runs `alembic upgrade head` before starting FastAPI, so the empty Railway database will get the schema automatically.

## 4. Frontend Variables

Set this on the frontend service:

```env
VITE_API_BASE_URL=https://your-backend.up.railway.app
```

Important: Vite reads `VITE_*` variables at build time. After changing this value, redeploy the frontend service.

## 5. Import Local Database Into Railway PostgreSQL

The repo already has a Postgres dump:

```text
backups/duty_rota_2026_05_07.sql
```

In Railway, open the PostgreSQL service, enable or view the TCP Proxy connection details, then restore from your machine:

```powershell
psql "postgresql://USER:PASSWORD@HOST:PORT/DATABASE" -f ".\backups\duty_rota_2026_05_07.sql"
```

If the target database already has tables and the import complains that objects exist, use a clean Railway Postgres database or drop/recreate the public schema first:

```powershell
psql "postgresql://USER:PASSWORD@HOST:PORT/DATABASE" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "postgresql://USER:PASSWORD@HOST:PORT/DATABASE" -f ".\backups\duty_rota_2026_05_07.sql"
```

After import, redeploy or restart the backend so it runs any newer Alembic migrations on top of the imported data.

## 6. Smoke Test

Open:

```text
https://your-backend.up.railway.app/api/health
```

Expected response:

```json
{"status":"ok"}
```

Then open the frontend Railway domain and sign in.

## Common Failures

- Build uses the wrong folder: set backend root to `backend` and frontend root to `frontend`.
- App never becomes reachable: confirm each service uses Railway's `PORT`; the current Dockerfiles do.
- API calls fail from frontend: confirm `VITE_API_BASE_URL` is the public backend URL and redeploy frontend.
- CORS error: confirm backend `FRONTEND_ORIGIN` exactly matches the public frontend URL.
- Database driver error: keep the backend config normalization; Railway may provide `postgresql://`, while this app installs `psycopg`.
