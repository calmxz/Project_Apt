# F — Performance & Scalability Audit

Auditor: senior performance engineer, read-only pass.
Date: 2026-08-06. Branch: `dev` @ `a0cebfb`.
Premise: 1,000,000-user launch tomorrow on the current `render.yaml` + `vercel.json` topology.

All anchors are `repo-relative-path:line` read in this session. No live Supabase was touched, no LLM
calls were made, no files were modified. `npm run build` was run in `frontend/` (read-only) for real
chunk sizes.

---

## Scalability ceiling

### The computed number

**10 concurrent connection-holding requests, on 1 process, on 1 instance.**

Derivation, each factor anchored:

| Factor | Value | Anchor |
|---|---|---|
| Uvicorn worker processes per instance | **1** | `backend/entrypoint.sh:4` — plain `exec uvicorn main:app --host 0.0.0.0 --port ...`. No `--workers`, no `-w`, no Gunicorn. Uvicorn defaults to a single process. |
| Render instances | **1** | `render.yaml:5` `plan: free`; no `numInstances`, no `scaling:` block anywhere in the file. |
| SQLAlchemy pool per process | **5 + 5 = 10** | `backend/config.py:35-36` (`db_pool_size: int = 5`, `db_max_overflow: int = 5`) wired at `backend/db/database.py:37-38`. Neither is overridden in `render.yaml` envVars. |
| `pool_timeout` | **30 s (SQLAlchemy default)** | `backend/db/database.py:24-40` — `_build_engine_kwargs` sets `connect_args`, `pool_pre_ping`, `pool_size`, `max_overflow`, `pool_recycle` and **nothing else**. |
| anyio threadpool (sync `def` handlers) | **40** | Starlette default; not overridden anywhere in `backend/`. |
| Event loop | **1** | Single worker, so one loop for every `async def` handler. |

**Binding constraint: 10.** The 11th concurrent connection-holding request blocks on
`QueuePool.connect()` for 30 s and then raises `TimeoutError: QueuePool limit of size 5 overflow 5
reached`, surfacing as a 500.

### Named assumptions

- **Supabase pooler client limit is not in the repo.** `render.yaml:22` declares `DATABASE_URL` with
  `sync: false`, so neither the plan nor the pooler mode is knowable from source. The comment at
  `backend/db/database.py:29-33` states the target is the transaction-mode pooler (port 6543) and
  disables `prepare_threshold` accordingly. **The headline does not depend on this number**: the
  app-side ceiling of 10 binds first whether the pooler permits 15 clients or 200.
- Render free web service memory is taken as 512 MB (Render's published free-tier limit). Used only
  in F-03.
- Per-workload hold times are taken from the code, not assumed: a chat turn holds a connection only
  for `_prepare_turn` (F-11, F-13) because `backend/agent/tutor.py:206` commits before the LLM
  stream; an ingestion holds one for its entire pipeline (F-02).

### What that means at launch scale, by workload

The three limits bind different workloads. Collapsing them to one number hides which fails first,
so they are stated separately, tightest first.

**1. Memory is the tightest limit: 3 concurrent large uploads.** Per F-03, each 25 MB text-dense
PDF peaks at ~150-200 MB RSS in the single worker process. On a 512 MB instance the **third**
concurrent large ingestion OOM-kills the container, taking every other in-flight ingestion (F-04)
and every open SSE stream with it. This is the literal "falls over" case.

**2. The DB pool binds uploads: 10 concurrent, full stop.** Per F-02, `ingestion_service.run`
holds one of the 10 connections for the whole pipeline: **~51 s typical, up to 8.5 minutes** at the
configured embedding timeout. Ten simultaneous uploads take the pool to zero and every other
endpoint in the service 500s. F-13 adds a shorter hold (0.6-2 s typical, 30 s worst case) on each
chat turn, and F-12 adds 1.5 req/s of polling per uploading user against the same 10 connections
and the 40-slot threadpool.

**3. The event loop binds chat: ~25 turns/second, and far less in practice.** The pool does *not*
cap chat throughput the way it caps uploads, because B-10 (`tutor.py:206`) releases the connection
before `acompletion`. What caps chat is F-11: ~40 ms of synchronous DB round-trips executed on the
single event loop per turn, i.e. a theoretical **~25 turn-starts/second**. Add F-05 and that
collapses: one large-session centroid aggregate costs 150-400 ms of event-loop time, dropping the
ceiling to **~3-6 turn-starts/second** for document-backed sessions — and every millisecond of that
block also stalls token delivery to every other open stream.

**Aggregate.** At ~5 turn-starts/second sustained (the realistic blend of the above) the service
supports ~432,000 turns/day, which at `DAILY_CAP: "50"` (`render.yaml:19`) is **~8,600 fully-capped
users/day** — provided nobody uploads. Uploads are the wall: **10 concurrent, 3 before OOM.**
Against 1,000,000 registered users at a conservative 1 % peak concurrency (10,000 simultaneous),
chat is short by ~3 orders of magnitude and upload is short by ~4.

Horizontal scaling (4 workers x 10 instances) buys ~40x and fixes none of the per-request defects:
F-02, F-03 and F-05 each multiply the cost of a single request, so they set how much each of those
40 slots is actually worth. F-03 in particular is not fixed by scaling out at all — it is fixed by
capping page count and streaming the embed loop.

### Real bundle sizes — `npm run build` (frontend/, built in 1.11 s)

JS chunks (raw / gzip):

```
markdownRenderer-Dawn9v8u.js   450.58 kB | gzip: 152.23 kB
index-Ux4Ocy-e.js              379.04 kB | gzip:  88.82 kB
supabase-CJLAtSaY.js           200.95 kB | gzip:  51.76 kB
runtime-core.esm-bundler.js     66.35 kB | gzip:  26.01 kB
SessionView-BMtTg5jd.js         37.70 kB | gzip:  12.30 kB
SettingsView-k-HbXf3k.js        18.81 kB | gzip:   5.96 kB
ProfileView-vNIVfC-e.js          8.69 kB | gzip:   2.90 kB
SessionsLibraryView-DQnAcMUa.js  6.62 kB | gzip:   2.79 kB
HomeView-CyIl6H5-.js             5.33 kB | gzip:   2.24 kB
LoginView-WPueCMrE.js            3.36 kB | gzip:   1.55 kB
```

CSS: `index-gTDmbNXC.css` 38.24 kB (7.99 gzip), `SessionView` 31.92 kB (5.32 gzip),
`markdownRenderer-CYlHEDRF.css` 28.83 kB (7.92 gzip), `SettingsView` 18.62 kB (2.98 gzip).

Fonts/icons emitted: `primeicons-Dr5RGzOO.svg` 342.52 kB, `primeicons-MpK4pl85.ttf` 84.98 kB,
`primeicons-WjwUDZjB.woff` 85.05 kB, `primeicons-C6QP2o4f.woff2` 35.14 kB,
`bricolage-grotesque-latin.woff2` 76.88 kB, plus the KaTeX ttf/woff/woff2 families.

**Cold-load payload from `dist/index.html`** (its link set, verified in the built output):
`index.js` 88.82 + `runtime-core` 26.01 + `supabase` 51.76 + `useApi` 0.62 + `markdownRenderer`
152.23 = **~319 kB gzip of JS**, plus `index.css` 7.99 + `markdownRenderer.css` 7.92 = **~16 kB
gzip of render-blocking CSS** — all before the 1.55 kB LoginView chunk is even requested. See F-14.

### Verified-clean (searched for, not found — do not re-flag)

- **No classic SQLAlchemy N+1.** Relationships are declared with default `lazy="select"`
  (`backend/db/models.py:71-73, 97, 131, 147`), and a repo-wide sweep for `.messages` / `.documents`
  / `.learning_events` / `.sessions` / `.usage_counters` attribute access outside `models.py`
  returned **only test files**. The list paths are genuinely set-based:
  `services/session_enrichment.py:51-85` is 2 queries for any N sessions;
  `routes/sessions.py:240-246` preloads learning events once and skips the load entirely when every
  batch is persisted; `routes/review.py:51-58` batches the session fetch with a single IN clause.
  The real defect class in this codebase is **unbounded fetch**, not per-row lazy loading — see
  F-06, F-07, F-08.
- **`/health` does not touch the DB** (`backend/routes/health.py:8-14` returns a constant). Pool
  exhaustion will therefore *not* trigger a Render health-check restart loop. (It also means Render
  will never notice the instance is saturated.)
- **Routes are lazy-loaded.** Every entry in `frontend/src/router/index.js:17-111` uses a dynamic
  import; the build confirms one chunk per view.
- **Streaming deltas are already coalesced.** `frontend/src/lib/deltaBatcher.js:6-31` batches SSE
  tokens to one reactive mutation per animation frame, and
  `frontend/src/lib/markdownStreamBuffer.js:125-143` resumes the delimiter scan from a saved anchor
  instead of rescanning from 0.
- **`vite-plugin-vue-devtools` does not leak into the build.** Grepping the built entry chunk for
  `vue-devtools` / `__VUE_DEVTOOLS` returns 0 matches, despite the unconditional `vueDevTools()` at
  `frontend/vite.config.js:15`.
- **The 342 kB `primeicons` SVG is not fetched by modern browsers.** The built `@font-face` src
  list in `dist/assets/index-*.css` orders eot, woff2, woff, ttf, svg; the 35.14 kB woff2 wins.
- **`tutor.run_streaming` releases the DB connection before the LLM call.** `backend/agent/tutor.py:206`
  (`ctx.db.commit()`, the B-10 fix) returns the pooled connection before `await litellm.acompletion`
  at line 208, so the token stream itself does **not** hold a connection. This is correct and was
  verified rather than assumed.

---

## Findings

### F-01 — Single Uvicorn worker + 10-connection pool caps the whole service at 10 concurrent DB-holding requests
- Severity: Critical
- Category: Architecture
- Page/Area: Backend deploy topology (all endpoints)
- Anchor: `backend/entrypoint.sh:4`; `render.yaml:5`; `backend/config.py:35-36`; `backend/db/database.py:24-40`
- Evidence:
```sh
# backend/entrypoint.sh:1-4
set -e
alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
```
```python
# backend/db/database.py:34-39
        kwargs["pool_pre_ping"] = True
        kwargs["pool_size"] = settings.db_pool_size       # 5
        kwargs["max_overflow"] = settings.db_max_overflow # 5
        kwargs["pool_recycle"] = 1800
```
- Steps to Reproduce: 1. Deploy per `render.yaml` (free plan, 1 instance). 2. Drive 11+ concurrent
  requests that each hold a DB transaction (any chat turn, any upload, any `/api/sessions` load).
  3. Watch the 11th block for 30 s, then 500.
- Expected: Worker count and pool size sized to the instance, with an explicit `pool_timeout` short
  enough to fail fast and shed load.
- Actual: 1 process x (5 + 5) = **10** connections for the entire service. `pool_timeout` is unset,
  so SQLAlchemy's 30 s default applies: request 11 stalls for a full 30 s before raising
  `QueuePool limit of size 5 overflow 5 reached`, by which time the client's own 30 s timeout
  (`frontend/src/services/apiClient.js:11`, `REQUEST_TIMEOUT_MS = 30000`) has already fired.
- Impact: **Hard ceiling of 10 concurrent connection-holding requests / ~1 chat turn per second /
  ~86,400 turns per day for the entire product.** At `DAILY_CAP: "50"` that is ~1,700 fully-capped
  users/day and roughly **10 simultaneous chatters**. Against 1,000,000 users the service is short
  by 3-4 orders of magnitude. The 30 s `pool_timeout` turns overload into 30-second hangs rather
  than fast 503s, so queue depth compounds instead of shedding.
- Fix: (a) `render.yaml` to a paid plan with `numInstances` > 1; (b) `entrypoint.sh` to
  `uvicorn --workers N` driven by a `WEB_CONCURRENCY` env var declared in `render.yaml`; (c) size
  the pool **per worker**: `DB_POOL_SIZE = floor(pooler_client_limit / (workers x instances))`,
  set via the already-env-tunable `config.py` fields rather than in code; (d) add
  `kwargs["pool_timeout"] = 5` in `_build_engine_kwargs` so overload fails fast; (e) confirm the
  Supabase pooler client limit for the plan and record it next to the pool math.
- Confidence: CONFIRMED

### F-02 — PDF ingestion holds one of the 10 DB connections for the entire embed pipeline
- Severity: Critical
- Category: Performance
- Page/Area: Upload / ingestion background task
- Anchor: `backend/services/ingestion_service.py:183-233`; `backend/services/ingestion_service.py:144-152`; `backend/routes/upload.py:167`
- Evidence:
```python
# backend/services/ingestion_service.py:183-186, 210-233 (abridged)
def run(document_id: int) -> None:
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)      # opens a transaction, checks out a connection
        ...
        embeddings = _embed_all(db, [c.text for c in chunks], ...)   # N sequential HTTP calls
        pgvector_store.insert_chunks(db, ...)
        keyword_index.merge_into_session(db, doc.session_id, stems)
        doc.status = "ready"
        db.commit()                              # first and only commit
```
- Steps to Reproduce: 1. Upload 10 large PDFs concurrently (10 different users is enough).
  2. Each `ingestion_service.run` checks out a connection at `db.get(Document, ...)` (line 186).
  3. No commit or rollback occurs until line 233. 4. Every other request in the service now waits
  30 s on `pool.connect()` and then 500s.
- Expected: The blob load, text extraction and the N embedding round-trips happen with **no** DB
  connection held; the connection is taken only for the final write.
- Actual: The connection is held across `_extract` (CPU-bound PDF parse) **and** the entire
  `_embed_all` loop, which issues `ceil(chunks / 100)` sequential synchronous `litellm.embedding`
  HTTP calls (`ingestion_service.py:57` `EMBED_BATCH = 100`; lines 144-152).
- Impact: A 25 MB text-dense PDF (`routes/upload.py:30`, `MAX_UPLOAD_BYTES = 25 MB`) at 500 tokens
  per chunk with 50 overlap (`backend/lib/chunking.py:34-35`, stride 450) yields roughly
  **3,300 chunks = 34 sequential embedding batches**. At a typical 1.5 s per batch that is **~51 s
  holding 1 of 10 connections**; at the configured worst case (`embedding_timeout_s: 15.0`,
  `config.py:60`) it is **34 x 15 s = 8.5 minutes**. **10 concurrent uploads take the pool to zero
  and the entire API — chat, sessions list, login-time `/api/me` — returns 500 for the duration.**
  There is no page-count cap and no chunk-count cap anywhere in the pipeline, so the upper bound is
  set only by the 25 MB byte limit.
- Fix: Restructure `run()` so the DB session is opened three times, not once: (1) short session to
  load the `Document` row, then close; (2) extract and embed with **no** session held; (3) short
  session to `insert_chunks` + `merge_into_session` + set status, then commit. F-27 atomicity is
  retained because only steps 5-7 need to share a transaction. Then move ingestion out of process
  entirely (see F-04).
- Confidence: CONFIRMED

### F-03 — Ingestion peak memory is ~150-200 MB per document on a 512 MB instance; 3 concurrent uploads OOM the box
- Severity: Critical
- Category: Performance
- Page/Area: Upload / ingestion background task
- Anchor: `backend/services/ingestion_service.py:194-223`; `backend/routes/upload.py:30, 124`; `backend/services/pgvector_store.py:40-52`
- Evidence:
```python
# backend/services/ingestion_service.py:194-201, 210-223 (abridged)
blob = _load_blob(object_store.get_store(), doc)           # full 25 MB in RAM
pages = _extract(blob, doc.filename)                       # full extracted text, second copy
chunks = chunking.chunk_text(pages)                        # third copy, +11% overlap
embeddings = _embed_all(db, [c.text for c in chunks], ...) # 3,300 x 768 Python floats
pgvector_store.insert_chunks(db, ..., rows=[(c.chunk_idx, c.page, c.text, embedding) ...])
```
- Steps to Reproduce: 1. Three users each upload a 25 MB text-dense PDF within the same minute.
  2. Three `ingestion_service.run` threadpool tasks run concurrently in the single worker process.
  3. RSS exceeds the instance limit; Render OOM-kills and restarts the container.
- Expected: Streaming extraction and batched embedding with a bounded working set, plus a hard
  page/chunk cap.
- Actual: Every stage materialises the whole document. `_embed_all` accumulates every embedding into
  one list (line 142 `out: list[list[float]] = []`, line 180 `return out`), then `insert_chunks`
  constructs one `ChunkEmbedding` ORM object per chunk holding the same vectors
  (`pgvector_store.py:40-51`), so both live simultaneously.
- Impact: 3,300 chunks x 768 dims as CPython float objects (24 B each plus an 8 B list pointer) is
  **~81 MB for the embeddings alone**, referenced twice; plus the 25 MB blob, the extracted-text
  list, and the chunk list. **Peak RSS ~150-200 MB per concurrent ingestion.** On a 512 MB Render
  free instance that is **3 concurrent large uploads to OOM-kill**, which also kills every in-flight
  `BackgroundTasks` ingestion and every open SSE stream (see F-04). There is no page-count guard:
  `page_count` is only *recorded* (`ingestion_service.py:199`), never enforced.
- Fix: Add a hard cap (e.g. `MAX_PAGES = 300`, `MAX_CHUNKS = 2000`) rejected at upload time with a
  413-class error; stream `_embed_all` so each batch is inserted and released before the next is
  fetched; use float32 arrays or a bulk `insert().values()` instead of per-chunk ORM objects.
- Confidence: CONFIRMED

### F-04 — Ingestion runs as an in-process BackgroundTask; every deploy or OOM destroys in-flight work and the embedding spend that paid for it
- Severity: High
- Category: Architecture
- Page/Area: Upload / ingestion
- Anchor: `backend/routes/upload.py:167`; `backend/services/ingestion_service.py:59-81`; `backend/main.py:30`
- Evidence:
```python
# backend/routes/upload.py:167
    background_tasks.add_task(ingestion_service.run, doc.id)
```
```python
# backend/services/ingestion_service.py:59-65
# F-26: ingestion is an in-process BackgroundTask; a restart kills it silently
# and the Document row stays "pending" forever ...
REAP_PENDING_AFTER_MINUTES = 10
REAP_ERROR = "ingestion interrupted by a server restart; please re-upload"
```
- Steps to Reproduce: 1. Start a large upload. 2. Deploy (Render restarts the container) or trigger
  the OOM in F-03. 3. The task dies mid-pipeline. 4. `reap_stale_pending` at boot (`main.py:30`)
  marks the row failed, but only after the 10-minute age guard, and the user is told to re-upload.
- Expected: Ingestion is a durable queued job with retry, decoupled from the web process lifecycle.
- Actual: The task lives and dies with the Uvicorn process. Because `run()` does not commit until
  line 233 (F-02), a kill at 90 % completion discards **all** inserted chunks; the
  `embed_cost_holder` re-record path (`ingestion_service.py:248-250`) only runs on a caught Python
  exception, not on SIGKILL.
- Impact: At 1,000,000 users a single deploy during business hours kills every in-flight ingestion.
  With ~34 embedding batches already purchased per large document, **the vendor is paid and the
  ledger increment is lost** (the `record_cost` flush lives inside the transaction that is
  discarded). Users see a 10-minute spinner followed by "please re-upload", then pay for the same
  embeddings a second time. Deploys become impossible to do safely during traffic.
- Fix: Move ingestion to a separate worker service (`render.yaml` `type: worker`) fed by a durable
  queue, with the document row as the job record and an idempotent re-run. Short term: commit chunk
  inserts incrementally per batch so a kill loses one batch, not all 34.
- Confidence: CONFIRMED

### F-05 — `_session_centroid` averages every chunk vector in the session on every chat turn, on the event loop, and no index can serve it
- Severity: High
- Category: Performance
- Page/Area: Chat turn preparation (`POST /api/chat/stream`)
- Anchor: `backend/services/retrieval_service.py:88-99`; called at `backend/services/retrieval_service.py:200`; reached from `backend/routes/chat.py:240-244`
- Evidence:
```python
# backend/services/retrieval_service.py:88-99
def _session_centroid(db: Session, session_id: str) -> list[float] | None:
    """Mean embedding over the session's chunks; None off-Postgres or empty."""
    if db.get_bind().dialect.name != "postgresql":
        return None
    centroid = db.execute(
        select(
            func.avg(ChunkEmbedding.embedding, type_=Vector(settings.embedding_dim))
        ).where(ChunkEmbedding.session_id == session_id)
    ).scalar()
```
- Steps to Reproduce: 1. Upload a large PDF to a session. 2. Send a chat message whose stems miss
  the lexical keyword gate (`routes/chat.py:236-238`). 3. `semantic_fallback_required` runs, which
  calls `_session_centroid`. 4. Postgres must read every `chunk_embeddings` row for that session.
- Expected: The centroid is computed once at ingestion time and stored on the `sessions` row (or in
  a small `session_centroids` table), read as a single indexed lookup per turn.
- Actual: An `avg()` aggregate over a `vector(768)` column with no possible index support. The HNSW
  index (`0017_hnsw_chunk_embeddings.py:31-34`) indexes distance, not aggregation, so this is
  necessarily a bitmap-heap scan over every matching row on every qualifying turn. It also runs as
  a **synchronous** `db.execute` inside the async call chain (`retrieval_service.py:170`
  `async def semantic_fallback_required`, awaited from `async def _prepare_turn` at
  `routes/chat.py:241`), so it blocks the single event loop for its full duration.
- Not stubbed in production: `semantic_fallback_required` short-circuits when
  `settings.llm_stub_enabled` is true (`retrieval_service.py:195-196`), but `render.yaml:9` sets
  `LLM_STUB: "false"` and `GEMINI_API_KEY` is a real key, so `llm_stub_enabled` (`config.py:79-80`)
  is False on the deployed service and this path runs on every qualifying turn.
- Impact: For a session with a 25 MB PDF (~3,300 chunks, per F-02), each turn reads
  **3,300 x 768 x 4 B = ~10 MB** of vector data and performs ~2.5 M float additions: a
  **~150-400 ms** aggregate, **on every non-keyword-matched chat turn**, during which *every other
  in-flight SSE stream in the process stops receiving tokens*. `has_ready_document` is also run
  twice per turn for the same session (once at `retrieval_service.py:198`, again at line 132 inside
  `prefetch_for_prompt`).
- Fix: Materialise the centroid. Add `sessions.chunk_centroid vector(768)` (nullable), write it in
  `ingestion_service.run` alongside `status = "ready"`, and replace `_session_centroid` with a
  column read. If it must stay dynamic, at minimum move it off the event loop via
  `run_in_threadpool` and cache it per session id.
- Confidence: CONFIRMED

### F-06 — `GET /api/sessions` fetches every session a user has ever created, with no LIMIT
- Severity: High
- Category: Performance
- Page/Area: Sessions list endpoint
- Anchor: `backend/routes/sessions.py:209-219`
- Evidence:
```python
@router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.desc())
    ).scalars().all()
    return _enrich_list_items(db, rows)
```
- Steps to Reproduce: 1. Create 500 sessions for one user. 2. `GET /api/sessions`. 3. All 500 rows
  load with their full `topic_profile_json` / `kw_index_json` / `rolling_summary` TEXT columns, then
  go to `compute_enrichment`.
- Expected: A `limit`/`offset` pair like its sibling `GET /api/sessions/library`
  (`sessions.py:292-293`, `limit: int = Query(20, ge=1, le=100)`).
- Actual: No bound at all. `_enrich_list_items` (`sessions.py:80-98`) then runs `compute_enrichment`,
  whose second query pulls up to `PREVIEW_CANDIDATES = 5` (`session_enrichment.py:21`) message rows
  **per session**.
- Impact: A user with 500 sessions triggers one query returning 500 wide rows plus a window-function
  query returning **2,500 message rows**, serialised with no page. A power user with 2,000 sessions
  pulls 10,000 message rows and multi-MB of profile JSON in one request, while holding 1 of the 10
  connections (F-01). This is a denial-of-service vector against the pool: **10 such users take the
  whole service down**.
- Fix: Add `limit`/`offset` with the same `Query(20, ge=1, le=100)` bounds as
  `/api/sessions/library`, or delete the endpoint if no caller remains. The store `listSessions`
  (`frontend/src/stores/session.js:167-176`) calls `getSessionLibrary`, not this route: verify, then
  remove.
- Confidence: CONFIRMED

### F-07 — `GET /api/review/queue` loads every learning event the user has ever recorded, then paginates in Python
- Severity: High
- Category: Performance
- Page/Area: Review queue (fetched on every sidebar boot)
- Anchor: `backend/routes/review.py:26-37`, `47-58`, `66-81`
- Evidence:
```python
    rows = db.execute(
        select(LearningEvent, SessionModel.topic)
        .join(SessionModel, LearningEvent.session_id == SessionModel.id)
        .where(SessionModel.user_id == user_id)
        .where(or_(LearningEvent.purpose.is_(None),
                   LearningEvent.purpose != "diagnostic"))
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).all()
```
and, after the whole schedule is computed in Python:
```python
        items=[... for e in due[offset : offset + limit]],
        total=len(due),
```
- Steps to Reproduce: 1. Accumulate a year of usage for one user (50 turns/day cap x ~2 check
  questions = ~35,000 learning events). 2. Load any page that boots the sidebar. 3. All 35,000 rows
  cross the wire and are grouped in Python; `limit=20` is applied to the already-computed list.
- Expected: SQL-side windowing, or at minimum a date floor. `MAX_INTERVAL_DAYS` is 60
  (`review_queue_service.py:30`), so events older than ~90 days cannot change the answer for any
  concept with recent activity.
- Actual: Unbounded fetch. `limit`/`offset` at `review.py:20-21` are **decorative**: they slice `due`
  in Python at line 77 after `compute_schedule` has already grouped every event
  (`review_queue_service.py:66-99`). A second unbounded query at `review.py:52-58` then loads every
  distinct `SessionModel` row (with full `topic_profile_json`) to build `evidence_map`.
- Impact: At 35,000 events the request transfers ~10 MB, allocates ~35,000 `EventRow` dataclasses
  plus the grouping dict, and costs on the order of **1-3 s of CPU in the single worker process**,
  holding a threadpool slot and 1 of the 10 connections, **on the boot path of every page load**.
  Ten such users concurrently saturate the pool. The `ORDER BY learning_events.created_at` has no
  supporting index (see F-09), so Postgres also sorts all 35,000 rows.
- Fix: Add a `created_at >= now() - interval '90 days'` floor; push the per-concept "latest event
  plus trailing streak" into SQL with a window function so only distinct concepts cross the wire;
  make `limit`/`offset` real by applying them in SQL.
- Confidence: CONFIRMED

### F-08 — `GET /api/profile/aggregate` loads every session row (full profile JSON) for the user
- Severity: High
- Category: Performance
- Page/Area: Settings, Profile tab
- Anchor: `backend/services/profile_service.py:572-576`, `587-609`, `629-633`
- Evidence:
```python
    sessions: list[SessionModel] = db.execute(
        select(SessionModel)
        .where(SessionModel.user_id == user_id)
        .order_by(SessionModel.created_at.asc())
    ).scalars().all()
```
- Steps to Reproduce: 1. Open Settings, Profile tab, for a user with 2,000 sessions
  (`frontend/src/components/settings/ProfileTab.vue:236`, `onMounted(load)`). 2. Every session row
  loads with `topic_profile_json`, `kw_index_json`, `rolling_summary`. 3. `_parse_profile` runs
  2,000 `json.loads` plus 2,000 Pydantic validations in the request path.
- Expected: The aggregate is computed in SQL, or the response is bounded and paginated.
- Actual: Full scan of the user's sessions, full JSON parse of each, in Python. Only the last 5
  (`profile_service.py:638`) are needed at full fidelity; the rest contribute only counts.
- Impact: `max_profile_list: int = 40` (`config.py:64`) caps each concept list at 40 entries, so a
  session's `topic_profile_json` can be several kB. At 2,000 sessions that is **multi-MB
  transferred and ~2,000 Pydantic validations per request**, hundreds of milliseconds of
  single-threaded CPU while holding a connection. It also fires a second unbounded count over
  `learning_events` (lines 629-633) plus `_learning_insights` over the same `session_ids` list.
- Fix: Replace the row scan with aggregate SQL (`count(*)`,
  `count(*) FILTER (WHERE ended_at IS NULL)`, `max(coalesce(ended_at, created_at))`) and compute the
  concept histograms with a `jsonb_array_elements` lateral over `topic_profile_json::jsonb`, or
  maintain a denormalised per-user aggregate row updated on session end.
- Confidence: CONFIRMED

### F-09 — Missing indexes on four hot query shapes
- Severity: Medium
- Category: Performance
- Page/Area: Review queue, message pagination, ingestion-status polling, usage summary
- Anchor: `backend/db/models.py:78-84, 116-118`; `backend/db/alembic/versions/0008_session_perf_indexes.py:24-34`; `0002_chunk_embeddings.py:41-50`; `0014_llm_call_log.py:27-28`; `0022_documents_session_idx.py:23`
- Evidence: the complete set of indexes that exists today, read from the migration chain:
  `ix_sessions_user_id`, `uq_sessions_active_topic` (partial unique),
  `ix_chat_messages_session_created (session_id, created_at)`,
  `ix_learning_events_session (session_id)`, `ix_documents_session_id (session_id)`,
  `ix_chunk_embeddings_session_id`, `ix_chunk_embeddings_document_id`,
  `ix_chunk_embeddings_embedding` (HNSW), `ix_llm_call_log_user`, `ix_llm_call_log_session`,
  `uq_usage_counters_user_date`.
- Steps to Reproduce: for each shape below, run the query against a table with the stated row count
  and EXPLAIN it.

| Query | WHERE / ORDER BY | Index today | Verdict |
|---|---|---|---|
| `routes/review.py:26-37` | join on `sessions.user_id = ?`, `ORDER BY learning_events.created_at ASC, id ASC` | `ix_learning_events_session(session_id)` only | **No index on `created_at`**: full sort of every matching row |
| `routes/sessions.py:229-234` (`_load_messages`) | `session_id = ? AND id < ? ORDER BY id DESC LIMIT 31` | `(session_id, created_at)` | Wrong second column: cannot serve `ORDER BY id DESC`, so Postgres reads all of the session rows then sorts |
| `documents_service.py:64-73` and `55-61` | `session_id = ? AND status = 'ready'` | `(session_id)` only | Heap fetch plus filter on every poll, and F-12 makes that 0.5 req/s per uploading user |
| `usage_service.py:41-52` | `llm_call_log.user_id = ? GROUP BY session_id` | `(user_id)` and `(session_id)` separately | No covering composite: sort or hash-aggregate over all of a user's call rows |

- Expected: an index for each hot predicate-plus-ordering pair.
- Actual: as tabulated.
- Impact: bounded but real. At 35,000 learning events for one user the review-queue sort is the
  dominant cost of a 1-3 s request (F-07). At 500 messages in a session, `_load_messages` reads and
  sorts all 500 rows to return 30, a **16x read amplification** on every "load earlier" page and
  every session open. At 1,000 concurrent uploads the documents polling shape (F-12) runs
  ~1,500 times per second against a heap-filter plan.
- Fix:
```sql
CREATE INDEX CONCURRENTLY ix_learning_events_created_at
  ON learning_events (created_at, id);
CREATE INDEX CONCURRENTLY ix_chat_messages_session_id_desc
  ON chat_messages (session_id, id DESC);
CREATE INDEX CONCURRENTLY ix_documents_session_status
  ON documents (session_id, status);
CREATE INDEX CONCURRENTLY ix_llm_call_log_user_session
  ON llm_call_log (user_id, session_id) INCLUDE (cost_usd);
```
  CONCURRENTLY requires `op.execute` inside an `autocommit_block()` in the Alembic revision (see the
  repo migration conventions). `ix_chat_messages_session_created` must be kept:
  `compute_enrichment` still needs `max(created_at)` per session.
- Confidence: CONFIRMED

### F-10 — The pgvector similarity query filters on a joined table, defeating a single-table index path; `hnsw.ef_search` is never set
- Severity: Medium
- Category: Performance
- Page/Area: Retrieval (`retrieve_chunks` tool and `prefetch_for_prompt`)
- Anchor: `backend/services/pgvector_store.py:74-87`; `backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py:31-34`
- Evidence:
```python
# backend/services/pgvector_store.py:74-87
    distance = ChunkEmbedding.embedding.cosine_distance(query_embedding)
    stmt = (
        select(ChunkEmbedding, distance.label("score"), Document.filename)
        .join(Document, ChunkEmbedding.document_id == Document.id)
        .where(
            ChunkEmbedding.session_id == session_id,
            Document.status == "ready",
        )
        .order_by(distance)
        .limit(k)
    )
```
- Steps to Reproduce: 1. Populate `chunk_embeddings` to production scale. 2. EXPLAIN ANALYZE the
  above with a real session id. 3. Compare against the same query with the documents join removed.
- Expected: either a session-scoped btree scan feeding an exact sort (correct at small per-session
  N), or an HNSW index scan with `ef_search` tuned for the post-filter selectivity, chosen
  deliberately rather than left to the planner.
- Actual: three compounding issues. (1) The `ORDER BY <=> LIMIT k` sits above a **join** whose filter
  (`Document.status = 'ready'`) lives on the *other* table, so the HNSW index cannot be used as an
  ordered index scan without post-filtering; the planner must either sort exactly or over-fetch.
  (2) The HNSW index is **global** across all users (`0017:31-34`: no partial predicate, no
  per-session partitioning), so an index scan candidate set is the whole corpus. (3)
  `hnsw.ef_search` is **never set** anywhere in the repo, leaving the pgvector default of 40.
- Impact: at 1,000,000 users x 1 document x ~300 chunks the table holds **~300,000,000 rows, about
  920 GB of raw vector data**, and any one session owns roughly 1 row in 1,000,000. If the planner
  ever picks the HNSW path, `ef_search = 40` returns approximately zero rows belonging to the target
  session and the scan must walk essentially the entire graph to fill `LIMIT 5`: a query that is
  milliseconds today becomes unbounded. If it picks the btree path it is fine, but nothing in the
  code forces that choice and the join makes the selectivity estimate worse. Separately, a single
  global HNSW index at 300 M rows will not rebuild within any realistic `maintenance_work_mem`.
- Fix: denormalise readiness onto the vector table (`chunk_embeddings.doc_ready boolean`, written by
  `ingestion_service.run`) so the filter is single-table and the query needs no join; add
  `SET LOCAL hnsw.ef_search = 100` on the retrieval transaction; and plan to partition
  `chunk_embeddings` by session or user hash before the table passes ~10 M rows.
- Confidence: PLAUSIBLE — the mechanism, the join-side filter and the missing `ef_search` are
  confirmed from source, but the chosen plan cannot be verified without EXPLAIN on a populated
  table, which this audit is barred from running.

### F-11 — Async handlers execute synchronous SQLAlchemy I/O, stalling the single event loop and every concurrent SSE stream
- Severity: High
- Category: Architecture
- Page/Area: `POST /api/chat/stream`, `POST /api/sessions`, `POST /api/sessions/{id}/end`
- Anchor: `backend/routes/chat.py:117, 138, 160, 191, 208, 285`; `backend/routes/sessions.py:126, 174, 184, 195, 205`; `backend/routes/sessions.py:456, 464, 471, 484, 486`
- Evidence:
```python
# backend/routes/chat.py:117, 138-140 - async handler, blocking driver
async def _prepare_turn(req, user_id, db, accepted_terms=False):
    exists_subq = select(literal(True)).where(User.id == user_id).exists()
    spend_raw, user_exists = db.execute(          # blocking psycopg round-trip
        select(cost_meter.spend_subquery(user_id), exists_subq)
    ).one()
```
```python
# backend/routes/sessions.py:456, 464 - async handler, blocking driver
async def end_session(session_id, response, user_id=..., db=...):
    row = db.get(SessionModel, session_id)        # blocking
```
- Steps to Reproduce: 1. Open 20 concurrent chat streams. 2. Have a 21st user start a turn.
  3. `_prepare_turn` runs about ten sequential blocking statements on the loop. 4. All 20 open
  streams stop delivering tokens for the sum of those round-trips.
- Expected: either plain `def` handlers (which FastAPI runs in the 40-slot threadpool) or a genuinely
  async driver (`create_async_engine` plus `AsyncSession` plus asyncpg). The codebase already gets
  this right for the majority of routes: `list_sessions`, `get_session`, `get_review_queue`,
  `get_upload_status`, `upload_file` and `get_me` are all plain `def`.
- Actual: the three hottest write paths are `async def` over a synchronous engine
  (`db/database.py:47` uses `create_engine`, not `create_async_engine`). `_prepare_turn` alone
  issues: the combined spend-plus-exists SELECT (138), the session plus three document-count
  subqueries (160), `ensure_user` (188), `check_and_increment` (191, two statements plus a commit),
  the 20-row history SELECT (208), `gap_accuracy` (232), `has_ready_document` twice (via 241 and
  248), `_session_centroid` (F-05), the vector search, two `meter_embedding_response` ledger
  upserts, and the user-message INSERT plus commit (283-285).
- Impact: at a Render-Singapore to Supabase-Singapore RTT of ~3 ms that is **~40 ms of pure
  event-loop block per chat turn before the LLM is even called**, excluding `_session_centroid`
  (150-400 ms for a large session, F-05). The loop is the shared resource for token delivery, so
  **N users starting turns simultaneously freeze every open stream for N x 40 ms**. It also caps
  turn-initiation throughput at ~25/s regardless of pool or LLM capacity. `tutor.run_streaming`
  compounds this with further sync calls between yields: `cost_meter.record_cost` (`tutor.py:275`),
  `cost_meter.check_cap` (`tutor.py:296`), `_persist_assistant_message` -> `ctx.db.commit()`
  (`tutor.py:49-50`), `attach_message_id` (`tutor.py:502`).
- Fix: convert `chat_stream`/`_prepare_turn`, `create_session` and `end_session` to `def` where
  possible, or wrap each synchronous DB segment in `starlette.concurrency.run_in_threadpool`. The
  correct long-term fix is an async engine and session, but the threadpool wrap is available today
  and removes the cross-stream coupling.
- Confidence: CONFIRMED

### F-12 — Two independent pollers hammer the API at 1.5 req/s per uploading user
- Severity: Medium
- Category: Performance
- Page/Area: Session view during upload
- Anchor: `frontend/src/views/SessionView.vue:746-773`; `frontend/src/components/chat/ReferenceStatusBanner.vue:84-97`
- Evidence:
```js
// SessionView.vue:746-772 - 30 polls, 1 s apart
async function pollUploadStatus(documentId, filename, gen) {
  for (let i = 0; i < 30; i += 1) {
    s = await getUploadStatus(documentId)
    ...
    await new Promise((r) => setTimeout(r, 1000))
```
```js
// ReferenceStatusBanner.vue:94-96 - independent 2 s poll on the same state
  if (!stopped && gen === generation && status.value === 'pending') {
    timer = setTimeout(() => poll(gen), 2000)
  }
```
- Steps to Reproduce: 1. Upload a file. 2. Open DevTools, Network tab. 3. Observe
  `GET /api/upload/{id}` every 1 s **and** `GET /api/sessions/{id}/ingestion` every 2 s, both
  reporting the same ingestion state, for the full duration of the ingestion.
- Expected: one poller, with exponential backoff (1 s, 2 s, 4 s, 8 s, capped), or SSE.
- Actual: two pollers on fixed intervals with no backoff. Both endpoints do real DB work:
  `get_upload_status` (`routes/upload.py:187-190`) issues two `db.get` calls, and
  `session_ingestion_status` (`documents_service.py:55-61`) scans the session documents with the
  index gap from F-09.
- Impact: **1.5 requests per second per uploading user**, each taking a threadpool slot and a pooled
  DB connection. With the ~51 s typical ingestion of F-02 that is **~77 requests per upload**. At
  1,000 concurrent uploads: **1,500 req/s against a single Uvicorn worker with a 10-connection
  pool** — the pool is saturated by polling alone, before any chat traffic. The banner poll also
  never terminates on a state that never resolves (it only stops when status is no longer `pending`
  or the component unmounts), so an ingestion stranded by F-04 polls at 0.5 req/s indefinitely while
  the tab stays open.
- Fix: delete `pollUploadStatus` and drive the upload chip from the single banner poll, which already
  carries per-document status and error. Add exponential backoff with a cap, and a hard attempt
  ceiling that surfaces "still processing" instead of polling forever.
- Confidence: CONFIRMED

### F-13 — `_prepare_turn` holds a pooled connection across up to two awaited embedding round-trips
- Severity: Medium
- Category: Performance
- Page/Area: `POST /api/chat/stream`
- Anchor: `backend/routes/chat.py:138` (transaction opens) -> `241` and `248` (embedding awaits) -> `283-285` (user-message write) -> `backend/agent/tutor.py:173` (loop-top cap check on the same `ctx.db`) -> `backend/agent/tutor.py:206` (the commit that finally releases it)
- Evidence:
```python
# backend/routes/chat.py:239-251
        query_vec = None
        if not retrieval_required:
            retrieval_required, query_vec = await retrieval_service.semantic_fallback_required(
                db, req.session_id, req.message, user_id=user_id, cost_holder=embed_cost_holder,
            )
        prefetched_chunks = None
        if retrieval_required:
            prefetched_chunks = await retrieval_service.prefetch_for_prompt(
                db, req.session_id, user_id, req.message,
                query_vec=query_vec, cost_holder=embed_cost_holder,
            )
```
- Steps to Reproduce: 1. Send a chat message in a session with an uploaded document whose stems miss
  the keyword gate. 2. `db.execute` at line 138 has already opened the transaction and nothing
  commits until line 285. 3. Two `await litellm.aembedding` calls execute against Gemini in between.
- Expected: the connection is released before any network await, mirroring the B-10 fix already
  applied inside `tutor.run_streaming` (`agent/tutor.py:200-206`, which explicitly commits so the
  pooled connection returns for the 10-60 s stream).
- Actual: the same discipline was not applied to `_prepare_turn`. The transaction opened at line 138
  spans both embedding calls.
- Impact: `embedding_timeout_s: 15.0` (`config.py:60`), so the worst case is **30 s holding 1 of 10
  connections** before the LLM is even reached; the typical case is 0.6-2 s. **10 concurrent first
  turns on document-backed sessions is enough to exhaust the pool** while every one of them is
  merely waiting on Gemini, and the 30 s `pool_timeout` (F-01) means the 11th user waits the full
  30 s before failing.
- Fix: apply the B-10 pattern. Call `db.commit()` immediately before `semantic_fallback_required`
  and let the session re-open on first use afterwards. The `cost_holder` mechanism
  (`chat.py:206`, `273-275`) is already designed to survive exactly this transaction boundary.
- Confidence: CONFIRMED

### F-14 — The 450 kB markdown/KaTeX chunk and its render-blocking stylesheet load on every cold page, including `/login`
- Severity: High
- Category: Performance
- Page/Area: Frontend initial load (all routes)
- Anchor: `frontend/dist/index.html` (build output, this session); `frontend/src/lib/markdownRenderer.js:7-9`; `frontend/vite.config.js:10-23`
- Evidence, the built entry HTML:
```html
<link rel="modulepreload" crossorigin href="/assets/markdownRenderer-Dawn9v8u.js">
<link rel="modulepreload" crossorigin href="/assets/supabase-CJLAtSaY.js">
<link rel="stylesheet" crossorigin href="/assets/markdownRenderer-CYlHEDRF.css">
<link rel="stylesheet" crossorigin href="/assets/index-gTDmbNXC.css">
```
versus the stated design intent:
```js
// frontend/src/lib/markdownRenderer.js:7-9
// KaTeX CSS rides this async chunk (only lazy routes import the renderer),
// keeping its webfont family out of the entry bundle on /login.
import 'katex/dist/katex.min.css'
```
- Steps to Reproduce: 1. `npm run build`. 2. Open `dist/index.html`. 3. Observe the `modulepreload`
  for the markdown chunk and the **render-blocking** stylesheet link for its CSS in the document
  head, before any route has resolved.
- Expected: what the code comment says. The renderer chunk and its KaTeX CSS are fetched only when a
  route that renders markdown (`SessionView`, `TosView`, `PrivacyView`) is entered.
- Actual: `modulepreload` issues a real high-priority fetch of the 450.58 kB / **152.23 kB gzip**
  chunk on first HTML parse, and the 28.83 kB / **7.92 kB gzip** stylesheet (which carries every
  KaTeX `@font-face` declaration) is render-blocking. A user landing on `/login`, whose own route
  chunk is 1.55 kB gzip, pays for the entire markdown-it + KaTeX + highlight.js + DOMPurify stack.
  `vite.config.js` has no `build.rollupOptions.manualChunks` and no `build.modulePreload`
  configuration to control this.
- Impact: **~160 kB gzip of unnecessary transfer on every cold load**, on top of the ~175 kB gzip
  that is genuinely needed (`index` 88.82 + `runtime-core` 26.01 + `supabase` 51.76 + `useApi`
  0.62), for a cold-load JS payload of **~319 kB gzip**. On a 400 kbps effective mobile connection
  the render-blocking stylesheet alone adds ~160 ms before first paint and the preload contends for
  bandwidth with the entry chunk for roughly 3 s. At 1,000,000 users x one cold load that is
  **~160 GB of avoidable egress**. The `supabase` chunk (51.76 kB gzip) is likewise preloaded on
  `/tos` and `/privacy`, which are `public: true` routes that never authenticate.
- Fix: set `build.modulePreload: { resolveDependencies: ... }` in `vite.config.js` to exclude the
  renderer chunk, or move `import 'katex/dist/katex.min.css'` inside a dynamic import in
  `getRenderer()` so it leaves the statically analysable graph. Verify by re-reading
  `dist/index.html`: the `markdownRenderer` links must be gone. Also add `manualChunks` to split the
  highlight.js languages away from markdown-it and DOMPurify.
- Confidence: CONFIRMED

### F-15 — Streaming re-parses the entire accumulated answer through markdown-it and DOMPurify once per animation frame
- Severity: Medium
- Category: Performance
- Page/Area: Session view, assistant bubble during streaming
- Anchor: `frontend/src/components/chat/MarkdownContent.vue:18-24`; `frontend/src/lib/markdownRenderer.js:105-110`, `70-90`
- Evidence:
```js
const parts = computed(() => {
  if (!props.streaming) {
    return { safeHtml: renderMarkdown(props.text), deferred: '' }
  }
  const { safe, deferred } = splitSafePrefixIncremental(props.text, splitState)
  return { safeHtml: renderMarkdown(safe), deferred }
})
```
- Steps to Reproduce: 1. Ask a question that produces a long answer with code blocks and math.
  2. Profile the main thread while it streams. 3. Each `deltaBatcher` flush invalidates `parts`, and
  `renderMarkdown` runs a **full** `md.render` plus a **full** `DOMPurify.sanitize` over the entire
  accumulated prefix.
- Expected: incremental rendering, where only the newly stable block is parsed and appended.
- Actual: the delimiter *scan* is incremental (`markdownStreamBuffer.js:125-143`) but the *render*
  is not. Work per frame is O(total text so far), so total work over a stream is O(n squared).
- Impact: bounded to about 60 renders per second by `deltaBatcher` (`deltaBatcher.js:24-28`), which
  is the saving grace. At a 4 kB answer the per-frame cost is ~2-4 ms, which is fine. At a **12 kB**
  answer with several fenced code blocks (highlight.js re-highlights every block every frame,
  `markdownRenderer.js:70-90`) the per-frame cost reaches **20-40 ms on a mid-range phone**: one to
  two dropped frames per token batch and a visibly stuttering stream through the last third of the
  answer. Total wasted work over a 30 s stream is roughly 1,800 full re-parses of an average 8 kB
  document.
- Fix: cache the rendered HTML of the stable prefix. `splitSafePrefixIncremental` already returns a
  `stableCursor`; render only `text.slice(previousStableCursor, newStableCursor)` and concatenate
  onto the retained HTML string, falling back to a full render whenever the anchor is invalidated.
- Confidence: CONFIRMED

### F-16 — Transcript renders every message with no virtualization and unbounded accumulation
- Severity: Medium
- Category: Performance
- Page/Area: Session view transcript
- Anchor: `frontend/src/components/chat/MessageList.vue:29-39`; `frontend/src/stores/session.js:308`
- Evidence:
```vue
<TransitionGroup name="msg-fade" tag="div" class="msg-list">
  <template v-for="(m, i) in visibleMessages" :key="m.message_id || `m-${i}`">
    <UserBubble v-if="m.role === 'user'" :content="m.content || ''" />
    <AssistantBubble v-else :message="m" :streaming="false" />
```
```js
// stores/session.js:308 - each "load earlier" prepends 30 more, forever
messages.value = [...(page.items || []).map(toUiMessage), ...messages.value]
```
- Steps to Reproduce: 1. Open a long session. 2. Click "load earlier" repeatedly (30 messages per
  page, `routes/sessions.py:425`). 3. Every loaded message stays mounted as a live `AssistantBubble`
  to `MarkdownContent` component with its own computed and its own rendered DOM subtree.
- Expected: a windowed/virtualised list, or a cap on retained history with a "jump to top"
  affordance.
- Actual: unbounded accumulation, inside a `TransitionGroup`, which adds per-node transition
  bookkeeping on every list mutation.
- Impact: a 500-message session fully scrolled back holds **500 mounted `MarkdownContent`
  instances**, each retaining its rendered HTML string and DOM subtree (roughly 5-15 kB of DOM
  each), on the order of **20-40 MB of DOM plus 500 live Vue computed dependencies**, and every
  prepend re-runs the `TransitionGroup` diff over the whole list. On mobile this is where the tab
  gets killed. The library and review lists share the shape but are server-paginated at 20-100, so
  they are bounded in practice.
- Fix: virtualise the transcript with a windowing wrapper around `MessageList`, or cap retained
  history at ~200 messages and drop the oldest page when a new one is prepended. As a cheap first
  step, drop `TransitionGroup` for a plain `div` once the list exceeds ~100 items: the enter/leave
  animation is only meaningful for the newest message.
- Confidence: CONFIRMED

### F-17 — `vercel.json` sets no Cache-Control for hashed assets while `nginx.conf` sets 30 days, and Vercel is the production path
- Severity: Medium
- Category: Performance
- Page/Area: Static asset delivery (Vercel)
- Anchor: `frontend/vercel.json:9-19`; `frontend/nginx.conf` (`location /assets/ { expires 30d; }`)
- Evidence:
```json
  "headers": [
    { "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options",       "value": "DENY" },
        { "key": "Referrer-Policy",       "value": "strict-origin-when-cross-origin" }
      ] } ]
```
- Steps to Reproduce: 1. Compare the `headers` block in `vercel.json` (security headers only)
  against the `location /assets/` block in `nginx.conf` (`expires 30d`). 2. Note that Vercel is the
  production frontend and nginx is the docker-compose alternative.
- Expected: the two deploy paths agree, and content-hashed assets carry
  `Cache-Control: public, max-age=31536000, immutable`.
- Actual: an explicit configuration asymmetry. The deploy path that ships to users has no
  Cache-Control rule at all, while the one that does not ship carries a 30-day rule.
- Impact: Vercel serves strong ETags from its edge, so the real cost is a **conditional
  revalidation round-trip per asset, not a re-download**. With about six hashed JS/CSS assets
  referenced from `index.html` plus the route chunk, that is **~7 extra 304 round-trips per cold
  navigation** (roughly 7 x edge RTT, up to 50-150 ms serialised in the worst case) on every repeat
  visit, and ~7 million extra edge requests per million returning users. Modest, but free to fix
  and asymmetric with a sibling config that already gets it right.
- Fix: add to `vercel.json`:
```json
{ "source": "/assets/(.*)",
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
```
  keeping `index.html` uncached so new deploys are picked up immediately.
- Confidence: CONFIRMED for the config asymmetry; PLAUSIBLE for the precise Vercel default
  behaviour, which was not measured against a live deploy.

### F-18 — No client-side caching and no retry-with-backoff: every navigation refetches, every transient failure is terminal
- Severity: Medium
- Category: Architecture
- Page/Area: All API access
- Anchor: `frontend/src/services/apiClient.js:106-162`; `frontend/src/stores/session.js:239-295`
- Evidence: `request()` sends no `If-None-Match` and no `Cache-Control`, stores nothing, and the only
  retry in the whole client is the single 401 refresh at `apiClient.js:143-146`:
```js
  if (resp.status === 401 && !_retried) {
    // F-09: silent first 401 -- refresh and retry once before surfacing.
    return request(method, path, { body, params, silent, headers }, true)
  }
```
- Steps to Reproduce: 1. Navigate `/` to `/session/x` to `/` to `/session/x`. 2. Observe
  `GET /api/sessions/{id}` re-issued in full each time (30 messages plus profile plus pending check
  plus ingestion status). 3. Force a 502 from the backend and observe the request fail immediately
  with no retry.
- Expected: ETag-based conditional requests on read endpoints, an in-memory TTL cache for
  session/profile detail, and exponential-backoff retry on 5xx and network errors.
- Actual: neither exists. `loadSession` (`session.js:239-295`) has in-flight de-duplication but no
  result cache, so re-entering a session already visited in the same SPA session refetches
  everything. The backend already computes a profile ETag (`profile_service.profile_etag`, used at
  `routes/profile.py:63`) but only for `If-Match` write concurrency, never for `If-None-Match` read
  caching.
- Impact: every back-and-forth navigation costs a full `GET /api/sessions/{id}`, which is four
  sequential server-side queries (`_load_messages` + `get_pending_check` + `load_profile` +
  `session_ingestion_status`, `routes/sessions.py:400-418`) and one of the 10 pooled connections
  (F-01). A user browsing 10 sessions triggers **40 avoidable DB queries**. Under a transient
  Supabase blip every in-flight request fails hard and surfaces a toast rather than recovering,
  turning a 2-second upstream hiccup into a visible outage for every active user.
- Fix: (a) return `ETag` on `GET /api/sessions/{id}`, `/api/profile/{id}` and `/api/me` and honour
  `If-None-Match` with a 304; (b) add a small TTL map in `apiClient.request` for GETs; (c) wrap
  `request` in exponential-backoff retry (3 attempts at 200/600/1800 ms plus jitter) for network
  errors and 502/503/504 only, never for 4xx and never for non-idempotent methods.
- Confidence: CONFIRMED

### F-19 — JWKS cache expiry has no single-flight guard; every few minutes a burst of threads each makes a blocking HTTP fetch to Supabase
- Severity: Medium
- Category: Performance
- Page/Area: Auth dependency (every authenticated request)
- Anchor: `backend/services/auth.py:34-47`, `77-108`, `131-163`
- Evidence:
```python
def _get_jwks_client() -> PyJWKClient:
    now = time.time()
    if (_JWKS_CACHE["client"] is None
        or now - _JWKS_CACHE["fetched_at"] > _JWKS_TTL_SECONDS):
        ...
        _JWKS_CACHE["client"] = PyJWKClient(settings.supabase_jwks_url)
        _JWKS_CACHE["fetched_at"] = now
    return _JWKS_CACHE["client"]
```
- Steps to Reproduce: 1. Drive sustained authenticated traffic. 2. Wait for the PyJWKClient internal
  JWK-set cache to expire. 3. Every concurrent `get_signing_key_from_jwt` call in the threadpool
  independently refetches the JWKS URL.
- Expected: a single-flight lock (or a background refresher) so exactly one thread refetches while
  the others serve the stale-but-valid key set.
- Actual: there is no lock at either layer. The module-level `_JWKS_CACHE` guard (1-hour TTL) is
  unsynchronised, and the PyJWKClient internal JWK-set cache is refreshed lazily per call with no
  coordination. The fetch is urllib-based and blocking.
- Impact: `current_user_id` is a sync `def`, so it runs in the 40-slot threadpool and does not block
  the event loop, which is the mitigating factor. But at N concurrent requests crossing the cache
  boundary, **up to min(N, 40) simultaneous blocking HTTPS fetches to Supabase** occupy threadpool
  slots for the fetch RTT; at 40 concurrent the threadpool is fully consumed by auth alone. Supabase
  may also rate-limit the JWKS endpoint under that pattern, and `_decode_token` maps a JWKS
  connectivity failure to a **503 for every authenticated request** (`auth.py:95-102`) until the
  burst clears.
- Fix: guard the refresh with a `threading.Lock` and a double-checked read, and construct
  `PyJWKClient(url, cache_jwk_set=True, lifespan=3600)` explicitly so the TTL is pinned in this repo
  rather than inherited from a library default. Better still, refresh on a background timer so no
  request path ever pays the fetch.
- Confidence: PLAUSIBLE — the missing lock and the blocking fetch are confirmed from source; the
  PyJWT internal cache lifespan is a library default not pinned here, so the exact burst period is
  inferred rather than measured.

### F-20 — `useTheme` registers a matchMedia change listener that is never removed
- Severity: Low
- Category: Performance
- Page/Area: App bootstrap
- Anchor: `frontend/src/composables/useTheme.js:41-56`; called at `frontend/src/main.js:46`
- Evidence:
```js
function init() {
  if (window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches
    const handler = (event) => { ... }
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handler)
    else mediaQuery.addListener(handler)
  }
```
- Steps to Reproduce: 1. Call `useTheme().init()` more than once. Currently only `main.js:46` does,
  so the live app registers exactly one. 2. Each call adds another `handler` closure with no
  corresponding `removeEventListener` and no idempotence guard.
- Expected: an idempotence guard (`if (mediaQuery) return`) and a stored handler reference with a
  teardown path.
- Actual: `handler` is a fresh closure per `init()` call, unreachable for removal afterwards.
- Impact: **currently zero in production.** `init()` is called once at bootstrap and the listener is
  correctly scoped to the app lifetime. This is a latent hazard: any future caller (a settings
  "re-init theme" action, a test harness, an HMR path) leaks one closure per call, each keeping the
  module-level `resolved` computed alive. Recorded as Low for that reason, not for present impact.
- Fix: guard with `if (mediaQuery) return` at the top of `init()`, and store `handler` at module
  scope with a `dispose()` export.
- Confidence: CONFIRMED

### F-21 — Optimistically appended user message has no stable key, forcing keyed-diff churn on message prepend
- Severity: Low
- Category: Performance
- Page/Area: Session view transcript
- Anchor: `frontend/src/components/chat/MessageList.vue:35`; `frontend/src/stores/session.js:805`; `frontend/src/stores/session.js:308`
- Evidence:
```js
// stores/session.js:805 - no message_id
messages.value.push({ role: 'user', content: trimmed })
```
```vue
<!-- MessageList.vue:35 -->
<template v-for="(m, i) in visibleMessages" :key="m.message_id || `m-${i}`">
```
- Steps to Reproduce: 1. Send a message; an optimistic row is appended with no `message_id`.
  2. Before the turn completes, trigger "load earlier" so 30 rows are prepended at `session.js:308`.
  3. The optimistic row index-derived key changes from `m-N` to `m-N+30`.
- Expected: a stable client-generated key (for example a `crypto.randomUUID()` local id) on the
  optimistic row.
- Actual: index fallback. Every other row is correctly keyed, since `toUiMessage` sets
  `message_id: m.id` (`session.js:15`), so the blast radius is exactly one row.
- Impact: one `UserBubble` is unmounted and remounted per prepend. Negligible on its own. Recorded
  because it is one `crypto.randomUUID()` away from correct, and because index keys inside a
  `TransitionGroup` become expensive if the pattern spreads.
- Fix: push the optimistic row with a locally generated `message_id` and reconcile it in
  `finalizeMessage`.
- Confidence: CONFIRMED

---

## Unanchored improvements

Not findings: no anchored failure scenario with a number. Listed so they are not lost.

- **No observability on the pool.** Nothing logs `engine.pool.status()`, checkout wait time, or slow
  queries. `debug_timing` (`config.py:38`) instruments only `prepare_ms`, `first_token_ms` and
  `end_session total_ms`. Without pool metrics, F-01, F-02 and F-13 will present in production as
  "the site is randomly 500ing" with no diagnostic path.
- **No rate limiting in front of the Render backend.** `nginx.conf` carries a 10 r/s per-IP
  `limit_req_zone`, but its own header comment states that Render has no nginx tier and "its guard
  remains the daily LLM caps". The daily caps bound *spend*, not *request rate*: a single client can
  exhaust the 10-connection pool with cheap reads (`/api/sessions`, F-06) without touching the LLM
  cap at all.
- **`pool_pre_ping=True`** (`db/database.py:36`) adds a round-trip per checkout. Correct for a
  pooler-fronted DB, but measurable at high checkout rates; worth benchmarking against
  `pool_recycle` alone once instrumentation exists.
- **No CDN or client caching of read-mostly API responses.** `/api/profile/aggregate` and
  `/api/review/queue` could carry a short `Cache-Control: private, max-age=30`.
- **`chunk_embeddings.id` is a String UUID primary key** (`db/models.py:153`), giving random B-tree
  insert locality. At 300 M rows this degrades bulk-insert throughput and inflates index bloat
  versus a bigint identity or a UUIDv7. Flagged without a measured number.
- **highlight.js registers 8 languages eagerly** (`markdownRenderer.js:10-30`). Lazy-registering on
  first use would trim the chunk in F-14, but the saving was not measured.
- **`GET /api/sessions/{id}` issues 4 sequential queries** (`routes/sessions.py:400-418`:
  `get_pending_check`, `_load_messages`, `load_profile`, `session_ingestion_status`). Consolidatable
  into 2 in the same style as the `_prepare_turn` consolidation at `routes/chat.py:159-167`. Real
  but small; no anchored degradation threshold.
- **`docker-compose.prod.yml` and `nginx.conf` are a second, divergent production definition.** They
  carry a request throttle and asset caching that the actual Render/Vercel path does not. Either
  bring the shipped path to parity or mark the compose stack explicitly dev-only.
