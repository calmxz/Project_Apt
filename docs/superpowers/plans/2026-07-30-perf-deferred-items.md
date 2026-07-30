# Perf Deferred Items (2/3/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginate the session transcript (cursor-based, last-30 window), add a route-transition progress bar, and move the sidebar review-badge fetch off the boot critical path.

**Architecture:** Item 2 changes the API contract (`SessionDetail.has_more_messages` + new `GET /sessions/{id}/messages` endpoint) with a `LIMIT n+1` probe on the backend and a "Load earlier" prepend affordance in SessionView. Items 3 and 4 are frontend-only: a tiny reactive progress module wired to router guards, and a `requestIdleCallback` wrapper around the existing badge fetch.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic codegen contracts (backend), Vue 3 + Pinia + vue-router 4 + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-30-perf-deferred-items-design.md` — read it first; its "Tail-state safety" section is a hard constraint.

## Global Constraints

- Contracts are codegen: edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py` from repo root. Never hand-edit `backend/contracts/`. CI fails on drift.
- No emojis in code or comments.
- Transcript window size: 30. Messages page `limit`: default 30, `ge=1`, `le=100`. Cursor param name: `before` (exclusive, message integer id).
- Progress bar: show only after 150 ms of pending navigation; 3 px tall; `aria-hidden="true"`; honors `prefers-reduced-motion`.
- Badge fetch stays silent (never toasts) — `{ silent: true }` preserved.
- Frontend tests: `cd frontend && npm run test:unit -- --run`. Backend: `cd backend && pytest`. Never run bare `npm run test:unit` (watch mode hangs).
- All work on branch `feat/perf-deferred-items` off `dev`.

---

### Task 1: API contract — has_more_messages + messages page endpoint

**Files:**
- Modify: `docs/api/openapi.yaml` (SessionDetail schema ~line 1184; paths near `/api/sessions/{session_id}` ~line 266)
- Regenerate: `backend/contracts/` (codegen output, commit as-is)

**Interfaces:**
- Produces: `contracts.SessionDetail.has_more_messages: bool` (required), `contracts.MessagePage` with `items: list[Message]`, `has_more: bool`. Endpoint `GET /api/sessions/{session_id}/messages?before=<int>&limit=<int>`.

- [ ] **Step 1: Create branch**

```bash
git checkout dev && git pull && git checkout -b feat/perf-deferred-items
```

- [ ] **Step 2: Edit `docs/api/openapi.yaml`**

(a) In `SessionDetail` (~line 1184): add `has_more_messages` to the `required` list and add the property. Update the description:

```yaml
    SessionDetail:
      type: object
      additionalProperties: false
      required: [id, user_id, topic, topic_profile, created_at, messages, has_more_messages]
      description: SessionResponse plus the newest window of the message transcript.
      properties:
        # ... existing properties unchanged ...
        messages:
          type: array
          items: { $ref: "#/components/schemas/Message" }
        has_more_messages: { type: boolean }
```

(b) Add new path AFTER the `/api/sessions/{session_id}` path block. Copy the parameter/response style of neighboring session paths exactly (look at `/api/sessions/{session_id}` and the review-queue path for the pattern):

```yaml
  /api/sessions/{session_id}/messages:
    get:
      operationId: getSessionMessages
      summary: Older transcript messages before a cursor, ascending.
      parameters:
        - name: session_id
          in: path
          required: true
          schema: { type: string }
        - name: before
          in: query
          required: true
          description: Exclusive cursor; returns messages with id < before.
          schema: { type: integer }
        - name: limit
          in: query
          required: false
          schema: { type: integer, default: 30, minimum: 1, maximum: 100 }
      responses:
        "200":
          description: One page of older messages.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MessagePage"
        "404":
          description: Session not found.
```

(c) Add schema next to `SessionLibraryPage` (~line 1211):

```yaml
    MessagePage:
      type: object
      additionalProperties: false
      required: [items, has_more]
      description: One page of older transcript messages, ascending order.
      properties:
        items:
          type: array
          items: { $ref: "#/components/schemas/Message" }
        has_more: { type: boolean }
```

- [ ] **Step 3: Validate + regenerate**

```bash
python -m openapi_spec_validator docs/api/openapi.yaml
python backend/scripts/gen_contracts.py
```

Expected: validator silent; `backend/contracts/models.py` now contains `class MessagePage` and `SessionDetail` gains `has_more_messages: bool`.

- [ ] **Step 4: Run backend suite to catch breakage**

Run: `cd backend && pytest`
Expected: FAILURES in tests hitting `GET /api/sessions/{id}` — `SessionDetail` now requires `has_more_messages` and `routes/sessions.py` does not pass it yet. That is expected; Task 2 fixes it. If instead everything passes, STOP — the contract change did not land.

- [ ] **Step 5: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/
git commit -m "feat(contracts): has_more_messages on SessionDetail + MessagePage schema and messages-page endpoint"
```

Note: this commit intentionally leaves the backend suite red (contract requires a field the route does not send yet); Task 2 turns it green. Do not squash-fix.

---

### Task 2: Backend — session detail last-30 window

**Files:**
- Modify: `backend/routes/sessions.py` (`_load_messages` ~line 213; `get_session` ~line 327)
- Test: `backend/tests/test_sessions_route.py`

**Interfaces:**
- Consumes: `contracts.SessionDetail.has_more_messages` from Task 1.
- Produces: `_load_messages(db, session_id, open_message_id=None, before=None, limit=30) -> tuple[list[Message], bool]` — Task 3 reuses this exact signature.

- [ ] **Step 1: Write failing tests** (append to `backend/tests/test_sessions_route.py`, reuse its `client`, `db_session`, `seeded_user` fixtures and `USER_ID`):

```python
def _seed_session_with_messages(db_session, session_id, count):
    from db.models import ChatMessage

    db_session.add(
        SessionModel(
            id=session_id,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    for i in range(count):
        db_session.add(ChatMessage(session_id=session_id, role="user", content=f"m{i}"))
    db_session.commit()


def test_get_session_caps_messages_to_last_30(client, db_session, seeded_user):
    _seed_session_with_messages(db_session, "s_window", 31)

    r = client.get(f"/api/sessions/s_window?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["messages"]) == 30
    assert body["has_more_messages"] is True
    # Oldest message (m0) dropped; order stays ascending.
    assert body["messages"][0]["content"] == "m1"
    assert body["messages"][-1]["content"] == "m30"


def test_get_session_small_transcript_returns_all_and_has_more_false(client, db_session, seeded_user):
    _seed_session_with_messages(db_session, "s_small", 2)

    r = client.get(f"/api/sessions/s_small?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["messages"]) == 2
    assert body["has_more_messages"] is False


def test_get_session_exactly_30_has_more_false(client, db_session, seeded_user):
    _seed_session_with_messages(db_session, "s_exact", 30)

    r = client.get(f"/api/sessions/s_exact?user_id={USER_ID}")
    body = r.json()
    assert len(body["messages"]) == 30
    assert body["has_more_messages"] is False
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_sessions_route.py -v -k "caps_messages or has_more"`
Expected: FAIL — response validation error (`has_more_messages` missing) or 31 messages returned.

- [ ] **Step 3: Implement.** In `backend/routes/sessions.py`:

(a) Change `_load_messages` query and signature. Current query orders `created_at.asc(), id.asc()` over ALL rows; replace with an id-descending window then reverse (message ids are monotonic per session, so ascending-id equals chronological):

```python
def _load_messages(
    db: Session,
    session_id: str,
    open_message_id: int | None = None,
    before: int | None = None,
    limit: int = 30,
) -> tuple[list[Message], bool]:
    q = select(ChatMessage).where(ChatMessage.session_id == session_id)
    if before is not None:
        q = q.where(ChatMessage.id < before)
    window = list(
        db.execute(q.order_by(ChatMessage.id.desc()).limit(limit + 1)).scalars().all()
    )
    has_more = len(window) > limit
    rows = list(reversed(window[:limit]))
    # ... rest of the function body (needs_events preload, per-row Message
    # construction, open-message recap suppression) is UNCHANGED — it already
    # iterates `rows` — except the final line becomes:
    return out, has_more
```

Keep the existing `needs_events` / citations / tool_calls / `check_batch` logic byte-for-byte; only the row-fetch and the return change.

(b) In `get_session`, unpack and pass through:

```python
    messages, has_more = _load_messages(db, row.id, open_msg_id)
    return SessionDetail(
        # ... existing kwargs unchanged ...
        messages=messages,
        has_more_messages=has_more,
        # ...
    )
```

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_sessions_route.py tests/test_session_detail_check_batch.py tests/test_session_detail_tool_calls.py tests/test_sessions_perf.py -v`
Expected: ALL PASS (window tests green, existing detail tests unaffected — their transcripts are far under 30).

Then full suite: `cd backend && pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_sessions_route.py
git commit -m "feat(api): cap session detail transcript to newest 30 messages with has_more_messages probe"
```

---

### Task 3: Backend — GET /sessions/{id}/messages page endpoint

**Files:**
- Modify: `backend/routes/sessions.py`
- Create: `backend/tests/test_session_messages_page.py`

**Interfaces:**
- Consumes: `_load_messages(..., before=, limit=)` from Task 2; `contracts.MessagePage` from Task 1.
- Produces: `GET /api/sessions/{session_id}/messages?before=<int>&limit=<int>` returning `{items, has_more}` — Task 4's frontend wrapper calls this.

- [ ] **Step 1: Write failing tests** in new file `backend/tests/test_session_messages_page.py`:

```python
import pytest

from contracts import TopicProfile
from db.models import ChatMessage, Session as SessionModel

USER_ID = "u1"


@pytest.fixture()
def seeded_user(db_session):
    from db.models import User

    db_session.add(User(id=USER_ID))
    db_session.commit()


def _seed(db_session, session_id, count):
    db_session.add(
        SessionModel(
            id=session_id,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    ids = []
    for i in range(count):
        m = ChatMessage(session_id=session_id, role="user", content=f"m{i}")
        db_session.add(m)
        db_session.commit()
        ids.append(m.id)
    return ids


def test_page_returns_older_messages_ascending(client, db_session, seeded_user):
    ids = _seed(db_session, "s_page", 40)
    # Cursor at the 35th message: expect the 30 before it, ascending.
    r = client.get(f"/api/sessions/s_page/messages?before={ids[35]}&limit=30&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["content"] for m in body["items"]] == [f"m{i}" for i in range(5, 35)]
    assert body["has_more"] is True


def test_page_at_history_start_has_more_false(client, db_session, seeded_user):
    ids = _seed(db_session, "s_start", 10)
    r = client.get(f"/api/sessions/s_start/messages?before={ids[5]}&user_id={USER_ID}")
    body = r.json()
    assert [m["content"] for m in body["items"]] == ["m0", "m1", "m2", "m3", "m4"]
    assert body["has_more"] is False


def test_cursor_older_than_everything_returns_empty(client, db_session, seeded_user):
    ids = _seed(db_session, "s_empty", 3)
    r = client.get(f"/api/sessions/s_empty/messages?before={ids[0]}&user_id={USER_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["has_more"] is False


def test_foreign_session_404(client, db_session, seeded_user):
    _seed(db_session, "s_mine", 2)
    r = client.get("/api/sessions/s_mine/messages?before=999&user_id=other")
    assert r.status_code == 404


def test_unknown_session_404(client, seeded_user):
    r = client.get(f"/api/sessions/nope/messages?before=1&user_id={USER_ID}")
    assert r.status_code == 404


def test_missing_or_bad_cursor_422(client, db_session, seeded_user):
    _seed(db_session, "s_bad", 1)
    assert client.get(f"/api/sessions/s_bad/messages?user_id={USER_ID}").status_code == 422
    assert client.get(f"/api/sessions/s_bad/messages?before=abc&user_id={USER_ID}").status_code == 422


def test_limit_out_of_range_422(client, db_session, seeded_user):
    _seed(db_session, "s_lim", 1)
    assert client.get(f"/api/sessions/s_lim/messages?before=99&limit=0&user_id={USER_ID}").status_code == 422
    assert client.get(f"/api/sessions/s_lim/messages?before=99&limit=101&user_id={USER_ID}").status_code == 422
```

Check `test_sessions_route.py` first for the exact `SessionModel`/`TopicProfile` import lines and copy those (imports above are the expected shape; the existing file is authoritative).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_session_messages_page.py -v`
Expected: FAIL — 404s everywhere (route does not exist; FastAPI matches nothing).

- [ ] **Step 3: Implement.** In `backend/routes/sessions.py`, add below `get_session`. Ensure `Query` is in the `fastapi` import line and `MessagePage` is in the contracts import:

```python
@router.get("/sessions/{session_id}/messages", response_model=MessagePage)
def get_session_messages(
    session_id: str,
    before: int = Query(..., description="Exclusive message-id cursor"),
    limit: int = Query(30, ge=1, le=100),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    # Same open-batch recap suppression as get_session: if the open check
    # message ever lands in an older page, the live card still owns it.
    pc = check_question_service.get_pending_check(db, row.id)
    open_msg_id = pc.get("message_id") if pc else None
    items, has_more = _load_messages(db, row.id, open_msg_id, before=before, limit=limit)
    return MessagePage(items=items, has_more=has_more)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_session_messages_page.py -v` then `cd backend && pytest`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_session_messages_page.py
git commit -m "feat(api): cursor-paginated GET /sessions/{id}/messages"
```

---

### Task 4: Frontend — API wrapper + store loadEarlierMessages

**Files:**
- Modify: `frontend/src/services/sessionsApi.js`
- Modify: `frontend/src/stores/session.js`
- Test: `frontend/src/__tests__/sessionStore.test.js` (append), `frontend/src/__tests__/sessionsApi.test.js` (append)

**Interfaces:**
- Consumes: endpoint from Task 3.
- Produces: `sessionsApi.getSessionMessages(sessionId, {before, limit})`; store refs `hasMoreMessages`, `loadingEarlier`, `loadEarlierError` and action `loadEarlierMessages()` — Task 5's view consumes all four. Module-level `toUiMessage(m)` mapper.

- [ ] **Step 1: Write failing tests.** In `sessionStore.test.js` (follow the file's existing mock pattern for `@/services/sessionsApi.js` — add `getSessionMessages: vi.fn()` to the mock):

```js
describe('loadEarlierMessages', () => {
  it('prepends the older page and updates hasMoreMessages', async () => {
    sessionsApi.getSession.mockResolvedValue({
      id: 's1',
      messages: [{ id: 50, role: 'user', content: 'newest', citations: [], created_at: 'now', status: null, check_batch: null }],
      has_more_messages: true,
      pending_check: null,
    })
    const store = useSessionStore()
    await store.loadSession('s1')
    expect(store.hasMoreMessages).toBe(true)

    sessionsApi.getSessionMessages.mockResolvedValue({
      items: [{ id: 20, role: 'assistant', content: 'older', citations: [], created_at: 'then', status: null, check_batch: null }],
      has_more: false,
    })
    await store.loadEarlierMessages()

    expect(sessionsApi.getSessionMessages).toHaveBeenCalledWith('s1', { before: 50 })
    expect(store.messages.map((m) => m.message_id)).toEqual([20, 50])
    expect(store.hasMoreMessages).toBe(false)
    expect(store.loadingEarlier).toBe(false)
  })

  it('is a no-op when hasMoreMessages is false', async () => {
    const store = useSessionStore()
    await store.loadEarlierMessages()
    expect(sessionsApi.getSessionMessages).not.toHaveBeenCalled()
  })

  it('records an inline error and keeps messages on failure', async () => {
    sessionsApi.getSession.mockResolvedValue({
      id: 's1',
      messages: [{ id: 50, role: 'user', content: 'newest', citations: [], created_at: 'now', status: null, check_batch: null }],
      has_more_messages: true,
      pending_check: null,
    })
    const store = useSessionStore()
    await store.loadSession('s1')

    sessionsApi.getSessionMessages.mockRejectedValue(new Error('boom'))
    await store.loadEarlierMessages()

    expect(store.loadEarlierError).toBeTruthy()
    expect(store.messages).toHaveLength(1)
    expect(store.hasMoreMessages).toBe(true)
  })
})
```

In `sessionsApi.test.js`, follow the file's existing wrapper-test pattern to assert `getSessionMessages('s1', { before: 5, limit: 30 })` calls `apiGet('/sessions/s1/messages', { before: 5, limit: 30 }, { silent: true })`.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/sessionStore.test.js src/__tests__/sessionsApi.test.js`
Expected: FAIL — `getSessionMessages` is not a function / `loadEarlierMessages` undefined.

- [ ] **Step 3: Implement.**

(a) `sessionsApi.js` — add next to `getSession` (line ~26):

```js
export const getSessionMessages = (sessionId, params = {}) =>
  apiGet(`/sessions/${sessionId}/messages`, params, { silent: true })
```

(`silent: true` because the button shows its own inline error — spec forbids a toast.)

(b) `stores/session.js`:
- Extract the existing message-mapping arrow body inside `loadSession` (`messages.value = (s.messages || []).map((m) => ({...}))`) into a module-level function `toUiMessage(m)` placed above the `defineStore` call, moving the body VERBATIM (including the check_batch camelCase remap). `loadSession` becomes `messages.value = (s.messages || []).map(toUiMessage)`.
- Add state next to `messages` (line ~38): `const hasMoreMessages = ref(false)`, `const loadingEarlier = ref(false)`, `const loadEarlierError = ref(null)`.
- In `loadSession`, after `messages.value = ...`: `hasMoreMessages.value = !!s.has_more_messages; loadEarlierError.value = null`.
- Add action:

```js
async function loadEarlierMessages() {
  if (loadingEarlier.value || !hasMoreMessages.value) return
  const oldest = messages.value[0]?.message_id
  const sid = currentSessionId.value
  if (oldest == null || !sid) return
  loadingEarlier.value = true
  loadEarlierError.value = null
  try {
    const page = await sessionsApi.getSessionMessages(sid, { before: oldest })
    // A navigation may have swapped sessions while the page was in flight.
    if (currentSessionId.value !== sid) return
    messages.value = [...(page.items || []).map(toUiMessage), ...messages.value]
    hasMoreMessages.value = !!page.has_more
  } catch (e) {
    loadEarlierError.value = e?.message || 'Failed to load earlier messages'
  } finally {
    loadingEarlier.value = false
  }
}
```

- Reset the three new refs in `reset()` alongside `messages`.
- Export all four (`hasMoreMessages`, `loadingEarlier`, `loadEarlierError`, `loadEarlierMessages`) in the store's return object (lines ~878-932).

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:unit -- --run`
Expected: ALL PASS (full FE suite — the mapper extraction touches loadSession, so run everything).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js frontend/src/__tests__/sessionsApi.test.js
git commit -m "feat(store): loadEarlierMessages cursor pagination action"
```

---

### Task 5: Frontend — "Load earlier" button + scroll preservation

**Files:**
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/sessionView.test.js` (append)

**Interfaces:**
- Consumes: `store.hasMoreMessages`, `store.loadingEarlier`, `store.loadEarlierError`, `store.loadEarlierMessages()` from Task 4.

- [ ] **Step 1: Write failing tests** (use the file's existing `setupSession` + `mountView` helpers; extend `setupSession` to also accept and set `hasMoreMessages`):

```js
describe('load earlier messages', () => {
  it('shows the button only when hasMoreMessages', async () => {
    setupSession({ id: 's1', messages: [{ role: 'user', content: 'hi', message_id: 9 }], hasMoreMessages: true })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="load-earlier"]').exists()).toBe(true)
  })

  it('hides the button when history is exhausted', async () => {
    setupSession({ id: 's1', messages: [{ role: 'user', content: 'hi', message_id: 9 }] })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="load-earlier"]').exists()).toBe(false)
  })

  it('click calls store.loadEarlierMessages and disables while pending', async () => {
    setupSession({ id: 's1', messages: [{ role: 'user', content: 'hi', message_id: 9 }], hasMoreMessages: true })
    const store = useSessionStore()
    const spy = vi.spyOn(store, 'loadEarlierMessages').mockResolvedValue()
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="load-earlier"]').trigger('click')
    expect(spy).toHaveBeenCalled()
  })

  it('shows retry copy when the page fetch failed', async () => {
    setupSession({ id: 's1', messages: [{ role: 'user', content: 'hi', message_id: 9 }], hasMoreMessages: true })
    const store = useSessionStore()
    store.loadEarlierError = 'boom'
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="load-earlier"]').text()).toMatch(/retry/i)
  })
})
```

(jsdom has no real layout, so scroll preservation is asserted by behavior, not pixels: the pending-guard test below in Step 3 notes.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/sessionView.test.js`
Expected: FAIL — `[data-testid="load-earlier"]` not found.

- [ ] **Step 3: Implement.** In `SessionView.vue`:

(a) Template — inside the `.messages` div, inside the `v-else` template, ABOVE `MessageList`:

```html
<button
  v-if="store.hasMoreMessages && store.messages.length"
  type="button"
  class="load-earlier"
  data-testid="load-earlier"
  :disabled="store.loadingEarlier"
  @click="onLoadEarlier"
>
  <template v-if="store.loadingEarlier">Loading…</template>
  <template v-else-if="store.loadEarlierError">Could not load earlier messages — retry</template>
  <template v-else>Load earlier messages</template>
</button>
```

(b) Script — scroll preservation plus a guard so the existing autoscroll watcher does not yank to the bottom on prepend:

```js
const prepending = ref(false)

async function onLoadEarlier() {
  const el = messagesEl.value
  const prevHeight = el ? el.scrollHeight : 0
  const prevTop = el ? el.scrollTop : 0
  prepending.value = true
  try {
    await store.loadEarlierMessages()
    await nextTick()
    if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
  } finally {
    prepending.value = false
  }
}
```

(c) CRITICAL: the existing watcher `watch([() => store.messages.length, awaitingResponse], () => scrollToBottom())` fires on prepend and would jump to the bottom. Change it to:

```js
watch([() => store.messages.length, awaitingResponse], () => {
  if (prepending.value) return
  scrollToBottom()
})
```

`prepending` stays true through the awaited `nextTick`, which is when the watcher flushes — that is the whole point of the local flag (the store's `loadingEarlier` is already false by then).

(d) Style — match existing muted-button styling in the file (scoped block); keep it visually quiet: full-width, small font, muted color, subtle hover.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:unit -- --run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionView.test.js
git commit -m "feat(session): load-earlier button with scroll preservation"
```

---

### Task 6: Frontend — routeProgress service

**Files:**
- Create: `frontend/src/services/routeProgress.js`
- Create: `frontend/src/__tests__/routeProgress.test.js`

**Interfaces:**
- Produces: `routeProgress` reactive `{visible, progress}`, `start()`, `finish()`, `fail` (alias of finish) — Task 7 consumes all.

- [ ] **Step 1: Write failing tests** in `frontend/src/__tests__/routeProgress.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routeProgress, start, finish, fail } from '@/services/routeProgress.js'

describe('routeProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    finish()
    vi.runAllTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('does not show before 150ms', () => {
    start()
    vi.advanceTimersByTime(149)
    expect(routeProgress.visible).toBe(false)
  })

  it('shows after 150ms and trickles', () => {
    start()
    vi.advanceTimersByTime(150)
    expect(routeProgress.visible).toBe(true)
    expect(routeProgress.progress).toBeGreaterThan(0)
  })

  it('finish before threshold never shows the bar', () => {
    start()
    vi.advanceTimersByTime(100)
    finish()
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
  })

  it('finish while visible completes to 100 then hides', () => {
    start()
    vi.advanceTimersByTime(150)
    finish()
    expect(routeProgress.progress).toBe(1)
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
    expect(routeProgress.progress).toBe(0)
  })

  it('overlapping start resets cleanly', () => {
    start()
    vi.advanceTimersByTime(150)
    start()
    expect(routeProgress.visible).toBe(false)
    vi.advanceTimersByTime(150)
    expect(routeProgress.visible).toBe(true)
  })

  it('fail is the same teardown as finish', () => {
    start()
    vi.advanceTimersByTime(150)
    fail()
    vi.runAllTimers()
    expect(routeProgress.visible).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/routeProgress.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `frontend/src/services/routeProgress.js`:

```js
import { reactive } from 'vue'

// Route-transition progress state. The bar only appears when a navigation
// (lazy chunk fetch, auth init, data guards) outlives SHOW_DELAY_MS, so
// instant navigations never flash it.
const SHOW_DELAY_MS = 150
const HIDE_AFTER_DONE_MS = 200

export const routeProgress = reactive({ visible: false, progress: 0 })

let showTimer = null
let hideTimer = null

export function start() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  routeProgress.visible = false
  routeProgress.progress = 0
  showTimer = setTimeout(() => {
    routeProgress.visible = true
    // The component's CSS width transition animates the trickle toward 85%.
    routeProgress.progress = 0.85
  }, SHOW_DELAY_MS)
}

export function finish() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (!routeProgress.visible) {
    routeProgress.progress = 0
    return
  }
  routeProgress.progress = 1
  hideTimer = setTimeout(() => {
    routeProgress.visible = false
    routeProgress.progress = 0
  }, HIDE_AFTER_DONE_MS)
}

export const fail = finish
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/routeProgress.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/routeProgress.js frontend/src/__tests__/routeProgress.test.js
git commit -m "feat(nav): routeProgress state module for route-transition bar"
```

---

### Task 7: Frontend — RouteProgressBar component + router wiring

**Files:**
- Create: `frontend/src/components/RouteProgressBar.vue`
- Modify: `frontend/src/router/index.js` (guards at lines ~96-152)
- Modify: `frontend/src/App.vue`
- Create: `frontend/src/__tests__/routeProgressBar.test.js`

**Interfaces:**
- Consumes: `routeProgress`, `start`, `finish`, `fail` from Task 6.

- [ ] **Step 1: Write failing tests** in `frontend/src/__tests__/routeProgressBar.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import RouteProgressBar from '@/components/RouteProgressBar.vue'
import { routeProgress } from '@/services/routeProgress.js'

describe('RouteProgressBar', () => {
  beforeEach(() => {
    routeProgress.visible = false
    routeProgress.progress = 0
  })

  it('renders nothing while hidden', () => {
    const wrapper = mount(RouteProgressBar)
    expect(wrapper.find('[data-testid="route-progress"]').exists()).toBe(false)
  })

  it('renders with width bound to progress and aria-hidden', async () => {
    const wrapper = mount(RouteProgressBar)
    routeProgress.visible = true
    routeProgress.progress = 0.85
    await nextTick()
    const bar = wrapper.get('[data-testid="route-progress"]')
    expect(bar.attributes('aria-hidden')).toBe('true')
    expect(bar.get('.route-progress-bar').attributes('style')).toContain('width: 85%')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/routeProgressBar.test.js`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement.**

(a) `frontend/src/components/RouteProgressBar.vue`. Before writing, check `frontend/src/theme/` (or the main CSS entry) for the project's accent custom property name and use that variable instead of the literal below if one exists:

```vue
<script setup>
import { routeProgress } from '@/services/routeProgress.js'
</script>

<template>
  <div
    v-if="routeProgress.visible"
    class="route-progress"
    data-testid="route-progress"
    aria-hidden="true"
  >
    <div
      class="route-progress-bar"
      :class="{ done: routeProgress.progress >= 1 }"
      :style="{ width: routeProgress.progress * 100 + '%' }"
    />
  </div>
</template>

<style scoped>
.route-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 1000;
  pointer-events: none;
}
.route-progress-bar {
  height: 100%;
  background: var(--accent, #e26d5c);
  /* Slow ease-out = trickle toward 85% while the chunk loads. */
  transition: width 8s cubic-bezier(0.1, 0.6, 0.2, 1);
}
.route-progress-bar.done {
  transition: width 150ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .route-progress-bar,
  .route-progress-bar.done {
    transition: none;
  }
}
</style>
```

(b) `router/index.js` — add import at top:

```js
import { start as progressStart, finish as progressFinish, fail as progressFail } from '../services/routeProgress.js'
```

Register the start guard ABOVE the existing auth `router.beforeEach` (so the bar also covers the awaited `auth.init()` / onboarding hydration), and the teardown after the existing `afterEach`:

```js
router.beforeEach(() => {
  progressStart()
})
```

```js
router.afterEach(() => {
  progressFinish()
})

router.onError(() => {
  progressFail()
})
```

Notes: vue-router 4 calls `afterEach` (with a `failure` arg) even for aborted/redirected navigations, and a redirect re-enters `beforeEach` where `start()` re-arms — so the bar cannot stick. Do not touch the existing guards' bodies.

(c) `App.vue` — import `RouteProgressBar` in the script block and render it as the FIRST element of the template, above the `v-if="showShell"` div (the template already has multiple roots — `Toast` and `ConfirmDialog` sit outside the shell div):

```html
<template>
  <RouteProgressBar />
  <div v-if="showShell" class="shell">
  ...
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:unit -- --run`
Expected: ALL PASS. `router.test.js` mocks or exercises the real router — if it fails on the new guard, the fix is in the test setup (the guard is a no-op state write; it must not need network or DOM).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RouteProgressBar.vue frontend/src/router/index.js frontend/src/App.vue frontend/src/__tests__/routeProgressBar.test.js
git commit -m "feat(nav): route-transition progress bar"
```

---

### Task 8: Frontend — sidebar badge fetch on idle

**Files:**
- Create: `frontend/src/utils/idle.js`
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (onMounted ~line 201, onBeforeUnmount ~line 85)
- Create: `frontend/src/__tests__/idle.test.js`
- Modify: `frontend/src/__tests__/sidebar.test.js` (badge describe block ~line 1118)

**Interfaces:**
- Produces: `runWhenIdle(cb, {timeout}) -> cancelFn` in `frontend/src/utils/idle.js`.

- [ ] **Step 1: Write failing tests.**

(a) New `frontend/src/__tests__/idle.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runWhenIdle } from '@/utils/idle.js'

describe('runWhenIdle', () => {
  afterEach(() => {
    delete globalThis.requestIdleCallback
    delete globalThis.cancelIdleCallback
    vi.useRealTimers()
  })

  it('uses requestIdleCallback when available', () => {
    const cb = vi.fn()
    globalThis.requestIdleCallback = vi.fn((fn) => {
      fn()
      return 7
    })
    globalThis.cancelIdleCallback = vi.fn()
    runWhenIdle(cb)
    expect(cb).toHaveBeenCalled()
  })

  it('cancel prevents the idle callback', () => {
    globalThis.requestIdleCallback = vi.fn(() => 7)
    globalThis.cancelIdleCallback = vi.fn()
    const cancel = runWhenIdle(vi.fn())
    cancel()
    expect(globalThis.cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to setTimeout when requestIdleCallback is missing', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    runWhenIdle(cb)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(cb).toHaveBeenCalled()
  })

  it('cancel clears the fallback timer', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    const cancel = runWhenIdle(cb)
    cancel()
    vi.runAllTimers()
    expect(cb).not.toHaveBeenCalled()
  })
})
```

(b) In `sidebar.test.js`, in the badge describe block's `beforeEach` (~line 1119), add a synchronous rIC stub so existing badge assertions keep passing once Sidebar defers the fetch:

```js
globalThis.requestIdleCallback = (cb) => {
  cb()
  return 1
}
globalThis.cancelIdleCallback = () => {}
```

(and delete both in an `afterEach`). Then add two tests to the same block:

```js
it('does not fetch the badge before the idle callback runs', async () => {
  let idleCb
  globalThis.requestIdleCallback = (cb) => {
    idleCb = cb
    return 1
  }
  wrapper = mount(Sidebar)
  await flushPromises()
  expect(apiReviewQueue).not.toHaveBeenCalled()
  idleCb()
  await flushPromises()
  expect(apiReviewQueue).toHaveBeenCalledWith({ limit: 1, offset: 0 }, { silent: true })
})

it('unmount cancels the pending idle badge fetch', async () => {
  let idleCb
  globalThis.requestIdleCallback = (cb) => {
    idleCb = cb
    return 1
  }
  const cancelSpy = vi.fn()
  globalThis.cancelIdleCallback = cancelSpy
  wrapper = mount(Sidebar)
  await flushPromises()
  wrapper.unmount()
  expect(cancelSpy).toHaveBeenCalledWith(1)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/idle.test.js src/__tests__/sidebar.test.js`
Expected: FAIL — `@/utils/idle.js` missing; "does not fetch before idle" fails (fetch currently fires in onMounted directly).

- [ ] **Step 3: Implement.**

(a) `frontend/src/utils/idle.js`:

```js
// Run a callback when the browser is idle, off the boot critical path.
// Falls back to a short setTimeout where requestIdleCallback is missing
// (older Safari, jsdom). Returns a cancel function.
export function runWhenIdle(cb, { timeout = 1500 } = {}) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const id = globalThis.requestIdleCallback(cb, { timeout })
    return () => globalThis.cancelIdleCallback(id)
  }
  const id = setTimeout(cb, 200)
  return () => clearTimeout(id)
}
```

(b) `Sidebar.vue` — import `runWhenIdle` from `@/utils/idle.js`; declare `let cancelIdleBadge = null` near the other module refs; replace the badge half of `onMounted`:

```js
onMounted(async () => {
  if (isAuthenticated.value && !sessions.value.length) {
    await sessionStore.listSessions().catch(() => {})
  }
  if (isAuthenticated.value) {
    // Badge count only; silent - a sidebar badge must never toast.
    // Deferred to browser idle so it never competes with first paint.
    cancelIdleBadge = runWhenIdle(() => {
      if (!isAuthenticated.value) return
      getReviewQueue({ limit: 1, offset: 0 }, { silent: true })
        .then((q) => {
          reviewTotal.value = q?.total || 0
        })
        .catch(() => {})
    })
  }
})
```

Add `cancelIdleBadge?.()` inside the existing `onBeforeUnmount` (lines ~85-90).

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:unit -- --run`
Expected: ALL PASS — including the pre-existing badge tests (they now ride the synchronous rIC stub). Also check `sidebarA11y.test.js` / `sidebarMobileStrip.test.js`; if they assert on the badge without the stub, add the same stub to their setup.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/idle.js frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/idle.test.js frontend/src/__tests__/sidebar.test.js
git commit -m "perf(sidebar): defer review badge fetch to browser idle"
```

---

### Task 9: Final verification

**Files:** none new.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && pytest`
Expected: PASS, count >= 824 + the ~13 new tests.

- [ ] **Step 2: Full frontend suite + lint**

Run: `cd frontend && npm run test:unit -- --run` then `cd frontend && npm run lint`
Expected: PASS / clean.

- [ ] **Step 3: Contract drift check**

```bash
python backend/scripts/gen_contracts.py
git status --porcelain backend/contracts/
```

Expected: empty output (zero drift).

- [ ] **Step 4: Push**

```bash
git push -u origin feat/perf-deferred-items
```

Do NOT open a PR — the controller/user decides.
