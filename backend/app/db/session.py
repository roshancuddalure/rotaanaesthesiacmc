"""SQLAlchemy engine, session factory and the declarative ``Base`` for all models.

``get_db`` is the FastAPI dependency that yields one session per request. Services
call ``db.commit()`` themselves; nothing here commits or rolls back automatically, so
an exception that escapes a service leaves the transaction uncommitted and it is
discarded when the session closes.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.sqlalchemy_database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
