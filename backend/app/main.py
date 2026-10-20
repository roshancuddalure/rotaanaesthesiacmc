"""FastAPI application factory and ASGI entrypoint (`uvicorn app.main:app`).

Wires together:
- CORS for the Vite dev server origins plus ``settings.frontend_origin``.
- A catch-all exception handler that logs the traceback and returns a generic 500.
- All REST routes under ``/api`` (see ``app.api.routes``).
- In the single-container deployment (root ``Dockerfile`` / Railway) the built Vite
  frontend is copied to ``backend/static`` and served from ``/`` by ``StaticFiles``.
  Locally the frontend runs separately on :5173 and proxies ``/api`` to :8000.
"""

from pathlib import Path
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import api_router
from app.core.config import settings
from app.security import ComputeSecurityMiddleware
from app.services.compute_limits import ComputeLimiter
from app.services.member_resolver import MemberResolutionError

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")
    app.state.compute_limiter = ComputeLimiter()
    allowed_origins = {
        settings.frontend_origin,
    }
    if settings.app_env.lower() != "production":
        allowed_origins.update({"http://localhost:5173", "http://127.0.0.1:5173",
                                "http://localhost:5174", "http://127.0.0.1:5174"})

    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "If-Match"],
    )
    app.add_middleware(ComputeSecurityMiddleware)

    @app.exception_handler(MemberResolutionError)
    async def member_resolution_handler(request: Request, exc: MemberResolutionError) -> JSONResponse:
        # Safety net: a resolver failure that escapes a route is bad input (for example an
        # explicit member id that does not exist), never a 500.
        from app.services.import_errors import resolution_detail

        return JSONResponse(status_code=422, content={"detail": resolution_detail(exc)})

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled API error path=%s method=%s", request.url.path, request.method)
        return JSONResponse(
            status_code=500,
            content={"detail": "Unexpected server error. Check backend logs for the recorded traceback."},
        )

    app.include_router(api_router, prefix="/api")
    if STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
    return app


app = create_app()
