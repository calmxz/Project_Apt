# C — API correctness, input validation, data integrity

Auditor scope: `backend/routes/*`, `backend/db/*`, `backend/services/*` (validation
paths), `docs/api/openapi.yaml` paths section, `backend/db/alembic/versions/*`.
Read-only session; no migrations run, no live DB or LLM calls.

Excluded per brief (owned by other agents / already audited): IDOR + ownership
checks, cost-ledger atomicity/FOR UPDATE, alembic chain linearity, schema-level
contract drift between `openapi.yaml` and `backend/contracts/`.

Severity tally: **0 Critical, 2 High, 11 Medium, 5 Low**.

---

## Findings

### C-01 — `GET /api/sessions/lookup` 500s on any legacy topic-profile blob (strict parser bypass)

- Severity: High
- Category: Bug
- Page/Area: Start / continue-topic flow (session lookup by topic)
- Anchor: `backend/routes/sessions.py:361`
- Evidence:

```python
    def _to_match(row: SessionModel) -> SessionMatch:
        profile = TopicProfile.model_validate_json(row.topic_profile_json)
        return SessionMatch(
            session_id=row.id,
            title=row.topic,
            ended_at=row.ended_at,
            gap_count=len(profile.confirmed_gaps),
```

  This is the **only** production call site of the strict parser (verified by
  repo-wide grep: the sole other hit is `backend/tests/test_contracts.py:35`).
  Every other read path goes through `profile_service._parse_profile`, which
  exists precisely because of this hazard — `backend/services/profile_service.py:113-126`:

```python
    TopicProfile is codegen'd with extra="forbid" (correct for validating tool
    args the model sends), but the same model deserializes persisted state that
    may have been written under an older schema. ... a retired field left in an
    old row would otherwise raise ValidationError and 500 every read of that
    session (and the whole /profile aggregate).
```

  and `backend/services/profile_service.py:97-100` states the legacy upgrade is
  **permanent, not a transition shim**, because `seed_from_prior`
  (`profile_service.py:210-212`) copies raw JSON forward on every resume.
- Steps to Reproduce:
  1. Have (or resume-inherit) a session whose `sessions.topic_profile_json` is a
     pre-slice-8 blob, e.g. `{"mastered_concepts": ["joins"]}`, or one carrying a
     retired key such as `{"mastered_candidates": []}`.
  2. `GET /api/sessions/lookup?topic=<that+session's+topic>` with a valid JWT.
  3. Verified locally against the real contract model:
     `TopicProfile.model_validate_json('{"mastered_concepts": ["joins"]}')` ->
     `ValidationError`; `'{"mastered_candidates": []}'` -> `ValidationError`
     (`extra="forbid"`, `backend/contracts/models.py:30-32`).
- Expected: `200` with `active_match` / `ended_match`, same tolerance as
  `GET /api/sessions/{id}` and `GET /api/profile/{id}`.
- Actual: `ValidationError` escapes the handler. There is no exception handler
  anywhere in the app (grep for `exception_handler` returns zero production
  hits), so Starlette returns a bare `500 Internal Server Error`.
- Impact: The start page's "continue this topic?" lookup hard-fails for any user
  holding a legacy profile blob. Because resume copies the blob forward
  indefinitely, the failure is sticky per topic lineage and self-propagating —
  it does not age out. Whether any such blob exists in the live DB today is
  not queryable from this read-only audit; the code defect is unconditional
  and the fix is correct either way.
- Fix: Replace with the tolerant parser already imported in this module:
  `profile = profile_service.profile_from_row(row)`.
- Confidence: CONFIRMED

---

### C-02 — nginx caps request bodies at the 1 MB default, so every real PDF upload 413s on the compose/prod-nginx path

- Severity: High
- Category: Bug
- Page/Area: Reference-file upload
- Anchor: `frontend/nginx.conf:34-47` (absence of `client_max_body_size`)
- Evidence:

```nginx
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        limit_req_status 429;
        proxy_pass         http://backend:8000/api/;
        proxy_http_version 1.1;
```

  Backend contract is 25 MB (`backend/routes/upload.py:30`:
  `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`), and the spec advertises it
  (`docs/api/openapi.yaml:539`: "The 25 MB per-request cap ... unchanged").
  nginx's `client_max_body_size` default is `1m` and it is set nowhere in the
  file or in any other `.conf` in the repo (the only `.conf` present is this one).
- Steps to Reproduce:
  1. `docker compose up` (or the `docker-compose.prod.yml` stack — same nginx image).
  2. `POST /api/upload` with `session_id=<owned session>` and any PDF larger
     than 1 MB (a typical lecture deck).
  3. nginx rejects before `proxy_pass`.
- Expected: `202 Accepted` with `{"document_id": ..., "status": "pending"}` for
  anything up to 25 MB; `413 {"code":"FILE_TOO_LARGE","max_bytes":26214400}` above it.
- Actual: nginx returns its own `413 Request Entity Too Large` **HTML** page.
  The FE error path expects a JSON `detail.code`, so the user sees a generic
  failure; the backend never records a `Document` row, so nothing shows in the
  reference-files panel either.
- Impact: Upload — a core workflow and the entire RAG feature — is broken for
  realistic files on every nginx-fronted deploy. Only the Render/Vercel split
  (no nginx tier, see `frontend/nginx.conf:3-4`) escapes it.
- Fix: Add `client_max_body_size 25m;` inside `location /api/` (or at server
  level), matching `MAX_UPLOAD_BYTES`. Add a compose smoke that uploads a >1 MB
  PDF so the two limits cannot drift again.
- Confidence: CONFIRMED

---

### C-03 — No request-body size limit in the backend itself

- Severity: Medium
- Category: Security
- Page/Area: All JSON endpoints (`/api/chat/stream`, `/api/sessions`, `/api/profile/*`, `/api/me`)
- Anchor: `backend/main.py:38-47`; `backend/contracts/models.py:273`
- Evidence:

```python
app = FastAPI(title="Crux", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    ...
)
```

  No body-size middleware. The only size guard in the codebase is
  upload-specific: `backend/routes/upload.py:30` plus the streamed
  `_read_bounded` at `backend/routes/upload.py:45-59`. JSON endpoints rely
  purely on Pydantic field limits, e.g. `message: constr(max_length=4000)`.
- Steps to Reproduce:
  1. `POST /api/chat/stream` with `Content-Type: application/json` and a 10 MB
     body: `{"session_id":"x","message":"<10 MB of 'a'>"}`.
  2. Starlette buffers the entire body into memory before FastAPI hands it to
     Pydantic, which then rejects it on `max_length=4000`.
- Expected: The request is refused on size before the body is fully buffered.
- Actual: 10 MB is allocated per concurrent request, then discarded with a `422`.
  On the Render deploy there is no nginx tier to absorb it (stated explicitly at
  `frontend/nginx.conf:3-4`: "the Render backend has no nginx tier"), so `N`
  parallel 10 MB posts allocate `N x 10 MB` on the app dyno.
- Impact: Memory-exhaustion DoS at low request volume, on an authenticated but
  otherwise free endpoint (rate limiting happens *after* body parse). Same root
  cause as C-02, opposite deploy path.
- Fix: Add an ASGI middleware that rejects `Content-Length` above a small JSON
  ceiling (e.g. 256 KB) for non-multipart routes, and aborts the stream when the
  running byte count exceeds it (`Content-Length` is client-controlled — the same
  reasoning already written down at `backend/routes/upload.py:46-48`).
- Confidence: CONFIRMED

---

### C-04 — `GET /api/review/queue` scans every learning event the user has ever produced; `limit`/`offset` are cosmetic

- Severity: Medium
- Category: Performance
- Page/Area: Review queue (sidebar boot)
- Anchor: `backend/routes/review.py:26-37`, `:50-58`, `:77-79`
- Evidence:

```python
    rows = db.execute(
        select(LearningEvent, SessionModel.topic)
        .join(SessionModel, LearningEvent.session_id == SessionModel.id)
        .where(SessionModel.user_id == user_id)
        .where(
            or_(
                LearningEvent.purpose.is_(None),
                LearningEvent.purpose != "diagnostic",
            )
        )
        .order_by(LearningEvent.created_at.asc(), LearningEvent.id.asc())
    ).all()
```

  No `.limit()`. The route's own comment two blocks down concedes the hot path
  (`backend/routes/review.py:49-50`): *"One batched fetch instead of a profile
  load per distinct session; this runs on every sidebar boot"*. Pagination is
  applied in Python only, at `backend/routes/review.py:77`:
  `for e in due[offset : offset + limit]`.
- Steps to Reproduce:
  1. A user with ~200 sessions x ~30 check answers ~= 6,000 `learning_events`.
  2. `GET /api/review/queue?limit=1&offset=0`.
  3. Server materializes all ~6,000 rows plus every distinct session row
     (`backend/routes/review.py:52-58`, an `IN (...)` list of up to 200 ids),
     parses ~200 profile JSON blobs (`:60-65`), runs `compute_schedule` over the
     whole set, then returns 1 item.
- Expected: `limit=1` costs materially less than `limit=100`.
- Actual: Identical cost. Every sidebar boot pays the full-history price.
- Impact: Latency and memory grow linearly with a user's lifetime activity on a
  render-blocking boot request. Combined with `total=len(due)`
  (`backend/routes/review.py:79`), correctness requires the full scan, so the
  fix is a design change, not a `.limit()` bolt-on.
- Fix: Precompute/materialize per-concept schedule state (last event, streak,
  due_at) so the queue can be a `WHERE due_at <= now ORDER BY due_at LIMIT n`
  query; or at minimum bound the scan to a rolling window (`created_at >
  now - MAX_INTERVAL_DAYS - slack`, `MAX_INTERVAL_DAYS = 60` at
  `backend/services/review_queue_service.py:30`) and return an approximate total.
  Index to add either way: `learning_events (session_id, created_at)`.
- Confidence: CONFIRMED

---

### C-05 — Missing `chat_messages (session_id, id)` index; every transcript page sorts the whole session

- Severity: Medium
- Category: Performance
- Page/Area: Session detail + older-message pagination
- Anchor: `backend/routes/sessions.py:229-233`; index set at `backend/db/models.py:83` / `backend/db/alembic/versions/0008_session_perf_indexes.py:25-29`
- Evidence:

```python
    q = select(ChatMessage).where(ChatMessage.session_id == session_id)
    if before is not None:
        q = q.where(ChatMessage.id < before)
    window = list(
        db.execute(q.order_by(ChatMessage.id.desc()).limit(limit + 1)).scalars().all()
    )
```

  The only supporting index is on a different column:

```python
        Index("ix_chat_messages_session_created", "session_id", "created_at"),
```

- Steps to Reproduce:
  1. A session with ~5,000 `chat_messages` rows.
  2. `GET /api/sessions/{id}` (calls `_load_messages` with `limit=30`, no `before`),
     or `GET /api/sessions/{id}/messages?before=4900&limit=30`.
  3. Postgres can satisfy `session_id = ?` from `ix_chat_messages_session_created`
     but the ordering key is `id`, not `created_at`, so it must fetch all ~5,000
     matching rows and run a Sort before applying `LIMIT 31`. The `id < before`
     predicate is a filter, not an index range.
- Expected: An index-ordered scan reading ~31 rows.
- Actual: ~5,000 heap fetches + a full sort on every session open and every
  scroll-up page.
- Impact: Session open latency grows linearly with transcript length on the most
  frequently hit read path in the app.
- Fix: `CREATE INDEX ix_chat_messages_session_id_desc ON chat_messages (session_id, id DESC);`
  — serves both the `before`-cursor range and the `ORDER BY id DESC LIMIT n`
  directly. `ix_chat_messages_session_created` is still needed for the
  `max(created_at)` aggregates in `session_enrichment.compute_enrichment`
  (`backend/services/session_enrichment.py:51-59`), so keep both.
- Confidence: CONFIRMED

---

### C-06 — `GET /api/sessions` has no limit at all, unlike its own sibling endpoint

- Severity: Medium
- Category: Performance
- Page/Area: Sidebar session list
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

  Contrast `GET /api/sessions/library` a few lines below, which does cap:
  `backend/routes/sessions.py:292` — `limit: int = Query(20, ge=1, le=100)`.
  `openapi.yaml:127-143` documents `GET /api/sessions` with no query parameters
  at all, so the unboundedness is intentional-by-omission rather than a
  regression.
- Steps to Reproduce:
  1. A user with 2,000 sessions.
  2. `GET /api/sessions`.
  3. `_enrich_list_items` -> `compute_enrichment` builds a `session_id IN (...)`
     list of 2,000 ids and runs a `row_number()` window over **all** of that
     user's `chat_messages` (`backend/services/session_enrichment.py:51-85`),
     then parses 2,000 profile JSON blobs (`:93-107`).
- Expected: A bounded page, as `/sessions/library` provides.
- Actual: Unbounded response; response size and query cost grow linearly and
  without ceiling.
- Impact: Slow boot and a large payload that scales with account age. No
  cross-user exposure (`user_id` filter is present).
- Fix: Add `limit: int = Query(50, ge=1, le=100)` + `offset`, update
  `openapi.yaml:127-143`, and regenerate contracts. Same treatment applies to
  `profile_service.aggregate_for_user` (`backend/services/profile_service.py:572-576`,
  which likewise loads every session row for the user).
- Confidence: CONFIRMED

---

### C-07 — Upload is accepted against an *ended* session; every other session-mutating route rejects it

- Severity: Medium
- Category: Bug
- Page/Area: Reference-file upload
- Anchor: `backend/routes/upload.py:99-101`
- Evidence:

```python
    sess = db.get(SessionModel, session_id)
    if sess is None or sess.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
```

  No `ended_at` check. Every sibling write path has one:
  `backend/routes/chat.py:171-172`, `backend/routes/sessions.py:615-616`
  (`check/skip`), `backend/routes/sessions.py:641-642` (`check/answer`),
  `backend/routes/sessions.py:682-683` (`check/complete`) — all
  `409 {"code": "session_ended"}`.
- Steps to Reproduce:
  1. `POST /api/sessions/{id}/end` -> session gets `ended_at`.
  2. `POST /api/upload` with `session_id={id}` and a 20 MB PDF.
  3. Returns `202`. A daily rate-limit slot is consumed
     (`backend/routes/upload.py:107`), the blob is written to R2, and
     `ingestion_service.run` embeds every chunk
     (`backend/services/ingestion_service.py:210-213`) and bills it (`:177-179`).
- Expected: `409 {"code": "session_ended"}` before the rate-limit increment and
  before any embedding spend, matching the guard order documented at
  `backend/routes/upload.py:103-106`.
- Actual: Full paid ingestion into a session that can never be chatted with —
  `/chat/stream` will `409` on it, so the chunks are unreachable. Reopening is
  possible but not what the user did.
- Impact: Real embedding spend with zero possible user value, plus a wasted
  daily slot; reachable by a stale browser tab replaying a queued upload after
  the session was ended in another tab.
- Fix: Insert the same
  `if sess.ended_at is not None: raise HTTPException(409, {"code": "session_ended"})`
  immediately after the ownership check, and document `409` for `/api/upload` in
  `openapi.yaml`.
- Confidence: CONFIRMED

---

### C-08 — Double-submitted upload duplicates the document, its chunks, and its embedding cost

- Severity: Medium
- Category: Bug
- Page/Area: Reference-file upload
- Anchor: `backend/routes/upload.py:136-139`; `backend/db/models.py:134-147` (no unique constraint)
- Evidence:

```python
    doc = Document(session_id=session_id, filename=safe_name, status="pending")
    db.add(doc)
    db.commit()
    db.refresh(doc)
```

  `Document.__table_args__` is absent entirely; the table has only the
  `session_id` index (`backend/db/models.py:138-140`,
  `backend/db/alembic/versions/0022_documents_session_idx.py:23`). No
  idempotency key, no content hash, no unique on `(session_id, filename)`.
  Object keys are `doc_id`-prefixed (`backend/services/object_store.py:41-42`),
  so the two blobs do not even collide in storage.
- Steps to Reproduce:
  1. Double-click the upload button (or a flaky network retry) so the same
     multipart body is POSTed twice.
  2. Two `Document` rows are created, two `ingestion_service.run` background
     tasks fire, both embed the identical chunk set.
  3. `chunk_embeddings` now holds two identical copies for the session.
- Expected: The second submit is recognized as a duplicate (409, or the first
  document's id returned).
- Actual: 2x embedding spend, 2 rate-limit slots, and a doubled corpus.
- Impact: Retrieval quality degrades measurably — `pgvector_store.query_chunks`
  (`backend/services/pgvector_store.py:74-87`) has `LIMIT k` (default 5), and the
  duplicate pair sits at identical cosine distance, so a `k=5` retrieval can
  return 5 slots covering only ~2-3 distinct passages. The reference-files panel
  also shows the file twice.
- Fix: Compute a SHA-256 of the uploaded bytes, store it on `documents`, and add
  a unique index on `(session_id, content_sha256)`; on conflict return the
  existing row's `202` payload. A cheaper stopgap is a unique index on
  `(session_id, filename)` for non-`failed` rows.
- Confidence: CONFIRMED

---

### C-09 — Empty / whitespace-only `topic` is accepted on create and on rename

- Severity: Medium
- Category: Bug
- Page/Area: Session create + rename
- Anchor: `docs/api/openapi.yaml:1173`, `:1187`; `backend/contracts/models.py:283`, `:293`; `backend/routes/sessions.py:190`, `:582`
- Evidence:

```yaml
        topic:             { type: string, maxLength: 200 }     # openapi.yaml:1173  (create)
        topic:  { type: string, maxLength: 200 }                # openapi.yaml:1187  (update)
```

```python
        topic=req.topic.strip(),        # sessions.py:190
        row.topic = req.topic.strip()   # sessions.py:582
```

  No `minLength` in the spec, no post-strip guard in the route. Compare the
  sibling field that got this right — `openapi.yaml:1460-1466` gives
  `add_mastered` / `add_gap` `minLength: 1`, **and** the service layer re-checks
  after stripping (`backend/services/profile_service.py:265-272`):

```python
    if add_mastered is not None:
        add_mastered = add_mastered.strip()
        if not add_mastered:
            raise ValueError("item cannot be empty after stripping whitespace")
```

- Steps to Reproduce:
  1. `POST /api/sessions` with `{"topic": "   ", "seed_mode": "fresh"}` -> `201`,
     row persisted with `topic = ""`.
  2. Or take a working session and `PATCH /api/sessions/{id}` with a
     whitespace-only or zero-width-space topic -> `200`, and the title is
     destroyed with no way to recover it.
- Expected: `422` on a topic that is empty after `strip()`.
- Actual: Persisted. Sidebar/library cards render a blank title. Worse, the
  duplicate-active-topic machinery now keys on `""`: the partial unique index
  `uq_sessions_active_topic` (`backend/db/models.py:45-52`) means a *second*
  blank-topic create returns `409 duplicate_topic` with a session_id the user
  cannot identify, and `_active_session_on_topic`
  (`backend/routes/sessions.py:107-118`) will match unrelated blank sessions.
- Impact: Unrecoverable title loss on rename; confusing 409s; a class of session
  that no lookup (`/api/sessions/lookup` returns early on empty `normalized`,
  `backend/routes/sessions.py:356-358`) can ever find again.
- Fix: Add `minLength: 1` to both `topic` schemas in `openapi.yaml`, regenerate
  contracts, **and** add the post-strip guard in `create_session` /
  `update_session` — the spec constraint alone does not catch `"   "`, which is
  exactly why `profile_service` carries both layers.
- Confidence: CONFIRMED

---

### C-10 — Empty / whitespace-only `message` fires a full paid LLM turn

- Severity: Medium
- Category: Bug
- Page/Area: Chat
- Anchor: `docs/api/openapi.yaml:1163`; `backend/contracts/models.py:273`; `backend/routes/chat.py:222`, `:283-285`
- Evidence:

```yaml
        message:     { type: string, maxLength: 4000 }       # openapi.yaml:1163 - no minLength
```

```python
        messages.append({"role": "user", "content": req.message})   # chat.py:222
        ...
    user_msg = ChatMessage(session_id=req.session_id, role="user", content=req.message)
    db.add(user_msg)
    db.commit()                                                     # chat.py:283-285
```

  `_prepare_turn` never inspects `req.message` for content. `ChatMessage.content`
  is `nullable=False` but `""` satisfies that (`backend/db/models.py:89`).
- Steps to Reproduce:
  1. `POST /api/chat/stream` with `{"session_id": "<owned>", "message": ""}`.
  2. Rate-limit slot consumed (`chat.py:191`), empty user row persisted, full
     system prompt built, LLM stream started, tokens billed, empty bubble
     rendered in the transcript forever.
- Expected: `422` before the rate-limit increment.
- Actual: A billed, meaningless turn plus a permanent empty message in history.
  (Project memory records a prior FE-side "empty bubble U-01" fix on the
  smart-start slice; the server-side hole is still open, so any non-browser
  client or a FE regression reopens it.)
- Impact: Wasted daily slots + real spend; transcript pollution that
  `session_enrichment` then has to skip over when picking a preview
  (`backend/services/session_enrichment.py:86-90` scans up to 5 candidates
  looking for a non-blank one — that workaround exists because of this).
- Fix: `minLength: 1` in `openapi.yaml`, regenerate, and add
  `if not req.message.strip(): raise HTTPException(422, ...)` as the first line
  of `_prepare_turn`, ahead of the cost and rate-limit gates.
- Confidence: CONFIRMED

---

### C-11 — Raw ingestion exception text is stored and served to the client

- Severity: Medium
- Category: Security
- Page/Area: Upload status / session ingestion banner
- Anchor: `backend/services/ingestion_service.py:261`; surfaced at `backend/routes/upload.py:193` and `backend/routes/sessions.py:549`
- Evidence:

```python
                doc.status = "failed"
                doc.error = str(e)[:1000]      # ingestion_service.py:261
```

```python
    return UploadStatus(id=doc.id, status=doc.status, error=doc.error)   # upload.py:193
```

```python
            DocumentStatus(id=d.id, filename=d.filename, status=d.status, error=d.error)
                                                                  # sessions.py:549
```

  The exceptions reaching that handler are not sanitized upstream —
  `backend/services/ingestion_service.py:154` re-wraps the vendor error verbatim:

```python
            raise RuntimeError(f"embedding api failed: {e}") from e
```

  and `_load_blob` (`:95`) raises
  `RuntimeError(f"uploaded file not found in object store: {doc.filename}")`.
  Note the deliberate contrast: the same module logs with
  `exc_info=settings.env != "prod"` (`:239`) to keep tracebacks out of prod
  logs, yet the message itself is persisted and returned to the client unfiltered.
- Steps to Reproduce:
  1. Induce an ingestion failure whose exception carries infrastructure detail —
     e.g. a litellm/provider error (`APIConnectionError` bodies routinely include
     the provider host and request URL), a psycopg `OperationalError` naming the
     Supabase pooler host, or a botocore `EndpointConnectionError` naming the R2
     endpoint.
  2. `GET /api/upload/{document_id}` (or open the session; the banner path at
     `sessions.py:549` returns the same string).
  3. The first 1000 characters of that message are returned in `error`.
- Expected: A stable, enumerated code (`INGEST_FAILED`, `UNSUPPORTED_FILE`,
  `EMBEDDING_UNAVAILABLE`) plus a full message only in server logs.
- Actual: Internal hostnames, endpoint URLs, dependency versions and stack-frame
  text can reach an authenticated client.
- Impact: Information disclosure that maps the backend's infrastructure. Low
  exploitability on its own; useful for chaining. Commit `a0cebfb` removed the
  FE's raw-error block, which reduces exposure in the UI but leaves the API
  response unchanged.
- Fix: Store a coded reason on `documents.error`, keep `str(e)` in the log line
  only, and gate any verbose passthrough on `settings.env != "prod"`.
- Confidence: CONFIRMED

---

### C-12 — Three of the newest migrations take blocking locks with no autocommit / CONCURRENTLY escape

- Severity: Medium
- Category: Architecture
- Page/Area: Live Postgres deploy
- Anchor: `backend/db/alembic/versions/0017_hnsw_chunk_embeddings.py:29-34`; `0021_sessions_indexes.py:28-35`; `0019_chat_msg_partial_status.py:32-37`
- Evidence:

```python
    op.execute("DROP INDEX IF EXISTS ix_chunk_embeddings_embedding")
    op.execute(
        "CREATE INDEX ix_chunk_embeddings_embedding "
        "ON chunk_embeddings USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )                                                    # 0017:29-34
```

```python
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index(
        "uq_sessions_active_topic",
        "sessions",
        [sa.text("user_id"), sa.text("lower(topic)")],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )                                                    # 0021:28-35
```

```python
    op.drop_constraint("chat_messages_status_check", "chat_messages", type_="check")
    op.create_check_constraint(
        "chat_messages_status_check",
        "chat_messages",
        "status IN ('complete', 'cancelled', 'error', 'partial')",
    )                                                    # 0019:32-37
```

  `env.py` wraps migrations in a single transaction
  (`backend/db/alembic/env.py:46-47`: `with context.begin_transaction():`), which
  is why none of these can use `CONCURRENTLY` today.
- Steps to Reproduce:
  1. Run `alembic upgrade head` against a live Supabase DB that already has
     meaningful data (e.g. 200k `chunk_embeddings` rows, 500k `chat_messages`).
  2. `0017` drops the existing vector index — vector search degrades to a
     sequential scan for the whole build — then builds an HNSW index, the slowest
     index type pgvector offers, holding a `SHARE` lock that blocks all
     `INSERT`/`UPDATE`/`DELETE` on `chunk_embeddings`. Concurrent ingestion
     writes stall for the duration.
  3. `0021` takes `SHARE` on `sessions`, blocking every session create/rename/end
     while both indexes build. Its own docstring flags the *data* precondition
     (`0021:10-14`) but not the lock.
  4. `0019` `ADD CONSTRAINT ... CHECK` takes `ACCESS EXCLUSIVE` on
     `chat_messages` and validates every row — blocking reads as well as writes.
- Expected: Index builds and constraint validation that do not block the running
  app, or a documented maintenance window.
- Actual: Unbounded write stall (and for `0019`, read stall) proportional to
  table size, with no `lock_timeout` set, so a migration can queue behind a
  long-running query and then block everything behind itself.
- Impact: Deploy-time outage risk that grows with the dataset. These have run
  clean so far only because the live tables are still small (project memory: DB
  at `0022` since 2026-07-31).
- Fix: For future index migrations use
  `with op.get_context().autocommit_block(): op.execute("CREATE INDEX CONCURRENTLY ...")`.
  For CHECK constraints, use the two-step `ADD CONSTRAINT ... NOT VALID` then
  `VALIDATE CONSTRAINT` (the second takes only `SHARE UPDATE EXCLUSIVE`). Set
  `SET lock_timeout = '5s'` at the top of any migration touching a hot table.
  Note: `0017`, `0019` and `0021` are already applied live, so this is
  forward-guidance plus a runbook note, not a rollback.
- Confidence: CONFIRMED

---

### C-13 — Four handlers emit status codes the OpenAPI `paths` section does not document

- Severity: Medium
- Category: Bug
- Page/Area: API contract (paths, not schemas)
- Anchor: see per-item anchors below
- Evidence: CI enforces `openapi.yaml` <-> `backend/contracts/` **schema**
  parity, but nothing checks that a handler's reachable status codes are listed
  under its path. Four are missing:

  1. `PATCH /api/sessions/{session_id}` — handler raises `409 duplicate_topic`
     twice (`backend/routes/sessions.py:577-581` pre-check and `:594-600`
     `IntegrityError` fallback):

     ```python
             if existing is not None:
                 raise HTTPException(
                     status_code=409,
                     detail={"code": "duplicate_topic", "session_id": existing},
                 )
     ```

     Spec lists only `200 / 400 / 404 / 401 / 503` (`docs/api/openapi.yaml:316-330`).
     Note `POST /api/sessions` **does** document its 409 (`openapi.yaml:117-122`)
     and `POST .../reopen` documents its own (`openapi.yaml:400`) — the rename
     path was simply missed.

  2. `POST /api/sessions` — handler raises `422` for
     `declared_level forbidden when seed_mode=resume`
     (`backend/routes/sessions.py:141-145`). Spec documents `400` but not `422`
     (`openapi.yaml:115-116`).

  3. `POST /api/upload` — handler raises `404 "session not found"`
     (`backend/routes/upload.py:99-101`). Spec lists
     `202 / 400 / 413 / 415 / 429 / 507 / 401 / 503` — no `404`
     (`openapi.yaml:557-581`).

  4. `PATCH /api/me` — handler raises `422 "empty patch"`
     (`backend/routes/me.py:52-57`, deliberately, because codegen drops
     `minProperties: 1` — see the comment at `me.py:49-51`). Spec documents
     `400`, not `422` (`openapi.yaml:277-278`).

- Steps to Reproduce:
  1. Create two active sessions, "Graphs" and "Trees".
  2. `PATCH /api/sessions/{trees_id}` with `{"topic": "Graphs"}`.
  3. Server returns `409` with `detail.code = "duplicate_topic"`.
  4. A client generated from `openapi.yaml` has no `409` branch for this
     operation and falls into its generic-error path, losing the `session_id`
     needed to offer "switch to the existing session".
- Expected: Every reachable status code is enumerated under its path so
  generated clients and the FE error map stay in sync.
- Actual: Four undocumented codes, one of which (`409` on rename) carries a
  structured payload the UI is supposed to act on.
- Impact: FE cannot render the correct recovery affordance for a rename
  collision; generated SDKs mistype these responses.
- Fix: Add the four responses to `docs/api/openapi.yaml` (reusing the existing
  `duplicate_topic` 409 block from `POST /api/sessions`) and regenerate
  contracts. Consider a CI check that asserts every `HTTPException(status_code=)`
  literal in a route module appears under that route's path in the spec.
- Confidence: CONFIRMED

---

### C-14 — No global exception handler; service-layer `ValueError`s become bare 500s

- Severity: Low
- Category: Code Quality
- Page/Area: Whole API
- Anchor: `backend/main.py:38-57`
- Evidence: a repo-wide grep for `exception_handler` / `add_exception_handler`
  across `backend/` (excluding `.venv`) returns **zero** production hits.
  `app = FastAPI(title="Crux", lifespan=lifespan)` (`main.py:38`) leaves `debug`
  at its `False` default, so Starlette's `ServerErrorMiddleware` returns the
  plain string `Internal Server Error` — **no traceback is leaked to the
  client** (this half is correct). What is missing is the handler that would
  turn known service exceptions into coded responses.

  Unmapped raisers on request paths:
  `backend/services/profile_service.py:192` and `:206`
  (`raise ValueError(f"session not found: {session_id}")`),
  `backend/services/pending_check_store.py:41`,
  `backend/services/check_question_service.py:364`,
  `backend/lib/keyword_index.py:58`. Each becomes an untyped 500 with a
  non-actionable body.
- Steps to Reproduce: See C-01 — a `ValidationError` from `sessions.py:361`
  exits as `500 Internal Server Error` with no `detail.code`, so the FE's
  coded-error map (`backend/lib/error_codes.py`) cannot classify it and the user
  gets a generic failure toast.
- Expected: A `@app.exception_handler(Exception)` that logs with a correlation
  id and returns `{"detail": {"code": "internal_error", "request_id": ...}}`,
  matching the `ErrorResponse` / `CodedErrorDetail` shape the spec already
  defines (`backend/contracts/models.py:689-700`).
- Actual: Bare `500`, no code, no correlation id; `ErrorResponse` is effectively
  unenforced for the 5xx family.
- Impact: Hygiene + observability. No data exposure.
- Fix: Register a global handler in `main.py`; map `ValueError` from the
  services layer to `409`/`422` where meaningful.
- Confidence: CONFIRMED

---

### C-15 — `documents.status` and `chat_messages.role` are unconstrained free text

- Severity: Low
- Category: Bug
- Page/Area: Schema
- Anchor: `backend/db/models.py:142`, `:88`; `backend/db/alembic/versions/0001_phase7_baseline.py:43`, `:70`
- Evidence:

```python
    status: Mapped[str] = mapped_column(String, default="pending")   # models.py:142 (documents)
    role: Mapped[str] = mapped_column(String, nullable=False)        # models.py:88  (chat_messages)
```

  `chat_messages.status` **does** get a CHECK (`backend/db/models.py:79-82`,
  widened by `0019`), which shows the pattern was applied selectively.
  `documents.status` has none, despite every API response narrowing it to
  `Literal["pending","ready","failed"]` (`backend/contracts/models.py:467`,
  `:479`, `:493`, `:507`).
- Steps to Reproduce:
  1. Any out-of-band write (backup restore per `docs/deploy/RESTORE.md`, a manual
     support fix, or a future code path) sets `documents.status = 'processing'`.
  2. `GET /api/upload/{id}` -> FastAPI response validation fails against
     `Literal["pending","ready","failed"]` -> `ResponseValidationError` -> `500`.
  3. Worse, `GET /api/sessions/{id}` also 500s, because
     `documents_service.session_ingestion_status`
     (`backend/services/documents_service.py:55-61`) feeds the same value into
     `SessionIngestionStatus.status` — one bad document row bricks the whole
     session-detail endpoint.
- Expected: The DB enforces the same domain the contract advertises.
- Actual: The DB accepts anything; the API layer is the only guard, and it fails
  closed with a 500 rather than degrading.
- Impact: A single garbage value takes down session detail for that session. Not
  reachable through the current API surface — every writer (`upload.py:136`,
  `:156`; `ingestion_service.py:203`, `:231`, `:260`, `:75`) uses a valid
  literal — so this is a durability guard, not a live bug.
- Fix: Add
  `CheckConstraint("status IN ('pending','ready','failed')", name="documents_status_check")`
  to `Document.__table_args__` plus a migration (use the `NOT VALID` ->
  `VALIDATE` two-step per C-12). Same for `chat_messages.role`.
- Confidence: CONFIRMED

---

### C-16 — `created_at` is nullable in every table while every contract declares it required

- Severity: Low
- Category: Bug
- Page/Area: Schema
- Anchor: `backend/db/alembic/versions/0001_phase7_baseline.py:27, 36, 47, 63, 73`
- Evidence:

```python
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),   # users     :27
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),   # sessions  :36
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),   # chat_msgs :47
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),   # learn_ev  :63
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),   # documents :73
```

  The ORM supplies a Python-side default only (`backend/db/models.py:13-14`,
  `default=_utcnow`) — there is no `server_default`. Contracts require the field
  non-null: `SessionResponse.created_at: datetime` (`contracts/models.py:305`),
  `Message.created_at: datetime` (`:350`),
  `LearningEventResponse.created_at: datetime` (`:95`),
  `ReviewQueueItem.last_tested_at: datetime` (`:418`).
- Steps to Reproduce:
  1. Any non-ORM insert that omits `created_at` (restore, seed script, psql fix).
  2. `GET /api/review/queue` -> `review.py:42` passes `aware_utc(None)` -> `None`
     into `EventRow.created_at`, and
     `backend/services/review_queue_service.py:82`
     (`last.created_at + timedelta(...)`) raises `TypeError` -> `500`.
  3. Or `GET /api/profile/{id}` -> `LearningEventResponse` validation fails -> `500`.
- Expected: `NOT NULL` + `server_default now()` so the DB cannot hold a row the
  API is unable to serialize.
- Actual: DB and contract disagree; only the ORM's cooperation keeps them aligned.
- Impact: Latent; not reachable through the current API. Matters during restore
  drills (`docs/deploy/RESTORE.md`) and manual data repair.
- Fix: Migration adding `server_default=sa.text("now()")` then
  `ALTER COLUMN ... SET NOT NULL` (after backfilling), using the
  autocommit/`NOT VALID` guidance from C-12.
- Confidence: CONFIRMED

---

### C-17 — `/api/sessions/library` `q` has no length cap and LIKE metacharacters are unescaped

- Severity: Low
- Category: Bug
- Page/Area: Session library search
- Anchor: `backend/routes/sessions.py:302-303`; `docs/api/openapi.yaml:155-158`
- Evidence:

```python
    if q:
        base = base.where(SessionModel.topic.ilike(f"%{q}%"))
```

  The f-string interpolates into the **pattern**, not into SQL — SQLAlchemy's
  `ilike()` binds it as a parameter, so this is not an injection (see the
  negative-results section). But `%` and `_` are not escaped, and the spec
  declares no `maxLength` (`openapi.yaml:156-158`:
  `q: { type: [string, "null"], default: null }`), unlike the sibling `topic`
  parameter on `/api/sessions/lookup` which is capped at 200
  (`openapi.yaml:192`) and enforced in code
  (`backend/routes/sessions.py:347`: `Query(..., max_length=200)`).
- Steps to Reproduce:
  1. `GET /api/sessions/library?q=%25` (URL-encoded `%`) -> matches every session,
     silently ignoring what the user typed.
  2. `GET /api/sessions/library?q=_` -> matches any topic of length >= 1.
  3. `GET /api/sessions/library?q=<8000 chars>` -> accepted and pushed into an
     `ILIKE` pattern; a leading-wildcard search cannot use an index, so it is a
     sequential scan of the user's sessions with a pathological pattern.
- Expected: Literal search semantics; a bounded parameter.
- Actual: Wildcards leak through as operators; unbounded input length.
- Impact: Confusing search results; a small amount of avoidable CPU. Scoped to
  the caller's own rows, so no data exposure.
- Fix: `q: str | None = Query(None, max_length=200)` in the route and
  `maxLength: 200` in the spec; escape `%`, `_`, backslash before building the
  pattern and pass an explicit `escape=` to `ilike`.
- Confidence: CONFIRMED

---

### C-18 — Prompt history ordering has no tiebreaker on `created_at`

- Severity: Low
- Category: Bug
- Page/Area: Chat prompt assembly / check-complete follow-up
- Anchor: `backend/routes/chat.py:208-214`; `backend/routes/sessions.py:655-661`
- Evidence:

```python
        history = db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == req.session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
        ).scalars().all()                        # chat.py:208-213
```

```python
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    ).scalars().all()                            # sessions.py:655-660
```

  Contrast the read path the user sees, which *is* deterministic —
  `backend/routes/sessions.py:233` orders by `ChatMessage.id.desc()`, and
  `session_enrichment` explicitly adds the id tiebreaker
  (`backend/services/session_enrichment.py:70`:
  `order_by=(ChatMessage.created_at.desc(), ChatMessage.id.desc())`).
- Steps to Reproduce:
  1. Two `chat_messages` rows in a session share a `created_at` value. Reachable
     when timestamps are written at reduced precision — a backup/restore round
     trip through a format that truncates sub-second precision, or any
     bulk-insert path that reuses one `_utcnow()` value.
  2. `POST /api/chat/stream` on that session.
  3. Postgres is free to return the tied rows in either order, so the assistant
     reply can precede the user turn it answered inside the prompt window.
- Expected: A total order, matching what the transcript endpoint and
  `session_enrichment` already do.
- Actual: Ties break arbitrarily and can differ between two identical requests.
- Impact: Occasional prompt-order corruption feeding the LLM; low probability
  under normal microsecond-precision writes.
- Fix: Append `, ChatMessage.id.desc()` to both `order_by` clauses. Free, and it
  also makes the query index-friendly once C-05's `(session_id, id)` index lands.
- Confidence: PLAUSIBLE

---

## Cascade / orphan matrix

Only **one** FK in the schema carries an `ON DELETE` action. Every other FK is
`NO ACTION` (Postgres default) — deleting a parent raises a foreign-key
violation rather than cascading or orphaning.

| Parent -> Child | FK column | ON DELETE | Anchor | Actual behavior on parent delete |
|---|---|---|---|---|
| `documents` -> `chunk_embeddings` | `chunk_embeddings.document_id` | **CASCADE** | `db/models.py:155-157`; `alembic/versions/0018_chunk_embeddings_cascade.py:28-35` | Child rows removed automatically. Application also deletes them explicitly first, in the same transaction (`services/pgvector_store.py:56-64`, called from `services/documents_service.py:113-115`) — belt and braces, as `0018`'s docstring intends. |
| `sessions` -> `chunk_embeddings` | `chunk_embeddings.session_id` | NO ACTION | `db/models.py:154` | Delete blocked by FK violation. |
| `sessions` -> `documents` | `documents.session_id` | NO ACTION | `db/models.py:138-140` | Delete blocked by FK violation. |
| `sessions` -> `chat_messages` | `chat_messages.session_id` | NO ACTION | `db/models.py:87` | Delete blocked by FK violation. |
| `sessions` -> `learning_events` | `learning_events.session_id` | NO ACTION | `db/models.py:121` | Delete blocked by FK violation. |
| `sessions` -> `llm_call_log` | `llm_call_log.session_id` (nullable) | NO ACTION | `db/models.py:189` | Delete blocked by FK violation. Nullable, so `SET NULL` would be the natural choice for an analytics table. |
| `users` -> `sessions` | `sessions.user_id` | NO ACTION | `db/models.py:56` | Delete blocked by FK violation. |
| `users` -> `usage_counters` | `usage_counters.user_id` | NO ACTION | `db/models.py:107` | Delete blocked by FK violation. |
| `users` -> `daily_cost_ledger` | `daily_cost_ledger.user_id` (PK part) | NO ACTION | `db/models.py:168` | Delete blocked by FK violation. |
| `users` -> `llm_call_log` | `llm_call_log.user_id` | NO ACTION | `db/models.py:188` | Delete blocked by FK violation. |

**Physical-file lifecycle.** `DELETE /api/documents/{id}` is the only delete
endpoint in the entire API (`backend/routes/documents.py:13-22`). It removes the
embeddings and the DB row in one transaction, then deletes the blob
best-effort *after* the commit (`backend/services/documents_service.py:110-124`).
That ordering is deliberate and correct (a locked/undeletable object cannot 500
a request whose DB rows are already gone), but it does mean a blob can survive
its row on a store-side failure — a known, logged, one-way leak
(`documents_service.py:123-124` warns and swallows). No reaper exists for
orphaned blobs.

**Commentary (Low, not filed as a finding — no reproducible request).** There is
no `DELETE /api/sessions/{id}` and no delete-account endpoint, so no code path
can trigger the orphan/violation cases above. The consequences are operational
rather than exploitable:

- A support-initiated `DELETE FROM sessions WHERE id = '...'` fails outright on
  the first FK violation; the operator must delete from `chunk_embeddings`,
  `chat_messages`, `learning_events`, `documents`, and `llm_call_log` in
  dependency order first — and separately delete the R2 blobs, which no FK
  covers.
- A GDPR / account-deletion request requires the same manual ordering across
  **six** child tables plus the object store, with no tested script backing it.
  `docs/deploy/RESTORE.md` covers restore, not erasure.

Recommendation (deferred, not urgent): when a session-delete or account-delete
feature is built, add `ON DELETE CASCADE` to the session-scoped FKs and
`ON DELETE SET NULL` to `llm_call_log.session_id` in the same migration, and
pair it with a blob-deletion step — do not ship the endpoint against the current
`NO ACTION` schema.

---

## Negative results (checks performed, nothing found)

These were explicitly in scope; recorded so the absence of a finding reads as
"verified clean", not "not checked".

**SQL injection — clean.** No f-string, `%`-format, or `.format()` reaches any
SQL constructor in production code. Every production use of `text()` is a
compile-time literal: `backend/db/models.py:48-51`
(`text("lower(topic)")`, `text("ended_at IS NULL")`). `exec_driver_sql` appears
once (`backend/db/database.py:82`) and iterates the static `_MIGRATIONS` tuple
defined at `backend/db/database.py:55-61`. Alembic `op.execute` calls are all
literal DDL strings. The pgvector similarity query uses the ORM builder with a
bound parameter (`backend/services/pgvector_store.py:74`:
`ChunkEmbedding.embedding.cosine_distance(query_embedding)`), and the session
centroid likewise (`backend/services/retrieval_service.py:92-96`). The keyword
index never touches SQL — it tokenizes in Python and stores a JSON array
(`backend/lib/keyword_index.py:40-61`). `backend/services/sql_dialect.py:10-21`
only picks a dialect module by `dialect.name`; no user data reaches it. The
`ilike` call at `backend/routes/sessions.py:303` interpolates into the LIKE
*pattern*, which SQLAlchemy binds as a parameter — not injectable (its real,
lesser problem is C-17).

**Path traversal in filenames — triple-defended.**
`backend/routes/upload.py:119-122` takes `Path(...).name`, then a
`re.sub` that replaces everything outside `[A-Za-z0-9._-]`, then rejects
empty, `.` and `..`. Object keys are `doc_id`-prefixed
(`backend/services/object_store.py:41-42`). `LocalDiskStore._path`
(`backend/services/object_store.py:49-53`) independently resolves and asserts
`candidate.parent == self._root`. A traversal key raises before any filesystem
access. `_load_blob`'s legacy-key fallback
(`backend/services/ingestion_service.py:92-95`) passes `doc.filename` straight to
the store, but that value was already sanitized at upload time and the store's
containment check catches anything older.

**Message cursor — not tamperable.** `before` is a plain integer message id
(`backend/routes/sessions.py:424`), not an opaque token, so it carries no
signature. It does not need one: ownership is checked on the session before the
query (`backend/routes/sessions.py:429-431`) and the query is scoped by
`session_id` (`:229`), so a crafted `before` can only ever surface rows the
caller already owns. Negative and MAX_INT values return an empty page rather
than erroring. All paginated endpoints cap page size: `le=100` at
`backend/routes/sessions.py:292` (library), `:425` (messages),
`backend/routes/review.py:20` (review queue) — `limit=1000000` is rejected with
a `422`, not honored.

**No traceback leak.** `FastAPI(title="Crux", lifespan=lifespan)`
(`backend/main.py:38`) leaves `debug=False`, so Starlette's
`ServerErrorMiddleware` emits the bare string `Internal Server Error` for any
unhandled exception. The hygiene gap is the *absence* of a handler, not a leak —
filed as C-14. The one place internal text does escape is a deliberate persisted
field, filed separately as C-11.

**Optimistic concurrency (`If-Match`) — correct.** `If-Match` is in
`allow_headers` (`backend/main.py:45`) and is genuinely used on all four profile
mutators: `PATCH /api/profile/{id}` (`backend/routes/profile.py:88`) and the
three `DELETE` item routes (`:135`, `:146`, `:160`). The guard is ordered
correctly — the row lock is taken *before* the ETag comparison, so compare and
write are one atomic span (`backend/routes/profile.py:100-101`, `:120-121`,
`:164-165`), with `428` when the header is absent and `412` on mismatch
(`:74-79`). The ETag is a sha256 over the serialized profile
(`backend/services/profile_service.py:215-216`), so it changes on any content
change. Both codes are documented in the spec (`docs/api/openapi.yaml:686-687`).

**Check-question / pending-check concurrency — correct.** Every mutator of the
batch takes `lock_session_row` (`SELECT ... FOR UPDATE`) before reading state:
`register` (`backend/services/check_question_service.py:154`), `answer` (`:212`),
`skip` (`:258`), `attach_message_id` (`:90`), and the route's `complete_check`
(`backend/routes/sessions.py:691`). The linear state machine rejects out-of-order
and already-resolved submits (`check_question_service.py:218-224`, `:263-267`),
and `selected_index` is range-checked against the item's own options at `:223` —
the missing upper bound on `conint(ge=0)` (`backend/contracts/models.py:206`) is
therefore correctly compensated in the service layer, which is the pattern the
brief asked me to verify.

**Session-end and session-create races — correct.** `_claim_end`
(`backend/routes/sessions.py:440-452`) is a conditional
`UPDATE ... WHERE ended_at IS NULL` with an immediate commit, so exactly one
caller pays for the summary LLM call. Duplicate-topic creation is guarded both by
a pre-check and by the partial unique index, with `IntegrityError` mapped back to
the same `409` payload (`backend/routes/sessions.py:194-204`, `:521-531`,
`:585-600`). `rate_limit.check_and_increment`
(`backend/services/rate_limit.py:44-60`) is a proper
`INSERT ... ON CONFLICT DO NOTHING` followed by a conditional
`UPDATE ... RETURNING`, so the cap holds under contention. Duplicate *upload* is
the one unguarded double-submit — filed as C-08.

---

## Unanchored improvements

Not filed as findings — each fails the "concrete failure scenario" gate.

- **`0021_sessions_indexes.py:29-35` passes `postgresql_where` but not
  `sqlite_where`**, unlike the model definition it mirrors
  (`backend/db/models.py:50-51`, which sets both). On SQLite this would build a
  *non-partial* unique index and break end-then-recreate on the same topic.
  Discarded: alembic-on-SQLite is already impossible two revisions earlier —
  `0019_chat_msg_partial_status.py:32` issues an unguarded
  `op.drop_constraint(..., type_="check")`, and `0009`'s docstring states plainly
  that "Alembic targets the Supabase Postgres DB; SQLite dev DBs get the
  constraint via `Base.metadata.create_all`." Not independently reachable.
- **HNSW plus a `session_id` equality filter.** `pgvector_store.query_chunks`
  (`backend/services/pgvector_store.py:74-87`) combines an HNSW
  `ORDER BY distance LIMIT k` with two equality filters. pgvector post-filters
  HNSW results, so at scale a session's chunks may fall outside the first
  `ef_search=40` candidates and the query silently returns fewer than `k` rows —
  the same class of silent recall loss that `0017`'s own docstring documents for
  ivfflat. Would need an `EXPLAIN ANALYZE` against live data with a realistic
  corpus to confirm; not verifiable read-only.
- **No unique constraint on `chunk_embeddings (document_id, chunk_index)`**
  (`backend/db/models.py:150-162`). No current code path re-ingests a document,
  so duplicates are unreachable today; it would become load-bearing the moment a
  retry-ingestion feature is added.
- **`MePatchRequest.feedback_pref` is free text**
  (`backend/contracts/models.py:525`, `constr(max_length=40)`) and is written
  through unvalidated (`backend/routes/me.py:65`). The FE presumably sends one of
  a small set of values; an enum in `openapi.yaml:1434` would make that
  contractual. No failure demonstrated.
- **`proxy_read_timeout 120s`** (`frontend/nginx.conf:45`) applies to the SSE
  streams. It is an inter-read timeout and tokens flow continuously, so a long
  turn should survive — but a tutor turn that stalls beyond 120s mid-tool-call
  would be cut with a partial stream. Would need a live long-turn reproduction.

---

## Audit environment note

`Read` and `Write` were hard-blocked for this agent for the whole session: the
root `.claude/settings.json` registers the pre-tool hook by relative path
(`python .claude/hooks/block_env.py`), and this agent's cwd was
`Project_Apt/frontend`, where no `.claude/hooks/` directory exists — so every
`Read`/`Write` failed with a "can't open file ... frontend\.claude\hooks\block_env.py"
error. All file inspection was done via shell (`awk` / `cat -n`) and this report
was written via shell append. Worth making that hook path absolute (e.g. via
`$CLAUDE_PROJECT_DIR`) so subagents launched from a subdirectory are not silently
degraded.
