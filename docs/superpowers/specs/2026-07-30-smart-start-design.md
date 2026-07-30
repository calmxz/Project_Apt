# Smart Start — Prior-Topic Intercept + Level-at-Start

**Date:** 2026-07-30
**Status:** Approved for planning
**Slice:** combines post-v1 UX suggestions #1 (duplicate/prior-topic intercept) and #2 (level capture at start).

## Problem

Starting a topic today is a one-field jump straight into chat, ignoring everything the app already knows:

1. Typing a topic with an existing **active** session silently redirects to it (`HomeView.vue` 409 handler) — no explanation. Typing a topic studied in an **ended** session starts fresh with an empty `TopicProfile`, discarding the user's level, gaps, and mastered concepts. The resume path (`seed_mode=resume`) exists but is buried in the sidebar row menu.
2. The knowledge-level question is asked *after* navigation, mid-conversation, via `DiagnosticConsentCard` — interruptive, and its dismissal is view-local so it re-appears on reload.

## Decisions (locked with user)

- Level capture lives on the start pages (Home and `/new`), shown after Start is clicked — not an interstitial, not the in-chat card.
- Intercept covers **active and ended** sessions, **case-insensitive exact** topic match only. No fuzzy matching.
- Skipping the level chips leaves `knowledge_level = null` → existing in-chat consent flow fires unchanged (skip = defer, not refuse).
- Shared components used by both `HomeView` and `NewSessionView`; `/new` keeps its quick-picks and doc attach, its bespoke duplicate warning is replaced by the shared intercept.
- Branch off `dev` **after** open PRs (#161, #178, #179, #180) are merged by the user.

## UX Flow

On Start click (Home or `/new`), with a non-empty trimmed topic:

1. `GET /api/sessions/lookup?topic=<trimmed>` fires.
2. **Active match** → inline choice card replaces the Start area: "You have an active session on this — **Open it** / **Start fresh anyway**". Start-fresh proceeds to step 4. The backend 409 duplicate-active pre-check remains as a race backstop; a 409 now renders this same card instead of silently redirecting.
3. **Ended match** (only when no active match) → card: "You studied this before (N gaps open) — **Continue where you left off** / **Start fresh**". Continue calls the existing `continueTopic` resume path (profile carried forward; level chips skipped entirely). Fresh proceeds to step 4.
4. **No match, or fresh chosen** → level chips appear inline under the input:
   - **New to this / Know some / Know it well** → create session with `declared_level` (beginner / intermediate / advanced) → navigate to chat. The consent card never shows (it is gated on `knowledge_level == null`).
   - **Quiz me (3 questions)** → create session (level null) → navigate with `?quiz=1` → frontend auto-sends a seeded first message with `diagnostic_accepted: true` → agent immediately runs the 3-question MCQ batch.
   - **Skip / X** → create plain → current in-chat consent flow unchanged.

## API Contract (edit `docs/api/openapi.yaml` first, then `python backend/scripts/gen_contracts.py`)

### New: `GET /api/sessions/lookup?topic=`

```yaml
SessionLookupResult:
  active_match:    SessionMatch | null
  ended_match:     SessionMatch | null   # most recent ended; only populated when no active match
SessionMatch:
  session_id:      string
  title:           string
  ended_at:        datetime | null
  gap_count:       integer               # len(confirmed_gaps)
  knowledge_level: string | null
```

Match rule: `lower(trim(query_topic)) == lower(trim(session.topic))`, scoped to the authenticated user. Active checked first; ended searched only when no active hit. Multiple ended matches → most recently ended wins. No side effects, no LLM.

### Extended: `POST /api/sessions`

New optional request field `declared_level: beginner | intermediate | advanced | null`.

- Only valid with `seed_mode=fresh`; **422** when sent with `seed_mode=resume` (resume carries its own level).
- When present, the fresh create seeds `TopicProfile(knowledge_level=declared_level)` atomically (same semantics as the existing self-declared path — `evidence_type=declared`; no new profile rules).

### Extended: chat message request

New optional field `diagnostic_accepted: boolean` (default false), mirroring the existing `review_gaps` flag. Transient per-request; **no new DB column anywhere in this slice, no migration.**

## Backend

`backend/routes/sessions.py`:
- `GET /api/sessions/lookup` registered above the `/{id}` routes (path-order gotcha). Two auth-scoped SELECTs (active exact; latest ended exact — skipped if active hits).
- `POST /api/sessions`: validate + apply `declared_level` at the fresh-create site (`sessions.py:163` area). Existing 409 duplicate-active pre-check unchanged.

`backend/routes/chat.py` + `agent/prompts.py`:
- When `diagnostic_accepted` is true AND `profile.knowledge_level is None`: render `DIAGNOSTIC: ACCEPTED` instead of `DIAGNOSTIC: REQUIRED` — prompt rule: "user already consented; call `ask_check_questions` with exactly 3 MCQs (easy/medium/hard) in this response; do not re-offer." Extends `prompts.py:110-127`, mirroring the review-gaps contract at `:129-141`.
- Precedence: review-gaps wins if both flags are set (existing diagnostic suppression at `chat.py:105` stays).
- When `diagnostic_accepted` arrives but `knowledge_level` is already set: flag ignored.

Untouched: diagnostic grading (`diagnostic_service.py`), all-skip re-fire, PATCH-mid-batch-wins, review-queue exclusion of diagnostic events.

## Frontend

New `frontend/src/components/start/`:
- `StartTopicIntercept.vue` — props: lookup result; emits `open-existing`, `continue-topic`, `start-fresh`, `cancel`.
- `StartLevelPicker.vue` — emits `select(level)`, `quiz`, `skip`. Five chips, keyboard-accessible, styled like existing tag chips.

New composable `frontend/src/composables/useStartFlow.js` — owns the state machine `idle → looking-up → intercept → level-pick → creating → navigating`. Consumed by both views; each view keeps its extras (quick picks + doc attach on `/new`).

`stores/session.js`:
- `lookupTopic(topic)` thin API call.
- `createSession` passes `declared_level` through.

`SessionView.vue`: `?quiz=1` query triggers auto-send of seeded message `"Quiz me so you can pitch this at the right level."` with `diagnostic_accepted: true`, then strips the query param (same mechanism as `?review_gap=` handling at `SessionView.vue:761-801`).

Removed/replaced:
- `HomeView.vue` silent 409 redirect → intercept card.
- `NewSessionView.vue` bespoke duplicate-warning block (`:83-102`) → shared intercept.
- `DiagnosticConsentCard` untouched (still the skip-path fallback).

## Errors and Edge Cases

- Lookup network/5xx failure → toast + proceed directly to level picker. Lookup is an enhancement, never a gate.
- Create race (session created between lookup and create) → backend 409 → active-match intercept card shown; no silent redirect.
- `continueTopic` failure → existing error toast; stay on page.
- Quiz-me seeded message failure → normal chat error handling; level still null so the consent card appears (graceful degradation).
- Case/whitespace-only topic differences → match (both sides normalized).
- Ended match with 0 gaps → card still offered (profile also carries mastered concepts); "N gaps open" copy only rendered when N > 0.
- Invalid `declared_level` enum → 422 via contract validation.

## Testing

Backend (pytest):
- lookup: no match; active match; ended match; case-insensitive; whitespace normalization; other-user isolation; active-beats-ended; latest-ended-wins; no side effects.
- create: `declared_level` seeds profile level; 422 with `seed_mode=resume`; absent field → unchanged behavior.
- chat: `diagnostic_accepted` renders ACCEPTED block; ignored when level already set; review-gaps precedence.

Frontend (vitest):
- `useStartFlow` state-machine transitions incl. lookup-failure fallback.
- `StartTopicIntercept` / `StartLevelPicker` emit wiring + a11y roles.
- `HomeView` full flow (lookup → intercept → level → create) and 409-renders-card.
- `NewSessionView` shared intercept + doc attach preserved.
- `SessionView` `?quiz=1` auto-send with flag + param strip.
- Skip path leaves consent-card behavior intact.

Owed manual (paid, post-merge): one live smoke — Quiz-me chip → 3 MCQs arrive in first tutor response; declared-level chip → no consent card and tutor pitches at declared level.

## Out of Scope

- Fuzzy/substring topic matching.
- Personalized Home cards (review-due, suggested topics) — separate slice.
- Goal-capture chips ("exam prep" etc.).
- Persisting consent-card dismissal (skip path keeps current behavior by design).
- Any DB migration.
