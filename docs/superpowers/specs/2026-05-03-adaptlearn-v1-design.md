# AdaptLearn v1 — Design

**Date:** 2026-05-03
**Status:** Approved (brainstorm phase)
**Goal:** Portfolio-grade adaptive AI tutor with RAG. Full app + recorded walkthrough. 6-week public deadline.

This document supersedes `AdaptLearn_Spec.md` and `AdaptLearn_DevPlan.md` for v1 scope. The originals remain as reference for v2 features.

---

## 1. Constraints (locked during brainstorm)

| Constraint | Decision | Reason |
|---|---|---|
| Deliverable | Full app + 2-3 min walkthrough screencast | Portfolio piece |
| Duration | 7 weeks, public deadline | Stall prevention; bumped from 6 to absorb full-pyramid test cost |
| Profile depth | Mid (not full spec) | LLM tool-call reliability risk; user has no agent experience |
| Agent framework | LiteLLM direct | Avoid ADK + agent-pattern double unknown |
| LLM | Gemini 2.5 Pro via LiteLLM (free tier) | Cost; paid Claude as fallback if reliability issues |
| Embeddings | Gemini text-embedding-004 (free, 768-dim) | Same |
| Backend | FastAPI + SQLite + ChromaDB, dockerized | User said no Firebase; local-first reproducible |
| Frontend | Vue 3 + Vite + PrimeVue + Pinia | Portfolio recognizability |
| Auth | None (localStorage userId) | v1 scope |
| Streaming | None | v1 scope |
| CI | Full pyramid: pytest + Vitest + Playwright + GitHub Actions | Portfolio bullet + regression safety |

---

## 2. Architecture

```
docker-compose.yml
├── frontend  : Vue 3 + Vite (dev) / nginx static (prod). Port 5173.
├── backend   : FastAPI + Uvicorn. Port 8000.
└── chromadb  : chromadb/chroma server. Port 8001.

Volumes:
  ./data/app.db       (SQLite, mounted in backend)
  ./data/uploads/     (PDFs, mounted in backend)
  ./data/chroma/      (ChromaDB persistence)
```

**Why this shape:**
- `docker-compose up` boots whole app — reproducibility + portfolio bullet
- SQLite for relational, ChromaDB for vectors — zero-ops, single-file backups
- ChromaDB server mode (not embedded) — clean separation, scales beyond v1
- FastAPI = Pydantic native, async, OpenAPI auto-docs

**Latency budget:**
- Backend non-LLM response: <100ms
- LLM call dominates wall time (Gemini 2.5 Pro: 3-8s typical)
- No cold start (local docker)

---

## 3. Components

### 3.1 Backend layout

```
backend/
  main.py                    # FastAPI app, CORS, route registration
  agent/
    tutor.py                 # LiteLLM agent loop, tool dispatch
    prompts.py               # IMMUTABLE_RULES + DYNAMIC_CONTEXT_TEMPLATE
    tools.py                 # 3 tool definitions + dispatch handlers
  routes/
    chat.py                  # POST /api/chat
    sessions.py              # /api/sessions CRUD + /end + /quiz
    upload.py                # POST /api/upload (multipart)
    profile.py               # GET /api/profile/{session_id}
  services/
    profile_service.py       # update_topic_profile mid-rules
    retrieval_service.py     # ChromaDB query
    ingestion_service.py     # PDF chunk + embed + index
    summary_service.py       # end_session_now LLM call
    rate_limit.py            # Per-user daily cap
  db/
    models.py                # SQLAlchemy: User, Session, ChatMessage, LearningEvent
    schemas.py               # Pydantic DTOs + TopicProfile schema
    database.py              # Engine + session factory
  lib/
    keyword_index.py         # Porter stem, build/match
    chunking.py              # tiktoken 500-token chunks, 50 overlap
  config.py                  # env vars
```

### 3.2 Frontend layout

```
frontend/src/
  main.js, App.vue, router/index.js
  stores/
    user.js                  # userId, name, prefs, onboarding state
    session.js               # current session, messages, profile
  api/client.js              # axios baseURL=http://localhost:8000/api
  components/
    ChatWindow.vue           # messages, input, Quiz Me button
    OnboardingCard.vue       # title + 2 options
    ProfileSection.vue       # reusable read/edit field
  views/
    HomeView.vue             # sessions grouped by topic
    OnboardingView.vue       # single card (cut from 2)
    SettingsView.vue         # read-only prefs, retake
    NewSessionView.vue       # topic + PDF + 2-way [Fresh/Resume]
    SessionView.vue          # ChatWindow + ingestion banner
    ProfileView.vue          # read-only profile + LearningEvents
```

### 3.3 Tools (LiteLLM format)

Three tools registered on the tutor agent:

1. **`update_topic_profile(session_id, knowledge_level?, add_confirmed_gap?, add_mastered_concept?, focus_target_gap?, focus_clear_reason?, evidence_type)`** — Pydantic-validated patch. `focus_clear_reason` required when clearing focus (server-side guard rail, see §4.4).
2. **`retrieve_chunks(session_id, query, k=5)`** — ChromaDB vector search.
3. **`record_learning_event(session_id, gap_tested, question, correct)`** — log check-question. Side-effect: if `correct=false` and `gap_tested` is in `mastered_concepts`, server-side demote (remove from list).

### 3.4 Mid-profile (simplified vs original spec)

**Kept fields:**
```json
{
  "knowledge_level": "beginner|intermediate|advanced",
  "confirmed_gaps": ["string"],
  "mastered_concepts": ["string"],
  "focus_target_gap": "string|null",
  "last_session_summary": "string|null"
}
```

**Dropped:** mastered_candidates, observed_gaps, evidence_count, tested_positive_count, asymmetric promotion, canonicalization, focus_areas snapshotting, draft summary, stale candidate display.

**Promotion rule (simple):** declared mastery enters `mastered_concepts` directly. Re-test miss removes it. No counters, no candidate gate.

**Evidence types still tracked** (declared/inferred/tested) but only used for filtering: `inferred` mastery is ignored; `declared` and `tested` mastery accepted.

**End-of-focus protocol:** when agent clears `focus_target_gap`, system prompt instructs: generate 2–3 check questions, log each via `record_learning_event`.

---

## 4. Data flow

### 4.1 Chat turn (hot path)

```
ChatWindow → POST /api/chat → routes/chat.py:
  1. rate_limit.check_and_increment → 429 on cap
  2. Load Session + last 20 ChatMessages
  3. keyword_index.match(message, session.kw_index) → retrieval_required
  4. prompts.build(immutable + dynamic_context)
  5. agent.tutor.run(messages, system_prompt, tools)
       on tool_call: dispatch to profile/retrieval/learning_event service
       loop until assistant text final
  6. Persist user + assistant ChatMessage (tool_calls JSON column)
  7. Return { assistant_message, tool_calls, citations }
```

### 4.2 PDF ingestion (background)

```
Upload → save file → ingestion_status="pending" → BackgroundTasks.add()
Background:
  pypdf extract → tiktoken chunk → Gemini embed → ChromaDB add
  build keyword_index, merge into Session
  ingestion_status="ready" (or "failed")

Frontend polls GET /api/sessions/{id} every 3s while banner shown.
```

### 4.3 Session lifecycle

```
NewSession submit:
  if prior session exists:
    if !session_ended: synchronously summary_service.end_now(prior)
    copy topic_profile + last_session_summary
    seed_mode = "resume"
  else:
    seed_mode = "fresh", empty profile
  insert Session, navigate /session/{id}

Close session:
  POST /api/sessions/{id}/end → summary_service.end_now → set session_ended
```

### 4.4 Profile update

```
Tool call: update_topic_profile(..., focus_clear_reason?)
  → profile_service.update:
     validate Pydantic
     load Session.topic_profile (JSON column)
     apply patch:
       knowledge_level: overwrite
       add_confirmed_gap: append if not duplicate (string match)
       add_mastered_concept: append if evidence_type in (declared, tested)
       focus_target_gap: set or clear (with guard rail, see below)
     save
     return {ok: bool, error?: string}
```

**Focus-clear guard rail (server-side):**

Agent reliability on `focus_target_gap` clearing is a known risk (§9). Server enforces:

```python
if current_profile.focus_target_gap is not None and patch.focus_target_gap is None:
    # Agent attempting to clear focus
    if not patch.focus_clear_reason:
        return {ok: False, error: "focus_clear_reason required when clearing focus"}

    if patch.focus_clear_reason == "tested_correct":
        # Require a LearningEvent logged this turn for the focused gap with correct=true
        recent = get_learning_events(session_id, turn=current_turn,
                                     gap_tested=current_profile.focus_target_gap)
        if not any(e.correct for e in recent):
            return {ok: False, error: "tested_correct claim requires logged correct event"}

    # Other reasons (demonstrated, user_redirected) accepted but logged for audit
    log_focus_clear(session_id, current_profile.focus_target_gap,
                    patch.focus_clear_reason, current_turn)
```

`focus_clear_reason` enum: `"demonstrated" | "tested_correct" | "user_redirected"`.

Effect: agent cannot silently clear focus. Either it must log a correct check question that turn (verifiable), or attest a reason that gets recorded for later review. Reduces the "clears too eagerly" failure mode.

---

## 5. Error handling

| Failure | Response |
|---|---|
| Daily cap hit | 429 → toast, disable input until midnight UTC |
| LiteLLM timeout (>30s) | Retry once shorter context → 503 + Retry toast |
| Gemini free-tier rate limit | 429 + countdown toast |
| Tool schema invalid | Agent retry once, then log `tool_calls[].status="failed"`, inline muted notice |
| Retrieval pending/down | Tool returns `{status: "no_results", reason}`, agent continues |
| PDF ingestion failure | `ingestion_status="failed"`, banner shows error |
| `end_session_now` LLM failure | Return `{ok: false}`, fallback to last-5-messages summary |
| SQLite locked | SQLAlchemy WAL retry; persistent fail → 503 |
| Frontend network drop | axios retry once + reload toast |

**Logging:** Python stdlib `logging` to stdout (docker logs). Structured JSON in prod. Tool-call outcomes always persisted on `ChatMessage.tool_calls`.

---

## 6. Testing strategy

Full pyramid: unit + integration + e2e + CI. Tests written per-phase as units come online.

### 6.1 Layers

**Backend unit (pytest)**
- `profile_service` — promotion/demotion rules, evidence-type filtering, focus_target_gap set/clear
- `keyword_index` — Porter stem, frequency threshold, build/match
- `chunking` — token boundaries, overlap, page mapping
- `rate_limit` — increment, 24h reset, cap enforcement
- Pydantic schema validation — accept valid, reject malformed

**Backend integration (FastAPI TestClient + pytest)**
- POST `/api/chat` — mocked LiteLLM, asserts ChatMessage persisted, tool dispatch fires, daily cap returns 429
- POST `/api/upload` — small fixture PDF, asserts ChromaDB collection populated (against in-process Chroma)
- `/api/sessions` CRUD — Resume seeding copies profile, end_session_now sets session_ended
- Tool handler dispatch — invalid schema returns error to agent loop

**Frontend unit (Vitest + @vue/test-utils)**
- ChatWindow — renders messages, send button POSTs, loading state during request
- OnboardingCard — emits select on click
- Pinia stores — user.js persists to localStorage, session.js loads messages

**E2E (Playwright) — introduced Week 4+**
- Phase 1 scaffolding does NOT include Playwright. Backend pytest + frontend Vitest only in Week 2.
- Playwright introduced in Phase 3 (Week 4) once core flows stabilize.
- Scenarios:
  - Onboarding → home → new session → chat happy path (Phase 3)
  - Resume flow: end session → start same topic → profile carried (Phase 3)
  - PDF upload → ingestion banner → ready → cited chat response (Phase 4)
  - Daily cap reached → toast + disabled input (Phase 5)
- Rationale: e2e on shifting UI burns time on test rewrites. Defer until views stabilize.

**LLM-touching tests:** mock LiteLLM responses with deterministic fixtures. Real LLM calls are dogfood/manual only — too flaky and expensive for CI.

### 6.2 CI (GitHub Actions)

`.github/workflows/ci.yml`:
- Trigger: push, PR
- Jobs: backend (pytest), frontend (vitest), e2e (Playwright in container)
- e2e job runs `docker-compose up` then Playwright against running stack
- All jobs must pass to merge

Coverage targets (informational, not gate):
- Backend unit: ≥70% on services/lib modules
- Frontend unit: ≥50% on components/stores
- e2e: 4 happy-path scenarios above

### 6.3 Reliability checkpoints (LLM-driven, manual)

- End of v1 Phase 2: tool-call reliability ≥85% on `update_topic_profile`. Failure → swap to paid Claude Sonnet or iterate prompts.
- End of v1 Phase 3: `focus_target_gap` clearing reliability ≥85% across 4 patterns (linear, topic-shift, tangent, vague-signal). Failure → 3 prompt iterations, then swap model.

These run against real LLM, hand-scripted, not in CI.

Runner for the Phase 3/5 focus-clearing checkpoint:

```
GEMINI_API_KEY=... python backend/scripts/reliability_focus_clear.py --runs 10
```

Loads fixtures from `backend/scripts/focus_patterns/{linear,topic_shift,tangent,vague_signal}.json`, drives `agent.tutor.run` against an in-memory SQLite, reports per-pattern pass rate, and exits 1 if any pattern <85%.

### 6.4 Phase 0 spike

Only formal pass/fail gate for the premise itself (see §7 Phase 0). Spike has its own minimal pytest harness for output diffing — not part of main CI.

---

## 7. Phase plan (collapsed from 11 to 6, 7 weeks total)

### Phase 0 — Validation spike (Week 1, days 1–2, BLOCKING)

Standalone Python script using LiteLLM + Gemini. Three profile pairs (knowledge, guidance, engagement). Run "Teach me about [topic]" through both profiles, 8-turn scripted conversation each. Save outputs side-by-side.

**Pass:** all three pairs differ at turn 1 AND turn 8.
**Knowledge-only pass:** drop interaction_preferences, profile-only.
**Fail:** stop. Pivot or abandon.

Also during Week 1: docker-compose smoke test, ChromaDB integration smoke test, Gemini tool-calling smoke test (verify ≥85% reliability on `update_topic_profile` shape).

### Phase 1 — Scaffold + chat loop + CI baseline (Week 2)

**Code:**
- `docker-compose up` boots Vue + FastAPI + ChromaDB
- SQLAlchemy models, Pydantic schemas, FastAPI routes stubbed
- Tutor agent with LiteLLM, no tools yet
- Single chat round-trip works
- Daily cap enforced

**CI scaffolding (~2 days, Playwright deferred):**
- Backend: pytest + pytest-asyncio + FastAPI TestClient + httpx, conftest fixtures (in-memory SQLite, mocked LiteLLM, fake ChromaDB)
- Frontend: Vitest + @vue/test-utils + jsdom, basic component test
- `.github/workflows/ci.yml` with backend + frontend jobs only (e2e job added Phase 3)
- Playwright NOT installed yet — added in Phase 3 once views stabilize

**Tests written this phase:** rate_limit unit, health endpoint integration, App.vue smoke render. No e2e yet.

### Phase 2 — Tools + mid-profile (Week 3)

**Code:** 3 tools wired. profile_service applies mid-profile rules. focus_target_gap set/clear with end-of-focus check questions. `/api/profile/{id}` JSON debug route. **Tool-call reliability checkpoint at end (see §6.3).**

**Tests:** profile_service unit (all promotion/demotion paths, evidence-type filtering, focus set/clear), Pydantic schema validation suite, chat route integration with mocked LiteLLM emitting tool_calls, e2e "send message → tool fires → profile shows in /dev route".

### Phase 3 — Sessions + Resume + onboarding (Week 4)

**Code:** Session creation with 2-way Fresh/Resume toggle. Resume copies prior profile + summary. Single-card onboarding. Quiz Me button. HomeView lists sessions grouped by topic.

**MLP checkpoint at week 4 end:** 2 days dogfooding without RAG. Decision recorded in `analysis/mlp_checkpoint.md`. Decide whether to build RAG.

**Tests:** sessions CRUD integration, Resume seeding copies profile, end_session_now sets session_ended, OnboardingCard component, user store with localStorage. **Playwright introduced this phase** — install + add `e2e` job to GH Actions + first 2 scenarios: "onboard → new session → chat" and "end session → resume same topic carries profile".

### Phase 4 — PDF + RAG (Week 5)

**Code:** PDF upload, background ingestion, ChromaDB collection per session, keyword index, retrieve_chunks tool, citation rendering, ingestion banner with polling.

**Tests:** chunking unit (token boundaries, overlap, page mapping), keyword_index unit (Porter stem, frequency threshold, build/match), upload route integration with fixture PDF + in-process Chroma, retrieve_chunks tool returns no_results during pending, ChatWindow renders citations, e2e "upload PDF → wait ready → ask note-related question → see citation".

### Phase 5 — Profile view + polish + deploy + record (Weeks 6–7)

**Code:** ProfileView **read-only** (renders all profile sections + LearningEvents grouped, no editing). Settings page, error toasts, daily-cap UI. **Focus-clearing reliability checkpoint (see §6.3).** Production docker-compose with nginx. Deploy locally + record 2-3 min walkthrough screencast. Push public.

**Editable profile lists deferred to v2** (see §11). Reason: editing UI + write-back routes + optimistic concurrency adds ~3 days. Read-only view is enough for the walkthrough story (shows the system's beliefs about the learner — which is the portfolio point). Manual cleanup of stale gaps deferred until needed.

**Tests:** ProfileView component (renders all sections), Settings retake flow, e2e "daily cap reached → toast → input disabled". Coverage final pass: gap-fill any missed branches in profile_service, keyword_index, chunking. CI green on main as merge gate.

---

## 8. Cuts vs original spec

| Original | v1 cut | Reason |
|---|---|---|
| ADK + LiteLLM | LiteLLM only | Avoid framework risk |
| Firebase Cloud Functions | FastAPI in docker | User said no Firebase |
| Firestore vector | ChromaDB | Local-first, no cloud lock-in |
| OpenAI embeddings | Gemini embeddings | Free tier |
| Asymmetric promotion + tightened gate | Direct promotion + retest demotion | LLM-driven complexity risk |
| mastered_candidates, evidence_count, tested_positive_count | None | Same |
| Canonicalization (0.88 cosine) | String match dedup | Manual cleanup via Profile View |
| Three-way Resume toggle | 2-way Fresh/Resume | Simplicity |
| Scheduled finalize_stale_sessions | Synchronous-only end_session_now | No background jobs in v1 |
| Draft + final summary | Final only on close | Simplicity |
| Stale candidate display | Dropped (no candidates) | Cascading from above |
| Two-card onboarding | Single card | YAGNI |
| Focus_areas snapshotting with mode | Just focus_target_gap | YAGNI |
| Phase 11 sharing | Out of scope | Portfolio = walkthrough, not friends |

---

## 9. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Phase 0 spike fails | Pivot to RAG-only or abandon. 2-day budget. |
| Gemini tool-call reliability <85% | Verify in Phase 0 smoke test. Fallback: paid Claude Sonnet (~$10-20 across 6 weeks). |
| Gemini free-tier rate limits during dogfooding | $5-20 paid spend at Phase 4-5 if hitting walls. |
| `focus_target_gap` clearing unreliable | v1 Phase 3 check; 3 prompt iterations then swap model. |
| ChromaDB integration unfamiliar | Smoke test in Week 1 (3 hours). |
| Vue 3 + Pinia + PrimeVue learning curve | Time-box: if Phase 1 not running by end of Week 2, drop PrimeVue, plain HTML. |
| Stall risk (no exam) | Public 7-week deadline + weekly progress posts on X/LinkedIn. |
| Scope creep | This doc is the contract. Anything not in §7 phase plan = v2. |
| Playwright e2e flakiness on CI | Run e2e job non-blocking (warn only) for first 2 weeks; flip to required once stable. Container-level retries=2. |
| Test maintenance eats build time | If any phase falls behind, drop e2e tests for that phase to unit+integration only. Don't drop unit tests. |
| Gemini free-tier limits hit during smoke tests in CI | CI never calls real LLM. All LLM calls mocked. Real-LLM reliability runs are manual. |

---

## 10. Success criteria

1. Phase 0 spike passes (turn 1 AND turn 8 differences).
2. MLP checkpoint passes (no-RAG version is worth continuing).
3. Tool-call reliability ≥85% on profile updates by end of Week 3.
4. Focus clearing reliability ≥85% by end of Week 4.
5. CI green on main: backend unit ≥70%, frontend unit ≥50%, all e2e scenarios passing.
6. 2-3 min walkthrough screencast recorded by end of Week 7.
7. Public repo + writeup posted.

---

## 11. Out of scope (v2 backlog)

- User auth (currently localStorage userId)
- Streaming responses
- Asymmetric profile promotion
- Canonicalization with embeddings
- Three-way Resume (Review gaps mode)
- Scheduled background jobs (finalize_stale_sessions)
- Draft summary maintenance
- Spaced repetition / mastery decay
- Friend sharing (Phase 11 from original)
- OCR / scanned PDFs
- Per-subtopic knowledge level
- Production hosting (cloud deploy)
- **Editable ProfileView** (delete buttons writing back to topic_profile, edit forms for gap/concept lists). Phase 5 ships read-only.

---

## 12. Mid-build alternatives (swap triggers)

Inherited from original spec §13. Defined in advance so swap decisions are mechanical, not panic.

### LLM (tutor model)

**Default:** `gemini/gemini-2.5-pro` via LiteLLM, free tier.

**Swap triggers:**
- Tool-call reliability <85% on `update_topic_profile` after 2 prompt iterations (Phase 2 checkpoint).
- Focus-clearing reliability <85% across 4 patterns after 3 prompt iterations (Phase 3 checkpoint).
- Free-tier rate limits block dogfooding cadence (>10 retry-after rejections per session).

**Swap path:** change `TUTOR_MODEL` env var. LiteLLM handles. Candidates in order:
1. `anthropic/claude-sonnet-4-6` (paid, ~$3/M input). Strongest tool-call reliability.
2. `gemini/gemini-2.5-pro` paid tier (higher rate limits, same model).
3. `openai/gpt-4.1-mini` (paid, fallback if Anthropic unavailable).

Cost estimate at swap: $10–30 across remaining phases.

### Embedding model

**Default:** `gemini/text-embedding-004`, 768-dim, free.

**Swap triggers:**
- Phase 4 retrieval: top-k results don't include obviously relevant chunks across 5 hand-picked queries.

**Swap path:** change `EMBEDDING_MODEL` env var. All chunks must be re-embedded; `embedding_model` field on ChromaDB metadata allows partial re-embedding without full reset. Vector index dimension may need to change (drop and recreate collection).

Candidates: `voyage/voyage-3` (technical content), `openai/text-embedding-3-small` (768-dim drop-in), `cohere/embed-english-v3`.

### Stemmer (keyword index)

**Default:** Porter stemmer via NLTK.

**Swap triggers:** dogfooding reveals false-positive triggers (e.g., "normalization" and "normal form" stem to same root) or false-negative misses on important variants.

**Swap path:** change stemmer in `lib/keyword_index.py`. Porter → Snowball one line. Porter → WordNet lemmatizer adds POS tagging. Re-tokenize all sessions' keyword indexes.

### Vector store

**Default:** ChromaDB server mode in docker-compose.

**Swap triggers:** ChromaDB perf degrades past ~10k chunks (unlikely in v1 dogfooding scope), or operability issues (data corruption, restart loops).

**Swap path:** swap to pgvector (Postgres) — bigger lift, ~2 days. Avoid in v1 unless forced.

### Frontend framework

**Default:** Vue 3 + Pinia + PrimeVue.

**Swap triggers:** PrimeVue learning curve eating Phase 1. Time-box: if `docker-compose up` not showing 6 routes by end of Week 2, drop PrimeVue → plain HTML + minimal CSS.

**Do NOT swap Vue → React** mid-build. That's full rewrite.

### Backend runtime

**Default:** FastAPI + Uvicorn + Python 3.11+ in docker.

**No swap** in v1. Only sane alternative is Node + Hono, which is full rewrite.

### Test pyramid (already deferred Playwright)

**Default after revisions:** pytest + Vitest in Phase 1 (Week 2), Playwright introduced in Phase 3 (Week 4).

**Swap triggers:** any phase falls behind by ≥2 days → drop Playwright tests for that phase, keep unit + integration only. Never drop unit tests.

---

## Appendix A: Original spec → v1 mapping

Original phases 0, 1, 1.5, 2 → **v1 Phase 0–1**
Original phase 3 → **v1 Phase 2** (simplified)
Original phases 4, 5, 5.5 → **v1 Phase 3** (with MLP checkpoint embedded)
Original phases 6, 7 → **v1 Phase 4**
Original phases 8, 9, 10 → **v1 Phase 5**
Original phase 11 → **v2 backlog**
