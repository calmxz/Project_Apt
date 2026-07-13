# Adversarial Review Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four "stop the bleeding" fixes from `docs/adversarial-review-2026-07-12.md` — F-16 (commit the pending Supabase docker/env fix), F-04 (session summary reads FIRST 30 messages instead of last 30), F-01 (agent-loop exception hangs the chat UI forever), F-05 (ended sessions still accept chat turns and check answers).

**Architecture:** Backend fixes are surgical edits to `agent/tutor.py` (new `except Exception` arm that persists partial text and emits an `error` SSE), `services/summary_service.py` (query direction), `routes/chat.py` + `routes/sessions.py` (409 guard on ended sessions). Frontend adds a terminal-event safety net in the session store and maps the new 409 to a friendly error. F-16 is a pure commit of an already-authored working-tree diff.

**Tech Stack:** FastAPI + sync SQLAlchemy + LiteLLM (backend), Vue 3 + Pinia + vitest (frontend), pytest.

## Global Constraints

- Branch: `fix/adversarial-batch-1` (already created, working tree carries the uncommitted F-16 diff — do NOT stash or discard it).
- Run pytest from `backend/`, never repo root (repo-root run reports "No tests collected").
- After any import-touching change, run the FULL backend suite, not just the touched file.
- `backend/contracts/` is codegen output — never hand-edit. Edit `docs/api/openapi.yaml` then `python backend/scripts/gen_contracts.py` from repo root. (This plan needs NO contract model changes; the SSE `error` event schema already allows `code` + `message`, and the `Message` schema exposes no `status` field.)
- No emojis in code or comments.
- Use the native Grep tool for repo-wide sweeps (rtk rg has a false-zero gotcha).
- Commit messages: conventional commits, normal prose.

---

### Task 1: Commit the pending F-16 diff (Supabase docker build args) + separate cap-change commit

The working tree already contains the reviewed fix for F-16 (frontend Docker image built without Supabase env → dead auth client, "Failed to fetch" on login). It spans 5 files. `render.yaml` also carries an UNRELATED owner change (LLM caps lowered 2.00/3.00 → 0.8/1.00) — commit that separately so history stays honest.

**Files:**
- Commit (F-16): `frontend/Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `frontend/.env.example`
- Commit (caps): `render.yaml`

**Interfaces:**
- Consumes: nothing (diff already authored in a prior session).
- Produces: clean working tree except `docs/` additions; later tasks commit on top.

- [ ] **Step 1: Inspect the diff to confirm scope**

Run: `git diff HEAD -- frontend/Dockerfile docker-compose.yml docker-compose.prod.yml .env.example frontend/.env.example`
Expected: Dockerfile gains `ARG VITE_SUPABASE_URL` / `ARG VITE_SUPABASE_PUBLISHABLE_KEY` (+ ENV lines); compose files gain matching `build.args`; env examples gain the new variable names. Nothing else. If anything unexpected appears, STOP and report.

- [ ] **Step 2: Validate compose files parse**

Run: `docker compose -f docker-compose.yml config --quiet; docker compose -f docker-compose.prod.yml config --quiet`
Expected: both exit 0, no output. (If docker is unavailable on this machine, note it in the commit body and rely on Step 3.)

- [ ] **Step 3: Run the deploy-config test file**

Run from `backend/`: `pytest tests/test_deploy_config.py -v`
Expected: PASS (all).

- [ ] **Step 4: Commit F-16**

```bash
git add frontend/Dockerfile docker-compose.yml docker-compose.prod.yml .env.example frontend/.env.example
git commit -m "fix: pass Supabase build args into frontend docker image (F-16)

Without ARG/ENV VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY the
Vite build bakes the http://placeholder.invalid fallback client and all
auth calls fail with 'Failed to fetch' on a fresh docker compose up.
Fix authored 2026-07-12, committed as Batch 1 of the adversarial-review
remediation (docs/adversarial-review-2026-07-12.md)."
```

- [ ] **Step 5: Commit the cap change separately**

```bash
git add render.yaml
git commit -m "chore: lower LLM cost caps in render deploy (soft 0.80, hard 1.00 USD)"
```

---

### Task 2: F-04 — Session summary must read the LAST 30 messages

`generate_and_persist` (`backend/services/summary_service.py:37-42`) orders `ChatMessage.id.asc().limit(30)` — the FIRST 30 messages — while the module docstring says "last 30". The summary seeds cross-session continuity, so long sessions get summarized by their opening minutes.

**Files:**
- Modify: `backend/services/summary_service.py:37-42`
- Test: `backend/tests/test_summary_service.py` (add one test; mirror the existing fixtures in that file — it already builds sessions + messages and monkeypatches `litellm.acompletion`)

**Interfaces:**
- Consumes: existing `generate_and_persist(db, session)`.
- Produces: same signature; only the message window changes. `_mechanical_fallback` automatically operates on the corrected window.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_summary_service.py` (adapt fixture/helper names to the ones already used in this file — it has existing tests that create a session, insert `ChatMessage` rows, and monkeypatch `litellm.acompletion`; follow the same pattern):

```python
def test_summary_uses_last_30_messages(db, monkeypatch):
    session = _make_session(db)  # use this file's existing session factory/fixture
    for i in range(1, 41):
        db.add(ChatMessage(session_id=session.id, role="user", content=f"marker-{i}"))
    db.commit()

    captured = {}

    async def fake_acompletion(**kwargs):
        captured["messages"] = kwargs["messages"]

        class _Msg:
            content = "a real summary"

        class _Choice:
            message = _Msg()

        class _Resp:
            choices = [_Choice()]

        return _Resp()

    monkeypatch.setattr("services.summary_service.litellm.acompletion", fake_acompletion)
    monkeypatch.setattr(settings, "llm_stub_enabled", False)

    import asyncio
    asyncio.get_event_loop().run_until_complete(
        summary_service.generate_and_persist(db, session)
    )
    # If this file's other async tests use pytest.mark.asyncio / anyio instead,
    # use that mechanism rather than run_until_complete.

    user_prompt = captured["messages"][1]["content"]
    assert "marker-40" in user_prompt   # newest message present
    assert "marker-1\n" not in user_prompt and "marker-1'" not in user_prompt
    # marker-1 is a prefix of marker-10..19; assert on the exact oldest lines instead:
    assert "user: marker-9" not in user_prompt  # messages 1-10 fell out of the 30-window
```

Note on the prefix pitfall: `"marker-1" in prompt` would false-match `marker-10`. Assert presence of `marker-40` and absence of `user: marker-9` (messages 11-40 are the correct window, so 9 and below must be gone; with 40 messages and a 30 window, 1-10 drop).

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_summary_service.py::test_summary_uses_last_30_messages -v`
Expected: FAIL — `marker-40` missing from the captured prompt (current code takes messages 1-30).

- [ ] **Step 3: Fix the query**

In `backend/services/summary_service.py`, replace lines 37-42:

```python
    messages = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.id.desc())
        .limit(30)
    ).scalars().all()
    messages = list(reversed(messages))  # chronological order for the transcript
```

The module docstring (line 3: "last 30 messages") is now truthful — no doc change needed.

- [ ] **Step 4: Run the full summary test file**

Run from `backend/`: `pytest tests/test_summary_service.py -v`
Expected: ALL PASS (existing tests must not regress — they use short transcripts, unaffected by window direction).

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/test_summary_service.py
git commit -m "fix: session summary reads the last 30 messages, not the first 30 (F-04)"
```

---

### Task 3: F-01 backend — agent loop must emit an error SSE instead of dying silently

`run_streaming` (`backend/agent/tutor.py`) has exactly one exception arm, `except asyncio.CancelledError` (line 370). Any other exception (LLM 429/timeout, malformed stream chunk at `chunk.choices[0]`, tool dispatch crash) propagates out; `produce()` in `routes/chat.py:270-275` catches nothing and its `finally` pushes the `None` sentinel, so the client sees a clean stream end with no `error` event — the composer locks in "streaming" forever.

**Files:**
- Modify: `backend/agent/tutor.py` (add `except Exception` arm after the `except asyncio.CancelledError` block, which ends at line 418 with `raise`)
- Test: `backend/tests/test_tutor_stream.py` (add one test; this file already drives `run_streaming` with monkeypatched `litellm.acompletion` — follow its existing event-collection pattern)

**Interfaces:**
- Consumes: `_persist_assistant_message(ctx, content, status, cancelled_at=None, tool_calls=None, citations=None)` (tutor.py:31) — status is a free string on the DB row; the API `Message` schema exposes no status field, so `"error"` needs no contract change.
- Produces: on any non-cancel exception, exactly one `StreamEvent("error", {"code": "llm_failed", "message": ...})` and a persisted assistant row with `status="error"`. The route consumer already breaks on `error` events (`chat.py:296`); the FE store already clears the bubble on `error` (`session.js:525-531`).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_tutor_stream.py` (reuse this file's existing ctx/db fixtures and its async event-collection helper):

```python
async def test_llm_exception_yields_error_event_and_persists_partial(db, ctx, monkeypatch):
    async def exploding_acompletion(**kwargs):
        raise RuntimeError("provider blew up")

    monkeypatch.setattr("agent.tutor.litellm.acompletion", exploding_acompletion)
    monkeypatch.setattr(settings, "llm_stub_enabled", False)

    events = []
    async for ev in tutor.run_streaming(
        [{"role": "user", "content": "hi"}], "system prompt", ctx
    ):
        events.append(ev)

    error_events = [e for e in events if e.type == "error"]
    assert len(error_events) == 1
    assert error_events[0].data["code"] == "llm_failed"

    row = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == ctx.session_id, ChatMessage.role == "assistant")
        .order_by(ChatMessage.id.desc())
    ).scalars().first()
    assert row is not None
    assert row.status == "error"
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pytest tests/test_tutor_stream.py::test_llm_exception_yields_error_event_and_persists_partial -v`
Expected: FAIL with `RuntimeError: provider blew up` escaping the generator (no error event, no row).

- [ ] **Step 3: Add the exception arm**

In `backend/agent/tutor.py`, immediately after the `except asyncio.CancelledError:` block (which ends with `raise` at line 418), add a sibling arm. `CancelledError` is a `BaseException` subclass on Python 3.11 so `except Exception` cannot swallow it, but keeping it second also preserves reading order:

```python
    except Exception:
        # F-01: a provider 429/timeout, malformed stream chunk, or tool crash
        # must surface as an error SSE, not a silent stream end that leaves the
        # client stuck in 'streaming'. Persist whatever text already streamed.
        log.exception("agent loop failed (stream); emitting error event")
        try:
            ctx.db.rollback()  # the session may hold a failed transaction
        except Exception as rb_err:
            log.warning("rollback after agent-loop failure failed: %s", rb_err)
        try:
            _persist_assistant_message(
                ctx,
                accumulated_text,
                "error",
                tool_calls=tool_calls_record,
                citations=citations,
            )
        except Exception:
            log.exception("failed to persist assistant message after agent-loop failure")
        yield StreamEvent(
            "error",
            {
                "code": "llm_failed",
                "message": "The tutor could not finish responding. Please try again.",
            },
        )
        return
```

Do NOT wrap or modify the existing `except asyncio.CancelledError` arm.

- [ ] **Step 4: Run the tutor stream test files**

Run from `backend/`: `pytest tests/test_tutor_stream.py tests/test_tutor_loop.py tests/test_tutor_stream_check_events.py tests/test_sse_event_schemas.py -v`
Expected: ALL PASS. `test_sse_event_schemas.py` validates SSE payloads against the OpenAPI event schemas — the `error` event schema (`docs/api/openapi.yaml:1342-1351`) already allows `code` + `message`, so no schema edit is needed. If it fails, fix the payload shape, not the schema.

- [ ] **Step 5: Run the full backend suite (exception-arm touches the core loop)**

Run from `backend/`: `pytest -q`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tutor.py backend/tests/test_tutor_stream.py
git commit -m "fix: agent loop emits error SSE and persists partial text on non-cancel exceptions (F-01)"
```

---

### Task 4: F-01 frontend — terminal-event safety net in the session store

Even with Task 3, a dropped connection or a proxy cutting the stream can still end `parseSSEStream` cleanly with no terminal event (`done`/`cancelled`/`error`/`followup_skipped`). The store must never stay in `streamState='streaming'` after the stream promise resolves.

**Files:**
- Modify: `frontend/src/stores/session.js` — `sendMessageStreaming` (lines 495-547) and `completeCheck` (lines 384-442)
- Test: `frontend/src/__tests__/sessionStore.test.js` (add one test; this file already mocks the stream services — follow its existing mock pattern)

**Interfaces:**
- Consumes: existing `streamChat` / `streamCheckComplete` service mocks and store refs `streamState`, `streamingMessage`, `error`, `abortController`.
- Produces: invariant — after `sendMessageStreaming`/`completeCheck` settles, `streamState === 'idle'` and `streamingMessage === null` in every path.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/sessionStore.test.js` (adapt to this file's existing `vi.mock` setup for the chat stream service):

```js
it('resets stream state when the stream ends without a terminal event', async () => {
  // Mock streamChat to emit only a delta, then resolve (no done/error/cancelled).
  streamChat.mockImplementation(async ({ onEvent }) => {
    onEvent({ event: 'assistant_delta', data: { text: 'partial' } })
  })
  const store = useSessionStore()
  store.currentSessionId = 's1'   // use this file's existing session-setup helper if one exists

  await store.sendMessageStreaming({ text: 'hello' })

  expect(store.streamState).toBe('idle')
  expect(store.streamingMessage).toBeNull()
  expect(store.error).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js`
Expected: FAIL — `streamState` is `'streaming'` and `streamingMessage` is non-null.

- [ ] **Step 3: Implement the safety net in both stream functions**

In `sendMessageStreaming`, declare a flag before the try and set it in the terminal cases:

```js
    let sawTerminal = false
```

In the `onEvent` switch, add `sawTerminal = true` as the first statement of the `'done'`, `'cancelled'`, `'error'`, and (not present in sendMessageStreaming, only completeCheck) `'followup_skipped'` cases. Example for `'done'`:

```js
            case 'done': sawTerminal = true; finalizeMessage(data.message_id); break
            case 'cancelled': sawTerminal = true; handleCancelled(data.message_id, data.partial_content_chars, data.estimated_cost_usd); break
            case 'error':
              sawTerminal = true
              _applyCapError(data)
              error.value = data.message || data.code
              streamingMessage.value = null
              streamState.value = 'idle'
              abortController.value = null
              break
```

Then, immediately after the `await streamChat({...})` call (still inside the `try`, before the `catch`):

```js
      deltaBatcher.flush()
      if (!sawTerminal) {
        error.value = 'The tutor stopped responding. Please try again.'
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
      }
```

Apply the identical pattern in `completeCheck` (its switch has the extra `'followup_skipped'` terminal case — set `sawTerminal = true` there too).

- [ ] **Step 4: Run the store test file**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js`
Expected: ALL PASS (new test green, existing tests unaffected — they all emit `done` or `error`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "fix: reset stream state when SSE ends without a terminal event (F-01)"
```

---

### Task 5: F-05 backend — ended sessions reject chat turns and check mutations with 409

`_prepare_turn` (`routes/chat.py:157-171`) and the three check endpoints (`routes/sessions.py:379` skip, `:404` answer, `:434` complete) check only ownership, never `ended_at`. "Ended" is currently an FE-only invariant; any client can keep writing to an ended session, desynchronizing the stored summary and the resume-create snapshot semantics.

**Files:**
- Modify: `backend/routes/chat.py` (in `_prepare_turn`, after the ownership 404 at lines 166-168)
- Modify: `backend/routes/sessions.py` (in `skip_check`, `answer_check`, `complete_check`, after each ownership 404)
- Modify: `docs/api/openapi.yaml` (add a `"409"` response entry to `/chat/stream` and the three check paths; run codegen after — it is a no-op for models but keeps the contract honest; verify the PostToolUse codegen hook fired)
- Test: `backend/tests/test_chat_stream_route.py`, `backend/tests/test_check_answer_route.py`, `backend/tests/test_check_skip_route.py`, `backend/tests/test_check_complete_route.py` (one new test each; all four files already have authed-client + session fixtures — follow their patterns)

**Interfaces:**
- Consumes: `SessionModel.ended_at` (nullable datetime), existing ownership checks.
- Produces: `HTTPException(409, detail={"code": "session_ended"})` — the FE (Task 6) matches on `e.body.detail.code === 'session_ended'`. `reopen_session` (`sessions.py:321-334`) nulls `ended_at` and must remain unguarded so Reopen still works.

- [ ] **Step 1: Write the four failing tests**

Pattern (adapt fixture names per file; each file already creates a session for an authed user):

```python
def test_chat_stream_on_ended_session_returns_409(client, db, session_row):
    session_row.ended_at = datetime.now(timezone.utc)
    db.commit()
    resp = client.post(
        "/api/chat/stream",
        json={"session_id": session_row.id, "message": "hi"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "session_ended"
```

Mirror for `POST /api/sessions/{id}/check/skip`, `/check/answer`, `/check/complete` with each route's minimal valid body (`{"index": 0}` / `{"index": 0, "selected_index": 0}` / empty). Use each test file's existing request-path and fixture conventions — the check-route files already post to these endpoints.

- [ ] **Step 2: Run tests to verify all four fail**

Run from `backend/`: `pytest tests/test_chat_stream_route.py -k ended -v; pytest tests/test_check_answer_route.py -k ended -v; pytest tests/test_check_skip_route.py -k ended -v; pytest tests/test_check_complete_route.py -k ended -v`
Expected: all four FAIL (200/404/409-with-different-detail instead of 409 session_ended).

- [ ] **Step 3: Add the guard in `_prepare_turn`**

In `backend/routes/chat.py`, directly after `session = row[0]` (line 168):

```python
    if session.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
```

- [ ] **Step 4: Add the guard to the three check endpoints**

In `backend/routes/sessions.py`, in `skip_check`, `answer_check`, and `complete_check`, directly after each `if row is None or row.user_id != user_id: raise HTTPException(404 ...)` block:

```python
    if row.ended_at is not None:
        raise HTTPException(status_code=409, detail={"code": "session_ended"})
```

Do NOT touch `end_session` (idempotent by design), `reopen_session` (must clear `ended_at`), or `update_session` (pin-guard already handles ended).

- [ ] **Step 5: Document the 409 in the API contract**

In `docs/api/openapi.yaml`, under the `responses:` of `POST /chat/stream` and the three check operations, add:

```yaml
        "409":
          description: Session has ended; reopen it to continue.
```

(For the check endpoints a `"409"` entry may already exist for batch-state conflicts — if so, extend its description to mention the ended-session case instead of duplicating the key.) Then run from repo root: `python backend/scripts/gen_contracts.py` and confirm `git status` shows no drift under `backend/contracts/` (response-code entries do not generate models).

- [ ] **Step 6: Run the four test files fully, then the full suite**

Run from `backend/`: `pytest tests/test_chat_stream_route.py tests/test_check_answer_route.py tests/test_check_skip_route.py tests/test_check_complete_route.py -v`
Expected: ALL PASS.
Then: `pytest -q`
Expected: ALL PASS — in particular `tests/test_end_abandons_open_batch.py` and `tests/test_sessions_route.py` (end/reopen flows) must not regress.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/chat.py backend/routes/sessions.py docs/api/openapi.yaml backend/contracts/
git commit -m "fix: ended sessions return 409 for chat turns and check mutations (F-05)"
```

---

### Task 6: F-05 frontend — map 409 session_ended to a friendly error and local state update

**Files:**
- Modify: `frontend/src/stores/session.js` — `sendMessageStreaming` catch block (lines 535-546)
- Test: `frontend/src/__tests__/sessionStore.test.js`

**Interfaces:**
- Consumes: Task 5's `{status: 409, body: {detail: {code: 'session_ended'}}}` error shape — the existing catch already reads `e?.status` / `e?.body?.detail` for the 429 case, so the thrown error carries these fields.
- Produces: on session_ended 409 — error message set, stream state reset, `currentSession.ended_at` stamped locally so `isEnded`-gated UI (composer hide, Reopen affordance) reacts without a refetch.

- [ ] **Step 1: Write the failing test**

```js
it('maps a session_ended 409 to a friendly error and marks the session ended', async () => {
  streamChat.mockRejectedValue(
    Object.assign(new Error('conflict'), {
      status: 409,
      body: { detail: { code: 'session_ended' } },
    })
  )
  const store = useSessionStore()
  store.currentSessionId = 's1'
  store.currentSession = { id: 's1', ended_at: null }

  await store.sendMessageStreaming({ text: 'hello' })

  expect(store.error).toMatch(/ended/i)
  expect(store.streamState).toBe('idle')
  expect(store.currentSession.ended_at).not.toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js`
Expected: FAIL — generic error text, `ended_at` untouched.

- [ ] **Step 3: Implement the 409 mapping**

In `sendMessageStreaming`'s catch block, after the AbortError early-return and before the 429 line:

```js
      if (e?.status === 409 && e?.body?.detail?.code === 'session_ended') {
        error.value = 'This session was ended elsewhere. Reopen it to continue.'
        if (currentSession.value) currentSession.value.ended_at = new Date().toISOString()
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
        return
      }
```

- [ ] **Step 4: Run the store test file, then the full FE suite**

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/sessionStore.test.js`
Expected: ALL PASS.
Then: `npm run test:unit -- --run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "fix: surface session-ended 409 in the chat composer (F-05)"
```

---

### Task 7: Full verification sweep + review doc status update

**Files:**
- Modify: `docs/adversarial-review-2026-07-12.md` (mark F-01/F-04/F-05/F-16 as fixed in the findings table — append " — FIXED (Batch 1)" to each Defect cell; do not rewrite anything else)

**Interfaces:**
- Consumes: all prior tasks committed.
- Produces: green suites, lint clean, branch ready for PR to `dev`.

- [ ] **Step 1: Full backend suite**

Run from `backend/`: `pytest -q`
Expected: ALL PASS. If any fail, STOP and report (ground rule: stop on failed verification).

- [ ] **Step 2: Full frontend suite + lint**

Run from `frontend/`: `npm run test:unit -- --run` then `npm run lint`
Expected: ALL PASS, lint clean.

- [ ] **Step 3: Grep for accidental testid or contract drift**

Native Grep: search repo for `session_ended` — expect hits only in `routes/chat.py`, `routes/sessions.py`, `openapi.yaml`, `stores/session.js`, and the four new tests. No `data-testid` was touched in this batch.

- [ ] **Step 4: Mark the four findings fixed in the review doc**

In `docs/adversarial-review-2026-07-12.md` findings table, append " — FIXED (Batch 1)" to the Defect cell of F-01, F-04, F-05, F-16.

- [ ] **Step 5: Commit and push**

```bash
git add docs/adversarial-review-2026-07-12.md docs/superpowers/plans/2026-07-13-adversarial-batch-1.md
git commit -m "docs: mark adversarial-review Batch 1 findings fixed; add batch 1 plan"
git push -u origin fix/adversarial-batch-1
```

Then open a PR to `dev` (NOT `main`) titled "Adversarial review Batch 1: F-01 F-04 F-05 F-16".

---

## Out of scope (later batches)

- F-14 (max_iters discards streamed text) — Batch 4 territory despite touching the same loop; do not fold in.
- Cost metering of the summary path (F-03) — Batch 2.
- Any FE "Reopen" button beyond the existing reopen flow — the 409 mapping only stamps local state.
