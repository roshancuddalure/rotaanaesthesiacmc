"""Loopback-only integration fixtures for reviewed template/member generation."""

import argparse
import os
from pathlib import Path
import sys

if "--production" in sys.argv:
    os.environ["APP_ENV"] = "production"
from compute_smoke_server import app, engine, reset_data
from sqlalchemy.orm import Session
from sqlalchemy import delete, select
from app.models import DutySlot, Unit, RotaTemplateGenerationRun
from app.services.rota_setup import monthly_setup, update_scope_units
import uvicorn


@app.post("/__fixture/template")
def prepare_template():
    reset_data()
    with Session(engine) as db:
        db.execute(delete(DutySlot))
        _, scope = monthly_setup(db, "2026-05")
        units = list(db.scalars(select(Unit)))
        update_scope_units(
            db, scope, [u.id for u in units], [], True, True, "Disposable template test"
        )
    return {"prepared": True}


@app.get("/__fixture/generation")
def generation_state():
    with Session(engine) as db:
        return {
            "slots": db.query(DutySlot).count(),
            "runs": db.query(RotaTemplateGenerationRun).count(),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8023)
    parser.add_argument("--production", action="store_true")
    args = parser.parse_args()
    reset_data()
    if args.production:
        from fastapi.staticfiles import StaticFiles

        app.mount(
            "/",
            StaticFiles(
                directory=Path(__file__).resolve().parents[1] / "frontend/dist",
                html=True,
            ),
        )
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)
