# Postgres + pgvector Setup

Phase 7 migrates AdaptLearn off SQLite + ChromaDB to Supabase-managed
Postgres with the `pgvector` extension. This doc covers the database side of
that migration: extension enablement, schema layout for embeddings, and
ivfflat tuning notes.

`DATABASE_URL` provisioning and the connection-string format are in
`docs/auth/supabase-setup.md` §3. This doc assumes you already have a
working `DATABASE_URL` and `psql` access.

## 1. Enable the `vector` extension

In Supabase: `SQL Editor → New query`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This is idempotent. You should also see `vector` listed under
`Database → Extensions` in the dashboard.

## 2. Apply the AdaptLearn baseline migration

The Phase 7 Alembic baseline (`backend/alembic/versions/0001_phase7_baseline.py`)
creates every application table — `users`, `sessions`, `chat_messages`,
`topic_profiles`, `documents`, `daily_cost_ledger`, etc. — and the
`chunk_embeddings` table that pgvector backs.

From the `backend/` directory, with `DATABASE_URL` set:

```bash
alembic upgrade head
```

Verify with:

```bash
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "\d chunk_embeddings"
```

## 3. `chunk_embeddings` schema

```sql
CREATE TABLE chunk_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_text  TEXT NOT NULL,
  chunk_index INT  NOT NULL,
  embedding   vector(1536) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chunk_embeddings_session_idx
  ON chunk_embeddings (session_id);

CREATE INDEX chunk_embeddings_embedding_idx
  ON chunk_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

Notes:

- `vector(1536)` matches LiteLLM's default OpenAI-compatible embedding
  dimension. If you swap to `text-embedding-004` (768-dim), update the
  column type and re-embed all chunks — pgvector enforces dimensionality.
- `ivfflat` (vs `hnsw`) was chosen because Supabase Postgres 15 ships with
  pgvector 0.7+ which supports both, but `ivfflat` is well-tested, faster
  to build, and adequate for the corpus sizes we expect (<100k chunks per
  user in v1). Revisit `hnsw` if recall/latency profile changes.
- The session-scoped B-tree on `session_id` is what most retrieval queries
  filter on first; the ivfflat index then narrows the cosine search within
  that subset.

## 4. ivfflat tuning notes

- `lists = 100` is a reasonable default for tables in the 1k–1M row range.
  Heuristic: `lists ≈ rows / 1000` for <1M rows, `lists ≈ sqrt(rows)` above.
- Probes (query-time accuracy/speed tradeoff) is set per-session in the
  retrieval service:
  ```sql
  SET LOCAL ivfflat.probes = 10;
  ```
  Higher = better recall, more rows scanned. 10 is a common starting point;
  drop to 1-5 if latency becomes an issue, raise to 20-40 if retrieval
  misses obvious matches.
- ivfflat indexes must be **rebuilt** if the data distribution changes a
  lot (e.g. after bulk imports). `REINDEX INDEX chunk_embeddings_embedding_idx;`
  is the lever.

## 5. Daily cost ledger

`daily_cost_ledger` is plain Postgres, no pgvector needed:

```sql
CREATE TABLE daily_cost_ledger (
  user_id        TEXT NOT NULL,
  date_utc       DATE NOT NULL,
  cost_usd_cents NUMERIC(10, 2) NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date_utc)
);
```

The composite PK is the upsert target; `backend/services/cost_meter.py`
`record_cost()` writes to `(user_id, today_utc)` on every paid LLM call.
The `daily_cost_cap_reached` envelope and `X-Cost-Warning` header read
straight off this table.

## 6. Test database

For backend pytest against a real Postgres (instead of mocked):

```bash
docker run -d --name adaptlearn-test-pg \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=adaptlearn_test \
  -p 55432:5432 \
  pgvector/pgvector:pg16

DATABASE_URL=postgresql+psycopg://postgres:test@127.0.0.1:55432/adaptlearn_test \
  alembic upgrade head

DATABASE_URL=postgresql+psycopg://postgres:test@127.0.0.1:55432/adaptlearn_test \
  pytest
```

The `pgvector/pgvector:pg16` image ships with the extension pre-installed;
the Alembic baseline runs `CREATE EXTENSION IF NOT EXISTS vector` for you.

## 7. Backup notes (forward-looking)

Phase 8 (Fly.io deploy) will add R2 backups. Until then, Supabase's built-in
daily backups (free tier: 7-day retention) are the only recovery point. Take
a manual `pg_dump` before any destructive migration:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl > backup_$(date +%Y%m%d).sql
```
