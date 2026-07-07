# Roadmap Slice 2 — Cost Track + Streaming Cap-Banner Fix

Date: 2026-07-07
Status: APPROVED (brainstormed and approved in-session)
Source roadmap: `docs/planning/2026-07-06-10x-roadmap.md` (items P1, P2, plus the
slice-1 follow-up recorded in PR #106)
Predecessor: Slice 1 (S1/S2/R0.1/R0.2), merged to dev via PR #106 (`f337638`).

## Scope

Three items, one PR to dev, branch `feat/roadmap-slice2`:

1. **A — Streaming 429/cap-error to cap-banner mapping** (slice-1 follow-up).
   The streaming chat path never populates `dailyCapInfo`/`costCapInfo`, so the
   existing `CapBanners.vue` + SessionView toasts never fire. The mapping was
   lost when the non-streaming `sendMessage` chain was deleted (commit
   `2658940`); prod was already streaming-only, so this is a pre-existing gap
   that is now the sole path.
2. **B — P1 prompt-cache instrumentation + prefix-stability guard**
   (roadmap P1 AC1 instrumentation half + AC2). The dogfood-day measurement and
   the implicit-vs-explicit cache decision are an owed human gate, not in-slice.
   P1 AC3 (Anthropic `cache_control`) stays a documented conditional; no code.
3. **C — P2 token-volume reduction** (roadmap P2 AC1, AC2, AC4, AC5).
   P2 AC3 (rolling summary of dropped-from-window turns) is explicitly
   deferred to a later slice; it composes with the v2 draft-summary backlog
   item and is better designed with it.

Out of scope: R1.x, P3, P4, D-track, any openapi.yaml/contract change (none of
the three items touches the API surface).

## Design

### A — Streaming cap-error mapping (frontend)

New `frontend/src/lib/capErrors.js` exporting a pure mapper:

```
mapCapError({ status, code, payload }) -> { kind: 'daily' | 'cost' | null, info }
```

- `code === 'daily_cap_reached'` (from `backend/lib/error_codes.py`) →
  `kind: 'daily'`, `info: { cap, used, resets_at }`.
- `code === 'daily_cost_cap_reached'` → `kind: 'cost'`,
  `info: { used_usd, soft_cap_usd, hard_cap_usd, resets_at }`.
- Anything else → `kind: null`. Missing payload fields tolerated (null-filled);
  the mapper never throws.

Two consumption points (both must exist — this is the choke-point pattern from
slice 1's `excerpt.py::wrap_chunk`):

1. **Pre-stream HTTP 429**: in `sendMessageStreaming`'s catch
   (`frontend/src/stores/session.js:487-496`). If the error is an `ApiError`
   with `status === 429`, run the mapper on its parsed body and set
   `dailyCapInfo` / `costCapInfo` before the existing `_setError(e)` call.
   The inline `store.error` string remains (unchanged behavior); the banner and
   toast are additive.
2. **Mid-turn SSE `error` event**: where SSE `error` events are already
   consumed in the store's streaming handler (`stores/session.js`). The
   backend yields `StreamEvent("error", {code: 'daily_cost_cap_reached',
   used_usd, soft_cap_usd, hard_cap_usd})` when the hard cap trips mid-turn
   (`backend/agent/tutor.py:112-127`) — note: no `resets_at` in this shape; the
   mapper fills `resets_at: null` and the banner copy must tolerate that.
   Partial assistant text already rendered stays as-is (existing behavior).

No backend change. No UI component change: `CapBanners.vue` and the SessionView
toast watchers (`SessionView.vue:220-234`) already render from the two store
refs. `App.vue`'s global 429-skip stays correct.

Tests: the two gap-documenting tests flip to assert the fix —
`frontend/src/__tests__/costCapUx.test.js` ("streaming path costCapInfo is NOT
populated") and `sessionStore.test.js` ("surfaces a daily-cap 429 as a store
error without setting dailyCapInfo"). Plus unit tests for the mapper (both
codes, unknown code, missing fields) and an SSE-error-event store test.

### B — P1 cache instrumentation + prefix stability (backend)

**Migration 0015** (`llm_call_log` extension, single alembic head preserved):
nullable integer columns `prompt_tokens`, `completion_tokens`, `cached_tokens`.
Downgrade drops them. Old rows stay null; no backfill.

**Capture**: `run_streaming` already reconstructs the full response via
`litellm.stream_chunk_builder(chunks, messages=full)` (`tutor.py:186`). Read
from the built response, tolerantly (getattr chain, default `None`):

- `usage.prompt_tokens`, `usage.completion_tokens`
- Gemini implicit-cache signal:
  `usage.prompt_tokens_details.cached_content_token_count` → `cached_tokens`.

Extend `cost_meter.log_call` with optional keyword args
(`prompt_tokens=None, completion_tokens=None, cached_tokens=None`); it keeps
its slice-1 contract: best-effort, SAVEPOINT-wrapped (`begin_nested`), swallows
all exceptions, never poisons the caller's session. The summary-call path
(purpose `summary`) passes tokens too if its response object exposes usage;
otherwise nulls — verify during planning.

**Prefix-stability guard (P1 AC2)**: unit test builds the system prompt twice
with two different dynamic states (different profile/retrieval/quiz state) and
asserts:

- the first `len(IMMUTABLE_RULES)` characters are byte-identical across builds,
- all per-turn material appears strictly after that prefix.

This is a structural guard only — `build_system_prompt`
(`backend/agent/prompts.py:177-180`) is already rules-first; no assembly
refactor.

**Owed human gate (PR body)**: one dogfood day with normal usage, then
`SELECT` over `llm_call_log` for cache-hit rate
(`cached_tokens / prompt_tokens` per call, aggregate). Decision recorded
(roadmap P1 AC1): implicit Gemini prefix cache sufficient vs explicit context
cache. P1 AC3 (`cache_control` breakpoints if a model swap to Anthropic ever
happens) remains documented-conditional, not built.

### C — P2 token-volume reduction (backend)

New module `backend/agent/context_budget.py` — pure functions, no DB, no LLM:

**`truncate_message(content: str, max_chars: int = 6000) -> str`** (P2 AC2)
- Char-based (~6k chars ≈ 1.5k tokens) rather than tokenizer-based:
  deterministic, zero hot-path tokenizer cost, model-independent tests.
- Head+tail preservation, ~70/30 split, joined by an explicit
  `"\n...[truncated]...\n"` marker. Content at or under the cap returned
  unchanged.
- Applied to history messages at window assembly in `routes/chat.py`
  (last-20 window build, `chat.py:101-110`). Exempt: the system prompt and the
  current user message.

**`prune_superseded_excerpts(messages: list[dict]) -> list[dict]`** (P2 AC1)
- Called inside the `run_streaming` loop after a new `retrieve_chunks` tool
  result is appended: earlier same-turn tool-role messages whose content
  carries `document_excerpt` blocks are replaced by a one-line stub retaining
  chunk ids + doc names (`[superseded retrieval: ...]`).
- Only `role == "tool"` message *content* is rewritten; `tool_call_id`/`name`
  fields and every assistant/tool-call message stay intact so the transcript
  remains LiteLLM-valid.
- History from previous turns is not touched (tool messages exist only within
  the current turn's loop).

**`MODEL_RATES` KeyError fallback** (P2 AC5, `cost_meter.py:100-137`)
- Unknown model id: fall back to `litellm.cost_per_token` /
  `litellm.completion_cost`; if that also fails, log a warning and record cost
  `0.0` — never raise mid-turn. Test with an unregistered model id.

**Token-budget regression guard** (P2 AC4)
- Fixture test: canonical 3-turn conversation + one retrieval, assembled
  through the real window/truncation/pruning path, total measured with
  `litellm.token_counter` (test-time only) and asserted under a named budget
  constant. The constant is set from a measured baseline during implementation
  (baseline minus expected savings, with slack); the test's job is to break
  loudly if assembly regresses.

### Error handling and risk

- A and B are additive; failure modes are inert (mapper returns null kind →
  today's behavior; token fields null → row still logs cost as today).
- Pruning is the highest-risk change: malformed tool-message surgery would
  break the LiteLLM transcript mid-loop. Mitigation: unit tests assert the
  exact message-list shape after pruning, plus one integration test through
  the fake-LLM streaming loop with two sequential retrievals in one turn.
- Truncation can cut mid-markdown/mid-math in history. Accepted: history is
  model context, not UI; the marker makes the cut explicit to the model.

## Testing and quality gates

- TDD per task; SDD execution (subagent per task, two-stage review); PR → dev.
- Full backend suite (sqlite CI parity), full frontend vitest + lint, codegen
  drift gate (should be trivially green — no openapi change).
- Migration 0015 keeps a single alembic head.

## Owed human gates (to list in the PR body)

1. Live `alembic upgrade head` against Supabase (0015, additive/nullable).
2. Dogfood-day cache measurement + recorded implicit-vs-explicit decision
   (P1 AC1 second half).
3. One live cap smoke: `DAILY_CAP=1` (or cost hard-cap trip) → cap banner and
   toast appear on the streaming path, both pre-stream and, if practical,
   mid-turn.

## Roadmap bookkeeping

On merge, update `docs/planning/2026-07-06-10x-roadmap.md` status lines for P1
(AC1 instrumentation + AC2 shipped; measurement owed; AC3 conditional), P2
(AC1/2/4/5 shipped; AC3 deferred), and the slice-1 follow-up (429 mapping
resolved).
