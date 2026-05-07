from fastapi import APIRouter

from app.api.v1.analysis import router as analysis_router
from app.api.v1.auth import router as auth_router
from app.api.v1.admin_mappings import router as admin_mappings_router
from app.api.v1.diagnostics import router as diagnostics_router
from app.api.v1.health import router as health_router
from app.api.v1.historical_imports import router as historical_imports_router
from app.api.v1.leave import router as leave_router
from app.api.v1.members import router as members_router
from app.api.v1.metadata import router as metadata_router
from app.api.v1.unit_management import router as unit_management_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, prefix="/v1", tags=["auth"])
api_router.include_router(analysis_router, prefix="/v1", tags=["analysis"])
api_router.include_router(admin_mappings_router, prefix="/v1", tags=["admin mappings"])
api_router.include_router(diagnostics_router, prefix="/v1", tags=["diagnostics"])
api_router.include_router(historical_imports_router, prefix="/v1", tags=["historical imports"])
api_router.include_router(leave_router, prefix="/v1", tags=["leave"])
api_router.include_router(members_router, prefix="/v1", tags=["members"])
api_router.include_router(metadata_router, prefix="/v1", tags=["metadata"])
api_router.include_router(unit_management_router, prefix="/v1", tags=["unit management"])
