# Adversarial Review Batch 6 — Perf + Hygiene + Drift — Design

Date: 2026-07-16
Source: `docs/adversarial-review-2026-07-12.md` (findings F-14, F-18, F-34, F-35, F-38,
F-42, F-44..F-47, F-49..F-62 open subset, D-1..D-6) + Batch 1 carryover (openapi backfill).
Branch: `fix/adversarial-batch-6`, single PR into `dev` (consistent with Batches 1-5).
This is the final batch of the 6-batch remediation plan.

## Owner decisions (2026-07-16)

- **F-14 (orphaned P1): INCLUDE.** The remediation plan never assigned F-14 to a batch and
  Batch 4 did not ship it. It lands here.
- **F-46: FULL SERVER PERSIST.** Onboarding state moves to the users row (migration + API +
  FE hydrate), not a heuristic.
- **F-56: SERVER FORCE-RETRIEVE.** When arbitration says REQUIRED, the server pre-fetches
  chunks and injects excerpts; the model cannot skip grounding.
- **PR structure: SINGLE PR.** One branch, one SDD run, drift items included.
- **D-1: CLAUDE.md adopts `Crux`.** Code/README/design doc already say Crux; CLAUDE.md is
  the outlier and changes.

## Scope

### A. Perf + chat loop (backend)

**F-18 — async embeddings + threaded tool dispatch.**
`retrieval_service.py:44` (retrieve) and `:131` (semantic fallback) switch from
`litellm.embedding` to `await litellm.aembedding`; both call sites are already inside
async flows. `tools.dispatch` in `agent/tutor.py` runs via `asyncio.to_thread` (the sync
SQLAlchemy session is only touched by that one awaited thread at a time, so no concurrent
session use). Ingestion embedding (`ingestion_service.py:145`) stays sync: it runs as a
FastAPI BackgroundTask off the request hot path.

**F-35 — cap profile lists.**
`apply_patch` and `_add_exclusive` evict oldest entries past `MAX_PROFILE_LIST = 40`
(new setting in `config.py`, env-tunable). `build_dynamic_context` (`prompts.py`) renders
only the newest 20 entries per list (`confirmed_gaps`, `mastered_concepts`), with a
`(+N older)` marker so the model knows truncation happened. Subtopics keep their existing
MAX_SUBTOPICS=20 cap.

**F-58 — count-first rolling summary.**
`update_rolling_summary` (`summary_service.py`) issues `SELECT count(*)` first and
early-returns when the rolling summary is not due, instead of loading the session's whole
message history every turn. When due, the dropped-messages transcript passed to the LLM is
capped to the newest M messages (M = existing window constant; no behavior change to the
summary itself beyond bounding input; M = 30 unless the plan finds an existing window
constant to reuse).

**F-14 — abort arms persist streamed text + clean up open batch.**
The three terminal arms in `run_streaming` (`agent/tutor.py`) — normal completion,
`max_iters` exhaustion (`:366-368`), mid-turn cap abort (`:118-127`) — unify behind one
persistence helper. The two abort arms now: (1) persist `accumulated_text` as an assistant
message with the distinct status `partial` when non-empty, (2) `abandon_open_batch`
if a check batch was registered this turn (prevents the register-guard deadlock), then
(3) yield the `error` event. FE keeps clearing the live bubble on `error`; on reload the
persisted partial text renders instead of vanishing.

### B. Transport + auth config (backend + nginx)

**F-57 — CORS.** `allow_credentials=False` in `main.py` (Bearer auth needs no credentialed
CORS).

**F-50 — issuer normalization.** `verify_supabase_jwt` computes the expected issuer from
the same rstripped `supabase_url` value used for the JWKS URL (`config.py:51` pattern),
so a trailing slash in env no longer 401s every token.

**F-61 — auth fail-fast.** `validate_jwks_startup` refuses to boot when `SUPABASE_URL` /
JWKS config is missing, unless the existing explicit test/stub disable flag is set.
No more per-request `auth_not_configured` 500s on a misconfigured deploy.

**F-42 — nginx per-request rate limit.** `frontend/nginx.conf` gains `limit_req_zone`
(per-IP) + `limit_req` with burst on `location /api/`. Scope limitation, documented in the
nginx.conf comment and RUNBOOK: this protects docker/compose deploys only; the Render
backend has no nginx front and gets no app-level throttle (review's rejected alternative —
daily LLM caps remain its guard).

**F-62 — CSP vs absolute API URL.** Documentation fix: nginx-served builds must use the
relative `/api` base; comment added at the `VITE_API_BASE_URL` sites in `.env.example` /
`frontend/.env.example` and the nginx.conf CSP line (pairs with D-4 below).

### C. Session + misc (backend)

**F-34 — server duplicate-topic guard.** `create_session` checks for an existing active
session (`ended_at IS NULL`) for (user_id, casefolded topic); on hit returns 409 whose
detail carries the existing session id. Same guard on `reopen` (reopening while another
active same-topic session exists → 409). FE maps the 409 to an "Open existing session"
action instead of a raw error toast. 409 detail shape follows the normalized scheme from
the openapi backfill (below).

**F-55 — magic-byte sniff.** `upload.py` checks the first bytes are `%PDF` before
committing the Document row / scheduling ingestion; mismatch → 415. Extension check stays.

**F-56 — server force-retrieve.** In `_prepare_turn` (`routes/chat.py`), when arbitration
returns REQUIRED and the session has at least one `ready` document, the server calls
`retrieval_service.retrieve` itself and injects the wrapped excerpts into the dynamic
context block (same `<document_excerpt>` guard path as tool-fetched chunks). The prompt
flag flips to informational ("excerpts already provided"). The embedding call is metered
(Batch 2 infrastructure). Immutable prompt prefix untouched — injection is dynamic-context
only, preserving cache reuse.

**F-59 — decouple batch purpose from live knowledge_level.** `register` receives the
batch purpose derived from the prompt-state `diagnostic_required` decision made when the
turn was prepared, instead of re-deriving from live `knowledge_level` at register time
(`check_question_service.py:150-151`). A review-gaps quiz posed while level is None is no
longer misrecorded as diagnostic.

**F-60 — dead code + stale comments.** Delete the un-called `is_gradable` guard
(`pending_check_store.py:38-45`); rewrite stale docstrings/comments
(`profile_service.py:8-10` and the focus-guard comment block) to describe the
Batch-4-restored guard behavior, not the removed one.

### D. Frontend UX

**F-44 — end-summary dialog off-view.** Watcher gets `{immediate: true}`; when the end
originates from a view other than the open session (sidebar/Home/Library), show a toast
fallback summarizing the end result instead of silently dropping the dialog.

**F-45 — HomeView in-flight guard.** `busy` ref disables re-entry for
`startReview`/`startQuick`; try/catch around both plus `onContinueTopic` so `_setError`
no longer escapes as an unhandled rejection; double-click can no longer dupe sessions
(server 409 from F-34 is the backstop).

**F-46 — server-persisted onboarding.** Users row gains onboarding state (flag + the
onboarding payload the FE currently keeps in localStorage — exact columns fixed at
plan time from `stores/user.js` fields). Alembic migration 0019. API surface added in
`docs/api/openapi.yaml` first, then `python backend/scripts/gen_contracts.py` (contracts
are codegen). FE hydrates the user store from the backend after auth; router guard reads
the server-derived flag, so a new device no longer force-routes an existing user to
onboarding. localStorage remains a write-through cache only.

**F-47 — async token read.** `_getAccessToken` becomes async via
`getSupabase().auth.getSession()` (which refreshes when stale) in `apiClient.js`,
`chatStreamService.js`, and `uploadApi.js` — no more firing requests with a token that
expired while the tab slept. Complements Batch 3's 401 retry (F-09) rather than replacing it.

**F-49 — deep-link preservation.** Router guard redirects to
`{name:'login', query:{redirect: to.fullPath}}`; LoginView pushes the redirect after auth
only when it is a validated relative path (must start with `/`, no `//` or scheme).

**F-51 — friendly errors.** `App.vue` toasts `friendlyError(err)` instead of raw backend
`detail`.

**F-53 — strip `[auto]` prefix.** ProfileView wraps `last_session_summary` display with
the existing `stripAutoPrefix` (project memory: strip before ANY UI display).

**F-54 — endSession local-profile pollution.** `stores/session.js` patches the local
profile's `last_session_summary` only when `resp.summary.kind === 'summary'`; the
`no_exchanges` display sentence stays UI-only.

### E. Legal + honesty

**F-52 — consent stamp earned, not fabricated.** Register flow passes an accepted-terms
flag in Supabase `signUp` `options.data` (lands in JWT user metadata); `ensure_user`
stamps `accepted_terms_at` only when the claim is present in the verified JWT. Direct-API
signups without the claim get a row with a NULL stamp. Existing rows untouched.

**F-38 — honest product claim (doc-only).** Design doc / CLAUDE.md / README wording for
check-question grading becomes "deterministic grading of model-authored answer keys".
No user-report/appeal mechanism (YAGNI).

### F. Drift + contract backfill (docs only)

- **D-1:** CLAUDE.md renames the product to `Crux` (matches code, README, design doc).
- **D-2:** CLAUDE.md phase table "ChromaDB" claims corrected to pgvector.
- **D-3:** design-doc body ChromaDB references (lines ~82, 123, 171, 271, 341, 391, 481,
  495, 497) corrected to pgvector; marked as drift-correction edits, not design changes.
- **D-4:** `VITE_API_BASE_URL` default unified across README / `.env.example` /
  `frontend/Dockerfile` (relative `/api` for nginx-served builds, per F-62).
- **D-5:** `.env.example:19` embedding model name corrected to the actual default
  (`gemini-embedding-2`).
- **D-6:** CORS default origin list unified between `docker-compose.yml` and root
  `.env.example`.
- **Design-doc LLM-failure contract:** amended to describe shipped behavior (timeouts +
  mechanical fallback / error SSE; no retry-once-shorter, no 503) — closes the F-06-era
  doc drift.
- **Openapi backfill (Batch 1 carryover):** document `/chat/stream` (SSE) and the three
  check endpoints in `docs/api/openapi.yaml`; normalize 409 detail shapes (dict vs string)
  across endpoints; run codegen; CI zero-drift check must stay green.

## Out of scope

- R5 practice exam mode (demand-gated).
- App-level rate limiting on Render (documented limitation; daily LLM caps remain).
- Any profile-substrate restructuring (row-per-concept tables) — review section 5's
  structural work is post-remediation.
- `MODEL_RATES` live-pricing verification (open question 5 of the review; separate task).

## Verification

- Per-item unit tests (pytest from `backend/`, vitest from `frontend/`); full BE + FE
  suites, lint, contract zero-drift all green in CI.
- Drift items verified by re-reading doc vs code after edit.
- Key new tests: abort arm persists partial text + no orphan batch (F-14); capped list
  evicts oldest + prompt renders newest 20 (F-35); duplicate topic → 409 with existing id
  (F-34); REQUIRED turn injects excerpts with zero tool calls (F-56); non-PDF magic bytes
  → 415 (F-55); trailing-slash SUPABASE_URL still authenticates (F-50); missing config
  refuses boot (F-61); onboarding hydrates from server on fresh storage (F-46); ensure_user
  without consent claim leaves stamp NULL (F-52).

## Owed human gates (post-merge)

1. Live `alembic upgrade head` for migration 0019 (F-46) against Supabase.
2. Live curl of nginx rate limit on the compose stack (F-42).
3. Paid live smoke: force-retrieve turn returns grounded answer with citations (F-56).
4. New-device browser smoke: existing user signs in on fresh profile, lands on Home not
   onboarding (F-46).
