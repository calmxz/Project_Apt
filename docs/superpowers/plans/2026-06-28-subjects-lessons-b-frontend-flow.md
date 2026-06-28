# Subjects & Lessons — Spec B (Frontend Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vue 3 frontend for Subjects & Lessons — a two-mode homepage, a subject creation wizard, a subject overview, sidebar subject grouping, and a lesson-aware session view — against Spec A's fixed API.

**Architecture:** A new `subjectsApi.js` service wraps Spec A's `/subjects` + `/lessons` routes; a new Pinia `subject.js` store mirrors `session.js` (list, current overview, lesson mutations). Views (`SubjectWizardView`, `SubjectOverview`) and components (`SidebarSubjectNode`, `MarkDoneConfirm`, lesson context bar) consume that store. Quick lessons stay subject-less sessions (today's `createSession`, `subject_id = NULL`) — unchanged.

**Tech Stack:** Vue 3 (script-setup), Vite, PrimeVue, Pinia, Vue Router, Vitest + @vue/test-utils, Playwright.

## Global Constraints

- No emojis in code or comments.
- Run unit tests with `npm run test:unit -- --run` from `frontend/` (filter one file: `npm run test:unit -- --run <name>`).
- Lint with `npm run lint` from `frontend/`.
- Reuse existing design tokens (`var(--color-*)`, `var(--radius-*)`, `var(--font-*)`, `var(--motion-*)`); no hardcoded colors.
- Grep repo-wide before removing any `data-testid` (vitest != Playwright e2e — a testid may be referenced by an e2e spec).
- Follow existing Pinia store + service patterns (mirror `stores/session.js` and `services/sessionsApi.js`).
- This plan DEPENDS on Spec A routes existing (`POST /subjects/draft-plan`, `POST/GET/PATCH /subjects`, `POST /subjects/{id}/lessons`, `PATCH/DELETE /lessons/{id}`, `POST /lessons/{id}/open`). Do not start before Spec A is merged.

### Assumed response shapes (reconcile against `docs/api/openapi.yaml` when Spec A lands)

Spec A defines DB columns, not JSON bodies. This plan fixes the following shapes and uses them verbatim across every task. Each is flagged "assumed" because contracts here are codegen, not hand-edit (`backend/scripts/gen_contracts.py`); an executor must reconcile, not silently fork.

- **Subject list item** (`GET /subjects`): `{ id, title, archived_at, progress: { done_count, total_count } }`
- **Subject overview** (`GET /subjects/{id}`): `{ id, title, per_session_minutes, timeline_days, created_at, archived_at, progress: { done_count, total_count }, lessons: Lesson[] }`
- **Lesson**: `{ id, subject_id, order_idx, title, goal, status, session_id, created_at }` where `status` is `'not_started' | 'in_progress' | 'done'`.
- **Open lesson** (`POST /lessons/{id}/open`): `{ session_id }`.
- **Session detail** (`GET /sessions/{id}`): assumed to now expose `subject_id` (denormalized per Spec A). SessionView learns its lesson by `subjectStore.loadSubject(subject_id)` then matching `lesson.session_id === sessionId` — it does NOT assume the session payload carries the lesson goal. Flagged for reconciliation.

---

## File Structure

**New:**

| Path | Responsibility |
|---|---|
| `frontend/src/services/subjectsApi.js` | Thin wrappers over Spec A `/subjects` + `/lessons` routes (mirrors `sessionsApi.js`). |
| `frontend/src/stores/subject.js` | Pinia store `useSubjectStore`: subjects list, current overview, lesson mutations (mirrors `session.js`). |
| `frontend/src/utils/pace.js` | `derivePace(lessonCount, timelineDays)` = `ceil(count / max(days/7, 1))`; timeline-primary. |
| `frontend/src/views/SubjectWizardView.vue` | Multi-step subject creation (title -> duration -> plan source -> editor/create). Route `subject-new`. |
| `frontend/src/views/SubjectOverview.vue` | `/subjects/:id` overview: lessons + status + next highlight + progress + open + relocated dupe banner. Route `subject-overview`. |
| `frontend/src/components/sidebar/SidebarSubjectNode.vue` | Expandable subject node header (title + `n/m`) that lists its opened lesson rows. |
| `frontend/src/components/chat/LessonContextBar.vue` | Lesson goal line + back-link to the subject overview (shown when session belongs to a lesson). |
| `frontend/src/components/chat/MarkDoneConfirm.vue` | Inline "mark *Lesson* done?" prompt with Yes / Keep going. |
| `frontend/src/__tests__/subjectsApi.test.js` | Unit: service wrappers call apiClient with correct method/path/body. |
| `frontend/src/__tests__/subjectStore.test.js` | Unit: store actions + getters (pace, next lesson). |
| `frontend/src/__tests__/subjectWizardView.test.js` | Unit: step flow, derived pace, draft-failure fallback, create payloads. |
| `frontend/src/__tests__/subjectOverview.test.js` | Unit: lesson states, next highlight, open navigation, progress, dupe banner. |
| `frontend/src/__tests__/sidebarSubjectGroup.test.js` | Unit: subjects expandable, quick sessions flat, progress hint. |
| `frontend/src/__tests__/sessionLessonAware.test.js` | Unit: lesson context bar + mark-done confirm writes status=done. |
| `frontend/e2e/subject-blank-create.spec.js` | e2e: blank-path subject create -> open lesson -> send message -> return to overview (draft mocked). |

**Modified:**

| Path | Change |
|---|---|
| `frontend/src/views/HomeView.vue` | Replace dashboard with two mode cards + single resume nudge; remove dupe banner + recent feed (relocated). |
| `frontend/src/router/index.js` | Register `subject-new` (`/subjects/new`) and `subject-overview` (`/subjects/:id`). |
| `frontend/src/components/sidebar/Sidebar.vue` | Render subject nodes group above quick-session flat group. |
| `frontend/src/views/SessionView.vue` | Mount `LessonContextBar` + `MarkDoneConfirm` when the session belongs to a lesson. |
| `frontend/src/__tests__/homeView.test.js` | Rewrite for two-mode home (drop feed/dupe assertions). |

---

## Task 1 — `subjectsApi.js` service

**Files:**
- Create: `frontend/src/services/subjectsApi.js`
- Test: `frontend/src/__tests__/subjectsApi.test.js`

**Interfaces:**
- Consumes (Spec A, verbatim): `POST /subjects/draft-plan {title, per_session_minutes, timeline_days}` -> `{ lessons: [{title, goal}] }` (preview only, persists nothing; server guarantees >=1 lesson via its single-lesson fallback); `POST /subjects {title, per_session_minutes, timeline_days, mode, lessons?}`; `GET /subjects`; `GET /subjects/{id}`; `PATCH /subjects/{id} {title?|timeline_days?|archived_at?}`; `POST /subjects/{id}/lessons {title, goal}`; `PATCH /lessons/{id} {title?|goal?|status?|order_idx?}`; `DELETE /lessons/{id}`; `POST /lessons/{id}/open` -> `{ session_id }`.
- Produces (named exports used by Task 2): `draftPlan`, `createSubject`, `listSubjects`, `getSubject`, `patchSubject`, `addLesson`, `patchLesson`, `deleteLesson`, `openLesson`.

- [ ] **Step 1** Write the failing test `frontend/src/__tests__/subjectsApi.test.js`. Mirror `apiWrappers.test.js`: mock `apiClient.js` and assert each wrapper calls the right verb/path/body.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()
const apiDelete = vi.fn()
vi.mock('@/services/apiClient.js', () => ({
  apiGet: (...a) => apiGet(...a),
  apiPost: (...a) => apiPost(...a),
  apiPatch: (...a) => apiPatch(...a),
  apiDelete: (...a) => apiDelete(...a),
}))

import * as api from '@/services/subjectsApi.js'

describe('subjectsApi', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset(); apiDelete.mockReset()
  })

  it('draftPlan posts to /subjects/draft-plan (preview, no mode/lessons)', () => {
    api.draftPlan({ title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14 })
    expect(apiPost).toHaveBeenCalledWith('/subjects/draft-plan', {
      title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14,
    })
  })

  it('createSubject posts the full body', () => {
    api.createSubject({ title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14, mode: 'blank', lessons: [{ title: 'Bonding', goal: 'Get bonds' }] })
    expect(apiPost).toHaveBeenCalledWith('/subjects', {
      title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14, mode: 'blank', lessons: [{ title: 'Bonding', goal: 'Get bonds' }],
    })
  })

  it('listSubjects gets /subjects', () => {
    api.listSubjects()
    expect(apiGet).toHaveBeenCalledWith('/subjects')
  })

  it('getSubject gets /subjects/:id', () => {
    api.getSubject('s1')
    expect(apiGet).toHaveBeenCalledWith('/subjects/s1')
  })

  it('patchSubject patches /subjects/:id', () => {
    api.patchSubject('s1', { title: 'New' })
    expect(apiPatch).toHaveBeenCalledWith('/subjects/s1', { title: 'New' })
  })

  it('addLesson posts to /subjects/:id/lessons', () => {
    api.addLesson('s1', { title: 'Alkanes', goal: 'Name them' })
    expect(apiPost).toHaveBeenCalledWith('/subjects/s1/lessons', { title: 'Alkanes', goal: 'Name them' })
  })

  it('patchLesson patches /lessons/:id', () => {
    api.patchLesson('l1', { status: 'done' })
    expect(apiPatch).toHaveBeenCalledWith('/lessons/l1', { status: 'done' })
  })

  it('deleteLesson deletes /lessons/:id', () => {
    api.deleteLesson('l1')
    expect(apiDelete).toHaveBeenCalledWith('/lessons/l1')
  })

  it('openLesson posts to /lessons/:id/open', () => {
    api.openLesson('l1')
    expect(apiPost).toHaveBeenCalledWith('/lessons/l1/open', {})
  })
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run subjectsApi` — expect FAIL (module not found / undefined exports).
- [ ] **Step 3** Create `frontend/src/services/subjectsApi.js` (mirror `sessionsApi.js` import style):

```js
import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient.js'

// Paths are relative to VITE_API_BASE_URL which already includes the /api
// prefix. user_id is resolved from the Authorization: Bearer <jwt> header.

// Preview-only: generates a draft lesson list without persisting. The wizard
// loads the result into the same in-memory review/edit step the blank path uses.
export const draftPlan = ({ title, per_session_minutes, timeline_days }) =>
  apiPost('/subjects/draft-plan', { title, per_session_minutes, timeline_days })

export const createSubject = ({ title, per_session_minutes, timeline_days, mode, lessons }) =>
  apiPost('/subjects', { title, per_session_minutes, timeline_days, mode, lessons })

export const listSubjects = () => apiGet('/subjects')

export const getSubject = (subjectId) => apiGet(`/subjects/${subjectId}`)

export const patchSubject = (subjectId, patch) => apiPatch(`/subjects/${subjectId}`, patch)

export const addLesson = (subjectId, { title, goal }) =>
  apiPost(`/subjects/${subjectId}/lessons`, { title, goal })

export const patchLesson = (lessonId, patch) => apiPatch(`/lessons/${lessonId}`, patch)

export const deleteLesson = (lessonId) => apiDelete(`/lessons/${lessonId}`)

export const openLesson = (lessonId) => apiPost(`/lessons/${lessonId}/open`, {})
```

- [ ] **Step 4** Run `npm run test:unit -- --run subjectsApi` — expect PASS (9 passing).
- [ ] **Step 5** `npm run lint`. Commit: `feat(subjects): add subjectsApi service wrappers for Spec A routes`.

---

## Task 2 — `subject.js` Pinia store + `pace.js`

**Files:**
- Create: `frontend/src/stores/subject.js`, `frontend/src/utils/pace.js`
- Test: `frontend/src/__tests__/subjectStore.test.js`

**Interfaces:**
- Consumes: `subjectsApi.*` (Task 1); shapes from Global Constraints.
- Produces (used by Tasks 3-9): store `useSubjectStore` with state `subjects`, `currentSubject`, `loading`, `error`; actions `draftPlan(payload) -> lessons[]`, `listSubjects()`, `loadSubject(id)`, `createSubject(payload)`, `addLesson(subjectId, {title, goal})`, `patchLesson(lessonId, patch)`, `deleteLesson(lessonId)`, `openLesson(lessonId) -> session_id`, `markLessonDone(lessonId)`; getters `nextLesson` (first non-`done` lesson of `currentSubject`), `currentPace`. Util `derivePace(lessonCount, timelineDays)`.

- [ ] **Step 1** Failing test `frontend/src/__tests__/subjectStore.test.js` (mirror `sessionStore.test.js` setup):

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const api = {
  draftPlan: vi.fn(), listSubjects: vi.fn(), getSubject: vi.fn(), createSubject: vi.fn(),
  addLesson: vi.fn(), patchLesson: vi.fn(), deleteLesson: vi.fn(), openLesson: vi.fn(),
}
vi.mock('@/services/subjectsApi.js', () => api)

import { useSubjectStore } from '@/stores/subject.js'
import { derivePace } from '@/utils/pace.js'

const overview = {
  id: 's1', title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14,
  archived_at: null, progress: { done_count: 2, total_count: 6 },
  lessons: [
    { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
    { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Alkanes', goal: 'g', status: 'done', session_id: 'sess2' },
    { id: 'l3', subject_id: 's1', order_idx: 2, title: 'Reactions', goal: 'g', status: 'not_started', session_id: null },
  ],
}

describe('subject store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
  })

  it('loadSubject stores the overview and exposes nextLesson (first non-done)', async () => {
    api.getSubject.mockResolvedValue(overview)
    const store = useSubjectStore()
    await store.loadSubject('s1')
    expect(store.currentSubject.title).toBe('Organic Chemistry')
    expect(store.nextLesson.id).toBe('l3')
  })

  it('currentPace derives ceil(total / weeks)', async () => {
    api.getSubject.mockResolvedValue(overview)
    const store = useSubjectStore()
    await store.loadSubject('s1')
    // 6 lessons / (14/7=2 weeks) = 3
    expect(store.currentPace).toBe(3)
  })

  it('openLesson returns session_id', async () => {
    api.openLesson.mockResolvedValue({ session_id: 'sess9' })
    const store = useSubjectStore()
    const sid = await store.openLesson('l3')
    expect(api.openLesson).toHaveBeenCalledWith('l3')
    expect(sid).toBe('sess9')
  })

  it('markLessonDone patches status=done and updates local lesson', async () => {
    api.getSubject.mockResolvedValue(overview)
    api.patchLesson.mockResolvedValue({ id: 'l3', status: 'done' })
    const store = useSubjectStore()
    await store.loadSubject('s1')
    await store.markLessonDone('l3')
    expect(api.patchLesson).toHaveBeenCalledWith('l3', { status: 'done' })
    expect(store.currentSubject.lessons.find((l) => l.id === 'l3').status).toBe('done')
  })

  it('draftPlan returns the lessons array from the preview response', async () => {
    api.draftPlan.mockResolvedValue({ lessons: [{ title: 'Bonding', goal: 'g' }, { title: 'Alkanes', goal: 'g' }] })
    const store = useSubjectStore()
    const lessons = await store.draftPlan({ title: 'Chem', per_session_minutes: 30, timeline_days: 14 })
    expect(api.draftPlan).toHaveBeenCalledWith({ title: 'Chem', per_session_minutes: 30, timeline_days: 14 })
    expect(lessons).toHaveLength(2)
    expect(lessons[0].title).toBe('Bonding')
  })

  it('derivePace floors weeks at 1', () => {
    expect(derivePace(4, 3)).toBe(4) // 3 days -> weeks clamped to 1
    expect(derivePace(0, 14)).toBe(0)
  })
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run subjectStore` — expect FAIL.
- [ ] **Step 3** Create `frontend/src/utils/pace.js`:

```js
// Timeline-primary pace: lessons per week, derived (never stored). Spec A.
export function derivePace(lessonCount, timelineDays) {
  const weeks = Math.max((timelineDays || 0) / 7, 1)
  return Math.ceil((lessonCount || 0) / weeks)
}
```

- [ ] **Step 4** Create `frontend/src/stores/subject.js` (mirror `session.js`: setup store, `_setError` via `friendlyError`):

```js
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as subjectsApi from '../services/subjectsApi.js'
import { friendlyError } from '../lib/errors.js'
import { derivePace } from '../utils/pace.js'

export const useSubjectStore = defineStore('subject', () => {
  const subjects = ref([])
  const currentSubject = ref(null)
  const loading = ref(false)
  const error = ref(null)

  function _setError(e) {
    error.value = friendlyError(e)
    throw e
  }

  const nextLesson = computed(() => {
    const lessons = currentSubject.value?.lessons || []
    return lessons.find((l) => l.status !== 'done') || null
  })

  const currentPace = computed(() => {
    const s = currentSubject.value
    if (!s) return 0
    return derivePace((s.lessons || []).length, s.timeline_days)
  })

  async function listSubjects() {
    loading.value = true
    error.value = null
    try {
      subjects.value = await subjectsApi.listSubjects()
      return subjects.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function loadSubject(id) {
    loading.value = true
    error.value = null
    try {
      currentSubject.value = await subjectsApi.getSubject(id)
      return currentSubject.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function draftPlan(payload) {
    loading.value = true
    error.value = null
    try {
      const resp = await subjectsApi.draftPlan(payload)
      return resp?.lessons || []
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function createSubject(payload) {
    loading.value = true
    error.value = null
    try {
      return await subjectsApi.createSubject(payload)
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function addLesson(subjectId, lesson) {
    const created = await subjectsApi.addLesson(subjectId, lesson)
    if (currentSubject.value?.id === subjectId) {
      currentSubject.value.lessons = [...(currentSubject.value.lessons || []), created]
    }
    return created
  }

  async function patchLesson(lessonId, patch) {
    const updated = await subjectsApi.patchLesson(lessonId, patch)
    const lessons = currentSubject.value?.lessons || []
    const idx = lessons.findIndex((l) => l.id === lessonId)
    if (idx !== -1) lessons[idx] = { ...lessons[idx], ...patch, ...updated }
    return updated
  }

  async function deleteLesson(lessonId) {
    await subjectsApi.deleteLesson(lessonId)
    if (currentSubject.value?.lessons) {
      currentSubject.value.lessons = currentSubject.value.lessons.filter((l) => l.id !== lessonId)
    }
  }

  async function openLesson(lessonId) {
    const { session_id } = await subjectsApi.openLesson(lessonId)
    return session_id
  }

  async function markLessonDone(lessonId) {
    return patchLesson(lessonId, { status: 'done' })
  }

  function reset() {
    subjects.value = []
    currentSubject.value = null
    error.value = null
  }

  return {
    subjects, currentSubject, loading, error,
    nextLesson, currentPace,
    draftPlan, listSubjects, loadSubject, createSubject,
    addLesson, patchLesson, deleteLesson, openLesson, markLessonDone, reset,
  }
})
```

- [ ] **Step 5** Run `npm run test:unit -- --run subjectStore` — expect PASS (6 passing). `npm run lint`. Commit: `feat(subjects): add subject Pinia store + derivePace util`.

---

## Task 3 — Two-mode HomeView

**Files:**
- Modify: `frontend/src/views/HomeView.vue`
- Test: `frontend/src/__tests__/homeView.test.js` (rewrite)

**Interfaces:**
- Consumes: `useSessionStore` (`sessions`, `createSession`, `listSubjects` not needed here); router names `subject-new`, `session`, `new-session`.
- Produces (testids used by e2e + later tasks): `home-mode-quick`, `home-mode-subject`, `home-quick-topic`, `home-quick-go`, `home-build-start`, `home-resume`, `home-resume-continue`.

Resolved decisions baked in: two mode cards (Quick lesson / Build a subject); the resume nudge **absorbs** the old recent-activity feed (single most-recent active row); the duplicate-cleanup banner is **removed here** (relocates to overview, Task 6). Quick card embeds topic input + quick picks + go (creates a subject-less session via existing `createSession`); full reference-file attach stays on `/new` (linked).

- [ ] **Step 1** Rewrite `frontend/src/__tests__/homeView.test.js` to the new surface. Keep the `vue-router` + `sessionsApi`/`profileApi` mock scaffold; drop feed/dupe tests; add:

```js
it('renders both mode cards', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  const wrapper = mountView()
  await flushPromises()
  expect(wrapper.find('[data-testid="home-mode-quick"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="home-mode-subject"]').exists()).toBe(true)
})

it('Build a subject routes to the wizard', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('[data-testid="home-build-start"]').trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'subject-new' })
})

it('Quick lesson creates a subject-less session then navigates', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'sess1' })
  const wrapper = mountView()
  await flushPromises()
  await wrapper.get('[data-testid="home-quick-topic"]').setValue('Recursion')
  await wrapper.get('[data-testid="home-quick-go"]').trigger('click')
  await flushPromises()
  expect(store.createSession).toHaveBeenCalledWith({ topic: 'Recursion', seedMode: 'fresh', priorSessionId: null })
  expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'sess1' } })
})

it('resume nudge shows the most-recent active session and continues to it', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  store.sessions = [makeSession('a1', 'Trees', false, -5000), makeSession('a2', 'Graphs', false, 0)]
  const wrapper = mountView()
  await flushPromises()
  const resume = wrapper.get('[data-testid="home-resume"]')
  expect(resume.text()).toContain('Graphs')
  await wrapper.get('[data-testid="home-resume-continue"]').trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'a2' } })
})

it('does not render the dupe banner or recent feed (relocated)', async () => {
  const store = useSessionStore()
  vi.spyOn(store, 'listSessions').mockResolvedValue([])
  store.sessions = [makeSession('a1', 'Calc', false, -1), makeSession('a2', 'Calc', false, 0)]
  const wrapper = mountView()
  await flushPromises()
  expect(wrapper.find('[data-testid="home-dupe-banner"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="home-recent"]').exists()).toBe(false)
})
```

Before deleting the old `home-recent-*`/`home-dupe-*` testids, grep repo-wide (`Grep "home-dupe-banner|home-recent"` over `frontend/`) to confirm no e2e spec references them.

- [ ] **Step 2** Run `npm run test:unit -- --run homeView` — expect FAIL.
- [ ] **Step 3** Rewrite `HomeView.vue` template to two cards + resume nudge. Reuse existing tokens (`--color-surface`, `--color-border`, `--radius-card`, `--color-accent-strong`, `--shadow-pop`, `--font-display`). Script:

```js
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session.js'

const router = useRouter()
const store = useSessionStore()
const quickTopic = ref('')

onMounted(() => store.listSessions().catch(() => {}))

const resumeSession = computed(() => {
  const active = store.sessions.filter((s) => !s.ended_at)
  if (!active.length) return null
  return [...active].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
})

async function startQuick() {
  const topic = quickTopic.value.trim()
  if (!topic) return
  const created = await store.createSession({ topic, seedMode: 'fresh', priorSessionId: null })
  if (created) router.push({ name: 'session', params: { id: created.id } })
}
function buildSubject() { router.push({ name: 'subject-new' }) }
function continueResume() {
  if (resumeSession.value) router.push({ name: 'session', params: { id: resumeSession.value.id } })
}
```

Template skeleton (cards + resume + an "add reference files" link to `/new` for the full quick flow):

```html
<section class="home">
  <h1 class="title">What do you want to learn?</h1>
  <div class="modes">
    <div class="mode-card" data-testid="home-mode-quick">
      <h2 class="mode-title">Quick lesson</h2>
      <p class="mode-sub">One topic. Type and go.</p>
      <input v-model="quickTopic" class="quick-input" data-testid="home-quick-topic"
             placeholder="e.g. Recursion" @keydown.enter="startQuick" />
      <button type="button" class="cta-primary" data-testid="home-quick-go" @click="startQuick">
        <span>Start</span><i class="pi pi-arrow-right" aria-hidden="true" />
      </button>
      <RouterLink to="/new" class="quick-more">Add reference files</RouterLink>
    </div>
    <div class="mode-card" data-testid="home-mode-subject">
      <h2 class="mode-title">Build a subject</h2>
      <p class="mode-sub">Multiple lessons, a guided plan.</p>
      <button type="button" class="cta-secondary" data-testid="home-build-start" @click="buildSubject">
        <span>Start a plan</span><i class="pi pi-arrow-right" aria-hidden="true" />
      </button>
    </div>
  </div>
  <RouterLink v-if="resumeSession" class="resume" data-testid="home-resume"
              :to="{ name: 'session', params: { id: resumeSession.id } }">
    <span>Continue where you left off — {{ resumeSession.topic || 'untitled' }}</span>
  </RouterLink>
  <button v-if="resumeSession" type="button" class="resume-btn" data-testid="home-resume-continue" @click="continueResume">
    Continue
  </button>
</section>
```

- [ ] **Step 4** Run `npm run test:unit -- --run homeView` — expect PASS. `npm run lint`. Commit: `feat(subjects): two-mode HomeView (quick lesson + build a subject + resume nudge)`.

---

## Task 4 — Subject wizard: steps 1-3 + route

**Files:**
- Create: `frontend/src/views/SubjectWizardView.vue`
- Modify: `frontend/src/router/index.js`
- Test: `frontend/src/__tests__/subjectWizardView.test.js`

**Interfaces:**
- Consumes: `useSubjectStore.createSubject`; `derivePace`.
- Produces (testids for Task 5 + e2e): `wizard-title-input`, `wizard-next`, `wizard-back`, `wizard-minutes-15|30|60`, `wizard-timeline-7|14|30`, `wizard-pace`, `wizard-mode-draft`, `wizard-mode-blank`, plus a `step` state machine `'title' | 'duration' | 'source' | 'editor'`.

Pace note: `derivePace` needs a lesson count, which does not exist until the editor step. On the duration step the wizard displays the chosen timeline as weeks and a live pace **estimate keyed to the in-editor lesson count once lessons exist** (`wizard-pace` shows weeks-only until then). The authoritative pace renders on the overview (Task 6). Resolved ambiguity — Spec B mock shows pace on the duration step but pace is undefined without lessons.

- [ ] **Step 1** Register routes in `router/index.js` (add after the `new-session` block, before `session`):

```js
{
  path: '/subjects/new',
  name: 'subject-new',
  component: () => import('../views/SubjectWizardView.vue'),
},
{
  path: '/subjects/:id',
  name: 'subject-overview',
  component: () => import('../views/SubjectOverview.vue'),
  props: true,
},
```

- [ ] **Step 2** Failing test `subjectWizardView.test.js` for steps 1-3:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ draftPlan: vi.fn(), createSubject: vi.fn() }))

import SubjectWizardView from '@/views/SubjectWizardView.vue'

function mountView() { return mount(SubjectWizardView) }

describe('SubjectWizardView steps 1-3', () => {
  beforeEach(() => { setActivePinia(createPinia()); push.mockClear() })

  it('starts on the title step and advances on Next', async () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="wizard-title-input"]').exists()).toBe(true)
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Organic Chemistry')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-minutes-30"]').exists()).toBe(true)
  })

  it('Next is disabled with an empty title', () => {
    const wrapper = mountView()
    expect(wrapper.get('[data-testid="wizard-next"]').attributes('disabled')).toBeDefined()
  })

  it('duration step shows the timeline in weeks', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-timeline-14"]').trigger('click')
    expect(wrapper.get('[data-testid="wizard-pace"]').text()).toContain('2-week')
  })

  it('reaches the plan-source step with two buttons', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-mode-draft"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-mode-blank"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 3** Run `npm run test:unit -- --run subjectWizardView` — expect FAIL.
- [ ] **Step 4** Create `SubjectWizardView.vue` with a `step` ref machine (`'title' | 'duration' | 'source' | 'editor'`) and the title/duration/source steps. Wire `selectedMinutes` (default 30), `selectedTimeline` (default 14), and a `weeksLabel` computed (`Math.round(timeline_days/7)`-week). Use design tokens (`--color-accent-soft`/`--color-accent` for selected chips, `--radius-pill`). The plan-source step renders `wizard-mode-draft` + `wizard-mode-blank`; both advance to the shared `editor` step (draft populates it via the preview call, blank starts it empty — wired in Task 5). Leave the `editor` step as a placeholder `<div data-testid="wizard-editor-placeholder" />` to be filled in Task 5. Chips selected state mirrors `sb-status-btn.active` styling.

- [ ] **Step 5** Run `npm run test:unit -- --run subjectWizardView` — expect PASS (4 passing). Also run `npm run test:unit -- --run router` and confirm a new assertion you add — `expect(names).toContain('subject-new')` and `'subject-overview'` — passes. `npm run lint`. Commit: `feat(subjects): subject wizard steps 1-3 (title, duration, plan source) + routes`.

---

## Task 5 — Subject wizard: shared review/edit editor + create (both paths preview/edit before commit)

**Files:**
- Modify: `frontend/src/views/SubjectWizardView.vue`
- Test: `frontend/src/__tests__/subjectWizardView.test.js` (extend)

**Interfaces:**
- Consumes: `useSubjectStore.draftPlan(payload) -> lessons[]` (preview, persists nothing); `useSubjectStore.createSubject(payload) -> persisted subject { id, ... }`; `derivePace`.
- Produces (testids): `wizard-lesson-title`, `wizard-lesson-goal`, `wizard-add-lesson`, `wizard-lesson-row-<i>`, `wizard-row-title-<i>`, `wizard-row-goal-<i>`, `wizard-lesson-up-<i>`, `wizard-lesson-down-<i>`, `wizard-lesson-remove-<i>`, `wizard-create`, `wizard-drafting`, `wizard-draft-error`.

Resolved flow (uses Spec A's reconciled `POST /subjects/draft-plan` preview endpoint — the user reviews/edits BEFORE commit, per approved Spec B §2 step 4; the earlier "land on overview as the review surface" resolution is removed):
- **Draft path:** choose "Draft a plan for me" -> `store.draftPlan({title, per_session_minutes, timeline_days})` (spinner `wizard-drafting`; metered preview call). On success the returned `lessons` populate the **same** in-memory editor the blank path uses; user edits title/goal, reorders (up/down), adds, deletes. A 200 always carries >=1 lesson (server single-lesson fallback).
- **Blank path:** choose "I'll add my own" -> the same editor, starting empty; user adds lessons manually.
- **Both paths commit identically:** `store.createSubject({ title, per_session_minutes, timeline_days, mode: 'blank', lessons })` -> `router.push({ name: 'subject-overview', params: { id } })`. `mode: 'blank'` persists exactly the reviewed `lessons` (no server re-draft at commit) for both paths.
- **Draft failure (HTTP/cap throw only):** drop into the editor empty with a `wizard-draft-error` notice -> user finishes manually (never dead-end).

- [ ] **Step 1** Extend the test file:

```js
import { useSubjectStore } from '@/stores/subject.js'

it('blank path: add a lesson then commit with the reviewed lessons', async () => {
  const wrapper = mountView()
  const store = useSubjectStore()
  vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's9' })
  await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> duration
  await wrapper.get('[data-testid="wizard-timeline-14"]').trigger('click')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click') // -> source
  await wrapper.get('[data-testid="wizard-mode-blank"]').trigger('click') // -> editor (empty)
  await wrapper.get('[data-testid="wizard-lesson-title"]').setValue('Bonding')
  await wrapper.get('[data-testid="wizard-lesson-goal"]').setValue('Understand bonds')
  await wrapper.get('[data-testid="wizard-add-lesson"]').trigger('click')
  await wrapper.get('[data-testid="wizard-create"]').trigger('click')
  await flushPromises()
  expect(store.createSubject).toHaveBeenCalledWith({
    title: 'Chem', per_session_minutes: 30, timeline_days: 14, mode: 'blank',
    lessons: [{ title: 'Bonding', goal: 'Understand bonds' }],
  })
  expect(push).toHaveBeenCalledWith({ name: 'subject-overview', params: { id: 's9' } })
})

it('draft path: preview populates the editor; the reviewed (edited) lessons are committed', async () => {
  const wrapper = mountView()
  const store = useSubjectStore()
  vi.spyOn(store, 'draftPlan').mockResolvedValue([
    { title: 'Bonding', goal: 'g1' }, { title: 'Alkanes', goal: 'g2' },
  ])
  vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's7' })
  await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-timeline-14"]').trigger('click')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-mode-draft"]').trigger('click')
  await flushPromises()
  expect(store.draftPlan).toHaveBeenCalledWith({ title: 'Chem', per_session_minutes: 30, timeline_days: 14 })
  expect(wrapper.findAll('[data-testid^="wizard-lesson-row-"]')).toHaveLength(2)
  await wrapper.get('[data-testid="wizard-row-title-0"]').setValue('Bonding basics')
  await wrapper.get('[data-testid="wizard-create"]').trigger('click')
  await flushPromises()
  expect(store.createSubject).toHaveBeenCalledWith({
    title: 'Chem', per_session_minutes: 30, timeline_days: 14, mode: 'blank',
    lessons: [{ title: 'Bonding basics', goal: 'g1' }, { title: 'Alkanes', goal: 'g2' }],
  })
  expect(push).toHaveBeenCalledWith({ name: 'subject-overview', params: { id: 's7' } })
})

it('reorder: move-down swaps adjacent drafted lessons', async () => {
  const wrapper = mountView()
  const store = useSubjectStore()
  vi.spyOn(store, 'draftPlan').mockResolvedValue([{ title: 'A', goal: '' }, { title: 'B', goal: '' }])
  await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-mode-draft"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="wizard-lesson-down-0"]').trigger('click')
  expect(wrapper.get('[data-testid="wizard-row-title-0"]').element.value).toBe('B')
})

it('draft failure falls back to an empty editor with a notice', async () => {
  const wrapper = mountView()
  const store = useSubjectStore()
  vi.spyOn(store, 'draftPlan').mockRejectedValueOnce(new Error('429'))
  await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-next"]').trigger('click')
  await wrapper.get('[data-testid="wizard-mode-draft"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="wizard-draft-error"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="wizard-lesson-title"]').exists()).toBe(true) // empty add-row editor visible
  expect(wrapper.findAll('[data-testid^="wizard-lesson-row-"]')).toHaveLength(0)
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run subjectWizardView` — expect FAIL (new cases).
- [ ] **Step 3** Implement the shared editor step + handlers in `SubjectWizardView.vue`:

```js
const lessons = ref([]) // [{ title, goal }] — editable in place
const lessonTitle = ref('')
const lessonGoal = ref('')
const drafting = ref(false)
const draftError = ref(null)

function addLessonRow() {
  const title = lessonTitle.value.trim()
  if (!title) return
  lessons.value.push({ title, goal: lessonGoal.value.trim() })
  lessonTitle.value = ''; lessonGoal.value = ''
}
function removeLessonRow(i) { lessons.value.splice(i, 1) }
function moveLesson(i, delta) {
  const j = i + delta
  if (j < 0 || j >= lessons.value.length) return
  const arr = lessons.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function basePayload() {
  return { title: title.value.trim(), per_session_minutes: selectedMinutes.value, timeline_days: selectedTimeline.value }
}

async function chooseDraft() {
  drafting.value = true
  draftError.value = null
  try {
    const drafted = await store.draftPlan(basePayload())
    lessons.value = (drafted || []).map((l) => ({ title: l.title, goal: l.goal }))
    step.value = 'editor'
  } catch {
    draftError.value = 'Could not draft a plan right now. Add lessons yourself below.'
    lessons.value = []
    step.value = 'editor'
  } finally {
    drafting.value = false
  }
}

function chooseBlank() { lessons.value = []; step.value = 'editor' }

async function commitCreate() {
  const subject = await store.createSubject({ ...basePayload(), mode: 'blank', lessons: lessons.value })
  if (subject) router.push({ name: 'subject-overview', params: { id: subject.id } })
}
```

Wire the source-step buttons: `wizard-mode-draft` -> `chooseDraft`, `wizard-mode-blank` -> `chooseBlank`. While `drafting`, render a `wizard-drafting` spinner on the source step. The editor renders: a `wizard-draft-error` notice when set; the editable lesson list — each `wizard-lesson-row-<i>` with `<input data-testid="wizard-row-title-<i>" v-model="lessons[i].title">`, `<input data-testid="wizard-row-goal-<i>" v-model="lessons[i].goal">`, `wizard-lesson-up-<i>` (`@click="moveLesson(i, -1)"`), `wizard-lesson-down-<i>` (`@click="moveLesson(i, 1)"`), `wizard-lesson-remove-<i>` (`@click="removeLessonRow(i)"`); an add row (`wizard-lesson-title`, `wizard-lesson-goal`, `wizard-add-lesson` -> `addLessonRow`); and `wizard-create` -> `commitCreate`. Show live `derivePace(lessons.length, selectedTimeline)` ("~N/week") in the editor. Tokens: selected/active via `--color-accent`, rows on `--color-surface` + `--color-border`, `--radius-md`.

- [ ] **Step 4** Run `npm run test:unit -- --run subjectWizardView` — expect PASS (8 passing). `npm run lint`. Commit: `feat(subjects): wizard shared review/edit editor + draft-plan preview + commit`.

---

## Task 6 — Subject overview (`/subjects/:id`)

**Files:**
- Create: `frontend/src/views/SubjectOverview.vue`
- Test: `frontend/src/__tests__/subjectOverview.test.js`

**Interfaces:**
- Consumes: `useSubjectStore` (`loadSubject`, `currentSubject`, `nextLesson`, `currentPace`, `openLesson`); router `session`.
- Produces (testids): `subject-overview`, `subject-progress-bar`, `subject-meta`, `subject-lesson-<id>`, `subject-lesson-status-<id>`, `subject-lesson-next` (the highlighted row), `subject-open-next`, `subject-dupe-banner`, `subject-dupe-cleanup`.

Decisions: no gating — every lesson row is clickable. "Next" = first non-`done` lesson (`store.nextLesson`), highlighted as a suggestion only. Progress bar from `progress.done_count / progress.total_count`. The duplicate-cleanup banner relocates here (shown when this subject has two opened lesson-sessions sharing a topic — reuse `normalizeTopicKey` from `utils/formatDate.js`).

- [ ] **Step 1** Failing test `subjectOverview.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: { id: 's1' } }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ getSubject: vi.fn(), openLesson: vi.fn() }))

import SubjectOverview from '@/views/SubjectOverview.vue'
import { useSubjectStore } from '@/stores/subject.js'

const overview = {
  id: 's1', title: 'Organic Chemistry', per_session_minutes: 30, timeline_days: 14,
  archived_at: null, progress: { done_count: 2, total_count: 3 },
  lessons: [
    { id: 'l1', subject_id: 's1', order_idx: 0, title: 'Bonding', goal: 'g', status: 'done', session_id: 'sess1' },
    { id: 'l2', subject_id: 's1', order_idx: 1, title: 'Alkanes', goal: 'g', status: 'done', session_id: 'sess2' },
    { id: 'l3', subject_id: 's1', order_idx: 2, title: 'Reactions', goal: 'g', status: 'not_started', session_id: null },
  ],
}

function mountView() { return mount(SubjectOverview, { props: { id: 's1' } }) }

describe('SubjectOverview', () => {
  beforeEach(() => { setActivePinia(createPinia()); push.mockClear() })

  it('renders lesson rows with status and highlights the first non-done as next', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="subject-lesson-status-l1"]').text()).toContain('done')
    expect(wrapper.get('[data-testid="subject-lesson-next"]').attributes('data-testid')).toBe('subject-lesson-next')
    expect(wrapper.get('[data-testid="subject-lesson-next"]').text()).toContain('Reactions')
  })

  it('progress bar reflects done/total', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="subject-progress-bar"]').attributes('aria-valuenow')).toBe('2')
    expect(wrapper.get('[data-testid="subject-progress-bar"]').attributes('aria-valuemax')).toBe('3')
  })

  it('clicking a lesson opens it then navigates to the session', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    vi.spyOn(store, 'openLesson').mockResolvedValue('sess9')
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="subject-lesson-l3"]').trigger('click')
    await flushPromises()
    expect(store.openLesson).toHaveBeenCalledWith('l3')
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'sess9' } })
  })

  it('Open next lesson opens the highlighted lesson', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => { store.currentSubject = overview })
    vi.spyOn(store, 'openLesson').mockResolvedValue('sess9')
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="subject-open-next"]').trigger('click')
    await flushPromises()
    expect(store.openLesson).toHaveBeenCalledWith('l3')
  })
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run subjectOverview` — expect FAIL.
- [ ] **Step 3** Create `SubjectOverview.vue`. `onMounted(() => store.loadSubject(props.id))`. Script:

```js
const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const store = useSubjectStore()
onMounted(() => store.loadSubject(props.id).catch(() => {}))

const subject = computed(() => store.currentSubject)
const lessons = computed(() => subject.value?.lessons || [])
const nextId = computed(() => store.nextLesson?.id || null)

const STATUS_LABEL = { done: 'done', in_progress: 'in progress', not_started: 'not started' }

async function open(lessonId) {
  const sid = await store.openLesson(lessonId)
  if (sid) router.push({ name: 'session', params: { id: sid } })
}
function openNext() { if (nextId.value) open(nextId.value) }
```

Template: header (title + progress bar `role="progressbar"` with `aria-valuenow="progress.done_count"`, `aria-valuemax="progress.total_count"`), meta line (`per session ~{{ per_session_minutes }} min · {{ weeks }}-week plan · ~{{ store.currentPace }}/week`), lesson list (each row a `<button data-testid="subject-lesson-<id>">`, an extra `:data-testid="id === nextId ? 'subject-lesson-next' : undefined"`, status `subject-lesson-status-<id>`, highlight class when `id === nextId` via `--color-accent-soft`), `subject-open-next` button, and the relocated dupe banner (port `dupe-banner` markup + `cleanupDuplicates` from old HomeView, scoped to this subject's opened lessons). Use tokens: `--color-surface`, `--color-border`, `--color-accent`, `--signal-success` for done check, `--radius-card`.

- [ ] **Step 4** Run `npm run test:unit -- --run subjectOverview` — expect PASS (4 passing). `npm run lint`. Commit: `feat(subjects): subject overview with lesson states, next highlight, open + dupe banner`.

---

## Task 7 — Sidebar subject grouping

**Files:**
- Create: `frontend/src/components/sidebar/SidebarSubjectNode.vue`
- Modify: `frontend/src/components/sidebar/Sidebar.vue`
- Test: `frontend/src/__tests__/sidebarSubjectGroup.test.js`

**Interfaces:**
- Consumes: `useSubjectStore` (`subjects` list with `progress`, `loadSubject` on expand); `useSessionStore.sessions` (each now carries `subject_id`); existing `SidebarSessionRow`.
- Produces (testids): `sidebar-subjects-group`, `sidebar-subject-node-<id>`, `sidebar-subject-toggle-<id>`, `sidebar-subject-progress-<id>`, `sidebar-quick-group`. Component `SidebarSubjectNode` props `{ subject }`.

Decisions: subjects render as expandable nodes; expanding loads the subject and lists its opened lesson rows (lessons with a `session_id`, reusing `SidebarSessionRow` keyed by the linked session). Subject-less quick sessions render as today's flat list in their own group. Progress hint `n/m` on the node header.

- [ ] **Step 1** Failing test `sidebarSubjectGroup.test.js` (component-level for `SidebarSubjectNode` to keep the mount small — mirrors `sidebar.test.js` mocking style):

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ getSubject: vi.fn() }))
vi.mock('@/composables/useSidebar.js', () => ({ useSidebar: () => ({ mode: { value: 'expanded' }, closeDrawer: vi.fn() }) }))

import SidebarSubjectNode from '@/components/sidebar/SidebarSubjectNode.vue'
import { useSubjectStore } from '@/stores/subject.js'

const subject = { id: 's1', title: 'Organic Chemistry', progress: { done_count: 3, total_count: 6 } }

describe('SidebarSubjectNode', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the title and n/m progress hint', () => {
    const wrapper = mount(SidebarSubjectNode, { props: { subject } })
    expect(wrapper.get('[data-testid="sidebar-subject-node-s1"]').text()).toContain('Organic Chemistry')
    expect(wrapper.get('[data-testid="sidebar-subject-progress-s1"]').text()).toContain('3/6')
  })

  it('expanding loads the subject and lists opened lesson rows', async () => {
    const store = useSubjectStore()
    vi.spyOn(store, 'loadSubject').mockImplementation(async () => {
      store.currentSubject = { ...subject, lessons: [
        { id: 'l1', title: 'Bonding', status: 'done', session_id: 'sess1' },
        { id: 'l2', title: 'Alkanes', status: 'not_started', session_id: null },
      ] }
      return store.currentSubject
    })
    const wrapper = mount(SidebarSubjectNode, { props: { subject }, global: { stubs: { SidebarSessionRow: { props: ['session'], template: '<li class="row-stub">{{ session.topic }}</li>' } } } })
    await wrapper.get('[data-testid="sidebar-subject-toggle-s1"]').trigger('click')
    await flushPromises()
    expect(store.loadSubject).toHaveBeenCalledWith('s1')
    // only the opened lesson (session_id set) becomes a row
    expect(wrapper.findAll('.row-stub').length).toBe(1)
  })
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run sidebarSubjectGroup` — expect FAIL.
- [ ] **Step 3** Create `SidebarSubjectNode.vue`. An expandable `<button data-testid="sidebar-subject-toggle-<id>">` toggles `expanded`; on first expand call `subjectStore.loadSubject(subject.id)`. When expanded, render `<ul>` of `SidebarSessionRow` for lessons where `session_id` is set, mapping each lesson to a session-shaped object `{ id: lesson.session_id, topic: lesson.title, ended_at: null }` (status surfaced via a small `status` chip). Header shows `subject.title` + `sidebar-subject-progress-<id>` = `{{ progress.done_count }}/{{ progress.total_count }}`. Reuse `.sb-section-label`/`.sb-row` token styling.

- [ ] **Step 4** Modify `Sidebar.vue`: import `useSubjectStore`, `SidebarSubjectNode`. `onMounted` also `subjectStore.listSubjects().catch(() => {})` (guard like the sessions fetch). In the expanded active view, render a `sidebar-subjects-group` section of `SidebarSubjectNode` above the existing buckets, and wrap today's flat session list in a `sidebar-quick-group` (only sessions with `!s.subject_id`). Derive quick sessions via a `computed` filtering `sessions` by `!s.subject_id`; pass that to the existing grouping rather than the raw list. Keep all existing testids intact (grep `sidebar-section-active` etc. first — do not rename).

- [ ] **Step 5** Run `npm run test:unit -- --run sidebarSubjectGroup` and `npm run test:unit -- --run sidebar` (existing) — expect PASS, no regressions. `npm run lint`. Commit: `feat(subjects): sidebar subject nodes + quick-session group`.

---

## Task 8 — Lesson-aware SessionView (context bar + back-link)

**Files:**
- Create: `frontend/src/components/chat/LessonContextBar.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/sessionLessonAware.test.js`

**Interfaces:**
- Consumes: `useSessionStore.currentSession.subject_id` (assumed exposed by `GET /sessions/{id}`); `useSubjectStore.loadSubject(subject_id)` then match `lesson.session_id === props.id` for `{ lessonId, title, goal }`; router `subject-overview`.
- Produces: component `LessonContextBar` props `{ goal, subjectId }`; testids `session-lesson-goal`, `session-lesson-back`.

- [ ] **Step 1** Failing test `sessionLessonAware.test.js` — mount `LessonContextBar` directly (keeps SessionView's heavy child tree out):

```js
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({ RouterLink: { props: ['to'], template: '<a><slot /></a>' } }))
import LessonContextBar from '@/components/chat/LessonContextBar.vue'

describe('LessonContextBar', () => {
  it('renders the lesson goal and a back-link to the subject overview', () => {
    const wrapper = mount(LessonContextBar, { props: { goal: 'Understand bonding', subjectId: 's1' } })
    expect(wrapper.get('[data-testid="session-lesson-goal"]').text()).toContain('Understand bonding')
    const back = wrapper.findComponent({ name: 'RouterLink' })
    expect(wrapper.get('[data-testid="session-lesson-back"]')).toBeTruthy()
  })

  it('renders nothing when there is no goal', () => {
    const wrapper = mount(LessonContextBar, { props: { goal: '', subjectId: 's1' } })
    expect(wrapper.find('[data-testid="session-lesson-goal"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2** Run `npm run test:unit -- --run sessionLessonAware` — expect FAIL.
- [ ] **Step 3** Create `LessonContextBar.vue`:

```html
<script setup>
defineProps({ goal: { type: String, default: '' }, subjectId: { type: String, default: '' } })
</script>
<template>
  <div v-if="goal" class="lesson-bar">
    <RouterLink v-if="subjectId" class="lesson-back" data-testid="session-lesson-back"
                :to="{ name: 'subject-overview', params: { id: subjectId } }">
      <i class="pi pi-arrow-left" aria-hidden="true" /> Subject
    </RouterLink>
    <p class="lesson-goal" data-testid="session-lesson-goal">{{ goal }}</p>
  </div>
</template>
<style scoped>
.lesson-bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem;
  background: var(--color-surface-soft); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.lesson-back { display: inline-flex; align-items: center; gap: 0.25rem; flex-shrink: 0;
  font-family: var(--font-sans); font-size: var(--fs-caption); font-weight: 600; color: var(--color-accent-text); }
.lesson-goal { margin: 0; color: var(--color-text-muted); font-size: var(--fs-caption); }
</style>
```

- [ ] **Step 4** Modify `SessionView.vue`: add `useSubjectStore`; a `lesson` ref `{ id, title, goal }` and `lessonSubjectId`. In `loadCurrent`, after `store.loadSession(id)`, if `store.currentSession?.subject_id`, call `subjectStore.loadSubject(subject_id)` and set `lesson` to the one whose `session_id === id` (best-effort; wrap in try/catch, never block chat). Mount `<LessonContextBar :goal="lesson?.goal || ''" :subject-id="lessonSubjectId || ''" />` directly under `<SessionHeader>`. Expose `lesson` to Task 9.

- [ ] **Step 5** Run `npm run test:unit -- --run sessionLessonAware` and `npm run test:unit -- --run sessionView` (existing) — expect PASS, no regressions. `npm run lint`. Commit: `feat(subjects): lesson context bar + back-link in SessionView`.

---

## Task 9 — Mark-done confirm

**Files:**
- Create: `frontend/src/components/chat/MarkDoneConfirm.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Test: `frontend/src/__tests__/sessionLessonAware.test.js` (extend)

**Interfaces:**
- Consumes: the lesson `{ id, title }` from Task 8; `useSubjectStore.markLessonDone(lessonId)` -> `PATCH /lessons/{id} {status:'done'}`; `useToast.showInfo` for the toast.
- Produces: component `MarkDoneConfirm` props `{ lessonTitle }`, emits `confirm`, `dismiss`; testids `session-markdone`, `session-markdone-yes`, `session-markdone-keep`.

Mastery-signal source (do NOT invent a scorer — flagged for reconciliation): the prompt is gated on the **existing graded results** the session store already holds — a just-completed check batch whose items are all `correct === true` for the lesson's target gap. Concretely, watch `store.messages` for the latest message with a `check_batch` whose `items.every((it) => it.correct === true)` and fire once per lesson per session (`suggestedLessons` Set guard). This reads existing per-item `correct` flags (no new evaluation pass, matching Spec B "reuses the existing mastery signal"). OPEN QUESTION for the executor: if the tutor/check flow exposes a more direct "target gap cleared" field (e.g. `focus_target_gap` clearing on `currentSession.topic_profile`), prefer that; reconcile before finalizing.

- [ ] **Step 1** Extend `sessionLessonAware.test.js`:

```js
import MarkDoneConfirm from '@/components/chat/MarkDoneConfirm.vue'

it('MarkDoneConfirm emits confirm on Yes and dismiss on Keep going', async () => {
  const wrapper = mount(MarkDoneConfirm, { props: { lessonTitle: 'Reactions' } })
  expect(wrapper.get('[data-testid="session-markdone"]').text()).toContain('Reactions')
  await wrapper.get('[data-testid="session-markdone-yes"]').trigger('click')
  expect(wrapper.emitted('confirm')).toBeTruthy()
  await wrapper.get('[data-testid="session-markdone-keep"]').trigger('click')
  expect(wrapper.emitted('dismiss')).toBeTruthy()
})
```

Add a store-level test for the write path (mirrors `subjectStore.test.js`): `markLessonDone` already covered in Task 2 — here assert SessionView's handler calls it. Keep this as a focused component test plus the existing store coverage; a full SessionView mount is out of scope (heavy child tree).

- [ ] **Step 2** Run `npm run test:unit -- --run sessionLessonAware` — expect FAIL.
- [ ] **Step 3** Create `MarkDoneConfirm.vue`:

```html
<script setup>
defineProps({ lessonTitle: { type: String, required: true } })
defineEmits(['confirm', 'dismiss'])
</script>
<template>
  <div class="markdone" data-testid="session-markdone" role="status">
    <p class="markdone-text">Looks like you have got this — mark <strong>{{ lessonTitle }}</strong> done?</p>
    <div class="markdone-actions">
      <button type="button" class="markdone-yes" data-testid="session-markdone-yes" @click="$emit('confirm')">Yes</button>
      <button type="button" class="markdone-keep" data-testid="session-markdone-keep" @click="$emit('dismiss')">Keep going</button>
    </div>
  </div>
</template>
<style scoped>
.markdone { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.75rem 1rem; background: var(--color-accent-soft); border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg); }
.markdone-text { margin: 0; color: var(--color-text); font-size: 0.9375rem; }
.markdone-actions { display: inline-flex; gap: 0.5rem; }
.markdone-yes { padding: 0.4rem 1rem; border: 0; border-radius: var(--radius-pill);
  background: var(--color-accent-strong); color: #FFFFFF; font-weight: 600; cursor: pointer; box-shadow: var(--shadow-pop); }
.markdone-keep { padding: 0.4rem 1rem; border: 1px solid var(--color-border-strong); border-radius: var(--radius-pill);
  background: var(--color-surface); color: var(--color-text-muted); font-weight: 600; cursor: pointer; }
</style>
```

- [ ] **Step 4** Modify `SessionView.vue`: add `showMarkDone` ref + `suggestedLessons` Set. Watch the messages/check signal described above; when it fires and a `lesson` is present and not yet suggested, set `showMarkDone = true`. Render `<MarkDoneConfirm v-if="showMarkDone && lesson" :lesson-title="lesson.title" @confirm="onMarkDone" @dismiss="showMarkDone = false" />` above the composer. Handler:

```js
async function onMarkDone() {
  showMarkDone.value = false
  if (!lesson.value) return
  suggestedLessons.add(lesson.value.id)
  try {
    await subjectStore.markLessonDone(lesson.value.id)
    showInfo('Lesson marked done. Progress updates on your next visit to the subject.', { summary: 'Marked done', life: 5000 })
  } catch (e) {
    lastError.value = e
  }
}
```

- [ ] **Step 5** Run `npm run test:unit -- --run sessionLessonAware` and `npm run test:unit -- --run sessionView` — expect PASS. `npm run lint`. Commit: `feat(subjects): mark-lesson-done inline confirm in SessionView`.

---

## Task 10 — Playwright e2e: blank-path subject create

**Files:**
- Create: `frontend/e2e/subject-blank-create.spec.js`

**Interfaces:**
- Consumes testids from Tasks 3-8: `home-mode-subject`/`home-build-start`, `wizard-*`, `subject-*`, `session-input`/`session-send`.

Deterministic, no live LLM: drives the **blank** path only (draft is mocked/avoided). The existing e2e harness is currently `test.describe.skip(...)` pending the Phase-8 auth+Postgres rebuild (see `onboarding-to-chat.spec.js`); follow that convention — write the spec under `test.describe.skip(...)` with a matching TODO so it lands ready and is un-skipped when the harness is restored. Mirror the existing `beforeEach` cookie/localStorage clear.

- [ ] **Step 1** Create `frontend/e2e/subject-blank-create.spec.js`:

```js
import { test, expect } from '@playwright/test'

// TODO(phase-8): un-skip when the auth-session seeding helper + Postgres service
// in e2e.yml land (same gate as onboarding-to-chat.spec.js). Blank path only —
// no live LLM; the draft path is covered by mocked unit tests.
test.describe.skip('subject blank create', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
    await context.addInitScript(() => { try { localStorage.clear() } catch { /* ignore */ } })
  })

  test('build a blank subject, open a lesson, send a message, return to overview', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('home-build-start').click()
    await expect(page).toHaveURL(/\/subjects\/new$/)

    await page.getByTestId('wizard-title-input').fill('Organic Chemistry')
    await page.getByTestId('wizard-next').click()       // -> duration
    await page.getByTestId('wizard-timeline-14').click()
    await page.getByTestId('wizard-next').click()       // -> plan source
    await page.getByTestId('wizard-mode-blank').click() // -> editor

    await page.getByTestId('wizard-lesson-title').fill('Bonding basics')
    await page.getByTestId('wizard-lesson-goal').fill('Understand covalent bonds')
    await page.getByTestId('wizard-add-lesson').click()
    await page.getByTestId('wizard-create').click()

    await expect(page).toHaveURL(/\/subjects\/[^/]+$/)
    await expect(page.getByTestId('subject-overview')).toBeVisible()

    await page.getByTestId('subject-open-next').click()
    await expect(page).toHaveURL(/\/session\//)
    await page.getByTestId('session-input').fill('what is a covalent bond?')
    await page.getByTestId('session-send').click()
    await expect(page.getByTestId('session-lesson-back')).toBeVisible()

    await page.getByTestId('session-lesson-back').click()
    await expect(page.getByTestId('subject-overview')).toBeVisible()
  })
})
```

- [ ] **Step 2** Confirm the file is collected without syntax error: `npx playwright test subject-blank-create --list` from `frontend/` (lists the skipped test). `npm run lint`. Commit: `test(subjects): e2e blank-path subject create (skipped pending phase-8 harness)`.

---

## Self-review checklist (done while writing)

- Every Spec B section maps to a task: §1 Homepage -> Task 3; §2 Wizard -> Tasks 4-5; §3 Overview -> Task 6; §4 Sidebar -> Task 7; §5 Lesson-aware session -> Tasks 8-9; State/Stores -> Tasks 1-2; Testing (unit) -> Tasks 1-9; Testing (e2e) -> Task 10.
- No placeholders: every code step is real Vue/JS using the verified tokens (`--color-accent-strong`, `--color-accent-soft`, `--radius-card`, `--signal-success`, `--font-display`) and Spec A field names (`per_session_minutes`, `timeline_days`, `order_idx`, `status`, `session_id`, `done_count`, `total_count`).
- Names consistent across tasks: store `useSubjectStore` actions (`loadSubject`, `openLesson`, `markLessonDone`), components (`SubjectWizardView`, `SubjectOverview`, `SidebarSubjectNode`, `LessonContextBar`, `MarkDoneConfirm`), route names (`subject-new`, `subject-overview`), and testids are reused verbatim downstream.
- Wizard review/edit ambiguity is CLOSED: Spec A's reconciled `POST /subjects/draft-plan` preview means both paths review/edit lessons in one shared editor before a single `POST /subjects` commit (Spec B §2 step 4 honored); the earlier "overview is the review surface" resolution is removed.
- Open items flagged in-plan: response-shape assumptions (reconcile with `openapi.yaml`), session->lesson resolution via `GET /subjects/{id}` match, and mastery-signal source (prefer a direct cleared-gap field if the check flow exposes one).
