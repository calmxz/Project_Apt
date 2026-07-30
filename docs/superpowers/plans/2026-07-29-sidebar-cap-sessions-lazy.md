# Sidebar Server Cap + All Sessions Infinite Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the sidebar at 20 sessions per tab fetched server-side via the paginated library endpoint, add "View all" links into the (currently orphaned) `/sessions` page, move sidebar search server-side, and convert the page's prev/next pager to infinite scroll.

**Architecture:** The store's `listSessions()` is reimplemented over `GET /api/sessions/library` (two capped fetches — active + ended — merged into the existing `sessions` array so all optimistic mutations keep working). A new `pinned_activity` sort option guarantees pinned sessions land in the active top-20. `SessionsLibraryView.vue` accumulates pages via an IntersectionObserver sentinel.

**Tech Stack:** FastAPI + SQLAlchemy (backend), OpenAPI codegen contracts, Vue 3 + Pinia + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-29-sidebar-cap-sessions-lazy-design.md`

## Global Constraints

- No emojis in code or comments.
- Contract discipline: edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py` from repo root. CI enforces zero drift.
- Backend tests: from `backend/`: `pytest`. Single test: `pytest tests/test_foo.py::test_bar -v`.
- Frontend tests: from `frontend/`: `npm run test:unit -- --run`. Lint: `npm run lint`.
- Branch: `feat/sidebar-cap-lazy-sessions` (already created off dev; spec committed on it).
- Repo gotcha: use the native Grep tool for repo sweeps, not `rtk rg` (false-zero results).
- Frontend test files use existing mount/fixture helpers — when a step says "add test cases to `<file>`", reuse that file's existing mount helper and mock setup verbatim; the test bodies below show intent and assertions, adapt the mount call to the file's local idiom.
- The sidebar/store per-tab cap is the constant 20 — written as a named const `SIDEBAR_CAP` / `SIDEBAR_PAGE_LIMIT` where introduced, never a magic number repeated.

---

### Task 1: Backend `pinned_activity` sort on the library endpoint

**Files:**
- Modify: `docs/api/openapi.yaml:162` (sort enum)
- Modify: `backend/routes/sessions.py:269-315` (`list_session_library`)
- Regenerate: `backend/contracts/` via codegen
- Test: `backend/tests/test_sessions_perf.py`

**Interfaces:**
- Produces: `GET /api/sessions/library?sort=pinned_activity` — orders `pinned DESC`, then `coalesce(max(message.created_at), created_at) DESC`, then `id DESC`. All other params/behavior unchanged. Frontend tasks 2-4 rely on this sort value being accepted.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sessions_perf.py`. First extend the seeder (do not change existing call sites — new kwarg defaults to `False`):

```python
def _seed_simple(db, sid, topic, ended=False, activity=None, created=None, pinned=False):
    sess = SessionModel(id=sid, user_id=USER_ID, topic=topic, topic_profile_json="{}",
                        pinned=pinned,
                        ended_at=(datetime(2026, 6, 2, tzinfo=timezone.utc) if ended else None))
    # Pin created_at when given so last_activity fallback (created_at when a
    # session has no messages) is deterministic instead of defaulting to the
    # real clock — otherwise a "no activity" seed sorts by wall-time.
    if created is not None:
        sess.created_at = created
    db.add(sess)
    if activity is not None:
        db.add(ChatMessage(session_id=sid, role="user", content="x", created_at=activity))
    db.commit()
```

Then the new tests:

```python
def test_library_sort_pinned_activity_pins_first(client, db_session, seeded_user):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    # Unpinned but far more recently active than the pinned row.
    _seed_simple(db_session, "pa_unpinned_recent", "A",
                 created=base, activity=base + timedelta(days=20))
    # Pinned, stale activity: must still sort first.
    _seed_simple(db_session, "pa_pinned_stale", "B",
                 created=base, activity=base + timedelta(days=1), pinned=True)
    r = client.get(f"/api/sessions/library?sort=pinned_activity&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert ids == ["pa_pinned_stale", "pa_unpinned_recent"]


def test_library_sort_pinned_activity_orders_by_activity_within_groups(client, db_session, seeded_user):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    _seed_simple(db_session, "pa_p_old", "P old", created=base,
                 activity=base + timedelta(days=1), pinned=True)
    _seed_simple(db_session, "pa_p_new", "P new", created=base,
                 activity=base + timedelta(days=2), pinned=True)
    _seed_simple(db_session, "pa_u_old", "U old", created=base,
                 activity=base + timedelta(days=3))
    _seed_simple(db_session, "pa_u_new", "U new", created=base,
                 activity=base + timedelta(days=4))
    r = client.get(f"/api/sessions/library?sort=pinned_activity&user_id={USER_ID}")
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert ids == ["pa_p_new", "pa_p_old", "pa_u_new", "pa_u_old"]


def test_library_sort_pinned_activity_respects_status_and_limit(client, db_session, seeded_user):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    _seed_simple(db_session, "pa_active_pinned", "AP", created=base, pinned=True)
    _seed_simple(db_session, "pa_active_plain", "AA", created=base + timedelta(days=1))
    _seed_simple(db_session, "pa_ended", "E", created=base + timedelta(days=2), ended=True)
    r = client.get(
        f"/api/sessions/library?sort=pinned_activity&status=active&limit=1&user_id={USER_ID}"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2  # ended row excluded from total
    assert [i["id"] for i in body["items"]] == ["pa_active_pinned"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_sessions_perf.py -k pinned_activity -v`
Expected: 3 FAIL — 422 responses (`sort=pinned_activity` rejected by the `Literal`).

- [ ] **Step 3: Edit the OpenAPI contract, then codegen**

In `docs/api/openapi.yaml` line 162, change the sort enum:

```yaml
          schema: { type: string, enum: [last_activity, created, topic, pinned_activity], default: last_activity }
```

Then from repo root: `python backend/scripts/gen_contracts.py`
(The sort param is a query literal, not a schema — codegen may produce no diff; run it anyway so drift CI is provably clean.)

- [ ] **Step 4: Implement the sort branch**

In `backend/routes/sessions.py`, `list_session_library`:

1. Extend the signature literal:

```python
    sort: Literal["last_activity", "created", "topic", "pinned_activity"] = "last_activity",
```

2. Replace the existing `else:  # last_activity` block with a shared-subquery version handling both activity sorts:

```python
    if sort == "created":
        ordered = base.order_by(SessionModel.created_at.desc(), SessionModel.id.desc())
    elif sort == "topic":
        ordered = base.order_by(SessionModel.topic.asc(), SessionModel.id.asc())
    else:  # last_activity / pinned_activity: order by max(message.created_at), falling back to created_at
        last_act_sub = (
            select(
                ChatMessage.session_id.label("sid"),
                func.max(ChatMessage.created_at).label("la"),
            )
            .group_by(ChatMessage.session_id)
            .subquery()
        )
        activity_desc = func.coalesce(last_act_sub.c.la, SessionModel.created_at).desc()
        joined = base.outerjoin(last_act_sub, last_act_sub.c.sid == SessionModel.id)
        if sort == "pinned_activity":
            ordered = joined.order_by(SessionModel.pinned.desc(), activity_desc, SessionModel.id.desc())
        else:
            ordered = joined.order_by(activity_desc, SessionModel.id.desc())
```

(Check the actual pinned column name on `SessionModel` in `backend/db/models.py` before writing — the list contract exposes `pinned`; if the ORM attribute differs, use the ORM name.)

- [ ] **Step 5: Run the new tests, then the full backend suite**

Run: `pytest tests/test_sessions_perf.py -k library -v` — expect all library tests PASS (including the pre-existing `sort=garbage` 422 case).
Run: `pytest` — expect full suite green (3 known ambient-.env flakes acceptable).
Run from repo root: `git diff --stat backend/contracts/` — commit whatever codegen produced (possibly nothing).

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/routes/sessions.py backend/contracts backend/tests/test_sessions_perf.py
git commit -m "feat(be): pinned_activity sort on session library endpoint"
```

---

### Task 2: Store — `listSessions()` over the library endpoint

**Files:**
- Modify: `frontend/src/services/sessionsApi.js:24` (`getSessionLibrary` opts passthrough)
- Modify: `frontend/src/stores/session.js:77-94` (`listSessions`), `:744-759` (`reset`), returns block
- Test: `frontend/src/__tests__/sessionStore.test.js`, `frontend/src/__tests__/sessionsApi.test.js`

**Interfaces:**
- Consumes: Task 1's `sort=pinned_activity`.
- Produces: store refs `activeTotal: Ref<number>`, `endedTotal: Ref<number>` (exported from the store; Task 3 renders them). `listSessions()` keeps its exact signature and its `_inflight` `'list'`-key de-dupe; `sessions` array shape unchanged (`SessionListItem[]`). `getSessionLibrary(params, opts)` gains an optional second arg forwarded to `apiGet`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/sessionsApi.test.js`, add (reusing the file's existing apiClient mock):

```js
it('getSessionLibrary forwards opts to apiGet (silent boot loads)', async () => {
  await sessionsApi.getSessionLibrary({ status: 'active' }, { silent: true })
  expect(apiGet).toHaveBeenCalledWith('/sessions/library', { status: 'active' }, { silent: true })
})
```

In `frontend/src/__tests__/sessionStore.test.js`, add a describe block (mock `getSessionLibrary` alongside the file's existing sessionsApi mocks):

```js
describe('listSessions via library endpoint', () => {
  it('fetches active (pinned_activity) and ended (last_activity) pages, silent, merged in order', async () => {
    getSessionLibrary
      .mockResolvedValueOnce({ items: [{ id: 'a1' }, { id: 'a2' }], total: 30, limit: 20, offset: 0 })
      .mockResolvedValueOnce({ items: [{ id: 'e1' }], total: 25, limit: 20, offset: 0 })
    await store.listSessions()
    expect(getSessionLibrary).toHaveBeenCalledWith(
      { status: 'active', sort: 'pinned_activity', limit: 20, offset: 0 },
      { silent: true },
    )
    expect(getSessionLibrary).toHaveBeenCalledWith(
      { status: 'ended', sort: 'last_activity', limit: 20, offset: 0 },
      { silent: true },
    )
    expect(store.sessions.map((s) => s.id)).toEqual(['a1', 'a2', 'e1'])
    expect(store.activeTotal).toBe(30)
    expect(store.endedTotal).toBe(25)
  })

  it('dedupes by id when a session appears in both pages', async () => {
    getSessionLibrary
      .mockResolvedValueOnce({ items: [{ id: 'x' }], total: 1, limit: 20, offset: 0 })
      .mockResolvedValueOnce({ items: [{ id: 'x' }, { id: 'e1' }], total: 2, limit: 20, offset: 0 })
    await store.listSessions()
    expect(store.sessions.map((s) => s.id)).toEqual(['x', 'e1'])
  })

  it('de-dupes concurrent calls through the same in-flight promise', async () => {
    getSessionLibrary.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    const p1 = store.listSessions()
    const p2 = store.listSessions()
    expect(p1).toBe(p2)
    await p1
    expect(getSessionLibrary).toHaveBeenCalledTimes(2) // one active + one ended, not four
  })

  it('reset() clears totals', async () => {
    getSessionLibrary
      .mockResolvedValueOnce({ items: [], total: 7, limit: 20, offset: 0 })
      .mockResolvedValueOnce({ items: [], total: 3, limit: 20, offset: 0 })
    await store.listSessions()
    store.reset()
    expect(store.activeTotal).toBe(0)
    expect(store.endedTotal).toBe(0)
  })
})
```

Also update any existing `listSessions` tests in this file that mock `sessionsApi.listSessions` — they now mock `getSessionLibrary` (two resolved pages) instead. Keep their assertions about `loading`/`error` behavior intact.

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`: `npm run test:unit -- --run sessionStore sessionsApi`
Expected: new cases FAIL (`getSessionLibrary` not called / `activeTotal` undefined).

- [ ] **Step 3: Implement**

`frontend/src/services/sessionsApi.js` line 24:

```js
// params: { status?: 'all'|'active'|'ended', q?: string,
//           sort?: 'last_activity'|'created'|'topic'|'pinned_activity', limit?: number, offset?: number }
export const getSessionLibrary = (params, opts) => apiGet('/sessions/library', params, opts)
```

`frontend/src/stores/session.js` — near the top state block add:

```js
  // Server-capped sidebar page size; totals let the UI say "View all N".
  const SIDEBAR_PAGE_LIMIT = 20
  const activeTotal = ref(0)
  const endedTotal = ref(0)
```

Replace the body of `listSessions` (keep the `_inflight` shell exactly as-is):

```js
  async function listSessions() {
    if (_inflight.has('list')) return _inflight.get('list')
    const p = (async () => {
      loading.value = true
      error.value = null
      try {
        // Boot-path fire-and-forget (HomeView + Sidebar onMounted) — silent for
        // the same reason the old listSessions wrapper was (U-05): a background
        // load must never toast.
        const [activePage, endedPage] = await Promise.all([
          sessionsApi.getSessionLibrary(
            { status: 'active', sort: 'pinned_activity', limit: SIDEBAR_PAGE_LIMIT, offset: 0 },
            { silent: true },
          ),
          sessionsApi.getSessionLibrary(
            { status: 'ended', sort: 'last_activity', limit: SIDEBAR_PAGE_LIMIT, offset: 0 },
            { silent: true },
          ),
        ])
        const seen = new Set()
        const merged = []
        for (const item of [...activePage.items, ...endedPage.items]) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          merged.push(item)
        }
        sessions.value = merged
        activeTotal.value = activePage.total
        endedTotal.value = endedPage.total
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

In `reset()` add after `sessions.value = []`:

```js
    activeTotal.value = 0
    endedTotal.value = 0
```

In the store's return object, export `activeTotal` and `endedTotal` (alongside `sessions`).

The old `sessionsApi.listSessions` export stays (unused by the app after this task — do not delete; the backend route still exists and `apiWrappers`/e2e may reference it).

- [ ] **Step 4: Run the frontend suite and audit consumers**

Run: `npm run test:unit -- --run`
Expected: sessionStore + sessionsApi green. If `homeView`/`sidebar` tests fail because they mocked `sessionsApi.listSessions`, update those mocks to `getSessionLibrary` (two pages) — behavior contract for consumers is unchanged (`sessions` array, `loading`, `error`).
Audit: Grep `frontend/src` for `store.sessions` uses in `HomeView.vue` — confirm nothing depends on the array being the complete corpus (it renders recents and an error guard; if anything total-dependent turns up, STOP and report).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/stores/session.js frontend/src/__tests__/sessionStore.test.js frontend/src/__tests__/sessionsApi.test.js
git commit -m "feat(fe): listSessions via paginated library endpoint with totals"
```

(Include any consumer-test mock updates from Step 4 in this commit.)

---

### Task 3: Sidebar render cap + "View all" links

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (script: cap computeds; template: capped lists + links; style: `.sb-view-all`)
- Test: `frontend/src/__tests__/sidebar.test.js`

**Interfaces:**
- Consumes: Task 2's `activeTotal` / `endedTotal` store refs.
- Produces: testids `sidebar-view-all-active`, `sidebar-view-all-ended`; links route to `{ name: 'sessions-library', query: { status: <tab> } }`. Task 5 reads that query param.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/__tests__/sidebar.test.js` (reuse the file's mount helper; seed the store's `sessions` directly and set totals):

```js
describe('sidebar 20-row cap and View all links', () => {
  it('renders at most 20 active rows (pinned count toward the cap)', async () => {
    // seed 3 pinned + 25 unpinned active sessions, activeTotal = 28
    // assert: 3 pinned rows + 17 unpinned rows rendered (20 total)
    // assert: screen shows 'View all 28 sessions'
    //         via [data-testid="sidebar-view-all-active"]
  })

  it('caps the ended tab at 20 and links with status=ended', async () => {
    // seed 22 ended sessions, endedTotal = 40; switch statusFilter to ended
    // assert 20 rows rendered; [data-testid="sidebar-view-all-ended"] present,
    // its :to resolves to { name: 'sessions-library', query: { status: 'ended' } },
    // text contains '40'
  })

  it('hides View all when the tab total fits the rendered rows', async () => {
    // seed 5 active sessions, activeTotal = 5
    // assert no [data-testid="sidebar-view-all-active"]
  })

  it('ended tab badge shows the server total, not the loaded count', async () => {
    // seed 20 ended rows but endedTotal = 40
    // assert the Ended tab button text contains '(40)'
  })
})
```

Write these as real tests against the file's existing helpers — the comments above are the required behaviors and testids, not optional.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sidebar`
Expected: FAIL (no cap, no view-all testids).

- [ ] **Step 3: Implement**

`Sidebar.vue` script — destructure totals and add capped computeds after the `activeFlat` line (`:94`):

```js
const { sessions, loading, activeTotal, endedTotal } = storeToRefs(sessionStore)
```

```js
const SIDEBAR_CAP = 20

// Pinned rows render first and count toward the cap; server's pinned_activity
// sort already guarantees pinned rows are inside the fetched page.
const cappedActiveFlat = computed(() =>
  activeFlat.value.slice(0, Math.max(0, SIDEBAR_CAP - pinnedActive.value.length)),
)
const cappedEndedRows = computed(() => endedRows.value.slice(0, SIDEBAR_CAP))

const activeRendered = computed(() => pinnedActive.value.length + cappedActiveFlat.value.length)
const showViewAllActive = computed(() => activeTotal.value > activeRendered.value)
const showViewAllEnded = computed(() => endedTotal.value > cappedEndedRows.value.length)
```

Template changes:
1. Active list (`:325-332`): iterate `cappedActiveFlat` instead of `activeFlat`.
2. After the active section's closing `</section>` (`:345`), inside the `statusFilter === 'active'` template:

```html
            <RouterLink
              v-if="showViewAllActive"
              class="sb-view-all"
              :to="{ name: 'sessions-library', query: { status: 'active' } }"
              data-testid="sidebar-view-all-active"
              @click="closeDrawer"
            >
              View all {{ activeTotal }} sessions
            </RouterLink>
```

3. Ended list (`:350-351`): iterate `cappedEndedRows`; the `v-if`/empty-hint checks switch to `cappedEndedRows.length`. After the ended list `</ul>`, inside the ended section:

```html
            <RouterLink
              v-if="showViewAllEnded"
              class="sb-view-all"
              :to="{ name: 'sessions-library', query: { status: 'ended' } }"
              data-testid="sidebar-view-all-ended"
              @click="closeDrawer"
            >
              View all {{ endedTotal }} sessions
            </RouterLink>
```

4. Ended tab badge (`:264-266`): replace `endedRows.length` with `endedTotal` (both the `v-if` and the rendered count).
5. Collapsed icon rail (`:364`): iterate `[...pinnedActive, ...cappedActiveFlat, ...cappedEndedRows]`.

Style (append near `.sb-empty-hint`):

```css
.sb-view-all {
  display: block;
  padding: 0.375rem 0.75rem;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-accent-text);
  text-decoration: none;
  border-radius: var(--radius-md);
}

.sb-view-all:hover {
  background: var(--color-surface-soft);
  text-decoration: underline;
}

.sb-view-all:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: -2px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sidebar sidebarA11y sidebarMobileStrip`
Expected: PASS (fix any pre-existing sidebar tests that asserted uncapped row counts).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(fe): sidebar 20-row cap with View all links to session library"
```

---

### Task 4: Sidebar search goes server-side

**Files:**
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (script: search state/watch; template: search block renders server results)
- Test: `frontend/src/__tests__/sidebar.test.js`

**Interfaces:**
- Consumes: `getSessionLibrary(params, opts)` from Task 2.
- Produces: search results in local component state only — the store `sessions` array is never written by search. "View all" from search routes to `{ name: 'sessions-library', query: { status: <tab>, q: <query> } }`; Task 5 reads `q`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/__tests__/sidebar.test.js` (use `vi.useFakeTimers()` for the debounce; mock `getSessionLibrary` at the module level like other service mocks in the file):

```js
describe('sidebar server-side search', () => {
  it('debounces 250ms then queries the library endpoint scoped to the current tab', async () => {
    // type 'gly' into [data-testid="sidebar-search"]
    // advance timers 249ms -> no call; 1ms more -> called once with
    // { status: 'active', q: 'gly', sort: 'last_activity', limit: 20, offset: 0 }, { silent: true }
  })

  it('renders server results and total; store sessions array untouched', async () => {
    // resolve mock with { items: [{id:'r1'},{id:'r2'}], total: 12 }
    // assert 2 rows rendered, search count text contains '12'
    // assert store.sessions still equals its seeded value
  })

  it('shows View all with the query when total exceeds results', async () => {
    // total 12 > 2 results -> [data-testid="sidebar-view-all-search"] present,
    // :to resolves to { name: 'sessions-library', query: { status: 'active', q: 'gly' } }
  })

  it('drops stale responses (later query wins)', async () => {
    // fire 'aa' then 'bb'; resolve 'aa' AFTER 'bb' -> rendered rows are bb's
  })

  it('clearing the query restores the tab view without a fetch', async () => {
    // clear input -> no new library call, normal grouped view rendered
  })
})
```

Write these as real tests — the comments are required behaviors and testids.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sidebar`
Expected: FAIL (search is still client-side `filteredFlat`).

- [ ] **Step 3: Implement**

`Sidebar.vue` script:

1. Add import: `import * as sessionsApi from '@/services/sessionsApi.js'` (alongside `getReviewQueue` — the sidebar already calls services directly for its badge).
2. Stop destructuring `filteredFlat` and `matchCount` from `useSessionGroups` (line 91) — keep `searching`, `pinnedActive`, `activeGroups`, `endedRows` (the composable still blanks groups while searching, which the template relies on; the composable itself is NOT modified, its other export sites and tests stay valid).
3. Add search state + debounced watch after the `searchQuery` ref:

```js
const searchResults = ref([])
const searchTotal = ref(0)
const searchLoading = ref(false)
let searchTimer = null
let _searchSeq = 0

watch(searchQuery, (raw) => {
  if (searchTimer) clearTimeout(searchTimer)
  const q = (raw || '').trim()
  if (!q) {
    _searchSeq++ // invalidate any in-flight response
    searchResults.value = []
    searchTotal.value = 0
    searchLoading.value = false
    return
  }
  searchLoading.value = true
  searchTimer = setTimeout(async () => {
    const seq = ++_searchSeq
    try {
      // silent: a sidebar search must never toast; errors render as zero matches
      const page = await sessionsApi.getSessionLibrary(
        { status: statusFilter.value, q, sort: 'last_activity', limit: 20, offset: 0 },
        { silent: true },
      )
      if (seq !== _searchSeq) return // stale response; a newer query owns the state
      searchResults.value = page.items
      searchTotal.value = page.total
    } catch {
      if (seq !== _searchSeq) return
      searchResults.value = []
      searchTotal.value = 0
    } finally {
      if (seq === _searchSeq) searchLoading.value = false
    }
  }, 250)
})

onBeforeUnmount(() => clearTimeout(searchTimer))

const showViewAllSearch = computed(() => searchTotal.value > searchResults.value.length)
```

(The existing `onBeforeUnmount` at `:84` can absorb the `clearTimeout` — one hook, both cleanups.)

4. Template — replace the searching block (`:272-297`) contents:

```html
        <template v-if="searching">
          <p
            class="sb-search-count label"
            data-testid="sidebar-search-count"
            aria-live="polite"
            aria-atomic="true"
          >
            <template v-if="searchLoading">Searching...</template>
            <template v-else>{{ searchTotal }} {{ searchTotal === 1 ? 'match' : 'matches' }}</template>
          </p>
          <ul v-if="searchResults.length" class="sb-session-list">
            <SidebarSessionRow
              v-for="s in searchResults"
              :key="s.id"
              :session="s"
              :state="s.ended_at ? 'ended' : 'active'"
            />
          </ul>
          <p
            v-else-if="!searchLoading"
            class="sb-empty-hint"
            data-testid="sidebar-search-empty"
            aria-live="polite"
            aria-atomic="true"
          >
            No sessions match "{{ searchQuery }}".
          </p>
          <RouterLink
            v-if="showViewAllSearch"
            class="sb-view-all"
            :to="{ name: 'sessions-library', query: { status: statusFilter, q: searchQuery.trim() } }"
            data-testid="sidebar-view-all-search"
            @click="closeDrawer"
          >
            View all {{ searchTotal }} matches
          </RouterLink>
        </template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run sidebar sidebarA11y useSessionGroups`
Expected: PASS. Pre-existing sidebar search tests asserting client-side filtering must be rewritten against the mocked endpoint (same visible behavior: type, see rows). `useSessionGroups.test.js` must pass UNCHANGED — the composable is untouched.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sidebar/Sidebar.vue frontend/src/__tests__/sidebar.test.js
git commit -m "feat(fe): sidebar search queries library endpoint server-side"
```

---

### Task 5: All Sessions page — infinite scroll + route-query init

**Files:**
- Modify: `frontend/src/views/SessionsLibraryView.vue` (pager removed, sentinel + observer, append mode, query init)
- Test: `frontend/src/__tests__/sessionsLibraryView.test.js`

**Interfaces:**
- Consumes: `?status=` / `?q=` query params produced by Tasks 3-4; `store.fetchLibrary(params)` (unchanged).
- Produces: testids `library-sentinel`, `library-retry`. Pager testids `library-prev` / `library-next` and the range label are REMOVED.

- [ ] **Step 1: Add an IntersectionObserver mock helper and write the failing tests**

At the top of `frontend/src/__tests__/sessionsLibraryView.test.js` (module scope, alongside existing mocks):

```js
class MockIntersectionObserver {
  static instances = []
  constructor(cb, options) {
    this.cb = cb
    this.options = options
    this.observed = new Set()
    MockIntersectionObserver.instances.push(this)
  }
  observe(el) {
    this.observed.add(el)
  }
  unobserve(el) {
    this.observed.delete(el)
  }
  disconnect() {
    this.observed.clear()
  }
  trigger(isIntersecting = true) {
    this.cb([{ isIntersecting }])
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})
```

New test cases (reuse the file's mount helper and `fetchLibrary` mock; `lastObserver = () => MockIntersectionObserver.instances.at(-1)`):

```js
describe('infinite scroll', () => {
  it('appends the next page when the sentinel intersects', async () => {
    // page 1: items [s1..s20], total 45 -> mount, flush
    // trigger observer -> fetchLibrary called with offset 20; resolve [s21..s40]
    // assert 40 cards rendered, s1 still present (append, not replace)
  })

  it('does not fetch once all items are loaded', async () => {
    // total 20, 20 loaded -> trigger observer -> no new fetchLibrary call
  })

  it('does not double-fetch while a page is in flight', async () => {
    // trigger twice before resolving -> exactly one in-flight fetchLibrary call
  })

  it('filter change clears the list and refetches from offset 0', async () => {
    // load 2 pages (40 items), click library-filter-ended
    // -> fetchLibrary called with { status: 'ended', offset: 0 }; on resolve list is replaced
  })

  it('append error shows retry and pauses; retry resumes', async () => {
    // reject the append fetch -> [data-testid="library-retry"] visible;
    // trigger observer -> no fetch (paused); click retry -> fetch fires with same offset
  })

  it('stale response is dropped (race guard)', async () => {
    // start append (offset 20), then change filter (offset 0);
    // resolve the append AFTER the filter load -> list matches the filter load only
  })

  it('pager is gone', async () => {
    // no [data-testid="library-prev"], no [data-testid="library-next"]
  })
})

describe('route query init', () => {
  it('seeds status and q from the route query on mount', async () => {
    // mount with route query { status: 'ended', q: 'gly' }
    // -> first fetchLibrary call includes { status: 'ended', q: 'gly', offset: 0 }
    // -> the Ended filter button has aria-pressed true, search input value 'gly'
  })

  it('ignores an invalid status query value', async () => {
    // query { status: 'garbage' } -> first fetch uses status 'all'
  })
})
```

Write these as real tests — comments are required behaviors.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run sessionsLibraryView`
Expected: new cases FAIL; existing pager tests still pass (they die in Step 3).

- [ ] **Step 3: Implement**

`SessionsLibraryView.vue` script changes:

1. Imports: add `watch` to the vue import; add `useRoute`:

```js
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
```

2. Route-query init — replace the `status`/`q` ref initializers (`:39-41`):

```js
const route = useRoute()
const VALID_STATUSES = ['all', 'active', 'ended']
const status = ref(VALID_STATUSES.includes(route.query.status) ? route.query.status : 'all')
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const sort = ref('last_activity')
```

3. `load` gains an append mode (same `_loadSeq` race guard):

```js
let _loadSeq = 0
async function load({ append = false } = {}) {
  // F-15: discard out-of-order settles - same discriminator idiom as the
  // session store's _latestRequestedId.
  const seq = ++_loadSeq
  loading.value = true
  error.value = null
  try {
    const page = await store.fetchLibrary({
      status: status.value,
      q: q.value || undefined,
      sort: sort.value,
      limit: limit.value,
      offset: offset.value,
    })
    if (seq !== _loadSeq) return
    items.value = append ? [...items.value, ...page.items] : page.items
    total.value = page.total
    limit.value = page.limit
    offset.value = page.offset
  } catch (e) {
    if (seq !== _loadSeq) return
    error.value = e?.message || 'Failed to load sessions'
  } finally {
    if (seq === _loadSeq) loading.value = false
  }
}

function loadMore() {
  if (loading.value || error.value) return
  if (items.value.length >= total.value) return
  offset.value = items.value.length
  load({ append: true })
}

function retryLoad() {
  error.value = null
  loadMore()
}
```

4. Delete `hasPrev`, `hasNext`, `rangeLabel`, `nextPage`, `prevPage` (`:97-115`).

5. Observer wiring (after the control handlers):

```js
const sentinelEl = ref(null)
let observer = null

onMounted(() => {
  load()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    },
    { rootMargin: '200px' },
  )
})

// The sentinel is v-if'd with the list; (un)observe as it (un)mounts.
watch(sentinelEl, (el, prev) => {
  if (!observer) return
  if (prev) observer.unobserve(prev)
  if (el) observer.observe(el)
})

onUnmounted(() => {
  clearTimeout(searchTimer)
  if (observer) observer.disconnect()
  observer = null
})
```

(Replace the existing `onUnmounted(() => clearTimeout(searchTimer))` at `:118` with this combined hook. Keep `defineExpose({ load })`.)

6. Template — replace the whole pager `<nav>` (`:222-242`) with a sentinel that doubles as the loading/error row:

```html
    <div v-if="items.length" ref="sentinelEl" class="library-sentinel" data-testid="library-sentinel">
      <p v-if="loading" class="muted">Loading more...</p>
      <template v-else-if="error">
        <p class="error">{{ error }}</p>
        <button type="button" class="library-pg-btn" data-testid="library-retry" @click="retryLoad">
          Retry
        </button>
      </template>
      <p v-else-if="items.length >= total" class="muted library-end">
        {{ total }} {{ total === 1 ? 'session' : 'sessions' }}
      </p>
    </div>
```

7. Adjust the top-level loading/error paragraphs (`:172-173`) so they only own the EMPTY state (the sentinel owns them once items exist):

```html
    <p v-if="loading && !items.length" class="muted" data-testid="library-loading">Loading...</p>
    <p v-else-if="error && !items.length" class="error" data-testid="library-error">{{ error }}</p>
```

(The `EmptyState` `v-else-if` chain stays: it already requires `!items.length`. Note the list `<ul>`'s `v-else` chain must become `v-else-if="items.length"` so a populated list stays rendered while an append is in flight.)

8. Style — replace `.library-pager`/`.library-range` rules with:

```css
.library-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
  min-height: 2.5rem;
}

.library-end {
  font-size: var(--fs-caption);
}
```

(Keep `.library-pg-btn` — the Retry button reuses it.)

- [ ] **Step 4: Run tests, delete/rewrite pager tests**

Run: `npm run test:unit -- --run sessionsLibraryView`
Expected: new cases PASS; delete the prev/next pager test cases (they assert removed UI) and keep/adapt every other existing case — especially the F-15 race test, which must still pass.

- [ ] **Step 5: Run the full frontend suite + lint**

Run: `npm run test:unit -- --run` and `npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/__tests__/sessionsLibraryView.test.js
git commit -m "feat(fe): session library infinite scroll with route-query init"
```

---

### Task 6: Full verification gate

**Files:** none new — verification only.

- [ ] **Step 1: Full backend suite** — from `backend/`: `pytest`. Expected: green (3 known ambient-.env flakes acceptable).
- [ ] **Step 2: Full frontend suite + lint** — from `frontend/`: `npm run test:unit -- --run` and `npm run lint`. Expected: green.
- [ ] **Step 3: Contract drift check** — from repo root: `python backend/scripts/gen_contracts.py` then `git status --porcelain backend/contracts docs/api` — expect empty (zero drift).
- [ ] **Step 4: Grep sweep (native Grep, not rtk)** — no remaining references to `library-prev`, `library-next`, `rangeLabel`, or `filteredFlat` inside `Sidebar.vue`; `sessionsApi.listSessions(` has no remaining app call sites (tests/e2e may still reference the export).
- [ ] **Step 5: Report** — suites' pass counts, any deviations from plan, ready for review.

---

## Deferred (owed after merge — carry into PR body)

- Manual browser smoke: sidebar caps at 20, View all navigates with the right tab/query, infinite scroll appends on a corpus > 20, search hits the server (network tab), pinned stale session still visible in sidebar.
- Playwright e2e: any spec touching the library pager needs a sweep (`Grep` for `library-prev|library-next` under `frontend/e2e` — fix in a follow-up if found).
- `GET /api/sessions` deprecation decision (endpoint now unused by the app).
