# Remove AI Multi-Lesson Plan Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the LLM-driven 3-12 lesson plan generation from subject creation; a new subject seeds exactly one lesson titled after the subject and lands on the overview.

**Architecture:** Surgical removal. The Subject -> Lessons -> Sessions model, subject overview, `subject_profile_service`, and `plan_revision_service` (tutor practice-lesson suggestion) are untouched. We delete `plan_service` (the AI drafter), the `POST /subjects/draft-plan` route + its request/response contracts, and the `mode`/`lessons` fields on `SubjectCreateRequest`. The route now seeds a single `LessonDraft`. The wizard collapses from 4 steps to 2 (title -> duration -> Create). No DB migration.

**Tech Stack:** FastAPI + Pydantic (contracts codegen via `datamodel-code-generator`), SQLAlchemy, pytest; Vue 3 + Pinia + Vitest.

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py`. Never hand-edit `backend/contracts/models.py`. CI enforces zero drift.
- `LessonDraft` schema is KEPT in openapi.yaml (codegen emits all `components/schemas` regardless of references; it stays importable from `contracts`).
- No new Alembic migration; the Subject/Lesson schema is unchanged. Do not touch `test_migration_chain.py`.
- Source of truth: `docs/superpowers/specs/2026-06-30-remove-ai-multilesson-plan-design.md`.
- Backend tests run from `backend/`: `pytest`. Frontend from `frontend/`: `npm run test:unit -- --run`.
- The seeded lesson: `title = subject.title`, `goal = f"Introduction to {title}."`.

---

### Task 1: Contracts — drop draft-plan path + schemas, simplify SubjectCreateRequest

**Files:**
- Modify: `docs/api/openapi.yaml`
- Generated (do not hand-edit): `backend/contracts/models.py`
- Test: `backend/tests/test_contracts_subjects.py`

**Interfaces:**
- Produces: `SubjectCreateRequest` with fields `title`, `per_session_minutes`, `duration_mode`, `timeline_days`, `pace_per_week` (no `mode`, no `lessons`); `required: [title, per_session_minutes, duration_mode]`. `LessonDraft` still importable from `contracts`. `DraftPlanRequest`/`DraftPlanResponse` no longer exist.

- [ ] **Step 1: Update the contract import test to the new surface**

Replace the whole body of `backend/tests/test_contracts_subjects.py` with:

```python
"""TDD: subjects/lessons contracts are generated from openapi.yaml."""

import pytest
from pydantic import ValidationError


def test_subject_contracts_import():
    from contracts import (
        LessonCreateRequest,
        LessonDraft,
        LessonItem,
        LessonOpenResponse,
        LessonUpdateRequest,
        SubjectCreateRequest,
        SubjectDetail,
        SubjectListItem,
        SubjectProgress,
        SubjectUpdateRequest,
    )

    req = SubjectCreateRequest(
        title="Organic Chemistry", per_session_minutes=30,
        duration_mode="deadline", timeline_days=14,
    )
    assert req.duration_mode == "deadline"
    assert req.timeline_days == 14
    assert req.pace_per_week is None

    # LessonDraft survives codegen (used internally by the create route/service).
    draft = LessonDraft(title="Bonding", goal="learn bonds")
    assert draft.title == "Bonding"

    prog = SubjectProgress(done_count=1, total_count=3)
    assert prog.total_count == 3
    open_resp = LessonOpenResponse(session_id="s1", status="in_progress")
    assert open_resp.session_id == "s1"


def test_subject_create_rejects_removed_fields():
    from contracts import SubjectCreateRequest

    # `mode` and `lessons` were removed; additionalProperties:false -> rejected.
    with pytest.raises(ValidationError):
        SubjectCreateRequest(
            title="X", per_session_minutes=30, duration_mode="deadline",
            timeline_days=14, mode="blank",
        )


def test_draft_plan_contracts_removed():
    import contracts

    assert not hasattr(contracts, "DraftPlanRequest")
    assert not hasattr(contracts, "DraftPlanResponse")


def test_subject_update_duration_mode_enum():
    from contracts import SubjectUpdateRequest

    req_deadline = SubjectUpdateRequest(duration_mode="deadline")
    assert req_deadline.duration_mode == "deadline"

    req_pace = SubjectUpdateRequest(duration_mode="pace")
    assert req_pace.duration_mode == "pace"

    req_none = SubjectUpdateRequest(duration_mode=None)
    assert req_none.duration_mode is None

    with pytest.raises(ValidationError):
        SubjectUpdateRequest(duration_mode="whenever")
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `pytest tests/test_contracts_subjects.py -q`
Expected: FAIL — `test_subject_create_rejects_removed_fields` does not raise (mode still allowed) and/or `test_draft_plan_contracts_removed` fails (DraftPlanRequest still present).

- [ ] **Step 3: Edit `docs/api/openapi.yaml` — delete the draft-plan path**

Find the path block (under `paths:`, around the `\api\subjects\draft-plan:` key) and delete the entire `\api\subjects\draft-plan:` path entry including its `post:` body, `requestBody` ($ref DraftPlanRequest), and `responses` (200 -> DraftPlanResponse). It sits between the `\api\subjects:` path and the `\api\subjects\{subject_id}:` path.

- [ ] **Step 4: Edit `docs/api/openapi.yaml` — delete DraftPlanRequest and DraftPlanResponse schemas**

Under `components: schemas:`, delete these two whole schema blocks:

```yaml
    DraftPlanRequest:
      type: object
      additionalProperties: false
      required: [title, per_session_minutes, duration_mode]
      description: |
        Preview-draft inputs for the wizard review step (no persistence). Carries
        duration_mode plus exactly one of timeline_days (deadline mode) or
        pace_per_week (pace mode) — the pinned duration field.
      properties:
        title:               { type: string, maxLength: 200 }
        per_session_minutes: { type: integer, enum: [15, 30, 60] }
        duration_mode:       { type: string, enum: [deadline, pace] }
        timeline_days:       { type: [integer, "null"], default: null }
        pace_per_week:       { type: [integer, "null"], default: null }

    DraftPlanResponse:
      type: object
      additionalProperties: false
      required: [lessons]
      ...
      properties:
        lessons:
          type: array
          items: { $ref: "#/components/schemas/LessonDraft" }
```

Leave the `LessonDraft:` schema in place (it stays referenced by the route/service code).

- [ ] **Step 5: Edit `docs/api/openapi.yaml` — simplify SubjectCreateRequest**

Replace the `SubjectCreateRequest:` schema block with:

```yaml
    SubjectCreateRequest:
      type: object
      additionalProperties: false
      required: [title, per_session_minutes, duration_mode]
      description: |
        Create a subject. The server seeds exactly one lesson titled after the
        subject; more lessons are added later via POST /subjects/{id}/lessons or
        the tutor practice-lesson suggestion. Duration is a user-toggled pair:
        duration_mode plus exactly one of timeline_days (deadline) or
        pace_per_week (pace); the other is derived on read.
      properties:
        title:               { type: string, maxLength: 200 }
        per_session_minutes: { type: integer, enum: [15, 30, 60] }
        duration_mode:       { type: string, enum: [deadline, pace] }
        timeline_days:       { type: [integer, "null"], default: null }
        pace_per_week:       { type: [integer, "null"], default: null }
```

- [ ] **Step 6: Regenerate contracts**

Run (from repo root): `python backend/scripts/gen_contracts.py`
Expected: `ok: contracts written to ...backend/contracts/models.py`.

- [ ] **Step 7: Run the contract test to verify it passes**

Run (from `backend/`): `pytest tests/test_contracts_subjects.py -q`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/tests/test_contracts_subjects.py
git commit -m "feat(contracts): drop draft-plan path + mode/lessons from SubjectCreateRequest"
```

---

### Task 2: Backend — seed one lesson in the route, delete plan_service

**Files:**
- Modify: `backend/routes/subjects.py`
- Delete: `backend/services/plan_service.py`
- Delete: `backend/tests/test_plan_service.py`
- Test: `backend/tests/test_subjects_route.py`
- Unchanged (verify still green): `backend/tests/test_subject_service.py`

**Interfaces:**
- Consumes: `SubjectCreateRequest` (no `mode`/`lessons`) from Task 1; `LessonDraft` from `contracts`; `subject_service.create_subject(db, user_id, title, per_session_minutes, duration_mode, timeline_days, pace_per_week, lessons)` (unchanged signature).
- Produces: `POST /api/subjects` persists exactly one lesson titled `req.title`, goal `f"Introduction to {req.title}."`. No `POST /api/subjects/draft-plan` route exists.

- [ ] **Step 1: Rewrite the create/draft route tests**

In `backend/tests/test_subjects_route.py`:

(a) Delete the module-level import `from services import plan_service` (line 6).

(b) Replace the `_create_blank` helper (lines 18-30) with a `_create` helper that sends no `mode`/`lessons`:

```python
def _create(client, title="Organic Chem", duration_mode="deadline",
            timeline_days=14, pace_per_week=None):
    body = {
        "user_id": USER_ID,
        "title": title,
        "per_session_minutes": 30,
        "duration_mode": duration_mode,
    }
    if timeline_days is not None:
        body["timeline_days"] = timeline_days
    if pace_per_week is not None:
        body["pace_per_week"] = pace_per_week
    return client.post("/api/subjects", json=body)
```

(c) Delete these two tests entirely (the draft path is gone): `test_create_draft_calls_plan_service` and `test_draft_plan_preview_returns_lessons_metered_no_persist`.

(d) Replace `test_create_blank_persists_body_lessons` with a single-seed test:

```python
def test_create_seeds_one_lesson_titled_after_subject(client, seeded_user):
    r = _create(client, title="Organic Chem")
    assert r.status_code == 201, r.text
    body = r.json()
    assert [l["title"] for l in body["lessons"]] == ["Organic Chem"]
    assert body["lessons"][0]["goal"] == "Introduction to Organic Chem."
    assert body["lessons"][0]["status"] == "not_started"
    assert body["progress"] == {"done_count": 0, "total_count": 1}
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14
```

(e) Every other call to `_create_blank(client)` becomes `_create(client)`. For the tests that previously seeded multiple lessons to exercise duration derivation, add the extra lessons via the add-lesson route. Replace `test_get_subject_returns_pinned_and_derived_duration` and `test_patch_subject_change_duration_to_pace` with:

```python
def _add_lessons(client, sid, n):
    for i in range(n):
        client.post(f"/api/subjects/{sid}/lessons?user_id={USER_ID}",
                    json={"title": f"L{i}", "goal": "g"})


def test_get_subject_returns_pinned_and_derived_duration(client, seeded_user):
    # 1 seeded + 3 added = 4 lessons; deadline 14d -> derived pace ceil(4/2)=2.
    sid = _create(client).json()["id"]
    _add_lessons(client, sid, 3)
    body = client.get(f"/api/subjects/{sid}?user_id={USER_ID}").json()
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 14
    assert body["pace_per_week"] == 2


def test_patch_subject_change_duration_to_pace(client, seeded_user):
    # 4 lessons; switch to pace pinned 1/week -> derived timeline 4*7=28.
    sid = _create(client).json()["id"]
    _add_lessons(client, sid, 3)
    r = client.patch(
        f"/api/subjects/{sid}?user_id={USER_ID}",
        json={"duration_mode": "pace", "pace_per_week": 1},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["duration_mode"] == "pace"
    assert body["pace_per_week"] == 1
    assert body["timeline_days"] == 28
```

(f) Update the duration-invariant create tests to the new helper (they no longer send `mode`/`lessons`):

```python
def test_create_deadline_missing_timeline_days_400(client, seeded_user):
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Bad Deadline",
              "per_session_minutes": 30, "duration_mode": "deadline"},
    )
    assert r.status_code == 400


def test_create_pace_missing_pace_per_week_400(client, seeded_user):
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Bad Pace",
              "per_session_minutes": 30, "duration_mode": "pace"},
    )
    assert r.status_code == 400


def test_create_deadline_complement_nulled(client, seeded_user):
    # Sending both: complement (pace_per_week) nulled; response derives from the
    # single seeded lesson -> ceil(1 / 1 week) = 1.
    r = client.post(
        "/api/subjects",
        json={"user_id": USER_ID, "title": "Deadline Both",
              "per_session_minutes": 30, "duration_mode": "deadline",
              "timeline_days": 7, "pace_per_week": 99},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["duration_mode"] == "deadline"
    assert body["timeline_days"] == 7
    assert body["pace_per_week"] == 1
```

(g) For the lesson-lifecycle tests that used `_create_blank(...).json()["lessons"][0]["id"]`, switch to `_create(client).json()["lessons"][0]["id"]` (there is exactly one seeded lesson, so index 0 is valid). This covers `test_patch_lesson_status_done`, `test_patch_lesson_invalid_status_400`, `test_open_lesson_idempotent`, `test_delete_lesson_with_session_409`, `test_delete_lesson_without_session_204`, `test_delete_lesson_force_ends_session_and_deletes`, `test_lesson_routes_404_cross_user`, `test_add_lesson_appends` (use the seeded lesson, then add "B" -> order_idx 1). Also `test_list_subjects_scoped`, `test_get_subject_404_cross_user`, `test_patch_subject_archive`, `test_patch_subject_empty_body_400`, `test_patch_subject_invalid_duration_mode_422`, `test_patch_subject_404_cross_user`, `test_add_lesson_404_cross_user` swap `_create_blank` -> `_create`.

- [ ] **Step 2: Run the route tests to verify they fail**

Run (from `backend/`): `pytest tests/test_subjects_route.py -q`
Expected: FAIL — import error (`plan_service` deleted? not yet) or `ModuleNotFoundError` / route still reads `mode`. At minimum `test_create_seeds_one_lesson_titled_after_subject` fails because the route still persists body lessons.

- [ ] **Step 3: Update the route — seed one lesson, remove the draft route**

In `backend/routes/subjects.py`:

(a) In the contracts import block, remove `DraftPlanRequest,` and `DraftPlanResponse,`; add `LessonDraft,`. Result includes:

```python
from contracts import (
    LessonCreateRequest,
    LessonDraft,
    LessonItem,
    LessonOpenResponse,
    LessonUpdateRequest,
    SubjectCreateRequest,
    SubjectDetail,
    SubjectListItem,
    SubjectProgress,
    SubjectProfileResponse,
    SubjectUpdateRequest,
)
```

(b) Remove `plan_service` from `from services import plan_service, subject_profile_service, subject_service` -> `from services import subject_profile_service, subject_service`.

(c) Replace the body of `create_subject` (the `if req.mode == "draft": ... else: drafts = req.lessons or []` block) so it seeds one lesson:

```python
    # Null the complement so only the pinned field is stored.
    timeline_days = req.timeline_days if req.duration_mode == "deadline" else None
    pace_per_week = req.pace_per_week if req.duration_mode == "pace" else None
    # Seed exactly one lesson titled after the subject; more are added later via
    # POST /subjects/{id}/lessons or the tutor practice-lesson suggestion.
    drafts = [LessonDraft(title=req.title, goal=f"Introduction to {req.title}.")]
    subject = subject_service.create_subject(
        db, user_id, req.title, req.per_session_minutes,
        req.duration_mode, timeline_days, pace_per_week, drafts,
    )
    return _subject_detail(db, subject)
```

Keep the duration-invariant 400 checks at the top of the function unchanged.

(d) Delete the entire `draft_plan_preview` route function (the `@router.post("/subjects/draft-plan", ...)` handler).

- [ ] **Step 4: Delete the AI drafter and its test**

```bash
git rm backend/services/plan_service.py backend/tests/test_plan_service.py
```

- [ ] **Step 5: Run the affected backend tests**

Run (from `backend/`): `pytest tests/test_subjects_route.py tests/test_subject_service.py tests/test_contracts_subjects.py -q`
Expected: PASS. `test_subject_service.py` is unchanged and must stay green (it calls `create_subject` directly with explicit `LessonDraft` fixtures).

- [ ] **Step 6: Run the full backend suite + codegen drift check**

Run (from `backend/`): `pytest -q`
Then (from repo root): `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/models.py`
Expected: all green; `git diff --exit-code` returns 0 (no drift).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/subjects.py backend/tests/test_subjects_route.py
git rm backend/services/plan_service.py backend/tests/test_plan_service.py
git commit -m "feat(backend): seed one lesson on subject create; remove plan_service + draft route"
```

---

### Task 3: Frontend — remove draftPlan from api + store

**Files:**
- Modify: `frontend/src/services/subjectsApi.js`
- Modify: `frontend/src/stores/subject.js`
- Test: `frontend/src/__tests__/subjectsApi.test.js`
- Test: `frontend/src/__tests__/subjectStore.test.js`

**Interfaces:**
- Produces: `subjectsApi` no longer exports `draftPlan`. `useSubjectStore()` no longer exposes `draftPlan`. `createSubject(payload)` forwards `payload` verbatim to `POST /subjects` (caller sends `title`, `per_session_minutes`, duration fields only — no `mode`/`lessons`).

- [ ] **Step 1: Update the api test**

In `frontend/src/__tests__/subjectsApi.test.js`:

(a) Delete the `draftPlan posts ...` test (lines 21-26).

(b) Replace the `createSubject` test so the body carries no `mode`/`lessons`:

```javascript
  it('createSubject posts the pace-mode body verbatim (no mode/lessons)', () => {
    api.createSubject({ title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3 })
    expect(apiPost).toHaveBeenCalledWith('/subjects', {
      title: 'Organic Chemistry', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3,
    })
  })
```

- [ ] **Step 2: Update the store test**

In `frontend/src/__tests__/subjectStore.test.js`:

(a) In the `vi.mock('@/services/subjectsApi.js', ...)` factory (lines 4-7), remove `draftPlan: vi.fn(),`.

(b) Delete the `draftPlan returns the lessons array ...` test (lines 78-85).

- [ ] **Step 3: Run both tests to verify they fail**

Run (from `frontend/`): `npm run test:unit -- --run subjectsApi subjectStore`
Expected: FAIL — `subjectsApi.js` still exports `draftPlan` (old test gone, but `createSubject` mock still references removed surface is fine); the store still defines `draftPlan`. The two updated tests should pass, but the source still contains dead `draftPlan` (lint/coverage); proceed to remove it.

- [ ] **Step 4: Remove draftPlan from the api service**

In `frontend/src/services/subjectsApi.js`, delete the `draftPlan` export and its comment (lines 6-10, the block ending with `export const draftPlan = (payload) => apiPost('/subjects/draft-plan', payload)`).

- [ ] **Step 5: Remove draftPlan from the store**

In `frontend/src/stores/subject.js`:
(a) Delete the entire `async function draftPlan(payload) { ... }` block (lines 49-60).
(b) In the store's return object, remove `draftPlan,` (line 235).

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `frontend/`): `npm run test:unit -- --run subjectsApi subjectStore`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/subjectsApi.js frontend/src/stores/subject.js frontend/src/__tests__/subjectsApi.test.js frontend/src/__tests__/subjectStore.test.js
git commit -m "feat(frontend): drop draftPlan from subjects api + store"
```

---

### Task 4: Frontend — collapse the wizard to title -> duration -> Create

**Files:**
- Modify (rewrite): `frontend/src/views/SubjectWizardView.vue`
- Test (rewrite): `frontend/src/__tests__/subjectWizardView.test.js`

**Interfaces:**
- Consumes: `useSubjectStore().createSubject(payload)` (Task 3). Payload = `{ title, per_session_minutes, duration_mode, (timeline_days | pace_per_week) }`.
- Produces: a 2-step wizard. On Create, calls `store.createSubject(basePayload())` and routes to `{ name: 'subject-overview', params: { id } }`.

- [ ] **Step 1: Rewrite the wizard test**

Replace the whole body of `frontend/src/__tests__/subjectWizardView.test.js` with:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSubjectStore } from '@/stores/subject.js'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('@/services/subjectsApi.js', () => ({ createSubject: vi.fn() }))

import SubjectWizardView from '@/views/SubjectWizardView.vue'

function mountView() { return mount(SubjectWizardView) }

describe('SubjectWizardView (title -> duration -> Create)', () => {
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

  it('duration step defaults to By deadline and shows timeline chips', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-timeline-14"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-pace-stepper"]').exists()).toBe(false)
  })

  it('toggling to By pace swaps timeline chips for the pace stepper', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    expect(wrapper.find('[data-testid="wizard-pace-stepper"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wizard-timeline-14"]').exists()).toBe(false)
  })

  it('pace stepper increments and clamps within 1-5', async () => {
    const wrapper = mountView()
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    expect(wrapper.get('[data-testid="wizard-pace-value"]').text()).toContain('3')
    await wrapper.get('[data-testid="wizard-pace-inc"]').trigger('click')
    expect(wrapper.get('[data-testid="wizard-pace-value"]').text()).toContain('4')
  })

  it('deadline mode: Create commits title + timeline and routes to overview', async () => {
    const wrapper = mountView()
    const store = useSubjectStore()
    vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's9' })
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-timeline-14"]').trigger('click')
    await wrapper.get('[data-testid="wizard-create"]').trigger('click')
    await flushPromises()
    expect(store.createSubject).toHaveBeenCalledWith({
      title: 'Chem', per_session_minutes: 30, duration_mode: 'deadline', timeline_days: 14,
    })
    expect(push).toHaveBeenCalledWith({ name: 'subject-overview', params: { id: 's9' } })
  })

  it('pace mode: Create commits pace_per_week and omits timeline_days', async () => {
    const wrapper = mountView()
    const store = useSubjectStore()
    vi.spyOn(store, 'createSubject').mockResolvedValue({ id: 's5' })
    await wrapper.get('[data-testid="wizard-title-input"]').setValue('Chem')
    await wrapper.get('[data-testid="wizard-next"]').trigger('click')
    await wrapper.get('[data-testid="wizard-duration-mode-pace"]').trigger('click')
    await wrapper.get('[data-testid="wizard-create"]').trigger('click')
    await flushPromises()
    expect(store.createSubject).toHaveBeenCalledWith({
      title: 'Chem', per_session_minutes: 30, duration_mode: 'pace', pace_per_week: 3,
    })
    expect(push).toHaveBeenCalledWith({ name: 'subject-overview', params: { id: 's5' } })
  })
})
```

- [ ] **Step 2: Run the wizard test to verify it fails**

Run (from `frontend/`): `npm run test:unit -- --run subjectWizardView`
Expected: FAIL — the old wizard has no `wizard-create` button on the duration step; the source step still exists.

- [ ] **Step 3: Rewrite `SubjectWizardView.vue`**

Replace the entire file with:

```vue
<template>
  <section class="wizard">
    <!-- ─── Title step ─── -->
    <template v-if="step === 'title'">
      <h1 class="wizard-heading">New Subject</h1>
      <div class="wizard-field">
        <label for="wizard-title-input" class="sr-only">Subject title</label>
        <input
          id="wizard-title-input"
          v-model="title"
          data-testid="wizard-title-input"
          class="wizard-input"
          placeholder="e.g. Organic Chemistry"
          autocomplete="off"
        />
      </div>
      <div class="wizard-nav">
        <button
          type="button"
          data-testid="wizard-next"
          class="wizard-btn wizard-btn--primary"
          :disabled="!title.trim()"
          @click="step = 'duration'"
        >
          Next
        </button>
      </div>
    </template>

    <!-- ─── Duration step ─── -->
    <template v-else-if="step === 'duration'">
      <h2 class="wizard-heading">Session duration</h2>

      <!-- Minutes chips -->
      <div class="wizard-chip-group" role="group" aria-label="Minutes per session">
        <button
          v-for="mins in [15, 30, 60]"
          :key="mins"
          type="button"
          :data-testid="`wizard-minutes-${mins}`"
          class="wizard-chip"
          :class="{ active: selectedMinutes === mins }"
          :aria-pressed="String(selectedMinutes === mins)"
          @click="selectedMinutes = mins"
        >
          {{ mins }} min
        </button>
      </div>

      <!-- Duration-mode toggle -->
      <div class="wizard-toggle" role="group" aria-label="Duration mode">
        <button
          type="button"
          data-testid="wizard-duration-mode-deadline"
          class="wizard-toggle-btn"
          :class="{ active: durationMode === 'deadline' }"
          :aria-pressed="String(durationMode === 'deadline')"
          @click="durationMode = 'deadline'"
        >
          By deadline
        </button>
        <button
          type="button"
          data-testid="wizard-duration-mode-pace"
          class="wizard-toggle-btn"
          :class="{ active: durationMode === 'pace' }"
          :aria-pressed="String(durationMode === 'pace')"
          @click="durationMode = 'pace'"
        >
          By pace
        </button>
      </div>

      <!-- Deadline knob: timeline chips -->
      <template v-if="durationMode === 'deadline'">
        <div class="wizard-chip-group" role="group" aria-label="Target timeline">
          <button
            v-for="days in [7, 14, 30]"
            :key="days"
            type="button"
            :data-testid="`wizard-timeline-${days}`"
            class="wizard-chip"
            :class="{ active: selectedTimeline === days }"
            :aria-pressed="String(selectedTimeline === days)"
            @click="selectedTimeline = days"
          >
            {{ days }} days
          </button>
        </div>
      </template>

      <!-- Pace knob: stepper -->
      <template v-else>
        <div class="wizard-pace-stepper" data-testid="wizard-pace-stepper">
          <button
            type="button"
            data-testid="wizard-pace-dec"
            class="wizard-pace-btn"
            :disabled="pacePerWeek <= 1"
            @click="decPace"
          >
            &minus;
          </button>
          <span data-testid="wizard-pace-value" class="wizard-pace-val">{{ pacePerWeek }}</span>
          <button
            type="button"
            data-testid="wizard-pace-inc"
            class="wizard-pace-btn"
            :disabled="pacePerWeek >= 5"
            @click="incPace"
          >
            +
          </button>
          <span class="wizard-pace-label">lessons / week</span>
        </div>
      </template>

      <div class="wizard-nav">
        <button type="button" data-testid="wizard-back" class="wizard-btn" @click="step = 'title'">
          Back
        </button>
        <button
          type="button"
          data-testid="wizard-create"
          class="wizard-btn wizard-btn--primary"
          @click="commitCreate"
        >
          Create subject
        </button>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSubjectStore } from '../stores/subject.js'

const router = useRouter()
const store = useSubjectStore()

// Step state machine: 'title' | 'duration'
const step = ref('title')

// Title step
const title = ref('')

// Duration step
const selectedMinutes = ref(30)
const durationMode = ref('deadline')
const selectedTimeline = ref(14)
const pacePerWeek = ref(3)

function incPace() {
  if (pacePerWeek.value < 5) pacePerWeek.value++
}

function decPace() {
  if (pacePerWeek.value > 1) pacePerWeek.value--
}

// Only the pinned duration knob is sent.
function durationPayload() {
  return durationMode.value === 'deadline'
    ? { duration_mode: 'deadline', timeline_days: selectedTimeline.value }
    : { duration_mode: 'pace', pace_per_week: pacePerWeek.value }
}

function basePayload() {
  return { title: title.value.trim(), per_session_minutes: selectedMinutes.value, ...durationPayload() }
}

async function commitCreate() {
  const subject = await store.createSubject(basePayload())
  if (subject) router.push({ name: 'subject-overview', params: { id: subject.id } })
}
</script>

<style scoped>
.wizard {
  max-width: 560px;
  margin: 2rem auto;
  padding: 1.5rem;
}

.wizard-heading {
  margin-block: 0 1.25rem;
  font-size: 1.375rem;
  font-weight: 600;
  color: var(--color-heading);
}

.wizard-field {
  margin-block-end: 1rem;
}

.wizard-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card, 8px);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 1rem;
  outline: none;
  box-sizing: border-box;
}

.wizard-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-ring);
}

/* Chip groups */
.wizard-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block-end: 1rem;
}

.wizard-chip {
  padding: 0.375rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.wizard-chip:hover {
  border-color: var(--color-accent-soft);
}

.wizard-chip.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Duration-mode toggle */
.wizard-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  overflow: hidden;
  margin-block-end: 1rem;
}

.wizard-toggle-btn {
  flex: 1;
  padding: 0.375rem 1rem;
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.15s, color 0.15s;
}

.wizard-toggle-btn.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

/* Pace stepper */
.wizard-pace-stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-block-end: 1rem;
}

.wizard-pace-btn {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.wizard-pace-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.wizard-pace-val {
  min-width: 1.5rem;
  text-align: center;
  font-weight: 600;
}

.wizard-pace-label {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

/* Navigation row */
.wizard-nav {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.wizard-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.9375rem;
}

.wizard-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-text-on-accent);
}

.wizard-btn--primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
```

- [ ] **Step 4: Run the wizard test to verify it passes**

Run (from `frontend/`): `npm run test:unit -- --run subjectWizardView`
Expected: PASS.

- [ ] **Step 5: Full frontend suite + lint**

Run (from `frontend/`): `npm run test:unit -- --run` then `npm run lint`
Expected: all green; no unused-import/var warnings (the wizard no longer imports `pace.js` utils or `flushPromises` it does not use). If `frontend/src/utils/pace.js` is now imported nowhere, leave it — `subjectStore.test.js` still tests `derivePace`/`deriveHorizonWeeks` directly.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/SubjectWizardView.vue frontend/src/__tests__/subjectWizardView.test.js
git commit -m "feat(frontend): collapse subject wizard to title -> duration -> create"
```

---

## Self-Review

- **Spec coverage:** contracts removal (Task 1) ✓; plan_service + draft route + seed-one (Task 2) ✓; subject_profile/plan_revision untouched (not in any task — correct, by design) ✓; wizard collapse (Task 4) ✓; api/store draftPlan removal (Task 3) ✓; no migration (Global Constraints + no Alembic task) ✓; LessonDraft kept (Task 1 Step 4 note + Task 2 import) ✓.
- **Type consistency:** `create_subject(..., lessons)` signature unchanged across Task 2; `LessonDraft(title, goal)` used identically in route and `test_subject_service.py`; wizard `basePayload()` shape matches the api test (Task 3) and route contract (Task 1).
- **Placeholder scan:** none — every step carries concrete code/commands.

## Verification (whole feature)

- `python backend/scripts/gen_contracts.py` -> no drift (`git diff --exit-code backend/contracts/models.py`).
- Backend `pytest -q` green.
- Frontend `npm run test:unit -- --run` + `npm run lint` green.
- Manual: New Subject = title -> duration -> Create lands on overview with one lesson titled after the subject, openable into chat. No "Draft with AI" anywhere.
