"""Dialect-specific INSERT support (Postgres prod, SQLite tests).

Leaf module: services needing ON CONFLICT upserts import from here so
rate_limit and cost_meter stay decoupled.
"""

from sqlalchemy.orm import Session


def dialect_insert(db: Session):
    """Return the dialect-specific INSERT that supports ON CONFLICT.

    Both Postgres (prod) and SQLite (tests) implement the on_conflict_*
    methods; the dialect-agnostic sqlalchemy.insert() does not.
    """
    name = db.get_bind().dialect.name
    if name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert
    return _insert
