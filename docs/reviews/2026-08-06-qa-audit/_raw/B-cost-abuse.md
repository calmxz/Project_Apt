# B — Cost control & abuse audit

Auditor scope: cost cap, rate limiting, deploy config, ingestion/token growth.
Read-only pass, 2026-08-06, branch `dev` @ a0cebfb. No live LLM or Supabase calls.

## Cap architecture summary

- **What is capped:** cumulative USD LLM spend per UTC day, plus a separate
  request counter (`DAILY_CAP`, 50/day) shared by chat and upload.
- **By what key: PER-USER, not global.** `daily_cost_ledger` PK is
  `(user_id, date_utc)` (`backend/db/models.py:168-169`) and every read filters
  `user_id ==` (`backend/services/cost_meter.py:71-74`, `204-211`). No aggregate
  / fleet-wide query exists anywhere in the repo. **The mission "Critical if
  global" case does not fire** — one abusive user cannot deny service to others
  via the ledger. The inverse problem applies instead (B-04).
- **Where checked — chat:** BEFORE the LLM call. `_prepare_turn` gates at
  `backend/routes/chat.py:137-153`, synchronously, before `StreamingResponse` is
  constructed; re-checked at the top of every agent iteration
  (`backend/agent/tutor.py:173-191`). Sound.
- **Where checked — upload/ingestion: NEVER.** `backend/routes/upload.py` calls
  only the request counter; `backend/services/ingestion_service.py:174-176`
  states in-code "NO cap gate here". This is B-01.
- **Under what lock: none on the ledger.** The claimed `FOR UPDATE` exists only
  on **session** rows (`backend/lib/keyword_index.py:56`,
  `backend/services/profile_service.py:204`). The *write* is atomic (`INSERT
  ... ON CONFLICT DO UPDATE`, `cost_meter.py:90-102`) so no increment is lost,
  but the read-check-spend window is unprotected (B-05).
- **Rate-limit store: shared Postgres** (`usage_counters`), so multi-instance
  safe and race-free (`backend/services/rate_limit.py:51-61`). Flip side:
  horizontal scaling widens the unlocked cost-cap read window.
- **Limits present:** file size 25 MB, streamed enforcement (`upload.py:30`,
  `45-59`). **Absent:** page count, chunk count, per-user daily embedding volume,
  per-IP/burst rate limit on the Render deploy, any global spend ceiling.
### Verified sound (no finding filed)

- **Q6 disconnect mid-stream is charged.** `chat.py:345` breaks on
  `request.is_disconnected()` then `task.cancel()` (`:364-370`), and the tutor
  `CancelledError` arm bills the unbilled tail (`tutor.py:528-535`) using
  `estimate_cancelled_cost` (full prompt + streamed output tokens).
- **Q6 embeddings are metered** at all three call sites: ingestion
  (`ingestion_service.py:177`), `retrieve_chunks` (`retrieval_service.py:55`),
  and both prompt-prefetch paths (`retrieval_service.py:146`, `215`).
- **Q6 error-arm double-count is intentional.** `tutor.py:573-592` re-estimates
  the whole turn after a mid-turn failure; documented as deliberately
  conservative in the cap's favour. Not a bug.
- **Q8 conversation growth cannot be defeated by one enormous message.**
  `ChatRequest.message` is `constr(max_length=4000)`
  (`backend/contracts/models.py:273`, matching `docs/api/openapi.yaml:1163`), and
  history is bounded at 20 messages x 6000 chars
  (`chat.py:208-221` + `agent/context_budget.py:11`). Within a turn,
  `prune_superseded_excerpts` stubs stale retrieval payloads. This part of the
  design holds.
- **Q7 cap affordance is otherwise clean.** `frontend/src/lib/capErrors.js`
  maps both transports to structured banner state and
  `frontend/src/components/chat/CapBanners.vue` renders human copy. The one
  remaining raw-envelope leak is B-06.

---

### B-01 — Upload and ingestion bypass the LLM cost cap entirely

- Severity: **Critical**
- Category: Security
- Page/Area: Backend — upload -> ingestion pipeline
- Anchor: `backend/routes/upload.py:103-117`, `backend/routes/upload.py:167-171`, `backend/services/ingestion_service.py:172-179`
- Evidence:

```python
# backend/routes/upload.py:107  (the ONLY guard before paid work is queued)
    allowed, used = rate_limit.check_and_increment(db, user_id)
...
# backend/routes/upload.py:167-171
    background_tasks.add_task(ingestion_service.run, doc.id)
    warn = cost_meter.cost_warning_header(db, user_id)   # advisory only, AFTER dispatch
```

```python
# backend/services/ingestion_service.py:172-179
    for resp, batch in pending_meter:
        # F-19: ingestion is the largest embedding spender; meter it.
        # Metering only -- NO cap gate here. Ingestion is already
        # rate-limited at upload time, and failing a document mid-pipeline
        # for a cap breach would strand it (F-26 territory, Batch 5).
        cost_meter.meter_embedding_response(
```
- Steps to Reproduce:
  1. Sign in as any confirmed user whose `daily_cost_ledger` row already exceeds
     `LLM_HARD_CAP_USD` (chat is correctly 429'd by `chat.py:143`).
  2. `POST /api/upload` with a 25 MB `.txt` file (`.txt` is in
     `ALLOWED_EXTENSIONS`, `upload.py:31`, and is exempt from the magic-byte
     sniff, `upload.py:35-38`).
  3. Upload succeeds with `202`. `ingestion_service.run` embeds the whole
     document. Repeat until the shared 50/day request counter is exhausted.
- Expected: a user over the hard cap cannot purchase any further LLM tokens.
  The cost cap is documented (`cost_meter.py:4-5`, and `frontend/nginx.conf:4` —
  "the Render backend has no nginx tier; its guard remains the daily LLM caps")
  as the money guard.
- Actual: the cap gates chat only. Ingestion — the pipeline the code itself
  calls "the largest embedding spender" — is gated solely by a request count,
  which is cost-blind: 1 upload and 1 chat turn consume the same single slot.
- Impact: structural. Spend on the embedding path is bounded by *request count*,
  not by dollars, so the configured dollar cap is not an upper bound on a user's
  daily spend at all. Illustrative magnitude with the in-repo rate table
  (`cost_meter.py:227-230`, flagged in-code as a placeholder — verify before
  quoting externally): 25 MB of text is roughly 6.25 M tokens; at 500-token
  chunks with 450-token stride (`backend/lib/chunking.py:34-35`, `46`) that is
  about 13.9 k chunks / 6.9 M embedded tokens / **~$1.04 for a single upload**,
  against a Render hard cap of $1.00 (`render.yaml:23`). The 50 daily slots are
  shared with chat, so the realistic worst case is ~50 uploads / **~$52 per user
  per day, roughly 52x the configured cap**. Multiply by accounts (see B-04).
- Fix: call `cost_meter.check_cap(db, user_id)` next to
  `rate_limit.check_and_increment` in `upload.py` and return the same 429
  `daily_cost_cap_reached` envelope chat uses — this rejects before any blob is
  written or task queued, so the stranded-document concern the ingestion comment
  raises does not apply. Separately, bound embedding volume per user per day
  (a token-count ledger, or reject documents above N chunks pre-embed).
- Confidence: CONFIRMED

---

### B-02 — Large ingestions starve the shared 40-slot threadpool, including `/health`

- Severity: **Critical**
- Category: Performance
- Page/Area: Backend — process-wide request dispatch
- Anchor: `backend/routes/upload.py:167`, `backend/services/ingestion_service.py:144-152`, `backend/routes/health.py:13`, `render.yaml:10`
- Evidence:
```python
# backend/services/ingestion_service.py:144-152 - SYNC blocking HTTP, one call per 100 chunks
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        try:
            resp = litellm.embedding(          # blocking; timeout=embedding_timeout_s (15s)
                model=settings.embedding_model,
```

```python
# starlette/background.py:19-23 (backend/.venv) - sync task -> threadpool
    async def __call__(self) -> None:
        if self.is_async:
            await self.func(*self.args, **self.kwargs)
        else:
            await run_in_threadpool(self.func, *self.args, **self.kwargs)
```

```python
# starlette/concurrency.py:30-32 (backend/.venv) - NO custom limiter is passed
async def run_in_threadpool(func: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    func = functools.partial(func, *args, **kwargs)
    return await anyio.to_thread.run_sync(func)
```

```python
# fastapi/routing.py:327-330 (backend/.venv) - sync path operations use the SAME function
    if is_coroutine:
        return await dependant.call(**values)
    else:
        return await run_in_threadpool(dependant.call, **values)
```

```python
# anyio/_backends/_asyncio.py:2953-2959 (backend/.venv) - the shared default limiter
    def current_default_thread_limiter(cls) -> CapacityLimiter:
        try:
            return _default_thread_limiter.get()
        except LookupError:
            limiter = CapacityLimiter(40)
```

- Steps to Reproduce:
  1. `ingestion_service.run` is a plain `def`, so `background_tasks.add_task`
     (`upload.py:167`) routes it through `run_in_threadpool` and onto the
     **default** anyio `CapacityLimiter(40)`. `backend/main.py` never overrides
     it (no `total_tokens` / `CapacityLimiter` reference in the file).
  2. The large majority of route handlers are sync `def` — including
     `health.py:13 def health` and `upload.py:67 def upload_file` — so FastAPI
     dispatches them through that *same* 40-token limiter.
  3. Submit 40 concurrent uploads of large text documents (any mix of accounts;
     each needs only one of that account's 50 daily slots). Each ingestion holds
     one thread for `ceil(chunks/100)` sequential blocking embedding calls — for
     a 25 MB file that is ~139 calls at up to 15 s each.
- Expected: background ingestion is isolated from request serving; `/health`
  answers regardless of ingestion load.
- Actual: all 40 tokens are held by ingestion threads. Every sync route —
  `/health`, `/api/upload`, `/api/sessions`, `/api/usage/summary` — queues behind
  them.
- Impact: `render.yaml:10` sets `healthCheckPath: /health`. A starved `/health`
  fails the Render health check, Render restarts the instance, every in-flight
  SSE chat stream for every user dies, and the restart re-enters the same state
  as soon as the uploads are retried. Cross-tenant availability denial triggered
  by one account's uploads. (`chat_stream` is `async def` and is not itself
  threadpool-bound, but it dies with the instance.)
- Fix: run ingestion off the request threadpool — a dedicated executor with its
  own bounded `CapacityLimiter`, or a real queue/worker. Minimum stopgap: make
  `health.health` `async def` so liveness cannot be starved, and cap concurrent
  ingestions per instance.
- Confidence: CONFIRMED

---
### B-03 — Ingestion has no bound on document token count; peak memory scales linearly and embeddings are retained twice

- Severity: **High**
- Category: Performance
- Page/Area: Backend — ingestion pipeline
- Anchor: `backend/services/ingestion_service.py:169-180`, `backend/services/ingestion_service.py:201-213`, `render.yaml:7`
- Evidence:

```python
# backend/services/ingestion_service.py:169-180
            pending_meter.append((resp, batch))   # holds EVERY batch response for the whole run
        for item in resp.data:
            out.append(item["embedding"] if isinstance(item, dict) else item.embedding)
    for resp, batch in pending_meter:
        ...
        cost_meter.meter_embedding_response(
```

```python
# backend/services/ingestion_service.py:201-213 - no size gate between chunking and embedding
            chunks = chunking.chunk_text(pages)
            if not chunks:
                ...
            embeddings = _embed_all(
                db, [c.text for c in chunks], user_id=owner_id, session_id=doc.session_id,
```

- Steps to Reproduce:
  1. Upload a large text document (`.txt` up to the 25 MB ceiling, or a
     text-dense PDF whose decompressed text far exceeds its file size — the
     25 MB gate is on *file* bytes, not extracted text).
  2. `chunk_text` materialises one flat token list plus a parallel
     `page_of_token` list for the entire document
     (`backend/lib/chunking.py:22-29`), then one `Chunk` per 450-token stride.
  3. `_embed_all` accumulates every 768-float vector in `out` **and**
     simultaneously retains every batch's full response object in
     `pending_meter` until the loop finishes — the vector data is held roughly
     twice at peak, purely so metering can be deferred (the B-01 lock-hold
     mitigation noted at lines 156-161).
- Expected: peak memory is bounded by a per-document limit, independent of how
  large a file the 25 MB gate admits.
- Actual: peak RSS grows linearly with document token count, with a ~2x constant
  on the embedding vectors, and nothing rejects a document before that point.
- Impact: `render.yaml:7` sets `plan: free` (512 MB). A single upload well below
  the 25 MB ceiling can exhaust it: at 768 dimensions each vector is a multi-KB
  Python list, so ~14 k chunks is already hundreds of MB before the duplicate
  retention, plus the flat token/page lists for millions of tokens. OOM kills
  the instance (same blast radius as B-02). The upload is lost too: on restart
  `reap_stale_pending` (`ingestion_service.py:68-81`) marks the in-flight
  document `failed` with "please re-upload", inviting the user to repeat the OOM.
- Fix: reject documents above a chunk/token threshold before embedding (return a
  413-style coded error at ingestion start and mark the doc failed with useful
  copy). Stream batches instead of accumulating: meter each batch immediately
  into a savepoint, or keep only the computed `Decimal` and the usage counts
  rather than the whole response object, and drop `pending_meter`.
- Confidence: CONFIRMED

---
### B-04 — No global spend ceiling: cost control is strictly per-user with no fleet-wide kill switch

- Severity: **High**
- Category: Architecture
- Page/Area: Backend — cost metering; deploy config
- Anchor: `backend/db/models.py:168-169`, `backend/services/cost_meter.py:204-211`, `render.yaml:11-45`
- Evidence:

```python
# backend/db/models.py:168-169 - the ledger has no aggregate dimension
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    date_utc: Mapped[str] = mapped_column(String, primary_key=True)  # YYYY-MM-DD
```

```python
# backend/services/cost_meter.py:204-211 - every spend read is user-scoped
        select(func.coalesce(func.sum(DailyCostLedger.cost_usd), 0))
        .where(
            DailyCostLedger.user_id == user_id,
            DailyCostLedger.date_utc == _today_utc(),
        )
```

- Steps to Reproduce:
  1. Register N accounts. Precondition: `docs/auth/supabase-setup.md:22` records
     **Confirm email: ON**, so each account needs a confirmable mailbox — this
     raises the bar (plus-addressing / disposable domains, not a one-line
     script) but does not cap N. *This precondition was read from the setup doc,
     not verified against the live Supabase project this session.*
  2. Each account independently spends up to its own `LLM_HARD_CAP_USD`.
  3. Total spend across the fleet is N x cap. Nothing in the codebase reads,
     sums, or gates on fleet-wide spend, and `render.yaml` exposes no global
     budget env var.
- Expected: an owner-facing ceiling that stops all LLM spend when the day's
  total crosses a threshold, independent of how many accounts exist.
- Actual: the only ceiling is per-user; the operator has no server-side stop.
  The single lever is revoking `GEMINI_API_KEY` (`render.yaml:24`), which is
  manual and total.
- Impact: at the stated 1M-user scale, per-user caps define a $1M/day exposure
  with no automatic brake, and the same mechanism is what an account-farming
  attacker exploits. Compounds B-01, where the per-user cap is not even a real
  ceiling on the embedding path.
- Fix: add a global daily ledger row (or a `SUM` over `daily_cost_ledger` for
  today, indexed on `date_utc`) checked alongside the per-user cap, with a
  `GLOBAL_DAILY_CAP_USD` env var and a documented fail-closed behaviour. Cheap
  variant: a `Settings.llm_kill_switch` boolean read on every gate.
- Confidence: CONFIRMED (per-user-only design) / PLAUSIBLE (attack economics,
  gated on the unverified signup precondition above)

---
### B-05 — Cost-cap read-check-spend window is unlocked (TOCTOU); the claimed `FOR UPDATE` covers session rows, not the ledger

- Severity: **Medium**
- Category: Bug
- Page/Area: Backend — chat pre-flight cap gate
- Anchor: `backend/routes/chat.py:137-153`, `backend/services/cost_meter.py:70-76`
- Evidence:

```python
# backend/routes/chat.py:137-143 - plain SELECT, no row lock, no serialisable isolation
    exists_subq = select(literal(True)).where(User.id == user_id).exists()
    spend_raw, user_exists = db.execute(
        select(cost_meter.spend_subquery(user_id), exists_subq)
    ).one()
    cost_status = cost_meter.check_cap_from_spend(Decimal(str(spend_raw or 0)))
    if not cost_status.allowed:
```

- Steps to Reproduce:
  1. Re-verified independently per instruction: the only `with_for_update` calls
     in the repo are `backend/lib/keyword_index.py:56` and
     `backend/services/profile_service.py:204`, both `db.get(SessionModel, ...)`.
     Nothing locks `daily_cost_ledger` on read.
  2. As a user at $0.95 against a $1.00 hard cap, fire 20 simultaneous
     `POST /api/chat/stream` requests. Nothing rejects the burst (see B-07).
  3. All 20 execute the `SELECT` at `chat.py:139` before any of them reaches
     `record_cost`, all read $0.95, all pass `allowed=True`, all proceed to the
     LLM.
- Expected: at most one request crosses the boundary; the rest 429.
- Actual: all 20 proceed. The *write* is safe — `record_cost`'s
  `INSERT ... ON CONFLICT DO UPDATE` (`cost_meter.py:90-102`) serialises on the
  row and loses no increment — so the ledger total is correct after the fact.
  The gate is simply consulted on stale data.
- Impact: **bounded, and the bound matters.** `rate_limit.check_and_increment`
  (`rate_limit.py:51-61`) is genuinely race-free (`UPDATE ... WHERE count < cap
  RETURNING`), so a user gets at most 50 turns/day; and `tutor.py:173` re-reads
  the cap at each iteration after the commit at `tutor.py:206`, so the window is
  "N turns starting simultaneously", not unbounded burn inside one turn.
  Realistic overshoot is roughly 1.0-1.5x the hard cap per user per day — a
  correctness defect and a per-user overspend, not a runaway. Filed because the
  invariant the cap advertises ("cannot exceed hard_cap") is false, and because
  horizontal scaling on Render widens the window across instances.
- Fix: fold the check into the write. Make `record_cost` return the pre-increment
  total and have the caller reject if it was already over cap, or gate on a
  `SELECT ... FOR UPDATE` of the `(user_id, today)` ledger row held until the
  turn's first `record_cost`. If the latter, keep it off the streaming path —
  the existing `tutor.py:200-206` commit exists specifically to avoid holding a
  pooled connection across the stream.
- Confidence: CONFIRMED

---
### B-06 — Mid-turn cost-cap abort renders the raw error code `daily_cost_cap_reached` in the session error banner

- Severity: **Medium**
- Category: Bug
- Page/Area: Frontend — SessionView error banner (cap path)
- Anchor: `frontend/src/stores/session.js:853-858`, `frontend/src/views/SessionView.vue:88-93`, `backend/agent/tutor.py:182-190`
- Evidence:

```javascript
// frontend/src/stores/session.js:853-858
            case 'error':
              sawTerminal = true
              _applyCapError(data)
              if (!_streamSuperseded()) error.value = data.message || data.code
              handleAbortError(data.code)
```

```python
# backend/agent/tutor.py:182-190 - the cap payload has NO `message` field
                yield StreamEvent(
                    "error",
                    {
                        "code": "daily_cost_cap_reached",
                        "used_usd": str(cap.used),
```

- Steps to Reproduce:
  1. Start a chat turn while under the hard cap so `_prepare_turn` admits it.
  2. Let spend cross `llm_hard_cap_usd` mid-turn (a multi-iteration turn, or a
     concurrent turn per B-05), so `tutor.py:173` aborts the loop.
  3. The SSE `error` event arrives. `data.message` is `undefined`, so
     `error.value` becomes the literal string `"daily_cost_cap_reached"`.
  4. `SessionView.vue:88-93` renders `friendlyError(lastError || store.error)`.
     `friendlyError` (`frontend/src/lib/errors.js:5`) derives `status` only from
     objects; a bare string falls through every branch to
     `return String(err)` (`errors.js:21`).
- Expected: the structured `CapBanners` copy only ("Daily cost limit reached.
  $X of $Y spent today."), which `_applyCapError` correctly populates via
  `capErrors.js`.
- Actual: the user sees the correct cap banner **and**, directly below it, a
  second red `role="alert"` banner reading `daily_cost_cap_reached`. The
  pre-stream HTTP 429 path is unaffected — `friendlyError` gets an `ApiError`
  object there and returns friendly copy (`errors.js:9-14`).
- Impact: the surviving raw-envelope leak in the cap path that the PR #214
  SessionView cleanup did not cover. `capErrors.js:1-6` documents itself as the
  single choke point "so they cannot drift" for exactly these two transports —
  the SSE branch drifts around it via `data.message || data.code`.
- Fix: either add a human `message` to the tutor cap payload
  (`tutor.py:182-190`), or in `session.js:853` suppress `error.value` when
  `mapCapError(data).kind` is non-null — the banner already carries the message.
- Confidence: CONFIRMED

---
### B-07 — No per-IP or burst rate limit on the Render deploy; the nginx throttle is compose-only

- Severity: **Medium**
- Category: Security
- Page/Area: Deploy topology
- Anchor: `frontend/nginx.conf:1-5`, `frontend/nginx.conf:35-36`, `render.yaml:1-10`, `frontend/vercel.json:1-8`
- Evidence:

```nginx
# frontend/nginx.conf:1-5
# F-42: per-IP request throttle for the API path. 10 r/s steady with a burst
# of 20 absorbs legitimate UI bursts (parallel loads on Home) while blocking
# request floods. Applies to nginx-fronted deploys (docker compose) only --
# the Render backend has no nginx tier; its guard remains the daily LLM caps.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
```

- Steps to Reproduce:
  1. The prod topology is a Vercel-hosted SPA (`frontend/vercel.json`) talking
     directly to the Render web service (`render.yaml:2-6`, `dockerfilePath:
     ./backend/Dockerfile`). `backend/Dockerfile` runs uvicorn only — no nginx
     tier, matching the comment above.
  2. With a single valid JWT, issue all 50 daily-slot requests simultaneously.
     Nothing throttles by IP, by user-per-second, or by concurrency.
- Expected: a burst/velocity limit independent of the daily quota, so per-day
  budgets cannot be consumed in one instant.
- Actual: only the daily counter applies. The frontend even 429-handles a
  non-JSON nginx body (`errors.js:10-12`), so this limiter is treated as part of
  the design — it just is not present on the deployed path.
- Impact: enabling condition for the two findings above. It is what makes the
  B-05 concurrent-burst TOCTOU reachable in practice, and what lets B-02's 40
  simultaneous ingestions be launched in one second rather than trickled.
- Fix: add a velocity limit that works on Render — Cloudflare / Render-edge
  rules in front of the service, or an in-app per-user concurrency gate backed
  by the same `usage_counters` table (a shared store, so it survives
  multi-instance). An in-process limiter would not, and should not be used.
- Confidence: CONFIRMED

---
### B-08 — Deploy cap values diverge from code/template defaults and compress all three warning tiers into a 20-cent band

- Severity: **Low**
- Category: Architecture
- Page/Area: Deploy config
- Anchor: `render.yaml:20-23`, `backend/config.py:50-51`, `.env.example:44-45`, `docker-compose.prod.yml:39-40`, `backend/services/cost_meter.py:171`
- Evidence:

```yaml
# render.yaml:20-23  -- this is the "1.00" in question: LLM_HARD_CAP_USD, per-user, per-UTC-day
      - key: LLM_SOFT_CAP_USD
        value: "0.8"
      - key: LLM_HARD_CAP_USD
        value: "1.00"
```

```python
# backend/config.py:50-51
    llm_soft_cap_usd: float = 2.00
    llm_hard_cap_usd: float = 3.00
```

- Steps to Reproduce:
  1. `render.yaml:22-23` pins `LLM_HARD_CAP_USD=1.00` and
     `LLM_SOFT_CAP_USD=0.8`. Both are per-user, per-UTC-day (the
     `daily_cost_ledger` key), *not* global and *not* per-session.
  2. `config.py:50-51` defaults to 2.00/3.00; `.env.example:44-45` documents
     2.00/3.00; `docker-compose.prod.yml:39-40` falls back to 2.00/3.00. Three
     sources say 2/3, the deploy says 0.8/1.
  3. `cost_meter.py:171` derives `urgent_cap = hard_cap * 0.9`, so on Render the
     tiers are soft $0.80 / urgent $0.90 / hard $1.00.
- Expected: one documented source of truth for the deployed cap, with tiers
  spaced enough to be actionable.
- Actual: prod is *stricter* than every documented default, so this is drift
  rather than a hole — but the drift is undocumented, and anyone reasoning from
  `.env.example` or `config.py` will size the risk 3x too high.
- Impact: a user gets a soft warning at $0.80 and is denied at $1.00 — a 20-cent
  runway across all three tiers. At current turn costs that can be a single turn
  between "first warning" and "cut off", so the soft/urgent tiers do not
  function as warnings. Also note `render.yaml` omits `DB_POOL_SIZE` /
  `DB_MAX_OVERFLOW`, so prod runs the `config.py:35-36` defaults (5 + 5).
- Fix: reconcile the three sources (or add a comment in `.env.example` and
  `config.py` pointing at `render.yaml` as authoritative for prod), and widen
  the soft cap relative to hard so the warning arrives with usable runway.
- Confidence: CONFIRMED

---

## Unanchored improvements

Not filed as findings — each fails hard gate (b) (no concrete failure scenario
producing overspend, denial, or a wrong number in the current code).

- `daily_cost_ledger.cost_usd` has no `CHECK (cost_usd >= 0)` constraint
  (`backend/db/models.py:170`). `record_cost` guards against non-positive input
  at `cost_meter.py:87` and no path writes a negative, so there is no reachable
  failure today — but the DB does not enforce the invariant the cap depends on.
- `MODEL_RATES` (`cost_meter.py:214-231`) is explicitly annotated "VERIFY against
  live pricing before launch" and all three entries are marked placeholders.
  Every cost number in this report — and every cap decision in production — is
  only as accurate as that table. Confirming it against current Gemini pricing
  is a launch gate, not a code fix.
- `llm_call_log` has no retention policy (`models.py:176-200`); at 1M users it
  grows one row per LLM call forever, and the `usage_service.usage_summary`
  top-sessions query (`usage_service.py:41-52`) groups over the full unbounded
  history with no date filter. A storage/latency concern, not a cost-control
  hole.
- Failed or timed-out LLM calls are charged an estimate (`tutor.py:587-592`)
  whether or not the vendor billed them. Documented as deliberate and
  conservative; noted only so it is not mistaken for a metering bug later.