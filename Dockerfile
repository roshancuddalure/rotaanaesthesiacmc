FROM node:22-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/index.html ./
COPY frontend/src ./src

RUN npm ci
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=frontend-build /frontend/dist ./static

RUN pip install --no-cache-dir -e .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
