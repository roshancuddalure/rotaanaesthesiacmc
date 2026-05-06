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


settings = Settings()
