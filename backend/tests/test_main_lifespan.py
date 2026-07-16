"""Lifespan startup guard: prod must not boot without SUPABASE_URL configured.

Dev/test must NOT be affected — CI's backend job and the `client` fixture in
conftest.py never set SUPABASE_URL, and both rely on lifespan() completing
without raising.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main as main_module
from config import settings
from db.database import Base


@pytest.fixture
def isolated_db(monkeypatch):
    """F-26: lifespan now opens SessionLocal() to run the startup reaper.
    Route it at an isolated in-memory sqlite (with tables) instead of the
    real db.database engine -- these tests must not touch a real database
    (Postgres in dev, an unmigrated file in CI) just to exercise the guard."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(main_module, "create_tables", lambda: None)
    monkeypatch.setattr(
        main_module,
        "SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=engine),
    )
    return engine


@pytest.mark.asyncio
async def test_prod_without_supabase_url_raises(monkeypatch, isolated_db):
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "database_url", "postgresql://u:p@host:5432/db")
    monkeypatch.setattr(settings, "supabase_url", "")

    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        async with main_module.lifespan(main_module.app):
            pass


@pytest.mark.asyncio
async def test_dev_without_supabase_url_does_not_raise(monkeypatch, isolated_db):
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "supabase_url", "")

    async with main_module.lifespan(main_module.app):
        pass


@pytest.mark.asyncio
async def test_prod_with_supabase_url_does_not_raise(monkeypatch, isolated_db):
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "database_url", "postgresql://u:p@host:5432/db")
    monkeypatch.setattr(settings, "supabase_url", "https://real-project.supabase.co")
    monkeypatch.setattr(main_module, "validate_jwks_startup", lambda: None)

    async with main_module.lifespan(main_module.app):
        pass


@pytest.mark.asyncio
async def test_reaper_failure_does_not_abort_startup(monkeypatch, isolated_db):
    """Final-review fix wave, Finding 3: reap_stale_pending is best-effort
    startup cleanup, not a boot precondition. A transient DB error during
    the reap UPDATE must not prevent the app from finishing startup."""
    monkeypatch.setattr(settings, "env", "dev")
    monkeypatch.setattr(settings, "supabase_url", "")

    def boom(db):
        raise RuntimeError("reap query failed")

    monkeypatch.setattr(main_module.ingestion_service, "reap_stale_pending", boom)

    async with main_module.lifespan(main_module.app):
        pass
