# Adversarial Review — Crux (AdaptLearn) — 2026-07-12

Read-only hostile review of branch `dev`. Handoff to a later Claude Opus session that will
execute fixes with the repo but NOT this conversation. Every finding is anchored to
`file:line`. Nothing in the tree was modified except this file.

Note on naming: the product is `Crux` in code (`main.py` title, `README.md`, design doc);
`CLAUDE.md` still calls it `AdaptLearn`. This document says "the app" and cites `Crux` where
code does. The name split is itself finding D-1.

---

## Verdict

Do not ship as-is. The authorization model is genuinely solid — every user-scoped route
filters by the JWT `sub`, and no IDOR exists — but the reliability and cost-control layers are
not: a routine LLM 429/timeout hangs the chat UI permanently with no error surfaced (F-01), the
Phase-7 "daily cost cap" is bypassable to unbounded spend through the unmetered summary path and
the end/reopen loop (F-03), and the session summary that seeds cross-session continuity
summarizes the FIRST 30 messages while its own docstring claims the last 30 (F-04). The
advertised core differentiator — "structured, tool-call-enforced live student-model mutation" —
is roughly one-third real (server-graded check questions with authoritative promotion/demotion,
the deterministic diagnostic, the SM-2 review queue) and two-thirds decorative prompt state that
the model mostly re-reads after writing it itself; worse, its flagship "server-verified
focus-clear guard rail" was deleted from the code while the canonical design doc and CLAUDE.md
still describe it as enforced (F-02). Fix F-01 through F-06 and F-10 before any real user touches
this; the differentiator needs the structural change in section 5, not a patch, to be defensible.

---

## What I actually read

Traced end-to-end (full reads, cited below):
- **Auth + first run:** `backend/services/auth.py`, `user_service.py`, `frontend/src/stores/auth.js`, `stores/user.js`, `router/index.js`, `services/apiClient.js`, `services/supabase.js`, register/login/onboarding views.
- **Session lifecycle:** `backend/routes/sessions.py`, `services/summary_service.py`, `session_enrichment.py`, `review_queue_service.py`, `frontend/src/stores/session.js`, `SessionView.vue`, `SidebarSessionRow.vue`, `NewSessionView.vue`, `HomeView.vue`.
- **Chat hot path + agent loop:** `backend/routes/chat.py`, `agent/tutor.py`, `prompts.py`, `tools.py`, `context_budget.py`, `excerpt.py`, `services/rate_limit.py`, `cost_meter.py`, `retrieval_service.py`.
- **Profile mutation:** `backend/services/profile_service.py`, `learning_event_service.py`, `check_question_service.py`, `diagnostic_service.py`, `pending_check_store.py`, `routes/profile.py`, `review.py`, `agent/tools.py`.
- **Ingestion + retrieval:** `backend/routes/upload.py`, `documents.py`, `services/ingestion_service.py`, `documents_service.py`, `pgvector_store.py`, `retrieval_service.py`, `lib/keyword_index.py`, `frontend` upload UI.
- **Cross-cutting:** all `backend/routes/*.py` for authorization, `main.py` (CORS), `frontend/nginx.conf`, `docker-compose*.yml`, `render.yaml`, `docs/security/SECURITY_REVIEW_2026-06-22.md`.

Personally re-verified by direct read (not just via sub-agents): `summary_service.py:37-42`
(first-30), `chat.py` has zero `ended_at` references, `auth.py:77` catch tuple, `user.js:9`
constant storage key, `tutor.py:370` sole `except`, `profile_service.py:343-364` focus-clear,
`rate_limit.py` atomicity, `cost_meter.py:77-84` non-atomic increment.

**Not read / bounds of authority:** I did not run the app, the test suite, or any migration. I
did not read the alembic migration files, so FK-existence claims (F-36) and index/vector-type
claims are `[UNVERIFIED]` against live Postgres. I did not read `render.yaml` line-by-line — the
"no disk mount" claim (F-15) needs a direct check. Frequency of model-behavior-triggered findings
(F-10, F-20, F-23) depends on the live Gemini model and is not measured here. Pricing correctness
in `MODEL_RATES` is `[UNVERIFIED]` against live vendor pricing.

---

## Flow traces

### 1. Auth + first run
1. `main.js:26-32` bootstrap: `authStore.init()` before router install.
2. `auth.js:26-36` `getSupabase().auth.getSession()` + `onAuthStateChange`. Client built at `supabase.js:11-30` — **falls back to `http://placeholder.invalid` when `VITE_SUPABASE_*` env missing (F-16)**.
3. Router guard `router/index.js:97-100`: unauthenticated + private route → `login`, **intended path dropped (F-49)**.
4. Register `auth.js:38-50` `signUp`; consent checkbox is **client-side only (F-52)**.
5. Confirm-link returns with tokens in hash; `detectSessionInUrl:true`.
6. Guard `router/index.js:105-113`: authed + `!user.onboardingComplete` → `/onboarding`. **`onboardingComplete` is a per-browser localStorage flag, never server-persisted (F-46).**
7. `apiClient.js:23-30,47-48` attaches `Bearer` from `store.accessToken` read synchronously — **no freshness check (F-47), no 401 handling (F-09).**
8. Backend `auth.py:91-113 current_user_id` → `verify_supabase_jwt:64-88`: JWKS cached client, decode aud/iss/exp. **`PyJWKClientError` not in the catch tuple → 500 (F-07); no `leeway` (F-41); issuer built from un-normalized `supabase_url` (F-50).**
9. `POST /sessions` → `ensure_user` (`user_service.py:18-34`) — **non-atomic get-then-insert (F-37)**, stamps `accepted_terms_at` unconditionally (F-52).

### 2. Session create + seed
1. `NewSessionView.vue:148-158` duplicate-topic guard is **FE-only and self-disables on list failure (F-34)**; backend `create_session` (`sessions.py:101-138`) has no uniqueness check.
2. Resume path `sessions.py:124-126`: if `prior.ended_at is None` → **synchronous `await summary_service.generate_and_persist` on the create path, no timeout, no cap check (F-06, F-03)**; does NOT abandon prior's open check batch (F-31).
3. `generate_and_persist` (`summary_service.py:37-42`): SELECT messages `id.asc().limit(30)` — **FIRST 30, docstring says last 30 (F-04)**; two commits (profile, then `ended_at`) around the LLM call — **partial-write window (F-33)**.
4. `sessions.py:127` copies `prior.topic_profile_json` verbatim into the new session.

### 3. Chat hot path
1. `chat.py:248 chat_stream` → `_prepare_turn:107`.
2. Cost cap SELECT (`:121-137`) → `rate_limit.check_and_increment` (`:140`, **increments before session validation, F-...**) → session+doc SELECT (`:157-167`, 404 on foreign) → history last-20 (`:177`) → retrieval arbitration (`:205-211`, **sync embedding on the loop, F-18**) → prompt build → user msg commit (`:234-236`).
3. `tutor.run_streaming:79` loop, `MAX_ITERS=8`. Per iter: mid-turn cap check (`:112`) → `litellm.acompletion(stream=True)` (`:136`, **no timeout**) → stream deltas → assemble tool frags → cost record (`:190-203`).
4. No tool calls → persist + `done` (`:223-231`). Tool calls → **ask-bundle drops siblings (`:240-242`, F-10)** → dispatch (`:277`, sync) → append tool msgs → prune superseded excerpts (`:346`).
5. **Only `except asyncio.CancelledError` (`:370`)** — any other exception escapes, `produce()` swallows it into the `None` sentinel (`chat.py:271-275`), no `error` SSE emitted (**F-01, P0**).
6. `max_iters` exhausted → `error max_iters_reached` with **no persistence of streamed text (F-14)**.

### 4. Profile-mutation loop
1. Model emits `update_topic_profile` → `tools.dispatch` injects authoritative `session_id` (`tools.py:84`) → `profile_service.apply_patch:274`.
2. `apply_patch`: `load_profile` → mutate → `save_profile` **commits immediately, whole-JSON-blob overwrite, no lock (F-11, F-12)**.
3. `add_mastered_concept` does **not** remove from `confirmed_gaps` (`:325-341`); the user path `_add_exclusive` does — **invariant enforced on one of three paths (F-13)**.
4. Focus clear (`:343-364`): requires only a non-None `focus_clear_reason` string — **the `tested_correct` server verification was deleted (F-02)**.
5. Check answers grade via `learning_event_service.record_from_answer` against the **model-authored `correct_index` (F-38)**; correct → mastered + stays in gaps; incorrect → demote + add to confirmed_gaps.

### 5. PDF ingestion + retrieval
1. `POST /upload` (`upload.py:38`): rate-limit → Content-Length check (**spoofable, F-40**) → extension check (**no magic-byte sniff, F-55**) → ownership → **Document row committed `pending` (`:88-91`) → body read → disk write (`:104`, unguarded, F-29) → `add_task(ingestion_service.run)` (`:107`)**.
2. `ingestion_service.run:104` (in-process BackgroundTask): extract → chunk → embed (batches of 100) → `pgvector_store.insert_chunks` commit → `keyword_index.merge_into_session` **separate commit (F-27)** → `status="ready"` commit. **No restart recovery (F-26).**
3. Retrieve: `chat.py:205` arbitration → `retrieval_service.retrieve` → `pgvector_store.query_chunks` scoped by `session_id` only, **not by doc status (F-27)**.
4. Chunk text → `excerpt.wrap_chunk` (`tutor.py:323-330`) → `<document_excerpt>` guard. **Prompt-injection tag-forgery is closed** (`excerpt.py:13-17` neutralizes breakout tags); residual is inherent LLM obedience only, not a code gap.

### 6. Session end + summary
1. `POST /sessions/{id}/end` (`sessions.py:286`): ownership → idempotent-if-ended (**check-then-act, F-30**) → `abandon_open_batch` (two commits) → `generate_and_persist` (**LLM, no cap/timeout, called even with 0 messages, F-03/F-06/F-32**) → refresh → `_build_end_summary`.
2. FE `session.js:194-213` patches local `ended_at` + writes **display copy into local profile (F-54)**, sets `pendingSummary`.
3. `SessionView.vue:432-441` watcher shows the dialog — **only if that exact session view is mounted; ending from Home/Library drops it (F-44)**.

---

## Findings

| ID | Sev | Area | file:line | Defect |
|----|-----|------|-----------|--------|
| F-01 | P0 | chat/stream | agent/tutor.py:370 | Non-cancel exception in agent loop emits no error SSE; frontend locks in "streaming" forever — FIXED (Batch 1) |
| F-02 | P0 | profile / docs | profile_service.py:343-364 | Flagship focus-clear guard deleted; design doc + CLAUDE.md still claim it is enforced |
| F-03 | P1 | cost cap | summary_service.py:73-90 | Summary LLM spend bypasses cost ledger AND rate limit; end/reopen loop = unbounded spend — FIXED (Batch 2, fix/adversarial-batch-2, 2026-07-13) |
| F-04 | P1 | summary | summary_service.py:37-42 | Session summary reads FIRST 30 messages, not last 30 (docstring lies) — FIXED (Batch 1) |
| F-05 | P1 | session state | routes/chat.py (no ended_at) | Ended sessions still accept chat turns and check answers server-side — FIXED (Batch 1) |
| F-06 | P1 | reliability | summary_service.py:58 | No timeout on summary/LLM calls; sync DB conn held across await; FE fetch no timeout — FIXED (Batch 2, fix/adversarial-batch-2, 2026-07-13, scope: timeouts on 7 LLM call sites + FE request/header/idle; no retry-once-shorter/503; pool sizing out of scope) |
| F-07 | P1 | auth | services/auth.py:77 | JWKS/unknown-kid raises uncaught PyJWKClientError → 500 storm; unauth-triggerable JWKS refetch |
| F-08 | P1 | auth / privacy | frontend/src/stores/user.js:9 | Cross-account leak: user store localStorage key is constant, never cleared on sign-out |
| F-09 | P1 | frontend | services/apiClient.js:62-66 | No 401 handling anywhere: no refresh-retry, no sign-out, no redirect |
| F-10 | P1 | agent loop | agent/tutor.py:240-242 | Profile patches bundled with a quiz are silently discarded; model never learns |
| F-11 | P1 | profile | summary_service.py:44-87 | Summary reloads profile, then overwrites concurrent writes across the LLM call |
| F-12 | P1 | profile | profile_service.py:145-153 | Whole-blob last-writer-wins profile writes; zero locking; agent ignores ETag |
| F-13 | P1 | profile | profile_service.py:325-341 | Exclusivity invariant violated by agent+server paths: concept in mastered AND gaps |
| F-14 | P1 | chat/stream | agent/tutor.py:366-368 | max_iters / mid-turn cap discards already-streamed text; leaves orphan open batch |
| F-15 | P1 | storage | render.yaml / upload.py:103 | Uploads on ephemeral disk in prod (no persistent mount); lost on deploy/restart |
| F-16 | P1 | deploy | frontend/Dockerfile (HEAD) | Committed dev HEAD builds frontend without Supabase env → dead auth client — FIXED (Batch 1) |
| F-17 | P2 | cost cap | cost_meter.py:77-84 | Cost-ledger update is a lost-update race; cap check is check-then-act — FIXED (Batch 2, fix/adversarial-batch-2, 2026-07-13) |
| F-18 | P2 | perf | retrieval_service.py:44-48 | Sync `litellm.embedding` + sync dispatch on the async loop stalls all concurrent streams |
| F-19 | P2 | cost cap | retrieval_service.py / tutor.py:184-189 | Embedding calls never metered; per-iter cost silently 0 on builder failure — FIXED (Batch 2, fix/adversarial-batch-2, 2026-07-13, note: Batch-1-deferred error-arm billing item also closed) |
| F-20 | P2 | profile | agent/tutor.py:266-270 | Malformed tool-args JSON → empty patch that reports "Profile updated" |
| F-21 | P2 | profile | profile_service.py:335-341 | Evidence provenance (R4) is LLM-self-reported and gates only review-queue sort order |
| F-22 | P2 | profile | profile_service.py:165-167 | Case-mismatch leaves focus dangling on a removed gap (exact vs canon compare) |
| F-23 | P2 | profile | profile_service.py:343-349 | Non-focus patch while focus set fails; model's retry silently clears focus |
| F-24 | P2 | profile | routes/sessions.py:414-420 | Check-answer is 3 commits, no idempotency; double-submit double-counts; crash skips diagnostic grade |
| F-25 | P2 | profile | diagnostic_service.py:29-30 | Skipping the diagnostic stamps knowledge_level="beginner" permanently, no reset path |
| F-26 | P2 | ingestion | ingestion_service.py:104 | Restart mid-ingestion → permanent `pending` rows; no reconciliation sweep |
| F-27 | P2 | ingestion | ingestion_service.py:128-142 | Non-atomic ingest: chunks committed even when status="failed"; failed-doc chunks retrievable |
| F-28 | P2 | ingestion | documents_service.py:106-113 | Delete is non-atomic across two commits, no ON DELETE CASCADE |
| F-29 | P2 | ingestion | upload.py:102-107 | Disk-write failure orphans a permanent `pending` row; ingestion never scheduled |
| F-30 | P2 | session | routes/sessions.py:298-307 | Double-end race: two ends both pay an LLM call, doubled spend, nondeterministic summary |
| F-31 | P2 | session | routes/sessions.py:120-127 | Resume-create finalizes prior without abandoning its open batch → zombie quiz on reopen |
| F-32 | P2 | session | summary_service.py:54-67 | Ending a 0-message session makes a paid LLM call and stores a hallucinated summary |
| F-33 | P2 | session | summary_service.py:86-90 | end_session multi-commit around await leaves three distinct partial states, none retried |
| F-34 | P2 | session | NewSessionView.vue:148-158 | Duplicate-topic detection is browser-only and self-disables; forked profiles per topic |
| F-35 | P2 | cost / prompt | prompts.py:236 | Unbounded profile lists re-injected into system prompt every turn; monotonic growth |
| F-36 | P2 | auth | routes/chat.py:140,152-154 | `ensure_user` runs AFTER the FK-bearing usage-counter insert → 500 on first-ever chat |
| F-37 | P2 | auth | user_service.py:24-33 | `ensure_user` get-then-insert race → IntegrityError 500 on concurrent firsts |
| F-38 | P2 | product claim | check_question_service.py:209 | "Server grades deterministically" grades against a model-authored answer key |
| F-39 | P2 | profile | profile_service.py:311-312 | knowledge_level writable by agent with no evidence; overwrites user-set value on grade |
| F-40 | P2 | upload | upload.py:58-94 | Full body read before size enforcement when Content-Length absent/spoofed |
| F-41 | P2 | auth | services/auth.py:69-76 | Zero clock-skew tolerance in JWT decode; boundary 401s |
| F-42 | P2 | transport | frontend/nginx.conf | No per-request rate limiting anywhere (only daily LLM caps) |
| F-43 | P2 | cost cap | cost_meter.py:62-66 | Mid-turn `check_cap` reads through the ORM identity map, not the DB — FIXED (Batch 2, fix/adversarial-batch-2, 2026-07-13) |
| F-44 | P3 | frontend | SessionView.vue:432-441 | End-summary dialog silently dropped when ending from anywhere but the open session view |
| F-45 | P3 | frontend | HomeView.vue:92-120 | Review/quick-start have no in-flight guard; unhandled rejection; double-click dupes sessions |
| F-46 | P3 | auth | router/index.js:106-113 | Onboarding state per-browser; existing user on a new device force-routed to onboarding |
| F-47 | P3 | auth | apiClient.js:23-30 | Access token read synchronously from Pinia; no freshness guarantee at request time |
| F-48 | P3 | profile | profile_service.py:335-341 | Inferred-mastery add returns ok=True while mutating nothing ("Profile updated" lie) |
| F-49 | P3 | frontend | router/index.js:98-99 | Deep link lost on login redirect (no `redirect` query param) |
| F-50 | P3 | auth | services/auth.py:74 | Issuer built from un-normalized `supabase_url`; trailing slash kills all auth |
| F-51 | P3 | frontend | App.vue:41-42 | Raw backend error `detail` toasted to users despite `friendlyError` existing |
| F-52 | P3 | legal | user_service.py:5-30 | Terms-consent stamp fabricated server-side for users who never saw the checkbox |
| F-53 | P3 | frontend | ProfileView.vue:210-213 | "[auto] " mechanical-fallback prefix leaks raw into ProfileView |
| F-54 | P3 | frontend | stores/session.js:194-200 | endSession writes user-facing display copy into local profile as if it were the summary |
| F-55 | P3 | upload | upload.py:69-77 | No content/MIME sniffing; extension trust only |
| F-56 | P3 | retrieval | prompts.py:120-124 | `retrieval_required` is advisory; REQUIRED can be silently ignored by the model |
| F-57 | P3 | transport | backend/main.py:24-30 | CORS `allow_credentials=True` unnecessary for Bearer auth; latent risk |
| F-58 | P3 | perf | summary_service.py:127-135 | Rolling-summary task scans the session's entire message history on every turn |
| F-59 | P3 | profile | check_question_service.py:150-151 | Batch purpose derived from live knowledge_level couples diagnostic and review modes |
| F-60 | P3 | hygiene | pending_check_store.py:38-45 | Dead guard code + stale comments memorialize the removed focus rail |
| F-61 | P3 | auth | services/auth.py:33-37 | Misconfigured auth 500s `auth_not_configured` per request instead of failing fast |
| F-62 | P3 | deploy | frontend/nginx.conf:5 | CSP blocks the API if `VITE_API_BASE_URL` is built as an absolute URL |

### F-01 — Agent loop swallows non-cancel exceptions; chat UI hangs forever (P0)
- **Defect:** `run_streaming` (`agent/tutor.py:110-368`) has exactly one exception handler, `except asyncio.CancelledError` (`:370`). A 429, timeout, `APIError`, or a stream chunk with empty `choices` (`chunk.choices[0]`, `:151`) propagates out; `produce()` in `chat.py:270-275` catches nothing and its `finally` pushes the `None` sentinel, so the consumer sees a normal stream end and emits neither an `error` nor a `done` event. Frontend `sseParser.js:16` resolves cleanly; `session.js` `sendMessageStreaming` has no fallback, so `streamState` stays `'streaming'`.
- **Trigger:** provider returns 429/5xx, the network times out, or Gemini emits a malformed stream frame — routine external failures, not edge cases.
- **Consequence:** the composer is dead until a full page reload; the frozen half-bubble and disabled send box give no error. DB is left inconsistent: user message + any committed tool effects persisted, no assistant row, flushed-but-uncommitted ledger cost rolled back (unbilled).
- **Confidence:** high (all three layers read directly).
- **Proposed fix:** in `run_streaming`, wrap the `for` loop body in `try/except Exception as e:` that logs, calls `_persist_assistant_message(ctx, accumulated_text, "error", ...)`, and `yield StreamEvent("error", {"code": "llm_failed"})` before returning; in `session.js sendMessageStreaming`, add a `finally` that resets `streamState`/`streamingMessage` when no terminal event was seen. The mechanism closes it because the consumer already breaks on an `error` event (`chat.py:296`) and the store already clears the bubble on `error` (`session.js:528`).
- **Fix risk:** the new `except` must not swallow `CancelledError` — order it after the existing `except asyncio.CancelledError` (which re-raises). Does not fix the unbilled-cost rollback (F-19). Cheapest proof: unit test that patches `litellm.acompletion` to raise `litellm.APIError` and asserts one `error` SSE is yielded and an assistant row with status `error` exists.
- **Rejected alternatives:** catching in `chat.py produce()` instead — wrong layer; the route cannot persist the partial assistant message with tool-call/citation context that only `run_streaming` holds.

### F-02 — Flagship focus-clear guard deleted; docs still claim it is enforced (P0)
- **Defect:** `apply_patch` (`profile_service.py:343-364`) clears `focus_target_gap` on any non-None `focus_clear_reason` string, with no verification. The `tested_correct` server check — "verifies a correct `LearningEvent` was logged that turn... Cannot silently clear focus" per CLAUDE.md, and coded explicitly in the canonical design doc `2026-05-03-crux-v1-design.md:220-225` — is gone (comment at `:351-355` documents the removal). The removal rationale ("the LLM cannot fabricate a LearningEvent") addresses only one exploit; clearing focus on an *unearned* claim, or citing a correct event for a *different* gap, is now unchecked. The core product claim ("tool-call-enforced" mutation with a server guard rail) is therefore false as documented.
- **Trigger:** agent sends `focus_target_gap: null, focus_clear_reason: "tested_correct"` with zero correct events on that gap — accepted, only `log.info`'d.
- **Consequence:** the one place the loop claimed enforcement over the model's self-narrative is honor-system; the design doc and CLAUDE.md misdescribe shipped behavior to any future engineer.
- **Confidence:** high (code read; doc read).
- **Proposed fix:** decide one of two — (a) restore verification in `apply_patch`: for reason `tested_correct`, require a correct `LearningEvent` whose `canon(gap_tested) == canon(prior_focus)` in this session since focus was set (query `learning_event_service`); or (b) amend design doc §4.4 + CLAUDE.md to state the guard is reason-string-only. This is a decision for the owner (section 6), not a mechanical patch — the code and the docs disagree and the truth must be chosen.
- **Fix risk:** (a) reintroduces the coupling the removal was meant to break (record_learning_event is no longer a tool); confirm a genuine `LearningEvent` still exists on the correct-answer path (`record_from_answer` writes one). Cheapest proof for (a): test that `focus_clear_reason="tested_correct"` with no matching correct event returns `ok=False`.
- **Rejected alternatives:** leaving code and docs as-is — the divergence is the P0; silence is not an option.

### F-03 — Summary LLM spend bypasses the cost cap and rate limit (P1)
- **Defect:** `generate_and_persist` and `update_rolling_summary` (`summary_service.py`) call `litellm.acompletion` and then `cost_meter.log_call` (analytics table) but **never `cost_meter.record_cost`** (the ledger the cap reads) and are **not** preceded by `check_cap` or `rate_limit.check_and_increment`. `end_session` (`sessions.py:307`) and resume-create (`sessions.py:125`) each fire a full-transcript call.
- **Trigger:** authenticated loop `POST /end` → `POST /reopen` → `POST /end`, or simply chatting past the cap (every ~10th turn fires an un-ledgered rolling summary).
- **Consequence:** the Phase-7 "LLM cost cap" does not bound real spend; a hostile or buggy client generates unbounded Gemini spend that is logged but never gated.
- **Confidence:** high.
- **Proposed fix:** in both summary functions, call `cost_meter.record_cost(db, user_id, cost)` alongside `log_call`, and short-circuit to `_mechanical_fallback` when `check_cap(...).allowed` is False; add a rate-limit increment (or a dedicated cheaper counter) to `end_session`/create-resume. Closes it because the pre-flight cap in `chat.py:121-137` reads the same ledger row `record_cost` writes.
- **Fix risk:** capping the summary path means a capped user's session ends with a mechanical summary instead of an LLM one — acceptable degradation. Does not fix F-06 (timeout). Cheapest proof: test that ending a session at hard cap records no new ledger delta and returns the mechanical summary.
- **Rejected alternatives:** metering only (log_call already exists) without gating — leaves the unbounded-spend hole open.

### F-04 — Session summary summarizes the FIRST 30 messages, not the last 30 (P1)
- **Defect:** `generate_and_persist` (`summary_service.py:37-42`) orders `ChatMessage.id.asc()` then `.limit(30)` — the first 30 messages. The docstring (`:3`) says "last 30 messages." `_mechanical_fallback` slices `messages[-5:]` of that same wrong window.
- **Trigger:** any session with >30 messages, then End or Continue-topic.
- **Consequence:** `last_session_summary` — shown in the end dialog, ProfileView, and session cards, AND injected as continuity context into the next session's system prompt (`chat.py:78`) — describes the beginning of the session and misses everything the learner ended on.
- **Confidence:** high (verified by direct read).
- **Proposed fix:** `order_by(ChatMessage.id.desc()).limit(30)` then `list(reversed(rows))` in `generate_and_persist`; fix the docstring. Closes it because the LLM then sees the actual recent turns.
- **Fix risk:** none material; changes summary content only. Cheapest proof: test with 40 messages asserting the prompt passed to `acompletion` contains message #40 and not #1.
- **Rejected alternatives:** none — this is an outright bug.

### F-05 — Ended sessions accept new chat turns and check answers (P1)
- **Defect:** `_prepare_turn` (`chat.py:157-171`) loads the session and checks only ownership, never `ended_at`; the three check endpoints (`sessions.py:379,404,434`) likewise. `chat.py` contains zero `ended_at` references (verified). "Ended" is an FE-only invariant (`SessionView.vue` `v-if="!isEnded"`).
- **Trigger:** tab A ends the session (or Continue-topic auto-ends it); tab B's stale composer sends a message → 200, persisted.
- **Consequence:** ended sessions accumulate messages the stored summary never covers; `last_activity_at` moves past `ended_at`; the resume-create "profile+summary snapshot" semantics silently break.
- **Confidence:** high.
- **Proposed fix:** in `_prepare_turn` and the three check endpoints, `if session.ended_at is not None: raise HTTPException(409, "session ended")`; FE maps 409 to a "session ended elsewhere" banner with Reopen.
- **Fix risk:** the idempotent resume flow must still allow reopen (which nulls `ended_at`) before a new turn — reopen already exists. Cheapest proof: test POST /chat/stream on an ended session returns 409.
- **Rejected alternatives:** enforcing only on the FE — the API surface stays open to any client.

### F-06 — No timeout on LLM/summary calls; sync connection held; FE fetch never times out (P1)
- **Defect:** neither `summary_service.py:58-65` nor `tutor.py:136-143` passes `timeout=` to `litellm.acompletion` (LiteLLM default is long); `get_db` holds the sync `Session` for the whole request; `apiClient.js:52` `fetch` has no `AbortSignal`. The design doc mandates "LiteLLM timeout (>30s) → retry once shorter context → 503" — no timeout, retry, or 503 exists anywhere (grep-confirmed absent).
- **Trigger:** Gemini hangs; user clicks End or Continue-topic (or any chat turn).
- **Consequence:** request blocks holding a pooled Postgres connection (default pool 5); ~5 concurrent hangs exhaust the pool and every endpoint queues/500s; FE spinner never resolves.
- **Confidence:** high on code; `[UNVERIFIED]` exact LiteLLM default timeout — confirm via `litellm.request_timeout`.
- **Proposed fix:** pass `timeout=settings.<name>_timeout_s` (~20-30s) to all `acompletion`/`embedding` calls, catch `litellm.Timeout` into the mechanical fallback (summary) / F-01's error path (chat); add `AbortSignal.timeout(30000)` in `apiClient.request` and `chatStreamService`.
- **Fix risk:** too-tight a timeout truncates slow-but-valid replies; 30s is safe for flash-lite. Does not fix pool sizing under sustained load. Cheapest proof: test that a patched `acompletion` sleeping past the timeout raises `Timeout` and the summary falls back.
- **Rejected alternatives:** raising pool size — masks the stall, doesn't bound it.

### F-07 — JWKS / unknown-kid raises uncaught `PyJWKClientError` → 500 (P1)
- **Defect:** `verify_supabase_jwt` (`auth.py:66-81`) catches `(jwt.InvalidTokenError, httpx.HTTPError, KeyError)`. `PyJWKClientError` (and `PyJWKClientConnectionError`) are siblings of `InvalidTokenError` under `PyJWTError`, not subclasses — so `get_signing_key_from_jwt` failures escape as 500. `PyJWKClient` uses urllib, so the `httpx.HTTPError` arm is dead.
- **Trigger:** (A) Supabase JWKS unreachable after the ~300s pyjwt cache expires → every authenticated request 500s; (B) any unauthenticated client sends a JWT with a bogus `kid` → pyjwt refetches JWKS on every such request (outbound-fetch amplification) and returns 500.
- **Consequence:** wrong status class (500 vs 401/503) breaks client retry logic and turns an upstream blip or a spoofed `kid` into a server-error storm plus forced outbound fetches.
- **Confidence:** high (exception hierarchy verified in vendored pyjwt).
- **Proposed fix:** in the `except`, add `jwt.PyJWKClientError` → 401 (kid miss) and `jwt.PyJWKClientConnectionError` → 503 (JWKS down); delete the `httpx.HTTPError` arm. Optionally stop the hourly client swap (`auth.py:29-39`) that discards a warm cache.
- **Fix risk:** must import the right exception names for the pinned pyjwt version. Cheapest proof: test that a token with an unknown `kid` returns 401, not 500.
- **Rejected alternatives:** a blanket `except Exception → 401` — would mask genuine 503-worthy outages as auth failures.

### F-08 — Cross-account localStorage leak on a shared browser (P1)
- **Defect:** `user.js:9` `STORAGE_KEY = 'crux:user:v1'` is a constant; the comment claims it is "keyed off Supabase userId" but no code re-keys it. `SettingsView.vue signOut()` calls `authStore.signOut()` but never `resetOnboarding()`.
- **Trigger:** user A signs out; user B logs in on the same browser.
- **Consequence:** user B sees A's display name and feedback preferences and skips onboarding (stale `onboardingComplete`).
- **Confidence:** high (verified by direct read).
- **Proposed fix:** derive the key from `authStore.userId` (`crux:user:v1:<uid>`) and reload the user store inside the `onAuthStateChange` handler in `stores/auth.js`; call `resetOnboarding()` on sign-out.
- **Fix risk:** existing single-user installs lose their un-namespaced blob once (re-onboard). Cheapest proof: test that switching `authStore.userId` loads a different user-store snapshot.
- **Rejected alternatives:** clearing on sign-out only — a crash/direct-login that skips the sign-out path still leaks.

### F-09 — No 401 handling anywhere in the frontend (P1)
- **Defect:** `apiClient.js:62-66` throws `ApiError` on any non-ok status; grep finds no `401` handling in src except a copy string. No refresh-then-retry, no sign-out, no redirect.
- **Trigger:** access token expires while the tab is backgrounded (supabase-js refresh timer throttled); user clicks anything.
- **Consequence:** every action toasts an error while the UI still renders signed-in; the request is never retried; the user must guess to reload.
- **Confidence:** high.
- **Proposed fix:** in `request()`, on 401 `await getSupabase().auth.getSession()` (refreshes) and retry once; if still 401, `authStore.signOut()` + `router.push({name:'login'})`. Mirror in `chatStreamService.js`.
- **Fix risk:** retry loops if the refresh silently returns the same expired token — cap at one retry. Cheapest proof: test that a 401 then a fresh token yields a successful retry.
- **Rejected alternatives:** relying on supabase-js auto-refresh alone — it does not cover the already-in-flight request that just 401'd.

### F-10 — Profile patches bundled with a quiz are silently discarded (P1)
- **Defect:** `tutor.py:240-242` drops every non-`ask_check_questions` tool call when an ask is present in the same response; the dropped calls get no dispatch, no tool result, and are absent from `tool_calls_record`.
- **Trigger:** the FOCUS PROTOCOL (`prompts.py:58-67`) tells the model to set `focus_target_gap` when concentrating on a gap; the natural single response bundles `update_topic_profile(focus_target_gap=A)` + `ask_check_questions(gap=A)`.
- **Consequence:** focus/gap/subtopic mutations the model believes it made never happen; next turn's profile contradicts the conversation.
- **Confidence:** high on code; medium on frequency (model-dependent).
- **Proposed fix:** in `run_streaming`, dispatch the non-ask calls first (they are safe pre-quiz), then the single ask — an order-preserving filter that keeps `update_topic_profile` slots instead of dropping them.
- **Fix risk:** a model that grades its own question via a bundled call must still have that dropped — keep dropping additional `ask`/grading calls, only preserve profile patches. Cheapest proof: test a bundled `update_topic_profile`+`ask_check_questions` response persists the focus change and registers the batch.
- **Rejected alternatives:** dropping all bundled calls (current behavior) — loses legitimate mutations.

### F-11 — Summary reloads a stale profile and overwrites concurrent writes (P1)
- **Defect:** `generate_and_persist` loads the profile (`summary_service.py:44`), awaits the LLM (`:58`, seconds), then `save_profile` writes the whole blob back (`:86-87`). Any profile write during the await is clobbered.
- **Trigger:** end_session (also synchronous on resume-create) races a user PATCH or a check answer (`record_from_answer`) in another tab.
- **Consequence:** silent loss of promotions/demotions/edits; `seed_from_prior` then propagates the corrupted blob into the next session.
- **Confidence:** high.
- **Proposed fix:** in `generate_and_persist`, re-load the profile after the LLM call and set only `last_session_summary` (or merge that single key), and share one commit with `abandon_open_batch`+`ended_at` (see F-33).
- **Fix risk:** re-load must happen inside the same transaction as the `ended_at` write. Cheapest proof: test that a profile mutation during a patched slow summary survives.
- **Rejected alternatives:** row-lock the session for the whole summary — holds a lock across an LLM call, worsening F-06.

### F-12 — No concurrency control on profile writes; agent ignores ETag (P1)
- **Defect:** `save_profile` (`profile_service.py:145-153`) is a blind whole-blob write; `routes/profile.py` `_guard_if_match` is check-then-act with no lock; grep finds zero `with_for_update` in backend. The ETag protects only user-vs-user; agent mutations neither carry nor bump a version the user's `If-Match` can catch.
- **Trigger:** two tabs streaming on one session, or a user PATCH concurrent with an agent `apply_patch`.
- **Consequence:** silent lost updates under ordinary multi-tab use.
- **Confidence:** high (mechanism certain; per-write window small except F-11's).
- **Proposed fix:** add a `profile_version` integer column and compare-and-set in `save_profile` (bump on every write, agent and user), returning a conflict the caller surfaces; or `db.get(SessionModel, sid, with_for_update=True)` across each load→save span.
- **Fix risk:** a version column needs a migration (owes a live `alembic upgrade head` per project convention). Cheapest proof: test two interleaved load→mutate→save sequences and assert the second detects the version bump.
- **Rejected alternatives:** ETag on the agent path — the agent has no client round-trip to carry `If-Match`.

### F-13 — Exclusivity invariant enforced on one of three write paths (P1)
- **Defect:** the user path `_add_exclusive` (`profile_service.py:170-193`) removes a concept from the opposite list and nulls focus; the agent path `apply_patch add_mastered_concept` (`:325-341`) and the server path `record_from_answer` correct-branch (`learning_event_service.py:74-81`) do not — a mastered concept stays in `confirmed_gaps`.
- **Trigger:** gap "X" in confirmed_gaps, learner answers its check correctly.
- **Consequence:** "X" is in both lists; review-gaps resume re-teaches a proven concept (`chat.py:85-102` excludes anything in gaps from mastered), `aggregate_for_user` double-counts it, GAP_ACCURACY keeps surfacing it.
- **Confidence:** high that it is inconsistent; `[UNVERIFIED]` whether keep-in-gaps was a deliberate "one correct answer isn't mastery" choice — no comment or spec says so (check slice-8 git log).
- **Proposed fix:** make the correct branch and `apply_patch`'s mastery add call `_add_exclusive` (single source of the invariant); if dual membership is intentional, document it and fix the three consumers instead.
- **Fix risk:** if a single correct answer should not fully promote, this over-promotes — needs the owner's ruling (section 6). Cheapest proof: test that a correct answer on a confirmed gap removes it from confirmed_gaps.
- **Rejected alternatives:** patching each consumer — three places vs one write path; the write path is the correct choke point.

### F-14 — max_iters / cap-abort discards streamed text and orphans an open batch (P1)
- **Defect:** the `max_iters` branch (`tutor.py:366-368`) and the mid-turn cap branch (`:118-127`) both `yield StreamEvent("error", ...); return` without `_persist_assistant_message`. Tool effects committed in earlier iterations (profile patches, a registered pending_check batch) remain.
- **Trigger:** a chatty model interleaving prose and tool calls for 8 iterations, or crossing the hard cap mid-turn.
- **Consequence:** the user watched text stream, then it vanishes on reload (FE clears the bubble on `error`); a registered check batch with no asking message blocks all future quizzes until session end (`register` guard, `check_question_service.py:142-146`).
- **Confidence:** high.
- **Proposed fix:** persist `accumulated_text` with a distinct status before yielding `error` in both branches; on the abort branches also `abandon_open_batch` if one was registered this turn.
- **Fix risk:** persisting partial text on cap-abort must not itself exceed the cap (it is a DB write, not an LLM call — safe). Cheapest proof: test that a turn hitting max_iters leaves an assistant row and no orphan open batch.
- **Rejected alternatives:** raising MAX_ITERS — pushes the cliff back without removing it.

### F-15 — Uploads on ephemeral disk in prod; no persistent mount (P1)
- **Defect:** raw uploads live only at `settings.uploads_path` = `/data/uploads/{id}_{name}` (`upload.py:103`); `render.yaml` has no `disk:` mount, so on Render the filesystem is ephemeral. Ingestion is an in-process BackgroundTask pinned to the replica that received the upload.
- **Trigger:** any deploy/restart, or a mid-ingestion restart; or a second replica.
- **Consequence:** `/data/uploads` wiped — files uploaded but not yet ingested are lost (stuck `pending`), and re-ingestion of any prior file is impossible; delete's `unlink` only cleans the one replica. Retrieval still works (chunks are in Postgres), so this is durability/availability, not a data leak.
- **Confidence:** high on ephemerality; `[UNVERIFIED]` — confirm `render.yaml` has no `disk:` block and the actual replica count.
- **Proposed fix:** add a Render persistent `disk:` mounted at `/data`, or move blobs to R2/Supabase Storage (the WS-D R2 client already exists) behind the storage interface. R2 also fixes the multi-replica case.
- **Fix risk:** a disk mount pins to one instance (no horizontal scale); R2 is the durable choice but a larger change. Cheapest proof: upload, restart the container, confirm the file is still resolvable for re-ingestion.
- **Rejected alternatives:** keeping local disk with a startup reaper (F-26) — recovers status but not the lost file.

### F-16 — Committed dev HEAD ships a dead Supabase client (P1)
- **Defect:** at committed dev HEAD, `frontend/Dockerfile` has no `ARG VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, so the docker build bakes the placeholder client (`supabase.js:15-21` → `http://placeholder.invalid`). The working tree contains the fix uncommitted (`git diff HEAD` shows +8 in Dockerfile, +4 in docker-compose.yml).
- **Trigger:** fresh clone of `dev`, `docker compose up`, try to register/login.
- **Consequence:** total auth failure ("Failed to fetch") on the documented "Start full stack" path.
- **Confidence:** high (this matches the working-tree diff visible in `git status`).
- **Proposed fix:** commit the pending `frontend/Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, and `frontend/.env.example` changes.
- **Fix risk:** none — it is the already-authored fix. Cheapest proof: build the image and grep the bundle for a real Supabase URL rather than `placeholder.invalid`.
- **Rejected alternatives:** none — the fix exists, it just is not committed.

### P2 findings

**F-17 — Cost-ledger lost-update race (cost_meter.py:77-84).** *Defect:* `record_cost` is a read-modify-write (`row.cost_usd = old + cost; db.flush()`) with no row lock or atomic SQL increment; `check_cap` is check-then-act. *Trigger:* one user streams two tabs concurrently — both read the same total, both write, one increment lost; both pass the pre-turn cap. *Consequence:* daily spend undercounted; hard cap overshoots by (concurrency × per-iter cost). *Confidence:* high (verified read; contrasts with the atomic `rate_limit.py`). *Fix:* mirror `rate_limit._dialect_insert` — `INSERT ... ON CONFLICT (user_id, date_utc) DO UPDATE SET cost_usd = daily_cost_ledger.cost_usd + EXCLUDED.cost_usd RETURNING cost_usd`. *Fix risk:* Decimal quantization must happen in SQL or post-read; test two concurrent `record_cost` calls sum correctly. *Rejected:* app-level lock — doesn't survive multi-replica.

**F-18 — Sync network I/O on the async loop (retrieval_service.py:44-48, tutor.py:277).** *Defect:* `litellm.embedding` (retrieve + semantic fallback) and `tools.dispatch` run synchronously inside async generators; all DB work is sync psycopg on the loop. *Trigger:* any retrieval/fallback turn; embedding latency of hundreds of ms. *Consequence:* every other user's SSE stream, disconnect polling, and background tasks freeze for the duration on a single-worker Uvicorn. *Confidence:* high. *Fix:* `await litellm.aembedding(...)` at both call sites; run `tools.dispatch` via `asyncio.to_thread`. *Fix risk:* `aembedding` must be awaited inside the async `_prepare_turn`/`run_streaming`; test concurrency doesn't regress. *Rejected:* more workers — dilutes, doesn't remove, the stall.

**F-19 — Embeddings unmetered; cost silently 0 on builder failure (retrieval_service.py, tutor.py:184-189).** *Defect:* no `cost_meter` call in `retrieval_service`; `completion_cost` failure sets `cost = 0.0`. *Trigger:* every retrieval turn; or a model id `completion_cost` doesn't recognize. *Consequence:* real spend invisible to the cap and R3 dashboard; a pricing-table gap makes all chat spend register $0 and the cap never trips. *Confidence:* high for embeddings; medium for builder gaps — `[UNVERIFIED]` whether `completion_cost` knows `gemini/gemini-3.1-flash-lite`. *Fix:* meter embeddings via `record_cost`+`log_call`; on `completion_cost` failure fall back to token-math (reuse `estimate_cancelled_cost`) instead of 0. *Rejected:* ignore embeddings as negligible — they are the majority of DB-round-trip turns.

**F-20 — Malformed tool-args JSON → empty patch reports success (tutor.py:266-270).** *Defect:* `json.JSONDecodeError` sets `args = {}`; `tools.py:84` injects `session_id` so `UpdateTopicProfileArgs` validates; `apply_patch` returns `ok=True` for an all-None patch; `_summarize` says "Profile updated". *Trigger:* truncated/garbled streamed arguments (a real Gemini failure mode). *Consequence:* the model's intended mutation vanishes while model and learner both get success. *Confidence:* high. *Fix:* on `JSONDecodeError` synthesize `ToolResult(ok=False, error="malformed arguments")` instead of dispatching `{}`; make `apply_patch` fail no-op patches. *Rejected:* silent retry — the model isn't told it failed.

**F-21 — Evidence provenance is self-reported, gates only sort order (profile_service.py:335-341).** *Defect:* `add_mastered_concept` accepts `evidence_type="tested"` with no check that a `LearningEvent` exists; only `record_from_answer` stamps genuine "tested". Sole consumer: `review_queue_service.py:96-97` sort rank. *Trigger:* model labels a declared claim "tested". *Consequence:* slice-8's "evidence provenance" differentiator is a self-attested string with one cosmetic effect. *Confidence:* high. *Fix:* in `apply_patch`, downgrade agent-supplied "tested" to "declared" (one line) plus a prompt note. *Rejected:* trust the model — defeats the point of provenance.

**F-22 — Case-mismatch dangling focus (profile_service.py:165-167).** *Defect:* `_null_focus_if_removed` compares `focus_target_gap == item` exactly, while removal matches by `canon()`. *Trigger:* focus="Chain Rule"; user deletes "chain rule". *Consequence:* focus still points at a gap no longer in confirmed_gaps; agent keeps drilling it. *Confidence:* high. *Fix:* `canon(profile.focus_target_gap) == canon(item)`. *Rejected:* none.

**F-23 — Model retry silently clears focus (profile_service.py:343-349).** *Defect:* omitting `focus_target_gap` in tool JSON is indistinguishable from explicit null; a non-focus patch while focus is set fails asking for `focus_clear_reason`, and a compliant model retries with a fabricated reason, clearing focus as a side effect. *Trigger:* focus on A; agent calls `update_topic_profile(add_confirmed_gap="B")`. *Consequence:* focus lost mid-remediation with a plausible audit trail. *Confidence:* high mechanism, medium frequency. *Fix:* treat clearing as intent only when the reason is present (`clearing = prior_focus and args.focus_target_gap is None and args.focus_clear_reason is not None`), or add an explicit "clear" sentinel; plus a prompt note. *Rejected:* require focus echo every patch — brittle.

**F-24 — Check-answer 3-commit, no idempotency (routes/sessions.py:414-420).** *Defect:* answer → write_check_batch → grade_if_diagnostic are separate commits; `answer()` does unguarded read-modify-write on `pending_check_json`. *Trigger:* (a) double-click/two tabs POST the same index → two LearningEvents for one question; (b) crash after answer commit before `grade_if_diagnostic` on the last diagnostic item → `complete_check` clears the batch ungraded → `knowledge_level` stays None → diagnostic re-triggers. *Consequence:* skewed SM-2 streaks/accuracy; repeated diagnostic. *Confidence:* high mechanism. *Fix:* `with_for_update` on the Session row in `answer()`/`skip()`; call the idempotent `grade_if_diagnostic` inside `complete_check` too. *Rejected:* FE button disable — doesn't protect the API.

**F-25 — Skipping the diagnostic → permanent "beginner" (diagnostic_service.py:29-30).** *Defect:* `level_for_score(n_correct, len(items))` counts skips as wrong; skipping all 3 grades beginner from zero evidence, and `diagnostic_required` never fires again (level copied forward by `seed_from_prior`), with no server path to reset level to None. *Trigger:* learner skips all diagnostic questions. *Consequence:* an advanced learner is taught at beginner level indefinitely. *Confidence:* high. *Fix:* in `grade_if_diagnostic`, if `len(graded) == 0` leave `knowledge_level` None so the diagnostic is re-offered. *Rejected:* treat skip as wrong — punishes declining the quiz.

**F-26 — No ingestion restart recovery (ingestion_service.py:104).** *Defect:* in-process BackgroundTask, no reconciliation sweep (grep-confirmed). *Trigger:* restart while `status="pending"`. *Consequence:* session shows `pending` forever (aggregate priority `pending > ready`). *Confidence:* high. *Fix:* startup job marking stale `pending` docs (older than N min, no chunks) as `failed` or re-enqueuing. *Rejected:* rely on user re-upload — they aren't told it's stuck.

**F-27 — Non-atomic ingest; failed-doc chunks retrievable (ingestion_service.py:128-142, pgvector_store.py:78).** *Defect:* `insert_chunks` commits, then `merge_into_session` commits separately, then `status="ready"`; if merge fails, chunks are committed while `status="failed"`, and `query_chunks` filters by `session_id` only (not doc status), so those chunks are still returned when any other doc in the session is ready. *Trigger:* merge failure or partial-commit crash. *Consequence:* "failed"-labeled content silently feeds retrieval and citations. *Confidence:* high. *Fix:* single transaction for insert+merge+status; and/or join `Document.status=='ready'` in `query_chunks`. *Rejected:* status join alone — leaves orphan chunks accumulating.

**F-28 — Delete non-atomic, no cascade (documents_service.py:106-113).** *Defect:* chunk-delete commit, then doc-delete commit, then best-effort unlink; `chunk_embeddings.document_id` has no ON DELETE CASCADE. *Trigger:* crash between the two commits. *Consequence:* `ready` doc with zero chunks, or orphaned vectors. *Confidence:* high. *Fix:* both deletes in one transaction, or add ON DELETE CASCADE and delete the row alone. *Rejected:* none.

**F-29 — Disk-write failure orphans a permanent pending row (upload.py:102-107).** *Defect:* `open(dest,"wb").write(data)` is unguarded and runs after the row commit and before `add_task`. *Trigger:* disk full / unwritable dir. *Consequence:* row stuck `pending`; `add_task` never runs; banner spins forever. *Confidence:* high. *Fix:* try/except the write; on failure set `status="failed"`, commit, raise 507. *Rejected:* none.

**F-30 — Double-end race (routes/sessions.py:298-307).** *Defect:* `if row.ended_at is not None` idempotency is check-then-act with a multi-second await between; no row lock. *Trigger:* double-click End in two tabs, or End racing a Continue-topic resume-create of the same prior. *Consequence:* both pay an LLM call, doubled spend, nondeterministic final summary, duplicate ledger rows. *Confidence:* high. *Fix:* claim first — `UPDATE sessions SET ended_at=now() WHERE id=:id AND ended_at IS NULL`; rowcount 0 → idempotent path; summarize after the claim. *Rejected:* advisory lock — heavier than the conditional UPDATE.

**F-31 — Resume-create doesn't abandon the prior's open batch (routes/sessions.py:120-127).** *Defect:* unlike `end_session`, the resume finalization omits `abandon_open_batch`, so `pending_check_json` survives. *Trigger:* mid-quiz, user clicks Continue-topic, then reopens the prior. *Consequence:* stale live quiz card renders and `register`'s open-batch guard deadlocks new quizzes. *Confidence:* high. *Fix:* call `abandon_open_batch(db, prior_session_id)` before `generate_and_persist` in `create_session`. *Rejected:* none.

**F-32 — Zero-message session makes a paid LLM call + hallucinated summary (summary_service.py:54-67).** *Defect:* only the stub flag short-circuits; a real end with no messages sends "Transcript:\n(no messages)" to the LLM, which returns non-empty prose that bypasses `_mechanical_fallback` and is classified kind="summary". *Trigger:* create session, immediately End (stub off). *Consequence:* money spent to summarize nothing; user sees a fabricated recap instead of the no-exchanges message; persisted to the profile. *Confidence:* high. *Fix:* `if not messages: summary = _mechanical_fallback(messages)` as the first line of the non-stub branch. *Rejected:* none.

**F-33 — end_session multi-commit partial states (summary_service.py:86-90, check_question_service.py:107-108, pending_check_store.py:61-63).** *Defect:* abandon (2 commits) → LLM → save_profile (commit) → ended_at (commit); crash windows leave (a) active session with a force-skipped quiz, (b) `last_session_summary` on a still-active session (next turn shows false "last time" continuity). *Trigger:* crash/disconnect during the await. *Consequence:* three distinct partial states, none retried, session shows active indefinitely. *Confidence:* high on the sequence; `[UNVERIFIED]` whether uvicorn cancels the coroutine on client disconnect for non-streaming POSTs. *Fix:* thread `commit=False` through the writes, do the LLM call first, commit once at the end. *Rejected:* per-step retries — more commits, same window.

**F-34 — Duplicate-topic detection is browser-only (NewSessionView.vue:148-158).** *Defect:* the guard reads `store.sessions` (empty if `listSessions` failed via `.catch(()=>{})`); backend `create_session` has no uniqueness check; `reopen` has none either. *Trigger:* list failure, two tabs, direct API, or resume-create→reopen. *Consequence:* multiple active sessions per topic with forked profiles; mastery/gap state diverges; review queue misattributes. *Confidence:* high. *Fix:* server-side check in `create_session` — SELECT active session for (user_id, casefolded topic); on hit return 409 with the existing id; FE turns 409 into "Open existing". *Rejected:* FE-only fix — doesn't cover API/direct paths.

**F-35 — Unbounded profile lists re-injected each turn (prompts.py:236).** *Defect:* `confirmed_gaps`/`mastered_concepts` have no length cap (only subtopics do, MAX_SUBTOPICS=20); the full profile JSON is a prompt line every turn, and profiles copy forward on resume. *Trigger:* model adds a gap most turns over a long/resumed lineage. *Consequence:* monotonic prompt growth (~60 tokens/entry), degraded cache reuse, rising cost. *Confidence:* high mechanics, medium growth rate. *Fix:* cap list lengths in `apply_patch` and/or render only the N most-recent entries in `build_dynamic_context`. *Rejected:* rely on model self-pruning — it doesn't.

**F-36 — ensure_user after the FK-bearing usage-counter insert (routes/chat.py:140,152-154).** *Defect:* `check_and_increment` INSERTs `usage_counters` (FK → users.id) before `ensure_user` runs, so the advertised "auto-create user" path FK-violates → 500 on Postgres. SQLite tests don't enforce FKs so the suite misses it. *Trigger:* valid-JWT user with no users row (API-first client, restored DB, deleted row). *Consequence:* 500 on a normal first action. *Confidence:* high on ordering; medium on real-world trigger. *`[UNVERIFIED]`:* that the live migration includes the FK on usage_counters — confirm with the migration file / `\d usage_counters`. *Fix:* move `ensure_user` above the rate-limit call in `_prepare_turn`. *Rejected:* drop the FK — loses referential integrity.

**F-37 — ensure_user get-then-insert race (user_service.py:24-33).** *Defect:* `db.get` → `db.add` → `db.flush`, no IntegrityError handling. *Trigger:* double-click "new session" as a brand-new user (two parallel POST /sessions). *Consequence:* loser gets IntegrityError → 500 on first action. *Confidence:* high. *Fix:* `insert(User).on_conflict_do_nothing(index_elements=["id"])` then re-select (pattern already in rate_limit.py). *Rejected:* app lock — multi-replica unsafe.

**F-38 — "Deterministic grading" grades a model-authored key (check_question_service.py:209).** *Defect:* `correct = selected_index == item["correct_index"]`, where `correct_index` came from the model at register time (validated only for range). A wrong key wrongly demotes a mastered concept AND adds it to confirmed_gaps. *Trigger:* a single model slip in authoring the key. *Consequence:* silent, learner-visible-as-truth profile corruption. *Confidence:* certain mechanism, unknowable frequency. *Fix:* scope the product claim honestly ("deterministic grading of model-authored keys"); optionally let an explanation/answer mismatch be user-reportable to delete the event. *Rejected:* claim full determinism — it is not, the key is model-authored.

**F-39 — knowledge_level writable with no evidence; overwrites user value (profile_service.py:311-312, diagnostic_service.py:31-33).** *Defect:* level changes require no evidence_type (unlike mastery); a user PATCH of level mid-diagnostic-batch is overwritten when the batch resolves. *Trigger:* agent sets level, or user sets level during an open diagnostic. *Consequence:* level set on no evidence, or user intent clobbered. *Confidence:* high. *Fix:* require declared/tested evidence for level changes; grade only if level is still None. *Rejected:* none.

**F-40 — Full body read before size enforcement (upload.py:58-94).** *Defect:* the Content-Length gate is skipped when the header is absent/forged; `file.file.read()` materializes the whole body before the `len(data)` cap. *Trigger:* client omits/forges Content-Length and streams a large body. *Consequence:* resource pressure before rejection. *Confidence:* medium. *Fix:* read in bounded increments, abort past MAX_UPLOAD_BYTES. *Rejected:* trust Content-Length — spoofable.

**F-41 — Zero clock-skew tolerance (auth.py:69-76).** *Defect:* `jwt.decode` has no `leeway`. *Trigger:* backend clock a few seconds ahead of Supabase. *Consequence:* freshly-refreshed tokens 401 at the exp boundary; compounds F-09 into visible failures. *Confidence:* high. *Fix:* `leeway=30`. *Rejected:* none.

**F-42 — No per-request rate limiting (frontend/nginx.conf, backend/main.py).** *Defect:* only daily LLM caps exist; grep for `limit_req|slowapi|RateLimit` finds nothing. *Trigger:* auth verification is the unauthenticated surface (F-07 trigger B forces outbound JWKS fetches). *Consequence:* no throttle on request floods. *Confidence:* high. *Fix:* `limit_req_zone`/`limit_req` on `location /api/` in nginx (and the Render equivalent). *Rejected:* app-level throttle — heavier, still useful as defense-in-depth.

**F-43 — Mid-turn check_cap reads the ORM identity map (cost_meter.py:62-66, tutor.py:112).** *Defect:* `db.get` returns the cached instance without SQL after the first read, so iterations 2..8's cap check can't see other sessions' concurrent spend. *Trigger:* concurrent streams for one user. *Consequence:* the "mid-turn cap re-check" only sees own-turn accumulation; combined with F-17 the cap is advisory under concurrency. *Confidence:* medium-high; `[UNVERIFIED]` how often intra-loop commits expire the row. *Fix:* use a fresh `select` (reuse `spend_subquery`) with `populate_existing` in `current_spend`. *Rejected:* none.

### P3 findings (condensed)

- **F-44 — Summary dialog dropped off-view (SessionView.vue:432-441).** Non-immediate watch, single consumer; ending from the sidebar while on Home/Library never shows the summary. *Fix:* `{immediate:true}` + a toast fallback in `SidebarSessionRow.onEnd` when not on that session's view.
- **F-45 — HomeView no in-flight guard (HomeView.vue:92-120).** `_setError` rethrows out of the handler (unhandled rejection); double-click dupes sessions (see F-34). *`[UNVERIFIED]`* HomeView renders `store.error`. *Fix:* `busy` ref + try/catch in `startReview`/`startQuick`; catch in `onContinueTopic`.
- **F-46 — Onboarding per-browser (router/index.js:106-113).** New device force-routes to onboarding; typed values overwrite nothing server-side. *Fix:* persist onboarding on the users row; hydrate from backend after auth.
- **F-47 — Token read synchronously (apiClient.js:23-30).** After wake-from-sleep the store can hold an expired token for the first request; compounds F-09. *Fix:* make `_getAccessToken` async via `sb.auth.getSession()`; same in chatStreamService/uploadApi.
- **F-48 — Inferred-mastery add returns ok=True no-op (profile_service.py:335-341).** Ignoring inferred mastery is policy; reporting "Profile updated" is a lie. *Fix:* return a distinct status ("inferred mastery ignored").
- **F-49 — Deep link lost on login (router/index.js:98-99).** *Fix:* guard returns `{name:'login', query:{redirect: to.fullPath}}`; LoginView pushes a validated relative `redirect`.
- **F-50 — Issuer trailing-slash kills auth (auth.py:74).** Issuer uses raw `supabase_url` while the JWKS URL is rstripped (config.py:51); a trailing slash → issuer mismatch → all tokens invalid. *Fix:* compute issuer from the same rstripped value.
- **F-51 — Raw backend error toasted (App.vue:41-42).** 401 shows literally "invalid_token" despite `friendlyError`. *Fix:* `showError(friendlyError(err))`.
- **F-52 — Consent stamp fabricated (user_service.py:5-30).** `signUp` is callable directly against Supabase, bypassing the client-only checkbox; `ensure_user` stamps `accepted_terms_at` anyway, so the audit record doesn't evidence consent. *Fix:* pass an accepted-terms flag in signUp `options.data` (lands in the JWT) and stamp only when present.
- **F-53 — "[auto] " prefix leaks into ProfileView (ProfileView.vue:210-213).** `stripAutoPrefix` exists but is applied only in sessionCard.js. *Fix:* wrap with `stripAutoPrefix` in ProfileView. (Project memory: strip before ANY UI display.)
- **F-54 — endSession pollutes local profile (session.js:194-200).** For kind=no_exchanges it writes the user-facing sentence into `topic_profile.last_session_summary`. *Fix:* only patch when `resp.summary.kind === 'summary'`, or refetch.
- **F-55 — No MIME sniffing (upload.py:69-77).** Extension trust only; `evil.exe`→`notes.pdf` wastes an ingestion cycle. *Fix:* sniff magic bytes (`%PDF`, PK header) before scheduling.
- **F-56 — retrieval_required advisory (prompts.py:120-124).** REQUIRED only injects a prompt flag; the model may skip retrieval and answer ungrounded. *Fix:* if REQUIRED and the model produced a final answer with zero `retrieve_chunks` calls, force one retrieval or annotate the response.
- **F-57 — CORS allow_credentials unnecessary (main.py:24-30).** Bearer auth needs no credentialed CORS; safe today only because origins are an explicit list. *Fix:* `allow_credentials=False`.
- **F-58 — Rolling-summary full-table scan (summary_service.py:127-135).** Loads all session messages every turn just to count. *Fix:* `SELECT count(*)` first, early-return via `rolling_summary_due`; cap `dropped` to the newest M for the transcript.
- **F-59 — Batch purpose coupled to knowledge_level (check_question_service.py:150-151).** A review-gaps quiz posed while level is None is recorded as diagnostic (`apply_profile_effects=False`, excluded from insights). *`[UNVERIFIED]`* reachability. *Fix:* take purpose from the prompt-state `diagnostic_required` decision, not re-derived level.
- **F-60 — Dead guard code + stale comments (pending_check_store.py:38-45; profile_service.py:8-10).** `is_gradable` "no longer called"; docstrings argue with the spec. *Fix:* delete; update comments to match shipped behavior.
- **F-61 — auth_not_configured 500 per request (auth.py:33-37).** A dev/staging deploy without SUPABASE_URL boots clean then 500s every authed request. *Fix:* warn loudly / refuse to boot in `validate_jwks_startup` unless an explicit disable flag is set.
- **F-62 — CSP blocks API if absolute base URL (nginx.conf:5).** `connect-src 'self' https://*.supabase.co` vs any build inheriting the absolute `VITE_API_BASE_URL` from .env.example. Docker bakes `/api` so the shipped path is safe, but the default is a trap. *Fix:* document that nginx-served builds must use relative `/api`, or add the API origin to connect-src.

---

## The differentiator, judged

The claim is "structured, tool-call-enforced live student-model mutation, not RAG." Against the
code, roughly one-third is real and load-bearing, two-thirds is decorative prompt state — and the
strongest advertised guarantee is currently false.

**Real (a bare system prompt could not replicate):** server-authoritative click-graded check
questions with deterministic promotion/demotion (`learning_event_service.record_from_answer`); the
forced 3-question diagnostic that deterministically maps to `knowledge_level`
(`diagnostic_service.py`); the SM-2-lite review queue and cross-session carry (`seed_from_prior`,
review_queue_service). These are genuine structure — the server, not the model, decides what the
profile becomes on a graded answer.

**Decorative (the model re-reads state it mostly wrote itself):** within a session,
`mastered_concepts`, `focus_target_gap`, `evidence_type`, and all of R4's `subtopic_levels` reach
the model only as one JSON line in the prompt (`prompts.py:236`). Evidence provenance is
self-attested and gates only review-queue sort order (F-21). The focus protocol is now 100%
honor-system because its server guard was deleted (F-02). A competent GPT wrapper with a good
system prompt and the visible conversation history would produce comparable *within-session*
behavior, because the model is mostly reasoning over state it authored a turn ago.

**The mutation substrate is structurally weak** regardless of intent: a whole-JSON-blob,
last-writer-wins column with zero locking (F-12), an exclusivity invariant enforced on one of
three write paths (F-13), a tool reducer that silently drops bundled profile patches (F-10), and a
summary path that overwrites concurrent writes across an LLM call (F-11).

**What it would take to make the differentiator real (structural, not a patch):** (1) move the
profile off a single JSON blob into row-per-concept tables (mastered_concept, confirmed_gap,
subtopic_level) with a per-session version or per-row optimistic concurrency, so every mutation is
an auditable, conflict-checked row rather than a blob overwrite — this alone dissolves F-11, F-12,
F-13, F-22; (2) restore server verification on the state transitions that claim it (focus-clear,
evidence="tested") so provenance is earned, not asserted (F-02, F-21); (3) make the profile
materially steer teaching beyond being echoed in the prompt — e.g. server-selected next-concept or
difficulty from the profile, not a JSON line the model may ignore. Without (1)-(3) the honest
positioning is "RAG plus a server-graded quiz loop," which is defensible and worth keeping — but
it is not the "tool-call-enforced live student model" the docs claim.

---

## Open questions for Opus (decisions to force)

1. **Focus-clear guard (F-02): restore or retire?** Blocks the F-02 fix. If the product still
   claims a server-side focus guard, restore verification; if not, the design doc §4.4 and
   CLAUDE.md must be edited to say "reason-string-only." Pick one — code and docs cannot both stand.
2. **Mastery exclusivity (F-13): does one correct answer fully promote?** Blocks F-13. If yes, route
   the correct-answer and agent-mastery paths through `_add_exclusive`; if "one answer isn't
   mastery," keep dual membership and fix the three consumers instead. No code path documents the
   intent.
3. **Cost cap semantics under concurrency (F-03, F-17, F-43): hard ceiling or best-effort?** If a
   hard per-user ceiling is required, F-17 (atomic increment) + F-03 (meter summaries) + a
   reservation model are all mandatory; if best-effort is acceptable, document it and fix only F-03.
4. **Deployment target for uploads (F-15): Render disk mount vs R2?** Blocks F-15 and shapes F-26.
   A disk mount pins to one instance; R2 enables horizontal scale but is the larger change. This is
   a topology decision, not a code decision.
5. **Final LLM (`gemini/gemini-3.1-flash-lite` vs `anthropic/claude-sonnet-4-6`).** The fallback
   model is ~40x the rate while caps stay fixed; F-19's $0-cost-on-unknown-model risk and the
   `MODEL_RATES` "placeholder; verify" comment both hinge on which model actually ships. Verify
   pricing before the cap can be trusted.
6. **Concurrency model / worker count.** F-18 (loop-blocking sync I/O) and F-43 (identity-map cap
   read) are whole-service stalls on single-worker Uvicorn and merely diluted by multiple workers.
   The real fix (async embeddings, `to_thread` dispatch) is worth doing regardless, but the urgency
   depends on the deploy's worker/replica count — unverified here.

---

## Remediation plan

Sequenced by blast radius / effort into independently landable, independently verifiable batches.
Opus writes the diffs; each batch is gated on owner approval. No code below — mechanism and
sequencing only.

**Batch 1 — Stop the bleeding (P0/P1, small, high blast radius).** F-01 (agent-loop error SSE +
FE reset), F-04 (summary desc/limit + docstring), F-16 (commit the pending docker/env diff), F-05
(ended-session 409 guard). Files: `agent/tutor.py`, `stores/session.js`, `lib/sseParser.js`,
`summary_service.py`, `frontend/Dockerfile` + compose + env examples, `routes/chat.py`,
`routes/sessions.py`. Verify: unit test forcing an LLM exception yields one `error` event;
40-message summary test asserts recent turns; `docker compose up` on a clean clone logs in; POST
to an ended session returns 409. Effort: ~0.5 day.

**Batch 2 — Cost integrity (P1/P2).** F-03 (meter+gate summaries), F-17 (atomic ledger increment),
F-19 (meter embeddings + non-zero fallback), F-43 (fresh cap read), F-06 (LLM timeouts + FE abort).
Files: `summary_service.py`, `cost_meter.py`, `retrieval_service.py`, `agent/tutor.py`,
`apiClient.js`, `config.py`. Verify: concurrent `record_cost` sums correctly; ending at cap records
no LLM spend; a patched slow `acompletion` raises `Timeout` and falls back. Effort: ~1 day.

**Batch 3 — Auth + session hardening (P1/P2).** F-07 (JWKS exception mapping), F-08 (per-uid user
store + reset on sign-out), F-09 (401 refresh-retry/sign-out), F-41 (leeway), F-36/F-37 (ensure_user
ordering + upsert), F-30 (atomic end claim), F-31 (abandon batch on resume-create), F-32
(zero-message short-circuit), F-33 (single-commit end). Files: `services/auth.py`,
`stores/user.js`, `stores/auth.js`, `apiClient.js`, `user_service.py`, `routes/chat.py`,
`routes/sessions.py`, `summary_service.py`, `check_question_service.py`, `pending_check_store.py`.
Verify: unknown-kid → 401; user switch loads a fresh store; 401 triggers one refresh-retry;
concurrent double-end pays one LLM call; ending a fresh session shows the no-exchanges message.
Effort: ~1.5 days.

**Batch 4 — Profile-mutation correctness (P1/P2), gated on Q1+Q2.** F-02 (focus guard decision),
F-10 (dispatch bundled patches), F-11 (reload profile post-LLM), F-12 (version column or row lock),
F-13 (exclusivity), F-20 (malformed-args failure), F-21 (downgrade self-tested), F-22 (canon focus
compare), F-23 (clear-intent requires reason), F-24 (answer idempotency), F-25 (skip-diagnostic),
F-39 (level evidence), F-48 (inferred no-op status). Files: `profile_service.py`,
`learning_event_service.py`, `check_question_service.py`, `diagnostic_service.py`, `agent/tutor.py`,
`routes/sessions.py`, plus a migration if F-12 adds a version column (owes a live `alembic upgrade
head`). Verify: bundled patch+ask persists both; interleaved writes detect the version bump; a
correct answer removes the gap from confirmed_gaps; unearned focus-clear is rejected (if Q1=restore).
Effort: ~2-3 days (largest; touches the core loop).

**Batch 5 — Ingestion + storage durability (P1/P2), gated on Q4.** F-15 (persistent storage), F-26
(startup reaper), F-27 (atomic ingest + status-filtered query), F-28 (atomic delete / cascade),
F-29 (guarded write), F-40 (streaming size cap). Files: `render.yaml` or an R2-backed store,
`ingestion_service.py`, `pgvector_store.py`, `documents_service.py`, `upload.py`. Verify: upload
survives a restart and re-ingests; a failed-merge doc's chunks are not returned; delete leaves no
orphan chunks. Effort: ~1.5 days (more if R2).

**Batch 6 — Perf + hygiene + drift (P2/P3).** F-18 (async embeddings + to_thread), F-35 (cap
profile lists), F-58 (count-first rolling summary), F-42 (nginx rate limit), F-57 (CORS), F-34
(server duplicate-topic 409), F-44/F-45/F-46/F-47/F-49/F-51/F-53/F-54 (FE UX), F-50/F-61/F-62
(auth/deploy config), F-55/F-56/F-59/F-60 (misc), plus all drift (D-1..D-6, F-52, F-38 honesty
edits). Files: broad but shallow. Verify: per-item; drift items verified by re-reading the doc vs
code. Effort: ~2 days spread.

---

## Context Opus needs

- **Stack:** Vue 3 + Vite + Pinia + PrimeVue frontend (nginx-served in docker); FastAPI + sync
  SQLAlchemy backend; Supabase Auth (JWT via JWKS) + Supabase Postgres 17 + pgvector; LiteLLM →
  `gemini/gemini-3.1-flash-lite` (fallback `anthropic/claude-sonnet-4-6`). Uploads on local disk
  `/data/uploads`. SSE over a fetch POST (not EventSource). No ChromaDB in code despite doc claims.
- **Branch state:** `dev` at `c3ef83b`. Working tree has an UNCOMMITTED fix for F-16 (the
  Supabase docker build args) across `frontend/Dockerfile`, `docker-compose.yml`,
  `docker-compose.prod.yml`, `.env.example`, `frontend/.env.example` — visible in `git status`.
  Commit it as Batch 1.
- **Canonical vs superseded docs:** `docs/superpowers/specs/2026-05-03-crux-v1-design.md` is the
  primary source of truth per CLAUDE.md, BUT its body still describes ChromaDB throughout and the
  deleted focus guard as live — treat those as defects (F-02, D-3), not authority.
  `docs/api/openapi.yaml` is the API-shape truth (contracts under `backend/contracts/` are codegen
  — edit YAML then `python backend/scripts/gen_contracts.py`, never hand-edit). `docs/Crux_Spec.md`
  and `docs/Crux_DevPlan.md` are v2 reference only.
- **Test/CI conventions (from project skill):** run pytest from `backend/`, not repo root. After
  import-touching refactors run the full backend suite. Frontend vitest does not cover Playwright
  e2e — grep the whole repo (incl. `frontend/e2e/`) before deleting a `data-testid`. CI runs
  sqlite parity; live is Supabase Postgres — every new migration owes a live `alembic upgrade
  head`. SHA-pin all GitHub Actions `uses:`.
- **Assumptions that, if wrong, invalidate a finding:** (1) F-15/F-26 assume Render single-instance
  ephemeral FS with no `disk:` — confirm `render.yaml`. (2) F-36 assumes the live migration puts an
  FK on `usage_counters.user_id` — confirm the migration. (3) F-19/F-38 assume `MODEL_RATES` may
  not match live pricing — the comment says "placeholder; verify." (4) F-33 assumes uvicorn cancels
  the handler coroutine on client disconnect for non-streaming POSTs — unconfirmed. (5) Frequency of
  F-10/F-20/F-23 depends on the live Gemini model's tool-calling behavior — not measured.
- **Drift (D-1..D-6), all P3:** D-1 name `AdaptLearn` (CLAUDE.md) vs `Crux` (code/README/doc). D-2
  phase table claims "ChromaDB" (CLAUDE.md:78) vs pgvector-only code. D-3 design-doc body says
  ChromaDB throughout (lines 82,123,171,271,341,391,481,495,497). D-4 `VITE_API_BASE_URL` default
  differs across README / .env.example / Dockerfile. D-5 `.env.example:19` names
  `text-embedding-004` while the default is `gemini-embedding-2`. D-6 CORS default list differs
  between docker-compose.yml and root .env.example. Also: the design doc's LLM-failure contract
  ("retry once shorter → 503", "return {ok:false}") does not exist in code (F-06 context) — the
  `SessionEndSummary` contract has no fallback/degraded flag.
