"""B-10: engine kwargs - pre_ping + explicit pool sizing on Postgres."""
from db import database


def test_postgres_engine_kwargs_have_pool_config():
    kw = database._build_engine_kwargs("postgresql+psycopg://u:p@h/db")
    assert kw["pool_pre_ping"] is True
    assert kw["pool_size"] >= 1
    assert kw["max_overflow"] >= 0
    assert kw["pool_recycle"] == 1800
    assert kw["connect_args"] == {"prepare_threshold": None}


def test_sqlite_engine_kwargs_unchanged():
    kw = database._build_engine_kwargs("sqlite:///x.db")
    assert kw == {"connect_args": {"check_same_thread": False}}
