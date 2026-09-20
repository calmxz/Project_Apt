# Reference

Technical lookup: how things work, gotchas, conventions. Durable "why" (decisions,
tradeoffs) belongs in `docs/decisions.md` instead.

## Backend

### Alembic migrations: live-Postgres safety checklist (C-12)

`backend/db/alembic/env.py` runs every migration inside one transaction, and the
live database is Supabase-managed Postgres serving traffic during `alembic upgrade
head`. Every new file under `backend/db/alembic/versions/` must follow these
patterns (the `migration-reviewer` agent enforces them before commit):

- **Revision ids are at most 32 characters.** `alembic_version.version_num` is
  `varchar(32)`; a longer id passes locally on sqlite and fails CI on Postgres.
- **Index builds on populated or hot tables run CONCURRENTLY**, which cannot run
  inside a transaction: wrap them in `with op.get_context().autocommit_block():`
  and use `op.create_index(..., postgresql_concurrently=True, if_not_exists=True)`
  or `op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ...")`.
- **Drop an INVALID namesake first.** A CONCURRENTLY build that fails part-way
  leaves an invalid index with the same name; `IF NOT EXISTS` matches on name only
  and would no-op, stamping the revision while the planner ignores the index. Probe
  `pg_index.indisvalid` and `DROP INDEX CONCURRENTLY IF EXISTS` when false (see
  `0025_learning_events_created_at.py` for the shape).
- **CHECK constraints on populated tables are two-step:** `ADD CONSTRAINT ... NOT
  VALID`, then `VALIDATE CONSTRAINT` (VALIDATE takes only SHARE UPDATE EXCLUSIVE, so
  reads and writes continue).
- **Unique constraints on populated tables** are built as a CONCURRENT unique index
  and then adopted with `ADD CONSTRAINT ... UNIQUE USING INDEX` (see
  `0023_worker_queue.py`).
- **Any migration touching a hot table** (`sessions`, `chat_messages`,
  `chunk_embeddings`, `documents`) opens with `op.execute("SET lock_timeout =
  '5s'")` so it fails fast instead of queueing behind a long query and then blocking
  everything behind itself.
- **No table rewrites in-transaction:** adding a column is nullable with no default
  (or a constant default, which Postgres 11+ stores in the catalog); type changes
  and volatile defaults rewrite the table under an exclusive lock.
- **Column drops or renames** must not remove anything deployed backend code still
  reads (`backend/db/models.py` and services); ship the code change first.
- **pgvector columns and indexes** keep dimension and distance operator consistent
  with `backend/services/pgvector_store.py`.
- **Linear chain:** `down_revision` points at the current head;
  `backend/tests/test_migration_chain.py` fails on branching heads.
- **Run against the direct connection (port 5432), not the transaction pooler
  (6543)** when a migration needs session-level state (`SET`, CONCURRENTLY,
  advisory locks). `DATABASE_URL` points at the pooler.

### Retrieval transaction tuning (F-10)

`pgvector_store.query_chunks` post-filters the HNSW scan on `documents.status =
'ready'`, so a scan that returns exactly k candidates can yield fewer than k
usable rows. Before the search, on Postgres only, it issues `SET LOCAL
hnsw.ef_search = <HNSW_EF_SEARCH>` (default 100, pgvector default 40) and `SET
LOCAL hnsw.iterative_scan = strict_order` (pgvector 0.8+): the scan re-enters the
graph until k rows survive the filter, preserving exact distance order
(`relaxed_order` would return rows slightly out of order and nothing downstream
tolerates that). Both are transaction-scoped, so they run immediately before the
select in the same transaction; `ef_search` is interpolated as a validated int
because SET cannot take bind parameters. The pair runs inside a Core-level
SAVEPOINT so an older pgvector that rejects the GUC does not abort the search.

`chunk_embeddings.doc_ready` was deliberately NOT denormalised: the join to
`documents` is needed anyway for `filename`, and the status predicate is a
PK-joined filter per candidate. If the table ever outgrows the HNSW build memory
budget, the next step is LIST-partitioning `chunk_embeddings` by a `session_id`
hash bucket, not a status column.

### Chat cost gate is a reservation, not a read (B-05)

`_prepare_turn_guards` no longer SELECTs today's spend and compares. It calls
`cost_meter.reserve_cost(db, user_id, LLM_TURN_RESERVE_USD)` (default 0.02): an
`INSERT .. ON CONFLICT DO UPDATE .. RETURNING` that adds the reserve and returns
the PRE-increment total. Concurrent turns serialise on the ledger row, so each
sees a distinct total and only those below the hard cap are admitted. The turn
releases the reserve with `adjust_cost(db, user_id, -reserve)` on every exit path
of `chat_stream` (normal, cancel, exception); a rate-limit reject after
`ensure_user` has committed releases explicitly. Consequences: the usage ledger
reads `reserve` high for the duration of a turn, and a process crash mid-turn
leaves the reserve on the ledger until UTC midnight.

### Liveness vs readiness (G-07)

`/health` and `/healthz` are liveness-only and must keep returning 200 while the
DB is down. `/ready` runs `SELECT 1` on a `READINESS_TIMEOUT_S` budget and returns
503 on failure or timeout; Render's `healthCheckPath` points at it, so a Supabase
outage fails the instance health check. `/ready` is `include_in_schema=False` and
not part of the openapi contract.

### Tool dispatch error surface (G-04)

`agent/tools.dispatch` hands the model a coarse `tool_failed` for unexpected
exceptions; the real exception text is only in the server WARNING log.
`pydantic.ValidationError` is the deliberate exception and passes through: the
model needs the field detail to repair its own call.

### Ingestion error strings (C-11)

`documents.error` is rendered verbatim by the frontend, so it only ever holds a
value from `ingestion_service.INGEST_ERROR_MESSAGES` (or upload.py's fixed
"storage write failed"). The raw exception goes to the log line only.

### CI drift guards

- `backend/tests/test_openapi_status_codes.py` AST-walks `backend/routes/*.py` and
  fails if a handler can raise a non-2xx status code that `docs/api/openapi.yaml`
  does not document under that path+method. It follows same-module helpers one
  level, plus one more for `_`-prefixed helpers; skips `include_in_schema=False`
  routes; never expects 500. Add a new `raise` and add the response block in the
  same commit. It also fails when the yaml documents a path+method with no route.
- `backend/tests/test_deploy_config.py` enforces bidirectional drift between
  `config.Settings`, `.env.example`, and `render.yaml` `envVars`. A new Settings
  field must be documented in `.env.example` (commented default is fine).
- Non-multipart request bodies above `MAX_JSON_BODY_BYTES` (default 64 KiB) are
  rejected with 413 `body_too_large` by `lib/body_limit.BodySizeLimitMiddleware`
  (pure ASGI, registered outermost) before any parsing. Multipart uploads have
  their own gate in `routes/upload.py`.

## Frontend

### Favicon generation

`frontend/scripts/gen-favicon.py` regenerates `frontend/public/favicon.ico` from the
Logo mark geometry, drawn directly with Pillow's `ImageDraw` (rounded rect, tab, two
round-capped lines) at 512px supersample, downscaled with LANCZOS to 16/32/48 and
saved as a single multi-size `.ico`. Pillow cannot rasterise SVG and cairosvg needs a
cairo DLL absent on Windows, so there is no SVG-to-ico path here.

Run: `python frontend/scripts/gen-favicon.py` (installs nothing itself; `pip install
pillow` first if missing).

`frontend/public/favicon.svg` is hand-maintained separately and is not generated by
this script. Its geometry must stay in sync with the mark in
`frontend/src/components/Logo.vue` whenever one changes.
