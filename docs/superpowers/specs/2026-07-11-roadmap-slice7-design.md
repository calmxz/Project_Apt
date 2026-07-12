# Roadmap Slice 7 — S3 Transport/Headers + P4 Retrieval Quality + D2 Determinism

Date: 2026-07-11
Status: Approved (brainstorm 2026-07-11)
Source: `docs/planning/2026-07-06-10x-roadmap.md` sections S3, P4, D2
Branch: `feat/roadmap-slice7` off dev `85fa736`. PR target: dev.
Alembic: head moves 0016 -> 0017 (one new migration).
OpenAPI: no contract changes anywhere in this slice.

## Context

Slices 1-6 shipped S1/S2/R0, P1/P2, R1, P3/D1, R2, R3. Remaining non-R4/R5
backlog is S3 + P4 + D2, all small items the roadmap marks as "slot into any
adjacent PR". This slice bundles them into one PR. R4 (deeper adaptivity) is
deferred to slice 8 with its own brainstorm gate; R5 remains demand-gated.

Decisions locked during brainstorm:

- Scope: S3 + P4 + D2 in one slice.
- D2 temperatures: tutor 0.3, summary 0.0, config-driven.
- D2 fallback mechanism: deterministic cosine-vs-centroid escalation, not
  prompt guidance.
- P4 AC1 measured live during design (2026-07-11, read-only Supabase MCP):
  ivfflat is used AND recall-limited -> migrate to HNSW.

## 1. S3 — Transport and headers

### S3.1 CSP on deployed frontend (roadmap AC1)

`vercel.json` already ships the full header block: CSP (default-src 'self',
connect-src supabase + API host, img/font data:, style-src 'unsafe-inline',
script-src 'self', object-src 'none', frame-ancestors 'none', base-uri
'self'), X-Content-Type-Options, X-Frame-Options, Referrer-Policy. No header
code change needed.

Remaining work:

- Audit the deploy RUNBOOK for a documented substitution step for the
  `https://CRUX_API_HOST` placeholder in the CSP `connect-src`. If the step
  is missing, add it (one-line doc change). If the placeholder handling is
  already documented, record where.
- Live verification (`curl -sI` against the deployed Vercel frontend showing
  all four headers with the real API host substituted) is a HUMAN GATE owed
  post-deploy; it pairs with the RUNBOOK deploy. Goes in the PR body owed
  list, not in this slice's code tasks.

### S3.2 JWKS fail-fast at startup (roadmap AC2)

Current behavior: `backend/services/auth.py` builds the `PyJWKClient` lazily
on first verify; an empty `settings.supabase_jwks_url` raises HTTP 500
(`auth_not_configured`) per request. Misconfiguration surfaces only when the
first authenticated request arrives.

New behavior: `main.py` lifespan gains a startup check.

- Auth enabled means `settings.supabase_jwks_url` is non-empty (the property
  returns the override if set, else derives from `supabase_url`; empty only
  when both are unset).
- When auth is enabled: build the `PyJWKClient` and fetch the JWK set once at
  startup. Any failure (unresolvable host, non-200, malformed JWKS) raises
  `RuntimeError` and the process does not boot. The successfully fetched
  client warms the module cache in `auth.py` (exposed via a small
  `warm_jwks()` / `validate_jwks_startup()` function on the auth module so
  the cache stays private to `auth.py`).
- When auth is disabled (no supabase_url, no override): startup proceeds
  unchanged. `env=prod` with no `supabase_url` already dies via the existing
  lifespan check; that check stays.
- Per-request behavior for a valid boot is unchanged (hourly TTL refresh,
  refetch-on-unknown-kid).

Tests: startup raises on unresolvable/failing JWKS URL (monkeypatched
fetch); startup boots clean with auth disabled; warmed cache is reused by
the first verify call. sqlite CI is unaffected because no supabase_url is
set there.

### S3.3 Security review doc sync (roadmap AC3)

`docs/security/SECURITY_REVIEW_2026-06-22.md` status table updates:

- Finding 1 (CSP): Open -> Fixed — remedy moved from nginx.conf to
  `vercel.json` headers, with commit ref; note live curl verify owed.
- Finding 3 (JWKS 500 instead of fail-fast): Open -> Fixed, with commit ref
  to the S3.2 change.
- Finding 2 (JWT iss) is already marked fixed (2026-07-06); leave as is.

## 2. P4 — Retrieval quality and index

### P4.1 Vector index: ivfflat -> HNSW (roadmap AC1)

Measured live 2026-07-11 against Supabase Postgres (read-only):

- Corpus: 8 rows in `chunk_embeddings`, 2 sessions, max 5 chunks/session.
- `EXPLAIN (ANALYZE, BUFFERS)` on the exact `query_chunks` shape (join to
  documents, session_id filter, ORDER BY cosine distance, LIMIT 5): planner
  uses `ix_chunk_embeddings_embedding` (ivfflat) with a post-filter on
  session_id and returned **3 rows where the session has 5**.
- Forced seq scan (`SET LOCAL enable_indexscan = off`) returns all 5.
- Cause: lists=100 with default probes=1 on an 8-row table — most lists are
  empty, one probe misses rows. This is silent recall loss in production
  retrieval, not a latency issue.

Roadmap AC1's migration condition ("only migrate to HNSW if ivfflat is
actually used and recall-limited") is met on both counts.

Fix: migration `0017`:

- Drop `ix_chunk_embeddings_embedding`.
- `CREATE INDEX ix_chunk_embeddings_embedding ON chunk_embeddings USING
  hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`.
- Postgres-only guard (`bind.dialect.name != "postgresql"` no-op), same
  pattern as 0002. Downgrade recreates the ivfflat index.
- No application code change: `query_chunks` SQL is index-agnostic.

HNSW default `ef_search=40` exceeds any current per-session candidate count,
giving exact-equivalent recall at this scale, has no lists-training problem,
and scales past 100k rows. Run the `migration-reviewer` agent on 0017.
Post-merge live `alembic upgrade` + re-EXPLAIN are owed (human gate).

### P4.2 Keyword gate false-negative softening (roadmap AC2)

Current: `backend/lib/keyword_index.py` `_TOKEN_RE = [a-z]{3,}` drops every
digit-bearing token ("ipv4" tokenizes as "ipv"; "3nf" yields nothing) and
all 2-char tokens ("ai", "ml", "db").

Change:

- `_TOKEN_RE` -> `[a-z0-9]{2,}`, then drop pure-digit tokens (no letter)
  before stopword filtering. Keeps `ipv4`, `3nf`, `b2b`, `ai`, `dna`;
  rejects bare `42`, `2026`.
- REQUIRED companion: extend `STOPWORDS` with common short words that the
  wider regex now admits, at minimum: `of to in is it on at be as or an do
  if my up so no we he by am us` (final list settled in the plan; every
  entry lowercase). Without this, 2-char admission floods the index and
  flips the gate to false POSITIVES on queries like "tell me about it".
- Stemmer and freq/merge semantics unchanged. Existing session indexes heal
  on next ingest (merge-only semantics, per roadmap: "index rebuild on next
  ingest"); no backfill migration.

Tests: acronym query ("what is DNA"), digit-bearing query ("explain IPv4
subnetting") flip `retrieval_required` when the index contains those stems;
pure-stopword query ("tell me about it") does not; pure-number token is not
indexed; existing gate tests stay green.

### P4.3 Incremental stream render (roadmap AC3)

Current: `splitSafePrefix(text)` in `frontend/src/lib/markdownStreamBuffer.js`
rescans the whole buffer from offset 0 on every streaming delta, and
`MarkdownContent.vue` recomputes `renderMarkdown(safe)` per delta.

Change, two parts:

- **Incremental split.** Add an incremental variant in
  `markdownStreamBuffer.js` carrying `{ lastText, anchor }` state: when the
  new text starts with `lastText` (append-only stream), resume the scan from
  `anchor` instead of 0; on any non-append change, reset and scan from 0.
  The anchor is NOT simply the previous safe end — a trailing run of
  delimiter characters can be reinterpreted when it grows (a committed
  closed pair "x ``" becomes fence opener "x ```" one backtick later), so
  the anchor is the largest between-region scanner cursor at or before the
  position after the text's last non-delimiter character (see the plan for
  the worked counterexamples). `MarkdownContent.vue` keeps its computed but
  backs it with a per-instance scan-state object; non-streaming path
  unchanged. Correctness invariant, tested
  property-style: incremental output === full-scan output for every prefix
  of a set of adversarial fixtures (fences, math, inline code, interleaved).
- **rAF delta batching.** At the streaming append site (the chat store /
  stream handler that mutates the message text per SSE delta), buffer
  incoming deltas and flush them to the reactive message text once per
  animation frame (`requestAnimationFrame`, with immediate flush on stream
  end so the final state never waits a frame). Reduces Vue re-render +
  markdown re-parse from per-delta to per-frame.

Existing fence/math boundary tests stay green. New tests: equivalence suite
above; rAF batching unit test with a mocked rAF (deltas coalesce, final
flush on completion).

## 3. D2 — Determinism and arbitration

### D2.1 Explicit temperature (roadmap AC1)

Two new `config.py` settings:

- `llm_temperature: float = 0.3` — passed to the tutor `acompletion` call
  (`agent/tutor.py:136`, the streaming loop — the only tutor LLM call).
- `summary_temperature: float = 0.0` — passed to both summary
  `acompletion` calls (`services/summary_service.py:58` end-of-session,
  `:142` rolling).

Rationale: 0.3 keeps teaching prose varied while stabilizing tool-call
argument generation; 0.0 makes summaries deterministic (better prompt-cache
behavior and reproducible regression tests). Values are env-overridable like
every other setting.

Tests: assert `temperature` is passed through on each call site (stub
transport captures kwargs); config defaults asserted.

### D2.2 Retrieval arbitration semantic fallback (roadmap AC2)

Problem: when the lexical gate (`match_required`) says OPTIONAL but the
session has ready documents, the agent sometimes skips citing the user's own
notes (paraphrase/acronym misses that P4.2 only partially closes).

Mechanism (deterministic, no prompt-only fix):

- In `routes/chat.py`, after `match_required` returns False AND the session
  ingestion status shows ready documents:
  - Embed the user query via the same embedding path `retrieval_service`
    uses (`settings.embedding_model`), so cost metering and stubbing behave
    identically.
  - Compute the session centroid in SQL: `SELECT AVG(embedding) FROM
    chunk_embeddings WHERE session_id = :sid` (pgvector supports AVG;
    computed per turn — trivial at current N, revisit caching only if a
    session exceeds thousands of chunks).
  - Cosine similarity between query embedding and centroid >=
    `retrieval_fallback_threshold` (new config float; default proposed in
    the plan after inspecting gemini-embedding score distribution on the
    live corpus, then validated by the paid eval) -> set
    `retrieval_required = True` for the prompt injection.
- Failure handling: any embedding/SQL error logs a warning and keeps
  OPTIONAL — same best-effort pattern as `gap_accuracy` in chat.py.
- sqlite CI: `AVG(embedding)` is Postgres/pgvector-only. The centroid query
  lives behind a small function with a dialect guard (sqlite -> returns
  None -> fallback skipped), keeping the sqlite suite green; unit tests
  stub the centroid + embedding and exercise both escalation and
  non-escalation branches.
- The escalation only flips the existing prompt boolean; the agent still
  decides to call `retrieve_chunks`. End-to-end effectiveness is measured
  by a paid eval scenario (owed), not guessed.

## 4. Testing and gates

- TDD per task; backend suite must pass on sqlite CI parity (0017 and the
  centroid query are dialect-guarded).
- Frontend vitest for stream-buffer equivalence + rAF batching.
- `migration-reviewer` agent on 0017 before merge.
- Gates task last: full BE + FE suites, lint (watch the recurring
  oxlint-autofixes-apiClient.js gotcha), contract drift zero (no OpenAPI
  edits in this slice — any accidental contract diff is a defect).

## 5. Out of scope

- R4 per-subtopic levels / provenance (slice 8, own brainstorm).
- R5 practice exams (demand-gated).
- Prompt-text changes for retrieval guidance (D2 fallback is mechanical).
- Backfilling existing session keyword indexes (heals on next ingest).
- CSP tightening beyond the shipped policy (style-src 'unsafe-inline' stays
  until PrimeVue/Vite style injection is re-audited).

## 6. Owed post-merge (PR body)

- Live curl of security headers on the deployed Vercel frontend (human gate,
  pairs with RUNBOOK deploy; includes confirming CRUX_API_HOST substitution).
- Live `alembic upgrade` to 0017 on Supabase + re-run the EXPLAIN ANALYZE
  from this spec confirming HNSW returns all session rows.
- Paid D2 eval scenario: OPTIONAL-gate query that paraphrases uploaded notes
  -> agent retrieves and cites (validates threshold default).
- Carry-forward owed from slices 5/6 unchanged (review-card smoke, queue
  smoke, dashboard smoke, read-query checks).
