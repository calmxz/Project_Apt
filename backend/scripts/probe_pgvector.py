"""Probe Supabase Postgres: confirm pgvector + report schema state."""
from pathlib import Path
import os
import sys

env = Path(__file__).resolve().parents[2] / ".env"
for line in env.read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

url = os.environ.get("DATABASE_URL", "")
if not url:
    sys.exit("DATABASE_URL not set")
if url.startswith("postgresql://"):
    url = url.replace("postgresql://", "postgresql+psycopg://", 1)
elif url.startswith("postgres://"):
    url = url.replace("postgres://", "postgresql+psycopg://", 1)

from sqlalchemy import create_engine, text

engine = create_engine(url)
with engine.connect() as conn:
    r = conn.execute(text("SELECT extname, extversion FROM pg_extension WHERE extname='vector'")).fetchall()
    print("pgvector:", r if r else "NOT INSTALLED")
    v = conn.execute(text("SELECT version()")).scalar()
    print("pg:", (v or "")[:80])
    tbls = conn.execute(text("""
        SELECT tablename FROM pg_tables
        WHERE schemaname='public' ORDER BY tablename
    """)).fetchall()
    print("tables:", [t[0] for t in tbls])
    has_chunk = conn.execute(text("""
        SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='chunk_embeddings')
    """)).scalar()
    print("chunk_embeddings exists:", has_chunk)
