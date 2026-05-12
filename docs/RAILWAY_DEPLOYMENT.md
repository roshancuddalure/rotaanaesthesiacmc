# Railway Deployment

The easiest Railway setup is now one deployable web service plus one PostgreSQL service.

The root `Dockerfile` builds the Vite frontend and serves it from the FastAPI backend. That means Railway can deploy the repo root directly from GitHub without separate frontend/backend services.

## Recommended: One Railway Web Service

Create:

- one Railway PostgreSQL service
- one Railway GitHub web service from this repo root

## 1. Push The Repo To GitHub

From the project root:

```powershell
git status
git add Dockerfile .dockerignore railway.json backend/app/main.py backend/app/core/config.py backend/app/db/session.py backend/alembic/env.py docs/RAILWAY_DEPLOYMENT.md
git commit -m "Prepare Railway deployment"
git push origin main
```

Use your branch name instead of `main` if needed.

## 2. Create Railway Services From GitHub

1. Create a Railway project.
2. Add a PostgreSQL database service.
3. Add a GitHub repo service from this repository.
4. Keep the service root as the repository root.
5. Railway should use the root `Dockerfile` and `railway.json`.
6. Generate a public domain for the web service.

Do not set the root directory to `backend` or `frontend` for the recommended one-service deployment.

## 3. Web Service Variables

Set these on the web service:

```env
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
FRONTEND_ORIGIN=https://your-web-service.up.railway.app
```

Replace `Postgres` with the actual name of your Railway PostgreSQL service if Railway shows a different service name.

You do not need `VITE_API_BASE_URL` in the one-service setup. The frontend uses the same Railway domain as the API.

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

After import, redeploy or restart the web service so it runs any newer Alembic migrations on top of the imported data.

## 6. Smoke Test

Open:

```text
https://your-web-service.up.railway.app/api/health
```

Expected response:

```json
{"status":"ok"}
```

Then open the web service Railway domain and sign in.

## Common Failures

- Build uses the wrong folder: for the recommended setup, keep the Railway root directory as the repository root.
- App never becomes reachable: confirm each service uses Railway's `PORT`; the current Dockerfiles do.
- API calls fail from frontend: in the one-service setup, leave `VITE_API_BASE_URL` unset.
- CORS error: confirm `FRONTEND_ORIGIN` exactly matches the public web service URL.
- Database driver error: keep the backend config normalization; Railway may provide `postgresql://`, while this app installs `psycopg`.

## Optional: Separate Frontend And Backend Services

If you prefer separate Railway services later:

1. Backend service root directory: `backend`.
2. Frontend service root directory: `frontend`.
3. Backend variable `FRONTEND_ORIGIN=https://your-frontend.up.railway.app`.
4. Frontend variable `VITE_API_BASE_URL=https://your-backend.up.railway.app`.
5. Redeploy the frontend after setting `VITE_API_BASE_URL`.
