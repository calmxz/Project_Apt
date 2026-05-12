from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Idempotent dev-only column additions. Each phase appends to this tuple.
# SQLAlchemy's create_all does not ALTER existing tables, so existing dev DBs
# need column adds applied separately. Production would use Alembic.
_MIGRATIONS: tuple[str, ...] = (
    "ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE chat_messages ADD COLUMN citations_json TEXT NOT NULL DEFAULT '[]'",
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for sql in _MIGRATIONS:
            try:
                conn.exec_driver_sql(sql)
            except OperationalError:
                pass
