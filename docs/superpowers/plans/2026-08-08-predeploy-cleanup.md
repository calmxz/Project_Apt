# Pre-Deploy Cleanup Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all pre-deploy-closable QA-audit items: F-9 draft-loss bugs (E-05/E-11/E-14), Q-04 coverage scope, C-12 migration convention, then verification gates W-09/W-06/W-11/W-12.

**Architecture:** A typed `StreamAbortedError` thrown from the session store's error arms replaces two silent `return`s, letting `SessionView.send()` restore the composer draft; the auth-expiry case additionally stashes the draft in `sessionStorage` to survive the login redirect. Q-04 and C-12 are config/doc edits. W-gates are executed post-merge and recorded in the deployment checklist.

**Tech Stack:** Vue 3 + Pinia + Vitest (frontend), pytest + coverage (backend), docker compose (gates).

**Spec:** `docs/superpowers/specs/2026-08-08-predeploy-cleanup-design.md`

## Global Constraints

- No emojis in code or comments.
- Never read `.env` / `.env.local`; user places env files manually where needed.
- Stop and report on any failed verification step.
- Branch: `fix/predeploy-cleanup-f9-q04-c12` off `dev`. One PR for Tasks 1-5.
- Frontend tests: from `frontend/`: `npm run test:unit -- --run` (single file: append path).
- Backend tests: from `backend/`: `pytest`.
- Line numbers in this plan drift; anchor by the quoted code, not the number.

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout dev && git pull && git checkout -b fix/predeploy-cleanup-f9-q04-c12`

---

### Task 1: `StreamAbortedError` typed error

**Files:**
- Modify: `frontend/src/lib/errors.js`
- Test: `frontend/src/__tests__/errors.test.js` (create if absent; if a test file for errors.js exists, add there)

**Interfaces:**
- Produces: `class StreamAbortedError extends Error { name: 'StreamAbortedError', reason: 'auth_expired' | 'session_ended', cause }` exported from `@/lib/errors.js`. Tasks 2 and 3 import it.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest'
import { StreamAbortedError, friendlyError } from '@/lib/errors.js'

describe('StreamAbortedError', () => {
  it('carries reason and cause', () => {
    const cause = Object.assign(new Error('API 401'), { status: 401 })
    const e = new StreamAbortedError('auth_expired', cause)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('StreamAbortedError')
    expect(e.reason).toBe('auth_expired')
    expect(e.cause).toBe(cause)
  })
})
```

- [ ] **Step 2: Run test, verify FAIL** (`StreamAbortedError` not exported)
- [ ] **Step 3: Implement** — append to `frontend/src/lib/errors.js`:

```js
// Thrown by the session store when a send-stream is aborted for a reason the
// view must react to (restore the draft) rather than silently swallow.
export class StreamAbortedError extends Error {
  constructor(reason, cause) {
    super(`stream aborted: ${reason}`)
    this.name = 'StreamAbortedError'
    this.reason = reason
    this.cause = cause
  }
}
```

- [ ] **Step 4: Run test, verify PASS**
- [ ] **Step 5: Commit** — `feat: add StreamAbortedError typed error (F-9)`

---

### Task 2: Store rethrows instead of silently returning

**Files:**
- Modify: `frontend/src/stores/session.js` — the `catch (e)` block of the **send** stream path (the one containing the `sawAnyEvent` bubble-pop comment "I-10" and the `session_ended` 409 arm). NOT the check-answer catch block (the one referencing `savedCheck`/`pendingCheck`).
- Test: `frontend/src/__tests__/sessionStore.test.js`

**Interfaces:**
- Consumes: `StreamAbortedError` from `@/lib/errors.js` (Task 1).
- Produces: `sendMessageStreaming` now REJECTS with `StreamAbortedError('auth_expired')` on a 401, and `StreamAbortedError('session_ended')` on 409 `session_ended` — after performing its existing cleanup (banner, ended_at, stream-state clear). Genuine navigation supersede still resolves silently.

- [ ] **Step 1: Write failing tests** (add to `sessionStore.test.js`, follow the existing `vi.spyOn(streamSvc, 'streamChat')` pattern):

```js
import { StreamAbortedError } from '@/lib/errors.js'

it('sendMessageStreaming throws StreamAbortedError(auth_expired) on 401, even after store reset', async () => {
  const s = useSessionStore()
  s.currentSessionId = 's1'
  vi.spyOn(streamSvc, 'streamChat').mockImplementation(async () => {
    s.reset() // simulates _onAuthExpired -> signOut -> reset() nulling currentSessionId
    throw Object.assign(new Error('API 401'), { status: 401 })
  })
  await expect(s.sendMessageStreaming({ text: 'long draft' })).rejects.toSatisfy(
    (e) => e instanceof StreamAbortedError && e.reason === 'auth_expired',
  )
})

it('sendMessageStreaming throws StreamAbortedError(session_ended) on 409 and keeps the banner', async () => {
  const s = useSessionStore()
  s.currentSessionId = 's1'
  s.currentSession = { id: 's1', ended_at: null }
  vi.spyOn(streamSvc, 'streamChat').mockImplementation(async () => {
    throw Object.assign(new Error('API 409'), {
      status: 409,
      body: { detail: { code: 'session_ended' } },
    })
  })
  await expect(s.sendMessageStreaming({ text: 'q' })).rejects.toSatisfy(
    (e) => e instanceof StreamAbortedError && e.reason === 'session_ended',
  )
  expect(s.error).toMatch(/ended elsewhere/)
  expect(s.currentSession.ended_at).toBeTruthy()
  expect(s.streamState).toBe('idle')
})

it('sendMessageStreaming stays silent on genuine navigation supersede', async () => {
  const s = useSessionStore()
  s.currentSessionId = 's1'
  vi.spyOn(streamSvc, 'streamChat').mockImplementation(async () => {
    s.currentSessionId = 's2' // user opened another session mid-stream
    throw Object.assign(new Error('boom'), { status: 500 })
  })
  await expect(s.sendMessageStreaming({ text: 'q' })).resolves.toBeUndefined()
  expect(s.error).toBeNull()
})
```

- [ ] **Step 2: Run tests, verify the first two FAIL** (currently resolve), third PASSES already.
- [ ] **Step 3: Implement.** Import `StreamAbortedError` at the top of `session.js`. Rework the send-path catch block. Current shape:

```js
    } catch (e) {
      deltaBatcher.flush()
      if (_streamSuperseded()) {
        _clearStreamState()
        return
      }
      ...
```

New shape (401 arm added, supersede check made 401-aware, 409 arm throws):

```js
    } catch (e) {
      deltaBatcher.flush()
      const authExpired = e?.status === 401
      // Superseded by navigation: swallow. Superseded because sign-out reset
      // the store (E-05): fall through so the 401 arm can rethrow.
      if (_streamSuperseded() && !authExpired) {
        _clearStreamState()
        return
      }
      if (e?.name === 'AbortError') {
        if (streamingMessage.value)
          handleCancelled('pending', streamingMessage.value.content.length, '0')
        return
      }
      if (!sawAnyEvent && typeof e?.status === 'number' && e.status >= 400) {
        // I-10 bubble-pop: unchanged, keep the existing comment block
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'user' && last.message_id === undefined) messages.value.pop()
      }
      if (authExpired) {
        // E-05: the view must get a chance to stash the draft before the
        // login redirect unmounts it.
        _clearStreamState()
        throw new StreamAbortedError('auth_expired', e)
      }
      if (e?.status === 409 && e?.body?.detail?.code === 'session_ended') {
        error.value = 'This session was ended elsewhere. Reopen it to continue.'
        if (currentSession.value) currentSession.value.ended_at = new Date().toISOString()
        _clearStreamState()
        // E-11: rethrow so the view restores the draft instead of running
        // its success path.
        throw new StreamAbortedError('session_ended', e)
      }
      if (e?.status === 429) _applyCapError(e?.body?.detail)
      _clearStreamState()
      _setError(e)
    }
```

Note: the three manual `streamingMessage.value = null / streamState.value = 'idle' / abortController.value = null` lines in the old 409 arm and tail are replaced by the existing `_clearStreamState()` helper — same effect, defined nearby.

- [ ] **Step 4: Run full sessionStore.test.js, verify PASS** — including all pre-existing tests (the reordering must not break the AbortError or 429 paths).
- [ ] **Step 5: Commit** — `fix: rethrow typed StreamAbortedError from send-stream error arms (E-05, E-11)`

---

### Task 3: SessionView draft restore + sessionStorage stash + retry fix

**Files:**
- Modify: `frontend/src/views/SessionView.vue` — `send()`, `retryLastMessage()`, mount/watch restore
- Test: `frontend/src/__tests__/sessionView.test.js`

**Interfaces:**
- Consumes: `StreamAbortedError` (Task 1); store rejection behavior (Task 2).
- Produces: sessionStorage key contract `crux:draft:<sessionId>` holding the raw draft text. Written on `auth_expired`, read-and-removed on mount of the same session.

- [ ] **Step 1: Write failing tests** (add to `sessionView.test.js`, follow that file's existing mount/store-mock harness):

```js
import { StreamAbortedError } from '@/lib/errors.js'

it('restores the draft and skips the error chip when the session was ended elsewhere (E-11)', async () => {
  // arrange per file harness; make store.sendMessageStreaming reject:
  store.sendMessageStreaming.mockRejectedValueOnce(new StreamAbortedError('session_ended'))
  // type + send
  await typeDraft(wrapper, 'my long message')
  await submitSend(wrapper)
  expect(composerValue(wrapper)).toBe('my long message') // draft restored
  expect(wrapper.find('[data-testid="send-error"]').exists()).toBe(false) // no generic chip
})

it('stashes the draft to sessionStorage on auth expiry (E-05)', async () => {
  store.sendMessageStreaming.mockRejectedValueOnce(new StreamAbortedError('auth_expired'))
  await typeDraft(wrapper, 'precious text')
  await submitSend(wrapper)
  expect(sessionStorage.getItem('crux:draft:S_ID')).toBe('precious text')
})

it('restores a stashed draft on mount and clears the stash (E-05 round-trip)', async () => {
  sessionStorage.setItem('crux:draft:S_ID', 'from before login')
  const w = mountView() // per file harness, session id S_ID
  await flushPromises()
  expect(composerValue(w)).toBe('from before login')
  expect(sessionStorage.getItem('crux:draft:S_ID')).toBeNull()
})

it('retry sends the edited composer text, not the stale lastSentText (E-14)', async () => {
  store.sendMessageStreaming.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }))
  await typeDraft(wrapper, 'original')
  await submitSend(wrapper) // fails; catch restores draft
  await typeDraft(wrapper, 'edited')
  store.sendMessageStreaming.mockResolvedValueOnce(undefined)
  await clickRetry(wrapper)
  expect(store.sendMessageStreaming).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'edited' }),
  )
})
```

Adapt helper names (`typeDraft`, `submitSend`, `composerValue`, `clickRetry`, `mountView`, error-chip testid) to what `sessionView.test.js` actually uses — the file has an established harness; reuse it. `sessionStorage` is available in the jsdom/happy-dom env; clear it in `beforeEach`.

- [ ] **Step 2: Run, verify all four FAIL.**
- [ ] **Step 3: Implement** in `SessionView.vue`:

Import: `import { StreamAbortedError } from '@/lib/errors.js'` (file already imports `friendlyError` — extend that import).

`send()`:

```js
async function send() {
  const text = draft.value
  if (!text.trim()) return
  draft.value = ''
  lastSentText.value = text
  lastError.value = null
  sending.value = true
  try {
    await store.sendMessageStreaming({ text })
    lastSentText.value = ''
  } catch (e) {
    if (e instanceof StreamAbortedError) {
      // Store already surfaced the state (banner / redirect); no generic chip.
      if (e.reason === 'auth_expired') {
        // E-05: component is about to unmount via the login redirect.
        sessionStorage.setItem(`crux:draft:${props.id}`, text)
      }
      draft.value = text
    } else {
      draft.value = text
      lastError.value = e
    }
  } finally {
    sending.value = false
  }
}
```

`retryLastMessage()` (E-14 — composer text wins):

```js
async function retryLastMessage() {
  if (!draft.value.trim() && lastSentText.value) draft.value = lastSentText.value
  if (!draft.value.trim()) return
  await send()
}
```

Stash restore — add helper and call it on mount and on the existing `props.id` watch (the one that re-runs `loadCurrent`):

```js
// E-05: a draft stashed by send() just before the auth redirect survives the
// login round-trip in sessionStorage; restore it exactly once.
function restoreStashedDraft(id) {
  const key = `crux:draft:${id}`
  const stashed = sessionStorage.getItem(key)
  if (stashed !== null) {
    draft.value = stashed
    sessionStorage.removeItem(key)
  }
}
```

Call `restoreStashedDraft(props.id)` inside the existing `onMounted(() => loadCurrent(props.id))` (make it a block) and in the `props.id` watcher after `loadCurrent`.

- [ ] **Step 4: Run sessionView.test.js, verify PASS. Then full suite:** `npm run test:unit -- --run` — all green (831+ tests).
- [ ] **Step 5: Lint:** `npm run lint` — clean.
- [ ] **Step 6: Commit** — `fix: restore composer draft on stream abort + retry uses edited text (F-9: E-05, E-11, E-14)`

---

### Task 4: Q-04 coverage scope

**Files:**
- Modify: `backend/pyproject.toml` line ~52 (`addopts`)

**Interfaces:** none downstream.

- [ ] **Step 1: Edit** `addopts` from

```toml
addopts = "--cov=services --cov=lib --cov=worker --cov-report=term-missing --cov-fail-under=75"
```

to

```toml
addopts = "--cov=services --cov=lib --cov=worker --cov=routes --cov=agent --cov=db --cov-report=term-missing --cov-fail-under=75"
```

(Note: `--cov=worker` already exists — the audit anchor predates PR #218. Keep it.)

- [ ] **Step 2: Measure:** from `backend/`: `pytest`. Record the new TOTAL percentage.
- [ ] **Step 3: Decision rule (agreed in spec):**
  - TOTAL ≥ 75 → done, proceed to Step 4.
  - 65 < TOTAL < 75 → write tests for the largest uncovered gaps (start with `routes/` handlers — highest breakage risk) until TOTAL ≥ 75. Each new test file follows existing patterns in `backend/tests/`. Then Step 4.
  - TOTAL ≤ 65 → **STOP. Report the number to the user** and ask: write tests now vs ratchet floor to measured value. Do not proceed on this task until answered.
- [ ] **Step 4: Run `pytest` once more, verify green with floor intact. Commit** — `ci: extend coverage floor to routes, agent, db (Q-04)`

---

### Task 5: C-12 migration locking convention

**Files:**
- Modify: `.claude/agents/migration-reviewer.md` — checklist item 4
- Modify: `.claude/skills/project-conventions/SKILL.md` — migrations bullet (~line 38)

**Interfaces:** none downstream.

- [ ] **Step 1: Replace checklist item 4** in `migration-reviewer.md`:

```
4. Lock impact: index creation on large tables without postgresql_concurrently;
   table rewrites (type changes, column defaults with volatile functions) inside
   a transaction that will hold an exclusive lock. Required patterns (C-12):
   - Index builds on populated or hot tables must use
     `with op.get_context().autocommit_block():` wrapping
     `op.execute("CREATE INDEX CONCURRENTLY ...")` — env.py runs migrations in
     one transaction, so plain op.create_index cannot be concurrent.
   - CHECK constraints on populated tables must be two-step:
     `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE CONSTRAINT` (VALIDATE takes
     only SHARE UPDATE EXCLUSIVE, so reads and writes continue).
   - Any migration touching a hot table (sessions, chat_messages,
     chunk_embeddings) must open with `op.execute("SET lock_timeout = '5s'")`
     so it fails fast instead of queueing behind a long query and then
     blocking everything behind itself.
```

- [ ] **Step 2: Append to the migrations bullet** in `project-conventions/SKILL.md` (same bullet, one sentence):

```
Hot-table migrations: CREATE INDEX CONCURRENTLY via autocommit_block, CHECK via NOT VALID then VALIDATE, and SET lock_timeout = '5s' at the top (C-12).
```

- [ ] **Step 3: Commit** — `docs: add C-12 migration locking patterns to reviewer checklist and conventions`

---

### Task 6: PR and merge

- [ ] **Step 1:** Push branch; open PR to `dev` titled `fix: pre-deploy cleanup - F-9 draft preservation, Q-04 coverage scope, C-12 migration convention`. Body lists the three findings, the audit doc, and notes W-gates follow post-merge.
- [ ] **Step 2:** Wait for CI green (backend pytest + frontend vitest jobs). CI failure → fix on branch, do not bypass.
- [ ] **Step 3:** Merge to `dev` (regular merge, not squash — per repo convention squash is only avoided for release PRs to main; normal merge or squash to dev both fine, follow recent PR practice).
- [ ] **Step 4:** Update `docs/reviews/2026-08-06-qa-audit/deployment-checklist.md`: F-9 row → CLOSED with PR number; F-10 row → note Q-04 closed; add C-12 note under Remaining risks item 4. Commit directly to `dev` with the W-gate updates in Task 7 (single docs commit at the end is fine).

---

### Task 7: Verification gates W-09 → W-06 → W-11 → W-12

Run in order. Any FAIL → stop, report, fix as separate follow-up.

- [ ] **W-09 rebuild:** from repo root on updated `dev`:
  `docker compose build --no-cache` then `docker compose up -d`; verify backend health endpoint responds and frontend serves on :5173. `docker compose down` after.
- [ ] **W-06 clean-clone smoke:**
  1. `git clone <repo> <scratchpad>/crux-clean && cd crux-clean`
  2. **Ask the user to place `.env` / `.env.local` files** (never read their contents).
  3. `docker compose up --build -d`; verify: both containers healthy, frontend serves, backend health OK; exercise the upload path with a small real PDF through the browser (this is the C-02-class check: nginx body size, proxy wiring).
  4. `docker compose down`; remove scratch clone.
- [ ] **W-11 narrow-viewport rail:** browser at ~500 px width on the running local stack → Settings; confirm the settings rail scrolls and nothing overflows (`SettingsView.vue` grid). Screenshot as evidence.
- [ ] **W-12 glance-stats visual pass:** browser on local stack → home/glance stats area post-#212; confirm layout and numbers render sanely light+dark. Screenshot as evidence.
- [ ] **Record:** update `deployment-checklist.md` W-09/W-06/W-11/W-12 rows to CLOSED-PASS with date + evidence pointers; commit to `dev` — `docs: close local verification gates W-06, W-09, W-11, W-12`.

---

## Self-review notes

- Spec coverage: WS1 → Tasks 1-3; WS2 → Task 4; WS3 → Task 5; WS4 → Task 7; delivery → Tasks 0, 6. No gaps.
- Check-answer stream path deliberately untouched (spec scope: send path only).
- Type consistency: `StreamAbortedError(reason, cause)` used identically in Tasks 1/2/3; stash key `crux:draft:<sessionId>` identical in Tasks 3 tests and impl.
