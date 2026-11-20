"""Loopback-only objective disclosure fixture; canonical data is SQLite memory."""

import compute_smoke_server as fixture
import uvicorn

from app.core.config import settings

settings.ot_calendar_enabled = False
settings.rota_compute_enabled = True
settings.rota_intelligence_enabled = True
app = fixture.app


@app.get("/__fixture/objective-identity")
def identity():
    return {"identity": "objective-basis-memory-fixture-v1"}


if __name__ == "__main__":
    fixture.reset_data()
    uvicorn.run(app, host="127.0.0.1", port=8043, access_log=False)
