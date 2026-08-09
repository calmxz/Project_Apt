# E — User Workflows & Failure UX (QA audit, 2026-08-06)

Scope: `frontend/src/{views,stores,services,composables,router,utils,components}`.
`backend/routes/chat.py` and `backend/agent/tutor.py` read only to pin the SSE contract.

Method: **CODE-READ ONLY.** No browser was run, no dev server started, no LLM call made.
Every finding below is anchored to a file:line I opened in this session. Nothing here is an
observation of running software.

Excluded per brief (already fixed, verified still fixed): the upload-poll session-switch guard
(`SessionView.vue:722-772`, `uploadGen` idiom present), the "Technical details" raw-error block
(absent from `SessionView.vue`), and the `"[auto] "` prefix (stripped at `ProfileView.vue:203`
via `stripAutoPrefix`; no unstripped display path found).

---

## Flow x interruption matrix

Legend: `OK` = I read the guard that makes it safe. `E-nn` = finding. `—` = **not audited**
(no guard read either way; do not read as "safe").

| Flow | Refresh mid-flow | Back button | Rapid session switch | Double-click / double-submit | Offline / drop | Expired token |
|---|---|---|---|---|---|---|
| Signup | OK (stateless form) | OK (public route) | n/a | OK (`RegisterView.vue:76` `submitting`) | E-13 | n/a |
| Login | OK | OK (guard `router/index.js:139`) | n/a | OK (`LoginView.vue:59`) | E-13 | n/a |
| Password reset (request + set) | OK | OK | n/a | OK (`ResetPasswordView.vue:51`) | E-13 | E-13 |
| Onboarding / diagnostic gate | E-09 | E-09 (no escape) | n/a | OK (`OnboardingView.vue:85`) | E-09 | — |
| Start a session | E-01 | E-01 | OK (`useStartFlow.js:20,76` gen guard) | OK (`useStartFlow.js:17`) | E-01, E-19 | — |
| Send a message | OK (server persists, `tutor.py:541`) | OK (`abandonStream` on unmount, `SessionView.vue:438`) | OK (`_streamSid`, `session.js:684`) | OK (`session.js:803`, `Composer.vue:45`) | E-02, E-03 | E-05 |
| Stream a response | OK | OK | OK | n/a | E-02, E-03, E-04 | E-05 |
| Attach PDF + wait for ingestion | OK (banner re-polls on mount) | OK | OK (`uploadGen`, `SessionView.vue:722`) | OK (`Composer.vue:17` `uploading`) | E-07, E-15 | — |
| Answer a check-question | OK (`session.js:258` restores `pending_check`) | OK | OK | OK but silent (E-17) | E-17 | — |
| Resume / reopen a session | OK | OK | OK | OK (`SidebarSessionRow.vue:58`) | OK (store error + banner) | — |
| End a session | OK | OK | OK | OK (`SidebarSessionRow.vue:38`) | OK | — |
| Review queue | OK | OK | OK (`ReviewView.vue:79`) | OK (`ReviewView.vue:79`) | OK (empty state) | — |
| Settings edits | E-10 | E-10 (KeepAlive) | n/a | OK (`AccountTab.vue:28,97`) | E-10 | — |
| Logout | OK | OK (guard + `session.js:904` reset) | n/a | — | — (not audited) | n/a |

Cross-cutting, not a single flow: two-tab concurrency is covered by **E-11**; there is no
cross-tab state sync of any kind (see Unanchored U-1).

---

## Findings

### E-01 — A failed "Start" wipes the entire home start UI and leaves no way forward
- Severity: **High**
- Category: Bug
- Page/Area: HomeView / start flow
- Anchor: `frontend/src/views/HomeView.vue:5-10`, `frontend/src/views/HomeView.vue:107-109`, `frontend/src/composables/useStartFlow.js:69-89`, `frontend/src/stores/session.js:149-152`
- Evidence:
```vue
<p v-if="store.loading && !store.sessions.length" class="muted">Loading...</p>
<p v-else-if="store.error && !store.sessions.length" class="error" data-testid="home-error">
  {{ friendlyError(store.error) }}
</p>

<template v-else>
  <div class="quick" data-testid="home-mode-quick">
```
```js
function startQuick() {
  begin(quickTopic.value)   // not awaited, not caught
}
```
```js
// stores/session.js
function _setError(e) {
  error.value = friendlyError(e)
  throw e
}
```
- Steps to Reproduce:
  1. Sign in as a brand-new account (zero sessions), land on `/`.
  2. Type a topic and press **Start**.
  3. Backend returns 500 on `POST /api/sessions` (or the request hits the 30 s client timeout, `apiClient.js:11`).
  4. Click the sidebar's **New session** button to try again (it routes to `{name:'new-session'}` -> redirect -> `home`, `router/index.js:88-91`).
- Expected: an inline error next to the still-usable topic input, with the topic preserved and a retry.
- Actual: `store.error` becomes truthy while `store.sessions.length === 0`, so the `v-else-if`
  branch wins and the entire quick-start block — input, quick picks, and the Start button — is
  replaced by a bare error sentence with no control at all. The sidebar's **New session** button
  is a same-route push, so `HomeView` is not remounted and `onMounted`'s `listSessions()`
  (the only thing that clears `store.error`, `session.js:162`) never re-runs. The typed topic is
  gone too. Recovery exists but is non-obvious: navigate to `/review` or `/settings/profile`
  and back to `/`, or hard-reload.
- Impact: the primary CTA of the product becomes unusable after one transient backend failure,
  and the one escape hatch the UI offers (New session) is precisely the one that does not work.
- Fix: keep the start form mounted always; render start-failures into a local `startError` ref
  beside the input rather than gating the form on the global `store.error`. Also `await`/catch
  `begin()` in `startQuick` (see E-19).
- Confidence: CONFIRMED (code-read)

---

### E-02 — Mid-stream transport failure shows the raw browser error ("Failed to fetch") to the user
- Severity: **Medium**
- Category: Bug
- Page/Area: SessionView / chat streaming
- Anchor: `frontend/src/services/chatStreamService.js:58-61` vs `frontend/src/services/chatStreamService.js:91-105`, `frontend/src/stores/session.js:900`, `frontend/src/lib/errors.js:20`
- Evidence — the asymmetry is the bug. Header phase normalizes, body phase does not:
```js
  } catch (e) {                                     // line 58: HEADER phase
    if (e instanceof ApiError) throw e
    if (e?.name === 'TimeoutError') throw new ApiError(0, { detail: 'request timed out' }, path)
    throw e instanceof TypeError ? new ApiError(0, { detail: e.message }, path) : e
```
```js
  } catch (e) {                                     // line 93: BODY phase
    if (timedOut()) throw new ApiError(0, { detail: 'stream timed out' }, path)
    ...
    if (ctrl.signal.aborted) { ... }
    throw e                                         // line 105: raw TypeError escapes
  }
```
```js
// lib/errors.js
  if (err instanceof Error) return err.message     // line 20
```
- Steps to Reproduce:
  1. Open a session, send a message, wait until assistant tokens are visibly streaming.
  2. Kill the network (airplane mode / pull the cable) before the `done` event.
  3. `reader.read()` inside `parseSSEStream` rejects with a `TypeError` (`Failed to fetch` in Chromium, `NetworkError when attempting to fetch resource.` in Firefox).
- Expected: `Can't reach the server. Check your connection and try again.` — the copy that already exists at `errors.js:6` for `status === 0`.
- Actual: the `TypeError` reaches `session.js:900` `_setError(e)`. `friendlyError` finds no
  `.status` property, falls through every numeric branch, and hits line 20 — the raw browser
  string is written to `store.error` and rendered verbatim in the session error banner
  (`SessionView.vue:93`).
- Impact: an ordinary Wi-Fi blip produces developer-console text in the chat UI.
- Fix: mirror line 61 in the body-phase catch: `throw e instanceof TypeError ? new ApiError(0, { detail: e.message }, path) : e`. One line.
- Confidence: CONFIRMED (code-read; the exact `TypeError.message` string is browser-dependent, the leak is not)

---

### E-03 — Streamed partial answer is discarded on a transport failure even though the server keeps it
- Severity: **Medium**
- Category: Bug
- Page/Area: SessionView / chat streaming
- Anchor: `frontend/src/stores/session.js:869-901` (esp. 897-900), compare `frontend/src/stores/session.js:771-784`, `backend/agent/tutor.py:540-561`
- Evidence:
```js
      if (e?.status === 429) _applyCapError(e?.body?.detail)
      streamingMessage.value = null      // partial text thrown away
      streamState.value = 'idle'
      abortController.value = null
      _setError(e)
```
Contrast the SSE-`error`-event path, which deliberately keeps it:
```js
  function handleAbortError(code) {
    ...
    if (streamingMessage.value.content) {
      const status = PARTIAL_ABORT_CODES.has(code) ? 'partial' : 'error'
      messages.value.push({ ...streamingMessage.value, status })
    }
```
And the server does persist it on client disconnect:
```python
            msg_id = _persist_assistant_message(
                ctx, accumulated_text, "cancelled",
                cancelled_at=datetime.now(timezone.utc), ...
```
- Steps to Reproduce:
  1. Send a message; let ~200 words of the answer stream in.
  2. Drop the network (or let the 60 s SSE idle timeout fire, `chatStreamService.js:10`).
  3. Read the transcript. Then reload the page.
- Expected: the partial answer stays on screen, marked interrupted — exactly what the SSE-error path already does.
- Actual: the half-written assistant bubble vanishes on the failure, leaving only the user's
  message and an error banner. After a reload the same partial answer reappears (the backend
  wrote it with status `cancelled`), so the transcript silently changes between two views of the
  same session.
- Impact: the learner watches content disappear, then sees it return after a refresh. Both the
  loss and the resurrection are confusing; the loss is avoidable.
- Fix: in the `catch`, before clearing, apply the same rule as `handleAbortError`: if
  `streamingMessage.value.content` is non-empty, push it into `messages` with status `error`.
- Confidence: CONFIRMED (code-read)

---

### E-04 — SSE `error` events without a `message` render the raw backend error code as user copy
- Severity: **Medium**
- Category: UX
- Page/Area: SessionView error banner
- Anchor: `frontend/src/stores/session.js:856` (identical line at `frontend/src/stores/session.js:640`), `frontend/src/views/SessionView.vue:93`, `backend/agent/tutor.py:510`
- Evidence — client:
```js
            case 'error':
              sawTerminal = true
              _applyCapError(data)
              if (!_streamSuperseded()) error.value = data.message || data.code
              handleAbortError(data.code)
```
Server — no `message` key on this event:
```python
        yield StreamEvent("error", {"code": "max_iters_reached"})
```
(`daily_cost_cap_reached` at `tutor.py:182-190` likewise carries no `message`; only
`llm_failed` at `tutor.py:605-611` supplies one.)
- Steps to Reproduce:
  1. Ask a question that makes the tutor exhaust its tool-iteration budget (`max_iters`).
  2. The stream ends with `event: error` / `data: {"code":"max_iters_reached"}`.
  3. Read the red banner above the composer.
- Expected: "The tutor ran out of steps on that one — try narrowing the question."
- Actual: the banner reads literally **`max_iters_reached`**. `SessionView.vue:93` passes it
  through `friendlyError`, which returns non-`ApiError` strings unchanged (`errors.js:21`),
  so there is no second line of defence. The cost-cap variant additionally renders
  `daily_cost_cap_reached` in the banner *at the same time* as the correctly-worded
  `CapBanners` alert — two contradictory messages for one event.
- Impact: internal identifiers surface as product copy at exactly the moment the user needs a
  clear next action.
- Fix: add a `code -> copy` map next to `mapCapError` (`lib/capErrors.js`) and use
  `error.value = data.message || copyFor(data.code) || 'Something interrupted the tutor. Try again.'`.
  Suppress the banner entirely when `_applyCapError` already claimed the event.
- Confidence: CONFIRMED (code-read)

---

### E-05 — A hard 401 mid-send silently destroys the message the user just typed
- Severity: **High**
- Category: Bug
- Page/Area: Auth session expiry / SessionView composer
- Anchor: `frontend/src/services/apiClient.js:82-104`, `frontend/src/services/chatStreamService.js:66-72`, `frontend/src/stores/session.js:869-874`, `frontend/src/stores/session.js:904-925`, `frontend/src/views/SessionView.vue:591-607`
- Evidence:
```js
export async function _onAuthExpired() {
  ...
      await store.signOut()      // -> onAuthStateChange -> setActiveUser(null)
```
```js
  function setActiveUser(uid) {                 // stores/user.js:36
    ...
    useSessionStore().reset()                   // currentSessionId -> null
```
```js
  } catch (e) {                                 // stores/session.js:869
    deltaBatcher.flush()
    if (_streamSuperseded()) {                  // _streamSid !== null-ed currentSessionId
      _clearStreamState()
      return                                    // resolves, does NOT throw
    }
```
```js
  try {                                          // SessionView.vue:598
    await store.sendMessageStreaming({ text })
    lastSentText.value = ''                      // reached: draft NOT restored
  } catch (e) {
    draft.value = text
```
- Steps to Reproduce:
  1. Leave a session tab open long enough (or suspend the machine) for the Supabase refresh token to be rejected.
  2. Type a long message and press Enter.
  3. `_fetchSse` gets 401, retries once with a refreshed token, gets 401 again -> `_onAuthExpired()` -> `signOut()` -> `setActiveUser(null)` -> `sessionStore.reset()` sets `currentSessionId = null`.
  4. The thrown `ApiError` reaches `sendMessageStreaming`'s catch, where `_streamSuperseded()` is now **true** (because `reset()` nulled `currentSessionId`, not because the user navigated), so the function **returns instead of throwing**.
- Expected: bounce to `/login`, and on return either the draft is restored or the message was queued.
- Actual: `send()`'s success path runs — `lastSentText` is cleared and `draft` (already emptied
  at `SessionView.vue:594`) is never restored. The user lands on `/login?redirect=/session/:id`,
  signs back in, returns to the session, and their message is simply gone. Nothing was persisted
  server-side either (the POST 401'd).
- Impact: silent loss of user-authored content on a routine auth event. The redirect-preservation
  work at `apiClient.js:97-100` gets the user back to the right screen but with an empty composer.
- Fix: persist the draft before the send (e.g. `sessionStorage` keyed by session id) and rehydrate
  it in `loadCurrent`; clear it only on a confirmed `done`. Independently, distinguish "superseded
  by navigation" from "store was reset by sign-out" so the catch does not take the silent-return arm.
- Confidence: CONFIRMED on the code path (reachability depends on the refresh token actually being dead, which is the normal end state of a long-idle tab)

---

### E-06 — Sessions library dumps the raw API error envelope into the page, alongside a clean toast
- Severity: **Medium**
- Category: UX
- Page/Area: SessionsLibraryView
- Anchor: `frontend/src/views/SessionsLibraryView.vue:74-79`, `frontend/src/views/SessionsLibraryView.vue:231-233`, `frontend/src/stores/session.js:100-111`, `frontend/src/services/apiClient.js:15`
- Evidence:
```js
  } catch (e) {
    if (seq !== _loadSeq) return
    error.value = e?.message || 'Failed to load sessions'
  }
```
```vue
    <p v-else-if="error && !items.length" class="error" data-testid="library-error">
      {{ error }}
    </p>
```
`ApiError.message` is constructed as:
```js
    super(`API ${status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
```
- Steps to Reproduce:
  1. Click any sidebar **View all N** link to reach `/sessions`.
  2. Backend returns 500 on `GET /api/sessions/library`.
- Expected: one message, in product English, with a Retry control.
- Actual: two simultaneous surfaces that disagree in register. `store.fetchLibrary`
  (`session.js:104`) calls `getSessionLibrary(params)` with **no** `{ silent: true }`, so
  `request()` fires `reportApiError` and `App.vue:45-49` toasts the friendly
  `"Something went wrong on our side. Try again shortly."` — while the page body simultaneously
  renders `API 500 /sessions/library: {"detail":{"code":"internal_error"}}`. There is no Retry
  button on the initial-load failure: `retryLoad` (line 146) delegates to `loadMore`, which is
  wired only to the infinite-scroll sentinel and returns early when `items` is empty.
- Impact: raw internal path + error code shown to end users; a dead screen whose only control is
  "Back to home".
- Fix: `error.value = friendlyError(e)` and add a Retry button to the empty-state error branch.
  Note also that `store.libraryError` (`session.js:88,106`) is written but rendered nowhere in
  `src/` (grep confirms only `stores/session.js` and its unit test) — dead state that should be
  used or removed.
- Confidence: CONFIRMED (code-read)

---

### E-07 — One failed ingestion poll permanently hides the reference list and its delete controls
- Severity: **Medium**
- Category: Bug
- Page/Area: SessionView / ReferenceStatusBanner
- Anchor: `frontend/src/components/chat/ReferenceStatusBanner.vue:84-97`, `frontend/src/components/chat/ReferenceStatusBanner.vue:2-7`
- Evidence:
```js
async function poll(gen) {
  if (stopped || gen !== generation) return
  try {
    const res = await getSessionIngestion(props.sessionId)
    if (stopped || gen !== generation) return
    status.value = res?.status ?? null
    documents.value = res?.documents ?? []
  } catch {
    // Transient; keep the last known state and retry on the next tick.
  }
  if (!stopped && gen === generation && status.value === 'pending') {
    timer = setTimeout(() => poll(gen), 2000)
  }
}
```
- Steps to Reproduce:
  1. Open a session that already has 3 indexed reference files.
  2. The mount-time `GET /api/sessions/:id/ingestion` fails once (transient 502, or the network is briefly down as the tab regains focus).
  3. Stay on the session.
- Expected: retry, or a visible "couldn't load your files — retry" affordance.
- Actual: the comment promises a retry "on the next tick", but the scheduling line requires
  `status.value === 'pending'` — after a first-poll failure `status` is still `null`, so **no
  timer is ever set** and polling stops permanently. The whole banner is `v-if="status"`
  (line 3), so it does not render at all: the user has no indication their references exist,
  and the per-file delete buttons (lines 25-33) are unreachable. Only a session switch
  (`watch(() => props.sessionId, refresh)`, line 132) or a successful upload
  (`SessionView.vue:726`) revives it.
- Impact: uploaded references appear to have vanished, and the only document-delete UI in the
  product becomes inaccessible for the life of the view.
- Fix: schedule the retry on failure too — track a `failed` flag and retry with backoff while
  `status === null || status === 'pending'`; render a compact "references unavailable — retry"
  row when the first poll fails.
- Confidence: CONFIRMED (code-read)

---

### E-08 — Profile items delete with no confirm, no undo, and a rapid second delete is silently swallowed
- Severity: **Medium**
- Category: Bug
- Page/Area: ProfileView (session profile)
- Anchor: `frontend/src/views/ProfileView.vue:286-333`, `frontend/src/views/ProfileView.vue:123-131`, `frontend/src/views/ProfileView.vue:56-58`
- Evidence:
```js
async function _applyWrite(fn) {
  conflict.value = false
  writeError.value = ''
  try {
    const res = await fn()
    ...
  } catch (e) {
    if (e?.status === 412) {
      conflict.value = true
      await load()
```
```vue
              <button type="button" class="chip-x" data-testid="chip-remove"
                :aria-label="`Remove ${c.name}`"
                @click="removeItem('mastered_concepts', c.name)">
```
- Steps to Reproduce:
  1. Open `/session/:id/profile` with 3+ mastered concepts listed.
  2. Click the x on concept A, then within ~300 ms click the x on concept B.
  3. Read the page.
- Expected: both removed, or the second click blocked with a visible busy state; and a confirm
  or undo for a destructive, unrecoverable edit.
- Actual: (a) There is no confirmation and no undo — one stray click permanently deletes a
  mastery record the tutor uses for adaptivity. Compare the document delete, which *does* confirm
  (`ReferenceStatusBanner.vue:108-129`). (b) `_applyWrite` has no in-flight guard and every write
  reads `etag.value` at call time, so B's `DELETE` carries A's now-stale ETag -> 412 -> the handler
  sets `conflict` and silently reloads. The user sees only
  `"Profile changed elsewhere — reloaded with the latest."` (line 57) — B is still present, and
  the message blames a phantom other client. The same race applies to both **Add** buttons
  (lines 143-151, 187-195) and the level pills (lines 31-41), none of which disable during a write.
- Impact: destructive edits with no safety net, plus a class of edits that appear to fail for a
  reason that is factually wrong.
- Fix: add a `writing` ref, disable all mutating controls while it is true, and chain writes so
  each uses the ETag returned by the previous one. Add a confirm (or a 5-second undo toast) to
  `removeItem` / `removeSubtopic`.
- Confidence: CONFIRMED (code-read)

---

### E-09 — Onboarding is an inescapable gate; a `/me` failure traps an existing user on a new device
- Severity: **High**
- Category: Bug
- Page/Area: Router guard / OnboardingView
- Anchor: `frontend/src/router/index.js:143-167`, `frontend/src/stores/user.js:77-98`, `frontend/src/views/OnboardingView.vue:84-101`, `frontend/src/router/index.js:56-60`
- Evidence:
```js
  if (
    auth.isAuthenticated &&
    !user.onboardingComplete &&
    to.name !== 'onboarding' &&
    to.name !== 'reset-password'
  ) {
    return { name: 'onboarding' }
  }
```
```js
  async function hydrateFromServer() {
    ...
    } catch {
      // Offline / API down: keep the localStorage snapshot already loaded.
    } finally {
      hydrated.value = true
    }
```
- Steps to Reproduce:
  1. Existing user with `onboarding_complete = true` on the server signs in on a *new* browser (no `crux:user:v1:<uid>` in localStorage).
  2. `GET /api/me` fails (backend down, or offline).
  3. `hydrateFromServer` swallows the error, `onboardingComplete` stays `false`, `hydrated` is set `true` so it never retries.
  4. Try to reach any route.
- Expected: an error state that lets the user retry or sign out; onboarding is not re-forced on an existing account because of one failed GET.
- Actual: the guard redirects every route to `/onboarding`. `/onboarding` has
  `meta: { sidebar: false }` (`router/index.js:59`) so the app shell — and with it the only route
  to Settings, and therefore the **only Sign out button in the product**
  (`AccountTab.vue:108`) — is not rendered. `OnboardingView` has no back link, no skip, and no
  sign-out. Its **Begin** button `PATCH /me`s against the same dead backend and fails
  (`OnboardingView.vue:97` shows `friendlyError`). The user is pinned on a single screen with one
  button that cannot succeed, and cannot even sign out to switch accounts.
- Impact: a backend blip during sign-in on a new device is indistinguishable from a total lockout;
  the user has no action available except waiting.
- Fix: (a) treat a *failed* hydrate differently from a successful "onboarding not complete" — do
  not force-route onboarding when `hydrateFromServer` threw; (b) render a Sign out link on
  `OnboardingView` so the gate is always escapable.
- Confidence: CONFIRMED (code-read)

---

### E-10 — Settings Profile and Usage tabs cannot be retried after a failed load
- Severity: **Medium**
- Category: UX
- Page/Area: SettingsView / ProfileTab / UsageTab
- Anchor: `frontend/src/views/SettingsView.vue:42-44`, `frontend/src/components/settings/ProfileTab.vue:225-236`, `frontend/src/components/settings/ProfileTab.vue:14`, `frontend/src/components/settings/UsageTab.vue:8-10`, `frontend/src/components/settings/UsageTab.vue:25-34`
- Evidence:
```vue
        <KeepAlive>
          <component :is="activeComponent" />
        </KeepAlive>
```
```js
async function load() {          // ProfileTab, onMounted only
  loading.value = true
  error.value = ''
  try { data.value = await getAggregateProfile() }
  catch (e) { error.value = friendlyError(e) }
  loading.value = false
}
onMounted(load)
```
```vue
    <p v-else-if="error" class="muted" data-testid="usage-error">
      Usage data is unavailable right now.
    </p>
```
- Steps to Reproduce:
  1. Open `/settings/profile`; `GET /api/profile/aggregate` fails once.
  2. Click the **Usage** tab, then click **Profile** again.
  3. Repeat with the Usage tab (`GET /api/usage/summary`).
- Expected: a Retry button, or at minimum a refetch when the tab is re-selected.
- Actual: both tabs load exactly once, in `onMounted`, with no retry control. Because
  `SettingsView` wraps the panel in `<KeepAlive>`, switching tabs away and back **re-activates the
  cached instance without re-mounting**, so the load never re-runs. The error state is sticky for
  the entire life of the page; only a full browser reload clears it. Usage's copy ("Usage data is
  unavailable right now.") states a fact and offers nothing; Profile's is a bare `friendlyError`
  paragraph with no control.
- Impact: a one-off network hiccup makes a whole settings tab permanently blank.
- Fix: add a Retry button bound to `load()`, and/or use `onActivated` alongside `onMounted` so a
  KeepAlive re-activation refetches when the previous attempt errored.
- Confidence: CONFIRMED (code-read)

---

### E-11 — Session ended in another tab: the typed message is discarded without ever telling the user
- Severity: **Medium**
- Category: Bug
- Page/Area: SessionView composer / multi-tab
- Anchor: `frontend/src/stores/session.js:888-895`, `frontend/src/views/SessionView.vue:591-607`, `backend/routes/chat.py:172`
- Evidence:
```js
      if (e?.status === 409 && e?.body?.detail?.code === 'session_ended') {
        error.value = 'This session was ended elsewhere. Reopen it to continue.'
        if (currentSession.value) currentSession.value.ended_at = new Date().toISOString()
        streamingMessage.value = null
        streamState.value = 'idle'
        abortController.value = null
        return                       // resolves; SessionView.send() takes its success path
      }
```
- Steps to Reproduce:
  1. Open session X in tab A and tab B.
  2. In tab A, use the sidebar row menu, then End session.
  3. In tab B, type a long message into the composer and press Enter.
- Expected: the composer keeps the text so the user can reopen the session and re-send it.
- Actual: the backend 409s (`chat.py:172`, `{"code": "session_ended"}`). The store handles the
  409 gracefully (banner + ended state) but **returns rather than throws**, so
  `SessionView.send()` runs its success path: `lastSentText.value` is cleared, and `draft`
  (emptied at line 594 before the await) is never restored by the catch at line 602. The message
  is gone. The optimistic user bubble *is* correctly popped (`session.js:880-887`), which makes
  the loss total and invisible.
- Impact: cross-tab use silently eats user input. This is the one two-tab case the code explicitly
  anticipated, and it is the one that loses data.
- Fix: restore the draft in this arm before returning (or make this arm rethrow a typed error the
  view can catch). Same underlying gap as E-05; one shared draft-preservation helper fixes both.
- Confidence: CONFIRMED (code-read)

---

### E-12 — "End session" is destructive-adjacent and has no confirmation
- Severity: **Medium**
- Category: UX
- Page/Area: Sidebar row menu
- Anchor: `frontend/src/components/sidebar/SidebarRowMenu.vue:109-119`, `frontend/src/components/sidebar/SidebarSessionRow.vue:37-55`, `frontend/src/stores/session.js:325-372`
- Evidence:
```vue
      <button v-if="state === 'active'" type="button"
        class="sb-row-menu-item sb-row-menu-item--danger"
        data-testid="sidebar-row-menu-end" :disabled="busy"
        @click="onAction('end')">
        <i class="pi pi-flag" aria-hidden="true" />
        <span>End session</span>
      </button>
```
- Steps to Reproduce:
  1. Open the row-actions menu on any active sidebar row (items are stacked: Rename / Pin / End session).
  2. Click one row below the intended target.
- Expected: a confirm, matching the precedent already set for document delete
  (`ReferenceStatusBanner.vue:108-129` uses PrimeVue `confirm.require` with an explicit
  "Delete file" header and a danger accept class).
- Actual: the session ends immediately: it moves to the Ended tab, becomes read-only, and the
  backend runs a summary LLM call (which is why `apiClient.js:9-11` documents a 30 s budget
  specifically for end-session). It is the only danger-styled action in the app without a
  confirm. Recovery is possible (Resume topic, `SessionEndedBanner.vue:21-30`) but the summary
  spend is not refundable and the user must first find the Ended tab.
- Impact: a one-row misclick spends money and archives active work.
- Fix: route End through `useConfirm` with the same styling contract used for file delete.
- Confidence: CONFIRMED (code-read)

---

### E-13 — Auth screens surface raw Supabase SDK error strings
- Severity: **Medium**
- Category: UX
- Page/Area: LoginView / RegisterView / ForgotPasswordView / ResetPasswordView / AccountTab (Security card)
- Anchor: `frontend/src/views/LoginView.vue:120-126`, `frontend/src/views/RegisterView.vue:134-136`, `frontend/src/views/ForgotPasswordView.vue:81-83`, `frontend/src/views/ResetPasswordView.vue:90-92`, `frontend/src/components/settings/AccountTab.vue:209-213`
- Evidence:
```js
  } catch (e) {                                   // LoginView
    const msg = e?.message || 'Could not sign in. Try again.'
    error.value = msg
    if (/not confirmed/i.test(msg)) needsConfirm.value = true
  }
```
```js
  } catch (e) {                                   // ResetPasswordView
    error.value = e?.message || 'Could not update password. The link may have expired.'
  }
```
- Steps to Reproduce:
  1. Open `/reset-password` directly (bookmark, or a recovery link whose token has expired) and submit a new password. `supabase.auth.updateUser` rejects with an auth-session-missing error.
  2. Or: on `/forgot`, submit twice in quick succession and hit the Supabase per-email throttle.
  3. Or: on `/register`, submit an email that already exists.
- Expected: product copy. The fallback strings on the right-hand side of each `||` are already
  written and are perfectly good; they are simply never reached because `e.message` is almost
  always truthy.
- Actual: the SDK message is rendered verbatim, e.g. "Auth session missing!" (exclamation mark
  included), or "For security purposes, you can only request this after N seconds." The `||`
  fallbacks are effectively dead code. `LoginView` compounds this by string-matching on the same
  untranslated message (`/not confirmed/i`) to decide whether to show the resend affordance, so a
  copy change on Supabase's side would silently remove the user's only way to re-trigger a
  confirmation email.
- Impact: inconsistent voice on the highest-stakes screens; one behaviour (resend) is coupled to a
  third party's English wording.
- Fix: map the `AuthError` code/status to owned copy in one helper (mirroring `lib/errors.js`),
  and drive `needsConfirm` off the error code rather than a regex on prose.
- Confidence: CONFIRMED that the raw message is rendered (code-read); PLAUSIBLE on the exact strings, which come from Supabase

---

### E-14 — Retry silently clobbers edits the user made to the failed message
- Severity: **Low**
- Category: Bug
- Page/Area: SessionView error banner
- Anchor: `frontend/src/views/SessionView.vue:609-613`, `frontend/src/views/SessionView.vue:591-607`, `frontend/src/views/SessionView.vue:94-102`
- Evidence:
```js
async function retryLastMessage() {
  if (!lastSentText.value) return
  draft.value = lastSentText.value      // overwrites whatever is in the composer now
  await send()
}
```
- Steps to Reproduce:
  1. Send a message; it fails (500). `send()`'s catch restores the original text into `draft` and shows the banner with a Retry button.
  2. Edit the restored text in the composer: shorten it, or fix the typo you just noticed.
  3. Click Retry.
- Expected: the message currently visible in the composer is sent.
- Actual: `draft` is overwritten with `lastSentText` (the original, pre-edit text) and that is what
  gets sent. The user's edits are discarded with no warning and no visible transition, because the
  composer clears at line 594 immediately afterwards.
- Impact: small but genuinely surprising; a user correcting a message that failed will send the
  uncorrected one.
- Fix: `retryLastMessage` should send `draft.value` when it is non-empty, falling back to
  `lastSentText` only when the composer is empty.
- Confidence: CONFIRMED (code-read)

---

### E-15 — The upload banner and the reference banner give contradictory answers after 30 s
- Severity: **Low**
- Category: UX
- Page/Area: SessionView / UploadStatus vs ReferenceStatusBanner
- Anchor: `frontend/src/views/SessionView.vue:746-778` (esp. 774-777), `frontend/src/components/chat/ReferenceStatusBanner.vue:64-75`, `frontend/src/views/SessionView.vue:113-115`
- Evidence:
```js
  uploadStatus.value = {
    kind: 'pending',
    text: `${filename} is still processing. You can keep asking while it finishes.`,
  }
```
- Steps to Reproduce:
  1. Upload a large PDF whose ingestion takes longer than 30 s (the poll loop is 30 iterations at 1 s, line 747).
  2. Wait a further minute without navigating away.
- Expected: one authoritative status line that eventually says ready.
- Actual: `pollUploadStatus` gives up and freezes `uploadStatus` on the "still processing" sentence
  permanently; nothing ever clears or updates it. Meanwhile `ReferenceStatusBanner` keeps its own
  2 s poll running and flips to "N references ready." (line 72). The two banners are stacked
  adjacently in the template (lines 113-115) and now contradict each other.
- Impact: the user is told the file is both still processing and ready at the same time, in two
  boxes one above the other.
- Fix: drop the terminal `uploadStatus` write and let `ReferenceStatusBanner` own steady-state
  ingestion status; `UploadStatus` should only cover the transfer itself.
- Confidence: CONFIRMED (code-read)

---

### E-16 — "Danger zone / Reset removes your local profile" does nothing of the sort
- Severity: **Low**
- Category: UX
- Page/Area: Settings, Account tab
- Anchor: `frontend/src/components/settings/AccountTab.vue:114-130`, `frontend/src/stores/user.js:114-119`, `frontend/src/views/OnboardingView.vue:72-77`
- Evidence:
```vue
  <section class="danger" data-testid="settings-danger">
    <h2 class="card-title danger-title">Danger zone</h2>
    <p class="danger-text">
      Reset removes your local profile and runs onboarding again. Sessions on the server stay put.
    </p>
    <router-link to="/onboarding?retake=1" class="danger-link" ...>
      <span>Retake onboarding</span>
```
- Steps to Reproduce:
  1. Go to `/settings/account`, read the red "Danger zone" copy, hesitate, then click "Retake onboarding".
- Expected (per the copy): local profile wiped, onboarding restarted from blank.
- Actual: the link is a plain navigation. `resetOnboarding()` (`user.js:114`) is exported but
  **called from nowhere in `src/`** — a repo-wide grep finds it only in `stores/user.js` and its
  unit test. `OnboardingView` pre-fills both fields from the existing store values
  (`OnboardingView.vue:72,77`), so "retake" is a two-field edit form, not a reset. Nothing is
  removed and nothing is dangerous.
- Impact: the scariest-looking control in Settings is the mildest one; users who actually want a
  reset do not get one, and users who fear one are deterred from a harmless edit.
- Fix: either relabel to "Redo onboarding" and move it out of the danger zone, or wire the link to
  call `resetOnboarding()` first and keep the copy honest.
- Confidence: CONFIRMED (code-read)

---

### E-17 — Check-question answers have no in-flight feedback; a second click vanishes
- Severity: **Low**
- Category: UX
- Page/Area: SessionView / CheckQuestion
- Anchor: `frontend/src/components/chat/CheckQuestion.vue:40-51`, `frontend/src/stores/session.js:515-535`, `frontend/src/views/SessionView.vue:863-869`
- Evidence:
```vue
        <button type="button" class="check-option" :class="optionClass(i)"
          data-testid="check-option" :disabled="answered"
          @click="emit('answer', i)">
```
```js
    if (checkAnswering.value) return          // silent early return
    checkAnswering.value = true
```
- Steps to Reproduce:
  1. On a slow connection, answer a check question.
  2. `answered` only becomes true once `POST /check/answer` returns, so the options stay enabled and unchanged for the whole round-trip.
  3. Click a different option while waiting.
- Expected: options disable (or show a pending state) the instant the first click lands.
- Actual: no visual change at all for the duration of the request. The second click is swallowed by
  `checkAnswering` with no feedback, so the user reasonably concludes the card is broken. If
  `answerCheck` then rejects, `item.status` stays `pending` and the error surfaces in the session
  banner (`SessionView.vue:863-869`), where `canRetry` is false (`lastSentText` is empty), so there
  is no Retry control and the user must guess to click the option again.
- Impact: a core interaction feels dead under latency.
- Fix: bind `:disabled="answered || busyAnswering"` and expose `store.checkAnswering` to the card so
  the pressed option shows a pending state.
- Confidence: CONFIRMED (code-read)

---

### E-18 — ProfileView never reloads when its `:id` changes (latent)
- Severity: **Low**
- Category: Bug
- Page/Area: ProfileView
- Anchor: `frontend/src/views/ProfileView.vue:344`, `frontend/src/views/ProfileView.vue:273-284`, `frontend/src/views/ProfileView.vue:264-267`
- Evidence:
```js
onMounted(load)     // no watch(() => props.id, load)
```
Compare the same problem, solved, in the sibling view:
```js
watch(() => props.id, (id) => { ... loadCurrent(id) })   // SessionView.vue:542-553
```
- Steps to Reproduce (reachability caveat below):
  1. Be at `/session/A/profile`.
  2. Navigate directly to `/session/B/profile` without an intervening component change, i.e. a client-side route change that keeps the `session-profile` component mounted.
  3. Read the page.
- Expected: session B's profile.
- Actual: Vue Router reuses the component for a same-name param-only navigation, `onMounted` does
  not re-fire, and the page keeps rendering session A's `data`/`etag` under session B's URL. The
  heading is worse than stale: `topicLabel` (line 264) resolves **B's** topic from the store, so
  the title and the body describe different sessions. Any edit then PATCHes session B with A's
  ETag, giving a 412 and the misleading "Profile changed elsewhere" notice (see E-08).
- Impact: none today (see caveat below); the cost is that the next feature to link between two session profiles inherits a silent wrong-session render plus a misleading 412 notice.
- **Reachability caveat, stated plainly:** I found no path in the current UI that produces this
  navigation. Every route into `session-profile` comes from `SessionHeader.vue:11-19` on a
  different component, and Back/Forward through history always passes through a `SessionView` entry
  in between. This is a latent defect that becomes live the moment a second link into
  `session-profile` is added; it is filed for that reason, not because a user can hit it today.
- Fix: `watch(() => props.id, load)`, plus a `_loadSeq` discriminator matching the idiom already
  used in `SessionsLibraryView.vue:54-79`.
- Confidence: PLAUSIBLE (code path CONFIRMED; user-reachability not established)

---

### E-19 — Failed session creation produces an unhandled promise rejection
- Severity: **Low**
- Category: Bug
- Page/Area: HomeView / useStartFlow
- Anchor: `frontend/src/views/HomeView.vue:107-109`, `frontend/src/composables/useStartFlow.js:15-38`, `frontend/src/composables/useStartFlow.js:79-88`
- Evidence:
```js
function startQuick() {
  begin(quickTopic.value)          // no await, no .catch()
}
```
```js
    } catch (e) {
      if (e?.status === 409 && ...) { ...; return }
      throw e                       // _create rethrows; begin() has try/finally only
    }
```
- Steps to Reproduce:
  1. Press Start on the home screen with the backend returning 500.
  2. Open the browser console.
- Expected: the rejection is handled where the UI reacts to it (the store already recorded the error).
- Actual: `_create` rethrows, `begin`'s try/finally has no catch, and `startQuick` neither awaits
  nor catches, so an unhandled promise rejection reaches the window. Every other call site of a
  rethrowing store action in this repo has a deliberate empty catch for exactly this reason
  (`ReviewView.vue:93-95` "F-45", `SessionsLibraryView.vue:25-27` "F-06",
  `SidebarSessionRow.vue:78-80` "F-06"). HomeView is the one that was missed.
- Impact: noise in error monitoring; masks the real failure signal.
- Fix: `startQuick` should call `begin(quickTopic.value).catch(() => {})`, matching the sibling call sites.
- Confidence: CONFIRMED (code-read)

---

### E-20 — The composer's Skip button is unreachable dead code
- Severity: **Low**
- Category: Bug
- Page/Area: SessionView / Composer
- Anchor: `frontend/src/stores/session.js:490-493`, `frontend/src/views/SessionView.vue:146`, `frontend/src/components/chat/Composer.vue:64-73`, `frontend/src/components/chat/Composer.vue:17`, `frontend/src/components/chat/Composer.vue:118-122`
- Evidence:
```js
  // Typing mid-batch is allowed (spec section 3), so the composer never locks on
  // an open check. Kept as a computed for the SessionView/Composer binding.
  const checkLocked = computed(() => false)
```
```vue
      <button v-if="locked" type="button" class="composer-skip"
        data-testid="composer-skip" aria-label="Skip this question"
        @click="emit('skip')">
```
- Steps to Reproduce:
  1. Trigger a check question; observe the composer.
- Expected: whatever the design intends.
- Actual: `checkLocked` is hard-coded false, so `locked` is always false. Three pieces of Composer
  behaviour are therefore permanently dead: the Skip button (line 64), the "Pick an answer above,
  or Skip..." placeholder (line 120), and the attach-button lock
  (`:disabled="disabled || uploading || locked"`, line 17). The `@skip` wiring in `SessionView`
  (line 150, to `onSkipCheck`) can never fire from this path.
- Impact: no user-facing breakage, but it is a live decoy for anyone reading or modifying the
  check-question flow, and it means the composer offers no skip affordance at all; the only Skip
  lives on the card (`CheckQuestion.vue:61-70`).
- Fix: delete the `locked` prop and its three branches, or make `checkLocked` reflect a real condition.
- Confidence: CONFIRMED (code-read)

---

## Dead ends and empty states (audit summary, no separate findings)

Checked, and adequate:
- Zero sessions: HomeView **is** the start screen; the sidebar's empty hint is gated correctly at `Sidebar.vue:186-199` (and `showViewAllActive`, line 179, deliberately guards the "1 session, 0 rendered rows" case).
- Zero review items: `ReviewView.vue:28-31` explains *why* it is empty and links home. Good copy.
- Zero library results: `SessionsLibraryView.vue:235-241` renders `EmptyState` with actionable subtext.
- Zero aggregate-profile sessions: `ProfileTab.vue:17-31` with a "Start your first session" CTA.
- 404 session: `SessionView.vue:3-13` has both a `BackButton` and an explicit home link.

Dead ends found: **E-01** (home start form removed), **E-09** (onboarding gate with no sign-out),
**E-06** (library error screen with no retry), **E-10** (settings tabs, KeepAlive-sticky error),
**E-07** (reference list unreachable).

## Missing confirmations (audit summary)

| Action | Confirm? | Undo? | Finding |
|---|---|---|---|
| Delete document | Yes (`ReferenceStatusBanner.vue:108-129`) | No | the good precedent |
| End session | **No** | Resume, manually, from the Ended tab | E-12 |
| Remove mastered concept / gap / subtopic | **No** | **No** | E-08 |
| Change password | Re-auth with current password (`AccountTab.vue:196`) | n/a | OK |
| Sign out with unsaved display name | **No** | No | see U-3 |
| Retake onboarding | No, and nothing to confirm | n/a | E-16 |
| Delete a session | n/a: the product has **no delete-session action at all** | | see U-4 |

---

## Unanchored improvements (opinionated; no single line to blame)

**U-1 — There is no cross-tab state sync whatsoever.** The only cross-tab mechanism in the app is
Supabase's `onAuthStateChange` (`stores/auth.js:33-37`). Two tabs on the same account keep entirely
independent `sessions`, `messages`, and `pendingCheck`. Messages sent in tab A never appear in tab B
until a reload; a check question answered in A leaves B's card live and clickable, and B's POST then
409s out-of-order. E-11 is the one case that was handled. A `BroadcastChannel('crux')` emitting
`{sessionId, event}` on send/end/answer, with the store invalidating `_inflight` and refetching the
open session, would close the whole class.

**U-2 — Streaming has no reconnect, only a timeout.** `SSE_IDLE_TIMEOUT_MS = 60000` is a give-up,
not a retry. A three-second tunnel loses the whole turn, and per E-03 the visible text with it. A
`Last-Event-ID`-style resume, or even a simple "the connection dropped, [Resume]" affordance that
re-fetches the session and shows the server's persisted partial, would turn the worst failure in the
product into a two-click recovery.

**U-3 — Unsaved input is never guarded anywhere.** No route leave-guard, no `beforeunload`, no
dirty-check: the composer draft, the Settings display name, the ProfileView "add a concept" inputs,
and the sidebar rename field all evaporate on navigation. One shared `useUnsavedGuard(dirtyRef)`
composable registered via `onBeforeRouteLeave` would cover all five.

**U-4 — There is no way to delete a session, ever.** Sessions can be ended, reopened, renamed, and
pinned, but never removed. For a study tool where the first few sessions are inevitably throwaway
experiments, the Ended tab becomes permanent clutter, and there is no privacy story for "I typed
something I regret". This is a product gap rather than a bug, but it is the most conspicuous missing
verb in the sidebar menu.

**U-5 — Too many clicks: reviewing a gap.** Getting from "I want to practise a weak concept" to an
actual question is: sidebar, then Review (only visible when `reviewTotal > 0`, `Sidebar.vue:317`),
then pick an item, then a new session is created, then land in chat and wait for the seeded turn.
The alternative is session, topic heading, profile, Review gaps, gap picker, back to the session.
Two long, non-obvious routes to the same place, and the shorter one hides its own entry point
exactly when a new user would go looking for it.

**U-6 — The session topic heading is the only link to the session profile,** and it is styled as a
heading (`SessionHeader.vue:11-19`; a `title` attribute is the only affordance hint). The richest
screen in the app (gaps, mastery, subtopic levels, learning events) sits behind an unlabelled click
on what reads as page furniture.

**U-7 — Cost/cap language leaks the billing model.** "Daily cost limit reached ($0.42 / $0.50)"
(`SessionView.vue:387`) tells a learner about dollars they are not spending. Phrase caps in units
the user owns: "you have used today's tutoring budget, resets at 12:00 AM".
