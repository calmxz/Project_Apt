import pytest

from config import assert_prod_database


def test_prod_sqlite_refused():
    with pytest.raises(RuntimeError, match="Postgres"):
        assert_prod_database("prod", "sqlite:///./data/app.db")


def test_prod_postgres_ok():
    assert assert_prod_database("prod", "postgresql://u:p@host:5432/db") is None


def test_dev_sqlite_ok():
    assert assert_prod_database("dev", "sqlite:///./data/app.db") is None
