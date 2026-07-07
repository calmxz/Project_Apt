# Roadmap Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the cost track (P1 cache instrumentation + P2 token-volume reduction) plus the streaming cap-banner fix, per approved spec `docs/superpowers/specs/2026-07-07-roadmap-slice2-design.md`.

**Architecture:** Three independent surfaces. (A) Frontend: a pure cap-error mapper (`lib/capErrors.js`) consumed at four points in the session store (two HTTP catches, two SSE `error` cases) feeding the existing `dailyCapInfo`/`costCapInfo` refs. (B) Backend P1: migration 0015 adds three nullable token columns to `llm_call_log`; a tolerant `extract_usage` helper feeds them from LiteLLM responses; a prompt prefix-stability guard test. (C) Backend P2: new pure module `agent/context_budget.py` (char-based truncation + superseded-excerpt pruning) wired into `routes/chat.py` and the `run_streaming` loop, plus a cost-fallback fix in `cost_meter` and a fixture token-budget regression test.

**Tech Stack:** Vue 3 + Pinia + vitest (frontend); FastAPI + SQLAlchemy + Alembic + LiteLLM + pytest (backend, sqlite CI parity).

## Global Constraints

- Branch: `feat/roadmap-slice2` (already created off dev). PR target: `dev`.
- No emojis in code or comments. No secrets committed. Never read `.env`.
- No `docs/api/openapi.yaml` change is expected in this slice; if you find yourself needing one, STOP and report (contract changes must go YAML-first + codegen).
- Migration 0015 must leave a SINGLE alembic head (`down_revision = "0014_llm_call_log"`).
- Backend tests run on sqlite CI parity: from `backend/`: `pytest`. Frontend: from `frontend/`: `npm run test:unit -- --run`.
- `cost_meter.log_call` contract from slice 1 is inviolable: best-effort, SAVEPOINT-wrapped, never raises, zero-cost calls skipped.
- Commit messages: conventional commits, imperative, no emoji.
- When sweeping the repo with grep, use your native grep tooling (the rtk rg proxy has returned false "0 matches" — known gotcha).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/lib/capErrors.js` | Create | Pure envelope-to-cap-state mapper (both cap codes, tolerant) |
| `frontend/src/__tests__/capErrors.test.js` | Create | Mapper unit tests |
| `frontend/src/stores/session.js` | Modify | `_applyCapError` helper; wire into 2 catches + 2 SSE `error` cases |
| `frontend/src/__tests__/sessionStore.test.js` | Modify | Flip daily-cap gap test to assert mapping; add SSE error-event test |
| `frontend/src/__tests__/costCapUx.test.js` | Modify | Flip cost-cap gap test to assert mapping |
| `backend/db/alembic/versions/0015_llm_call_log_tokens.py` | Create | Three nullable int columns on `llm_call_log` |
| `backend/db/models.py` | Modify | `LlmCallLog` token columns |
| `backend/services/cost_meter.py` | Modify | `log_call` token kwargs; `extract_usage`; `estimate_cancelled_cost` fallback |
| `backend/tests/test_llm_call_log.py` | Modify | Token-column passthrough tests |
| `backend/tests/test_extract_usage.py` | Create | `extract_usage` tolerance tests |
| `backend/agent/tutor.py` | Modify | Pass usage into `log_call`; call `prune_superseded_excerpts` |
| `backend/services/summary_service.py` | Modify | Pass usage into `log_call` |
| `backend/tests/test_prompts.py` | Modify | Prefix-stability guard test |
| `backend/agent/context_budget.py` | Create | `truncate_message`, `prune_superseded_excerpts` (pure, no DB/LLM) |
| `backend/tests/test_context_budget.py` | Create | Truncation + pruning unit tests |
| `backend/routes/chat.py` | Modify | Truncate history messages at window assembly |
| `backend/tests/test_cost_meter_estimate.py` | Modify | Replace KeyError expectation with fallback behavior |
| `backend/tests/test_token_budget.py` | Create | Fixture token-budget regression guard |
| `docs/planning/2026-07-06-10x-roadmap.md` | Modify | Status lines for P1/P2 + slice-1 follow-up (Task 10) |

---

### Task 1: Cap-error mapper (`capErrors.js`)

**Files:**
- Create: `frontend/src/lib/capErrors.js`
- Test: `frontend/src/__tests__/capErrors.test.js`

**Interfaces:**
- Consumes: `ERR_DAILY_CAP_REACHED`, `ERR_DAILY_COST_CAP_REACHED` from `frontend/src/lib/errorCodes.js` (existing).
- Produces: `mapCapError(detail) -> { kind: 'daily' | 'cost' | null, info: object | null }`. Task 2 imports this. `detail` is the flat backend envelope: HTTP 429 `body.detail` OR mid-turn SSE `error` event payload (same flat shape; SSE lacks `resets_at`).

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/__tests__/capErrors.test.js
import { describe, it, expect } from 'vitest'
import { mapCapError } from '@/lib/capErrors.js'
import { ERR_DAILY_CAP_REACHED, ERR_DAILY_COST_CAP_REACHED } from '@/lib/errorCodes.js'

describe('mapCapError', () => {
  it('maps a daily-cap envelope to kind=daily with cap/used/resets_at', () => {
    const r = mapCapError({ code: ERR_DAILY_CAP_REACHED, cap: 50, used: 50, resets_at: '2026-07-08T00:00:00+00:00' })
    expect(r.kind).toBe('daily')
    expect(r.info).toEqual({ cap: 50, used: 50, resets_at: '2026-07-08T00:00:00+00:00' })
  })

  it('maps a cost-cap envelope to kind=cost with the four cost fields', () => {
    const r = mapCapError({
      code: ERR_DAILY_COST_CAP_REACHED,
      used_usd: '3.0100', soft_cap_usd: '2.0', hard_cap_usd: '3.0',
      resets_at: '2026-07-08T00:00:00+00:00',
    })
    expect(r.kind).toBe('cost')
    expect(r.info).toEqual({
      used_usd: '3.0100', soft_cap_usd: '2.0', hard_cap_usd: '3.0',
      resets_at: '2026-07-08T00:00:00+00:00',
    })
  })

  it('fills missing fields with null (mid-turn SSE shape has no resets_at)', () => {
    const r = mapCapError({ code: ERR_DAILY_COST_CAP_REACHED, used_usd: '3.0100', soft_cap_usd: '2.0', hard_cap_usd: '3.0' })
    expect(r.kind).toBe('cost')
    expect(r.info.resets_at).toBeNull()
  })

  it('returns kind=null for unknown codes and never throws on garbage', () => {
    expect(mapCapError({ code: 'max_iters_reached' })).toEqual({ kind: null, info: null })
    expect(mapCapError(null)).toEqual({ kind: null, info: null })
    expect(mapCapError(undefined)).toEqual({ kind: null, info: null })
    expect(mapCapError('nonsense')).toEqual({ kind: null, info: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

From `frontend/`: `npm run test:unit -- --run src/__tests__/capErrors.test.js`
Expected: FAIL — cannot resolve `@/lib/capErrors.js`.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/capErrors.js
// Maps a backend cap-error envelope to the session store's cap-banner state.
// One mapper for BOTH transports so they cannot drift (choke-point pattern,
// same rationale as backend/agent/excerpt.py::wrap_chunk):
//   - pre-stream HTTP 429: ApiError.body.detail from routes/chat.py
//   - mid-turn SSE `error` event payload from agent/tutor.py (same flat
//     shape, but no resets_at -- consumers must tolerate null)
import { ERR_DAILY_CAP_REACHED, ERR_DAILY_COST_CAP_REACHED } from './errorCodes.js'

export function mapCapError(detail) {
  const d = detail && typeof detail === 'object' ? detail : {}
  if (d.code === ERR_DAILY_CAP_REACHED) {
    return {
      kind: 'daily',
      info: { cap: d.cap ?? null, used: d.used ?? null, resets_at: d.resets_at ?? null },
    }
  }
  if (d.code === ERR_DAILY_COST_CAP_REACHED) {
    return {
      kind: 'cost',
      info: {
        used_usd: d.used_usd ?? null,
        soft_cap_usd: d.soft_cap_usd ?? null,
        hard_cap_usd: d.hard_cap_usd ?? null,
        resets_at: d.resets_at ?? null,
      },
    }
  }
  return { kind: null, info: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

From `frontend/`: `npm run test:unit -- --run src/__tests__/capErrors.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/capErrors.js frontend/src/__tests__/capErrors.test.js
git commit -m "feat(frontend): cap-error envelope mapper for streaming cap-banner fix"
```

---

### Task 2: Wire mapper into session store (both transports)

**Files:**
- Modify: `frontend/src/stores/session.js` (imports ~line 7; helper near `_setError` ~line 53; `completeCheck` onEvent `error` case ~line 377 and catch ~line 386; `sendMessageStreaming` onEvent `error` case ~line 478 and catch ~line 487)
- Modify: `frontend/src/__tests__/sessionStore.test.js:342-363` (flip gap test; add SSE test)
- Modify: `frontend/src/__tests__/costCapUx.test.js:70-124` (flip gap test)

**Interfaces:**
- Consumes: `mapCapError(detail)` from Task 1. Existing refs `dailyCapInfo` (`{cap, used, resets_at}`), `costCapInfo` (`{used_usd, soft_cap_usd, hard_cap_usd, resets_at}`) at `session.js:17-20`. `ApiError` has `.status` and `.body` (body is the parsed JSON, envelope at `body.detail`).
- Produces: streaming 429s and mid-turn SSE cap errors now populate the cap refs; `CapBanners.vue` and SessionView toast watchers light up with no component changes.

- [ ] **Step 1: Flip the two gap-documenting tests and add the SSE test (failing first)**

In `frontend/src/__tests__/sessionStore.test.js`, replace the test at lines 342-363 (delete its stale comment block too) with:

```js
  // Streaming path now maps the 429 envelope into dailyCapInfo via
  // lib/capErrors.js (slice 2) -- parity with the removed non-streaming chain.
  it('sendMessageStreaming maps a daily-cap 429 into dailyCapInfo and store error', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockRejectedValueOnce(
      new ApiErrorLike(429, {
        detail: { code: ERR_DAILY_CAP_REACHED, cap: 10, used: 10, resets_at: '2026-01-02' },
      }),
    )
    await expect(s.sendMessageStreaming({ text: 'x' })).rejects.toThrow('api error')
    expect(s.error).toBeTruthy()
    expect(s.dailyCapInfo).toEqual({ cap: 10, used: 10, resets_at: '2026-01-02' })
    expect(s.dailyCapReached).toBe(true)
    expect(s.streamState).toBe('idle')
    expect(s.streamingMessage).toBeNull()
  })

  it('sendMessageStreaming maps a mid-turn SSE cost-cap error event into costCapInfo', async () => {
    const s = useSessionStore()
    s.currentSessionId = 's1'
    vi.spyOn(streamSvc, 'streamChat').mockImplementation(async ({ onEvent }) => {
      onEvent({ event: 'assistant_delta', data: { text: 'partial' } })
      onEvent({
        event: 'error',
        data: { code: ERR_DAILY_COST_CAP_REACHED, used_usd: '3.0100', soft_cap_usd: '2.0', hard_cap_usd: '3.0' },
      })
    })
    await s.sendMessageStreaming({ text: 'x' })
    expect(s.costCapInfo).toEqual({
      used_usd: '3.0100', soft_cap_usd: '2.0', hard_cap_usd: '3.0', resets_at: null,
    })
    expect(s.costCapReached).toBe(true)
    expect(s.streamState).toBe('idle')
  })
```

Check the file's imports: it already imports `ERR_DAILY_CAP_REACHED`; add `ERR_DAILY_COST_CAP_REACHED` to the same import from `@/lib/errorCodes.js` if absent. `ApiErrorLike` is an existing local test helper in this file — reuse it as-is.

In `frontend/src/__tests__/costCapUx.test.js`, update the describe at lines 81-124: replace the stale comment block (lines 70-79) with a one-liner (`// Slice 2: the streaming catch maps the 429 envelope into costCapInfo.`) and change the final assertions of the test (keep the mocks exactly as they are) to:

```js
    await expect(s.sendMessageStreaming({ text: 'hi' })).rejects.toThrow('api')
    expect(s.costCapReached).toBe(true)
    expect(s.costCapInfo).toEqual({
      used_usd: '3.5000',
      soft_cap_usd: '2.0',
      hard_cap_usd: '3.0',
      resets_at: '2026-05-24T00:00:00Z',
    })
    expect(s.error).toBeTruthy()
    expect(s.streamState).toBe('idle')
```

Also rename that test to `'maps a cost-cap 429 from streamChat into costCapInfo and store error'`.

- [ ] **Step 2: Run tests to verify they fail**

From `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js src/__tests__/costCapUx.test.js`
Expected: FAIL — `dailyCapInfo`/`costCapInfo` still null.

- [ ] **Step 3: Implement store wiring**

In `frontend/src/stores/session.js`:

(a) Add import after the existing `friendlyError` import (line 7):

```js
import { mapCapError } from '../lib/capErrors.js'
```

(b) Add helper directly above `_setError` (line 53):

```js
  // Route a backend cap envelope (HTTP 429 detail or SSE error payload)
  // into the cap-banner refs. Unknown codes are a no-op.
  function _applyCapError(detail) {
    const { kind, info } = mapCapError(detail)
    if (kind === 'daily') dailyCapInfo.value = info
    else if (kind === 'cost') costCapInfo.value = info
  }
```

(c) In `sendMessageStreaming`'s onEvent switch, change the `error` case (line 478) to:

```js
            case 'error':
              _applyCapError(data)
              error.value = data.message || data.code
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
```

(d) In `sendMessageStreaming`'s catch (line 487), insert the 429 mapping before the state reset:

```js
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (streamingMessage.value) handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
      if (e?.status === 429) _applyCapError(e?.body?.detail)
      streamingMessage.value = null
      streamState.value = 'idle'
      abortController.value = null
      _setError(e)
    }
```

(e) Apply the identical two edits to `completeCheck`: its onEvent `error` case (line 377) gains the same `_applyCapError(data)` first line, and its catch (line 386) gains the same `if (e?.status === 429) _applyCapError(e?.body?.detail)` line before `streamingMessage.value = null`. The check/complete stream runs the same tutor loop, so the mid-turn cost-cap error event can fire there too.

- [ ] **Step 4: Run the full frontend suite**

From `frontend/`: `npm run test:unit -- --run`
Expected: PASS, no regressions (watch for other tests that assert `dailyCapInfo` stays null after 429 — if any exist beyond the two flipped ones, update them to the new mapped expectation; the mapping is now intended behavior).

- [ ] **Step 5: Lint and commit**

From `frontend/`: `npm run lint`
Expected: clean.

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js frontend/src/__tests__/costCapUx.test.js
git commit -m "fix(frontend): map streaming 429 and SSE cap errors into cap banners"
```

---

### Task 3: Migration 0015 + `LlmCallLog` token columns + `log_call` kwargs + `extract_usage`

**Files:**
- Create: `backend/db/alembic/versions/0015_llm_call_log_tokens.py`
- Modify: `backend/db/models.py:149-166` (`LlmCallLog`)
- Modify: `backend/services/cost_meter.py:86-109` (`log_call`) and add `extract_usage` below it
- Test: `backend/tests/test_llm_call_log.py` (extend), Create: `backend/tests/test_extract_usage.py`

**Interfaces:**
- Consumes: existing `LlmCallLog` model, `log_call` (slice-1 contract: keyword-only, never raises, `begin_nested` SAVEPOINT, zero-cost skip).
- Produces: `log_call(db, *, user_id, session_id, purpose, model, cost_usd, prompt_tokens=None, completion_tokens=None, cached_tokens=None)`; `extract_usage(resp) -> dict` with exactly the keys `prompt_tokens`, `completion_tokens`, `cached_tokens` (int or None) — designed to be splatted: `log_call(..., **extract_usage(resp))`. Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_llm_call_log.py`:

```python
def test_log_call_persists_token_counts(db_session):
    cost_meter.log_call(
        db_session, user_id="u1", session_id=None, purpose="chat",
        model="m", cost_usd="0.0100",
        prompt_tokens=1200, completion_tokens=340, cached_tokens=900,
    )
    row = db_session.query(LlmCallLog).one()
    assert row.prompt_tokens == 1200
    assert row.completion_tokens == 340
    assert row.cached_tokens == 900


def test_log_call_token_kwargs_default_null(db_session):
    cost_meter.log_call(
        db_session, user_id="u1", session_id=None, purpose="chat",
        model="m", cost_usd="0.0100",
    )
    row = db_session.query(LlmCallLog).one()
    assert row.prompt_tokens is None
    assert row.completion_tokens is None
    assert row.cached_tokens is None
```

Match the existing file's import style and fixtures (it already imports `cost_meter` and `LlmCallLog`; the `db_session` fixture and user seeding follow the file's existing tests — mirror whatever user setup `test_log_call_writes_row` does, including any required `users` row).

Create `backend/tests/test_extract_usage.py`:

```python
"""cost_meter.extract_usage: tolerant token-usage reader (roadmap P1 AC1).

Instrumentation only -- must return the three-key dict on ANY input and
never raise, because it runs inside the billed turn path.
"""
from types import SimpleNamespace

from services import cost_meter


def test_extract_usage_reads_openai_style_cached_tokens():
    resp = SimpleNamespace(usage=SimpleNamespace(
        prompt_tokens=1500, completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_tokens=1100),
    ))
    assert cost_meter.extract_usage(resp) == {
        "prompt_tokens": 1500, "completion_tokens": 200, "cached_tokens": 1100,
    }


def test_extract_usage_reads_gemini_field_name():
    resp = SimpleNamespace(usage=SimpleNamespace(
        prompt_tokens=1500, completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_content_token_count=800),
    ))
    assert cost_meter.extract_usage(resp)["cached_tokens"] == 800


def test_extract_usage_missing_pieces_yield_nones():
    assert cost_meter.extract_usage(None) == {
        "prompt_tokens": None, "completion_tokens": None, "cached_tokens": None,
    }
    assert cost_meter.extract_usage(SimpleNamespace()) == {
        "prompt_tokens": None, "completion_tokens": None, "cached_tokens": None,
    }
    no_details = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2))
    out = cost_meter.extract_usage(no_details)
    assert out["prompt_tokens"] == 10
    assert out["cached_tokens"] is None
```

Note: `SimpleNamespace()` has no `usage` attribute, so `getattr(resp, "usage", None)` returns None — that is the "missing pieces" path. `prompt_tokens_details=SimpleNamespace(cached_content_token_count=...)` exercises the Gemini-name fallback because OpenAI-style `cached_tokens` is absent on that namespace.

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_llm_call_log.py tests/test_extract_usage.py -v`
Expected: FAIL — unexpected keyword `prompt_tokens`; no attribute `extract_usage`.

- [ ] **Step 3: Implement model, migration, log_call, extract_usage**

(a) `backend/db/models.py` — add to `LlmCallLog` after `cost_usd` (line 165):

```python
    # P1 instrumentation (slice 2): nullable per-call token counts.
    # cached_tokens = Gemini implicit-prefix-cache hit portion of prompt_tokens.
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

(b) Create `backend/db/alembic/versions/0015_llm_call_log_tokens.py` (mirrors 0014's style):

```python
"""llm_call_log: nullable token-count columns (roadmap P1 instrumentation)

Revision ID: 0015_llm_call_log_tokens
Revises: 0014_llm_call_log
"""
from alembic import op
import sqlalchemy as sa


revision = "0015_llm_call_log_tokens"
down_revision = "0014_llm_call_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_call_log", sa.Column("prompt_tokens", sa.Integer(), nullable=True))
    op.add_column("llm_call_log", sa.Column("completion_tokens", sa.Integer(), nullable=True))
    op.add_column("llm_call_log", sa.Column("cached_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_call_log", "cached_tokens")
    op.drop_column("llm_call_log", "completion_tokens")
    op.drop_column("llm_call_log", "prompt_tokens")
```

(c) `backend/services/cost_meter.py` — extend `log_call` (line 86). New signature and the one changed statement (docstring and SAVEPOINT structure unchanged):

```python
def log_call(
    db: Session, *, user_id: str, session_id, purpose: str, model: str, cost_usd,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cached_tokens: int | None = None,
) -> None:
```

and inside the `begin_nested` block:

```python
            db.add(LlmCallLog(
                user_id=user_id, session_id=session_id, purpose=purpose,
                model=model, cost_usd=_quantize(cost),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cached_tokens=cached_tokens,
            ))
```

(d) Add `extract_usage` directly below `log_call`:

```python
def extract_usage(resp) -> dict:
    """Tolerantly read token usage off a LiteLLM response (acompletion result
    or stream_chunk_builder output). Returns exactly the keys log_call accepts
    as token kwargs, so callers can splat: log_call(..., **extract_usage(r)).

    cached_tokens carries the Gemini implicit-prefix-cache hit count. LiteLLM
    normalizes Gemini's cachedContentTokenCount into OpenAI-style
    usage.prompt_tokens_details.cached_tokens on current versions; the raw
    Gemini field name is probed as a fallback. Instrumentation only -- never
    raises (it runs inside the billed turn path).
    """
    out = {"prompt_tokens": None, "completion_tokens": None, "cached_tokens": None}
    try:
        usage = getattr(resp, "usage", None)
        if usage is None:
            return out
        out["prompt_tokens"] = getattr(usage, "prompt_tokens", None)
        out["completion_tokens"] = getattr(usage, "completion_tokens", None)
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            cached = getattr(details, "cached_tokens", None)
            if cached is None:
                cached = getattr(details, "cached_content_token_count", None)
            out["cached_tokens"] = cached
    except Exception:  # noqa: BLE001 - instrumentation must never break a turn
        pass
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

From `backend/`: `pytest tests/test_llm_call_log.py tests/test_extract_usage.py -v`
Expected: PASS (existing 4 + new 5).

- [ ] **Step 5: Verify single alembic head**

From `backend/`: `alembic heads`
Expected: exactly one head, `0015_llm_call_log_tokens`.

- [ ] **Step 6: Commit**

```bash
git add backend/db/models.py backend/db/alembic/versions/0015_llm_call_log_tokens.py backend/services/cost_meter.py backend/tests/test_llm_call_log.py backend/tests/test_extract_usage.py
git commit -m "feat(backend): token-count instrumentation columns on llm_call_log (migration 0015)"
```

---

### Task 4: Feed usage from tutor loop and summary service

**Files:**
- Modify: `backend/agent/tutor.py:185-203` (per-iteration cost block)
- Modify: `backend/services/summary_service.py:72-79` (`log_call` call)
- Test: `backend/tests/test_tutor_stream.py` (add one test; existing fake-stream helpers in that file are the pattern), `backend/tests/test_summary_service.py` (extend the existing cost test)

**Interfaces:**
- Consumes: `cost_meter.extract_usage(resp)` and token kwargs on `log_call` (Task 3).
- Produces: `llm_call_log` rows for chat/followup/summary calls carry token counts when the provider reports them. The cancellation-path `log_call` (`tutor.py:377`) intentionally stays token-less (estimates only, no usage object).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_tutor_stream.py`, add a test following the file's existing fake-stream + monkeypatch pattern (see its existing tests around lines 285 and 332 for the `stream_chunk_builder`/`completion_cost` monkeypatching idiom and whatever fake-response scaffolding drives `run_streaming` to a plain-text final answer). The new test pins `stream_chunk_builder` to a usage-bearing namespace and spies on `log_call`:

```python
async def test_stream_logs_token_usage(db_session, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    built = SimpleNamespace(usage=SimpleNamespace(
        prompt_tokens=1500, completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_tokens=1100),
    ))
    monkeypatch.setattr(
        "agent.tutor.litellm.stream_chunk_builder", MagicMock(return_value=built)
    )
    monkeypatch.setattr(
        "agent.tutor.litellm.completion_cost", MagicMock(return_value=0.01)
    )
    log_call_spy = MagicMock()
    monkeypatch.setattr("agent.tutor.cost_meter.log_call", log_call_spy)
    # ...drive run_streaming to completion with the file's fake single-iteration
    # text-only stream (reuse the same helper/fixture the neighboring tests use)...

    assert log_call_spy.call_count == 1
    kwargs = log_call_spy.call_args.kwargs
    assert kwargs["prompt_tokens"] == 1500
    assert kwargs["completion_tokens"] == 200
    assert kwargs["cached_tokens"] == 1100
```

The elided "drive run_streaming" lines are whatever the adjacent passing test in that file does verbatim (fake acompletion stream, ToolContext construction, consuming the async iterator) — copy that scaffolding; only the monkeypatched `built` and the spy assertions are new.

In `backend/tests/test_summary_service.py`, extend the existing test around line 75 (the one that monkeypatches `services.summary_service.litellm.completion_cost`): give its fake `acompletion` response a `usage` namespace (`usage=SimpleNamespace(prompt_tokens=50, completion_tokens=10, prompt_tokens_details=None)`) and assert the persisted `LlmCallLog` row (or spied `log_call` kwargs, matching that file's existing assertion style) has `prompt_tokens == 50`, `completion_tokens == 10`, `cached_tokens is None`.

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_tutor_stream.py tests/test_summary_service.py -v`
Expected: new tests FAIL — `log_call` called without token kwargs (`KeyError: 'prompt_tokens'` on `call_args.kwargs` access).

- [ ] **Step 3: Implement**

(a) `backend/agent/tutor.py` — the per-iteration cost block (lines 185-203). Initialize `built = None` before the try, keep it on failure, splat usage into `log_call`:

```python
            built = None
            try:
                built = litellm.stream_chunk_builder(chunks, messages=full)
                cost = litellm.completion_cost(completion_response=built) or 0.0
            except Exception as e:
                log.warning("stream completion_cost failed: %s", e)
                cost = 0.0
            if cost > 0:
                try:
                    cost_meter.record_cost(ctx.db, ctx.user_id, cost)
                except Exception as e:
                    log.warning("cost_meter.record_cost failed: %s", e)
                cost_meter.log_call(
                    ctx.db,
                    user_id=ctx.user_id,
                    session_id=ctx.session_id,
                    purpose="followup" if getattr(ctx, "suppress_check", False) else "chat",
                    model=settings.model,
                    cost_usd=cost,
                    **cost_meter.extract_usage(built),
                )
```

(b) `backend/services/summary_service.py:72-79` — add one line to the existing call:

```python
            cost_meter.log_call(
                db,
                user_id=session.user_id,
                session_id=session.id,
                purpose="summary",
                model=settings.model,
                cost_usd=cost,
                **cost_meter.extract_usage(resp),
            )
```

- [ ] **Step 4: Run the affected suites**

From `backend/`: `pytest tests/test_tutor_stream.py tests/test_summary_service.py tests/test_cost_cap.py tests/test_tutor_loop.py tests/test_chat_check_attach.py -v`
Expected: PASS. Existing tests pin `stream_chunk_builder` to a bare `SimpleNamespace()` — `extract_usage` returns all-None for those, so they must pass unchanged. If any spy asserts exact `log_call` kwargs, extend the expectation with the three None-valued token keys.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py backend/services/summary_service.py backend/tests/test_tutor_stream.py backend/tests/test_summary_service.py
git commit -m "feat(backend): log per-call token usage from tutor and summary paths"
```

---

### Task 5: Prompt prefix-stability guard (P1 AC2)

**Files:**
- Test: `backend/tests/test_prompts.py` (append; no production change expected)

**Interfaces:**
- Consumes: `prompts.build_system_prompt(state)`, `prompts.IMMUTABLE_RULES` (existing, `backend/agent/prompts.py:17,177`).
- Produces: a regression guard; nothing downstream consumes it.

- [ ] **Step 1: Write the test (expected to pass immediately — it is a guard)**

Append to `backend/tests/test_prompts.py`, matching its existing import style:

```python
def test_system_prompt_prefix_is_byte_identical_across_turns():
    """Gemini's implicit prefix cache only helps if the prompt head never
    varies. All per-turn material must render strictly after IMMUTABLE_RULES.
    (Roadmap P1 AC2 -- guards the cache-friendliness CLAUDE.md promises.)"""
    state_a = {
        "topic": "photosynthesis",
        "profile": {"knowledge_level": "beginner", "confirmed_gaps": ["light reactions"]},
        "ingestion_status": "ready",
        "retrieval_required": True,
        "seed_mode": "fresh",
    }
    state_b = {
        "topic": "linear algebra",
        "profile": {"knowledge_level": "advanced", "mastered_concepts": ["matrix rank"]},
        "ingestion_status": "none",
        "retrieval_required": False,
        "seed_mode": "resume",
        "quiz_cooldown": {"gap": "eigenvalues", "last_score": "1/3"},
    }
    a = prompts.build_system_prompt(state_a)
    b = prompts.build_system_prompt(state_b)
    n = len(prompts.IMMUTABLE_RULES)
    assert a[:n] == prompts.IMMUTABLE_RULES
    assert b[:n] == prompts.IMMUTABLE_RULES
    assert a[:n] == b[:n]
    # No per-turn material may leak into the stable prefix.
    assert "photosynthesis" not in a[:n]
    assert "linear algebra" not in b[:n]
```

If `test_prompts.py` imports functions individually rather than the module, adapt (`from agent import prompts` vs existing style — follow the file).

- [ ] **Step 2: Run it**

From `backend/`: `pytest tests/test_prompts.py -v`
Expected: PASS (assembly is already rules-first). If it FAILS, stop and report — that would contradict the audited code and must be investigated, not patched around.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_prompts.py
git commit -m "test(backend): guard byte-identical system-prompt prefix for cache reuse"
```

---

### Task 6: `context_budget.truncate_message` + history-window wiring (P2 AC2)

**Files:**
- Create: `backend/agent/context_budget.py`
- Modify: `backend/routes/chat.py:109` (history mapping)
- Test: Create `backend/tests/test_context_budget.py`; extend an existing chat-route test file only if Step 4 flags a regression

**Interfaces:**
- Consumes: nothing new.
- Produces: `truncate_message(content: str, max_chars: int = MAX_MESSAGE_CHARS) -> str`; module constants `MAX_MESSAGE_CHARS = 6000`, `TRUNCATION_MARKER`. Task 7 adds `prune_superseded_excerpts` to this same module; Task 9 imports both.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_context_budget.py
"""context_budget: char-based token-volume controls (roadmap P2).

Char-based on purpose: deterministic, no tokenizer in the billed turn path,
model-independent tests. 6000 chars approximates a 1.5k-token cap at ~4
chars/token.
"""
from agent import context_budget
from agent.context_budget import MAX_MESSAGE_CHARS, TRUNCATION_MARKER, truncate_message


def test_short_content_unchanged():
    assert truncate_message("hello") == "hello"


def test_content_at_cap_unchanged():
    s = "x" * MAX_MESSAGE_CHARS
    assert truncate_message(s) == s


def test_content_over_cap_truncated_to_cap_with_marker():
    s = "H" * 5000 + "T" * 5000
    out = truncate_message(s)
    assert len(out) == MAX_MESSAGE_CHARS
    assert TRUNCATION_MARKER in out
    assert out.startswith("H")
    assert out.endswith("T")


def test_head_tail_split_preserves_both_ends():
    s = "".join(str(i % 10) for i in range(20000))
    out = truncate_message(s, max_chars=1000)
    head, tail = out.split(TRUNCATION_MARKER)
    assert s.startswith(head)
    assert s.endswith(tail)
    assert len(head) > len(tail) > 0


def test_none_and_empty_are_safe():
    assert truncate_message(None) is None
    assert truncate_message("") == ""
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_context_budget.py -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

```python
# backend/agent/context_budget.py
"""Token-volume controls for the tutor turn (roadmap P2).

Pure functions, no DB, no LLM. Char-based rather than tokenizer-based:
deterministic, zero hot-path tokenizer cost, model-independent. 6000 chars
approximates a 1.5k-token per-message cap at ~4 chars/token.
"""

TRUNCATION_MARKER = "\n...[truncated]...\n"
MAX_MESSAGE_CHARS = 6000
_HEAD_FRACTION = 0.7  # keep more head than tail: openings carry the intent


def truncate_message(content, max_chars: int = MAX_MESSAGE_CHARS):
    """Cap a history message's content, preserving head and tail around an
    explicit marker so the model sees that material was elided. Returns the
    input unchanged when it fits (or is None/empty)."""
    if not content or len(content) <= max_chars:
        return content
    budget = max_chars - len(TRUNCATION_MARKER)
    head = int(budget * _HEAD_FRACTION)
    tail = budget - head
    return content[:head] + TRUNCATION_MARKER + content[-tail:]
```

- [ ] **Step 4: Wire into the history window**

In `backend/routes/chat.py`, add the import next to the other `agent` imports (the file already imports `prompts` from `agent` — match that style):

```python
from agent import context_budget
```

Change line 109 from:

```python
    messages = [{"role": m.role, "content": m.content} for m in history]
```

to:

```python
    # P2: cap each history message; the current user message (appended below)
    # and the system prompt are exempt.
    messages = [
        {"role": m.role, "content": context_budget.truncate_message(m.content)}
        for m in history
    ]
```

- [ ] **Step 5: Run tests**

From `backend/`: `pytest tests/test_context_budget.py -v` then the full suite `pytest`
Expected: new tests PASS; full suite green (no existing chat test sends a >6000-char history message, so behavior is unchanged for them — if one fails, it is asserting on message passthrough of oversized content and should be updated to expect truncation).

- [ ] **Step 6: Commit**

```bash
git add backend/agent/context_budget.py backend/tests/test_context_budget.py backend/routes/chat.py
git commit -m "feat(backend): per-message history truncation with head+tail preservation"
```

---

### Task 7: `prune_superseded_excerpts` + tutor-loop wiring (P2 AC1)

**Files:**
- Modify: `backend/agent/context_budget.py` (add function)
- Modify: `backend/agent/tutor.py` (one call after the tool-dispatch loop, before the `if asked_check:` block at line 343)
- Test: `backend/tests/test_context_budget.py` (extend) and `backend/tests/test_tutor_stream.py` (one integration test)

**Interfaces:**
- Consumes: the loop's `full` message-list shape — tool results are `{"role": "tool", "tool_call_id", "name", "content": <json string>}` (`tutor.py:334-341`); retrieval content is `json.dumps` of a payload whose `data.chunks[*]` have `doc_id`, `doc_name`, `text` (text already `<document_excerpt>`-wrapped, `tutor.py:323-330`).
- Produces: `prune_superseded_excerpts(messages: list[dict]) -> None` (in-place). Task 9 imports it.

- [ ] **Step 1: Write the failing unit tests**

Append to `backend/tests/test_context_budget.py`:

```python
import json

from agent.context_budget import prune_superseded_excerpts


def _tool_msg(call_id, chunks):
    payload = {"status": "ok", "data": {"chunks": chunks}}
    return {
        "role": "tool", "tool_call_id": call_id, "name": "retrieve_chunks",
        "content": json.dumps(payload),
    }


def _chunk(doc_id, doc_name, text):
    return {"doc_id": doc_id, "doc_name": doc_name,
            "text": f"<document_excerpt id='{doc_id}'>{text}</document_excerpt>"}


def test_older_retrieval_stubbed_newest_kept():
    older = _tool_msg("c1", [_chunk("d1", "notes.pdf", "old material")])
    newer = _tool_msg("c2", [_chunk("d2", "slides.pdf", "new material")])
    msgs = [
        {"role": "system", "content": "rules"},
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": None, "tool_calls": []},
        older,
        {"role": "assistant", "content": None, "tool_calls": []},
        newer,
    ]
    prune_superseded_excerpts(msgs)
    assert "old material" not in msgs[3]["content"]
    assert msgs[3]["content"].startswith("[superseded retrieval:")
    assert "d1" in msgs[3]["content"]
    assert "notes.pdf" in msgs[3]["content"]
    # Transport fields intact so the transcript stays LiteLLM-valid.
    assert msgs[3]["role"] == "tool"
    assert msgs[3]["tool_call_id"] == "c1"
    assert msgs[3]["name"] == "retrieve_chunks"
    # Newest retrieval untouched.
    assert "new material" in msgs[5]["content"]


def test_single_retrieval_is_noop():
    only = _tool_msg("c1", [_chunk("d1", "notes.pdf", "material")])
    msgs = [{"role": "user", "content": "q"}, only]
    before = json.loads(json.dumps(msgs))
    prune_superseded_excerpts(msgs)
    assert msgs == before


def test_non_retrieval_tool_messages_untouched():
    profile_tool = {
        "role": "tool", "tool_call_id": "c0", "name": "update_topic_profile",
        "content": json.dumps({"status": "ok", "data": {}}),
    }
    older = _tool_msg("c1", [_chunk("d1", "a.pdf", "one")])
    newer = _tool_msg("c2", [_chunk("d2", "b.pdf", "two")])
    msgs = [profile_tool, older, newer]
    prune_superseded_excerpts(msgs)
    assert msgs[0]["content"] == json.dumps({"status": "ok", "data": {}})
    assert msgs[1]["content"].startswith("[superseded retrieval:")


def test_malformed_content_still_stubbed_without_raising():
    older = {
        "role": "tool", "tool_call_id": "c1", "name": "retrieve_chunks",
        "content": "not json <document_excerpt id='d1'>x</document_excerpt>",
    }
    newer = _tool_msg("c2", [_chunk("d2", "b.pdf", "two")])
    msgs = [older, newer]
    prune_superseded_excerpts(msgs)
    assert msgs[0]["content"].startswith("[superseded retrieval:")
    assert "<document_excerpt" not in msgs[0]["content"]
```

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_context_budget.py -v`
Expected: new tests FAIL — `prune_superseded_excerpts` undefined.

- [ ] **Step 3: Implement**

Append to `backend/agent/context_budget.py`:

```python
import json

_EXCERPT_SENTINEL = "<document_excerpt"
_STUB_PREFIX = "[superseded retrieval:"


def _excerpt_stub(content: str) -> str:
    """One-line replacement for a superseded retrieval payload, retaining
    just enough (doc ids + names) for the model to re-request if needed."""
    try:
        payload = json.loads(content)
        chunks = ((payload.get("data") or {}).get("chunks")) or []
        ids = sorted({str(c.get("doc_id")) for c in chunks if c.get("doc_id")})
        names = sorted({str(c.get("doc_name")) for c in chunks if c.get("doc_name")})
        detail = ", ".join(ids + names) or "unknown"
        count = len(chunks)
    except Exception:  # noqa: BLE001 - stub must never fail the turn
        detail = "unparseable payload"
        count = 0
    return f"{_STUB_PREFIX} {count} chunks from {detail}; a newer retrieval supersedes this]"


def prune_superseded_excerpts(messages: list[dict]) -> None:
    """In-place: replace the content of every tool message carrying
    document_excerpt blocks EXCEPT the most recent one with a one-line stub.
    Earlier same-turn retrievals otherwise get re-sent to the model on every
    remaining loop iteration (~2.5k tokens each). Transport fields
    (tool_call_id, name, role) are preserved so the transcript stays valid;
    assistant and non-retrieval tool messages are never touched."""
    carriers = [
        i for i, m in enumerate(messages)
        if m.get("role") == "tool" and _EXCERPT_SENTINEL in (m.get("content") or "")
    ]
    for i in carriers[:-1]:
        if not messages[i]["content"].startswith(_STUB_PREFIX):
            messages[i]["content"] = _excerpt_stub(messages[i]["content"])
```

Move the `import json` to the top of the module with the docstring (single import block).

- [ ] **Step 4: Wire into the tutor loop**

In `backend/agent/tutor.py`: add `from agent import context_budget` beside the existing `from agent.excerpt import wrap_chunk`-style imports (match the file's import style — it may use bare `import` forms; follow it). Then, after the tool-dispatch `for slot in ordered:` loop ends and before the `if asked_check:` block (line 343), insert:

```python
            # P2: earlier same-turn retrieval payloads are superseded once a
            # newer one exists; stub them so they stop re-billing every
            # remaining iteration.
            context_budget.prune_superseded_excerpts(full)
```

- [ ] **Step 5: Write the integration test (failing check first is impractical here — wiring already done; the test pins it)**

Add to `backend/tests/test_tutor_stream.py`, reusing the file's fake-stream scaffolding: a scenario where the fake LLM issues `retrieve_chunks` on iteration 1, `retrieve_chunks` again on iteration 2, and plain text on iteration 3. Capture the `messages` argument of each `acompletion` call (the file's fake records calls; if not, wrap the monkeypatched fake to append `kwargs["messages"]` to a list). Assert on the third call's captured messages:

```python
    third_call_msgs = captured_messages[2]
    tool_msgs = [m for m in third_call_msgs if m.get("role") == "tool" and m.get("name") == "retrieve_chunks"]
    assert len(tool_msgs) == 2
    assert tool_msgs[0]["content"].startswith("[superseded retrieval:")
    assert "<document_excerpt" in tool_msgs[1]["content"]
```

- [ ] **Step 6: Run tests**

From `backend/`: `pytest tests/test_context_budget.py tests/test_tutor_stream.py -v` then full `pytest`
Expected: PASS all.

- [ ] **Step 7: Commit**

```bash
git add backend/agent/context_budget.py backend/agent/tutor.py backend/tests/test_context_budget.py backend/tests/test_tutor_stream.py
git commit -m "feat(backend): stub superseded same-turn retrieval payloads in the tutor loop"
```

---

### Task 8: `estimate_cancelled_cost` unknown-model fallback (P2 AC5)

**Files:**
- Modify: `backend/services/cost_meter.py:143-166`
- Test: `backend/tests/test_cost_meter_estimate.py` (replace the KeyError test at lines 63-67; add fallback tests)

**Interfaces:**
- Consumes: `litellm.cost_per_token(model=..., prompt_tokens=..., completion_tokens=...) -> (prompt_cost_usd, completion_cost_usd)`.
- Produces: `estimate_cancelled_cost` never raises `KeyError`; unknown models fall back to LiteLLM's price table, then to `Decimal("0")`.

- [ ] **Step 1: Rewrite the failing tests**

In `backend/tests/test_cost_meter_estimate.py`, delete the `pytest.raises(KeyError)` test (lines ~63-67) and add:

```python
def test_unknown_model_falls_back_to_litellm_price_table(monkeypatch):
    """P2 AC5: an unregistered model id must not raise mid-turn."""
    monkeypatch.setattr(
        "services.cost_meter.litellm.token_counter", lambda model, text: 10
    )
    monkeypatch.setattr(
        "services.cost_meter.litellm.cost_per_token",
        lambda model, prompt_tokens, completion_tokens: (0.001, 0.002),
    )
    cost = estimate_cancelled_cost("some/unknown-model", "partial reply", 100)
    assert cost == Decimal("0.003")


def test_unknown_model_double_failure_returns_zero(monkeypatch):
    monkeypatch.setattr(
        "services.cost_meter.litellm.token_counter", lambda model, text: 10
    )
    def _boom(**kwargs):
        raise ValueError("model not mapped")
    monkeypatch.setattr("services.cost_meter.litellm.cost_per_token", _boom)
    cost = estimate_cancelled_cost("some/unknown-model", "partial reply", 100)
    assert cost == Decimal("0")
```

Add `from decimal import Decimal` to the imports if absent. Keep every other existing test in the file unchanged (known-model math must not move).

- [ ] **Step 2: Run tests to verify they fail**

From `backend/`: `pytest tests/test_cost_meter_estimate.py -v`
Expected: new tests FAIL with `KeyError`.

- [ ] **Step 3: Implement the fallback**

Replace the body of `estimate_cancelled_cost` (keep the docstring's cost-accuracy paragraphs; update the last line of the docstring from "Raises KeyError..." to "Unknown models fall back to litellm.cost_per_token, then to 0."):

```python
    rates = MODEL_RATES.get(model)
    output_tokens = litellm.token_counter(model=model, text=delta_text or "")
    if rates is not None:
        prompt_cost = Decimal(prompt_tokens) * rates["input_per_1k"]
        output_cost = Decimal(output_tokens) * rates["output_per_1k"]
        return (prompt_cost + output_cost) / Decimal(1000)
    try:
        prompt_usd, completion_usd = litellm.cost_per_token(
            model=model, prompt_tokens=prompt_tokens, completion_tokens=output_tokens
        )
        return _to_decimal(prompt_usd) + _to_decimal(completion_usd)
    except Exception as e:  # noqa: BLE001 - cancellation metering must not raise
        log.warning("cost fallback failed for model %s: %s", model, e)
        return Decimal("0")
```

- [ ] **Step 4: Run tests**

From `backend/`: `pytest tests/test_cost_meter_estimate.py -v` then full `pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cost_meter.py backend/tests/test_cost_meter_estimate.py
git commit -m "fix(backend): unknown-model cost estimate falls back to litellm price table"
```

---

### Task 9: Token-budget regression guard (P2 AC4)

**Files:**
- Test: Create `backend/tests/test_token_budget.py`

**Interfaces:**
- Consumes: `prompts.build_system_prompt`, `context_budget.truncate_message`, `context_budget.prune_superseded_excerpts` (Tasks 5-7), `litellm.token_counter` (test-time only).
- Produces: a loud tripwire; nothing downstream.

- [ ] **Step 1: Write the fixture test**

```python
# backend/tests/test_token_budget.py
"""P2 AC4: fixture-based token-budget tripwire.

Assembles a canonical 3-turn conversation with one retrieval through the
REAL truncation/pruning helpers and asserts the token total stays under
TOKEN_BUDGET. The budget is a measured baseline plus slack, not a spec
number -- its job is to break loudly if prompt/window assembly regresses
(e.g. someone removes truncation or starts resending full excerpts).
"""
import json

import litellm

from agent import context_budget, prompts
from config import settings

# Set in Step 2 from the measured baseline (printed value * 1.10, rounded up
# to the nearest 100). Do not raise casually: an increase here means every
# turn got more expensive.
TOKEN_BUDGET = 0  # PLACEHOLDER until Step 2 measurement -- test fails loudly at 0


def _assembled_turn():
    state = {
        "topic": "photosynthesis",
        "profile": {"knowledge_level": "beginner", "confirmed_gaps": ["light reactions"]},
        "ingestion_status": "ready",
        "retrieval_required": True,
    }
    system_prompt = prompts.build_system_prompt(state)
    long_answer = "The light-dependent reactions occur in the thylakoid membrane. " * 150
    history = [
        {"role": "user", "content": "What is photosynthesis?"},
        {"role": "assistant", "content": long_answer},
        {"role": "user", "content": "Where do the light reactions happen?"},
        {"role": "assistant", "content": long_answer},
    ]
    messages = [
        {"role": m["role"], "content": context_budget.truncate_message(m["content"])}
        for m in history
    ]
    messages.append({"role": "user", "content": "Quiz me on the Calvin cycle."})
    chunk_text = "Chunk sentence about the Calvin cycle and carbon fixation. " * 40
    chunks = [
        {"doc_id": f"d{i}", "doc_name": "bio-notes.pdf",
         "text": f"<document_excerpt id='d{i}'>{chunk_text}</document_excerpt>"}
        for i in range(5)
    ]
    full = [{"role": "system", "content": system_prompt}] + messages
    full.append({
        "role": "assistant", "content": None,
        "tool_calls": [{"id": "c1", "type": "function",
                        "function": {"name": "retrieve_chunks", "arguments": "{}"}}],
    })
    full.append({
        "role": "tool", "tool_call_id": "c1", "name": "retrieve_chunks",
        "content": json.dumps({"status": "ok", "data": {"chunks": chunks}}),
    })
    context_budget.prune_superseded_excerpts(full)
    return full


def test_canonical_turn_stays_under_token_budget():
    full = _assembled_turn()
    total = litellm.token_counter(model=settings.model, messages=full)
    print(f"measured canonical-turn tokens: {total}")
    assert 0 < total <= TOKEN_BUDGET, (
        f"canonical turn measured {total} tokens against budget {TOKEN_BUDGET}; "
        "if this is an intentional prompt/window change, re-baseline the budget "
        "constant with the same *1.10 slack rule and record why in the commit."
    )
```

- [ ] **Step 2: Measure the baseline and set the constant**

From `backend/`: `pytest tests/test_token_budget.py -v -s`
Expected: FAIL (budget 0); the printed `measured canonical-turn tokens: N` line is the baseline. Set `TOKEN_BUDGET = ceil(N * 1.10 / 100) * 100` (e.g. measured 4,120 → 4,600) and delete the `PLACEHOLDER` remark, leaving the re-baseline comment.

- [ ] **Step 3: Run to verify it passes**

From `backend/`: `pytest tests/test_token_budget.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_token_budget.py
git commit -m "test(backend): token-budget tripwire for canonical turn assembly"
```

---

### Task 10: Final sweep, roadmap bookkeeping, PR

**Files:**
- Modify: `docs/planning/2026-07-06-10x-roadmap.md` (status lines under P1, P2, and section 7)

**Interfaces:**
- Consumes: everything above, merged on `feat/roadmap-slice2`.
- Produces: PR to `dev` with owed human gates in the body.

- [ ] **Step 1: Full gates**

From `backend/`: `pytest` — expected: all pass (slice-1 baseline was 451 pass / 5 skip; expect ~15 more).
From `frontend/`: `npm run test:unit -- --run` and `npm run lint` — expected: all pass, lint clean.
From repo root: `python backend/scripts/gen_contracts.py` then `git status` — expected: no diff (nothing in this slice touches openapi.yaml; a diff means a contract drifted — stop and report).
From `backend/`: `alembic heads` — expected: single head `0015_llm_call_log_tokens`.

- [ ] **Step 2: Update the roadmap doc**

In `docs/planning/2026-07-06-10x-roadmap.md`, mirroring the slice-1 status style (see R0.1/R0.2/S1/S2 "Status: in PR" blocks):
- Under **P1** heading add: `Status: in PR (feat/roadmap-slice2) — AC1 instrumentation half shipped (llm_call_log token columns, migration 0015, extract_usage); dogfood-day measurement + cache decision = owed human gate; AC2 prefix guard test shipped; AC3 stays documented-conditional.`
- Under **P2** heading add: `Status: in PR (feat/roadmap-slice2) — AC1 (prune_superseded_excerpts), AC2 (truncate_message 6k chars head+tail), AC4 (token-budget tripwire), AC5 (cost fallback) shipped; AC3 rolling summary deferred (composes with v2 draft-summary item).`
- In section 7's sequencing block or beside it, note the slice-1 follow-up closed: `Streaming 429->cap-banner mapping restored via lib/capErrors.js (slice 2).`

- [ ] **Step 3: Commit and push**

```bash
git add docs/planning/2026-07-06-10x-roadmap.md
git commit -m "docs: mark slice 2 items in PR in 10x roadmap"
git push -u origin feat/roadmap-slice2
```

- [ ] **Step 4: Open the PR**

`gh pr create --base dev --title "Roadmap slice 2: cost track (P1/P2) + streaming cap-banner fix" --body` with: summary of the three items; test counts; and an **Owed human gates** section listing (1) live `alembic upgrade head` vs Supabase (0015, additive/nullable), (2) dogfood-day cache measurement over `llm_call_log` (`SELECT model, count(*), avg(cached_tokens::float / nullif(prompt_tokens,0)) FROM llm_call_log WHERE created_at > now() - interval '1 day' GROUP BY model;`) + recorded implicit-vs-explicit cache decision, (3) live cap smoke: `DAILY_CAP=1` (and/or cost hard-cap trip) → cap banner + toast appear on the streaming path.

---

## Self-Review Notes (author-run)

- **Spec coverage:** A → Tasks 1-2. B → Tasks 3-5 (migration+capture+guard; summary path in Task 4). C → Tasks 6-9 (AC2, AC1, AC5, AC4 respectively). Bookkeeping + gates → Task 10. P2 AC3 and P1 AC3 deliberately absent per spec.
- **Type consistency:** `mapCapError(detail)` consumed as written in Task 2; `extract_usage` keys == `log_call` token kwarg names (splat-compatible); `truncate_message`/`prune_superseded_excerpts` signatures identical in Tasks 6/7/9.
- **Known judgment calls for the implementer:** Task 4's stream-scaffolding reuse and Task 9's measured budget constant are measurement/reuse steps by design, not underspecification.
