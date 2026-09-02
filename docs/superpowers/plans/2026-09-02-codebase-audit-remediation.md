# Codebase Audit Remediation (2026-09-02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six verified defects found in the 2026-09-02 codebase audit: mis-routed cap-error copy in the frontend, no burst rate limit on the Render deploy (QA B-07), no retry on transient LLM/embedding failures, pgvector integration test silently skipped in CI, e2e suite non-blocking, and a small hygiene batch.

**Architecture:** Each task is independent and lands as its own commit on one branch `fix/audit-2026-09-02`. Backend changes follow the existing pattern: settings in `config.py`, pure helpers in `lib/` or `services/`, guards wired as FastAPI dependencies. Frontend changes route every backend `detail.code` through the two existing choke points (`lib/errors.js` and `lib/capErrors.js`) so copy cannot drift per call site.

**Tech Stack:** FastAPI, SQLAlchemy, LiteLLM, pytest (from `backend/`), Vue 3 + Pinia + Vitest (from `frontend/`), GitHub Actions.

**Spec:** This plan is its own spec. Findings and evidence are in the "Verified findings" section below. Design-doc precedence still applies: `docs/superpowers/specs/2026-05-03-crux-v1-design.md` wins on any conflict.

## Global Constraints

- Run `pytest` from `backend/`, never repo root. Run vitest as `npm run test:unit -- --run` from `frontend/`.
- No emojis in code or comments. ASCII only in script output.
- `backend/contracts/` is codegen. No task here touches `docs/api/openapi.yaml`, so no codegen run is needed. If you find you need to, stop and surface it.
- Error-code strings live in `backend/lib/error_codes.py` and `frontend/src/lib/errorCodes.js` and MUST stay identical.
- SHA-pin every new GitHub Actions `uses:`. Docker service images in CI are pinned by tag (matches existing Dockerfile convention).
- Use the native Grep tool for repo-wide sweeps; `rtk rg` returns false zeros.
- Commits: conventional-commit subject, no AI attribution trailers. Verify with `git log -1 --format=%s`.
- PR targets `dev`.

## Verified findings (evidence)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | Medium | `global_cost_cap_reached` (429) and `chunk_limit_exceeded` (413) are raised by the backend but never mapped in the frontend; users see per-user "daily limit" copy for a service-wide budget outage, and generic "request was rejected" for an oversize document. | `backend/routes/chat.py:158-165`, `backend/routes/upload.py:145-152`, `frontend/src/lib/capErrors.js:7-28` (only two codes), `frontend/src/lib/errors.js:9-13`, `frontend/src/lib/errorCodes.js:5-8` (intended copy documented but unused) |
| F2 | Medium | No burst/velocity limit on the Render deploy. nginx `limit_req` exists only in the compose stack; prod is Vercel + Render with the API exposed directly. Only the daily counter applies. QA finding B-07, still `Open` in `docs/reviews/2026-08-06-qa-audit/bug-tracker.csv`. | `frontend/nginx.conf:1-5`, `render.yaml` (no edge rules), `backend/services/rate_limit.py` (daily only) |
| F3 | Medium | Zero retry on any outbound LiteLLM call. One transient 5xx/connection blip fails the whole chat turn, summary, or embedding batch. | Grep `num_retries|tenacity|backoff|max_retries` in `backend/` (excluding `.venv`) = 0 hits. Call sites: `services/ingestion_service.py:140`, `services/retrieval_service.py:44,136,202`, `services/summary_service.py:87,218`, `agent/tutor.py:213` |
| F4 | Medium | The only test that exercises the real pgvector `<=>` SQL is skipped on every CI run because `TEST_DATABASE_URL` is never set and no Postgres service exists. Its docstring falsely claims "CI provides it". Migrations are also only ever run against SQLite in CI. | `backend/tests/test_pgvector_retrieval.py:28-32`; Grep `TEST_DATABASE_URL|pgvector|services:` in `.github/workflows/` = 0 hits |
| F5 | Medium | Playwright job is `continue-on-error: true`, so e2e failures never block. It was deferred through Phase 5; Phase 6 is complete. Last 17 pull_request runs: 16 success, 1 cancelled, 0 failures, so flipping is safe. | `.github/workflows/e2e.yml:23-24`; `gh run list --workflow E2E --limit 40` |
| F6 | Low | Hygiene: runtime image ships `tests/`; `uvicorn` is the only uncapped prod dep; nginx lacks `server_tokens off` and `Permissions-Policy`; Vercel headers lack `Permissions-Policy`; five utility exports have no non-test callers. | `backend/.dockerignore`, `backend/pyproject.toml:11`, `frontend/nginx.conf:7-16`, `frontend/vercel.json:9-18`, `frontend/src/utils/formatDate.js:61-72`, `frontend/src/utils/sessionCard.js:44` |

### Verified but deliberately deferred (not in this plan)

- **Review queue loads every LearningEvent per user on each sidebar boot** (`backend/routes/review.py:26-37`, paginates in Python at line 77). Real, but pre-launch event volume is bounded by the 50/day cap and the fix is not trivial: `streak` is displayed in `ReviewView.vue:23`, so a per-concept window (`ROW_NUMBER() OVER (PARTITION BY lower(trim(gap_tested)) ...) <= 7`, since interval caps at streak 7) would change displayed streaks above 7. Proper fix is a materialized `review_states` table maintained on `record_learning_event` write. Revisit when a real user has more than ~2k events.
- **B-05 cost-cap TOCTOU** (`chat.py:139` plain SELECT) remains `Open` in the QA tracker. F2's velocity limit shrinks the window but does not close it. Separate item.
- **Duplication**: SSE event `switch` blocks in `frontend/src/stores/session.js:580-661` vs `808-869`; SSE pump loops in `backend/routes/chat.py:342-381` vs `backend/routes/sessions.py:741-775`; verbatim ownership check `if row is None or row.user_id != user_id: 404` repeated 9+ times in `routes/sessions.py`. Refactor-only, no behavior change; do as a separate `/simplify` pass.
- **Vite build warnings** `INEFFECTIVE_DYNAMIC_IMPORT` for `apiClient.js` and `router/index.js` (both dynamically and statically imported). Cosmetic; bundle verified working in browser after vite 8.2.2.
- **`alembic upgrade head` runs in `entrypoint.sh` at every container start**. Fine for the single Render instance; not safe if replicas are ever added. Documented in RUNBOOK as part of Task 2's doc edit.

---

## Task 0: Branch

- [ ] **Step 1: Create the branch from up-to-date dev**

```bash
git checkout dev && git pull --ff-only origin dev
git checkout -b fix/audit-2026-09-02
```

---

## Task 1: Route every backend error code to its intended copy (F1)

**Files:**
- Modify: `frontend/src/lib/errorCodes.js`
- Modify: `frontend/src/lib/errors.js:9-13`
- Modify: `frontend/src/lib/capErrors.js`
- Modify: `frontend/src/components/chat/CapBanners.vue:17-30`
- Test: `frontend/src/__tests__/errors.test.js`, `frontend/src/__tests__/capErrors.test.js`, `frontend/src/__tests__/capBanners.test.js`

**Interfaces:**
- Consumes: backend 429 envelope `{ code, resets_at, ... }` from `routes/chat.py` and `routes/upload.py`; 413 envelope `{ code: 'chunk_limit_exceeded', max_chunks, estimated_chunks }`.
- Produces: `mapCapError(detail)` now returns `{ kind: 'daily'|'cost'|null, info }` where cost `info` gains a `scope: 'user' | 'global'` field. `friendlyError(err)` gains a code-first lookup. Task 2 relies on the new `ERR_TOO_MANY_REQUESTS` constant and its copy.

- [ ] **Step 1: Add the new error code constant**

In `frontend/src/lib/errorCodes.js` append:

```js
// Velocity (burst) limiter, see backend/services/velocity_limit.py.
// Copy: "Too many requests - wait a moment and retry."
export const ERR_TOO_MANY_REQUESTS = 'too_many_requests'
```

- [ ] **Step 2: Write the failing friendlyError tests**

Replace the first `describe('errors', ...)` block in `frontend/src/__tests__/errors.test.js` with:

```js
describe('friendlyError', () => {
  const coded = (status, code) => ({ status, body: { detail: { code } } })

  it('distinguishes nginx throttle 429 from daily-cap 429', () => {
    expect(friendlyError(coded(429, 'daily_cap_reached'))).toMatch(/daily limit/i)
    expect(friendlyError({ status: 429, body: '<html>429</html>' })).toMatch(/wait a moment/i)
  })

  it('maps daily_cost_cap_reached to the daily-limit copy', () => {
    expect(friendlyError(coded(429, 'daily_cost_cap_reached'))).toMatch(/daily limit/i)
  })

  it('maps global_cost_cap_reached to service-budget copy, not per-user copy', () => {
    const msg = friendlyError(coded(429, 'global_cost_cap_reached'))
    expect(msg).toMatch(/service has reached its daily budget/i)
    expect(msg).not.toMatch(/you've hit/i)
  })

  it('maps too_many_requests to the wait-and-retry copy', () => {
    expect(friendlyError(coded(429, 'too_many_requests'))).toMatch(/wait a moment/i)
  })

  it('maps chunk_limit_exceeded (413) to the split-the-document copy', () => {
    expect(friendlyError(coded(413, 'chunk_limit_exceeded'))).toMatch(/too large to ingest/i)
  })

  it('falls back to the status copy for an unknown code', () => {
    expect(friendlyError(coded(429, 'something_new'))).toMatch(/daily limit/i)
    expect(friendlyError(coded(400, 'something_new'))).toMatch(/rejected/i)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/errors.test.js`
Expected: FAIL on the global, too_many_requests, and chunk_limit cases.

- [ ] **Step 4: Implement the code-first lookup in friendlyError**

In `frontend/src/lib/errors.js`, add the import and the map at the top, and insert the lookup as the first check after the null guard:

```js
import {
  ERR_DAILY_CAP_REACHED,
  ERR_DAILY_COST_CAP_REACHED,
  ERR_GLOBAL_COST_CAP_REACHED,
  ERR_CHUNK_LIMIT_EXCEEDED,
  ERR_TOO_MANY_REQUESTS,
} from './errorCodes.js'

// Code-first copy. Any backend detail.code listed here wins over the
// status-based fallback below, so a new code only needs one entry.
const CODE_COPY = {
  [ERR_DAILY_CAP_REACHED]: "You've hit the daily limit. Try again tomorrow.",
  [ERR_DAILY_COST_CAP_REACHED]: "You've hit the daily limit. Try again tomorrow.",
  [ERR_GLOBAL_COST_CAP_REACHED]:
    'The service has reached its daily budget. Please try again tomorrow.',
  [ERR_CHUNK_LIMIT_EXCEEDED]:
    'This document is too large to ingest. Try splitting it into smaller files.',
  [ERR_TOO_MANY_REQUESTS]: 'Too many requests - wait a moment and retry.',
}

export function friendlyError(err) {
  if (!err) return ''
  const code = err?.body?.detail?.code
  if (typeof code === 'string' && CODE_COPY[code]) return CODE_COPY[code]
  const status = typeof err === 'object' ? err.status : null
  // ... existing status branches unchanged below ...
```

Keep the existing 429 branch as-is (it is now only reached for unknown or missing codes).

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:unit -- --run src/__tests__/errors.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing mapCapError test**

In `frontend/src/__tests__/capErrors.test.js`, change the import to include `ERR_GLOBAL_COST_CAP_REACHED`, update the two existing cost-shape `toEqual` expectations to include `scope: 'user'`, and add:

```js
  it('maps a global-cap envelope to kind=cost with scope=global and null spend fields', () => {
    const r = mapCapError({ code: ERR_GLOBAL_COST_CAP_REACHED, resets_at: '2026-07-08T00:00:00+00:00' })
    expect(r.kind).toBe('cost')
    expect(r.info).toEqual({
      used_usd: null, soft_cap_usd: null, hard_cap_usd: null,
      resets_at: '2026-07-08T00:00:00+00:00', scope: 'global',
    })
  })
```

- [ ] **Step 7: Run to verify failure**

Run: `npm run test:unit -- --run src/__tests__/capErrors.test.js`
Expected: FAIL (3 tests: two updated shapes, one new).

- [ ] **Step 8: Implement in capErrors.js**

```js
import {
  ERR_DAILY_CAP_REACHED,
  ERR_DAILY_COST_CAP_REACHED,
  ERR_GLOBAL_COST_CAP_REACHED,
} from './errorCodes.js'

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
        scope: 'user',
      },
    }
  }
  if (d.code === ERR_GLOBAL_COST_CAP_REACHED) {
    // Service-wide budget: no per-user spend fields exist on this envelope.
    return {
      kind: 'cost',
      info: {
        used_usd: null,
        soft_cap_usd: null,
        hard_cap_usd: null,
        resets_at: d.resets_at ?? null,
        scope: 'global',
      },
    }
  }
  return { kind: null, info: null }
}
```

- [ ] **Step 9: Run to verify pass**

Run: `npm run test:unit -- --run src/__tests__/capErrors.test.js`
Expected: PASS.

- [ ] **Step 10: Write the failing CapBanners test**

Add to the `describe('CapBanners', ...)` block in `frontend/src/__tests__/capBanners.test.js` (same pattern as the existing cost-cap test: set `store.costCapInfo`, mount, assert):

```js
  it('shows service-budget copy, no dollar figures, when the cost cap scope is global', () => {
    const store = useSessionStore()
    store.costCapInfo = {
      used_usd: null,
      soft_cap_usd: null,
      hard_cap_usd: null,
      resets_at: '2026-05-25T00:00:00Z',
      scope: 'global',
    }
    const wrapper = mount(CapBanners)
    const banner = wrapper.find('[data-testid="session-cost-cap-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Service daily budget reached')
    expect(banner.text()).not.toContain('$')
    expect(banner.text()).not.toContain('Daily cost limit reached')
  })
```

- [ ] **Step 11: Run to verify failure**

Run: `npm run test:unit -- --run src/__tests__/capBanners.test.js`
Expected: FAIL (copy not found).

- [ ] **Step 12: Update CapBanners.vue cost banner**

Replace the cost banner's inner content (`frontend/src/components/chat/CapBanners.vue:24-29`) with:

```vue
    <template v-if="store.costCapInfo?.scope === 'global'">
      <strong>Service daily budget reached.</strong>
      <span>
        Resets at {{ formatShortDateTime(store.costCapInfo.resets_at) || 'midnight UTC' }}.
      </span>
    </template>
    <template v-else>
      <strong>Daily cost limit reached.</strong>
      <span v-if="store.costCapInfo">
        ${{ store.costCapInfo.used_usd }} of ${{ store.costCapInfo.hard_cap_usd }} spent today.
        Resets at {{ formatShortDateTime(store.costCapInfo.resets_at) || 'midnight UTC' }}.
      </span>
    </template>
```

- [ ] **Step 13: Run the full frontend suite and lint**

Run: `npm run test:unit -- --run` then `npm run lint`
Expected: all pass, no lint issues. If `costCapUx.test.js` asserts an exact `costCapInfo` shape, add `scope: 'user'` there too.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/lib frontend/src/components/chat/CapBanners.vue frontend/src/__tests__
git commit -m "fix(frontend): route global cap, chunk limit and burst codes to intended copy"
```

---

## Task 2: Per-user burst limiter for paid endpoints on the Render path (F2, QA B-07)

**Files:**
- Modify: `backend/lib/error_codes.py`
- Modify: `backend/config.py` (after `embedding_timeout_s`)
- Create: `backend/services/velocity_limit.py`
- Modify: `backend/routes/chat.py:322-323` (chat_stream signature)
- Modify: `backend/routes/upload.py:66-74` (upload_file signature)
- Modify: `backend/routes/sessions.py` (the two handlers enclosing lines 479 and 704: session end, and check/complete)
- Modify: `render.yaml` (envVars), `docs/deploy/RUNBOOK.md:110`, `docs/reviews/2026-08-06-qa-audit/bug-tracker.csv` (B-07 Status)
- Test: `backend/tests/test_velocity_limit.py` (new)

**Interfaces:**
- Consumes: `current_user_id` dependency from `services/auth.py:131`; `settings` from `config.py`.
- Produces: `velocity_limit.enforce_velocity(user_id: str = Depends(current_user_id)) -> None` FastAPI dependency raising `HTTPException(429, detail={"code": TOO_MANY_REQUESTS, "retry_after_s": int}, headers={"Retry-After": str(int)})`. Frontend copy for this code was added in Task 1.

Design: in-process sliding-window counter keyed by `user_id`, `settings.burst_limit_per_minute` requests per rolling 60 s. `0` disables (default, so tests and local dev are unaffected). 20/min is safe for the upload flow: `SessionView.vue:765` uploads one file per gesture, sequentially (guarded by `uploadGen`), so a legitimate user cannot exceed it. In-process is correct for this deployment: one Render instance, one uvicorn worker (`entrypoint.sh` has no `--workers`; see `main.py:21-35` for the in-process ingest loop that already assumes this). Document that constraint.

- [ ] **Step 1: Add error code and setting**

`backend/lib/error_codes.py` append:

```python
TOO_MANY_REQUESTS = "too_many_requests"
```

`backend/config.py` after `embedding_timeout_s: float = 15.0`:

```python
    # B-07: per-user burst limit on paid endpoints (chat turn, upload, end,
    # check/complete). Rolling 60 s window, in-process (single Render
    # instance, single uvicorn worker). 0 disables. Independent of daily_cap.
    burst_limit_per_minute: int = 0
```

- [ ] **Step 2: Write the failing unit tests**

Create `backend/tests/test_velocity_limit.py`:

```python
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from config import settings
from lib.error_codes import TOO_MANY_REQUESTS
from services import velocity_limit
from services.auth import current_user_id


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    velocity_limit.reset()
    monkeypatch.setattr(settings, "burst_limit_per_minute", 3)
    yield
    velocity_limit.reset()


def test_allows_up_to_limit_then_blocks():
    clock = [1000.0]
    for _ in range(3):
        assert velocity_limit.check("u1", now=clock[0]) is None
    retry = velocity_limit.check("u1", now=clock[0])
    assert isinstance(retry, int) and 1 <= retry <= 60


def test_window_slides():
    assert velocity_limit.check("u1", now=0.0) is None
    assert velocity_limit.check("u1", now=1.0) is None
    assert velocity_limit.check("u1", now=2.0) is None
    assert velocity_limit.check("u1", now=2.5) == 58  # oldest (t=0) expires at 60
    assert velocity_limit.check("u1", now=60.1) is None


def test_users_isolated():
    for _ in range(3):
        velocity_limit.check("u1", now=0.0)
    assert velocity_limit.check("u2", now=0.0) is None


def test_zero_disables(monkeypatch):
    monkeypatch.setattr(settings, "burst_limit_per_minute", 0)
    for _ in range(50):
        assert velocity_limit.check("u1", now=0.0) is None


def test_dependency_returns_429_envelope():
    app = FastAPI()

    @app.post("/paid", dependencies=[Depends(velocity_limit.enforce_velocity)])
    def paid():
        return {"ok": True}

    app.dependency_overrides[current_user_id] = lambda: "u9"
    c = TestClient(app)
    for _ in range(3):
        assert c.post("/paid").status_code == 200
    r = c.post("/paid")
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == TOO_MANY_REQUESTS
    assert int(r.headers["Retry-After"]) >= 1
```

- [ ] **Step 3: Run to verify failure**

Run from `backend/`: `pytest tests/test_velocity_limit.py -v`
Expected: FAIL with `ModuleNotFoundError: services.velocity_limit`.

- [ ] **Step 4: Implement the limiter**

Create `backend/services/velocity_limit.py`:

```python
"""B-07: per-user burst limiter for paid endpoints.

Sliding 60 s window per user_id, in process memory. Correct for the current
deployment (one Render instance, one uvicorn worker; see entrypoint.sh and
main.py's in-process ingest loop which make the same assumption). If the
API is ever scaled to multiple processes, move the window to Postgres or a
shared cache before raising --workers.

Complements, does not replace, rate_limit.check_and_increment (daily cap):
that bounds spend per day; this bounds how fast the day's budget can be
burned so a leaked token or a runaway client cannot fire 50 LLM turns in
one second.
"""

import threading
import time
from collections import deque

from fastapi import Depends, HTTPException

from config import settings
from lib.error_codes import TOO_MANY_REQUESTS
from services.auth import current_user_id

WINDOW_S = 60.0

_lock = threading.Lock()
_hits: dict[str, deque[float]] = {}


def reset() -> None:
    """Test hook: drop all state."""
    with _lock:
        _hits.clear()


def check(user_id: str, now: float | None = None) -> int | None:
    """Record one hit for user_id. Return None if allowed, else the number of
    whole seconds until the oldest in-window hit expires (>= 1)."""
    limit = settings.burst_limit_per_minute
    if limit <= 0:
        return None
    t = time.monotonic() if now is None else now
    with _lock:
        q = _hits.setdefault(user_id, deque())
        while q and t - q[0] >= WINDOW_S:
            q.popleft()
        if len(q) >= limit:
            retry = WINDOW_S - (t - q[0])
            return max(1, int(retry) if retry == int(retry) else int(retry) + 1)
        q.append(t)
        return None


def enforce_velocity(user_id: str = Depends(current_user_id)) -> None:
    retry_after = check(user_id)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail={"code": TOO_MANY_REQUESTS, "retry_after_s": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
```

Note on `test_window_slides`: at `now=2.5` the oldest hit is `t=0`, `retry = 57.5`, ceil gives 58.

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/test_velocity_limit.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire the dependency onto the four paid routes**

Add `from services import velocity_limit` to each route module, then add the dependency via the decorator so handler bodies are untouched:

`backend/routes/chat.py:322`:
```python
@router.post("/chat/stream", dependencies=[Depends(velocity_limit.enforce_velocity)])
```

`backend/routes/upload.py:66-70`:
```python
@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(velocity_limit.enforce_velocity)],
)
```

`backend/routes/sessions.py`: find the `@router.post(...)` decorators for the handler that contains line 479 (`rate_limit.check_and_increment` inside the session-end path) and the handler that contains line 704 (check/complete). Add `dependencies=[Depends(velocity_limit.enforce_velocity)]` to each. `Depends` is already imported in all three modules; confirm with Grep.

Ordering note: FastAPI resolves decorator `dependencies` before the handler body, so the burst check runs before the cost-cap and daily-cap guards. That is intended: a burst-rejected request must not touch the DB.

- [ ] **Step 7: Run the full backend suite**

Run: `pytest -q`
Expected: all pass. Default `burst_limit_per_minute = 0` means existing tests are unaffected. Also confirm the app still boots: `pytest tests/test_app_boot.py -v`.

- [ ] **Step 8: Deploy config and docs**

`render.yaml` envVars, after `DAILY_CAP`:
```yaml
      - key: BURST_LIMIT_PER_MINUTE
        value: "20"
```

`docs/deploy/RUNBOOK.md` line 110 currently describes the nginx throttle. Append one paragraph:

```markdown
On Render there is no nginx tier. The equivalent guard is the in-process
per-user burst limiter (`BURST_LIMIT_PER_MINUTE`, default 20 on Render, 0 =
off locally). It is process-local: keep the API at one instance and one
uvicorn worker, or move the window to Postgres before scaling out. The same
single-process assumption already applies to the in-process ingest loop and
to `alembic upgrade head` running from `entrypoint.sh` on every start.
```

`docs/reviews/2026-08-06-qa-audit/bug-tracker.csv`: change the B-07 row's last column from `Open` to `Fixed (2026-09-02, services/velocity_limit.py)`. Edit with Python `csv` module to preserve quoting; do not hand-edit a 12-column CSV.

- [ ] **Step 9: Commit**

```bash
git add backend/lib/error_codes.py backend/config.py backend/services/velocity_limit.py backend/routes backend/tests/test_velocity_limit.py render.yaml docs/deploy/RUNBOOK.md docs/reviews/2026-08-06-qa-audit/bug-tracker.csv
git commit -m "feat(backend): per-user burst limiter on paid endpoints (QA B-07)"
```

---

## Task 3: Bounded retry for transient LiteLLM failures (F3)

**Files:**
- Create: `backend/lib/llm_retry.py`
- Modify: `backend/config.py` (after the new burst setting)
- Modify: `backend/services/ingestion_service.py:140-145`
- Modify: `backend/services/retrieval_service.py:44-49`, `:136-141`, `:202-207`
- Modify: `backend/services/summary_service.py:87-95`, `:218-223`
- Test: `backend/tests/test_llm_retry.py` (new), one added test in `backend/tests/test_ingestion_service.py`

**Interfaces:**
- Produces: `llm_retry.retry_sync(fn, *, attempts=None, base_delay_s=None, sleep=time.sleep)` and `async llm_retry.retry_async(fn, *, attempts=None, base_delay_s=None, sleep=asyncio.sleep)`. `fn` is a zero-arg callable. Retries only on `llm_retry.RETRYABLE`. `attempts` = number of additional tries after the first (default `settings.llm_retry_attempts`).

Scope decision: the streaming chat call in `agent/tutor.py:213` is NOT wrapped. Once tokens have been streamed to the client a retry would duplicate output; the correct place for that is a pre-first-chunk retry, which is a separate design. Embeddings and the two non-streaming summary calls are idempotent and safe to retry.

- [ ] **Step 1: Add settings**

`backend/config.py` after `burst_limit_per_minute`:

```python
    # Bounded retry for transient provider failures on idempotent LiteLLM
    # calls (embeddings, non-streaming summaries). Streaming chat is not
    # retried. attempts = extra tries after the first; 0 disables.
    llm_retry_attempts: int = 2
    llm_retry_base_delay_s: float = 0.5
```

- [ ] **Step 2: Write the failing helper tests**

Create `backend/tests/test_llm_retry.py`:

```python
import litellm
import pytest

from config import settings
from lib import llm_retry


def _conn_err():
    return litellm.APIConnectionError(message="boom", llm_provider="gemini", model="m")


def test_retry_sync_recovers_after_transient_error(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_attempts", 2)
    calls = {"n": 0}
    slept = []

    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise _conn_err()
        return "ok"

    assert llm_retry.retry_sync(fn, sleep=slept.append) == "ok"
    assert calls["n"] == 3
    assert slept == [0.5, 1.0]  # exponential from base_delay_s


def test_retry_sync_gives_up_after_attempts(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_attempts", 1)

    def fn():
        raise _conn_err()

    with pytest.raises(litellm.APIConnectionError):
        llm_retry.retry_sync(fn, sleep=lambda _s: None)


def test_retry_sync_does_not_retry_non_transient(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_attempts", 3)
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise ValueError("bad input")

    with pytest.raises(ValueError):
        llm_retry.retry_sync(fn, sleep=lambda _s: None)
    assert calls["n"] == 1


def test_retry_sync_zero_attempts_is_single_call(monkeypatch):
    monkeypatch.setattr(settings, "llm_retry_attempts", 0)
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise _conn_err()

    with pytest.raises(litellm.APIConnectionError):
        llm_retry.retry_sync(fn, sleep=lambda _s: None)
    assert calls["n"] == 1


async def test_retry_async_recovers(monkeypatch):
    # pyproject sets asyncio_mode = "auto": no marker needed.
    monkeypatch.setattr(settings, "llm_retry_attempts", 1)
    calls = {"n": 0}

    async def fn():
        calls["n"] += 1
        if calls["n"] == 1:
            raise _conn_err()
        return "ok"

    async def no_sleep(_s):
        return None

    assert await llm_retry.retry_async(fn, sleep=no_sleep) == "ok"
    assert calls["n"] == 2
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_llm_retry.py -v`
Expected: FAIL with `ImportError` on `lib.llm_retry`.

- [ ] **Step 4: Implement the helper**

Create `backend/lib/llm_retry.py`:

```python
"""Bounded exponential-backoff retry for idempotent LiteLLM calls.

Retries only provider/transport faults that are transient by nature.
Anything else (bad request, auth, context window, our own ValueError) is
raised immediately. Delays: base, 2*base, 4*base, ...
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

import litellm

from config import settings

T = TypeVar("T")

RETRYABLE: tuple[type[BaseException], ...] = (
    litellm.APIConnectionError,
    litellm.Timeout,
    litellm.ServiceUnavailableError,
    litellm.InternalServerError,
    litellm.RateLimitError,
)


def _plan(attempts: int | None, base_delay_s: float | None) -> tuple[int, float]:
    a = settings.llm_retry_attempts if attempts is None else attempts
    b = settings.llm_retry_base_delay_s if base_delay_s is None else base_delay_s
    return max(0, a), max(0.0, b)


def retry_sync(
    fn: Callable[[], T],
    *,
    attempts: int | None = None,
    base_delay_s: float | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    n, base = _plan(attempts, base_delay_s)
    for i in range(n + 1):
        try:
            return fn()
        except RETRYABLE:
            if i == n:
                raise
            sleep(base * (2**i))
    raise AssertionError("unreachable")


async def retry_async(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int | None = None,
    base_delay_s: float | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    n, base = _plan(attempts, base_delay_s)
    for i in range(n + 1):
        try:
            return await fn()
        except RETRYABLE:
            if i == n:
                raise
            await sleep(base * (2**i))
    raise AssertionError("unreachable")
```

If any of the five exception names is not exported at `litellm.` top level in the installed version, check `python -c "import litellm; print([n for n in dir(litellm) if n.endswith('Error') or n=='Timeout'])"` and use the exported names; do not silently drop a class.

- [ ] **Step 5: Run to verify pass**

Run: `pytest tests/test_llm_retry.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing ingestion integration test**

Append to `backend/tests/test_ingestion_service.py`, directly after `test_embed_and_store_requests_configured_dimension` (same fixtures `db_session`, `setup_doc`, `monkeypatch`; same `_embed_and_store` entry point):

```python
def test_embed_and_store_retries_once_on_transient_provider_error(
    db_session, setup_doc, monkeypatch
):
    """A single APIConnectionError from the provider must not fail the batch;
    the retry helper re-issues the call and the chunks are stored."""
    import litellm
    from config import settings
    from services import ingestion_service

    doc = db_session.get(Document, setup_doc)
    calls = {"n": 0}

    def flaky_embedding(model, input, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise litellm.APIConnectionError(message="blip", llm_provider="gemini", model=model)
        return SimpleNamespace(
            data=[{"embedding": [0.1] * settings.embedding_dim} for _ in input]
        )

    stored = []
    monkeypatch.setattr("services.ingestion_service.litellm.embedding", flaky_embedding)
    monkeypatch.setattr(
        "services.ingestion_service.pgvector_store.insert_chunks",
        lambda db, **kw: stored.append(kw["rows"]) or len(kw["rows"]),
    )
    # retry_sync binds time.sleep as a default arg at import time, so patching
    # time.sleep would not take effect; zero the delay via settings instead.
    monkeypatch.setattr(settings, "llm_retry_base_delay_s", 0.0)

    chunks = [chunking.Chunk(text="hello world", page=1, chunk_idx=0)]
    ingestion_service._embed_and_store(db_session, doc, chunks, user_id=None)

    assert calls["n"] == 2
    assert len(stored) == 1 and len(stored[0]) == 1
```

- [ ] **Step 7: Run to verify failure**

Run: `pytest tests/test_ingestion_service.py -k retries -v`
Expected: FAIL with `RuntimeError: embedding api failed` (no retry yet).

- [ ] **Step 8: Wrap the six idempotent call sites**

`backend/services/ingestion_service.py:140-145`:
```python
            resp = llm_retry.retry_sync(
                lambda: litellm.embedding(
                    model=settings.embedding_model,
                    input=[c.text for c in batch],
                    dimensions=settings.embedding_dim,
                    timeout=settings.embedding_timeout_s,
                )
            )
```

`backend/services/retrieval_service.py:44-49` (sync):
```python
        resp = llm_retry.retry_sync(
            lambda: litellm.embedding(
                model=settings.embedding_model,
                input=[args.query],
                dimensions=settings.embedding_dim,
                timeout=settings.embedding_timeout_s,
            )
        )
```

`backend/services/retrieval_service.py:136-141` and `:202-207` (async):
```python
            resp = await llm_retry.retry_async(
                lambda: litellm.aembedding(
                    model=settings.embedding_model,
                    input=[query],
                    dimensions=settings.embedding_dim,
                    timeout=settings.embedding_timeout_s,
                )
            )
```

`backend/services/summary_service.py:87-95` and `:218-223`:
```python
            resp = await llm_retry.retry_async(
                lambda: litellm.acompletion(
                    model=settings.model,
                    temperature=settings.summary_temperature,
                    messages=[...same messages as before...],
                    timeout=settings.summary_timeout_s,
                )
            )
```

Add `from lib import llm_retry` to each of the three service modules. The lambdas resolve `litellm.embedding` etc. at call time, so existing tests that monkeypatch `services.<module>.litellm.<fn>` keep working.

- [ ] **Step 9: Run the full backend suite**

Run: `pytest -q`
Expected: all pass including the new retry test. Existing timeout tests in `test_summary_service.py` (line 366 `slow_llm`) must still pass: `litellm.Timeout` is retryable, so if a test asserts exactly one call under a timeout, set `monkeypatch.setattr(settings, "llm_retry_attempts", 0)` in that test and say so in the commit body.

- [ ] **Step 10: Commit**

```bash
git add backend/lib/llm_retry.py backend/config.py backend/services backend/tests/test_llm_retry.py backend/tests/test_ingestion_service.py backend/tests/test_summary_service.py
git commit -m "feat(backend): bounded retry for idempotent LiteLLM calls"
```

---

## Task 4: Real Postgres + pgvector in CI (F4)

**Files:**
- Modify: `.github/workflows/ci.yml:13-45` (backend job)
- Modify: `backend/tests/test_pgvector_retrieval.py:19-32` (docstring)

**Interfaces:**
- Consumes: `settings.database_url` honors `DATABASE_URL` (`backend/db/alembic/env.py:3,20`); `test_pgvector_retrieval.py` reads `TEST_DATABASE_URL` and normalizes it via `db.database._normalized_url`.
- Produces: every CI run executes `alembic upgrade head` against Postgres 17 + pgvector and runs the pgvector integration test un-skipped. This also closes the standing gap that migrations were only ever tested on SQLite in CI (project-conventions: "Migrations green in CI can still diverge live").

- [ ] **Step 1: Confirm the test currently skips**

Run from `backend/`: `pytest tests/test_pgvector_retrieval.py -v -rs`
Expected: every test reported as SKIPPED with reason "TEST_DATABASE_URL not set".

- [ ] **Step 2: Add the service container and migration step**

In `.github/workflows/ci.yml`, inside `jobs.backend` add after `defaults:`:

```yaml
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: crux
          POSTGRES_PASSWORD: crux
          POSTGRES_DB: crux_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U crux -d crux_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

Insert a new step between "Verify generated contracts" and "Test":

```yaml
      - name: Migrate test Postgres (alembic upgrade head)
        env:
          DATABASE_URL: postgresql://crux:crux@localhost:5432/crux_test
          CRUX_SKIP_DOTENV: "1"
        run: alembic upgrade head
```

Change the "Test" step to:

```yaml
      - name: Test
        env:
          # Only the pgvector integration module reads this; everything else
          # stays on SQLite so the suite is unchanged apart from un-skipping it.
          TEST_DATABASE_URL: postgresql://crux:crux@localhost:5432/crux_test
        run: pytest -v --cov-report=xml
```

Do NOT set `DATABASE_URL` on the Test step. `conftest.py` and the rest of the suite assume SQLite.

- [ ] **Step 3: Fix the false docstring**

`backend/tests/test_pgvector_retrieval.py:19-22`: replace the sentence claiming "CI provides it (spins up pgvector/pgvector:pg16)" with:

```python
"""... Set TEST_DATABASE_URL to a Postgres with the vector extension. CI
provides one via the `postgres` service container in .github/workflows/ci.yml
(pgvector/pgvector:pg17) and runs `alembic upgrade head` against it first.
Locally: docker run -e POSTGRES_PASSWORD=crux -p 5432:5432 pgvector/pgvector:pg17
"""
```

Keep the rest of the docstring intact.

- [ ] **Step 4: Local proof (optional but recommended if Docker is running)**

```bash
docker run -d --name pgv -e POSTGRES_USER=crux -e POSTGRES_PASSWORD=crux -e POSTGRES_DB=crux_test -p 5433:5432 pgvector/pgvector:pg17
cd backend
DATABASE_URL=postgresql://crux:crux@localhost:5433/crux_test CRUX_SKIP_DOTENV=1 alembic upgrade head
TEST_DATABASE_URL=postgresql://crux:crux@localhost:5433/crux_test pytest tests/test_pgvector_retrieval.py -v
docker rm -f pgv
```

Expected: migrations apply, tests PASS (not skipped). If `alembic upgrade head` fails on Postgres, that is a real migration bug: stop and report it, do not patch around it.

- [ ] **Step 5: Commit and push, then verify in CI**

```bash
git add .github/workflows/ci.yml backend/tests/test_pgvector_retrieval.py
git commit -m "ci: run alembic and the pgvector integration test against real Postgres"
git push -u origin fix/audit-2026-09-02
```

Open the PR (Task 7) and in the backend job log confirm `test_pgvector_retrieval.py::` lines show PASSED, not SKIPPED, and the migrate step shows `Running upgrade ... -> <head>`.

---

## Task 5: Make the e2e job blocking (F5)

**Files:**
- Modify: `.github/workflows/e2e.yml:23-24`

- [ ] **Step 1: Re-check flake history right before flipping**

```bash
gh run list --workflow E2E --limit 40 --json conclusion,event --jq 'group_by(.event) | map("\(.[0].event): " + ([.[].conclusion] | group_by(.) | map("\(.[0]):\(length)") | join(","))) | join(" | ")'
```

Expected: no `failure` on `pull_request` events. (2026-09-02 baseline: `pull_request: cancelled:1,success:16`.) If failures exist, stop and report instead of flipping.

- [ ] **Step 2: Remove the escape hatch**

Delete these two lines from `.github/workflows/e2e.yml`:

```yaml
    # Non-blocking soak per design doc Phase 3 acceptance.
    continue-on-error: true
```

Replace with a comment:

```yaml
    # Blocking since 2026-09-02 (Phase 6 complete; 16/16 green PR runs).
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e.yml
git commit -m "ci(e2e): make Playwright job blocking"
```

The PR's own E2E run is the verification. If branch protection is later enabled (`docs/deploy/enable-branch-protection.sh`), add `Playwright (chromium)` to the required checks list in that script.

---

## Task 6: Hygiene batch (F6)

**Files:**
- Modify: `backend/.dockerignore`, `backend/pyproject.toml:11`
- Modify: `frontend/nginx.conf:7-16`, `frontend/vercel.json:9-18`
- Modify: `frontend/src/utils/formatDate.js:61-72`, `frontend/src/utils/sessionCard.js:44-50`
- Modify: `frontend/src/__tests__/formatDate.test.js`, `frontend/src/__tests__/sessionCard.test.js`

- [ ] **Step 1: Trim the runtime image**

Append to `backend/.dockerignore`:

```
tests/
README.md
test_output.log
```

(`.coverage` is already listed. `pyproject.toml` has no `readme =` key, so excluding README.md is safe for `pip install .`.) Verify nothing at runtime imports from `tests/`: Grep `from tests|import tests` in `backend/` excluding `tests/` and `.venv/` must return 0.

- [ ] **Step 2: Cap uvicorn**

`backend/pyproject.toml:11`: `"uvicorn[standard]>=0.52.4",` becomes `"uvicorn[standard]>=0.52.4,<1.0",`. Run `pip install -e .[dev]` from `backend/` to confirm it still resolves.

- [ ] **Step 3: nginx headers**

In `frontend/nginx.conf` inside `server {`, before the first `add_header`:

```nginx
    server_tokens off;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

Validate: `docker run --rm -v "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.31.4-alpine nginx -t` (if Docker is available; otherwise note it as unverified in the PR body).

- [ ] **Step 4: Vercel headers**

In `frontend/vercel.json` `headers[0].headers` add:

```json
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
```

(HSTS is added by Vercel automatically for all deployments; CSP ships as a build-time meta tag via `frontend/cspPlugin.js` by design. Do not add either here.)

- [ ] **Step 5: Remove dead exports**

Before deleting, confirm zero non-test callers with the native Grep tool (pattern `shortId|normalizeTopicKey|findActiveSessionByTopic|railMeta`, path `frontend`, glob `!node_modules/**`). Only `frontend/src/utils/*.js` definitions and `frontend/src/__tests__/*` may match.

Delete from `frontend/src/utils/formatDate.js` lines 61-72 (`shortId`, `normalizeTopicKey`, `findActiveSessionByTopic`) and from `frontend/src/utils/sessionCard.js` the `railMeta` function (lines 43-50 including its comment). Remove the corresponding imports and `it(...)`/`describe(...)` blocks from `formatDate.test.js` and `sessionCard.test.js`. Leave `splitSafePrefix` in `markdownStreamBuffer.js`: its tests use it as the reference oracle for `splitSafePrefixIncremental`.

- [ ] **Step 6: Verify**

From `frontend/`: `npm run lint && npm run test:unit -- --run && npm run build`. From `backend/`: `pytest -q`.
Expected: all green; build has no new warnings.

- [ ] **Step 7: Commit**

```bash
git add backend/.dockerignore backend/pyproject.toml frontend/nginx.conf frontend/vercel.json frontend/src/utils frontend/src/__tests__
git commit -m "chore: hygiene batch from 2026-09-02 audit"
```

---

## Task 7: PR

- [ ] **Step 1: Push and open the PR to dev**

```bash
git push -u origin fix/audit-2026-09-02
gh pr create --base dev --title "fix: 2026-09-02 codebase audit remediation" --body-file - <<'EOF'
Remediates the six verified findings from the 2026-09-02 audit
(docs/superpowers/plans/2026-09-02-codebase-audit-remediation.md).

- frontend: global cap / chunk limit / burst codes now reach their intended copy
- backend: per-user burst limiter on paid endpoints (closes QA B-07)
- backend: bounded retry on idempotent LiteLLM calls (embeddings, summaries)
- ci: alembic + pgvector integration test run against real Postgres 17
- ci: Playwright job is now blocking
- chore: dockerignore, uvicorn cap, nginx/vercel headers, dead exports

Deploy note: set BURST_LIMIT_PER_MINUTE on Render (render.yaml carries 20).
EOF
```

- [ ] **Step 2: Watch CI**

Confirm in the checks: backend job shows the migrate step and un-skipped pgvector tests; E2E is now a hard check; frontend lint + vitest green; security job green (new `services:` image must not trip the image scan; if it does, the pgvector image is dev-only and should be allow-listed, not removed).

- [ ] **Step 3: After merge**

Owed live gates: (a) on Render, confirm `BURST_LIMIT_PER_MINUTE` is set and fire 25 rapid `POST /api/chat/stream` with one token to see the 21st return 429 `too_many_requests`; (b) trigger a global-cap 429 with `GLOBAL_DAILY_COST_CAP_USD=0.0001` in a local run and confirm the "Service daily budget reached" banner.
