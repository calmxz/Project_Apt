# Final Adversarial Review â€” 2026-07-18

Gate-and-repair pass before merge and public distribution. Full backend + frontend + app-level integration audit plus a live UI/design audit (Claude in Chrome against the running docker-compose stack, both themes). Baseline at audit start: `dev` @ 0962982, working tree clean; prior review docs/adversarial-review-2026-07-12.md fully remediated (Batches 1-6, PRs #116-#121).

Method: three parallel read-only source audits (backend / frontend / integration) + orchestrator-driven browser audit. Every finding anchors to file:line in current source. Verdict vocabulary: CONFIRMED / REFUTED / BY-DESIGN / REGRESSION. Severity: P1 blocks merge, P2 fix before public, P3 defer.

ID scheme: B-xx backend, F-xx frontend, I-xx integration, U-xx UI/browser (domain-prefixed instead of a single G-xx sequence; IDs are unique and stable).

## Headline

- 49 findings total: **1 P1, 12 P2, 36 P3**. No REGRESSION against the 2026-07-12 remediation. Contract drift REFUTED (contracts/ byte-identical to codegen output).
- UI slop verdict: no emoji-icons, gradient abuse, glassmorphism, marketing microcopy, or card-grid filler on any inspected screen. The coral/paper token system holds in both themes. All UI findings are rendering/state defects, not template slop.

## Master table (severity-sorted)

| ID | Sev | One-line defect | Anchor |
|---|---|---|---|
| F-01 | P1 | In-flight chat stream never aborted on session switch/unmount; terminal events write A's reply into B's transcript | frontend/src/views/SessionView.vue:361-366 + stores/session.js:488-494 |
| B-01 | P2 | Ingestion holds daily_cost_ledger row lock across embedding network calls; same-user chat stream blocks at record_cost | backend/services/ingestion_service.py:158-218 |
| B-02 | P2 | /check/complete has no lock/claim; concurrent calls double-fire follow-up LLM turn, double-bill, duplicate messages | backend/routes/sessions.py:535-553 |
| F-02 | P2 | session store.reset() has zero callers; sign-out leaves prior account's sessions visible to next account | frontend/src/stores/session.js:595-609 + Sidebar.vue:113-117 |
| F-03 | P2 | Code-block "copy" button rendered with no click handler and no CSS â€” dead focusable control | frontend/src/lib/markdownRenderer.js:80 |
| F-04 | P2 | completeCheck can start while a chat stream is active, clobbering streamingMessage/abortController | frontend/src/stores/session.js:389-399 + SessionView.vue:84-91 |
| F-05 | P2 | One failed profile write replaces entire ProfileView with an error paragraph; never cleared, no recovery | frontend/src/views/ProfileView.vue:49-52,296-310 |
| F-06 | P2 | Library "Continue topic": no catch, no busy guard â€” unhandled rejection + double-click double-creates sessions | frontend/src/views/SessionsLibraryView.vue:12-15 |
| I-01 | P2 | RUNBOOK tells operator to set VITE_API_BASE_URL to bare Render URL without /api â€” documented Vercel deploy 404s | docs/deploy/RUNBOOK.md:47 vs apiClient.js:7 |
| I-02 | P2 | ErrorResponse contract says detail: string; all structured errors (409/429/413/400/415/507) send objects the FE depends on | docs/api/openapi.yaml:1464 vs backend/routes/chat.py:141 |
| U-01 | P2 | Empty assistant bubble rendered for content-less tutor messages (every "quiz me" turn) | AssistantBubble.vue:45 + MessageList.vue:15-18 |
| U-02 | P2 | Multi-second fully blank main pane when opening a session; no skeleton; view not mounted | SessionView.vue:15-46 (mechanism: route-level, see finding) |
| U-03 | P2 | Recap contradicts itself after reload: "Answer not recorded" on answered batches | CheckRecap.vue:50-54 + backend batch reconstruction |
| B-03 | P3 | Agent gap-add uses upsert_entry not add_exclusive; concept can sit in both confirmed_gaps and mastered_concepts | backend/services/profile_service.py:405-410 |
| B-04 | P3 | attach_message_id unlocked read-modify-write can revert a just-graded answer's batch state | backend/services/check_question_service.py:81-91 |
| B-05 | P3 | Duplicate-active-topic guard is check-then-insert, no DB unique index | backend/routes/sessions.py:150-183 |
| B-06 | P3 | PATCH /sessions topic rename skips the duplicate-topic check | backend/routes/sessions.py:432-452 |
| B-07 | P3 | Upload burns a rate-limit slot before ownership/type/size validation | backend/routes/upload.py:74-126 |
| B-08 | P3 | _prepare_turn exception rollback drops metered embedding spend | backend/routes/chat.py:258-262 |
| B-09 | P3 | Semantic-fallback turns embed the same query twice | backend/routes/chat.py:234-243 |
| B-10 | P3 | Default pool, no pre_ping; connection held across entire LLM stream â€” ~15-stream ceiling | backend/db/database.py:32 + agent/tutor.py:172-208 |
| B-11 | P3 | No index on sessions.user_id | backend/db/models.py:42 |
| B-12 | P3 | register() batch-open guard unlocked; concurrent streams silently overwrite a check batch | backend/services/check_question_service.py:143-173 |
| B-13 | P3 | merge_into_session lock-free read-modify-write; concurrent ingestions lose keyword stems | backend/lib/keyword_index.py:51-57 |
| F-07 | P3 | Shared store.error unmounts Home's mode cards, destroying typed topic | frontend/src/views/HomeView.vue:5-14 |
| F-08 | P3 | No focus management/announcement on route change | frontend/src/App.vue:58-73 |
| F-09 | P3 | role="menu" without arrow-key navigation or focus-on-open | frontend/src/components/sidebar/SidebarRowMenu.vue:82-88 |
| F-10 | P3 | White text on raw --signal-* fills fails AA (3.0-3.8:1); hardcoded hex; outline:none focus styles | SessionView.vue:687-704, NewSessionView.vue:521-550, ProfileView.vue:412 |
| F-11 | P3 | Onboarding submit / Settings save: no busy guard, no catch | OnboardingView.vue:76-83, SettingsView.vue:227-231 |
| F-12 | P3 | uploadDocument: no timeout, no 401 retry â€” hung upload locks attach forever | frontend/src/services/uploadApi.js:38-64 |
| F-13 | P3 | Superseded loadSession clears shared loading flags early â€” stale transcript flash | frontend/src/stores/session.js:114-177 |
| F-14 | P3 | bootstrap() rejection unhandled â€” auth.init() throw yields permanent blank page | frontend/src/main.js:22-46 |
| F-15 | P3 | Library search/pagination responses apply out of order | frontend/src/views/SessionsLibraryView.vue:29-49 |
| F-16 | P3 | _onAuthExpired pushes login without redirect query â€” deep link lost | frontend/src/services/apiClient.js:68-73 |
| F-17 | P3 | completeCheck clears pendingCheck before stream dispatch; pre-flight failure strands check UI | frontend/src/stores/session.js:393-394 |
| F-18 | P3 | aria-live wraps token-streaming bubble â€” SR announcement spam | frontend/src/components/chat/MessageList.vue:13 |
| F-19 | P3 | GapPickerDialog uses raw Aura Dialog chrome while sibling Dialog is restyled | frontend/src/components/GapPickerDialog.vue:2-9 |
| F-20 | P3 | Check-flow API failures double-surface; chat pre-stream errors bypass errorBus | SessionView.vue:58-78 + App.vue:41-47 |
| I-03 | P3 | X-Cost-Warning header read by FE but never set by backend | apiClient.js:123 vs backend/services/cost_meter.py |
| I-04 | P3 | nginx throttle 429 mislabeled "daily limit" and globally toast-suppressed | frontend/nginx.conf:35 + lib/errors.js:9 |
| I-05 | P3 | Reopen 409 duplicate_topic ignored by FE â€” generic dead end | stores/session.js:242 vs backend/routes/sessions.py:404 |
| I-06 | P3 | Committed vercel.json CSP holds literal https://CRUX_API_HOST placeholder | frontend/vercel.json:15 |
| I-07 | P3 | docker-compose.prod.yml never sets ENV=prod â€” prod guards inert on compose path | docker-compose.prod.yml:28 vs backend/config.py:82 |
| I-08 | P3 | x-sse-events omits check_question and followup_skipped shapes | docs/api/openapi.yaml:61,1477 |
| I-09 | P3 | Upload 415 CONTENT_TYPE_MISMATCH undocumented; FE drops the actionable message | backend/routes/upload.py:120 |
| I-10 | P3 | No FE enforcement of message maxLength 4000 â€” oversized send dies as generic 422 | openapi.yaml:984 vs composer |
| I-11 | P3 | Contract documents no 401/503 anywhere; profile PATCH 422 undocumented | docs/api/openapi.yaml:662 |
| U-04 | P3 | Runtime dependency on Google Fonts CDN (503 in live run silently dropped display typography) | frontend/index.html:8-10 |
| U-05 | P3 | Transient generic error toast on app load, unreproduced (confidence low) | source unidentified |

---


---

# Crux Backend â€” Final Adversarial Audit (read-only), 2026-07-18

Branch `dev` @ 0962982. All anchors are repo-relative `backend/...` paths with line numbers from current source. Prior review F-01..F-62 (docs/adversarial-review-2026-07-12.md) treated as fixed unless current source contradicts it; none of the findings below re-litigate a fixed F-id â€” they are residual or newly-identified defects.

No P1 (merge-blocking) findings. Two P2s should land before public launch.

---

## B-01
- **Severity:** P2
- **Verdict:** CONFIRMED
- **Defect:** Ingestion's single-transaction pipeline takes a row lock on the user's `daily_cost_ledger` row at the FIRST embedding batch and holds it across all subsequent embedding network calls, the chunk bulk-insert, and the keyword merge â€” any concurrent `record_cost` for the same user (chat stream, summary, follow-up) blocks indefinitely on that lock.
- **Anchor:** `backend/services/ingestion_service.py:158-162` (per-batch `meter_embedding_response` flushes into the pipeline transaction), `backend/services/ingestion_service.py:200-218` (single commit only at end of pipeline, per F-27), `backend/services/cost_meter.py:90-101` (`INSERT .. ON CONFLICT DO UPDATE` acquires the row lock at execute time, released only at commit/rollback), `backend/agent/tutor.py:266-269` (chat-stream `record_cost` â€” a lock wait is not an exception, so the try/except does not save it).
- **Trigger:** User uploads a >100-chunk document (multi-batch: `EMBED_BATCH = 100`, ingestion_service.py:57). While batches 2..N embed over the network (seconds to minutes for a 25 MB PDF), the same user sends a chat message. The tutor loop finishes its LLM stream and calls `record_cost` â€” the `ON CONFLICT DO UPDATE` on `(user_id, today)` blocks behind ingestion's uncommitted update. Postgres default `lock_timeout=0` â†’ waits until ingestion commits or fails.
- **Consequence:** The chat stream stalls silently after the text finishes streaming (no `done` event) for the remainder of the ingestion run; same for session-end summaries and check-complete follow-ups. Under an embedding-API slow/timeout path the stall is minutes. No deadlock (lock ordering is acyclic: chat never holds the session lock while waiting on the ledger), but user-visible hangs.
- **Confidence:** high
- **Minimal fix:** In `_embed_all`, stop calling `record_cost` per batch on the pipeline transaction. Accumulate cost in `cost_holder` (already exists) and record the total once immediately before the final `db.commit()` in `run()` â€” the failure arm already re-records from the holder, so the F-19 "spend survives rollback" property is preserved and the lock window shrinks to milliseconds.
- **Rejected alternatives:**
  - Metering on a separate short-lived session per batch: works but adds a second connection per ingestion and commits spend for work that may roll back (double-record risk with the failure-arm re-record logic).
  - `SET lock_timeout` on the chat path: converts a hang into a spurious metering failure; loses spend.

## B-02
- **Severity:** P2
- **Verdict:** CONFIRMED
- **Defect:** `POST /sessions/{id}/check/complete` has no lock and no claim step â€” two concurrent calls both read the resolved batch, both pass `is_done`, both clear it, both consume a rate-limit slot, and both fire a follow-up LLM turn.
- **Anchor:** `backend/routes/sessions.py:535-553` (`get_pending_check` â†’ `is_done` â†’ `write_check_batch`/`clear_pending_check`/`set_quiz_cooldown` â†’ `check_and_increment`, all unserialized; contrast `_claim_end` at sessions.py:334-346 which does exactly the conditional-UPDATE claim this path lacks).
- **Trigger:** Same resolved batch open in two tabs (or a double-fire from a client retry after a slow response); both POST `/check/complete` within the same window. Neither sees the other's `clear_pending_check` because neither takes `lock_session_row` and the clear is unconditional.
- **Consequence:** Two follow-up LLM turns billed to the ledger, two daily-cap slots consumed, two near-duplicate assistant messages persisted in the transcript (both via `run_streaming` with `suppress_check=True`).
- **Confidence:** high
- **Minimal fix:** Take `profile_service.lock_session_row(db, session_id)` before `get_pending_check` at sessions.py:535 and commit the clear+cooldown before starting the stream; the loser then reads `pc is None` and gets the existing 409 `no_resolved_batch`.
- **Rejected alternatives:**
  - Conditional UPDATE claim on `pending_check_json IS NOT NULL`: equivalent effect but a second mechanism alongside the existing F-24 lock convention used by `answer`/`skip`.
  - FE single-flight guard: covers one tab only; F-34/F-30 precedent is that the server check is authoritative.

## B-03
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** The agent-tool gap-add bypasses the exclusivity choke point: `apply_patch` inserts `add_confirmed_gap` via `upsert_entry`, not `add_exclusive`, so a concept can end up in `confirmed_gaps` AND `mastered_concepts` simultaneously â€” contradicting `add_exclusive`'s own contract ("single choke point for the exclusivity invariant, F-13") and the API contract text for the user path.
- **Anchor:** `backend/services/profile_service.py:405-410` (upsert_entry, no removal from mastered_concepts) vs. `backend/services/profile_service.py:224-250` (`add_exclusive` invariant docstring), `backend/services/profile_service.py:274-281` (user PATCH path uses `add_exclusive` for the same operation), `backend/contracts/models.py:506-514` (`ProfilePatchRequest` promises mutual exclusion). `backend/routes/chat.py:88-93` already works around the overlap when building the review pool â€” evidence the overlap is reachable.
- **Trigger:** Learner masters "chain rule" via a correct check answer (`mastered_concepts` gets it, evidence "tested"); later the agent calls `update_topic_profile(add_confirmed_gap="chain rule", evidence_type="inferred")` after observing confusion. Result: the concept is in both lists.
- **Consequence:** `aggregate_for_user` counts the concept in both `combined_mastered_concepts` and `combined_confirmed_gaps` (profile_service.py:590-600); the review queue's `evidence_map` and the ProfileView show contradictory state; deleting it from one list leaves it in the other.
- **Confidence:** high on mechanism; medium on intent (an argument exists that an agent-declared gap should not demote tested mastery â€” but then the invariant claim and the contract text are wrong, and no test pins either behavior).
- **Minimal fix:** Route the gap-add at profile_service.py:405-410 through `add_exclusive(profile, "confirmed_gaps", ...)` (matching the user PATCH path and `record_from_answer`), or â€” if non-demotion is the intended policy â€” document it in the `add_exclusive`/openapi text and add a dedupe on read.
- **Rejected alternatives:**
  - Dedupe only at render time (extend the chat.py:88-93 workaround everywhere): leaves persisted state self-contradictory and double-counted in aggregates.

## B-04
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `attach_message_id` is an unlocked read-modify-write of `pending_check_json`; if a learner answers item 0 in the window between the `check_question` SSE event and the post-persist attach, the attach re-saves the pre-answer batch state, reverting `current_index`/item status.
- **Anchor:** `backend/services/check_question_service.py:81-91` (no `lock_session_row`, whole-blob `_save`), `backend/agent/tutor.py:480-495` (`check_question` event yielded during the tool loop; `attach_message_id` runs only after `_persist_assistant_message`), while `answer()` at check_question_service.py:191-229 serializes only against other answer/skip callers.
- **Trigger:** Fast client (or scripted client) POSTs `/check/answer` index 0 immediately on receiving the `check_question` event, and the answer's locked commit lands between `attach_message_id`'s `get_pending_check` read and its `_save` commit.
- **Consequence:** The learner's grade appears to vanish from the live card (`current_index` reverts to 0); re-answering writes a second LearningEvent and re-applies profile effects for the same item (double `add_exclusive`, extra event row skewing gap_accuracy/review-queue streaks).
- **Confidence:** medium (window is sub-second; mechanism is real).
- **Minimal fix:** In `attach_message_id`, take `profile_service.lock_session_row(db, session_id)` before `get_pending_check`, and set only the `message_id` key on the freshly-read dict inside that locked span (already the behavior once the read is under the lock).
- **Rejected alternatives:**
  - JSON-path partial update (`jsonb_set`): not portable to the SQLite test dialect where `pending_check_json` is TEXT.

## B-05
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** The F-34 duplicate-active-topic guard is check-then-insert with no DB constraint, so two concurrent `POST /sessions` for the same topic both pass the SELECT and both insert active sessions.
- **Anchor:** `backend/routes/sessions.py:150-158` (pre-check) and `sessions.py:176-183` (insert+commit, no unique index); `backend/db/models.py:38-59` and migrations 0001-0020 contain no partial unique index on `(user_id, lower(topic)) WHERE ended_at IS NULL`.
- **Trigger:** Double-submit of the create form / two tabs creating "Calculus" within the same round-trip window.
- **Consequence:** Two active sessions on one topic â€” exactly the state F-34 declared unacceptable; the FE guard is documented as advisory and single-tab (sessions.py:100-101).
- **Confidence:** high
- **Minimal fix:** Migration adding `CREATE UNIQUE INDEX uq_sessions_active_topic ON sessions (user_id, lower(topic)) WHERE ended_at IS NULL` (Postgres partial index; SQLite supports partial indexes too), and map the IntegrityError to the existing 409 payload.
- **Rejected alternatives:**
  - `lock_session_row`-style serialization: there is no single row to lock for a not-yet-existing session; would need an advisory lock keyed on (user, topic) â€” more machinery than the index.

## B-06
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `PATCH /sessions/{id}` topic rename skips the duplicate-active-topic check that `create_session` and `reopen_session` both enforce, so a rename reproduces the duplicate state through the front door.
- **Anchor:** `backend/routes/sessions.py:432-452` (`update_session` writes `row.topic` with no `_active_session_on_topic` call) vs. `sessions.py:150-158` (create enforces) and `sessions.py:398-406` (reopen enforces).
- **Trigger:** Two active sessions, topics "A" and "B"; PATCH session B with `{"topic": "A"}` â†’ 200.
- **Consequence:** Two active sessions with casefold-equal topics; the continue-topic/resume flows and the F-34 conflict payload (`duplicate_topic` + session_id) now have an ambiguous target.
- **Confidence:** high
- **Minimal fix:** In `update_session`, when `req.topic is not None` and `row.ended_at is None`, run `_active_session_on_topic(db, user_id, req.topic, exclude_id=row.id)` and 409 on a hit (same payload as create).
- **Rejected alternatives:**
  - Rely on the B-05 unique index alone: correct but returns a raw 500/IntegrityError without the structured `duplicate_topic` detail unless mapped anyway.

## B-07
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `POST /upload` consumes a daily rate-limit slot before ANY validation â€” foreign/unknown session (404), bad extension (400), oversize (413), magic-byte mismatch (415), and storage failure (507) all burn a slot â€” the exact ordering `_prepare_turn` was restructured to avoid; additionally `check_and_increment` inserts a `usage_counters` row whose FK references a `users` row that no code on this route creates.
- **Anchor:** `backend/routes/upload.py:74-84` (increment first), `upload.py:97-126` (validations after), vs. `backend/routes/chat.py:151-165` (documented guard order: session guard before rate limit "so a rejected turn ... nor consumes a daily slot"); FK: `backend/db/models.py:93` (`usage_counters.user_id â†’ users.id`) with no `ensure_user` anywhere in upload.py.
- **Trigger:** (a) A user at 45/50 uploads five files with a wrong extension â†’ all 400, all five slots gone. (b) A brand-new authenticated user whose first-ever backend call is `POST /upload` (direct API; no prior `/me`, `/sessions`) â†’ Postgres FK violation inside `check_and_increment` â†’ 500 instead of 404. (SQLite dev masks (b): FKs unenforced by default.)
- **Consequence:** Self-DoS on honest mistakes; 500 with a half-open transaction on the fresh-user path.
- **Confidence:** high for slot-burn; medium for the FK 500 (requires a user with zero prior ensure_user-routed calls, who therefore cannot own the session â€” so it always co-occurs with a would-be 404).
- **Minimal fix:** Reorder: extension check â†’ session ownership 404 â†’ `check_and_increment` â†’ size/magic/write. (ensure_user not needed once ownership precedes the increment: owning a session implies the users row exists.)
- **Rejected alternatives:**
  - Refund the slot on validation failure: decrement-after-error paths leak on crashes; ordering is strictly simpler.

## B-08
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `_prepare_turn`'s exception arm rolls back the transaction that carries the metered embedding spend from `semantic_fallback_required`/`prefetch_for_prompt` and re-records nothing â€” real vendor spend silently dropped from the capped ledger (the F-19 class of bug, fixed in the tutor error arm and in ingestion, missed here).
- **Anchor:** `backend/routes/chat.py:258-262` (`db.rollback()` then persist-user-message, no cost re-record) vs. metering flushed at `backend/services/retrieval_service.py:190-192` and `:134-136` into that same session; contrast `backend/agent/tutor.py:562-579` (error arm re-estimates after rollback) and `backend/services/ingestion_service.py:233-242` (re-record after rollback).
- **Trigger:** Prompt build raises after the semantic-fallback embedding succeeded and metered (e.g. transient DB error loading history, or `build_system_prompt` failure on a malformed state).
- **Consequence:** Ledger undercounts by one-to-two query embeddings (~$0.0001-0.0005 per occurrence). Principle violation, negligible dollars.
- **Confidence:** high on mechanism, magnitude trivially small.
- **Minimal fix:** Track metered embedding cost in a holder (same pattern as ingestion's `cost_holder`) and re-`record_cost` it in the except arm after the rollback, before the user-message commit.
- **Rejected alternatives:**
  - Commit immediately after each meter call in `_prepare_turn`: adds a commit to the happy path the P3.1 statement-budget work deliberately minimized.

## B-09
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** When the lexical gate misses and the semantic fallback fires, the SAME query string is embedded twice in one turn â€” `semantic_fallback_required` embeds it and discards the vector, then `prefetch_for_prompt` embeds it again.
- **Anchor:** `backend/routes/chat.py:234-243` (sequential calls), `backend/services/retrieval_service.py:178-183` (first embed, vector used only for centroid similarity then dropped) and `:123-128` (second embed of the identical `query`).
- **Trigger:** Any chat message that fails `keyword_index.match_required` but clears `retrieval_fallback_threshold` â€” i.e. every paraphrase/acronym turn the D2.2 feature exists for.
- **Consequence:** 2x embedding cost and one extra network round-trip (~embedding_timeout budget) added to time-to-first-token on exactly the turns already paying the fallback latency.
- **Trigger frequency makes this a perf/cost paper cut, not correctness.**
- **Confidence:** high
- **Minimal fix:** Have `semantic_fallback_required` return `(required, query_vec)` (or accept an out-param) and thread the vector into `prefetch_for_prompt`, skipping its embed when supplied.
- **Rejected alternatives:**
  - In-process embedding cache keyed on query text: broader machinery; the two calls are adjacent in one function â€” parameter threading is the whole fix.

## B-10
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** The engine uses default pool sizing with no `pool_pre_ping`/`pool_recycle`, while the tutor loop opens a transaction (the loop-top `check_cap` SELECT) and holds it â€” and therefore a checked-out pooled connection, and on the Supabase transaction-mode pooler a pinned backend â€” across the entire streamed LLM call.
- **Anchor:** `backend/db/database.py:32` (`create_engine(_db_url, **_engine_kwargs)` â€” only `connect_args`, so pool_size=5/max_overflow=10/no pre-ping), `backend/agent/tutor.py:172-208` (`check_cap` SELECT opens the transaction, then `await litellm.acompletion(..., stream=True)` for the full stream duration before the next commit at persist/tool-dispatch).
- **Trigger:** 16 concurrent chat streams (each turn 10-60 s): the 16th request waits `pool_timeout` 30 s then raises `TimeoutError` â†’ 500. Separately, an idle overnight backend on the pooler serves its first request on a dead cached connection with no pre-ping.
- **Consequence:** Hard concurrency ceiling of ~15 in-flight LLM turns per process regardless of CPU; sporadic `OperationalError` after idle periods.
- **Confidence:** high on the mechanism; the ceiling number is the SQLAlchemy default (5+10).
- **Minimal fix:** `create_engine(..., pool_pre_ping=True, pool_size=<n>, max_overflow=<m>)` sized to the Render instance + Supabase pooler limits; longer-term, end the transaction (commit/rollback) before each `acompletion` await so the connection returns to the pool during streaming.
- **Rejected alternatives:**
  - Async SQLAlchemy migration: correct end-state, far beyond a minimal diff.

## B-11
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** No index on `sessions.user_id`: every session list, library page, aggregate profile, and duplicate-topic check scans the whole sessions table.
- **Anchor:** `backend/db/models.py:42` (plain FK, no `index=True`), migration sweep confirms only chat_messages/learning_events/chunk_embeddings/llm_call_log indexes exist (`backend/db/alembic/versions/0008_session_perf_indexes.py:24-34` and grep of all versions). Consumers: `backend/routes/sessions.py:193-197`, `:267`, `backend/services/profile_service.py:569-573`, `backend/routes/sessions.py:102-113`.
- **Trigger:** Any `GET /api/sessions` once the table holds many users' rows.
- **Consequence:** Seq scan per request; grows linearly with total (not per-user) session count. Invisible at demo scale, first thing to fall over post-launch.
- **Confidence:** high
- **Minimal fix:** Migration: `op.create_index("ix_sessions_user_id", "sessions", ["user_id"])`. (Subsumed by B-05's partial unique index only for the active-topic query; the list queries still want the plain index.)
- **Rejected alternatives:** none worth listing.

## B-12
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `register()`'s "a batch is already open" guard is an unlocked read: two concurrent tutor streams on the same session can both observe `pending_check is None` and both `_save`, the second silently overwriting the first batch.
- **Anchor:** `backend/services/check_question_service.py:143-147` (unlocked `get_pending_check` check) and `:154-173` (whole-blob `_save`); no `lock_session_row` anywhere in `register`, unlike `answer`/`skip` (:199, :245).
- **Trigger:** Two tabs send chat messages on the same session; both turns independently decide to quiz; both `ask_check_questions` dispatches interleave.
- **Consequence:** First batch's card renders in tab A but its state row is gone â€” every answer 409s (`out-of-order` vs the surviving batch's items) or grades against the wrong batch's `correct_index` if item texts coincide. Self-corrects on reload; no cross-user impact.
- **Confidence:** medium (requires concurrent streams on one session, which the FE discourages but the API permits).
- **Minimal fix:** `profile_service.lock_session_row(db, ctx.session_id)` at the top of `register()` before the `get_pending_check` guard.
- **Rejected alternatives:**
  - Conditional UPDATE (`WHERE pending_check_json IS NULL`): fine too, but the lock matches the F-24 convention already used two functions down.

## B-13
- **Severity:** P3
- **Verdict:** CONFIRMED
- **Defect:** `merge_into_session` is a read-modify-write of `sessions.kw_index_json` performed inside ingestion's long single transaction with no row lock â€” two documents ingesting concurrently for one session lose one document's stems (last committer wins with a stale base set).
- **Anchor:** `backend/lib/keyword_index.py:51-57` (read `row.kw_index_json`, union in Python, write back; no lock, no commit), called from `backend/services/ingestion_service.py:210-214` whose transaction spans the whole pipeline (commit at :218) â€” the read can be minutes stale by commit time.
- **Trigger:** User uploads two PDFs back-to-back; FastAPI BackgroundTasks runs both `ingestion_service.run` calls concurrently in the threadpool; doc A's merge reads the index before doc B's commit and commits after it.
- **Consequence:** `keyword_index.match_required` permanently misses doc B's vocabulary â†’ `retrieval_required` stays False for questions phrased in doc B's terms; only the D2.2 semantic fallback can rescue those turns. No error surfaces anywhere.
- **Confidence:** high
- **Minimal fix:** In `merge_into_session`, fetch the row `with_for_update=True` (no-op on SQLite, serializes on Postgres); the lock is taken at the END of the pipeline so the hold time is only the final flush+commit.
- **Rejected alternatives:**
  - Store stems in a child table with INSERT ON CONFLICT DO NOTHING per stem: schema change disproportionate to the defect.

---

## Appendix A â€” Notable BY-DESIGN items (verified against source, not defects)

- **Concurrent cap-check pass-through:** Two simultaneous requests can both pass `check_cap` before either records cost (`backend/routes/chat.py:134-149`, `backend/agent/tutor.py:173`). Meter-after with no reservations is owner decision Q3 (memory: adversarial review decisions 2026-07-13); overrun is bounded by one iteration per in-flight stream.
- **Error-arm whole-turn re-estimate overcounts:** `backend/agent/tutor.py:566-579` re-bills all snapshots after rollback even when mid-turn tool commits already published earlier ledger increments â€” documented deferred F-03 decision, conservative in the cap's favor.
- **`/chat/stream` network-retry double-apply:** A client retry after a started stream duplicates the user message and a full LLM turn (`backend/routes/chat.py:267-269`). Inherent to POST-SSE; all other mutating endpoints were verified idempotent-or-409 (end: replay path sessions.py:361-370; answer/skip: index guard â†’ 409; complete: 409 `no_resolved_batch`; profile writes: If-Match; upload: creates a second document row â€” plain duplicate, no corruption).
- **`services/pending_check_store.py` leaf module:** deliberate cycle-breaker, per audit brief.
- **Auth/ownership coverage:** every endpoint verified. chat.py:164 (session 404 before any side effect), sessions.py all routes check `row.user_id != user_id` before effects, profile.py:35-37/:90/:118/:162, upload.py:107-109 and :175-180 (status route checks via parent session), documents_service.py:95-104 (ownership inside the service, before deletes), review.py:27-29 (JOIN-scoped), usage/me/aggregate user-scoped by dependency. No endpoint takes user_id from the body. The only ordering wart is B-07's rate-limit-before-404 (slot consumption, not data exposure).
- **Anti-cheat:** `public_view` withholds `correct_index`/`explanation` for pending items (check_question_service.py:56-78); the system prompt carries only gap/answered/total (prompts.py:225-234). Verified no leak path.
- **Contracts:** `backend/contracts/models.py` header is codegen-authentic; no hand-edit evidence (uniform generated style, matching `scripts/gen_contracts.py` flags). Handler behavior matches contract shapes for all response models read; known codegen gaps (minProperties, cross-field rules) are re-enforced in routes (me.py:44-52, profile.py:91-98, check_question_service.py:129-142) as documented in the schema descriptions.
- **Stale comment, not code:** `backend/routes/sessions.py:317` references a "non-streaming run() path" that no longer exists (`agent/` has only `run_streaming`); harmless doc rot.
- **Baseline test count:** 760 `def test_` functions counted across `backend/tests` (claimed 790 green refers to collected items incl. parametrization; not verified â€” tests not run, per read-only mandate).

## Appendix B â€” Files read (all under C:\Users\EDWARD\Documents\Project_Apt\backend\)

main.py, config.py, db/database.py, db/models.py, db/alembic/versions/0008_session_perf_indexes.py (+ grep sweep of all 20 versions), services/auth.py, services/user_service.py, services/rate_limit.py, services/cost_meter.py, services/usage_service.py, services/sql_dialect.py, services/profile_service.py, services/check_question_service.py, services/pending_check_store.py, services/learning_event_service.py, services/diagnostic_service.py, services/summary_service.py, services/session_enrichment.py, services/review_queue_service.py, services/retrieval_service.py, services/pgvector_store.py, services/object_store.py, services/documents_service.py, services/ingestion_service.py, routes/chat.py, routes/sessions.py, routes/profile.py, routes/me.py, routes/review.py, routes/usage.py, routes/documents.py, routes/upload.py, routes/health.py, agent/tutor.py, agent/tools.py, agent/prompts.py, agent/types.py, agent/stream_events.py, agent/excerpt.py, agent/context_budget.py, agent/_stub.py, lib/chunking.py, lib/keyword_index.py, lib/terms.py, lib/error_codes.py, contracts/models.py, contracts/__init__.py (via gen template), scripts/gen_contracts.py. Targeted greps over backend/tests (exclusivity assertions, test counts).


---

# Crux Frontend â€” Final Adversarial Audit (code-level)

Date: 2026-07-18. Branch: dev (clean). Read-only audit of `frontend/src/`.
Baseline verified: `npm run test:unit -- --run` â†’ 67 files / 643 tests passed (claim confirmed). Tests green does not clear the findings below â€” none of these paths have failing coverage.

Prior review docs/adversarial-review-2026-07-12.md (F-01..F-62) treated as fixed; nothing below re-litigates a fixed finding. IDs below are this audit's own numbering.

---

## P1

### F-01 â€” In-flight chat stream is never aborted on session switch or unmount; its terminal events write into whatever session is now loaded
- Severity: P1
- Verdict: CONFIRMED
- Defect: `SessionView` re-loads on `props.id` change and unmounts without calling `store.stopStream()`, and none of the stream sinks (`appendAssistantDelta`, `finalizeMessage`, `handleCancelled`, `handleAbortError`) carry a session discriminator, so a stream started in session A keeps mutating `streamingMessage`/`messages` after the store has been repointed at session B.
- Anchor: `frontend/src/views/SessionView.vue:361-366` (id watch â†’ `loadCurrent`, no abort), `frontend/src/views/SessionView.vue:290-298` (onUnmounted hooks â€” none abort), `frontend/src/stores/session.js:488-494` (`finalizeMessage` pushes into `messages` unconditionally), `frontend/src/stores/session.js:466-469` (`appendAssistantDelta` appends to whatever `streamingMessage` is current).
- Trigger: Send a message in session A; while the tutor is streaming, click session B in the sidebar (same route component, `props.id` watch fires). `loadSession(B)` replaces `messages` with B's history; the A-stream continues â€” its deltas render inside B's view, and on `done` `finalizeMessage` pushes A's assistant reply (A's citations, A's check_batch events via `handleCheckQuestion` too) into B's `messages` array. `check_question` from A would even open a check card over B (`pendingCheck` has no session id).
- Consequence: Cross-session transcript contamination visible on screen (wrong-tutor-reply under the wrong topic), phantom check-question cards, and a `stopStream` button that (correctly) aborts the still-running old stream only while it also blocks composing in B (`streamState` stays `streaming`). State self-heals only on reload.
- Confidence: high
- Minimal fix: in `loadCurrent(id)` (before `store.loadSession`) and in `onUnmounted`, call `store.stopStream()`; additionally capture `const sid = currentSessionId.value` at stream start in `sendMessageStreaming`/`completeCheck` and no-op the event sink when `currentSessionId.value !== sid`.
- Rejected alternatives:
  - Only aborting on unmount: does not cover the sidebar same-route switch, which is the common path.
  - Keying `messages` per session id in the store: correct long-term but a much larger refactor than the send-side guard.

---

## P2

### F-02 â€” Session store is never reset on sign-out; a second account on the same tab can see the first account's session list
- Severity: P2
- Verdict: CONFIRMED
- Defect: `useSessionStore().reset()` exists but has zero production callers (grep: only the store definition and a unit test); `auth.signOut()` clears only the user store, so `sessions`, `currentSession`, `messages`, `pendingCheck`, `pendingSummary` survive an account switch â€” and `Sidebar`'s mount guard *skips* refetching precisely because stale `sessions` is non-empty.
- Anchor: `frontend/src/stores/session.js:595-609` (`reset` defined), `frontend/src/stores/auth.js:88-96` (`signOut` â€” no session-store touch), `frontend/src/components/sidebar/Sidebar.vue:113-117` (`if (isAuthenticated && !sessions.value.length)` skip-fetch).
- Trigger: User A signs out (Settings â†’ Sign out). User B signs in on the same tab and deep-links or navigates to `/settings` or `/profile` (any shell route that doesn't itself call `listSessions`). Sidebar mounts, sees `sessions.length > 0` (A's rows), skips the fetch, and renders A's topics/metadata to B until something else refetches.
- Consequence: Cross-account information disclosure in a shared-browser scenario (topics, activity, focus-gap chips of the previous user); also stale `currentSession`/`messages` can flash before `loadSession` resolves if B opens a session route.
- Confidence: high
- Minimal fix: in `stores/user.js` `setActiveUser` (or in `auth.signOut` + the `onAuthStateChange` handler), call `useSessionStore().reset()` whenever the uid actually changes.
- Rejected alternatives:
  - Making Sidebar always refetch on mount: hides the symptom, leaves `currentSession`/`messages`/`pendingSummary` leaking through other views.
  - Full page reload on sign-out: heavier UX change than a one-line store reset.

### F-03 â€” Code-block "copy" button is rendered but wired to nothing and styled by nothing
- Severity: P2
- Verdict: CONFIRMED
- Defect: The markdown fence renderer emits `<button type="button" class="code-block-copy" data-copy-button>copy</button>`, but no component or global script attaches a click handler to `[data-copy-button]`, and no stylesheet defines `.code-block-copy`/`.code-block-header` (grep across `src/` matches only the renderer and a test asserting the attribute exists).
- Anchor: `frontend/src/lib/markdownRenderer.js:76-84` (markup emitted), `frontend/src/__tests__/codeBlockChrome.test.js:9` (only other reference).
- Trigger: Ask the tutor for any code; a fenced block renders. Click (or Tab to and press Enter on) the "copy" button.
- Consequence: A keyboard-focusable, screen-reader-announced control that does nothing on activation â€” worse than no button (WCAG operability + plain UX). It is also an unstyled native button inside `<pre>` (a `<div>` inside `<pre>` besides), so it renders as browser-default chrome clashing with the design system.
- Confidence: high
- Minimal fix: add a delegated click listener in `MarkdownContent.vue` (`onMounted` on the `.markdown-content` root: if `e.target.closest('[data-copy-button]')`, `navigator.clipboard.writeText(pre.querySelector('code').innerText)` + transient "copied" label) and add `.code-block-header`/`.code-block-copy` rules next to the existing `:deep(pre)` styles.
- Rejected alternatives:
  - Removing the button: loses intended feature and breaks `codeBlockChrome.test.js` expectations.
  - Per-render inline `onclick`: stripped by DOMPurify; delegation is the only sane path with `v-html`.

### F-04 â€” `completeCheck` can start while a chat stream is active, clobbering `streamingMessage`/`abortController` and interleaving two live streams
- Severity: P2
- Verdict: CONFIRMED
- Defect: The check card is rendered whenever `pendingCheck` is set, independent of `streamState`, and `completeCheck` guards only against itself (`checkCompleting`) â€” not against `streamState !== 'idle'` â€” before overwriting `streamingMessage` and `abortController`; the first stream's still-arriving deltas then append into the second stream's message via the shared `appendAssistantDelta`.
- Anchor: `frontend/src/stores/session.js:389-399` (`completeCheck` overwrites `streamingMessage`/`abortController`, only `checkCompleting` guard), `frontend/src/views/SessionView.vue:84-91` (`CheckQuestion` gated only on `pendingCheck && !detailLoading`), `frontend/src/components/chat/CheckQuestion.vue:77-85` (Done button never disabled by stream state).
- Trigger: Answer all questions of a batch but don't click Done; type a message (allowed by design â€” `checkLocked` is hardwired false, `stores/session.js:313`); while the tutor's reply is streaming, click Done on the check card.
- Consequence: Two concurrent SSE streams write into one `streamingMessage` (garbled interleaved text); `abortController` now points at the follow-up stream only, so Stop cannot cancel the first; the first stream's `done` finalizes a message containing mixed content.
- Confidence: high (mechanism); medium (frequency â€” needs the specific click combo)
- Minimal fix: in `completeCheck` (and defensively `sendMessageStreaming`), early-return or await when `streamState.value !== 'idle'`; simplest: disable the Done/Next/Skip buttons in `SessionView` while `store.streamState !== 'idle'`.
- Rejected alternatives:
  - Re-locking the composer during open checks: reverses a deliberate spec decision (typing mid-batch allowed).
  - Queueing streams in the store: correct but over-engineered vs a one-line guard.

### F-05 â€” One failed profile write permanently replaces the whole ProfileView with an error paragraph (error never cleared)
- Severity: P2
- Verdict: CONFIRMED
- Defect: `_applyWrite`'s non-412 catch sets `error.value`, and the template chain is `loading â†’ error â†’ data`, so setting `error` unmounts the entire loaded profile UI; `_applyWrite` resets `conflict` on entry but never resets `error`, and with the UI gone there is no control left to trigger another write or reload â€” the view is dead until route change.
- Anchor: `frontend/src/views/ProfileView.vue:49-52` (`v-else-if="error"` supplants the `v-else-if="data"` branch), `frontend/src/views/ProfileView.vue:296-310` (`_applyWrite` â€” `conflict.value = false` but no `error.value = ''`; catch sets `error.value`).
- Trigger: Open a session profile (loads fine). Add a chip / click a level button while the network blips or the backend 500s once.
- Consequence: All loaded profile data (already in `data.value`) disappears behind "Something went wrongâ€¦" with no retry affordance; user must navigate away and back. A transient failure is rendered as a fatal one.
- Confidence: high
- Minimal fix: give write failures their own ref (e.g. `writeError`) rendered as an inline banner above the content instead of reusing the load-path `error`, and clear it at `_applyWrite` entry.
- Rejected alternatives:
  - Just clearing `error` on write entry: still hides the whole profile for the duration of every failure, and the failure itself still nukes the view.
  - Auto-`load()` on any write error: extra request and still loses the inline-error UX; 412 already does this deliberately.

### F-06 â€” Library "Continue topic" has no error handling and no busy guard: unhandled rejection + double-click creates two sessions
- Severity: P2
- Verdict: CONFIRMED
- Defect: `SessionsLibraryView.continueSession` awaits `store.continueTopic(s)` â€” which rethrows after `_setError` â€” with no try/catch and no in-flight guard, so a failure escapes as an unhandled rejection and a double-click issues two `POST /sessions` resume-creates (the exact F-45 bug class fixed in HomeView, absent here); `SidebarSessionRow.onContinueTopic` has the busy guard but try/finally without catch, so its failures also escape unhandled.
- Anchor: `frontend/src/views/SessionsLibraryView.vue:12-15` (no catch, no guard), `frontend/src/components/sidebar/SidebarSessionRow.vue:90-100` (try/finally, no catch). Contrast: `frontend/src/views/HomeView.vue:121-142` (correct pattern, F-45 comment).
- Trigger: Library â†’ ended card â†’ double-click "Continue topic" (or single click while backend errors).
- Consequence: Two resume sessions created for the same prior session (backend auto-ends the prior on each create; second create races the first), user lands in one and an orphan active duplicate remains; on failure, unhandled promise rejection and no navigation with only the errorBus toast as accidental feedback.
- Confidence: high
- Minimal fix: mirror HomeView's `startReview`: a `busy` ref checked/set around the call, try/catch (swallow â€” store.error and errorBus already surface), `:disabled="busy"` on the button; add `catch {}` to `SidebarSessionRow.onContinueTopic`.
- Rejected alternatives:
  - Server-side idempotency for resume-create: right defense-in-depth, but out of frontend scope and doesn't fix the unhandled rejection.
  - Global `onunhandledrejection` handler: hides symptoms, no double-create fix.

---

## P3

### F-07 â€” Any shared-store error (e.g. sidebar rename failure) replaces the entire Home screen, hiding the primary CTA
- Severity: P3
- Verdict: CONFIRMED
- Defect: HomeView renders `store.error` in a `v-if/else-if/else` chain that unmounts both mode cards, and `store.error` is a single global written by every session-store action (rename, pin, end, listâ€¦), not just Home's own load.
- Anchor: `frontend/src/views/HomeView.vue:5-14` (template chain), `frontend/src/stores/session.js:63-66` (`_setError` shared).
- Trigger: On Home, use the sidebar row menu to rename a session while offline â†’ `renameSession` catch calls `_setError` â†’ Home content (topic input mid-typing included) is replaced by the error paragraph.
- Consequence: Primary "start learning" affordance disappears because an unrelated background action failed; typed topic text is destroyed (input unmounted).
- Confidence: high
- Minimal fix: scope the fatal branch to Home's own load (`v-else-if="store.error && !store.sessions.length"`) or render the error as a banner above the cards instead of replacing them.
- Rejected alternatives:
  - Per-action error fields in the store: better architecture, larger change than the template guard.

### F-08 â€” No focus management or announcement on route change
- Severity: P3
- Verdict: CONFIRMED
- Defect: Route transitions swap the view inside a `<transition>` with no `router.afterEach` focus reset, no focus target on the new view, and no live-region announcement; keyboard/SR focus stays on the removed element and drops to `<body>`.
- Anchor: `frontend/src/App.vue:58-73` (RouterView, no focus handling), `frontend/src/router/index.js:91-124` (guard only, no afterEach).
- Trigger: Keyboard user activates a sidebar row or "Back to home"; new view renders; press Tab.
- Consequence: Focus restarts from the top of the document on every navigation; SR users get no indication the page changed (WCAG 2.4.3 / SPA navigation basics). The skip-link mitigates but only after the user re-orients.
- Confidence: high
- Minimal fix: `router.afterEach` that focuses `#main-content` (`tabindex="-1"` on it) on push navigations.
- Rejected alternatives:
  - Announcing via aria-live only: fixes SR but not keyboard focus position.

### F-09 â€” Sidebar row menu uses `role="menu"`/`role="menuitem"` without any arrow-key navigation
- Severity: P3
- Verdict: CONFIRMED
- Defect: The popover declares menu semantics (SRs then advertise arrow-key operation) but implements only Tab/Escape; ArrowUp/ArrowDown/Home/End do nothing.
- Anchor: `frontend/src/components/sidebar/SidebarRowMenu.vue:82-88` (`role="menu"`), `:47-54` (`onKey` handles only Escape).
- Trigger: Open a session row's "â€¦" menu with keyboard; press ArrowDown.
- Consequence: AT users are told it's a menu but the promised keyboard model is absent (ARIA APG menu pattern violation); focus also isn't moved into the popover on open.
- Confidence: high
- Minimal fix: either drop `role="menu"`/`menuitem` (plain buttons in a labelled group â€” honest semantics), or add roving arrow-key handling + initial focus.
- Rejected alternatives:
  - Full APG menu implementation: fine, but the role-removal fix is 2 lines and equally conformant.

### F-10 â€” Contrast/token violations: white text on raw `--signal-*` fills, hardcoded colors bypassing tokens, and `outline: none` focus styles
- Severity: P3
- Verdict: CONFIRMED
- Defect: base.css explicitly reserves the raw signal ramp for fills/borders and mandates the darkened `--color-*-text` variants for text (`frontend/src/assets/base.css:120-127`), yet several controls put white text on raw signal fills: `.error-retry` white on `--signal-error` #EF4444 â‰ˆ 3.76:1 (`frontend/src/views/SessionView.vue:687-689`), `.warn-action` and `.open-existing` white on `--signal-info` #5B8DEF â‰ˆ 3.0:1 (`frontend/src/views/NewSessionView.vue:521-522, 549-550`) â€” all below AA 4.5:1 at their sizes. Hardcoded off-token colors: `#2E5DC4`/`#7AA3F5` level-pill (`frontend/src/views/ProfileView.vue:412, 416`), `#dc2626`/`#b91c1c` confirm button (`frontend/src/assets/base.css:324-331`, commented as deliberate), `#c44` ToolCallChip fallback (`frontend/src/components/chat/ToolCallChip.vue:40`). Focus indicators suppressed to non-outline cues only: `frontend/src/views/SessionView.vue:699-704` (`.error-retry:focus-visible { outline: none }` â€” brightness/translate only) and `:802-806` (`.home-link` color-change only), `frontend/src/components/BackButton.vue:62-67`, `frontend/src/assets/main.css:32-38` (`.profile-link`).
- Trigger: Render any of these controls; measure contrast / Tab to them.
- Consequence: AA text-contrast failures on error/info CTAs; focus visibility that fails WCAG 2.4.7 for low-vision users (a slight brightness shift is not a visible indicator); theme drift where hardcoded hex ignores dark-mode token remaps.
- Confidence: high (ratios computed from the token hex values in base.css)
- Minimal fix: swap the three white-on-signal fills to `--color-accent-strong`-style darkened fills (or the `--color-*-text` colors as fills with white per the base.css recipe); replace `outline: none` focus rules with the standard `outline: 2px solid var(--color-accent-ring)`; tokenize `#2E5DC4` as an info-text variant.
- Rejected alternatives:
  - Declaring the buttons "large text" exempt: they are 13-15px/600 â€” below the 18.66px-bold threshold.

### F-11 â€” Onboarding submit and Settings save have no busy guard and no error handling
- Severity: P3
- Verdict: CONFIRMED
- Defect: `OnboardingView.submit` awaits `completeOnboarding` (PATCH `/me`) with no try/catch and the button stays enabled during flight; `SettingsView.save` likewise (`dirty` stays true mid-flight). Failure â†’ unhandled rejection (only the errorBus toast surfaces, by accident); double-click â†’ duplicate PATCHes.
- Anchor: `frontend/src/views/OnboardingView.vue:76-83`, `frontend/src/views/SettingsView.vue:227-231`; store paths `frontend/src/stores/user.js:94-106, 115-128` (throw before local mutation â€” good â€” but caller ignores).
- Trigger: Click "Begin" on onboarding while the API is down; or double-click either submit fast.
- Consequence: Onboarding user stuck with no inline feedback (router.push never fires, form doesn't change); duplicate idempotent-ish PATCHes (harmless data-wise, but the second can out-of-order the first on flaky links).
- Confidence: high
- Minimal fix: add `submitting` refs (disable buttons) and try/catch with an inline error line, mirroring LoginView's pattern.
- Rejected alternatives:
  - Relying on the errorBus toast: it fires, but the unhandled rejection remains and there's no busy guard.

### F-12 â€” `uploadDocument` has no timeout and no 401 refresh-retry
- Severity: P3
- Verdict: CONFIRMED
- Defect: The multipart upload path uses raw `fetch` with no `AbortSignal.timeout` (unlike `request()`'s F-06-mandated 30s cap) and no F-09-style 401 retry/`_onAuthExpired` handling.
- Anchor: `frontend/src/services/uploadApi.js:38-64`; caller lock `frontend/src/views/SessionView.vue:444-466` (`uploading` true until the promise settles).
- Trigger: Upload a PDF while the backend hangs (accepts connection, never responds) â€” or with a token the server rejects.
- Consequence: `uploading` stays true forever â†’ attach button disabled for the rest of the session view's life with a perpetual "Uploading X..." status; a 401 surfaces as a generic "Upload failed" instead of the refresh-retry every other call gets.
- Confidence: high
- Minimal fix: pass `signal: AbortSignal.timeout(120000)` (uploads need longer than 30s) and on 401 re-fetch once with `_refreshAccessToken()`.
- Rejected alternatives:
  - Reusing `request()`: it JSON-encodes bodies; would need a FormData branch â€” the two-line signal+retry patch is smaller.

### F-13 â€” `loadSession`'s shared `loading`/`detailLoading` flags let a superseded load hide the skeleton while the real load is still in flight
- Severity: P3
- Verdict: CONFIRMED
- Defect: The `_latestRequestedId` discriminator protects the data write, but each in-flight promise's `finally` unconditionally clears the shared `loading`/`detailLoading` flags, so the *first* (superseded) load to settle turns the skeleton off for the still-loading target session.
- Anchor: `frontend/src/stores/session.js:114-177` (flags set at :115-116, cleared at :170-173 regardless of discriminator).
- Trigger: Rapidly click session B then session C in the sidebar while on A. B settles first (write dropped) â†’ `detailLoading=false` â†’ `SessionView` (`frontend/src/views/SessionView.vue:38`) drops `MessageListSkeleton` and renders `store.messages` â€” still session A's transcript â€” under C's header until C resolves.
- Consequence: Transient wrong-transcript flash under the new session's optimistic header; on slow links it can persist seconds.
- Confidence: high
- Minimal fix: in the `finally`, only clear the flags when `_latestRequestedId === id` (mirror the write guard).
- Rejected alternatives:
  - Per-id loading map: cleaner but larger; the guard matches the existing pattern.

### F-14 â€” `bootstrap()` rejection is unhandled: a throw in `auth.init()` yields a permanently blank page
- Severity: P3
- Verdict: CONFIRMED
- Defect: `bootstrap()` is called fire-and-forget; if `useAuthStore().init()` rejects (Supabase SDK throw â€” e.g. malformed persisted session, storage access error), `app.mount` never runs and nothing is rendered or reported.
- Anchor: `frontend/src/main.js:22-46` (`await useAuthStore().init()` at :30, bare `bootstrap()` at :46).
- Trigger: `getSession()` rejects at boot (corrupt localStorage session entry, storage disabled).
- Consequence: White screen, no console-visible remediation for the user, no fallback to the login route.
- Confidence: medium (requires an SDK rejection; `getSupabase` itself never throws thanks to the placeholder client)
- Minimal fix: wrap the `init()` await in try/catch (proceed unauthenticated â€” guard will route to /login), or `bootstrap().catch(...)` that still mounts.
- Rejected alternatives:
  - Global error overlay: heavier; degraded-to-login is the correct behavior.

### F-15 â€” Library search/pagination responses can apply out of order
- Severity: P3
- Verdict: CONFIRMED
- Defect: `load()` has no request discriminator; a slow earlier response (e.g. pre-debounce search for "a") resolving after a later one (search "ab") overwrites `items`/`total`/`offset` with stale results.
- Anchor: `frontend/src/views/SessionsLibraryView.vue:29-49` (`load` writes unconditionally), `:68-75` (debounce reduces but does not eliminate overlap with `setStatus`/`nextPage` calls).
- Trigger: Type in search, then immediately click a status filter; the search response lands after the filter response.
- Consequence: Grid shows results not matching the active controls; pager range label inconsistent with filter state until the next interaction.
- Confidence: medium (needs response reordering; local backends rarely show it, deployed ones will)
- Minimal fix: module-level `let seq = 0; const my = ++seq` at load start; discard the write if `my !== seq` â€” same pattern as `_latestRequestedId`.
- Rejected alternatives:
  - AbortController per load: also fine; the seq guard is fewer lines and matches the store's existing idiom.

### F-16 â€” Session-death redirect drops the deep link
- Severity: P3
- Verdict: CONFIRMED
- Defect: `_onAuthExpired` pushes `{ name: 'login' }` with no `redirect` query, unlike the router guard's F-49 handling, so a mid-app auth expiry loses the user's location.
- Anchor: `frontend/src/services/apiClient.js:68-73`; contrast `frontend/src/router/index.js:98-101`.
- Trigger: Leave a tab open past refresh-token expiry; click anything that calls the API from `/session/abc`.
- Consequence: After re-login the user lands on Home instead of the session they were in.
- Confidence: high
- Minimal fix: `router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })`.
- Rejected alternatives:
  - Letting the guard handle it by pushing the current route: the guard only fires on navigation; the push must carry the query itself.

### F-17 â€” `completeCheck` clears `pendingCheck` before the stream is attempted; a pre-flight failure strands the check UI until reload
- Severity: P3
- Verdict: CONFIRMED
- Defect: `pendingCheck.value = null` executes before `streamCheckComplete` is even dispatched; if the POST never reaches the server (network down), the server still holds the pending batch but the client has discarded it and offers no way to re-trigger completion.
- Anchor: `frontend/src/stores/session.js:393-394` (clear-before-stream), recovery only via `loadSession`'s `s.pending_check` mapping at `:146-162`.
- Trigger: Answer the last check question, go offline, click Done.
- Consequence: Check card vanishes, error banner shows, recap/follow-up never happen; state re-syncs only on full session reload. (Chatting still works, so P3 not P2.)
- Confidence: high
- Minimal fix: move the `pendingCheck.value = null` into the first received event (or after `streamCheckComplete` resolves past headers), restoring it in the network-failure catch.
- Rejected alternatives:
  - Auto-`loadSession` on failure: works but refetches the whole transcript for a local state slip.

### F-18 â€” `aria-live="polite"` wraps the entire message list including the token-streaming bubble
- Severity: P3
- Verdict: CONFIRMED
- Defect: The live region covers the streaming `AssistantBubble`, whose DOM is mutated per animation frame during generation; SRs will attempt to announce every mutation of the growing reply, producing stutter/spam, and re-announce large markdown re-renders.
- Anchor: `frontend/src/components/chat/MessageList.vue:13` (`aria-live` on the wrapper), streaming child at `:40-44`.
- Trigger: Any streamed tutor reply with a screen reader running.
- Consequence: Unusable announcement firehose during generation; the meaningful signal (reply finished) is drowned.
- Confidence: medium (SR buffering behavior varies; NVDA/VoiceOver both known to choke on token-streamed live regions)
- Minimal fix: move `aria-live` to a visually-hidden status element that announces discrete events ("Tutor is replying", "Reply finished"), leaving the transcript itself non-live.
- Rejected alternatives:
  - `aria-busy` on the streaming bubble: helps some SRs, ignored by others; the discrete-status region is the reliable pattern.

### F-19 â€” GapPickerDialog ships raw Aura Dialog chrome while the app's only other Dialog is fully restyled
- Severity: P3
- Verdict: CONFIRMED
- Defect: The summary Dialog gets bespoke `:global(.summary-dialog ...)` overrides (display font header, card radius, accent-strong footer button), but GapPickerDialog uses the preset defaults â€” Aura header typography, default radius/padding â€” so the two modals in the same view render visibly different chrome; `adaptPreset.js` overrides only primary/surface ramps and radii, not typography.
- Anchor: `frontend/src/components/GapPickerDialog.vue:2-9` (no chrome overrides), contrast `frontend/src/views/SessionView.vue:741-767` (summary-dialog overrides), `frontend/src/theme/adaptPreset.js:11-73` (scope of preset).
- Trigger: End a session with >1 confirmed gap; open "Review my gaps" (gap picker), then end-session dialog â€” compare.
- Consequence: Inconsistent modal identity (font, radius, header weight) inside one flow; the flagged "raw defaults where the rest of the app overrides" case.
- Confidence: high
- Minimal fix: extract the `.summary-dialog` global rules into a shared `.crux-dialog` class applied to both Dialogs (Dialog accepts `class`).
- Rejected alternatives:
  - Extending the preset with dialog typography tokens: better long-term, but touches every future overlay; the shared class is contained.

### F-20 â€” Send failures double-surface: errorBus toast plus in-view error banner for the same error
- Severity: P3
- Verdict: CONFIRMED
- Defect: `streamChat` failures thrown out of `sendMessageStreaming` reach `_setError` â†’ `friendlyError` banner in SessionView, while the same underlying `ApiError` was already toasted by `reportApiError` (chat-stream pre-flight HTTP failures go through `ApiError` paths that App.vue toasts for any non-429/404 status) â€” profile/upload services opt out with `silent: true`, the chat path does not.
- Anchor: `frontend/src/views/SessionView.vue:58-78` (banner), `frontend/src/App.vue:41-47` (toast), opt-out precedent `frontend/src/services/profileApi.js:15-26`.
- Trigger: Backend 500 on `POST /chat/stream` pre-stream.
- Consequence: Two simultaneous error surfaces for one failure (toast top-right + red banner in-flow), the exact "double signal" the profileApi comment warns about.
- Confidence: medium (SSE fetch errors constructed in chatStreamService are thrown, not routed via `request()`, so only some failure shapes double-fire â€” pre-stream HTTP errors from `_fetchSse` are not reported to errorBus at all, which is itself inconsistent; the double case is the JSON-API calls SessionView also renders in the same banner, e.g. `answerCheck`/`skipCheck` failures at `SessionView.vue:550-564`)
- Minimal fix: pass `silent: true` semantics to the check-flow API calls whose errors SessionView already banners (`sessionsApi.answerCheck`/`skipCheck` call sites), matching the profileApi pattern.
- Rejected alternatives:
  - Suppressing the banner: the banner is the better surface (has Retry context); the toast is the redundant one.

---

## Notes (not findings)
- `apiClient` 401 retry is per-request, not single-flight; concurrent 401s each call `getSession()`, but the Supabase SDK serializes refresh internally â€” no observable defect. Retried POSTs are safe: a 401 is rejected by auth middleware before any side effect.
- SSE parser trims data lines (`sseParser.js:36`) â€” spec-incorrect for non-JSON payloads, harmless for this backend's all-JSON events.
- `useSessionGroups` captures `Date.now()` at Sidebar setup (`Sidebar.vue:90-91`) â€” "Today/This week" buckets stale in long-lived tabs; acknowledged in-code as accepted (BY-DESIGN).
- MessageList's scoped `.msg`/`.msg.assistant` rules do leak onto AssistantBubble's root via data-v inheritance (the known hot spot): parent CSS orders after child CSS, so `.msg.assistant { max-width: 95%; align-self: flex-start }` (`MessageList.vue:107-110`) wins over the bubble's own `max-width: 100%; align-self: stretch` (`AssistantBubble.vue:102-106`). Impact is a 5% width cap on assistant bubbles â€” visual drift against the child's explicit full-width intent, but width:100% (uncontested) keeps layout sane. Fix by renaming the typing-indicator article's classes (e.g. `.msg-typing`) so parent rules can't collide. Filed as a note rather than a numbered finding because the rendered delta is minor; treat as the tripwire for the known PR-#72-era bug class.
- 643/643 unit tests pass; none cover F-01/F-02/F-04 sequences (no test aborts a stream on nav, none signs out and re-signs-in across stores, none overlaps completeCheck with an active stream).

## Files read (all under `C:\Users\EDWARD\Documents\Project_Apt\frontend\src\`)
App.vue, main.js,
router/index.js,
stores/auth.js, stores/user.js, stores/session.js,
services/apiClient.js, services/chatStreamService.js, services/sessionsApi.js, services/profileApi.js, services/uploadApi.js, services/reviewApi.js, services/errorBus.js, services/costBus.js, services/supabase.js,
lib/sseParser.js, lib/deltaBatcher.js, lib/errors.js, lib/capErrors.js, lib/errorCodes.js, lib/markdownRenderer.js, lib/markdownStreamBuffer.js,
composables/useSidebar.js, composables/useTheme.js, composables/useToast.js, composables/useSessionGroups.js,
utils/safeRedirect.js, utils/formatDate.js, utils/sessionCard.js,
views/SessionView.vue, views/HomeView.vue, views/SessionsLibraryView.vue, views/NewSessionView.vue, views/OnboardingView.vue, views/LoginView.vue, views/RegisterView.vue, views/ForgotPasswordView.vue, views/ResetPasswordView.vue, views/SettingsView.vue, views/ProfileView.vue, views/AggregateProfileView.vue, views/TosView.vue,
components/BackButton.vue, components/GapPickerDialog.vue, components/SessionEndedBanner.vue, components/FeedbackStylePicker.vue,
components/chat/Composer.vue, components/chat/CheckQuestion.vue, components/chat/CheckRecap.vue, components/chat/MessageList.vue, components/chat/AssistantBubble.vue, components/chat/UserBubble.vue, components/chat/MarkdownContent.vue, components/chat/CapBanners.vue, components/chat/ReferenceStatusBanner.vue, components/chat/UploadStatus.vue, components/chat/ToolCallChip.vue, components/chat/CitationsList.vue, components/chat/SessionHeader.vue,
components/sidebar/Sidebar.vue, components/sidebar/SidebarSessionRow.vue, components/sidebar/SidebarRowMenu.vue,
components/profile/WeakestConcepts.vue,
assets/base.css, assets/main.css, assets/aura-tokens.css, theme/adaptPreset.js.
(Grep-swept, not fully read: PrivacyView.vue, EmptyState components, Logo.vue, SessionChips.vue, MasteryTrend.vue, UsagePanel.vue, SidebarSkeletonList.vue, SidebarMobileTopStrip.vue, MessageListSkeleton.vue, chat/EmptyState.vue, toolLabels.js, legal/version.js.)


---

# Crux â€” Final Adversarial Audit: App-Level Integration (FE <-> BE <-> Deploy)

Date: 2026-07-18. Read-only audit. Scope: FE/contract conformance, error-envelope
handling end-to-end, env/config coupling, compose-vs-Render divergence, contracts drift.
All anchors are current working-tree source (branch `dev`, clean).

---

## P2 findings

### I-01 â€” RUNBOOK Vercel env value for VITE_API_BASE_URL omits the /api prefix; the documented Vercel deploy 404s on every API call
- Severity: P2 (breaks the pending "dashboard deploy per RUNBOOK" launch gate)
- Verdict: CONFIRMED
- Defect: `docs/deploy/RUNBOOK.md:47` instructs: "`VITE_API_BASE_URL` = the Render URL from step 3", and step 3 (`docs/deploy/RUNBOOK.md:39`) records the bare service URL, e.g. `https://crux-api.onrender.com` â€” no `/api`. The frontend treats `VITE_API_BASE_URL` as *already containing* the `/api` prefix: `frontend/src/services/apiClient.js:5-7` ("backend routers all mount under /api", default `http://localhost:8000/api`), and all callers append bare paths (`frontend/src/services/sessionsApi.js:7` posts to `/sessions`, `frontend/src/services/chatStreamService.js:110` posts to `/chat/stream`, `frontend/src/services/uploadApi.js:45` posts to `/upload`). Every backend router mounts under `prefix="/api"` (`backend/routes/sessions.py:56` area â€” `router = APIRouter(prefix="/api")`; same in `chat.py:38`, `profile.py:18`, `upload.py:27`). The Docker path bakes `/api` (`frontend/Dockerfile:9`); only the Vercel path takes the value from this runbook line.
- Trigger: operator follows RUNBOOK step 4 literally on a fresh Vercel deploy.
- Consequence: SPA requests `https://crux-api.onrender.com/sessions`, `/chat/stream`, etc. â†’ 404 on every call. App loads, then everything fails. Step 7 smoke catches it only after full deploy, with no hint the base URL is the cause.
- Confidence: High â€” mechanical: string concatenation in `apiClient.js:77` (`${BASE_URL}${path}`) vs router prefix.
- Minimal fix: change `docs/deploy/RUNBOOK.md:47` to "`VITE_API_BASE_URL` = the Render URL from step 3 **with `/api` appended** (e.g. `https://crux-api.onrender.com/api`)".
- Rejected alternatives: making the FE auto-append `/api` when absent (magic normalization breaks the nginx relative `/api` case and localhost overrides); adding a Vercel rewrite proxy for `/api` (vercel.json:6-8 rewrites everything to index.html and cross-origin CORS is already the chosen design).

### I-02 â€” ErrorResponse contract declares `detail: string`; every structured backend error sends `detail` as an object, and the FE depends on the undocumented object shape
- Severity: P2
- Verdict: CONFIRMED
- Defect: `docs/api/openapi.yaml:1464-1469` (`ErrorResponse`, `additionalProperties: false`, `detail: {type: string}`) is the declared schema for 400/404/409/413/429 responses across the spec. Actual wire payloads are objects:
  - 429 cost cap: `backend/routes/chat.py:140-149` â€” `detail={"code": daily_cost_cap_reached, soft_cap_usd, hard_cap_usd, used_usd, resets_at}`
  - 429 daily cap: `backend/routes/chat.py:188-197`, `backend/routes/upload.py:76-84`
  - 409 session_ended: `backend/routes/chat.py:168`, `backend/routes/sessions.py:466,492,533`
  - 409 duplicate_topic (+`session_id`): `backend/routes/sessions.py:155-156,404-405`
  - 409 check_conflict / no_resolved_batch: `backend/routes/sessions.py:470,496,537`
  - 413/400/415/507 upload codes: `backend/routes/upload.py:57,92,101-105,114,122-126,156`
  The FE parses exactly these undocumented object shapes: `frontend/src/stores/session.js:579,587`, `frontend/src/lib/capErrors.js:9-29`, `frontend/src/views/NewSessionView.vue:226`, `frontend/src/views/HomeView.vue:103`. The YAML even contradicts itself: `docs/api/openapi.yaml:114` says "session_id carries the existing id" while pointing at a schema that cannot carry it. Codegen output matches the wrong schema (`backend/contracts/models.py:654-658` â€” `detail: str`), so the contract models would reject the app's own error payloads.
- Trigger: any consumer (test harness, future client, contract-driven validator) trusting the YAML â€” CLAUDE.md declares it "API contract source of truth".
- Consequence: contract source of truth is false for the entire error surface; the FE<->BE coupling for cap banners, session-ended handling, and duplicate-topic redirect exists only as folklore in code comments.
- Confidence: High.
- Minimal fix: in `docs/api/openapi.yaml`, change `ErrorResponse.detail` to `oneOf: [string, CodedErrorDetail]` and define `CodedErrorDetail {code: string, ...additionalProperties: true}`; regen contracts.
- Rejected alternatives: flattening backend errors to strings (would break `capErrors.js` and session-ended/duplicate-topic UX); per-endpoint error schemas (more precise, but a large YAML change during launch freeze â€” defer the refinement).

---

## P3 findings

### I-03 â€” `X-Cost-Warning` response header is read by the FE and promised by the backend docstring, but no backend code ever sets it
- Severity: P3
- Verdict: CONFIRMED
- Defect: `backend/services/cost_meter.py:3` claims "Soft cap â†’ `X-Cost-Warning` response header." Repo-wide grep finds zero setters â€” no route or middleware writes the header (only the SSE `cost_warning` event exists: `backend/agent/tutor.py:291`). The FE carries a full consumption path for it: `frontend/src/services/apiClient.js:123-124` reads `x-cost-warning` and dispatches to `costBus`; `frontend/src/views/SessionView.vue:264-269` parses `level=` out of the header string. `frontend/src/__tests__/costCapUx.test.js:12-33` tests the FE half against a header the server never sends.
- Trigger: user crosses the soft cap via non-SSE spend â€” end-session summary LLM call (`backend/routes/sessions.py:349` path) or upload embedding spend (`backend/services/cost_meter.py:287` meter_embedding_response).
- Consequence: no soft-cap warning for non-chat spend; the FE header branch is dead code; the docstring misleads maintainers into believing the path exists. Secondary: even if implemented, the Vercelâ†’Render cross-origin path would hide the header because `backend/main.py:40-46` CORSMiddleware sets no `expose_headers` â€” a custom header is not readable by cross-origin JS without it.
- Confidence: High on "never set" (grep across `backend/**/*.py`); High on the CORS mechanism.
- Minimal fix: either delete the FE header path + fix the docstring (SSE event is the real transport), or implement the header on `/sessions/{id}/end` and `/upload` responses and add `expose_headers=["X-Cost-Warning"]` in `main.py`.
- Rejected alternatives: leaving as-is "for future use" â€” a documented transport that does not exist is exactly how the next regression ships.

### I-04 â€” nginx per-IP throttle 429 is mislabeled "daily limit" and globally toast-suppressed
- Severity: P3
- Verdict: CONFIRMED
- Defect: the compose deploy throttles `/api/` at 10 r/s, returning 429 with an nginx (non-JSON) body (`frontend/nginx.conf:5,35-36`). FE-side: `frontend/src/App.vue:43` suppresses toasts for **all** 429s on the assumption "daily-cap has dedicated banner+toast in SessionView" â€” but cap banners are populated only from chat paths via `mapCapError` (`frontend/src/stores/session.js:447,587`), and `mapCapError` no-ops on the nginx body (no `code` field, `frontend/src/lib/capErrors.js:10,28`). Non-chat callers that surface `store.error`/inline errors render `friendlyError(429)` = "You've hit the daily limit. Try again tomorrow." (`frontend/src/lib/errors.js:9`).
- Trigger: request burst >20 on the compose/ngrok deploy (e.g. rapid navigation, polling + parallel loads).
- Consequence: a 1-second transient throttle is presented as a hard daily lockout ("try again tomorrow") or silently swallowed â€” user abandons a working app.
- Confidence: Medium-high (burst of 20 makes the trigger uncommon but real; mechanism certain).
- Minimal fix: in `friendlyError`, distinguish 429-with-`detail.code` (daily cap copy) from bare 429 ("Too many requests â€” wait a moment and retry.").
- Rejected alternatives: removing the App.vue 429 suppression (would double-toast genuine cap errors in SessionView).

### I-05 â€” Reopen-session 409 `duplicate_topic` is a dead end in the FE; the contract's `session_id` field is ignored
- Severity: P3
- Verdict: CONFIRMED
- Defect: `POST /sessions/{id}/reopen` returns 409 `{"code": "duplicate_topic", "session_id": existing}` (`backend/routes/sessions.py:404-405`; documented intent at `docs/api/openapi.yaml:307-312`). Create-path callers handle this code and redirect (`frontend/src/views/NewSessionView.vue:226`, `frontend/src/views/HomeView.vue:103`), but the reopen path does not: `frontend/src/stores/session.js:231-247` `reopenSession` catch is a bare `_setError`, and `frontend/src/views/SessionView.vue:496-506` `resume()` swallows the rethrow. User sees the generic toast + inline "That request was rejected. Check the details and try again." (`frontend/src/lib/errors.js:12`).
- Trigger: end session A (topic X) â†’ create a new active session on topic X â†’ click Resume on A (session page or sidebar row menu).
- Consequence: no explanation, no link to the conflicting active session the backend explicitly hands over. Broken affordance on a reachable everyday path.
- Confidence: High.
- Minimal fix: in `reopenSession`'s catch, on `e.status === 409 && e.body?.detail?.code === 'duplicate_topic'`, set a specific error ("An active session with this topic already exists") and expose `detail.session_id` for a "Go to active session" action, mirroring NewSessionView:226.
- Rejected alternatives: auto-redirect to the existing session (surprising navigation without user consent).

### I-06 â€” Committed vercel.json CSP contains the literal placeholder `https://CRUX_API_HOST`
- Severity: P3
- Verdict: CONFIRMED (documented manual gate, but a standing landmine)
- Defect: `frontend/vercel.json:15` ships `connect-src 'self' https://*.supabase.co https://CRUX_API_HOST`. RUNBOOK step 6 (`docs/deploy/RUNBOOK.md:60-65`) requires replacing the placeholder via a git commit ("no env interpolation"). So the repo state can never produce a working Vercel deploy; the fix must live as a committed real hostname (env-specific config in git) or the app stays CSP-blocked. Any fresh clone / revert / new environment regresses to a blocked app; the placeholder also makes preview deploys from `dev` permanently broken.
- Trigger: Vercel deploy from repo state without the manual CSP commit; or any future deploy after a revert.
- Consequence: browser blocks every `fetch` to the API (CSP violation), app dead despite correct env vars.
- Confidence: High on mechanism; severity limited because RUNBOOK explicitly warns ("do not expect a working app between steps 5 and 6").
- Minimal fix: none purely in-repo given Vercel headers lack env interpolation; least-bad: keep the real Render host committed once known (it is not a secret), and delete the placeholder â€” or move CSP to a `frontend/api/_headers`-style build step that injects `VITE_API_BASE_URL`'s origin at build time.
- Rejected alternatives: wildcarding `https://*.onrender.com` (allows exfiltration to any Render app â€” CSP purpose defeated).

### I-07 â€” docker-compose.prod.yml never sets ENV=prod: the "production stack" runs with every prod guard inert
- Severity: P3
- Verdict: CONFIRMED
- Defect: neither compose file sets `ENV` (`docker-compose.prod.yml:28-42` environment block lacks it), so `settings.env` stays `"dev"` (`backend/config.py:36`). Consequences wired to `env == "prod"`: `assert_prod_database` sqlite guard skipped (`backend/config.py:82-87`, called at `backend/main.py:19`), `SUPABASE_URL`-required boot check skipped (`backend/main.py:20-21`), and exception stack traces are logged in "prod" compose because `exc_info=settings.env != "prod"` (`backend/routes/upload.py:145`, `backend/services/ingestion_service.py:224,241`, `backend/services/retrieval_service.py:66`). The Render path sets `ENV: prod` (`render.yaml` envVars) â€” the two deploy paths diverge on guards that exist specifically for production.
- Trigger: `docker compose -f docker-compose.prod.yml --env-file .env up` with a missing/mistyped `DATABASE_URL` â†’ silently boots on sqlite inside the container; DB rows vanish on container rebuild.
- Consequence: the exact failure mode `assert_prod_database` was written to prevent is reachable on the compose prod path.
- Confidence: High.
- Minimal fix: add `ENV: prod` to `docker-compose.prod.yml` environment (and optionally `ENV: dev` explicitly in `docker-compose.yml` for symmetry).
- Rejected alternatives: defaulting `env` to prod in config.py (breaks local dev and CI defaults).

### I-08 â€” openapi.yaml promises per-event SSE shapes "in x-sse-events below" but omits `check_question` and `followup_skipped`
- Severity: P3
- Verdict: CONFIRMED
- Defect: `docs/api/openapi.yaml:59-63` and `:393-401` both enumerate `check_question` (and check/complete adds `followup_skipped` with `data: {reason: "daily_cap"}`) and defer to the `x-sse-events` extension for data shapes; `x-sse-events` (`docs/api/openapi.yaml:1477-1554`) defines neither event. The FE consumes both: `frontend/src/stores/session.js:414` (`handleCheckQuestion({gap, items, total})`, shape spec'd nowhere) and `:417-424` (`followup_skipped`).
- Trigger: anyone implementing/validating the SSE contract from the YAML.
- Consequence: the check-question payload â€” the most structurally complex SSE event â€” has no contract; drift between `agent/stream_events.py` and the FE mapper is undetectable by contract review.
- Confidence: High.
- Minimal fix: add `check_question` (gap, total, items[{question, options}]) and `followup_skipped` (reason) entries to `x-sse-events`.
- Rejected alternatives: none.

### I-09 â€” Upload 415 CONTENT_TYPE_MISMATCH is undocumented in the contract
- Severity: P3
- Verdict: CONFIRMED
- Defect: `backend/routes/upload.py:120-126` returns 415 `{"code": "CONTENT_TYPE_MISMATCH", "message": ...}` (F-55 magic-byte sniff), but `docs/api/openapi.yaml:445-459` documents only 202/400/413/429/507 for `/api/upload`. FE renders it via generic `friendlyError` (`frontend/src/views/SessionView.vue:458-462` â†’ `frontend/src/lib/errors.js:12`), dropping the backend's specific message ("file content does not match its extension").
- Trigger: upload a renamed non-PDF as `.pdf` (extension passes, magic bytes fail).
- Consequence: contract incomplete; user sees "That request was rejected. Check the details and try again." instead of the actionable cause.
- Confidence: High.
- Minimal fix: add `"415"` to the YAML upload path; in `onAttachFile`'s catch, surface `e.body?.detail?.message` when present before falling back to `friendlyError`.
- Rejected alternatives: none.

### I-10 â€” FE does not enforce ChatRequest.message maxLength 4000; oversized sends die as generic 422
- Severity: P3
- Verdict: CONFIRMED
- Defect: contract caps `message` at 4000 chars (`docs/api/openapi.yaml:984`, enforced by `backend/contracts/models.py:253` via FastAPI body validation â†’ 422). No composer-side limit exists (grep for `maxlength|maxLength|4000` across `frontend/src/components/chat/*.vue` and `frontend/src/views/SessionView.vue`: 0 hits). On 422 the catch path (`frontend/src/stores/session.js:573-591`) shows `friendlyError` = "That request was rejected. Check the details and try again." â€” the optimistic user bubble (`session.js:531`) stays in the transcript though nothing was persisted.
- Trigger: paste >4000 chars (lecture notes, code dump) and send.
- Consequence: unexplained rejection with no mention of length; stale transcript bubble until reload.
- Confidence: High.
- Minimal fix: `maxlength="4000"` + counter on the composer textarea; optionally pop the optimistic user message on non-retryable send failure.
- Rejected alternatives: raising the backend cap (cost-control regression).

### I-11 â€” Contract never documents 401 or 503 on any endpoint; `UpstreamUnavailable` component is orphaned; profile PATCH 422 undocumented
- Severity: P3
- Verdict: CONFIRMED
- Defect: every endpoint requires Bearer auth (`docs/api/openapi.yaml:18-19`) and the backend returns 401 (invalid token) and 503 (JWKS outage, `backend/services/auth.py:97-100`), yet no path in the YAML lists a 401 or 503 response; the defined `UpstreamUnavailable` response component (`docs/api/openapi.yaml:662-666`) is referenced by zero paths. The FE meanwhile has dedicated machinery for both (401 refresh-retry-signout: `frontend/src/services/apiClient.js:108-117`; 503 copy: `frontend/src/lib/errors.js:10`). Also `PATCH /api/profile/{session_id}` raises 422 for empty/invalid patches (`backend/routes/profile.py:98,113`) but the YAML documents only 200/404/412/428 (`docs/api/openapi.yaml:541-549`).
- Trigger: contract-driven client generation or conformance testing.
- Consequence: the auth failure surface â€” the one with the most FE logic â€” is contract-invisible.
- Confidence: High.
- Minimal fix: add a shared `Unauthorized` response and reference it (plus 503 on auth-touching paths, 422 on profile PATCH); reference or delete `UpstreamUnavailable`.
- Rejected alternatives: none.

---

## Checked and cleared (no finding)

- **Contracts drift (scope item 5): REFUTED.** `backend/contracts/models.py:1-2` carries the datamodel-codegen header; spot-compare of ConceptEntry, TopicProfile, Citation, ChatRequest (`models.py:248-255`), MeResponse (`:476-482`), ProfilePatchRequest (`:506-520`), ErrorResponse (`:654-658`) against the YAML shows exact codegen correspondence (including the known `strip_whitespace` omission handled in the service layer per WS-E). Generator flags in `backend/scripts/gen_contracts.py:52-72` match the output style. No hand-edit evidence.
- **Migration exactly-once (scope item 4): no divergence.** Both deploy paths use the same image CMD â€” `backend/Dockerfile:31` â†’ `backend/entrypoint.sh:3` (`alembic upgrade head` then uvicorn); `render.yaml` sets no `dockerCommand` override and `docs/deploy/RUNBOOK.md:33-34` confirms Render boots through the same entrypoint. Single backend instance in both paths (compose: one service; Render: free plan) â†’ one migration run per boot, idempotent re-runs thereafter. Note: the claim elsewhere that "only docker-compose path migrates-on-start" is stale â€” Render migrates on boot too (RUNBOOK step 0 exists precisely to front-run it).
- **Profile ETag transport:** etag travels in the JSON body (`backend/routes/profile.py:63,114`; `docs/api/openapi.yaml:1249-1251`), not a response header â€” so no CORS-expose problem for the If-Match flow; `If-Match` is in CORS `allow_headers` (`backend/main.py:45`). FE handles 412 with conflict-notice + refetch (`frontend/src/views/ProfileView.vue:302-309`); 428 unreachable from FE (etag always sent) and falls back to inline `friendlyError`. The scope prompt's "409" for profile edits does not exist â€” the design uses 412/428 consistently across YAML, backend, and FE.
- **FE path inventory vs YAML:** every FE call target (`/sessions`, `/sessions/library`, `/sessions/{id}`, `/sessions/{id}/end|reopen|ingestion|check/*`, `/chat/stream`, `/upload`, `/upload/{id}`, `/documents/{id}`, `/profile/aggregate`, `/profile/{id}` + delete subpaths, `/review/queue`, `/usage/summary`, `/me`) exists in the YAML; no orphan FE call found. Route-order shadowing checked: `/sessions/library` precedes `/sessions/{session_id}` (`backend/routes/sessions.py:257,306`); `/profile/aggregate` precedes `/profile/{session_id}` (`backend/routes/profile.py:21,29`). Create returns 201 as documented (`backend/routes/sessions.py:119`).
- **SSE consumer shapes:** `done.message_id`, `cancelled.{message_id,partial_content_chars,estimated_cost_usd}`, `error.{code,message,...}`, `tool_call_done.{id,status,summary,error}`, `cost_warning.level` all match `x-sse-events` (`docs/api/openapi.yaml:1477-1554`) and the FE mappers (`frontend/src/stores/session.js:408-431,546-563`).
- **CSP/nginx compose path:** relative `/api` baked in Docker (`frontend/Dockerfile:9`) satisfies `connect-src 'self'` (`frontend/nginx.conf:15`); Supabase auth covered by `https://*.supabase.co` in both CSPs. F-62 fix holds â€” no REGRESSION.
- **Env var name agreement:** compose and render.yaml use identical names for all shared vars; Render-only omissions (MODEL, EMBEDDING_MODEL) fall back to identical config defaults (`backend/config.py:20-21`). `SUPABASE_PUBLISHABLE_KEY` is pasted into the Render backend env (RUNBOOK step 2.4) but read by no backend runtime code (only `config.py:43` defines it) â€” harmless dead config, noted, not a numbered finding.

## Files read
- frontend: src/services/{apiClient,chatStreamService,profileApi,sessionsApi,uploadApi,reviewApi,errorBus,costBus}.js, src/stores/session.js, src/App.vue, src/views/{ProfileView,SessionView}.vue (parts), src/lib/{errors,capErrors}.js, nginx.conf, Dockerfile, vercel.json
- backend: main.py, config.py, entrypoint.sh, Dockerfile, routes/{chat,profile,upload,sessions(grep)}.py, services/cost_meter.py, contracts/models.py (parts), scripts/gen_contracts.py
- deploy/docs: docker-compose.yml, docker-compose.prod.yml, render.yaml, docs/deploy/RUNBOOK.md, docs/api/openapi.yaml (full)
- greps: X-Cost-Warning setters (backend-wide), FE status-code handling sweep, VITE_API_BASE_URL/CRUX_API_HOST repo-wide, settings.env / 503 usage, route decorators in sessions.py


---

# UI/Design Audit â€” Claude in Chrome (live app, both themes)

Environment: docker-compose stack at http://localhost:5173 (nginx-served prod bundle), logged-in user with 14 active sessions. Every view below inspected in dark AND light theme with screenshot evidence saved under `C:\Users\EDWARD\AppData\Local\Temp\claude-chrome-screenshots-EFtpqf\`.

Views covered: Home (populated + review-expanded), NewSession, Session (populated chat with open check question, batch recap cards, KaTeX/markdown content: sessions "Glycolysis", "Intro lesson", "Big-O notation"), Session empty state (0-msg session "Introduction to Binary Trees"), Session ProfileView (/session/:id/profile), AggregateProfileView (/profile, loading + populated), Settings (full page incl. Danger zone), sidebar Ended-filter empty state.

Unreachable states (noted per instructions, source-only review applies):
- OnboardingView: /onboarding redirects to Home for an already-onboarded user. Resetting onboarding requires the "Retake onboarding" Danger-zone action (profile mutation â€” out of allowed browser scope).
- SessionEndedBanner / ended-session card: the live account has 0 ended sessions and ending a session is a data mutation (out of allowed scope). Ended empty state ("No ended sessions yet.") captured instead.
- Error/toast states beyond the one transient toast observed; cost-cap banners; streaming states (would require paid LLM sends).

## Slop-criteria verdict (overall)
No emoji-as-icons, no purple/indigo gradients, no glassmorphism, no gradient text, no 3-col feature-grid filler, no "Unlock/Supercharge" marketing microcopy found on any inspected screen. The coral/paper token system, Bricolage Grotesque display font, pop shadows and motion tokens read as one intentional system in both themes. KaTeX and markdown render correctly in long sessions. The confirmed findings below are rendering/state defects and robustness issues, not template-slop.

## Findings

### U-01 â€” Empty assistant bubble rendered for content-less tutor messages
- Severity: P2. Verdict: CONFIRMED (reproduced in 3 sessions, both themes).
- Defect: every assistant message whose reply consisted only of a check-question tool call renders as an avatar + "TUTOR" label + an empty padded pill.
- Anchor: `frontend/src/components/chat/AssistantBubble.vue:45` (`<MarkdownContent class="content" :text="message.content || ''" ...>` renders the styled `.content` box unconditionally; box styling at :108-114) and `frontend/src/components/chat/MessageList.vue:15-18` (renders an AssistantBubble for every non-user message with no renderability guard).
- Trigger: open any session whose history contains a "quiz me" turn where the model produced no prose (Glycolysis, Intro lesson, Big-O all show it).
- Consequence: chat history littered with empty bubbles; reads as broken rendering.
- Minimal fix: in MessageList, skip assistant messages with no content, no check_batch, no tool_calls, no citations, and no cancelled/partial status. Rejected: hiding only `.content` in AssistantBubble (leaves floating avatar+label); backend-side message suppression (contract change).

### U-02 â€” Multi-second fully blank main pane when opening a session
- Severity: P2. Verdict: CONFIRMED (observed twice on a 0-message session; >5s blank with API 200s and zero console errors; view later rendered after an unrelated sidebar interaction).
- Defect: on navigation to /session/:id the entire route pane (back link, header, composer â€” all unconditionally rendered in `SessionView.vue:15-46`) stays unrendered for seconds; no skeleton shown even though `MessageListSkeleton` exists at `frontend/src/views/SessionView.vue:38`.
- Mechanism hypothesis (confidence medium, to be pinned in fix phase): route-level component mount is being deferred (router-view transition/async gap in App.vue), not a data-loading gate â€” SessionView's own template cannot render "nothing".
- Consequence: app looks frozen/broken exactly on the most common navigation.
- Minimal fix: TBD after mechanism confirmation; expected to be a one-line transition/mount guard fix in App.vue or router wiring.

### U-03 â€” Check recap contradicts itself after reload: "Answer not recorded" on answered batches
- Severity: P2. Verdict: CONFIRMED (every resolved batch in every inspected session, both themes).
- Defect: recap cards reconstructed from server history show the score header (e.g. "1 / 1 Â· General glycolysis processes", counting items as answered/correct) while each item shows the italic "Answer not recorded" note and no "your answer" tag.
- Anchor: `frontend/src/components/chat/CheckRecap.vue:50-54` (`v-if="item.selectedIndex == null"` â†’ "Answer not recorded") vs :12-13 (graded/nCorrect derived from status/correct). Root cause upstream: reconstructed batch items carry status/correct but `selectedIndex: null` (backend batch reconstruction on session GET).
- Consequence: user is told their answer wasn't recorded when it demonstrably was â€” trust-destroying copy on every historical check.
- Minimal fix: if the selected index is persisted server-side, include it in reconstruction; otherwise suppress the "Answer not recorded" note for items whose status is 'answered' (show it only for genuinely unanswered/skipped items). Decide in fix phase against backend reconstruction code.

### U-04 â€” Runtime dependency on Google Fonts CDN
- Severity: P3. Verdict: CONFIRMED.
- Defect: `frontend/index.html:8-10` loads Bricolage Grotesque / Inter / IBM Plex Mono from fonts.googleapis.com at runtime. In this live run the request returned 503 and the app silently fell back to system fonts â€” i.e. the entire intentional typography layer is network-dependent. Also couples CSP (style-src/font-src) to Google origins across nginx.conf and vercel.json.
- Minimal fix (defer-able): self-host the three families as woff2 assets. Deferred as P3 â€” dependency-adjacent and >50-line-equivalent asset change.

### U-05 â€” Transient generic error toast on app load
- Severity: P3. Verdict: CONFIRMED once, unreproduced (confidence low).
- Defect: on first Home load a toast "Error â€” Something went wrong on our side. Try again shortly." appeared; on reload all API calls returned 200 and no toast fired. Source request unidentified (network tracking not yet attached on first load).
- Note: generic toast text with no failing request visible; candidate sources: review queue fetch or fonts 503 mapped to global error bus. Record-only; no fix without reproduction.

## Positive verifications (evidence, not praise â€” claims tested and not refuted)
- Dark/light token ramps consistent across all inspected views; no white-on-white overlays (PrimeVue surface-ramp fix holding).
- Focus/keyboard: interactive sidebar rows expose proper accessible names ("Open session: X"); Active/Ended filter buttons reachable; composer hint text present.
- Ended-filter empty state, ChatEmptyState (BEGIN + 3 suggestion chips), NewSession form, review queue expansion all render correctly in both themes.
- localStorage keys are `crux:*` in current code (`useTheme.js:3`); `adaptlearn:*` keys in the browser are stale residue from old builds, not current source.


---

# Post-implementation state (Phase 2/3 close-out, 2026-07-18)

Every fix below carries a regression test proven to fail pre-fix (verified via
`git stash` of the source change) unless noted. Gates after the final commit:
backend 793 passed / 5 skipped, frontend 662 passed, `npm run lint` clean,
contracts codegen drift clean (regenerated with the pinned
`backend/.venv` datamodel-code-generator 0.68.1).

## Fixed

| ID | Sev | Commit | Fix summary |
|----|-----|--------|-------------|
| F-01 | P1 | 7e55220 | Stream ownership guard: `_streamSid` + `_streamSuperseded()` in terminal handlers/error paths/catch blocks; `abandonStream()` called by `loadSession` on id switch and `SessionView` unmount. 5 regression tests. |
| B-01 | P2 | 46f2bae | Ingestion defers `daily_cost_ledger` writes until after the embedding loop (pending-meter list + eager cost holder) so the row lock is not held across network calls. |
| B-02 | P2 | 46f2bae | `/check/complete` takes `lock_session_row` before the `get_pending_check` claim; concurrent completes can no longer double-fire the follow-up turn. |
| F-02 | P2 | b505f3e | `user.setActiveUser` resets the session store on any uid change; token refresh (same uid) untouched. |
| F-03 | P2 | 0d0f638 | Copy button wired via delegated click on `MarkdownContent` root (v-html cannot carry handlers) + `.code-block-header`/`.code-block-copy` styles; transient "copied" label. |
| F-04 | P2 | 6276dac | Single-live-stream invariant: `completeCheck`/`sendMessageStreaming` early-return unless `streamState === 'idle'`; check card Skip/Next/Done disabled while streaming (`busy` prop). |
| F-05 | P2 | fa7c9da | Dedicated `writeError` ref rendered as inline `role=alert` banner; load-path `error` no longer set by write failures, profile stays mounted. |
| F-06 | P2 | 71866cb | `continueSession` busy guard + disabled button + swallow-catch (HomeView F-45 pattern); `SidebarSessionRow.onContinueTopic` gains the missing catch. |
| U-01 | P2 | 85a8132 | `MessageList` filters assistant rows with no content/check_batch/tool_calls/citations and no cancelled/partial marker. |
| U-02 | P2 | 054c63b | Removed `mode="out-in"` + leave transition from both route `RouterView`s (enter-only fade). Mechanism pinned to the out-in gap: SessionView's template renders its header unconditionally, so a blank pane can only be a not-yet-inserted route component; the observed "renders after an unrelated interaction" matches an out-in stall. With no leave phase the blank window cannot exist. No unit test (CSS/transition config); re-verified live below. |
| U-03 | P2 | f2213e5 | `reconstruct_check_batch` now reads `selected_index` from the matched `LearningEvent` (stored since migration 0013) instead of hardcoding `None`; recap no longer claims "Answer not recorded" on answered items. No contract change needed (`selected_index` already nullable in the schema). Persisted-column path was already correct. |
| I-01 | P2 | 4256e60 | RUNBOOK step 4 now instructs `VITE_API_BASE_URL` = Render URL **with `/api` appended**, with the 404 consequence spelled out. |
| I-02 | P2 | (this commit) | `ErrorResponse.detail` is now `oneOf [string, CodedErrorDetail]` in `docs/api/openapi.yaml`; `CodedErrorDetail` requires `code` and allows code-specific extras. Contracts regenerated (pinned 0.68.1); FE consumers already parsed the object shape, no FE change. Approved by user post-review. |

## Escalated

- **I-02 (P2)** — initially escalated (contract edit out of run scope); user approved the fix post-review and it landed on this branch (see Fixed table above).
- **U-04 (P3)** — Google Fonts CDN runtime dependency; self-hosting woff2 assets is a dependency-adjacent change. User decided: defer.

## Deferred

All 36 P3 findings (B-03..B-13, F-07..F-20, I-02..I-11 minus the escalations above, U-04, U-05) remain open by design — this run's mandate was P1/P2 only. They are fully specified in the finding bodies above for a follow-up batch.

## Live re-verification (Chrome, rebuilt docker stack, 2026-07-18)

Frontend + backend containers rebuilt from the fix branch and re-checked at
localhost:5173, light and dark themes:

- **U-01 PASS** — Big-O notation session (19 assistant bubbles, the original
  worst offender with 8 recap turns): 0 empty bubbles. Binary Tree session:
  0 empty bubbles.
- **U-02 PASS** — 0-message session ("Introduction to Binary Trees", the
  original repro) renders header/empty-state/composer immediately on open;
  in-place reload of a session view also renders immediately.
- **U-03 PASS** — Binary Tree session (post-migration-0013 events): 3 of 4
  recap items show the "your answer" tag; the single "Answer not recorded"
  note sits on a skipped item. Residual: recaps for batches answered BEFORE
  migration 0013 (e.g. the 2-week-old Glycolysis/Big-O sessions, 21 items)
  still show the note — those events genuinely never stored a
  selected_index, which is unrecoverable and matches the documented
  "None for pre-0013 events" behavior.
- Dark theme spot-checked on the session view: recap card, correct-option
  highlight, note, and bubbles all render on the dark ramp correctly.


