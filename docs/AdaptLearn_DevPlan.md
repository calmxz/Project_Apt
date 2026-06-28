# Crux — Development Plan

Build plan for Claude Code. Sequential phases with verifiable checkpoints. Read this and `Crux_Spec.md` before starting any phase.

## Ground Rules

- One phase at a time. No combining or jumping ahead.
- Minimal changes; edit only what the task requires.
- No emojis in code or comments.
- Ask before installing dependencies not listed.
- Never commit secrets. API keys go in `.env.local` (gitignored).
- Stop and report if a verification step fails.

---

## Phase 0 — Validation Spike (COMPLETE — Knowledge-dominant pass)

> **Status (2026-05-04):** Spike executed. Decision: knowledge-level differentiation confirmed at turn 1 and turn 8 (clear pass). Guidance + engagement differentiation present but delayed (weak pass on gemini-2.5-flash-lite; re-validate on Claude in Phase 3). `interaction_preferences` retained in spec provisionally. See `spike/decision.md` for full analysis.

**Goal:** Determine whether two manually-crafted profiles produce structurally different tutor responses on the same topic, AND whether the differences hold across a longer conversation.

Zero infrastructure. Just a Python script calling the LLM API with the tutor prompt.

### Tasks

1. Create a `spike/` directory at the project root.
2. Write `spike/run_comparison.py`. Three profile pairs:
   - **Knowledge level.** A = beginner with confirmed_gaps. B = advanced with mastered_concepts.
   - **Guidance.** A = `hints`. B = `direct_answers`. Same topic, same topic_profile.
   - **Engagement.** A = `quiz_as_we_go`. B = `absorb_then_test`. Same topic, same topic_profile.
   For each, run "Teach me about [topic]. I have about 30 minutes." through both profiles using the tutor prompt from spec §4.4. Save to `spike/outputs/{pair}/{A|B}_turn1.md`.
3. Write `spike/run_persistence.py`. Run an 8-turn scripted conversation per profile. Same script for A and B in each pair. Suggested replies at turns 3, 5, 7: vague signals like "Hmm, can you say more?" and "OK got it". Save full transcripts and turn-8 outputs.
4. Read outputs side-by-side. For each pair, answer:
   - Are the explanations structurally different at turn 1 (depth, vocabulary, scaffolding)?
   - Is the difference still visible at turn 8?
   - Would a third party blind to which is which reliably distinguish them?

### Decision

- **Pass:** all three pairs differ at both turn 1 and turn 8. Proceed to Phase 1.
- **Knowledge only:** Pair 1 differs at both turns; Pairs 2 and 3 don't. Drop interaction_preferences entirely; proceed with topic_profile only.
- **First turn only:** all pairs differ at turn 1 but converge by turn 8. Iterate the prompt up to 3 times. If still failing, treat as fail.
- **Fail:** outputs differ only in preamble. Stop and rebuild the spec around a different premise (e.g., RAG-only without inferred personalization).

### Verification

- 6 turn-1 files, 6 turn-8 files, 6 full transcripts in `spike/outputs/`.
- Decision recorded in `spike/decision.md`.

---

## Phase 1 — Project Setup (Local-First, Dockerized Emulators)

**Goal:** Scaffold Vue + Vite + Firebase Emulator Suite (in Docker) + Python Cloud Functions + ADK. Blank app, locally running `health_check` function. **No cloud deploy in v1 until Phase 9.**

### Tasks

1. Phase 0 spike is deferred (see §Phase 0). Don't delete `spike/` — it isn't there.
2. `npm create vue@latest adaptlearn -- --router --pinia --vitest --eslint --prettier` (no TypeScript).
3. `cd adaptlearn && npm install`.
4. `npm install firebase primevue primeicons @primeuix/themes`.
5. `src/firebase.js` initializes from `.env.local` and connects to emulators when `VITE_USE_EMULATOR=true`. Exports `db`, `storage`, `functions`.
6. `.env.local` (gitignored) with `VITE_USE_EMULATOR=true`, `VITE_FIREBASE_PROJECT_ID=demo-adaptlearn`. `.env.example` checked in.
7. Set up PrimeVue (Aura preset) in `src/main.js`.
8. `src/App.vue` with top nav (title + settings icon) + `<router-view />`.
9. Route stubs in `src/router/index.js`: `/`, `/onboarding`, `/settings`, `/new`, `/session/:id`, `/session/:id/profile`. Stub views in `src/views/`.
10. Manually scaffold `functions/`: `main.py`, `requirements.txt`, `requirements-dev.txt`, `tests/`, `agents/`, `tools/`, `lib/`. (No `firebase init` — keeps the project flat and Docker-managed.)
11. `functions/requirements.txt`: `firebase-functions`, `firebase-admin`, `google-adk`, `litellm`, `pydantic`, `nltk`, `pypdf`, `tiktoken`. Installed inside the Docker emulator container's venv on first start.
12. `functions/main.py`: `health_check` HTTPS function returning `{"status": "ok", "adk_version": <version>}`. Smoke pytest verifies the file parses and exposes `health_check`.
13. Project root: `firebase.json` (emulator config), `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`.
14. **Docker setup** (`Dockerfile.emulator` + `docker-compose.yml`): single container with Node 22 + JRE 17 + Python 3.12 + firebase-tools. Exposes ports 4000 (UI), 5000 (Hosting), 5001 (Functions), 8080 (Firestore), 9199 (Storage). Mounts repo and persists Firestore data to `./.firebase-data/` (gitignored).
15. **CI from day one** (`.github/workflows/ci.yml`): Vitest + frontend lint + build, plus pytest smoke. Both must pass on every PR.

### Verification

- `npm run dev` clean; route stubs render placeholders. No console errors.
- `docker compose up emulator` starts the suite; UI reachable at `localhost:4000`.
- `curl http://localhost:5001/demo-adaptlearn/us-central1/health_check` returns 200 with ADK version.
- `npm run test:unit -- --run` passes (frontend smoke).
- `pytest functions/tests` passes (functions smoke).
- GitHub Actions CI green on the initial commit.

**Cloud deploy is intentionally not part of Phase 1.** The spec target stack (Firebase) is preserved; only the local-first run path is added.

---

## Phase 1.5 — Cost Controls (~½ day)

**Goal:** Per-user daily message cap before any real agent runs.

### Tasks

1. `functions/lib/cost_controls.py`: `check_and_increment_daily_count(user_id) -> bool`. Reads User doc, resets counter if > 24h old, returns false if at cap, otherwise atomically increments and returns true.
2. `DAILY_CAP` from env config. Default 200.
3. Stub `chat` HTTPS callable in `functions/main.py`: cap check → daily_cap error or placeholder response.
4. Temporary `/dev/cap-test` route to manually verify.

### Verification

- With `DAILY_CAP=3`, the 4th call returns `daily_cap` error.
- Backdating `daily_count_reset_at` 25h resets the counter on next call.
- Restored to 200.

---

## Phase 2 — Tutor Agent Skeleton (No Tools)

**Goal:** TutorAgent talks to frontend through `chat`. Split prompt structure (immutable + dynamic) from the start.

### Tasks

1. `functions/lib/prompts.py`: `IMMUTABLE_RULES` and `DYNAMIC_CONTEXT_TEMPLATE` constants from spec §4.4. Export `build_system_prompt(context_dict)`.
2. `functions/agents/tutor.py`: TutorAgent. Read tutor model from a single `TUTOR_MODEL` constant. No tools yet. Hardcode placeholders not yet plumbed.
3. Update `chat`: cap check → load User and Session → build prompt → run agent → persist messages.
4. `src/components/ChatWindow.vue`: scrollable message list, input bar, send button.
5. Temporary `/dev/chat-test` route with hardcoded User and Session for smoke testing. Deleted in Phase 4.

### Verification

- `/dev/chat-test` returns a tutor response within 15s.
- Cloud Function logs show the immutable + dynamic prompt structure.
- Messages persist to subcollection.
- Daily counter increments.

---

## Phase 3 — Tools, Profile Logic, Force Quiz, Profile JSON Viewer

**Goal:** Wire all three agent tools and both HTTPS callables. Implement evidence-type-aware promotion with the tightened gate. `focus_target_gap` set/clear and `focus_areas` writing. Draft summary writing. Single 0.88 canonicalization. **Add minimal `/dev/profile/:session_id` JSON dump for debugging during this phase.**

This is the first ADK reliability checkpoint. If tool calls fail more than ~15% of the time across the verification cases, swap to LiteLLM direct (Spec §13) before continuing.

### Tasks

1. Pydantic schemas matching spec §3.2 and §4.1.
2. `functions/lib/canonicalize.py`: `canonicalize_gap(session_id, candidate_text)` — embed candidate, cosine-compare to existing gaps in session, return existing gap text if > 0.88 (caller merges) or candidate text otherwise.
3. `functions/tools/profile.py`:
   - `update_topic_profile(session_id, updates, evidence_type)`:
     - Schema-validates; rejects unknown fields.
     - Runs `canonicalize_gap` for new gap entries; merges if matched.
     - Asymmetric branching: declared gaps → confirmed_gaps directly. Declared mastery → mastered_candidates only. Inferred follows the candidate path.
     - Tightened exit gate to mastered_concepts: 2 tested-positive across distinct contexts (turns/focus areas/sessions) OR 1 tested + 2 inferred.
     - `focus_target_gap` updates also write to the Session's `focus_areas` array (set: append entry with `set_at_turn`, snapshotted modes; clear: update matching entry's `cleared_at_turn`).
     - `last_session_summary_draft` updates supported.
     - On contradicting evidence: demote with `demotion_reason`, reset `tested_positive_count` to 0.
   - `record_learning_event(session_id, gap_tested, question, correct)`:
     - Canonicalizes `gap_tested`.
     - Resolves `focus_area_index` from current focus_areas.
     - Creates LearningEvent.
     - Increments `tested_positive_count` on the candidate (does NOT promote on its own).
     - Appends to `focus_areas[idx].check_questions`.
4. Register tools on TutorAgent.
5. Implement `end_session_now(session_id)` HTTPS callable. Idempotent (returns early if `session_ended == true`). Reads draft, runs a `summarize_session` agent invocation (using `TUTOR_MODEL`), writes `last_session_summary`, sets `session_ended = true`. **Returns success/failure status.** Does not throw on LLM error.
6. Implement `force_check_questions(session_id)` HTTPS callable. Thin wrapper around the chat agent loop with a synthesized "[FORCE_QUIZ_REQUESTED]" user message. Agent identifies the gap (uses `focus_target_gap` if set; otherwise asks the user to clarify). Generates 2–3 questions, runs end-of-focus-area protocol, clears focus, schedules `end_session_now`.
7. Scheduled `finalize_stale_sessions` (every 30 min): same routine as `end_session_now`. One attempt per scheduled run; failures retried on next run.
8. Update `chat` to expose session_id and turn count to tools.
9. Log all tool calls on ChatMessage's `tool_calls` array.
10. **`/dev/profile/:session_id` route:** read Session doc, render JSON-stringified `topic_profile`, `focus_areas`, and most recent ChatMessage's `tool_calls` in `<pre>` blocks. Reload button.

### Verification

- 5-turn beginner-confusion conversation: knowledge_level set, observed_gaps populated.
- Asymmetric declared rules:
  - "I've never used recursion" → confirmed_gaps directly.
  - "I already understand normalization" → mastered_candidates, NOT mastered_concepts.
- Tightened mastery exit:
  - Concept in candidates with 1 positive test stays in candidates (`tested_positive_count: 1`).
  - 2 positive tests in same focus area: still candidates.
  - 2 positive tests across different focus areas: promotes.
  - Alt path: 1 positive test + 2 distinct inferred observations: promotes.
- focus_target_gap and focus_areas: set, demonstrate understanding correctly, agent clears, focus_areas entry has `cleared_at_turn` populated and check_questions logged.
- Draft summary: 6-turn conversation, draft populated by turn 3 and updated by turn 6.
- `/dev/profile/:session_id` shows the same state visible in Firestore.
- `end_session_now`: idempotent, returns success/failure status without throwing.
- Force Quiz: with focus set, generates 2–3 check questions; with no focus, asks user to clarify.
- Schema rejection: bad payload, retries once, logs `status: "failed"`.
- Demotion on contradiction: promoted concept gets a wrong test answer → demoted, counter reset.

---

## Phase 4 — Onboarding + Mid-Session Override

**Goal:** Two-card onboarding. interaction_preferences saved to User doc. Agent honors mid-session overrides via the prompt.

### Tasks

1. `src/stores/user.js`: state for userId, name, interactionPreferences, onboardingComplete. Actions: loadUser, saveInteractionPreferences.
2. First-visit flow: prompt for display name, generate userId via `crypto.randomUUID()`, store both in localStorage, create User doc with `daily_message_count: 0`.
3. `src/components/OnboardingCard.vue`: title + two option buttons. Emits select.
4. `src/views/OnboardingView.vue`: two cards in sequence, progress indicator. On completion save preferences and redirect to `/`.
5. Route guard: `/` with `onboarding_complete: false` redirects to `/onboarding`.
6. Delete `/dev/chat-test` and `/dev/cap-test`.

### Verification

- Incognito visit redirects to `/onboarding`.
- Completing both cards writes interaction_preferences and lands on `/`.
- Mid-session override: in a `hints` session, "just tell me" flips behavior; "actually let me try first" flips back. Override doesn't persist to next session.

---

## Phase 5 — Session Creation, Multi-Session, Three-Way Toggle, Resume Finalization with Retry Cap, Force Quiz Button

**Goal:** Session creation, three-way toggle with default tracking, synchronous Resume finalization with one-attempt cap, "Quiz me on this" button.

### Tasks

1. `src/views/NewSessionView.vue`:
   - Topic input. On topic blur, query for most recent prior Session for (user_id, topic).
   - If found: three-way toggle [Start fresh | Resume | Review gaps] with summary preview and one-line descriptions.
   - Compute `seed_mode_default`: "resume" if < 14 days, "review_gaps" otherwise. Pre-select toggle to default.
   - Track `seed_mode_was_overridden = (selection !== default)`.
   - PDF upload control (functional in Phase 6 — placeholder for now).
   - On submit with Resume or Review gaps and `source.session_ended == false`:
     1. Show brief loading state.
     2. Call `end_session_now(source.id)`. Inspect status.
     3. **Success:** read source again (now finalized), copy topic_profile and last_session_summary.
     4. **Failure:** warning toast ("Couldn't finalize previous session — seeding from draft"). Read source as-is, use draft as seed summary. Do NOT call end_session_now again synchronously.
   - Create Session with all fields including `seed_mode`, `seed_mode_default`, `seed_mode_was_overridden`, `seeded_from_session_id`.
   - Navigate to `/session/:id`.
2. `src/views/SessionView.vue`: renders ChatWindow. Updates `last_activity_at` and `updated_at` per message. "Close session" button calls `end_session_now`, navigates to Home (no retry cap on Close — retrying is fine).
3. **"Quiz me on this" button in ChatWindow header:**
   - Visible whenever there's chat history.
   - On click: brief loading state, calls `force_check_questions`. Response appears as normal assistant message.
   - Disabled while a chat call is in flight or daily cap is hit.
4. `src/views/HomeView.vue`: Sessions sorted by `updated_at` desc, grouped by topic. Cards show topic, date, knowledge_level badge, summary excerpt.
5. Chat function injects all dynamic context fields including `seed_mode_default` and `seed_mode_was_overridden`.

### Verification

- Three sessions on different topics: appear on Home, most recent first.
- Two sessions on same topic, normal Resume: source finalized in background by scheduled function; new session seeds from final summary.
- Back-to-back sessions: finish A without Close → start Resume on same topic within 1 min → brief loading → A's `session_ended = true`, last_session_summary populated → B seeded with finalized state.
- Retry cap: disable LLM API key, attempt back-to-back Resume → loading → warning toast → chat opens with draft seeding. No infinite loop. Re-enable, scheduled function picks it up.
- seed_mode tracking:
  - Recent + accept default Resume: `seed_mode_was_overridden = false`.
  - Stale + accept default Review gaps: false.
  - Stale + override to Resume: true. Agent's first turn offers refresher.
  - Recent + override to Review gaps: true. Agent opens with structured review.
- Force Quiz button: real session, click button, get 2–3 check questions, answer them, LearningEvents created.
- Force Quiz disabled: while chat in flight, while at daily cap.

---

## Phase 5.5 — MLP Checkpoint (1 day)

**Goal:** Before building RAG, confirm the no-RAG version is on a path worth continuing.

No code. Use the system as-is on real coursework for 2–3 sessions over 2–3 days, using Resume between them. Document in `analysis/mlp_checkpoint.md`:

- Did the agent's general knowledge feel sufficient (without RAG)?
- Did session-to-session continuity feel valuable?
- Did the eval hook catch real weak spots?
- Would the developer prefer this over Claude.ai or ChatGPT for this topic — without RAG?

### Decision

- **Yes:** continue to Phase 6.
- **Yes with caveats:** continue, knowing RAG carries the value.
- **No:** stop. Iterate Phase 3 logic or pivot. Don't build RAG on a flawed core.

---

## Phase 6 — PDF Ingestion, Embedding, Keyword Index

**Goal:** PDFs uploaded, chunked, embedded, indexed. Keyword index built per session. `ingestion_status` reflects pipeline state.

Default embedding model: OpenAI `text-embedding-3-small`. Switch (Spec §13) only if Phase 7 retrieval is poor.

### Tasks

1. PDF upload control wired in NewSessionView and SessionView. Files go to `users/{userId}/sessions/{sessionId}/{filename}`.
2. On upload start (client): set `ingestion_status = pending`.
3. `functions/lib/keyword_index.py`: `build_keyword_index(text)` — tokenize (lowercase, alphanumeric, length ≥ 4), remove NLTK English stop words, Porter stem, keep stems with frequency ≥ 2. Return sorted unique list.
4. Cloud Function `ingest_pdf` triggered by Storage upload events:
   - Set `ingestion_status = pending`.
   - Download PDF, extract text per page (`pypdf`), chunk at 500 tokens with 50-token overlap (`tiktoken`).
   - Embed each chunk with the chosen model.
   - Write chunks to `chunks` collection with `embedding`, `embedding_model`, `page_number`, `source_pdf_id`, etc.
   - Update Session's `pdf_ids`.
   - Build keyword index from full extracted text; merge with existing `keyword_index` (sorted unique).
   - Full success: `ingestion_status = ready`. Partial: `partial`.
5. Firestore composite vector index on `chunks.embedding`, scoped by session_id.
6. Ingestion banner in SessionView reflecting status.

### Verification

- 10-page PDF: chunks populated within ~30s, status transitions none → pending → ready.
- Each chunk has non-empty embedding of expected dimension and correct embedding_model.
- keyword_index includes expected stems (e.g., "normal" from "normalization", "join" from "joins/joining"), excludes stop words and short tokens.
- Second PDF on same session: chunks added, status briefly pending, keyword_index grows.
- Chat message during pending: Cloud Function logs show `INGESTION_STATUS = pending` in prompt.

---

## Phase 7 — `retrieve_chunks`, Server-Side Keyword Trigger, Citations

**Goal:** Agent calls `retrieve_chunks` for note-related questions. Keyword check is server-side; only the boolean enters the prompt. Citations rendered.

### Tasks

1. `functions/tools/retrieval.py`: `retrieve_chunks(session_id, query, k=5)`. Reads `ingestion_status`; returns `{status: "no_results", reason: ...}` for pending/none/timeout/empty. Otherwise embeds query with same model as Phase 6 and runs vector search filtered by session_id.
2. Register on TutorAgent.
3. Server-side keyword check in `chat`: load Session's `keyword_index`, tokenize and stem incoming message, intersect, set `retrieval_required = (intersection non-empty)`. Persist on user ChatMessage. Inject ONLY `[RETRIEVAL: REQUIRED | OPTIONAL]` into prompt — never the index array.
4. Render citations in ChatWindow as small annotations under the assistant message ("Source: lecture3.pdf, page 4").

### Verification

- Question with PDF terms after ingestion ready: `retrieval_required: true`, agent calls retrieval, cites source.
- Stemming bridges variants: PDF has "joins", question is "joining tables" → still triggers (both stem to "join").
- General question with no PDF terms: `retrieval_required: false`, no retrieval call.
- Confirm `keyword_index` array is NOT in the prompt body (inspect Cloud Function logs).
- Pending ingestion + question about notes: `retrieval_required: false` (index empty); agent says notes are still being read.
- Conflict test: fake passage in PDF contradicts general knowledge; agent surfaces the conflict explicitly.

---

## Phase 8 — Eval Hook + Profile View

**Goal:** End-of-focus-area check questions reliably triggered by `focus_target_gap` clearing. Profile View shows pedagogical-efficiency stats and stale candidates. Second ADK reliability checkpoint.

### Tasks

1. `src/views/ProfileView.vue` at `/session/:id/profile`:
   - Read-only header: knowledge_level, summary, last_session_summary (or draft).
   - "Currently focusing on:" indicator if focus_target_gap set.
   - Editable lists for mastered_concepts, mastered_candidates, confirmed_gaps, observed_gaps with delete buttons writing back to topic_profile.
   - **Stale candidates collapsed section:** entries with `first_seen_session_id` more than 3 sessions back from current and not promoted, in a `<details>` block.
   - **Focus-area summary stats:** total focus areas, average turns to clear, average turns to clear by `guidance_mode`, per-focus-area mini-table.
   - LearningEvents grouped by canonicalized gap_tested with correctness.
   - "Seeded from session [link]" if seeded.
2. "View profile" link from Chat.
3. **Reliability check:** run varied conversations:
   - Linear: ask about gap A, work through, demonstrate understanding → focus clears, checks fire.
   - Topic shift: ask about A, then "let's look at B" → focus clears (with checks), then sets to B.
   - Tangent: ask about A, then clarifying question still about A → focus does NOT clear.
   - Vague signal: "OK got it" without demonstration → does NOT clear.
4. **If clearing reliability is below ~85% across these patterns:** iterate the prompt (more concrete examples, per-turn reminder in dynamic context). If three iterations don't fix it, swap to LiteLLM direct (Spec §13).

Force Quiz events also produce LearningEvents with `focus_area_index` linking; verify they appear in Profile View like agent-triggered ones.

### Verification

- Profile View renders all sections.
- Stale candidates collapse correctly across 5 sessions on same topic.
- focus_target_gap clearing reliability ≥ 85% across the four patterns.
- Force Quiz events appear correctly in Profile View.

---

## Phase 9 — Settings, Polish, Internal Deploy

**Goal:** Settings page, error handling, security rules, FIRST cloud deploy (preview channel). **No public URL.**

This phase is the first time anything leaves the developer's machine. Phases 1–8 ran entirely against the Dockerized emulator suite.

### Tasks

1. `src/views/SettingsView.vue`: read-only interaction_preferences as cards. "Retake onboarding" button (clears `onboarding_complete`).
2. Loading spinners in ChatWindow during agent responses.
3. PrimeVue Toast for failed Cloud Function calls with Retry button.
4. Tool failure inline notice: muted "Couldn't update profile, continuing" when ChatMessage `tool_calls` has `status: failed`.
5. Daily-cap toast: clear message + disable input bar until midnight.
6. Firestore security rules: doc readable/writable only if request's userId matches doc's user_id.
7. Deploy to preview channel (private URL).

### Verification

- Settings shows preferences, retake works.
- Error toast appears on broken API key, retry works.
- Tool failure inline notice renders when Firestore writes for profile tool fail.
- Daily-cap toast appears at cap (test with `DAILY_CAP=3`, then restore to 200).
- Preview deploy works end-to-end.

---

## Phase 10 — Self-Validation (Solo Dogfooding)

**Goal:** Use the system on the developer's own real coursework. Decide qualitatively whether the inferred-profile premise is doing real work.

### Tasks

1. Pick 2 distinct topics actively studied. Run at least 3 sessions per topic on different days.
2. After each session, look at:
   - Does `knowledge_level` track real self-assessment?
   - Are `confirmed_gaps` real gaps?
   - Are `mastered_concepts` actually mastered (tightened gate makes false-positives rarer)?
   - Did the eval hook catch real weak spots?
3. After at least one Resume per topic: did the seeded session feel meaningfully different from a Start-fresh would? (Optional A/B with same opening prompt.)
4. **Pedagogical-efficiency check:** for sessions in `hints` vs `direct_answers`, compare average turns-to-clear and per-focus-area correctness. Does `hints` produce different turns-to-clear, AND does correctness justify it?
5. Document in `analysis/self_validation.md`. Final question: would the developer comfortably subject friends to this?

### Decision

- **Strong yes:** proceed to Phase 11.
- **Mixed:** strip underperforming features, retest for a week.
- **Strong no:** strip the inferred-profile layer to RAG-only, retest in 2 weeks. Don't share.

Default if ambiguous: don't share yet.

---

## Phase 11 — Sharing (Optional Gate)

**Goal:** Public deploy + 2–3 friends. Feedback collected.

Entry condition: Phase 10 produced "go." This phase is genuinely optional. Don't enter from sunk cost.

### Tasks

1. `DAILY_CAP=50` in production env.
2. Audit security rules and API key configuration.
3. Production deploy: `npm run build && firebase deploy`.
4. Send URL to 2–3 friends with one-paragraph context.
5. Watch each friend onboard live. Take notes on card choices, first topic, PDF upload, engagement with check questions.
6. After a week: ask plainly whether it felt useful. Document in `analysis/share_feedback.md`.

### Verification

- 2–3 friends have access; at least one onboards without intervention.
- Feedback document captures observed onboarding, week-later usage, direct feedback.

---

## Testing Strategy

CI gates every push from Phase 1 onward. Two suites:

- **Frontend (Vitest):** unit + component tests in `adaptlearn/src/__tests__/` and `adaptlearn/src/**/*.test.js`. Required to pass before merge.
- **Functions (pytest):** unit tests in `adaptlearn/functions/tests/`. Smoke tier runs on every push (no heavy deps); full tier runs once Phase 2 is complete and `firebase-functions` becomes a real dependency.

GitHub Actions workflow at `.github/workflows/ci.yml`. Phase verification (manual end-to-end) is still the primary correctness check; CI catches regressions and import-time breakage.

Test pyramid expectations per phase:
- Phase 1: smoke tests only (1 frontend + 1 functions, both green).
- Phase 2 onward: every Cloud Function gets a unit test; every Vue view that does non-trivial work gets a component test.
- Phase 8: end-to-end Playwright suite added (deferred from Phase 5 per design doc §12).
- Phase 10: full pyramid coverage check.

---

## Known Risks

- **Phase 0 fails.** Stop and rewrite the spec. This is the most important risk; the plan exists to surface it early.
- **ADK tool reliability.** Phase 3 and Phase 8 are the checkpoints. Escape hatch is LiteLLM direct (Spec §13).
- **`focus_target_gap` clearing reliability.** Phase 8 verification is the early-warning system. Force Quiz button is the user-side escape hatch. Prompt iteration first; framework swap second.
- **Tightened mastery gate too strict.** If `mastered_concepts` never populates during dogfooding, loosen the thresholds. Watch in Phase 10.
- **Resume finalization latency** (5–10s on back-to-back sessions). Acceptable for v1; the retry cap prevents indefinite blocking. If painful, optimize the summary call (smaller model, shorter prompt).
- **Cloud Function cold starts** (2–3s first request). Acceptable for v1. Migration path in Spec §13 if it becomes painful.
- **Phase 10 ambiguous.** Default is don't share. Resist sunk-cost pressure to enter Phase 11 anyway.

---

## File Structure Target

```
adaptlearn/
  .env.local (gitignored)
  .gitignore
  firebase.json
  firestore.rules
  firestore.indexes.json
  functions/
    main.py
    requirements.txt
    agents/tutor.py
    tools/
      profile.py
      retrieval.py
    lib/
      prompts.py
      canonicalize.py
      keyword_index.py
      cost_controls.py
    schemas.py
  src/
    App.vue
    main.js
    firebase.js
    router/index.js
    stores/
      user.js
      session.js
    components/
      ChatWindow.vue
      OnboardingCard.vue
    views/
      HomeView.vue
      OnboardingView.vue
      SettingsView.vue
      NewSessionView.vue
      SessionView.vue
      ProfileView.vue
      DevProfileView.vue
  analysis/
    mlp_checkpoint.md
    self_validation.md
    share_feedback.md
  package.json
  vite.config.js
```

---

## When Done

Two valid stopping points:

- **End of Phase 10**, with a working local app the developer trusts and uses on real coursework. Complete v1 even without sharing.
- **End of Phase 11**, with the system shared and feedback collected.

Success criteria (Spec §10):

1. Phase 0 validation passed (turn 1 AND turn 8).
2. Phase 5.5 MLP checkpoint passed.
3. Eval hook produces signal qualitatively per Spec §8.
4. The developer trusts the system enough to want to share it.