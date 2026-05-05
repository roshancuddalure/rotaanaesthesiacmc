from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.api.v1.metadata import router as metadata_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(metadata_router, prefix="/v1", tags=["metadata"])

