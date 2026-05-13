# Railway Deployment Notes

This note records the deployment decisions, mistakes, fixes, and checks from the first Railway deployment of the Duty Rota app. It exists so future deployment work does not depend on chat history.

## Target Shape

Use one Railway web service plus one Railway PostgreSQL service.

The root `Dockerfile` is the deployment entrypoint. It:

1. Builds the Vite frontend.
2. Copies the frontend `dist/` output into the backend image at `/app/static`.
3. Installs the FastAPI backend.
4. Runs `backend/docker-entrypoint.sh`, which applies Alembic migrations.
5. Starts Uvicorn.

Do not deploy `backend/` and `frontend/` as separate Railway services unless deliberately returning to a split-service architecture.

## Correct Railway Service Settings

For the single-service deployment:

- Source repo: `roshancuddalure/Dutyrotaanaesthesia`
- Production branch: `main`
- Root directory: blank / repository root
- Dockerfile path: `Dockerfile`
- Public networking port: match the Uvicorn port shown in deploy logs, currently `8080`
- Healthcheck path: `/api/health`

Required web service variables:

```env
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
FRONTEND_ORIGIN=https://<active-service-domain>.up.railway.app
```

If the Railway PostgreSQL service is not named `Postgres`, use the actual service name in the variable reference.

Do not set `VITE_API_BASE_URL` for the single-service Railway deployment. The frontend should call `/api/...` on the same origin.

## GitHub And Autodeploy Issues Found

The local Git state was healthy:

- branch: `main`
- remote: `https://github.com/roshancuddalure/Dutyrotaanaesthesia.git`
- tracking: `main -> origin/main`
- latest local commit matched `origin/main`

Railway still showed `GitHub Repo not found` and sometimes did not list the repo. That was not a project file problem. It indicates Railway's GitHub App did not have usable permission for the repo or had stale installation state.

Fix path:

1. Open GitHub app installations: `https://github.com/settings/installations`
2. Configure the Railway app.
3. Grant access to `Dutyrotaanaesthesia`, or temporarily grant access to all repositories.
4. In Railway, disconnect and reconnect the source repo.
5. If still broken, uninstall and reinstall the Railway GitHub App.
6. Disable `Wait for CI` unless GitHub Actions are configured and passing.

Autodeploy depends on Railway detecting the repo and connecting `main` as the production branch.

## App Failed To Respond / Bad Gateway

Observed symptom:

- Deploy logs showed Uvicorn running and Railway internal healthcheck returning `GET /api/health 200 OK`.
- Browser still showed Railway `Application failed to respond` or Bad Gateway.

Important diagnosis:

- Internal healthcheck success means the container process and app are alive.
- Public Bad Gateway can still happen if the public domain points to the wrong Railway service or the wrong port.
- The active domain changed during troubleshooting. Always copy the domain from the current service's `Settings -> Networking`, not from an old browser tab.

Port correction:

- Earlier advice used port `8000`.
- Deploy logs later showed Uvicorn running on `0.0.0.0:8080`.
- The root Dockerfile was aligned to expose/default to `8080`.
- Public networking should be regenerated for the port shown in current deploy logs.

If this repeats:

1. Open the latest deploy logs.
2. Find `Uvicorn running on http://0.0.0.0:<PORT>`.
3. In Railway Networking, ensure the public domain targets that `<PORT>`.
4. Open `/api/health`.
5. While opening `/api/health`, watch deploy logs. If no new request appears, the browser is hitting the wrong domain/service.

## Frontend Static Serving Issue

Observed symptom:

- `/api/health` worked.
- `/` returned `{"detail":"Not Found"}`.

Cause:

- FastAPI looked for frontend static files in the wrong directory.
- Docker copied frontend build output to `/app/static`.
- `STATIC_DIR` initially resolved incorrectly.

Fix:

- `backend/app/main.py` mounts static frontend files from the backend runtime static directory.
- The root Dockerfile copies `frontend/dist` to `/app/static`.

## Production API URL Issue

Observed symptom:

- Login page loaded.
- Sign in showed `Failed to fetch`.

Cause:

- Frontend originally defaulted API calls to `http://localhost:8000`.
- In a deployed browser, `localhost` means the user's machine, not Railway.

Fix:

- Production defaults to same-origin API calls.
- Local development explicitly uses `http://localhost:8000` when `import.meta.env.DEV` is true.
- Railway should not set `VITE_API_BASE_URL` in the single-service setup.

## Local Development API Issue

Observed symptom:

- After changing production API behavior, local dev showed API request failures or `404`.

Cause:

- Local Vite runs on `localhost:5173`, while FastAPI runs on `localhost:8000`.
- Same-origin `/api/...` calls hit Vite, not FastAPI.

Fix:

- `frontend/src/services/api.ts` now uses:
  - `http://localhost:8000` during Vite dev,
  - same-origin in production.
- A Vite proxy config was also added for local convenience, but the explicit dev API URL is the reliable behavior.

Local dev checklist:

1. Backend: `http://localhost:8000/api/health` returns `{"status":"ok"}`.
2. Frontend: open `http://localhost:5173`.
3. If login fails, hard refresh and ensure old Vite windows are closed.

## Railway PostgreSQL Migration

Local database:

- database: `duty_rota`
- host: `localhost:5432`
- public tables: 31

Railway migration approach:

- `psql` and `pg_dump` were not installed locally.
- Migration used Python with `psycopg`/SQLAlchemy.
- Railway DB was overwritten intentionally.
- Final verification compared local and Railway row counts table by table.

Final migration verification:

```text
checked_tables=31
railway_total_rows=46238
railway_nonempty_tables=24
all_counts_match=true
```

One issue occurred:

- The full copy command timed out after most rows were copied.
- `user_sessions` was short by one row.
- That table was recopied separately and then all counts matched.

Security note:

- Railway database URLs were stored locally under `cred/`.
- `cred/` and `Debug/` were added to `.gitignore`.
- Existing tracked debug/log/credential-like files from earlier history may still need `git rm --cached` cleanup if the repo should be hardened.

## Useful Smoke Tests

Railway:

```text
https://<active-service-domain>.up.railway.app/api/health
https://<active-service-domain>.up.railway.app
```

Local:

```text
http://localhost:8000/api/health
http://localhost:5173
```

Expected health response:

```json
{"status":"ok"}
```
