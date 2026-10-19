"""Serve the production bundle on loopback with disposable in-memory fixture data.

Requires frontend/npm run build. Never opens the configured operational database.
"""

import os
from pathlib import Path

os.environ["APP_ENV"] = "production"

from compute_smoke_server import app, reset_data  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
import uvicorn  # noqa: E402

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    reset_data()
    app.mount("/", StaticFiles(directory=root / "frontend" / "dist", html=True))
    uvicorn.run(app, host="127.0.0.1", port=8021, access_log=False)
