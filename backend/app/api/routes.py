from fastapi import APIRouter

from app.api.v1.analysis import router as analysis_router
from app.api.v1.auth import router as auth_router
from app.api.v1.call_clusters import router as call_clusters_router
from app.api.v1.admin_mappings import router as admin_mappings_router
from app.api.v1.diagnostics import router as diagnostics_router
from app.api.v1.health import router as health_router
from app.api.v1.historical_imports import router as historical_imports_router
from app.api.v1.leave import router as leave_router
from app.api.v1.members import router as members_router
from app.api.v1.metadata import router as metadata_router
from app.api.v1.rota_assignments import router as rota_assignments_router
from app.api.v1.rota_auto_fill import router as rota_auto_fill_router
from app.api.v1.rota_candidates import router as rota_candidates_router
from app.api.v1.rota_publish import router as rota_publish_router
from app.api.v1.rota_rules import router as rota_rules_router
from app.api.v1.rota_review import router as rota_review_router
from app.api.v1.rota_safety import router as rota_safety_router
from app.api.v1.rota_setup import router as rota_setup_router
from app.api.v1.rota_template import router as rota_template_router
from app.api.v1.unit_management import router as unit_management_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, prefix="/v1", tags=["auth"])
api_router.include_router(call_clusters_router, prefix="/v1", tags=["call clusters"])
api_router.include_router(analysis_router, prefix="/v1", tags=["analysis"])
api_router.include_router(admin_mappings_router, prefix="/v1", tags=["admin mappings"])
api_router.include_router(diagnostics_router, prefix="/v1", tags=["diagnostics"])
api_router.include_router(historical_imports_router, prefix="/v1", tags=["historical imports"])
api_router.include_router(leave_router, prefix="/v1", tags=["leave"])
api_router.include_router(members_router, prefix="/v1", tags=["members"])
api_router.include_router(metadata_router, prefix="/v1", tags=["metadata"])
api_router.include_router(rota_assignments_router, prefix="/v1", tags=["rota assignments"])
api_router.include_router(rota_auto_fill_router, prefix="/v1", tags=["rota auto fill"])
api_router.include_router(rota_candidates_router, prefix="/v1", tags=["rota candidates"])
api_router.include_router(rota_publish_router, prefix="/v1", tags=["rota publish"])
api_router.include_router(rota_rules_router, prefix="/v1", tags=["rota rules"])
api_router.include_router(rota_review_router, prefix="/v1", tags=["rota review"])
api_router.include_router(rota_safety_router, prefix="/v1", tags=["rota safety"])
api_router.include_router(rota_setup_router, prefix="/v1", tags=["rota setup"])
api_router.include_router(rota_template_router, prefix="/v1", tags=["rota template"])
api_router.include_router(unit_management_router, prefix="/v1", tags=["unit management"])
