"""Runtime settings loaded from environment variables / ``.env`` files (pydantic-settings).

Lookup order for ``.env``: repo root, ``backend/``, then the current working directory.
``sqlalchemy_database_url`` rewrites Railway/Heroku style ``postgres://`` URLs to the
``postgresql+psycopg://`` driver form that SQLAlchemy needs.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    app_name: str = "Duty Rota Software"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://duty_rota:duty_rota@localhost:5432/duty_rota"
    frontend_origin: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env", ".env"),
        extra="ignore",
    )

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if self.database_url.startswith("postgres://"):
            return self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        return self.database_url


settings = Settings()
