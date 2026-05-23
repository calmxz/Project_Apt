from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings


class Base(DeclarativeBase):
    pass


def _normalized_url(url: str) -> str:
    """Force psycopg3 driver for bare postgresql:// URLs. SQLAlchemy defaults
    to psycopg2 otherwise, which we don't ship. Idempotent for explicit drivers."""
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


_db_url = _normalized_url(settings.database_url)
_is_sqlite = _db_url.startswith("sqlite:")
_engine_kwargs: dict = {}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(_db_url, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Legacy idempotent column additions for pre-Alembic sqlite dev DBs.
# Postgres goes through Alembic (see backend/db/alembic/). This block is a
# no-op on Postgres because the columns are part of the baseline revision.
_MIGRATIONS: tuple[str, ...] = (
    "ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE chat_messages ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE sessions ADD COLUMN kw_index_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE documents ADD COLUMN error TEXT",
    "ALTER TABLE documents ADD COLUMN page_count INTEGER",
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
    if _is_sqlite:
        with engine.begin() as conn:
            for sql in _MIGRATIONS:
                try:
                    conn.exec_driver_sql(sql)
                except OperationalError:
                    pass
