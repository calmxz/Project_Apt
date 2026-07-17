> **HISTORICAL DOCUMENT.** This describes the original Firebase / Google ADK /
> Firestore architecture, which was replaced in Phase 7 by Supabase Postgres +
> pgvector + Supabase Auth with LiteLLM direct. It is retained as v2 reference
> only. Current source of truth: `docs/superpowers/specs/2026-05-03-crux-v1-design.md`.

# Crux

**Adaptive AI Study Companion — Project Specification**

---

## 1. Overview

A web app that teaches a user a topic of their choice, adapting both content and delivery based on a live profile of their knowledge. The agent grounds explanations in user-uploaded course material via RAG.

**Target user (v1):** the developer, dogfooding their own coursework. Sharing with friends is a separate gated phase.

**Core value:** A tutor that updates its model of the learner continuously, grounded in their actual course material — not a generic chatbot with a system prompt.

---

## 2. Core User Flow

### 2.1 Onboarding (One Time)

Two cards, binary choices, ~15 seconds:

- **When I'm stuck:** "Give me a hint" vs. "Just tell me the answer"
- **Engagement:** "Quiz me as we go" vs. "Let me absorb, then test me"

Saves as `interaction_preferences` on the User document. Retake from Settings.

### 2.2 Per-Topic Flow

1. Choose a topic (free text).
2. Optional: upload PDFs.
3. Learn. Single chat opens. Tutor probes briefly (or skips if a recent profile exists), then teaches. Profile updates happen via tool calls throughout.

### 2.3 Returning to a Topic

Multiple sessions per (user, topic). New Session screen offers:

- **Start fresh** — empty profile.
- **Resume** — profile seeded from most recent prior session. Default if < 14 days old.
- **Review gaps** — seeded; agent's first turn is structured review over `confirmed_gaps`. Default if older than 14 days.

The UI tracks both the default (based on age) and the user's actual selection so the agent knows whether the user accepted the recommended mode.

When Resume or Review gaps is selected and the source session's `session_ended` is false, the seeding logic calls `end_session_now(source_session_id)` synchronously before copying state. **Retry cap: one synchronous attempt only.** On failure, falls through to seeding from the draft summary with a warning toast. The 30-minute scheduled `finalize_stale_sessions` keeps retrying in the background.

This prevents profile purgatory: a single failing finalization should not block session creation indefinitely.

`seeded_from_session_id`, `seed_mode`, `seed_mode_default`, and `seed_mode_was_overridden` are recorded on the new Session.

---

## 3. Learner Profiles

### 3.1 Interaction Preferences (User-Level)

```json
{
  "guidance_preference": "hints" | "direct_answers",
  "engagement_preference": "quiz_as_we_go" | "absorb_then_test"
}
```

Mid-session override allowed via natural language ("just tell me", "let me try first"). Session-scoped only — does not persist to the User document.

### 3.2 Topic Profile (Session-Level, Seeded Across Sessions)

```json
{
  "knowledge_level": "beginner" | "intermediate" | "advanced",
  "mastered_concepts": ["string", "..."],
  "mastered_candidates": [
    {
      "concept": "string",
      "evidence_count": 1,
      "tested_positive_count": 0,
      "first_seen_session_id": "string",
      "last_evidence_at": "timestamp"
    }
  ],
  "confirmed_gaps": ["string", "..."],
  "observed_gaps": [
    { "gap": "string", "first_seen_turn": 4, "evidence_count": 1 }
  ],
  "focus_target_gap": "string" | null,
  "last_session_summary": "string" | null,
  "last_session_summary_draft": "string" | null,
  "summary": "string" | null
}
```

`knowledge_level` is a coarse baseline. When it conflicts with `mastered_concepts` or `confirmed_gaps`, the granular fields win.

#### Evidence Types

Every profile update carries an `evidence_type`:

- **`declared`** — user used genuinely declarative wording ("I've never used recursion", "I already understand normalization").
- **`inferred`** — agent observed it from how the user answered or asked.
- **`tested`** — came from a `record_learning_event` outcome.

Examples of declared vs. inferred:

| Statement | Type |
|---|---|
| "I've never heard of B-trees." | declared (gap) |
| "I already know normalization." | declared (mastery → candidate) |
| "I don't really get why we'd use a B-tree here." | inferred |
| "I think I understand foreign keys?" | inferred (hedged) |

When in doubt, classify as `inferred`.

#### Promotion Rules (Asymmetric Entry, Tightened Exit)

For **gaps:**
- `inferred` → `observed_gaps`. Promotes to `confirmed_gaps` after 2 distinct turns OR one negative tested event.
- `declared` → `confirmed_gaps` directly. The user's word about not knowing something is taken at face value.
- `tested` negative → `confirmed_gaps`.

For **mastery:**
- `inferred` → `mastered_candidates`.
- `declared` → `mastered_candidates`. Does NOT bypass the candidate gate. Dunning-Kruger is a real failure mode.
- `tested` positive → increments `tested_positive_count`. Does not promote on its own.

**Promotion to `mastered_concepts`** requires one of:

1. Two tested-positive events on the same gap, separated by either a different question phrasing AND at least one full intervening turn within the same session, OR distinct focus areas, OR distinct sessions.
2. One tested-positive event PLUS at least 2 inferred observations across distinct turns.

A single positive `record_learning_event` does NOT promote. Counters increment; promotion fires only when the threshold is met.

Contradicting evidence demotes back to `mastered_candidates` with `demotion_reason`; `tested_positive_count` resets to 0.

#### `focus_target_gap`

Agent sets this when starting work on a specific gap, clears it when the focus area completes. Clearing is the primary trigger for the end-of-focus-area check-question protocol.

User-driven escape hatch: a "Quiz me on this" button calls `force_check_questions(session_id)`, running the protocol regardless of state. Not a heuristic — explicitly user-invoked.

#### `focus_areas` Tracking

Each Session carries a `focus_areas` array recording every cycle:

```json
{
  "gap": "string (canonicalized)",
  "set_at_turn": 3,
  "cleared_at_turn": 9,
  "guidance_mode": "hints" | "direct_answers",
  "engagement_mode": "quiz_as_we_go" | "absorb_then_test",
  "check_questions": [{ "question": "...", "correct": true }]
}
```

`guidance_mode` and `engagement_mode` are snapshotted at the time the focus area was set, so mid-session overrides are visible in Phase 10's pedagogical-efficiency analysis (turns-to-clear by mode).

#### `last_session_summary` and Draft

The agent updates `last_session_summary_draft` after each substantive turn. The 30-minute scheduled `finalize_stale_sessions` promotes draft to final and locks it. The synchronous `end_session_now` callable runs when the user clicks "Close session," after a Force Quiz completes, or during Resume seeding (with the retry cap).

If finalization never runs, the most recent draft serves as the summary fallback. Continuity isn't gated on a single point of failure.

#### Gap Canonicalization

Single 0.88 cosine threshold against existing gaps in the session. Above threshold: merge (increment `evidence_count`). Below: append as new entry. Stemming (Porter) normalizes morphological variants before comparison.

If duplicates accumulate, the Profile View has delete buttons. No async batch arbitration in v1 — this is a JSON document for one user; manual cleanup is fine.

#### Stale Candidate Display

Un-promoted candidates with `first_seen_session_id` more than 3 sessions back render in a collapsed Profile View section.

---

## 4. Agent Design

One agent (TutorAgent) with three tools.

### 4.1 Tools

- **`retrieve_chunks(query, k=5)`** — vector search against session's PDF chunks.
- **`update_topic_profile(updates, evidence_type)`** — schema-validated profile patch with the asymmetric/tightened rules from §3.2.
- **`record_learning_event(gap_tested, question, correct)`** — logs check-question outcome.

**HTTPS callables (not agent tools):**
- `end_session_now(session_id)` — finalization. Returns success/failure status.
- `force_check_questions(session_id)` — user-driven check-question trigger.

### 4.2 Tool Failure Policy

- Schema validation rejection: structured error to agent, retry once. Final failure logged with `status: "failed"`.
- Retrieval timeout/empty/pending: returns `{ status: "no_results", reason: ... }`. Agent must check before claiming notes don't cover something.
- Daily cap exceeded: `{ error: "daily_cap" }`; agent does not run.
- `end_session_now` failure: returns failure status. Caller (Resume seeding logic) handles fall-through to draft.

All tool outcomes logged on ChatMessage's `tool_calls` array.

### 4.3 Retrieval Arbitration

#### Server-Side Keyword Check

At PDF ingestion, build a per-session `keyword_index`: tokenize chunked text, remove stop words, Porter-stem, keep stems appearing ≥ 2 times. Store on Session.

The match runs in the `chat` Cloud Function:
1. Tokenize and stem the user's incoming message with the same rules.
2. Compute intersection with `keyword_index`.
3. Set `retrieval_required = (intersection is non-empty)`.
4. Inject ONLY the boolean `[RETRIEVAL: REQUIRED | OPTIONAL]` into the prompt — never the index array itself.

This avoids spending tokens on a 200–500 entry list per session.

#### Agent Judgment (When `retrieval_required` is False)

- Call retrieval when the user references their notes or asks something specific to course material.
- Skip for general background questions.

#### Conflict Handling

When retrieved chunks contradict prior knowledge, surface the conflict explicitly: "Your notes state X, though the conventional definition is Y."

### 4.4 System Prompt

Two parts: **immutable rules** (constant) and **dynamic context** (rebuilt per turn).

#### Immutable Rules

```
You are a tutor.

PROFILE PRINCIPLES:
- knowledge_level is a coarse baseline. mastered_concepts and confirmed_gaps take precedence when they conflict.
- declared GAPS go directly to confirmed_gaps. The user's word about not knowing something is taken at face value.
- declared MASTERY only enters mastered_candidates. The user's claim about knowing something is verified before promotion.
- Promotion to mastered_concepts requires 2 tested-positive events (across distinct contexts) or 1 tested-positive plus 2 inferred observations. The tool handles this — call update_topic_profile with the right evidence_type.

EVIDENCE TYPING:
- "declared": user used genuinely declarative wording ("I've never heard of X", "I already know X").
- "inferred": you observed it from how the user answered or asked.
- "tested": fact came from a check-question outcome (record_learning_event sets this).
- When in doubt, classify as inferred.

FOCUS PROTOCOL:
- When you decide to focus on a specific gap, set focus_target_gap via update_topic_profile.
- Clear focus_target_gap when:
  - The user demonstrates understanding through a clean explanation or correct application.
    Example: "Oh, so it's like a lookup table for foreign keys" — clear (if correct).
    Example: "I think I see" without demonstration — don't clear.
  - A record_learning_event for that gap returns correct=true.
  - The user explicitly redirects ("OK that's enough about joins, let's look at indexes").
- Do NOT clear just because turns passed or the user said "OK".
- Clearing is the primary trigger for the check-question protocol. The user can also manually trigger via "Quiz me on this" — run the protocol regardless of focus state in that case.

END-OF-FOCUS-AREA PROTOCOL:
When you clear focus_target_gap (or the user triggers Quiz me on this), generate 2-3 check questions covering the gaps that motivated the focus area. Call record_learning_event for each answer.

DRAFT SUMMARY MAINTENANCE:
After each substantive exchange, update last_session_summary_draft via update_topic_profile. 1-2 sentences: what was covered, what the user understood, what gaps remain.

OVERRIDE HANDLING:
If the user explicitly overrides ("just tell me", "stop hinting"): switch to direct_answers for the rest of this session. The reverse ("let me try first") flips back. Session-scoped only.

RETRIEVAL POLICY:
- If retrieval is REQUIRED and ingestion is ready/partial: call retrieve_chunks BEFORE explaining and cite the source.
- If OPTIONAL: use judgment. Retrieve when the user references their notes; skip for general background.
- If retrieved chunks conflict with prior knowledge, name the conflict explicitly.

TOOL FAILURES:
If a tool call returns an error, acknowledge briefly and continue. Don't retry update_topic_profile more than once per turn.
```

#### Dynamic Context

```
TOPIC: [TOPIC]
INTERACTION PREFERENCES: [JSON]
CURRENT TOPIC PROFILE: [JSON]

INGESTION STATUS: [INGESTION_STATUS]
RETRIEVAL: [REQUIRED | OPTIONAL]
PROFILE: [WAS | WAS NOT] seeded from a prior session [DAYS_SINCE_SEED days ago] (mode: [seed_mode], default was: [seed_mode_default], overridden: [seed_mode_was_overridden])
LAST_SESSION_SUMMARY (if seeded): [LAST_SESSION_SUMMARY or "none"]

ONBOARDING BEHAVIOR:
- START_FRESH or empty profile: probe for prior knowledge through natural questions in the first 2-4 turns.
- RESUME (recent): briefly acknowledge prior work using last_session_summary, then continue.
- REVIEW_GAPS: open with structured review over confirmed_gaps.
- RESUME on stale seed (14+ days) AND seed_mode_was_overridden = true: user explicitly chose to resume despite Review gaps being the recommendation. Briefly offer "It's been a while — quick refresher first, or jump back in?" before continuing.
- Otherwise, proceed normally.

GUIDANCE STYLE: [hints → scaffold | direct_answers → answer first, then explain]
ENGAGEMENT CADENCE: [quiz_as_we_go → check question every 2-3 turns | absorb_then_test → checks at end of focus area]
```

The `keyword_index` is intentionally absent from this template.

---

## 5. Data Model

| Entity | Fields |
|---|---|
| User | id, name, interaction_preferences, onboarding_complete, daily_message_count, daily_count_reset_at, created_at |
| Session | id, user_id, topic, topic_profile, focus_areas, pdf_ids, ingestion_status, keyword_index, seeded_from_session_id, seed_mode, seed_mode_default, seed_mode_was_overridden, last_activity_at, session_ended, created_at, updated_at |
| ChatMessage | id, session_id, role, content, tool_calls, retrieval_required, timestamp |
| Chunk | id, session_id, source_pdf_id, text, embedding, embedding_model, page_number, ingested_at |
| LearningEvent | id, session_id, gap_tested, question, correct, timestamp, focus_area_index |

---

## 6. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vue 3 + Vite, Pinia, Vue Router, PrimeVue |
| Backend | Firebase Cloud Functions (Python) |
| Agent runtime | Google ADK |
| LLM | Routed via ADK's LiteLLM wrapper. Default: Claude. Arbitration calls (if any are added later) use the same model as the tutor. |
| Embeddings | OpenAI `text-embedding-3-small` (default; switch if Phase 7 retrieval quality is poor) |
| Vector store | Firestore vector search |
| File storage | Firebase Storage |
| Auth | None (v1) |
| Hosting | Firebase Hosting (preview channel through Phase 10) |

**Local-first dev (Phases 1–8):** The Firebase Emulator Suite runs in Docker (`docker compose up`) — Firestore, Storage, Functions, and Hosting all served from `localhost`. The frontend SDK auto-routes to emulator hosts when `VITE_USE_EMULATOR=true`. Cloud deploy is gated to Phase 9.

> Caveat: Firestore vector search is not implemented in the emulator. Phase 7 retrieval will need a stub (cosine search in Python over locally stored chunks) until cloud deploy. The on-cloud path uses real Firestore vector search unchanged.

ADK is justified by VetBot architectural overlap. Without that, LiteLLM direct would be the simpler choice.

---

## 7. Screen Flow

| Screen | Description |
|---|---|
| Onboarding | 2 cards. Save preferences, redirect to Home. |
| Home | Sessions sorted by `updated_at` desc, grouped by topic. Cards show topic, date, knowledge level, summary excerpt. |
| Settings | Read-only preferences. "Retake onboarding" button. |
| New Session | Topic input + optional PDF upload. Three-way [Start fresh \| Resume \| Review gaps] toggle when prior session exists. Brief loading state during synchronous Resume finalization; warning toast on failure. |
| Chat | Single chat surface. Tool calls render as inline annotations. "Quiz me on this" button in header. Ingestion-pending banner. Daily-cap errors disable input. |
| Profile View | Read-only knowledge level, summaries. "Currently focusing on" indicator when set. Editable lists with delete buttons. Stale candidates collapsed section. Focus-area summary stats. LearningEvents grouped by gap. |

---

## 8. Eval Hook

End-of-focus-area check questions, triggered primarily by `focus_target_gap` clearing, also by user via "Quiz me on this." Each logged via `record_learning_event` with a `focus_area_index`.

This produces in-band signal:
- If `knowledge_level: "advanced"` correlates with high correctness, the classification is doing real work.
- If a gap keeps generating wrong answers, the teaching of that gap isn't landing.
- If `mastered_concepts` items produce wrong answers when re-tested, the promotion gate is too lax (would warrant tightening further).
- If `hints` mode produces meaningfully higher turns-to-clear without correctness benefit over `direct_answers`, the personalization is just adding latency.

### Self-Validation Threshold

For solo dogfooding, the success check is qualitative based on the developer's own usage across 5–10 sessions on at least 2 distinct topics:

1. Does `knowledge_level` track real knowledge?
2. Do `confirmed_gaps` track real gaps?
3. Do `mastered_concepts` items hold up when re-tested?
4. Across two sessions on the same topic, does the seeded second session feel meaningfully different from a Start-fresh second session would?
5. Does `hints` vs `direct_answers` differ in turns-to-clear without degrading correctness?

If most "yes" — proceed to Phase 11 (sharing). If most "no" — strip the inferred-profile layer before sharing.

---

## 9. Out of Scope (v1)

User authentication. Streaming responses. Spaced repetition. Mastery decay. Frustration-event detection. Persisted mid-session preference overrides. Synonym expansion. Multi-user collaboration. OCR/scanned PDFs. Per-subtopic knowledge level. `reasoning_pattern` field. Real candidate expiration. Tool-call analytics dashboard. Async/batch canonicalization arbitration.

---

## 10. Success Criteria

1. Phase 0 validation passes (turn 1 AND turn 12 — manually-set profile differences produce structurally different tutor outputs that persist through a longer conversation).
2. Phase 5.5 MLP checkpoint passes — the no-RAG version is judged worth continuing before Phase 6's RAG infrastructure.
3. Eval hook produces signal qualitatively per §8.
4. The developer trusts the system enough to want to share it.

The first criterion gates the rest. If Phase 0 fails, rebuild around a different premise.

---

## 11. Cost Controls

Per-user daily message cap. At the start of every `chat` invocation: check `daily_count_reset_at`; reset if > 24 hours old; check `daily_message_count` against `DAILY_CAP`; return `{ error: "daily_cap" }` if exceeded; otherwise increment.

`DAILY_CAP=200` for solo dogfooding (Phases 2–10). Lower to 50 when sharing (Phase 11).

Counts user messages (and therefore agent turns). Does not count: PDF ingestion, session-end summary calls.

---

## 12. Deferred (Add Only If Dogfooding Demands)

- In-chat profile correction tool
- Persisted mid-session preference overrides
- Lemmatization or LLM-extracted keyword index instead of Porter stemming
- Time-weighted candidate decay
- Force Quiz with gap selector UI
- Daily-cap warning at 90%
- Async batch canonicalization arbitration

---

## 13. Technology Alternatives (Realistic Mid-Build Swaps Only)

### Agent Runtime: ADK → LiteLLM Direct

**When:** Phase 3 verification shows tool-call reliability below ~85%, OR Phase 8 shows `focus_target_gap` clearing reliability below ~85% and prompt iteration doesn't fix it.

**Swap:** Rewrite `functions/agents/tutor.py` to use LiteLLM's `litellm.completion(tools=[...])` directly. Tool definitions move from ADK schemas to LiteLLM's tool format. ~100 lines of glue code.

This is the most likely swap during v1.

### Backend Runtime: Python Cloud Functions → Node.js Cloud Functions

**When:** cold starts make the app feel broken (>3s wait on first chat turn after idle) and ADK has already been replaced with LiteLLM.

**Swap:** Rewrite `functions/` directory in TypeScript. Frontend call signatures stay identical; Firestore data shapes stay identical. Cleanest if §14.1's ADK swap has already happened (LiteLLM has good Node bindings).

### Embedding Model

**When:** Phase 7 retrieval is poor (top-k results don't include obviously relevant content).

**Swap:** change the model identifier in the embedding function. All chunks must be re-embedded; the `embedding_model` field on each chunk allows partial re-embedding without a full reset. Vector index dimension may need to change.

Candidates: Voyage `voyage-3` (better on technical content), OpenAI `text-embedding-3-large` (higher quality, higher cost), Cohere `embed-english-v3`.

### Stemmer: Porter → Snowball or WordNet Lemmatizer

**When:** dogfooding reveals false-positive triggers from collisions ("normalization" and "normal form" stemming to the same root) or false-negative misses on important variants.

**Swap:** change the stemmer in `functions/lib/keyword_index.py`. Porter → Snowball is one line. Porter → WordNet lemmatizer adds POS tagging but stays small.

---

## Appendix: Sharing

v1 success does not require non-developer users. Sharing is Phase 11, gated separately, entered only on a "go" decision from Phase 10 self-validation.