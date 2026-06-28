# Subjects & Lessons — Spec C (Companions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two Spec C companion features on top of a merged Subjects/Lessons system — plan revision mid-subject (overview UI + a deterministic tutor-suggested practice-lesson path) and a subject-level mastery map (new read-only `GET /subjects/{id}/profile` + Vue view).

**Architecture:** The mastery map is a pure read: a new `subject_profile_service.aggregate_for_subject` walks a subject's lessons -> their linked sessions -> `topic_profile_json`, reusing `profile_service._parse_profile` and the union/dedupe approach from `aggregate_for_user`, behind a new user-scoped route. Plan revision is mostly frontend: `SubjectOverview.vue` composes Spec A's existing lesson routes (`POST /subjects/{id}/lessons` + `PATCH /lessons/{id}` for `order_idx`/`title`/`goal` + `DELETE /lessons/{id}`) for add/reorder/rename/delete. The tutor suggestion is a server-side check in the existing `POST /sessions/{id}/check/answer` handler that reads cumulative incorrect `LearningEvent` count per gap and rides the check-answer response back to the client — no new LLM tool, no live-LLM dependency.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (codegen contracts) + pytest on the backend; Vue 3 + Pinia + vue-router + Vitest on the frontend. OpenAPI-first contract generation via `backend/scripts/gen_contracts.py`.

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml` first, then run `python backend/scripts/gen_contracts.py`; CI enforces zero drift (`git diff --exit-code backend/contracts/`).
- Backend tests: `pytest` from `backend/`. Frontend tests: `npm run test:unit -- --run` from `frontend/`.
- User-scoped routes return 404 on cross-user access (never 403 — do not leak existence).
- Reuse the existing aggregation logic (`profile_service._parse_profile`, the union/dedupe pattern in `aggregate_for_user`); do NOT reinvent profile parsing.
- This plan DEPENDS on Spec A (`feat/subjects-lessons` backend: `subjects`/`lessons` tables, `sessions.subject_id`, `routes/subjects.py`, `services/subject_service.py`) AND Spec B (frontend: `SubjectOverview.vue`, `stores/subject.js`, `services/subjectsApi.js`) being merged and smoke-tested first.
- Backend coverage gate is 75%; every new service/route ships with enough tests to clear it.

---

## Decisions resolved before writing (from design review)

1. **Delete-with-session is fully composable (Spec A reconciled 2026-06-28).** `DELETE /lessons/{id}?force=true` ends the session (`ended_at`), clears `lessons.session_id`, then deletes the lesson in one transaction; without `force` a lesson with a session still 409s. Task 8 implements both branches: a direct delete for lessons with no session, and a destructive "End & delete" confirm calling `?force=true` for lessons with a chat. No addendum gap remains.
2. **`open_gaps` naming + shape + semantics.** The model field is `confirmed_gaps`; the subject view exposes it as `open_gaps`. The response uses a NEW simple shape (plain string lists + per-lesson rollup), NOT `AggregateConceptCount` (the mockup shows plain names; `first_seen_session_id` does not map to lessons). Semantics: **disjoint** — `open_gaps = union(confirmed_gaps) - union(mastered_concepts)` so a concept never shows as both "Mastered" and "Still shaky" (matches the mockup). Pinned by a test.
3. **insert-after-current + reorder are composed, not bulk.** Spec A's `POST /subjects/{id}/lessons` appends at end; there is no bulk-reorder route. Insert-after = POST (append) then per-row `PATCH order_idx`. Reorder integrity (contiguous 0-based, no duplicate `order_idx`) is recomputed in the store and written as N single-row PATCHes. Explicit step.
4. **Tutor-suggestion cap is once-per-GAP, deterministic, no new persistence.** The check is server-side in `answer_check`: when cumulative incorrect `LearningEvent` count for `(session_id, gap)` first equals `STRUGGLE_THRESHOLD` (== crossing, fires once), and no lesson titled like the deterministic practice title already exists in the subject, emit `add_lesson_suggestion`. "No thanks" is client-side UX only; the durable post-Add suppressor is the existing-practice-lesson guard. Spec says "once per lesson per session" — accepted as once-per-gap (a multi-gap lesson may suggest per distinct gap); documented, no persistence added to make it strictly per-lesson.

---

## File Structure

### Feature group 2 — Subject-level profile / mastery map (built first)

| File | Created/Modified | Responsibility |
|---|---|---|
| `docs/api/openapi.yaml` | Modified | Add `SubjectLessonRollup` + `SubjectProfileResponse` schemas and the `GET /subjects/{id}/profile` path. |
| `backend/contracts/models.py` | Generated | Regenerated from openapi (do not hand-edit). |
| `backend/services/subject_profile_service.py` | Created | `aggregate_for_subject(db, subject_id)` — walk lessons -> sessions -> `topic_profile_json`, reuse `_parse_profile`, union/dedupe/sort, disjoint gaps, per-lesson rollup. |
| `backend/tests/test_subject_profile_service.py` | Created | Service unit tests: union/dedupe, disjoint gaps, empty subject, unopened lessons. |
| `backend/routes/subjects.py` | Modified (Spec A file) | Add `GET /subjects/{id}/profile` handler (user-scoped 404). |
| `backend/tests/test_subject_profile_route.py` | Created | Route tests: 200 shape, 404 cross-user, empty-but-valid. |
| `frontend/src/services/profileApi.js` | Modified | Add `getSubjectProfile(subjectId)`. |
| `frontend/src/views/SubjectProfileView.vue` | Created | Mastery map: Mastered / Still shaky chips + per-lesson drill-down. |
| `frontend/src/router/index.js` | Modified | Add route `name: 'subject-mastery'`, path `/subjects/:id/profile`. |
| `frontend/src/__tests__/subjectProfileView.test.js` | Created | Vitest: renders mastered/gaps + per-lesson rollup; empty; error. |
| `frontend/src/views/SubjectOverview.vue` | Modified (Spec B file) | Add "View mastery map" link to `subject-mastery`. |

### Feature group 1 — Plan revision mid-subject (built second)

| File | Created/Modified | Responsibility |
|---|---|---|
| `frontend/src/views/SubjectOverview.vue` | Modified (Spec B file) | Edit affordances: add lesson (insert-after), reorder (up/down), inline rename/goal-edit, delete (direct, or force end-detach-delete confirm). |
| `frontend/src/services/subjectsApi.js` | Modified (Spec B file) | Widen `deleteLesson(lessonId, { force })` to forward `?force=true`. |
| `frontend/src/stores/subject.js` | Modified (Spec B file) | Actions: `addLessonAfter`, `moveLesson`, `renameLesson`, `editLessonGoal`, `removeLesson` (force-aware) with order_idx-integrity rewrite. |
| `frontend/src/__tests__/subjectOverviewRevision.test.js` | Created | Vitest: insert-after ordering, reorder integrity, inline edit write, direct delete + force end-detach-delete. |
| `docs/api/openapi.yaml` | Modified | Add `AddLessonSuggestion` schema; add optional `add_lesson_suggestion` to `CheckAnswerResponse`. |
| `backend/contracts/models.py` | Generated | Regenerated. |
| `backend/services/plan_revision_service.py` | Created | `maybe_suggest_lesson(db, session_id, gap)` — incorrect-count threshold + existing-practice-lesson guard. |
| `backend/tests/test_plan_revision_service.py` | Created | Threshold crossing fires once; quick-session (no subject) no-op; guard suppresses after Add. |
| `backend/routes/sessions.py` | Modified | Wire `maybe_suggest_lesson` into `answer_check`; attach to `CheckAnswerResponse`. |
| `backend/tests/test_check_answer_route.py` | Modified | Assert `add_lesson_suggestion` present on threshold answer, absent otherwise. |
| `frontend/src/components/session/AddLessonSuggestion.vue` | Created | Inline card: "want me to add a short *X practice* lesson?" with `[Add]` / `[No thanks]`. |
| `frontend/src/views/SessionView.vue` | Modified (Spec B-aware) | Render suggestion from check-answer response; `[Add]` -> `addLesson` + toast/link; `[No thanks]` -> dismiss for session. |
| `frontend/src/__tests__/addLessonSuggestion.test.js` | Created | Vitest: renders on suggestion payload; Add calls api + emits; No-thanks dismisses. |

---

## Task 1 — Contract: `SubjectProfileResponse` + `SubjectLessonRollup` + route schema

**Files:** `docs/api/openapi.yaml`, `backend/contracts/models.py` (generated)

**Interfaces:**
- Consumes from A: the `/subjects/{id}` path block already exists in openapi (Spec A); add a sibling sub-path.
- Produces: `SubjectProfileResponse`, `SubjectLessonRollup` Pydantic models importable from `contracts`.

- [ ] **Step 1 — Add schemas to openapi.yaml.** Under `components.schemas`, add (mirror the `extra="forbid"` convention via `additionalProperties: false`):

```yaml
    SubjectLessonRollup:
      type: object
      additionalProperties: false
      required: [lesson_id, lesson_title, mastered, gaps]
      properties:
        lesson_id: { type: string }
        lesson_title: { type: string }
        mastered:
          type: array
          items: { type: string }
        gaps:
          type: array
          items: { type: string }
    SubjectProfileResponse:
      description: >-
        Subject-level mastery map. mastered_concepts and open_gaps are unions
        across the subject's opened lessons; open_gaps excludes anything in
        mastered_concepts (disjoint). lessons is the per-lesson drill-down.
      type: object
      additionalProperties: false
      required: [subject_id, subject_title, mastered_concepts, open_gaps, lessons]
      properties:
        subject_id: { type: string }
        subject_title: { type: string }
        mastered_concepts:
          type: array
          items: { type: string }
        open_gaps:
          type: array
          items: { type: string }
        lessons:
          type: array
          items: { $ref: '#/components/schemas/SubjectLessonRollup' }
```

- [ ] **Step 2 — Add the path.** Under `paths`, add:

```yaml
  /subjects/{id}/profile:
    get:
      operationId: getSubjectProfile
      summary: Subject-level mastery map (aggregated lesson profiles).
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Aggregated subject profile.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SubjectProfileResponse' }
        '404':
          description: Subject not found for this user.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorResponse' }
```

- [ ] **Step 3 — Regenerate + verify zero drift.** From repo root:

```
python backend/scripts/gen_contracts.py
git diff --stat backend/contracts/models.py
```

Expected: `models.py` now contains `class SubjectLessonRollup` and `class SubjectProfileResponse`. Both are auto-exported — `backend/contracts/__init__.py` is `from .models import *`, so no manual export edit is needed (verified against the live file). Re-running `gen_contracts.py` a second time must yield no diff:

```
python backend/scripts/gen_contracts.py
git diff --exit-code backend/contracts/
```

Expected: exit code 0 (zero drift).

- [ ] **Step 4 — Commit.** `git commit -am "feat(contracts): add SubjectProfileResponse + SubjectLessonRollup and GET /subjects/{id}/profile schema"`

---

## Task 2 — `subject_profile_service.aggregate_for_subject`

**Files:** `backend/services/subject_profile_service.py`, `backend/tests/test_subject_profile_service.py`

**Interfaces:**
- Consumes from A: `db.models.Subject` (`id`, `user_id`, `title`), `db.models.Lesson` (`id`, `subject_id`, `order_idx`, `title`, `status`, `session_id`), `db.models.Session` (`id`, `topic_profile_json`).
- Reuses: `profile_service._parse_profile`.
- Produces: `aggregate_for_subject(db, subject_id) -> SubjectProfileResponse | None` (None when subject missing — route maps to 404).

- [ ] **Step 1 — Write the failing test.** `backend/tests/test_subject_profile_service.py`:

```python
"""subject_profile_service.aggregate_for_subject — pure read, no LLM."""

from contracts import TopicProfile
from db.models import Lesson, Session as SessionModel, Subject, User
from services import subject_profile_service


USER_ID = "u_subj"


def _session(db, sid, *, mastered=None, gaps=None):
    s = SessionModel(
        id=sid,
        user_id=USER_ID,
        topic="",
        topic_profile_json=TopicProfile(
            mastered_concepts=mastered or [],
            confirmed_gaps=gaps or [],
        ).model_dump_json(),
    )
    db.add(s)
    return s


def _subject_with_lessons(db, subject_id="sub1"):
    db.add(User(id=USER_ID))
    db.add(Subject(id=subject_id, user_id=USER_ID, title="Organic Chemistry",
                   per_session_minutes=30, timeline_days=14))
    # Lesson 0: opened, mastered bonding/hybridization
    _session(db, "s0", mastered=["bonding", "hybridization"], gaps=[])
    db.add(Lesson(id="l0", subject_id=subject_id, order_idx=0, title="Bonding basics",
                  goal="g", status="done", session_id="s0"))
    # Lesson 1: opened, gap chirality + bonding-as-gap (must be subtracted at subject level)
    _session(db, "s1", mastered=[], gaps=["chirality", "bonding"])
    db.add(Lesson(id="l1", subject_id=subject_id, order_idx=1, title="Stereochemistry",
                  goal="g", status="in_progress", session_id="s1"))
    # Lesson 2: not opened (session_id NULL) -> empty rollup
    db.add(Lesson(id="l2", subject_id=subject_id, order_idx=2, title="Spectroscopy",
                  goal="g", status="not_started", session_id=None))
    db.commit()


def test_aggregate_unions_dedupes_and_subtracts_mastered(db_session):
    _subject_with_lessons(db_session)
    out = subject_profile_service.aggregate_for_subject(db_session, "sub1")
    assert out is not None
    assert out.subject_title == "Organic Chemistry"
    assert set(out.mastered_concepts) == {"bonding", "hybridization"}
    # chirality stays a gap; bonding removed because it is mastered subject-wide
    assert out.open_gaps == ["chirality"]
    assert len(out.lessons) == 3
    roll = {r.lesson_id: r for r in out.lessons}
    assert roll["l0"].mastered == ["bonding", "hybridization"]
    assert roll["l1"].gaps == ["chirality", "bonding"]  # rollup keeps raw per-lesson view
    assert roll["l2"].mastered == [] and roll["l2"].gaps == []  # unopened


def test_aggregate_missing_subject_returns_none(db_session):
    assert subject_profile_service.aggregate_for_subject(db_session, "nope") is None


def test_aggregate_empty_subject_valid_shape(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(Subject(id="empty", user_id=USER_ID, title="New",
                           per_session_minutes=15, timeline_days=7))
    db_session.commit()
    out = subject_profile_service.aggregate_for_subject(db_session, "empty")
    assert out.mastered_concepts == [] and out.open_gaps == [] and out.lessons == []
```

Run: `pytest tests/test_subject_profile_service.py` from `backend/`. Expected: ImportError / fails (service does not exist).

- [ ] **Step 2 — Implement the service.** `backend/services/subject_profile_service.py`:

```python
"""Subject-level mastery map. Pure SQL + Python, no LLM calls.

Reuses the aggregation approach from profile_service.aggregate_for_user:
walk the subject's lessons (ordered) -> their linked sessions ->
topic_profile_json (parsed tolerantly via _parse_profile) -> union + dedupe
mastered and gaps. open_gaps is disjoint from mastered_concepts at the subject
level (a concept mastered anywhere in the subject is not also "still shaky").
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from contracts import SubjectLessonRollup, SubjectProfileResponse
from db.models import Lesson, Session as SessionModel, Subject
from services.profile_service import _parse_profile


def _dedupe(seq: list[str]) -> list[str]:
    """Order-preserving dedupe."""
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def aggregate_for_subject(db: Session, subject_id: str) -> SubjectProfileResponse | None:
    subject = db.get(Subject, subject_id)
    if subject is None:
        return None

    lessons: list[Lesson] = db.execute(
        select(Lesson)
        .where(Lesson.subject_id == subject_id)
        .order_by(Lesson.order_idx.asc())
    ).scalars().all()

    rollups: list[SubjectLessonRollup] = []
    all_mastered: list[str] = []
    all_gaps: list[str] = []

    for lesson in lessons:
        mastered: list[str] = []
        gaps: list[str] = []
        if lesson.session_id is not None:
            sess = db.get(SessionModel, lesson.session_id)
            if sess is not None:
                profile = _parse_profile(sess.topic_profile_json)
                mastered = list(profile.mastered_concepts or [])
                gaps = list(profile.confirmed_gaps or [])
        rollups.append(
            SubjectLessonRollup(
                lesson_id=lesson.id,
                lesson_title=lesson.title,
                mastered=mastered,
                gaps=gaps,
            )
        )
        all_mastered.extend(mastered)
        all_gaps.extend(gaps)

    mastered_union = _dedupe(all_mastered)
    mastered_set = set(mastered_union)
    open_gaps = [g for g in _dedupe(all_gaps) if g not in mastered_set]

    return SubjectProfileResponse(
        subject_id=subject.id,
        subject_title=subject.title,
        mastered_concepts=mastered_union,
        open_gaps=open_gaps,
        lessons=rollups,
    )
```

Run: `pytest tests/test_subject_profile_service.py` from `backend/`. Expected: 3 passed.

- [ ] **Step 3 — Commit.** `git commit -am "feat(backend): subject_profile_service aggregates lesson profiles into a mastery map"`

---

## Task 3 — Route: `GET /subjects/{id}/profile`

**Files:** `backend/routes/subjects.py` (Spec A file), `backend/tests/test_subject_profile_route.py`

**Interfaces:**
- Consumes from A: `routes/subjects.py` router (prefix `/api`), `services.auth.current_user_id`, `db.models.Subject`.
- Produces: `GET /api/subjects/{id}/profile` returning `SubjectProfileResponse`.

- [ ] **Step 1 — Write the failing route test.** `backend/tests/test_subject_profile_route.py`:

```python
from contracts import TopicProfile
from db.models import Lesson, Session as SessionModel, Subject, User

OWNER = "u_owner"
OTHER = "u_other"


def _seed(db, owner=OWNER):
    db.add(User(id=owner))
    db.add(Subject(id="sub1", user_id=owner, title="Bio",
                   per_session_minutes=30, timeline_days=14))
    db.add(SessionModel(id="s0", user_id=owner, topic="cells",
                        topic_profile_json=TopicProfile(
                            mastered_concepts=["mitosis"], confirmed_gaps=["meiosis"]
                        ).model_dump_json()))
    db.add(Lesson(id="l0", subject_id="sub1", order_idx=0, title="Cell division",
                  goal="g", status="in_progress", session_id="s0"))
    db.commit()


def test_get_subject_profile_ok(client, db_session):
    _seed(db_session)
    r = client.get("/api/subjects/sub1/profile", params={"user_id": OWNER})
    assert r.status_code == 200
    body = r.json()
    assert body["subject_title"] == "Bio"
    assert body["mastered_concepts"] == ["mitosis"]
    assert body["open_gaps"] == ["meiosis"]
    assert body["lessons"][0]["lesson_title"] == "Cell division"


def test_get_subject_profile_cross_user_404(client, db_session):
    _seed(db_session)
    db_session.add(User(id=OTHER))
    db_session.commit()
    r = client.get("/api/subjects/sub1/profile", params={"user_id": OTHER})
    assert r.status_code == 404


def test_get_subject_profile_missing_404(client, db_session):
    db_session.add(User(id=OWNER))
    db_session.commit()
    r = client.get("/api/subjects/ghost/profile", params={"user_id": OWNER})
    assert r.status_code == 404
```

Run: `pytest tests/test_subject_profile_route.py` from `backend/`. Expected: fails (404 on the OK case — no route).

- [ ] **Step 2 — Add the handler to `routes/subjects.py`.** Import the service and contract, then add (place near the other `GET /subjects/{id}` handlers; the user-scope check mirrors `routes/profile.py`):

```python
from contracts import SubjectProfileResponse
from services import subject_profile_service


@router.get("/subjects/{subject_id}/profile", response_model=SubjectProfileResponse)
def get_subject_profile(
    subject_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    subject = db.get(Subject, subject_id)
    if subject is None or subject.user_id != user_id:
        raise HTTPException(status_code=404, detail="subject not found")
    result = subject_profile_service.aggregate_for_subject(db, subject_id)
    if result is None:  # defensive; ownership already checked above
        raise HTTPException(status_code=404, detail="subject not found")
    return result
```

Note: if `routes/subjects.py` uses `{id}` (not `{subject_id}`) as its path param name elsewhere, match the existing convention for consistency; the openapi path in Task 1 uses `{id}`, so align the FastAPI param name to whatever Spec A's other subject routes use and keep openapi identical.

Run: `pytest tests/test_subject_profile_route.py` from `backend/`. Expected: 3 passed.

- [ ] **Step 3 — Full suite + coverage.** Run `pytest` from `backend/`. Expected: all green, coverage >= 75%.

- [ ] **Step 4 — Commit.** `git commit -am "feat(backend): add GET /subjects/{id}/profile route (user-scoped 404)"`

---

## Task 4 — Frontend API: `getSubjectProfile`

**Files:** `frontend/src/services/profileApi.js`

**Interfaces:**
- Consumes: `apiGet` from `apiClient.js`.
- Produces: `getSubjectProfile(subjectId)`.

- [ ] **Step 1 — Extend `profileApi.js`.** Append:

```javascript
export const getSubjectProfile = (subjectId) => apiGet(`/subjects/${subjectId}/profile`)
```

- [ ] **Step 2 — Sanity check.** Run `npm run test:unit -- --run` from `frontend/`. Expected: existing suite still green (no test references this yet). Commit with the next task.

---

## Task 5 — `SubjectProfileView.vue` (mastery map) + route

**Files:** `frontend/src/views/SubjectProfileView.vue`, `frontend/src/router/index.js`, `frontend/src/__tests__/subjectProfileView.test.js`

**Interfaces:**
- Consumes: `getSubjectProfile` (Task 4), `friendlyError` (`lib/errors.js`), the chip styles pattern from `AggregateProfileView.vue`.
- Produces: route `name: 'subject-mastery'`, path `/subjects/:id/profile`.

- [ ] **Step 1 — Write the failing Vitest.** `frontend/src/__tests__/subjectProfileView.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SubjectProfileView from '@/views/SubjectProfileView.vue'
import * as profileApi from '@/services/profileApi.js'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
}

describe('SubjectProfileView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('renders mastered, open gaps, and per-lesson rollup', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockResolvedValue({
      subject_id: 'sub1',
      subject_title: 'Organic Chemistry',
      mastered_concepts: ['bonding', 'hybridization'],
      open_gaps: ['chirality'],
      lessons: [
        { lesson_id: 'l0', lesson_title: 'Bonding basics', mastered: ['bonding'], gaps: [] },
        { lesson_id: 'l1', lesson_title: 'Stereochemistry', mastered: [], gaps: ['chirality'] },
      ],
    })
    const wrapper = mount(SubjectProfileView, {
      props: { id: 'sub1' },
      global: { stubs },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-mastered"]').text()).toContain('bonding')
    expect(wrapper.find('[data-testid="smap-gaps"]').text()).toContain('chirality')
    const byLesson = wrapper.find('[data-testid="smap-lessons"]').text()
    expect(byLesson).toContain('Bonding basics')
    expect(byLesson).toContain('Stereochemistry')
  })

  it('renders empty-but-valid shape', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockResolvedValue({
      subject_id: 'sub1', subject_title: 'New', mastered_concepts: [], open_gaps: [], lessons: [],
    })
    const wrapper = mount(SubjectProfileView, { props: { id: 'sub1' }, global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-empty"]').exists()).toBe(true)
  })

  it('shows error banner when the API throws', async () => {
    vi.spyOn(profileApi, 'getSubjectProfile').mockRejectedValue(new Error('boom'))
    const wrapper = mount(SubjectProfileView, { props: { id: 'sub1' }, global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-testid="smap-error"]').text()).toContain('boom')
  })
})
```

Run: `npm run test:unit -- --run src/__tests__/subjectProfileView.test.js` from `frontend/`. Expected: fails (view missing).

- [ ] **Step 2 — Implement the view.** `frontend/src/views/SubjectProfileView.vue`:

```vue
<template>
  <section class="smap" data-testid="subject-profile">
    <header class="head">
      <span class="folio">mastery map</span>
      <h1 class="title">{{ data?.subject_title || 'Subject' }}</h1>
      <router-link :to="{ name: 'subject', params: { id } }" class="back-link">
        Back to overview
      </router-link>
    </header>

    <p v-if="loading" class="muted" data-testid="smap-loading">Loading...</p>
    <p v-else-if="error" class="error" data-testid="smap-error">{{ error }}</p>

    <template v-else-if="data">
      <p
        v-if="!data.mastered_concepts.length && !data.open_gaps.length && !data.lessons.length"
        class="muted"
        data-testid="smap-empty"
      >
        Nothing mapped yet. Open a lesson and start learning to build this up.
      </p>

      <template v-else>
        <div class="two-col">
          <div class="col" data-testid="smap-mastered">
            <h2 class="section-title">Mastered</h2>
            <p v-if="!data.mastered_concepts.length" class="muted">None yet.</p>
            <ul v-else class="chip-list">
              <li v-for="c in data.mastered_concepts" :key="`m-${c}`" class="chip chip-mastered">
                {{ c }}
              </li>
            </ul>
          </div>
          <div class="col" data-testid="smap-gaps">
            <h2 class="section-title">Still shaky</h2>
            <p v-if="!data.open_gaps.length" class="muted">None.</p>
            <ul v-else class="chip-list">
              <li v-for="g in data.open_gaps" :key="`g-${g}`" class="chip chip-gap">
                {{ g }}
              </li>
            </ul>
          </div>
        </div>

        <div class="by-lesson" data-testid="smap-lessons">
          <h2 class="section-title">By lesson</h2>
          <ul class="lesson-list">
            <li v-for="l in data.lessons" :key="l.lesson_id" class="lesson-row">
              <span class="lesson-name">{{ l.lesson_title }}</span>
              <span v-if="l.mastered.length" class="lesson-meta lesson-mastered">
                mastered: {{ l.mastered.join(', ') }}
              </span>
              <span v-if="l.gaps.length" class="lesson-meta lesson-gaps">
                gaps: {{ l.gaps.join(', ') }}
              </span>
              <span v-if="!l.mastered.length && !l.gaps.length" class="lesson-meta muted">
                not started
              </span>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import { friendlyError } from '../lib/errors.js'
import { getSubjectProfile } from '../services/profileApi.js'

const props = defineProps({ id: { type: String, required: true } })

const data = ref(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSubjectProfile(props.id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.smap { max-width: 72rem; margin: 0 auto; display: flex; flex-direction: column; gap: 1.75rem; }
.head { display: flex; flex-direction: column; gap: 0.5rem; }
.folio {
  font-family: var(--font-sans); font-size: var(--fs-label); text-transform: uppercase;
  letter-spacing: var(--tracking-label); font-weight: 600; color: var(--color-accent-text);
}
.title {
  font-family: var(--font-display); font-size: clamp(2rem, 4vw, 2.5rem); font-weight: 700;
  color: var(--color-heading); margin: 0;
}
.back-link { color: var(--color-accent-text); text-decoration: none; font-size: 0.9rem; }
.muted { color: var(--color-text-muted); }
.error { color: var(--color-error-text); }
.section-title {
  font-family: var(--font-display); font-size: 1.25rem; font-weight: 700;
  color: var(--color-heading); margin: 0 0 0.875rem 0;
}
.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 2rem; }
.chip-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chip {
  display: inline-flex; align-items: center; padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 0.875rem; font-weight: 500;
}
.chip-mastered {
  background: rgba(34, 197, 94, 0.14); color: var(--color-success-text);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.chip-gap {
  background: rgba(255, 176, 32, 0.16); color: var(--color-warning-text);
  border: 1px solid rgba(255, 176, 32, 0.35);
}
.lesson-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.lesson-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem;
  padding: 0.75rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md);
  background: var(--color-surface);
}
.lesson-name { font-family: var(--font-display); font-weight: 600; color: var(--color-heading); }
.lesson-meta { font-size: 0.8125rem; }
.lesson-mastered { color: var(--color-success-text); }
.lesson-gaps { color: var(--color-warning-text); }
</style>
```

- [ ] **Step 3 — Register the route.** In `frontend/src/router/index.js`, add after the `session-profile` route (props enabled so `id` is passed):

```javascript
    {
      path: '/subjects/:id/profile',
      name: 'subject-mastery',
      component: () => import('../views/SubjectProfileView.vue'),
      props: true,
    },
```

Run: `npm run test:unit -- --run src/__tests__/subjectProfileView.test.js` from `frontend/`. Expected: 3 passed.

- [ ] **Step 4 — Commit.** `git commit -am "feat(frontend): SubjectProfileView mastery map + subject-mastery route + getSubjectProfile"`

---

## Task 6 — "View mastery map" link on `SubjectOverview.vue`

**Files:** `frontend/src/views/SubjectOverview.vue` (Spec B file)

**Interfaces:**
- Consumes from B: `SubjectOverview.vue` with the subject `id` in scope (route param / store).
- Produces: navigable link to `subject-mastery`.

- [ ] **Step 1 — Add a Vitest assertion** to the existing SubjectOverview test (or a focused new test) that a link with `data-testid="overview-mastery-link"` exists and targets `subject-mastery`. Mount with the RouterLink stub used elsewhere and assert `wrapper.find('[data-testid="overview-mastery-link"]').exists()` is true. Run from `frontend/`: `npm run test:unit -- --run` — expect the new assertion to fail.

- [ ] **Step 2 — Add the link** to `SubjectOverview.vue`, in the header/actions area near "Open next lesson":

```vue
<router-link
  :to="{ name: 'subject-mastery', params: { id: subjectId } }"
  class="mastery-link"
  data-testid="overview-mastery-link"
>
  View mastery map
</router-link>
```

Use whatever variable Spec B exposes for the subject id (`subjectId` / `route.params.id` / `subject.id`); match the existing component's naming.

Run: `npm run test:unit -- --run` from `frontend/`. Expected: green.

- [ ] **Step 3 — Commit.** `git commit -am "feat(frontend): link to mastery map from subject overview"`

---

## Task 7 — Plan revision UI: add / reorder / inline-edit on `SubjectOverview.vue`

**Files:** `frontend/src/stores/subject.js` (Spec B file), `frontend/src/views/SubjectOverview.vue` (Spec B file), `frontend/src/__tests__/subjectOverviewRevision.test.js`

**Interfaces:**
- Consumes from B: `services/subjectsApi.js` route wrappers. Expected names (align with Spec B's actual exports at execution time — confirm before coding): `addLesson(subjectId, { title, goal })` -> `POST /subjects/{id}/lessons`; `patchLesson(lessonId, patch)` -> `PATCH /lessons/{id}`; `deleteLesson(lessonId)` -> `DELETE /lessons/{id}`. Also `stores/subject.js` already holding `currentSubject` with an ordered `lessons` array.
- Produces: store actions `addLessonAfter`, `moveLesson`, `renameLesson`, `editLessonGoal`; overview edit affordances.

- [ ] **Step 1 — Write the failing store/integration test.** `frontend/src/__tests__/subjectOverviewRevision.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useSubjectStore } from '@/stores/subject.js'
import * as subjectsApi from '@/services/subjectsApi.js'

function seed(store) {
  store.currentSubject = {
    id: 'sub1',
    title: 'Organic Chemistry',
    lessons: [
      { id: 'l0', order_idx: 0, title: 'Bonding', goal: 'g0', status: 'done', session_id: 's0' },
      { id: 'l1', order_idx: 1, title: 'Alkanes', goal: 'g1', status: 'not_started', session_id: null },
    ],
  }
}

describe('subject store — plan revision', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('addLessonAfter inserts after the given index and rewrites order_idx contiguously', async () => {
    const store = useSubjectStore()
    seed(store)
    vi.spyOn(subjectsApi, 'addLesson').mockResolvedValue({
      id: 'l2', order_idx: 2, title: 'Alkane practice', goal: 'gp', status: 'not_started', session_id: null,
    })
    const patch = vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})

    await store.addLessonAfter('sub1', 0, { title: 'Alkane practice', goal: 'gp' })

    const titles = store.currentSubject.lessons.map((l) => l.title)
    expect(titles).toEqual(['Bonding', 'Alkane practice', 'Alkanes'])
    const idxs = store.currentSubject.lessons.map((l) => l.order_idx)
    expect(idxs).toEqual([0, 1, 2]) // contiguous, no duplicates
    // new lesson (created at end, idx 2) and the displaced lesson get order_idx PATCHes
    expect(patch).toHaveBeenCalledWith('l2', { order_idx: 1 })
    expect(patch).toHaveBeenCalledWith('l1', { order_idx: 2 })
  })

  it('moveLesson down swaps order_idx and persists both rows', async () => {
    const store = useSubjectStore()
    seed(store)
    const patch = vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.moveLesson('l0', 1) // move l0 down to index 1
    expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l1', 'l0'])
    expect(store.currentSubject.lessons.map((l) => l.order_idx)).toEqual([0, 1])
    expect(patch).toHaveBeenCalledWith('l0', { order_idx: 1 })
    expect(patch).toHaveBeenCalledWith('l1', { order_idx: 0 })
  })

  it('renameLesson and editLessonGoal patch and update local state', async () => {
    const store = useSubjectStore()
    seed(store)
    vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
    await store.renameLesson('l1', 'Alkanes & isomers')
    await store.editLessonGoal('l1', 'new goal')
    const l1 = store.currentSubject.lessons.find((l) => l.id === 'l1')
    expect(l1.title).toBe('Alkanes & isomers')
    expect(l1.goal).toBe('new goal')
    expect(subjectsApi.patchLesson).toHaveBeenCalledWith('l1', { title: 'Alkanes & isomers' })
    expect(subjectsApi.patchLesson).toHaveBeenCalledWith('l1', { goal: 'new goal' })
  })
})
```

Run: `npm run test:unit -- --run src/__tests__/subjectOverviewRevision.test.js` from `frontend/`. Expected: fails (actions undefined).

- [ ] **Step 2 — Implement the store actions** in `frontend/src/stores/subject.js`. Add to the store (Options or Setup style — match Spec B's existing file; shown as actions):

```javascript
function _reindex(lessons) {
  // Rewrite order_idx to a contiguous 0-based sequence matching array order.
  // Returns the list of rows whose order_idx actually changed.
  const changed = []
  lessons.forEach((l, i) => {
    if (l.order_idx !== i) {
      l.order_idx = i
      changed.push(l)
    }
  })
  return changed
}

async function addLessonAfter(subjectId, afterIdx, { title, goal }) {
  // Spec A POST appends at end; created row comes back with the end order_idx.
  const created = await subjectsApi.addLesson(subjectId, { title, goal })
  const lessons = this.currentSubject.lessons
  lessons.push(created)
  // Move it into position afterIdx + 1.
  const fromIdx = lessons.length - 1
  const toIdx = Math.min(afterIdx + 1, fromIdx)
  const [moved] = lessons.splice(fromIdx, 1)
  lessons.splice(toIdx, 0, moved)
  // Recompute contiguous order_idx and persist each changed row.
  const changed = _reindex(lessons)
  for (const l of changed) {
    await subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })
  }
  return created
}

async function moveLesson(lessonId, toIdx) {
  const lessons = this.currentSubject.lessons
  const fromIdx = lessons.findIndex((l) => l.id === lessonId)
  if (fromIdx < 0 || toIdx < 0 || toIdx >= lessons.length) return
  const [moved] = lessons.splice(fromIdx, 1)
  lessons.splice(toIdx, 0, moved)
  const changed = _reindex(lessons)
  for (const l of changed) {
    await subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })
  }
}

async function renameLesson(lessonId, title) {
  await subjectsApi.patchLesson(lessonId, { title })
  const l = this.currentSubject.lessons.find((x) => x.id === lessonId)
  if (l) l.title = title
}

async function editLessonGoal(lessonId, goal) {
  await subjectsApi.patchLesson(lessonId, { goal })
  const l = this.currentSubject.lessons.find((x) => x.id === lessonId)
  if (l) l.goal = goal
}
```

Ensure `subjectsApi` is imported and the four actions are exposed by the store. If Spec B's store is a setup-store (`defineStore('subject', () => {...})`), drop the `this.` and reference the `currentSubject` ref directly (`currentSubject.value.lessons`).

Run: `npm run test:unit -- --run src/__tests__/subjectOverviewRevision.test.js` from `frontend/`. Expected: 3 passed.

- [ ] **Step 3 — Wire the overview UI.** In `SubjectOverview.vue`, add per-lesson edit controls (guarded behind an "Edit plan" toggle to keep the read view clean):
  - Up/down buttons calling `store.moveLesson(lesson.id, idx - 1 | idx + 1)`.
  - Inline title/goal edit (double-click or pencil) committing via `store.renameLesson` / `store.editLessonGoal`.
  - "Add lesson here" row opening a small title+goal form calling `store.addLessonAfter(subjectId, idx, form)`, then a toast.
  Give the edit toggle `data-testid="overview-edit-toggle"` and the add form `data-testid="overview-add-lesson"`. Keep "every lesson freely openable" (Spec B) — edit mode only adds controls, it does not gate opening.

  Note (intentional, do NOT "fix"): the mastery map's top-level `open_gaps` subtracts subject-wide mastered concepts (disjoint), but each lesson rollup keeps its raw per-lesson `gaps`. So a concept can legitimately appear under "Mastered" at the top while still showing as a gap in one lesson's row — that reflects per-lesson state and matches the spec mockup.

Run: `npm run test:unit -- --run` from `frontend/`. Expected: green.

- [ ] **Step 4 — Commit.** `git commit -am "feat(frontend): plan revision on subject overview (add/reorder/inline-edit lessons)"`

---

## Task 8 — Delete lesson: direct delete + force end-detach-delete confirm

**Files:** `frontend/src/services/subjectsApi.js` (Spec B file — minimal extension), `frontend/src/stores/subject.js`, `frontend/src/views/SubjectOverview.vue`, `frontend/src/__tests__/subjectOverviewRevision.test.js` (extend)

Spec A reconciled (2026-06-28): `DELETE /lessons/{id}` now accepts `?force=true`. Without `force`, a lesson with a `session_id` still 409s (don't orphan a chat). With `force=true`, the backend ends the session (`ended_at`) AND clears `lessons.session_id`, then deletes the lesson — one transaction. So "end + detach + delete" is now fully composable from Spec A; there is no remaining addendum gap.

**Interfaces:**
- Consumes from A: `DELETE /lessons/{id}` (409 when `session_id` set and no force) and `DELETE /lessons/{id}?force=true` (ends session + detaches + deletes).
- Consumes from B: `subjectsApi.deleteLesson(lessonId, { force } = {})` -> `DELETE /lessons/{id}` (append `?force=true` when `force`). Extend Spec B's wrapper to accept the optional flag if it does not already.
- Produces: `removeLesson(lessonId, { force } = {})` action + delete UI with a session-aware confirm.

- [ ] **Step 1 — Ensure `subjectsApi.deleteLesson` forwards `force`.** In `frontend/src/services/subjectsApi.js`, the delete wrapper must pass the query flag (the project's `apiClient` has no `params` on `apiDelete`, so append to the path):

```javascript
export const deleteLesson = (lessonId, { force = false } = {}) =>
  apiDelete(`/lessons/${lessonId}${force ? '?force=true' : ''}`)
```

If Spec B already defined `deleteLesson(lessonId)`, widen its signature to this form (additive, no caller breakage).

- [ ] **Step 2 — Extend the test.** Add to `subjectOverviewRevision.test.js`:

```javascript
it('removeLesson deletes an unopened lesson and reindexes', async () => {
  const store = useSubjectStore()
  seed(store)
  const del = vi.spyOn(subjectsApi, 'deleteLesson').mockResolvedValue({})
  vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
  await store.removeLesson('l1') // l1 has session_id null -> no force
  expect(del).toHaveBeenCalledWith('l1', { force: false })
  expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l0'])
  expect(store.currentSubject.lessons[0].order_idx).toBe(0)
})

it('removeLesson with force=true end-detaches-deletes a lesson that has a session', async () => {
  const store = useSubjectStore()
  seed(store)
  const del = vi.spyOn(subjectsApi, 'deleteLesson').mockResolvedValue({})
  vi.spyOn(subjectsApi, 'patchLesson').mockResolvedValue({})
  await store.removeLesson('l0', { force: true }) // l0 has session_id 's0'
  expect(del).toHaveBeenCalledWith('l0', { force: true })
  expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l1'])
  expect(store.currentSubject.lessons[0].order_idx).toBe(0)
})

it('removeLesson leaves local state intact when the delete fails', async () => {
  const store = useSubjectStore()
  seed(store)
  vi.spyOn(subjectsApi, 'deleteLesson').mockRejectedValue(new Error('boom'))
  await expect(store.removeLesson('l0')).rejects.toThrow('boom')
  expect(store.currentSubject.lessons.map((l) => l.id)).toEqual(['l0', 'l1'])
})
```

Run from `frontend/`: `npm run test:unit -- --run src/__tests__/subjectOverviewRevision.test.js`. Expected: fails (`removeLesson` undefined).

- [ ] **Step 3 — Implement `removeLesson`** in `stores/subject.js`:

```javascript
async function removeLesson(lessonId, { force = false } = {}) {
  // Spec A: DELETE /lessons/{id} 409s when the lesson has a session_id;
  // ?force=true ends the session + clears lessons.session_id + deletes in one
  // transaction. We do NOT mutate local state until the server confirms, so a
  // failed delete leaves the plan intact.
  await subjectsApi.deleteLesson(lessonId, { force })
  const lessons = this.currentSubject.lessons
  const idx = lessons.findIndex((l) => l.id === lessonId)
  if (idx >= 0) {
    lessons.splice(idx, 1)
    const changed = _reindex(lessons)
    for (const l of changed) {
      await subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })
    }
  }
}
```

Run: `npm run test:unit -- --run src/__tests__/subjectOverviewRevision.test.js` from `frontend/`. Expected: passing.

- [ ] **Step 4 — Wire the delete UI.** In `SubjectOverview.vue`, the per-lesson delete button branches on whether the lesson has a chat:
  - **No session (`lesson.session_id == null`):** call `store.removeLesson(lesson.id)` directly (a small "Remove lesson?" confirm is fine but no force needed), then a toast.
  - **Has a session (`lesson.session_id != null`):** open a ConfirmDialog "End this lesson's chat and remove it? This ends the session and deletes the lesson." with a destructive **End & delete** action calling `store.removeLesson(lesson.id, { force: true })`, then a toast. Wire the dialog's `acceptClass` to a destructive style (this is irreversible — it ends a real chat).
  - Give the delete trigger `data-testid="overview-delete-lesson"` and the confirm accept `data-testid="overview-delete-force"`. Keep the relocated duplicate-cleanup affordance (Spec B) untouched.

Run: `npm run test:unit -- --run` from `frontend/`. Expected: green.

- [ ] **Step 5 — Commit.** `git commit -am "feat(frontend): lesson delete with force end-detach-delete confirm (Spec A force=true)"`

---

## Task 9 — Contract: `add_lesson_suggestion` on `CheckAnswerResponse`

**Files:** `docs/api/openapi.yaml`, `backend/contracts/models.py` (generated)

**Interfaces:**
- Consumes: existing `CheckAnswerResponse` schema (extra forbid).
- Produces: `AddLessonSuggestion` model + optional `add_lesson_suggestion` field (default null, so `extra="forbid"` stays satisfied for old clients).

- [ ] **Step 1 — Add schema + field in openapi.yaml.** Under `components.schemas`, add:

```yaml
    AddLessonSuggestion:
      description: >-
        Deterministic server hint, emitted on a check answer when the learner
        has repeatedly missed a gap inside a lesson-backed (subject) session.
        The client offers Add / No thanks; Add POSTs a practice lesson.
      type: object
      additionalProperties: false
      required: [subject_id, lesson_id, gap, suggested_title, suggested_goal]
      properties:
        subject_id: { type: string }
        lesson_id: { type: string }
        gap: { type: string }
        suggested_title: { type: string }
        suggested_goal: { type: string }
```

Then add to the `CheckAnswerResponse` schema `properties` (NOT to `required`):

```yaml
        add_lesson_suggestion:
          oneOf:
            - $ref: "#/components/schemas/AddLessonSuggestion"
            - type: "null"
          default: null
```

This `oneOf: [$ref, {type: "null"}] + default: null` form is the project's exact OAS 3.1 nullable-object convention (verified against `TopicProfile.knowledge_level` in the live `openapi.yaml`). Do NOT use `nullable:` — the file is openapi 3.1.0 and never uses that keyword.

- [ ] **Step 2 — Regenerate + verify.** From repo root:

```
python backend/scripts/gen_contracts.py
git diff backend/contracts/models.py
```

Expected: a new `class AddLessonSuggestion` and `CheckAnswerResponse` gains `add_lesson_suggestion: AddLessonSuggestion | None = None`. Then zero-drift check:

```
python backend/scripts/gen_contracts.py
git diff --exit-code backend/contracts/
```

Expected: exit 0.

- [ ] **Step 3 — Commit.** `git commit -am "feat(contracts): add optional add_lesson_suggestion to CheckAnswerResponse"`

---

## Task 10 — `plan_revision_service.maybe_suggest_lesson` + wire into `answer_check`

**Files:** `backend/services/plan_revision_service.py`, `backend/tests/test_plan_revision_service.py`, `backend/routes/sessions.py`, `backend/tests/test_check_answer_route.py` (extend)

**Interfaces:**
- Consumes from A: `db.models.Session.subject_id`, `db.models.Lesson` (`subject_id`, `session_id`, `title`). Existing: `db.models.LearningEvent` (`session_id`, `gap_tested`, `correct`), `check_question_service.get_pending_check`.
- Produces: `maybe_suggest_lesson(db, session_id, gap) -> AddLessonSuggestion | None`; `answer_check` returns it.

- [ ] **Step 1 — Write the failing service test.** `backend/tests/test_plan_revision_service.py`:

```python
"""plan_revision_service.maybe_suggest_lesson — deterministic struggle signal."""

from db.models import (
    Lesson, LearningEvent, Session as SessionModel, Subject, User,
)
from services import plan_revision_service
from services.plan_revision_service import STRUGGLE_THRESHOLD

USER_ID = "u_pr"


def _wrong(db, session_id, gap, n):
    for _ in range(n):
        db.add(LearningEvent(session_id=session_id, gap_tested=gap,
                             question="q", correct=False))
    db.commit()


def _subject_session(db, *, subject_id="sub1", session_id="s0", lesson_id="l0"):
    db.add(User(id=USER_ID))
    db.add(Subject(id=subject_id, user_id=USER_ID, title="Chem",
                   per_session_minutes=30, timeline_days=14))
    db.add(SessionModel(id=session_id, user_id=USER_ID, topic="Alkanes",
                        subject_id=subject_id))
    db.add(Lesson(id=lesson_id, subject_id=subject_id, order_idx=0, title="Alkanes",
                  goal="g", status="in_progress", session_id=session_id))
    db.commit()


def test_fires_exactly_at_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD)
    out = plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes")
    assert out is not None
    assert out.subject_id == "sub1"
    assert out.lesson_id == "l0"
    assert out.gap == "alkanes"
    assert out.suggested_title == "alkanes practice"


def test_no_fire_below_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD - 1)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None


def test_fires_once_then_suppressed_above_threshold(db_session):
    _subject_session(db_session)
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD + 1)
    # crossing already passed -> does not re-fire on later misses
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None


def test_quick_session_no_subject_no_op(db_session):
    db_session.add(User(id=USER_ID))
    db_session.add(SessionModel(id="q0", user_id=USER_ID, topic="x", subject_id=None))
    db_session.commit()
    _wrong(db_session, "q0", "alkanes", STRUGGLE_THRESHOLD)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "q0", "alkanes") is None


def test_existing_practice_lesson_suppresses(db_session):
    _subject_session(db_session)
    db_session.add(Lesson(id="lp", subject_id="sub1", order_idx=1,
                          title="alkanes practice", goal="g",
                          status="not_started", session_id=None))
    db_session.commit()
    _wrong(db_session, "s0", "alkanes", STRUGGLE_THRESHOLD)
    assert plan_revision_service.maybe_suggest_lesson(db_session, "s0", "alkanes") is None
```

Run: `pytest tests/test_plan_revision_service.py` from `backend/`. Expected: ImportError / fails.

- [ ] **Step 2 — Implement the service.** `backend/services/plan_revision_service.py`:

```python
"""Tutor-suggested practice lesson — deterministic, server-side.

When a learner repeatedly misses one gap inside a subject (lesson-backed)
session, surface a one-time suggestion to add a short practice lesson. The
signal reuses LearningEvent history (incorrect count per gap) — no new
tracking. The cap is once-per-GAP (a multi-gap lesson may suggest per distinct
gap): we fire only on the crossing (count == STRUGGLE_THRESHOLD), and a durable
post-Add suppressor is the existence of a lesson already titled like the
practice lesson. "No thanks" is a client-side dismissal, not a server cap.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from contracts import AddLessonSuggestion
from db.models import Lesson, LearningEvent, Session as SessionModel

STRUGGLE_THRESHOLD = 2


def _practice_title(gap: str) -> str:
    return f"{gap} practice"


def maybe_suggest_lesson(
    db: Session, session_id: str, gap: str
) -> AddLessonSuggestion | None:
    if not gap:
        return None
    sess = db.get(SessionModel, session_id)
    if sess is None or sess.subject_id is None:
        return None  # quick (subject-less) session -> never suggest

    # Only check_question_service.answer() ever writes an incorrect LearningEvent
    # (+1 per wrong answer), so `== STRUGGLE_THRESHOLD` fires exactly once on the
    # crossing. If a second source of incorrect events is ever added, revisit this.
    incorrect = db.execute(
        select(func.count(LearningEvent.id)).where(
            LearningEvent.session_id == session_id,
            LearningEvent.gap_tested == gap,
            LearningEvent.correct.is_(False),
        )
    ).scalar_one()
    # Fire ONCE, exactly on the crossing. Below -> too early; above -> already fired.
    if incorrect != STRUGGLE_THRESHOLD:
        return None

    lesson = db.execute(
        select(Lesson).where(
            Lesson.subject_id == sess.subject_id,
            Lesson.session_id == session_id,
        )
    ).scalars().first()
    if lesson is None:
        return None  # session not linked to a lesson in this subject

    title = _practice_title(gap)
    # Durable suppressor: do not re-suggest if a practice lesson already exists.
    existing = db.execute(
        select(func.count(Lesson.id)).where(
            Lesson.subject_id == sess.subject_id,
            Lesson.title == title,
        )
    ).scalar_one()
    if existing:
        return None

    return AddLessonSuggestion(
        subject_id=sess.subject_id,
        lesson_id=lesson.id,
        gap=gap,
        suggested_title=title,
        suggested_goal=f"Extra practice on {gap}.",
    )
```

Run: `pytest tests/test_plan_revision_service.py` from `backend/`. Expected: 5 passed.

- [ ] **Step 3 — Wire into `answer_check`.** In `backend/routes/sessions.py`, import the service and read the open batch's gap before/after grading (the gap is on the pending check). Modify `answer_check`:

```python
from services import plan_revision_service
```

```python
@router.post("/sessions/{session_id}/check/answer", response_model=CheckAnswerResponse)
def answer_check(
    session_id: str,
    req: CheckAnswerRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    pc = check_question_service.get_pending_check(db, session_id)
    gap = pc.get("gap") if pc else None
    try:
        result = check_question_service.answer(db, session_id, req.index, req.selected_index)
    except check_question_service.CheckStateError as e:
        raise HTTPException(status_code=409, detail=str(e))
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    suggestion = None
    if gap and not result.get("correct"):
        suggestion = plan_revision_service.maybe_suggest_lesson(db, session_id, gap)
    return CheckAnswerResponse(**result, add_lesson_suggestion=suggestion)
```

- [ ] **Step 4 — Extend the route test.** In `backend/tests/test_check_answer_route.py`, add a test that seeds a subject + lesson-backed session, drives the answer endpoint to record `STRUGGLE_THRESHOLD` wrong answers on one gap, and asserts the final response carries `add_lesson_suggestion` with the right `subject_id`/`gap`; and a control where a quick (subject-less) session never returns it. (Mirror the existing batch-setup helpers in that file.)

Run: `pytest tests/test_check_answer_route.py` from `backend/`. Expected: green.

- [ ] **Step 5 — Full suite + coverage.** `pytest` from `backend/`. Expected: green, coverage >= 75%.

- [ ] **Step 6 — Commit.** `git commit -am "feat(backend): deterministic tutor-suggested practice lesson on repeated check misses"`

---

## Task 11 — Inline add-lesson suggestion card in the session view

**Files:** `frontend/src/components/session/AddLessonSuggestion.vue`, `frontend/src/views/SessionView.vue`, `frontend/src/__tests__/addLessonSuggestion.test.js`

**Interfaces:**
- Consumes: the `add_lesson_suggestion` object from the check-answer response (already threaded through Spec B's answer handler / session store); `subjectsApi.addLesson`.
- Produces: `AddLessonSuggestion.vue` card with `[Add]` / `[No thanks]`; SessionView state holding the active suggestion.

- [ ] **Step 1 — Write the failing component test.** `frontend/src/__tests__/addLessonSuggestion.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AddLessonSuggestion from '@/components/session/AddLessonSuggestion.vue'

const suggestion = {
  subject_id: 'sub1',
  lesson_id: 'l0',
  gap: 'alkanes',
  suggested_title: 'alkanes practice',
  suggested_goal: 'Extra practice on alkanes.',
}

describe('AddLessonSuggestion', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders the gap and suggested title', () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    const text = wrapper.text()
    expect(text).toContain('alkanes')
    expect(wrapper.find('[data-testid="suggest-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suggest-dismiss"]').exists()).toBe(true)
  })

  it('emits add with the suggestion on Add click', async () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    await wrapper.find('[data-testid="suggest-add"]').trigger('click')
    expect(wrapper.emitted('add')[0][0]).toEqual(suggestion)
  })

  it('emits dismiss on No thanks click', async () => {
    const wrapper = mount(AddLessonSuggestion, { props: { suggestion } })
    await wrapper.find('[data-testid="suggest-dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
```

Run: `npm run test:unit -- --run src/__tests__/addLessonSuggestion.test.js` from `frontend/`. Expected: fails (component missing).

- [ ] **Step 2 — Implement the component.** `frontend/src/components/session/AddLessonSuggestion.vue`:

```vue
<template>
  <aside class="suggest" role="note" data-testid="add-lesson-suggestion">
    <p class="suggest-text">
      You're finding <strong>{{ suggestion.gap }}</strong> tricky — want me to add a
      short <strong>{{ suggestion.suggested_title }}</strong> lesson?
    </p>
    <div class="suggest-actions">
      <button type="button" class="btn-add" data-testid="suggest-add" @click="$emit('add', suggestion)">
        Add
      </button>
      <button type="button" class="btn-dismiss" data-testid="suggest-dismiss" @click="$emit('dismiss')">
        No thanks
      </button>
    </div>
  </aside>
</template>

<script setup>
defineProps({
  suggestion: { type: Object, required: true },
})
defineEmits(['add', 'dismiss'])
</script>

<style scoped>
.suggest {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem;
  padding: 0.875rem 1.125rem; margin: 0.5rem 0;
  border: 1px solid var(--color-accent-soft); border-radius: var(--radius-card);
  background: var(--color-surface-soft);
}
.suggest-text { margin: 0; flex: 1; color: var(--color-text); font-size: 0.9375rem; }
.suggest-actions { display: inline-flex; gap: 0.5rem; }
.btn-add {
  padding: 0.4rem 1rem; border: 0; border-radius: var(--radius-pill);
  background: var(--color-accent-strong); color: #fff; font-weight: 600; cursor: pointer;
}
.btn-dismiss {
  padding: 0.4rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-pill);
  background: transparent; color: var(--color-text-muted); cursor: pointer;
}
</style>
```

Run: `npm run test:unit -- --run src/__tests__/addLessonSuggestion.test.js` from `frontend/`. Expected: 3 passed.

- [ ] **Step 3 — Host it in `SessionView.vue`.** When the check-answer response includes `add_lesson_suggestion` (and the user has not dismissed it this session), render `<AddLessonSuggestion>` inline below the resolved check batch:
  - `@add` -> `await subjectsApi.addLesson(suggestion.subject_id, { title: suggestion.suggested_title, goal: suggestion.suggested_goal })`, then a toast: "Added — see it in your plan" linking to `{ name: 'subject', params: { id: suggestion.subject_id } }`, then clear the active suggestion. (The new lesson appends at end per Spec A; the spec's "insert after current" is best-effort — note inline that strict insert-after would reuse `store.addLessonAfter` if the overview store is loaded; from the session view, appending is acceptable and avoids cross-store coupling.)
  - `@dismiss` -> hold the dismissed `gap` in a session-local `Set` so it does not reappear this session (client-side cap; no server state).
  - Track only one active suggestion at a time; a newer one replaces the old.

Run: `npm run test:unit -- --run` from `frontend/`. Expected: full frontend suite green.

- [ ] **Step 4 — Commit.** `git commit -am "feat(frontend): inline add-practice-lesson suggestion in session view"`

---

## Final verification

- [ ] **Backend:** from `backend/`, `pytest` — all green, coverage >= 75%.
- [ ] **Frontend:** from `frontend/`, `npm run test:unit -- --run` — all green; `npm run lint` clean.
- [ ] **Contracts:** from repo root, `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/` — exit 0 (zero drift).
- [ ] **Spec C coverage self-check:** §1 plan revision (Tasks 7, 8, 10, 11), §2 subject profile (Tasks 1-6); §Testing items — insert-after ordering (T7), reorder integrity (T7), delete guard + force end-detach-delete path (T8), tutor suggestion fires-once + cap (T10), aggregation merge/dedupe + empty + 404 cross-user (T2, T3), mastery map render + drill-down + suggestion confirm (T5, T11).
