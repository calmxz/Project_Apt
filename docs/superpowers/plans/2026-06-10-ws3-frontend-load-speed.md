# WS3 — Frontend Load Speed (Cut 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session-switch feel instant — de-dupe the double `GET /sessions`, paint an optimistic header + message skeleton on navigate (no more stale-content flash), and capture a dev-only timing number that decides whether the retention-based tail (warm prefetch + SWR cache) is needed at all.

**Architecture:** Cut 1 retains nothing across navigations, so it carries zero invalidation surface and zero PR #72 exposure. One store-level primitive — an in-flight-promise guard (`_inflight` Map holding only *pending* promises) — collapses concurrent `listSessions` calls (fixing the home double-fetch) and concurrent same-id `loadSession` calls. A new `detailLoading` ref gates a new `MessageListSkeleton`. `SessionView` computes the header topic view-locally from the already-known list row while detail loads, then swaps to the real detail — `store.currentSession` is **never** stubbed. A dev-only `console.debug` timing log (navigate → painted ms, behind `import.meta.env.DEV`) produces the gate number; the retention tail is decided by measurement, not built here.

**Tech Stack:** Vue 3 (`<script setup>`), Pinia setup store, Vitest + `@vue/test-utils`, Vite (`import.meta.env.DEV`).

**Spec:** `docs/superpowers/specs/2026-06-08-sessions-ux-and-performance-design.md` → "WS3 — Frontend load speed" (Cut 1 / gated tail split, reclassified 2026-06-10).

**Out of scope (gated tail — DO NOT build here):** warm hover/focus prefetch, per-id SWR cache. Both retain a resolved detail and share one invalidation surface; they are decided together by Task 5's measurement. No backend / no OpenAPI / no contract codegen in WS3 — pure frontend.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `frontend/src/stores/session.js` | In-flight-promise guard on `listSessions` + `loadSession`; new `detailLoading` ref | Modify |
| `frontend/src/components/chat/MessageListSkeleton.vue` | Detail-area shimmer placeholder (mirrors `SidebarSkeletonList`) | Create |
| `frontend/src/views/SessionView.vue` | Optimistic header (view-local), skeleton wiring, dev timing log | Modify |
| `frontend/src/__tests__/sessionStore.test.js` | Guard + `detailLoading` tests | Modify |
| `frontend/src/__tests__/messageListSkeleton.test.js` | Skeleton render test | Create |
| `frontend/src/__tests__/sessionView.test.js` | Optimistic header + skeleton + timing tests | Modify |

---

## Task 1: In-flight-promise guard + `detailLoading` ref (store)

**Files:**
- Modify: `frontend/src/stores/session.js` (refs ~15-32; `listSessions` 56-67; `loadSession` 89-141; return block 539-584)
- Test: `frontend/src/__tests__/sessionStore.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('session store', ...)` block in `frontend/src/__tests__/sessionStore.test.js` (after the `loadSession maps API messages` test):

```js
  it('listSessions de-dupes concurrent calls into one network request', async () => {
    let resolve
    sessionsApi.listSessions.mockImplementationOnce(
      () => new Promise((r) => { resolve = r }),
    )
    const s = useSessionStore()
    const p1 = s.listSessions()
    const p2 = s.listSessions()
    resolve([{ id: 's1' }])
    const [r1, r2] = await Promise.all([p1, p2])
    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(1)
    expect(r1).toEqual([{ id: 's1' }])
    expect(r2).toEqual([{ id: 's1' }])
  })

  it('listSessions refetches after the in-flight request settles (no retained cache)', async () => {
    sessionsApi.listSessions
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([{ id: 'b' }])
    const s = useSessionStore()
    await s.listSessions()
    await s.listSessions()
    expect(sessionsApi.listSessions).toHaveBeenCalledTimes(2)
    expect(s.sessions).toEqual([{ id: 'b' }])
  })

  it('loadSession de-dupes concurrent same-id calls and toggles detailLoading', async () => {
    let resolve
    sessionsApi.getSession.mockImplementationOnce(
      () => new Promise((r) => { resolve = r }),
    )
    const s = useSessionStore()
    const p1 = s.loadSession('s1')
    const p2 = s.loadSession('s1')
    expect(s.detailLoading).toBe(true)
    resolve({ id: 's1', messages: [] })
    await Promise.all([p1, p2])
    expect(sessionsApi.getSession).toHaveBeenCalledTimes(1)
    expect(s.detailLoading).toBe(false)
  })

  it('loadSession does not de-dupe different ids', async () => {
    sessionsApi.getSession.mockResolvedValue({ id: 'x', messages: [] })
    const s = useSessionStore()
    await Promise.all([s.loadSession('s1'), s.loadSession('s2')])
    expect(sessionsApi.getSession).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run sessionStore`
Expected: the 4 new tests FAIL — `listSessions`/`loadSession` call the API twice (no dedup), and `s.detailLoading` is `undefined`.

- [ ] **Step 3: Add the `detailLoading` ref and `_inflight` Map**

In `frontend/src/stores/session.js`, add `detailLoading` right after the `loading` ref (line 19):

```js
  const loading = ref(false)
  const detailLoading = ref(false)
  const error = ref(null)
```

Then add the in-flight map after the library-scoped state (after `const libraryError = ref(false)`... i.e. after line 32, before `async function fetchLibrary`):

```js
  // In-flight-promise guard. Holds ONLY pending promises (deleted on settle),
  // never resolved results — so a reused promise is as fresh as a new request
  // and carries no invalidation surface. De-dupes the double GET /sessions on
  // home load and collapses concurrent same-id detail loads. NOT a cache.
  const _inflight = new Map()
```

- [ ] **Step 4: Wrap `listSessions` with the guard**

Replace the existing `listSessions` (lines 56-67) with:

```js
  async function listSessions() {
    if (_inflight.has('list')) return _inflight.get('list')
    const p = (async () => {
      loading.value = true
      error.value = null
      try {
        sessions.value = await sessionsApi.listSessions()
        return sessions.value
      } catch (e) {
        _setError(e)
      } finally {
        loading.value = false
        _inflight.delete('list')
      }
    })()
    _inflight.set('list', p)
    return p
  }
```

- [ ] **Step 5: Wrap `loadSession` with the guard + `detailLoading`**

Replace the existing `loadSession` (lines 89-141) with (the message/pending-check mapping is unchanged — copy it verbatim from the current file):

```js
  async function loadSession(id) {
    if (_inflight.has(id)) return _inflight.get(id)
    const p = (async () => {
      loading.value = true
      detailLoading.value = true
      error.value = null
      try {
        const s = await sessionsApi.getSession(id)
        currentSession.value = s
        currentSessionId.value = s.id
        messages.value = (s.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
          message_id: m.id,
          citations: m.citations || [],
          created_at: m.created_at,
          check_batch: m.check_batch
            ? {
                gap: m.check_batch.gap,
                total: m.check_batch.total,
                items: (m.check_batch.items || []).map((it) => ({
                  question: it.question,
                  options: it.options || [],
                  status: it.status,
                  selectedIndex: it.selected_index,
                  correctIndex: it.correct_index,
                  correct: it.correct,
                  explanation: it.explanation,
                })),
              }
            : null,
        }))
        pendingCheck.value = s.pending_check
          ? {
              gap: s.pending_check.gap,
              total: s.pending_check.total,
              currentIndex: s.pending_check.current_index,
              viewIndex: s.pending_check.current_index,
              items: (s.pending_check.items || []).map((it) => ({
                question: it.question,
                options: it.options || [],
                status: it.status,
                selectedIndex: it.selected_index,
                correctIndex: it.correct_index,
                correct: it.correct,
                explanation: it.explanation,
              })),
            }
          : null
        return s
      } catch (e) {
        _setError(e)
      } finally {
        loading.value = false
        detailLoading.value = false
        _inflight.delete(id)
      }
    })()
    _inflight.set(id, p)
    return p
  }
```

- [ ] **Step 6: Expose `detailLoading` from the store**

In the return block (line 544), add `detailLoading` right after `loading`:

```js
    loading,
    detailLoading,
    error,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run sessionStore`
Expected: PASS — all 4 new tests green, plus the pre-existing `listSessions`/`loadSession` tests still green (the no-arg/`'u1'`-arg calls and the `rejects.toThrow('nope')` error path are preserved by the guard).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js
git commit -m "feat(sessions): WS3 in-flight-promise guard + detailLoading ref

De-dupes the double GET /sessions on home load and collapses concurrent
same-id loadSession calls via a _inflight Map holding only pending promises
(deleted on settle, never retained) — zero invalidation surface, not a cache.
Adds detailLoading to gate the upcoming message skeleton."
```

---

## Task 2: `MessageListSkeleton` component

**Files:**
- Create: `frontend/src/components/chat/MessageListSkeleton.vue`
- Test: `frontend/src/__tests__/messageListSkeleton.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/messageListSkeleton.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageListSkeleton from '@/components/chat/MessageListSkeleton.vue'

describe('MessageListSkeleton', () => {
  it('renders the requested number of placeholder rows and is aria-hidden', () => {
    const wrapper = mount(MessageListSkeleton, { props: { count: 3 } })
    const root = wrapper.find('[data-testid="session-messages-skeleton"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('.msg-skel-row')).toHaveLength(3)
  })

  it('defaults to a sensible row count', () => {
    const wrapper = mount(MessageListSkeleton)
    expect(wrapper.findAll('.msg-skel-row').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run messageListSkeleton`
Expected: FAIL — `Failed to resolve import` / component does not exist.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/chat/MessageListSkeleton.vue` (mirrors the shimmer style of `components/sidebar/SidebarSkeletonList.vue`; alternates assistant/user alignment):

```vue
<script setup>
defineProps({
  count: { type: Number, default: 4 },
})
</script>

<template>
  <div class="msg-skel" aria-hidden="true" data-testid="session-messages-skeleton">
    <div
      v-for="i in count"
      :key="i"
      class="msg-skel-row"
      :class="i % 2 === 0 ? 'msg-skel-row--user' : 'msg-skel-row--assistant'"
    >
      <span class="msg-skel-bubble">
        <span class="msg-skel-line" />
        <span class="msg-skel-line msg-skel-line--short" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.msg-skel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem 0.25rem;
}

.msg-skel-row {
  display: flex;
}

.msg-skel-row--user {
  justify-content: flex-end;
}

.msg-skel-bubble {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 70%;
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius-lg);
  background: var(--color-surface-soft);
}

.msg-skel-row--user .msg-skel-bubble {
  background: var(--color-surface);
}

.msg-skel-line {
  display: block;
  height: 0.6rem;
  width: 16rem;
  max-width: 60vw;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  animation: msg-skel-pulse 1.4s ease-in-out infinite;
}

.msg-skel-line--short {
  width: 9rem;
}

@keyframes msg-skel-pulse {
  0% { opacity: 0.65; }
  50% { opacity: 0.35; }
  100% { opacity: 0.65; }
}

@media (prefers-reduced-motion: reduce) {
  .msg-skel-line { animation: none; }
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npm run test:unit -- --run messageListSkeleton`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/MessageListSkeleton.vue frontend/src/__tests__/messageListSkeleton.test.js
git commit -m "feat(sessions): WS3 message-area skeleton component

Detail-area shimmer placeholder mirroring SidebarSkeletonList, aria-hidden,
respects prefers-reduced-motion. Gated by detailLoading in the next task."
```

---

## Task 3: Optimistic header + skeleton wiring (SessionView)

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (header line 16; messages block 29-41; imports ~127; script computeds ~161)
- Test: `frontend/src/__tests__/sessionView.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('SessionView', ...)` block in `frontend/src/__tests__/sessionView.test.js` (after the `clears a prior 404 state` test). They drive `detailLoading`/`sessions` directly (matching the file's existing "set store state directly" style) and use a never-resolving `loadSession` spy to hold the loading snapshot:

```js
  it('paints the optimistic header topic from the known list row while detail loads', async () => {
    const store = useSessionStore()
    // Hold the loading snapshot: loadSession never resolves.
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.sessions = [{ id: 's2', topic: 'Thermodynamics' }]
    store.detailLoading = true
    const wrapper = mountView({ id: 's2' })
    await flushPromises()
    expect(wrapper.findComponent(SessionHeader).props('topic')).toBe('Thermodynamics')
  })

  it('shows the message skeleton while detailLoading and hides the empty state', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.detailLoading = true
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(true)
    // ChatEmptyState (and its quick prompts) must not render behind the skeleton.
    expect(wrapper.find('[data-testid="quick-prompt-0"]').exists()).toBe(false)
  })

  it('swaps skeleton for messages and shows the real topic once detail resolves', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(() => new Promise(() => {}))
    store.detailLoading = true
    const wrapper = mountView({ id: 's1' })
    await flushPromises()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(true)
    // Flip state the way the real loadSession would on resolve.
    store.detailLoading = false
    store.currentSession = { id: 's1', topic: 'Calculus', ended_at: null }
    store.currentSessionId = 's1'
    store.messages = [{ role: 'assistant', content: 'hi', message_id: 'm1', citations: [] }]
    await nextTick()
    expect(wrapper.find('[data-testid="session-messages-skeleton"]').exists()).toBe(false)
    expect(wrapper.findComponent(SessionHeader).props('topic')).toBe('Calculus')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run sessionView`
Expected: the 3 new tests FAIL — no skeleton testid exists, and the header prop reads from `store.currentSession?.topic` (`''` during load) instead of the list row.

- [ ] **Step 3: Import the skeleton**

In `frontend/src/views/SessionView.vue`, add the import next to the other `chat/` component imports (after line 127, `import MessageList ...`):

```js
import MessageList from '../components/chat/MessageList.vue'
import MessageListSkeleton from '../components/chat/MessageListSkeleton.vue'
```

- [ ] **Step 4: Add the optimistic-header computeds**

In the `<script setup>`, after `const canSend = ...` (line 163), add:

```js
// Optimistic header: while the detail fetch is in flight, store.currentSession
// still holds the PREVIOUS session (it is overwritten only after the await
// resolves), so paint the target session's topic from the already-known list
// row. View-local only — store.currentSession is never stubbed, which is what
// keeps this clear of the PR #72 switch-reload bug class.
const knownRow = computed(() => store.sessions.find((s) => s.id === props.id) || null)
const headerTopic = computed(() => {
  if (store.currentSession?.id === props.id) return store.currentSession.topic || ''
  return knownRow.value?.topic || ''
})
```

- [ ] **Step 5: Wire the header to `headerTopic`**

Replace line 16:

```vue
      <SessionHeader :topic="store.currentSession?.topic || ''" />
```

with:

```vue
      <SessionHeader :topic="headerTopic" />
```

- [ ] **Step 6: Show the skeleton in the messages area**

Replace the messages block (lines 29-41):

```vue
      <div ref="messagesEl" class="messages" :class="{ 'is-empty': !store.messages.length }" data-testid="session-messages">
        <ChatEmptyState
          v-if="!store.messages.length"
          :archived="isEnded"
          @quick-prompt="useQuickPrompt"
        />
        <MessageList
          v-if="store.messages.length || store.streamingMessage || awaitingResponse"
          :messages="store.messages"
          :streaming-message="store.streamingMessage"
          :awaiting="awaitingResponse"
        />
      </div>
```

with (skeleton replaces BOTH the empty-state and any stale messages during a load/switch):

```vue
      <div ref="messagesEl" class="messages" :class="{ 'is-empty': !store.messages.length }" data-testid="session-messages">
        <MessageListSkeleton v-if="store.detailLoading" />
        <template v-else>
          <ChatEmptyState
            v-if="!store.messages.length"
            :archived="isEnded"
            @quick-prompt="useQuickPrompt"
          />
          <MessageList
            v-if="store.messages.length || store.streamingMessage || awaitingResponse"
            :messages="store.messages"
            :streaming-message="store.streamingMessage"
            :awaiting="awaitingResponse"
          />
        </template>
      </div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run sessionView`
Expected: PASS — the 3 new tests green AND all pre-existing SessionView tests still green (they spy `loadSession` to resolve, leaving `detailLoading` false → body renders as before; `headerTopic` returns `'Calculus'` because `currentSession.id === props.id`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionView.test.js
git commit -m "feat(sessions): WS3 optimistic header + message skeleton on navigate

While the detail fetch is in flight, paint the target topic from the known
list row (view-local, never stubs store.currentSession) and show the message
skeleton instead of the previous session's stale content / empty-state
(fixes the load-time empty-state flash). Swaps to real detail on resolve."
```

---

## Task 4: Dev-only navigate-to-painted timing log

**Files:**
- Modify: `frontend/src/views/SessionView.vue` (`loadCurrent`, lines 241-253)
- Test: `frontend/src/__tests__/sessionView.test.js`

- [ ] **Step 1: Write the failing test**

Add inside `describe('SessionView', ...)`:

```js
  it('logs a dev-only navigate->painted timing after detail resolves', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'loadSession').mockImplementation(async () => { setupSession() })
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    mountView()
    await flushPromises()
    await nextTick()
    const logged = debugSpy.mock.calls.some((c) => String(c[0]).includes('[perf] session'))
    expect(logged).toBe(true)
    debugSpy.mockRestore()
  })
```

(Vitest runs with `import.meta.env.DEV === true` by default, so the dev branch fires.)

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run sessionView`
Expected: the new test FAILS — no `[perf] session` log is emitted.

- [ ] **Step 3: Add the timing log to `loadCurrent`**

Replace `loadCurrent` (lines 241-253):

```js
async function loadCurrent(id) {
  // Reset per-load so navigating away from a 404 session clears the state.
  notFound.value = false
  const startedAt = import.meta.env.DEV ? performance.now() : 0
  try {
    await store.loadSession(id)
    if (import.meta.env.DEV) {
      await nextTick()
      // Dev-only WS3 gate measurement: navigate -> detail painted. This number
      // decides whether the retention tail (warm prefetch + SWR cache) is worth
      // building (see Task 5). Remove once that decision is recorded.
      // eslint-disable-next-line no-console
      console.debug(`[perf] session ${id} detail painted in ${Math.round(performance.now() - startedAt)}ms`)
    }
  } catch (e) {
    if (e?.status === 404) {
      notFound.value = true
      store.setError(null)
    }
  }
  if (!isEnded.value && !notFound.value) focusComposer()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npm run test:unit -- --run sessionView`
Expected: PASS — timing test green; other tests still green (other tests emit a harmless `console.debug` line, no failures).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SessionView.vue frontend/src/__tests__/sessionView.test.js
git commit -m "feat(sessions): WS3 dev-only navigate->painted timing log

console.debug behind import.meta.env.DEV, measured navigate -> detail painted.
Produces the number that gates the retention tail (warm prefetch + SWR cache).
Removed once that decision is recorded."
```

---

## Task 5: Measurement gate — decide the retention tail

**Files:**
- Modify (decision record): `docs/superpowers/specs/2026-06-08-sessions-ux-and-performance-design.md` (WS3 section), and the project memory file.

This task is manual verification + a recorded decision. No production code unless the measurement says the tail is needed (then a follow-up plan, not this PR).

- [ ] **Step 1: Run the full frontend suite + lint**

Run (from `frontend/`):
```
npm run test:unit -- --run
npm run lint
```
Expected: all unit tests PASS; ESLint clean (the `no-console` line carries an inline disable).

- [ ] **Step 2: Start the app and open DevTools console**

Run (from `frontend/`): `npm run dev`
Open the app, sign in to the real account (the one with multiple sessions), open the browser DevTools console.

- [ ] **Step 3: Capture timings across several switches**

From the home page, open a session, then switch session→session via the sidebar 5-8 times across different sessions (mix of short and long histories, at least one ended session). Record each `[perf] session <id> detail painted in <N>ms` line.

- [ ] **Step 4: Confirm the qualitative behavior**

While switching, confirm:
- The header shows the target topic immediately (no flash of the previous session's topic).
- The message skeleton shows during load (no flash of the previous session's messages and no empty-state flash).
- Navigating to a deleted/invalid session still shows the 404 not-found state (no lingering optimistic header).
- The home page issues a single `GET /sessions` on load (Network tab: filter `sessions`, confirm one request, not two).

- [ ] **Step 5: Record the decision**

Apply the gate rule and write the outcome into the spec's WS3 section and the memory file `project_sessions_ux_perf.md`:
- **Median painted ≲ ~250ms and switching feels instant → CUT the retention tail.** Note "Cut 1 sufficient; warm prefetch + SWR cache not built" and remove the dev timing log (revert Task 4's `console.debug`, keep the rest).
- **Median painted notably high (≳ 500ms) or visible jank persists → tail may be warranted.** Do NOT build it in this PR; open a follow-up spec/plan for the retention tail (snapshot-per-id, invalidate on end/rename/reopen/answerCheck/stream-start, never serve mid-stream) and leave the timing log in until then.

- [ ] **Step 6: Commit the decision record**

```bash
git add docs/superpowers/specs/2026-06-08-sessions-ux-and-performance-design.md
git commit -m "docs(sessions): WS3 measurement outcome — record retention-tail decision"
```

(If the timing log was removed in Step 5, include `frontend/src/views/SessionView.vue` + its test in this commit and drop the timing test.)

---

## Final verification (before PR)

- [ ] From `frontend/`: `npm run test:unit -- --run` → all green.
- [ ] From `frontend/`: `npm run lint` → clean.
- [ ] Confirm no backend files changed (`git diff --stat dev`): WS3 is frontend-only; no OpenAPI / contract codegen.
- [ ] PR `feat/ws3-frontend-load-speed` → `dev`, summarizing Cut 1 + the recorded gate decision.

---

## Self-Review (spec coverage)

- Spec "in-flight-promise guard (de-dupes double GET /sessions + concurrent same-id loads)" → Task 1.
- Spec "optimistic render — view-local header from list row, never stubs store.currentSession; 404 → not-found" → Task 3 (404 path unchanged in `loadCurrent`).
- Spec "message skeleton on a detail-specific flag, not shared loading" → `detailLoading` (Task 1) + `MessageListSkeleton` (Task 2) + wiring (Task 3).
- Spec "dev-only timing log behind import.meta.env.DEV" → Task 4.
- Spec "Home issues one GET /sessions, not two" → covered by Task 1's concurrent-dedup test (the home double-fetch is exactly two concurrent `listSessions` calls) + Task 5 Step 4 Network-tab confirmation.
- Spec gated tail (warm prefetch + SWR cache) → explicitly out of scope; decided by Task 5.
- Type consistency: `detailLoading` ref, `headerTopic`/`knownRow` computeds, and the `session-messages-skeleton` testid are named identically across store, component, view, and tests.
