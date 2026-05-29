# Home Recent-Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recent-activity feed to `HomeView` showing the 5 most-recent sessions (active-first, then ended) with per-session summary snippets, sourced from the existing aggregate-profile endpoint extended with one field.

**Architecture:** Contract-first. Add `last_session_summary` to the `RecentSessionSummary` schema in `openapi.yaml`, regenerate Pydantic contracts, populate it in `profile_service.aggregate_for_user`. Frontend `HomeView` fetches `getAggregateProfile()`, re-sorts `recent_topics` active-first, renders a feed; ended rows get a `Continue` button that reopens then navigates. The `New session` CTA moves from the header to a centered card below the feed.

**Tech Stack:** FastAPI + Pydantic v2 (codegen from OpenAPI), Vue 3 `<script setup>` + Pinia, Vitest + pytest.

**Spec:** [`docs/superpowers/specs/2026-05-29-home-recent-activity-feed-design.md`](../specs/2026-05-29-home-recent-activity-feed-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `docs/api/openapi.yaml` | API contract source of truth. Adds `last_session_summary` to `RecentSessionSummary`. | Modify |
| `backend/contracts/models.py` | Generated Pydantic models. **Do NOT hand-edit** — produced by `gen_contracts.py`. | Regenerated |
| `backend/services/profile_service.py` | `aggregate_for_user` populates the new field from each session's parsed profile. | Modify (~line 190) |
| `backend/tests/test_profile_aggregate.py` | Asserts the new field is populated for ended, null for active. | Modify |
| `frontend/src/views/HomeView.vue` | Renders the feed, moves CTA, fetches aggregate profile. | Modify |
| `frontend/src/__tests__/homeView.test.js` | Feed render / ordering / Continue / navigation tests. | Modify |

**Codegen warning:** `gen_contracts.py` nukes and recreates `backend/contracts/`. Never hand-edit `models.py`; edit `openapi.yaml` then regenerate.

---

## Task 0: Branch setup

Branch off `dev` (not the current `feat/sidebar-shell`) so this feature is independently reviewable and mergeable.

- [ ] **Step 1: Fetch and branch from `dev`**

```bash
git fetch origin
git switch -c feat/home-recent-feed origin/dev
```

Expected: new branch `feat/home-recent-feed` created from the latest `origin/dev`. If `origin/dev` is unavailable, fall back to local `dev`: `git switch -c feat/home-recent-feed dev`.

- [ ] **Step 2: Carry the spec + plan docs onto the new branch**

The spec and this plan were committed on `feat/sidebar-shell`, so they are absent from a branch cut off `dev`. Bring them over:

```bash
git checkout feat/sidebar-shell -- \
  docs/superpowers/specs/2026-05-29-home-recent-activity-feed-design.md \
  docs/superpowers/plans/2026-05-29-home-recent-activity-feed.md
git commit -m "docs: bring home-recent-feed spec + plan onto feature branch"
```

Expected: both docs present on `feat/home-recent-feed`. (If they are already on `dev`, this step is a no-op — skip it.)

- [ ] **Step 3: Confirm clean starting point**

Run: `git status`
Expected: on `feat/home-recent-feed`, working tree clean. All subsequent task commits land here.

---

## Task 1: Contract — add `last_session_summary` to recent_topics

**Files:**
- Modify: `docs/api/openapi.yaml` (`RecentSessionSummary`, ~line 614-623)
- Regenerated: `backend/contracts/models.py`

- [ ] **Step 1: Edit the schema in `openapi.yaml`**

Find `RecentSessionSummary` and add the `last_session_summary` property so the block reads:

```yaml
    RecentSessionSummary:
      type: object
      additionalProperties: false
      required: [id, topic, created_at]
      description: Compact session header for the "recent topics" widget.
      properties:
        id: { type: string }
        topic: { type: string }
        created_at: { type: string, format: date-time }
        ended_at: { type: [string, "null"], format: date-time, default: null }
        last_session_summary: { type: [string, "null"], default: null }
```

- [ ] **Step 2: Regenerate contracts**

Run: `python backend/scripts/gen_contracts.py`
Expected: command succeeds; `backend/contracts/models.py` `RecentSessionSummary` now has `last_session_summary: str | None = None`.

- [ ] **Step 3: Verify no unexpected drift**

Run: `git diff --stat backend/contracts/`
Expected: only `models.py` changed, and the diff is the single added field (plus nothing else). Inspect with `git diff backend/contracts/models.py`.

- [ ] **Step 4: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py
git commit -m "feat(contract): add last_session_summary to recent_topics"
```

---

## Task 2: Backend — populate `last_session_summary`

**Files:**
- Modify: `backend/services/profile_service.py:190-198`
- Test: `backend/tests/test_profile_aggregate.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_profile_aggregate.py`:

```python
def test_aggregate_recent_topics_carry_last_session_summary(client, db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    ended_profile = TopicProfile(last_session_summary="Covered Big-O; gap in log bounds.")
    _mk_session(
        db_session,
        "ended1",
        topic="Big-O",
        profile=ended_profile,
        created_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ended_at=datetime(2026, 5, 2, tzinfo=timezone.utc),
    )
    _mk_session(
        db_session,
        "active1",
        topic="Trees",
        profile=TopicProfile(),
        created_at=datetime(2026, 5, 3, tzinfo=timezone.utc),
    )
    db_session.commit()

    body = client.get("/api/profile/aggregate", params={"user_id": USER_ID}).json()
    by_id = {t["id"]: t for t in body["recent_topics"]}
    assert by_id["ended1"]["last_session_summary"] == "Covered Big-O; gap in log bounds."
    assert by_id["active1"]["last_session_summary"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_profile_aggregate.py::test_aggregate_recent_topics_carry_last_session_summary -v`
Expected: FAIL — `KeyError: 'last_session_summary'` (field not yet in the response) or assertion error.

- [ ] **Step 3: Populate the field in the service**

In `backend/services/profile_service.py`, replace the `recent_topics` comprehension (~line 190-198) with:

```python
    recent_topics = [
        RecentSessionSummary(
            id=s.id,
            topic=s.topic or "",
            created_at=s.created_at,
            ended_at=s.ended_at,
            last_session_summary=TopicProfile.model_validate_json(
                s.topic_profile_json or "{}"
            ).last_session_summary,
        )
        for s in recent
    ]
```

(`TopicProfile` is already imported in this module; the same parse is used in the loop above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_profile_aggregate.py::test_aggregate_recent_topics_carry_last_session_summary -v`
Expected: PASS

- [ ] **Step 5: Run the full aggregate test file (no regressions)**

Run: `cd backend && pytest tests/test_profile_aggregate.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_profile_aggregate.py
git commit -m "feat(profile): carry last_session_summary in recent_topics"
```

---

## Task 3: Frontend — feed tests (failing first)

**Files:**
- Test: `frontend/src/__tests__/homeView.test.js`

- [ ] **Step 1: Add the profileApi mock + default**

At the top of `frontend/src/__tests__/homeView.test.js`, after the `sessionsApi` mock (line 17), add:

```javascript
const apiAggregate = vi.fn()
vi.mock('@/services/profileApi.js', () => ({
  getAggregateProfile: (...args) => apiAggregate(...args),
}))

function makeRecent(id, topic, { ended = false, summary = null, createdOffset = 0 } = {}) {
  const created = new Date(Date.now() + createdOffset).toISOString()
  return {
    id,
    topic,
    created_at: created,
    ended_at: ended ? created : null,
    last_session_summary: summary,
  }
}
```

In the `beforeEach` block (after `apiEndSession.mockReset()`), add a default so existing tests keep an empty feed:

```javascript
    apiAggregate.mockReset()
    apiAggregate.mockResolvedValue({ recent_topics: [] })
```

- [ ] **Step 2: Add the feed tests**

Append inside the `describe('HomeView', ...)` block, before its closing `})`:

```javascript
  it('renders one feed row per recent topic', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('a1', 'Trees', { createdOffset: 0 }),
        makeRecent('e1', 'Big-O', { ended: true, summary: 'Covered amortized analysis.', createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="home-recent-"]').length).toBe(2)
  })

  it('orders active rows before ended rows', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('e1', 'Big-O', { ended: true, summary: 'done', createdOffset: 0 }),
        makeRecent('a1', 'Trees', { createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    const rows = wrapper.findAll('[data-testid^="home-recent-"]')
    expect(rows[0].attributes('data-testid')).toBe('home-recent-a1')
    expect(rows[1].attributes('data-testid')).toBe('home-recent-e1')
  })

  it('shows summary snippet when present and fallback when null', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('e1', 'Big-O', { ended: true, summary: 'Covered amortized analysis.' }),
        makeRecent('a1', 'Trees', { createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="home-recent-e1"]').text()).toContain('Covered amortized analysis.')
    expect(wrapper.get('[data-testid="home-recent-a1"]').text()).toContain('In progress')
  })

  it('clicking a feed row navigates to the session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({ recent_topics: [makeRecent('a1', 'Trees')] })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-recent-a1"] .recent-link').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a1' } })
  })

  it('ended row shows Continue; active row does not', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    store.sessions = [makeSession('a1', 'Trees')]
    apiAggregate.mockResolvedValue({
      recent_topics: [
        makeRecent('a1', 'Trees'),
        makeRecent('e1', 'Big-O', { ended: true, summary: 'done', createdOffset: -1000 }),
      ],
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-continue-e1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-continue-a1"]').exists()).toBe(false)
  })

  it('Continue reopens then navigates, without double-firing row navigation', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const reopenSpy = vi.spyOn(store, 'reopenSession').mockResolvedValue({})
    store.sessions = [makeSession('e1', 'Big-O', true)]
    apiAggregate.mockResolvedValue({
      recent_topics: [makeRecent('e1', 'Big-O', { ended: true, summary: 'done' })],
    })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="home-continue-e1"]').trigger('click')
    await flushPromises()
    expect(reopenSpy).toHaveBeenCalledWith('e1')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'e1' } })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('no feed when zero sessions (EmptyState only)', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="home-recent"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-empty-active"]').exists()).toBe(true)
  })
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run homeView`
Expected: the 7 new tests FAIL (feed markup / behavior not implemented yet). Existing tests still PASS.

- [ ] **Step 4: Commit the failing tests**

```bash
git add frontend/src/__tests__/homeView.test.js
git commit -m "test(home): feed render, ordering, Continue, navigation (failing)"
```

---

## Task 4: Frontend — implement the feed in HomeView

**Files:**
- Modify: `frontend/src/views/HomeView.vue`

- [ ] **Step 1: Update the `<script setup>` block**

In `frontend/src/views/HomeView.vue`, add the imports and feed logic. After the existing import of `normalizeTopicKey`, add:

```javascript
import { formatRelative } from '../utils/formatDate.js'
import { getAggregateProfile } from '../services/profileApi.js'
```

Add a ref next to `const cleaning = ref(false)`:

```javascript
const recentTopics = ref([])
```

Replace the `onMounted` block with:

```javascript
onMounted(async () => {
  await store.listSessions().catch(() => {})
  await getAggregateProfile()
    .then((d) => {
      recentTopics.value = d?.recent_topics || []
    })
    .catch(() => {})
})
```

Add these computeds/functions after `duplicateCount`:

```javascript
const sortedRecent = computed(() =>
  [...recentTopics.value].sort(
    (a, b) =>
      Number(a.ended_at != null) - Number(b.ended_at != null) ||
      new Date(b.created_at) - new Date(a.created_at),
  ),
)

function openSession(id) {
  router.push({ name: 'session', params: { id } })
}

async function continueSession(id) {
  await store.reopenSession(id)
  router.push({ name: 'session', params: { id } })
}
```

- [ ] **Step 2: Update the `<template>` — remove header CTA, add feed + centered CTA**

Delete the `<div class="head-cta">...</div>` block (lines ~16-26) from inside `<header class="head">`.

Inside the `<template v-else>` block, after the duplicate-banner `</div>` and before the `<EmptyState ...>`, insert the feed:

```vue
      <section
        v-if="store.sessions.length"
        class="recent"
        data-testid="home-recent"
      >
        <h2 class="recent-label">Recent activity</h2>
        <ul class="recent-list">
          <li
            v-for="s in sortedRecent"
            :key="s.id"
            class="recent-row"
            :data-testid="`home-recent-${s.id}`"
          >
            <div
              class="recent-link"
              role="button"
              tabindex="0"
              @click="openSession(s.id)"
              @keydown.enter="openSession(s.id)"
            >
              <span
                class="recent-dot"
                :class="{ 'recent-dot-active': !s.ended_at }"
                aria-hidden="true"
              />
              <div class="recent-body">
                <div class="recent-head">
                  <span class="recent-topic">{{ s.topic || 'untitled' }}</span>
                  <span class="recent-when">{{ formatRelative(s.created_at) }}</span>
                  <button
                    v-if="s.ended_at"
                    type="button"
                    class="recent-continue"
                    :data-testid="`home-continue-${s.id}`"
                    @click.stop="continueSession(s.id)"
                  >
                    Continue
                  </button>
                </div>
                <p
                  class="recent-snippet"
                  :class="{ 'recent-snippet-muted': !s.last_session_summary }"
                >
                  {{ s.last_session_summary || 'In progress — pick up where you left off.' }}
                </p>
              </div>
              <i class="pi pi-arrow-right recent-arrow" aria-hidden="true" />
            </div>
          </li>
        </ul>
      </section>
```

After the `<EmptyState ...>` block (still inside `<template v-else>`), add the centered CTA shown only when sessions exist:

```vue
      <div v-if="store.sessions.length" class="cta-center">
        <button
          type="button"
          class="cta-primary"
          data-testid="home-new-session"
          @click="goNew"
        >
          <span>New session</span>
          <i class="pi pi-plus" aria-hidden="true" />
        </button>
      </div>
```

(The `data-testid="home-new-session"` moves with the button — the existing CTA navigation test still targets it.)

- [ ] **Step 3: Add the feed styles**

Add to the `<style scoped>` block in `HomeView.vue`:

```css
.recent {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.recent-label {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 0;
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-row {
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.recent-row:hover {
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.recent-link {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1.125rem;
  color: inherit;
  cursor: pointer;
}

.recent-link:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.recent-dot {
  margin-top: 0.4rem;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  border: 1.5px solid var(--color-border-strong);
  flex-shrink: 0;
}

.recent-dot-active {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.recent-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.recent-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.recent-topic {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-heading);
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-when {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.recent-continue {
  margin-left: auto;
  flex-shrink: 0;
  padding: 0.3rem 0.75rem;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 1px solid var(--color-accent-soft);
  color: var(--color-accent);
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--motion-fast) ease;
}

.recent-continue:hover {
  background: var(--color-accent-soft);
}

.recent-snippet {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.recent-snippet-muted {
  color: var(--color-text-muted);
  font-style: italic;
}

.recent-arrow {
  margin-top: 0.25rem;
  color: var(--color-text-faint);
  font-size: 0.9rem;
  flex-shrink: 0;
  transition: transform var(--motion-fast) var(--motion-bounce), color var(--motion-fast) ease;
}

.recent-row:hover .recent-arrow {
  color: var(--color-accent);
  transform: translateX(3px);
}

.cta-center {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
}
```

- [ ] **Step 4: Run the HomeView tests**

Run: `cd frontend && npm run test:unit -- --run homeView`
Expected: all tests PASS (7 new + existing).

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/HomeView.vue
git commit -m "feat(home): recent-activity feed with Continue + centered CTA"
```

---

## Task 5: Full verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && pytest -q`
Expected: all PASS (no regressions; contract drift test green).

- [ ] **Step 2: Frontend suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: all PASS.

- [ ] **Step 3: Contract drift guard**

Run: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/`
Expected: exit 0 (no diff — contracts already in sync from Task 1).

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run frontend dev server, log in, visit Home with ≥1 ended session. Verify: feed shows active rows first then ended; ended row shows summary + Continue; active row shows "In progress"; clicking a row opens the session; Continue reopens + opens; `New session` sits centered below the feed.

---

## Self-Review Notes

- **Spec coverage:** decisions 1-12 all mapped — row content (Task 4 template), backend field (Tasks 1-2), data source `getAggregateProfile` (Task 4 script), 5-cap (inherited from backend slice, untouched), active fallback copy (Task 4 template), centered CTA (Task 4), zero-session EmptyState (untouched), `.recent-*` reuse (Task 4 styles), ended-in-feed + active-first sort (Task 4 `sortedRecent`), row-body open + `@click.stop` Continue (Task 4 template/script).
- **No backend access to a relationship object:** `topic_profile` is the JSON string column `topic_profile_json`; parsed via `TopicProfile.model_validate_json` (matches existing loop pattern).
- **Router names verified:** `session` (`/session/:id`), `new-session` (`/new`).
- **Test-id migration:** `home-new-session` moves with the CTA button to the centered card, so the existing navigation test is unaffected.
