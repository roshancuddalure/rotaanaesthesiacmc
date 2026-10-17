"""Liveness probe used by Railway (``railway.json`` healthcheckPath) and ``start.ps1``."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}

