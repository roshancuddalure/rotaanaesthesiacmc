"""Run migration and concurrency checks in a new loopback-only disposable PostgreSQL database."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from sqlalchemy import create_engine, text  # noqa: E402
from app.db.session import engine  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    if engine.url.host not in {"localhost", "127.0.0.1"}:
        sys.exit("Requires a loopback PostgreSQL connection; no database was created.")
    name = "duty_rota_test_compute_" + uuid4().hex
    admin = create_engine(engine.url, isolation_level="AUTOCOMMIT")
    created = False
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
        created = True
        env = {
            **os.environ,
            "DUTY_ROTA_TEST_POSTGRES_URL": engine.url.set(
                database=name
            ).render_as_string(hide_password=False),
        }
        migration_env = {**env, "DATABASE_URL": env["DUTY_ROTA_TEST_POSTGRES_URL"]}
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=root / "backend",
            env=migration_env,
            check=True,
        )
        subprocess.run(
            [sys.executable, "-m", "alembic", "current"],
            cwd=root / "backend",
            env=migration_env,
            check=True,
        )
        from sqlalchemy.orm import Session
        from app.models import Person

        test_engine = create_engine(engine.url.set(database=name))
        with Session(test_engine) as db:
            db.add(
                Person(
                    canonical_name="Migration preservation sentinel",
                    active_status="active",
                )
            )
            db.commit()
        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "20261018_0020"],
            cwd=root / "backend",
            env=migration_env,
            check=True,
        )
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=root / "backend",
            env=migration_env,
            check=True,
        )
        with Session(test_engine) as db:
            assert (
                db.query(Person)
                .filter_by(canonical_name="Migration preservation sentinel")
                .count()
                == 1
            )
        test_engine.dispose()
        tests = (
            []
            if args.full
            else [
                "tests/test_import_concurrency.py",
                "tests/test_rota_compute_concurrency.py",
                "tests/test_template_compute_concurrency.py",
            ]
        )
        result = subprocess.run(
            [sys.executable, "-m", "pytest", *tests, "-q", "--tb=short"],
            cwd=root / "backend",
            env=env,
        )
        sys.exit(result.returncode)
    finally:
        if created:
            # Only this freshly generated, explicitly checked database can be dropped.
            assert (
                name.startswith("duty_rota_test_compute_")
                and len(name) == len("duty_rota_test_compute_") + 32
            )
            with admin.connect() as conn:
                conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()
