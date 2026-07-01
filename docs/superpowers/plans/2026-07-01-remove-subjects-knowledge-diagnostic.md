# Remove Subjects Workflow + Knowledge Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Build a subject" workflow end-to-end and add a first-turn knowledge-level diagnostic to the (renamed) "New lesson" flow.

**Architecture:** Delete all Subject/Lesson code (frontend views + store + routes, backend routes + services + models, DB tables, contract schemas). Excise the subject-coupled `plan_revision` branch from the surviving check-answer route. Add a tutor-first-turn diagnostic: the server derives `diagnostic_required` from `knowledge_level is None`, the tutor emits a 3-question MC batch via existing check-question machinery, and the server grades it deterministically to set `knowledge_level` while bypassing mastery mutation.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (Supabase Postgres), Pydantic contracts via codegen, Vue 3 + Pinia + Vitest + Playwright.

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py` from repo root. Never hand-edit `backend/contracts/`. CI enforces zero drift.
- Backend tests: from `backend/`, `pytest`. Single: `pytest tests/test_x.py::test_y -v`.
- Frontend tests: from `frontend/`, `npm run test:unit -- --run`. Lint: `npm run lint`.
- Diagnostic level assignment is server-side deterministic (score->level), never LLM-judged.
- Diagnostic thresholds (3-question batch): 0-1 correct -> `beginner`, 2 -> `intermediate`, 3 -> `advanced`.
- Diagnostic trigger: `topic_profile.knowledge_level is None` (no `seed_mode` gate; it is not persisted).
- Home card renamed "Quick lesson" -> "New lesson"; keep subhead "One topic. Type and go.".
- Branch fresh off `dev` (supersedes PR #98; close #98 with a pointer after merge).

## File Structure

**Backend deletes:** `routes/subjects.py`, `services/subject_service.py`, `services/subject_profile_service.py`, `services/plan_service.py`, `services/plan_revision_service.py`, `tests/test_subject_*.py`, `tests/test_plan_revision_service.py`, `tests/test_plan_service.py`.

**Backend edits:** `main.py` (unregister router), `routes/sessions.py` (drop `subject_id` mappings + `plan_revision`), `db/models.py` (drop Subject/Lesson + `Session.subject_id`), `db/alembic/versions/<new>.py` (drop migration), `services/learning_event_service.py` (`apply_profile_effects`), `services/check_question_service.py` (`purpose` tag), `agent/prompts.py` (DIAGNOSTIC label + protocol), `routes/chat.py` (set `diagnostic_required`).

**Frontend deletes:** `views/SubjectWizardView.vue`, `views/SubjectOverview.vue`, `views/SubjectProfileView.vue`, `components/sidebar/SidebarSubjectNode.vue`, `components/chat/LessonContextBar.vue`, `stores/subject.js`, subject Playwright spec.

**Frontend edits:** `views/HomeView.vue`, `router/index.js`, `components/sidebar/Sidebar.vue`, `views/SessionView.vue`, `__tests__/homeView.test.js`, `__tests__/smoke.test.js`.

**Contracts:** `docs/api/openapi.yaml` (+ regenerated `backend/contracts/models.py`).

---

## PHASE 1 - Backend removal

### Task 1: Excise plan_revision from the check-answer route

**Files:**
- Modify: `backend/routes/sessions.py:37,403-406`
- Delete: `backend/services/plan_revision_service.py`
- Delete: `backend/tests/test_plan_revision_service.py`
- Test: `backend/tests/test_check_answer_route.py`

**Interfaces:**
- Produces: `answer_check` returns `CheckAnswerResponse(**result)` with no `add_lesson_suggestion`.

- [ ] **Step 1: Update the route test** — in `test_check_answer_route.py`, remove any assertion referencing `add_lesson_suggestion` and add:

```python
def test_answer_check_has_no_add_lesson_suggestion(client, seeded_session_with_open_check):
    sid = seeded_session_with_open_check
    r = client.post(f"/api/sessions/{sid}/check/answer", json={"index": 0, "selected_index": 0})
    assert r.status_code == 200
    assert "add_lesson_suggestion" not in r.json()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests/test_check_answer_route.py::test_answer_check_has_no_add_lesson_suggestion -v`
Expected: FAIL (`add_lesson_suggestion` still present in response).

- [ ] **Step 3: Excise the branch** — in `backend/routes/sessions.py`, remove `plan_revision_service` from the import at line 37 and replace lines 403-406:

```python
    check_question_service.write_check_batch(
        db, check_question_service.get_pending_check(db, session_id)
    )
    return CheckAnswerResponse(**result)
```

Also delete the now-unused `gap = pc.get("gap") ...` and `pc = check_question_service.get_pending_check(...)` lines only if nothing else in the function uses them (verify `pc`/`gap` are not referenced elsewhere in `answer_check`; if unused, remove).

- [ ] **Step 4: Delete the service + its test**

```bash
git rm backend/services/plan_revision_service.py backend/tests/test_plan_revision_service.py
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && pytest tests/test_check_answer_route.py -v`
Expected: PASS. Then `pytest -q` — expect no import errors for `plan_revision_service`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(backend): remove subject-coupled plan_revision from check-answer"
```

---

### Task 2: Remove subject routes + services + router registration

**Files:**
- Delete: `backend/routes/subjects.py`, `backend/services/subject_service.py`, `backend/services/subject_profile_service.py`, `backend/services/plan_service.py`
- Delete: `backend/tests/test_subject_*.py`, `backend/tests/test_plan_service.py` (any subject/plan route+service tests)
- Modify: `backend/main.py` (unregister subjects router)

**Interfaces:**
- Produces: no `/api/subjects*` routes exist; app still boots.

- [ ] **Step 1: Write a guard test** — in `backend/tests/test_app_boot.py` (create if absent):

```python
def test_no_subject_routes(client):
    for r in [
        client.get("/api/subjects"),
        client.post("/api/subjects", json={}),
        client.get("/api/subjects/x"),
    ]:
        assert r.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_app_boot.py::test_no_subject_routes -v`
Expected: FAIL (routes still registered; 404 not returned for all).

- [ ] **Step 3: Delete route + services + their tests**

```bash
git rm backend/routes/subjects.py backend/services/subject_service.py \
       backend/services/subject_profile_service.py backend/services/plan_service.py
git rm backend/tests/test_subject_service.py backend/tests/test_subjects_route.py \
       backend/tests/test_subject_profile_service.py backend/tests/test_plan_service.py 2>/dev/null || true
```

(Use `git ls-files backend/tests | grep -Ei 'subject|plan'` first to list exact test files; delete each.)

- [ ] **Step 4: Unregister the router** — in `backend/main.py`, remove the `from routes import subjects` import and the `app.include_router(subjects.router, ...)` line.

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && pytest tests/test_app_boot.py -v && pytest -q`
Expected: guard PASS; full suite has no `ModuleNotFoundError` for deleted modules. Fix any lingering imports of the deleted services (grep: `git grep -n 'subject_service\|subject_profile_service\|plan_service'` in `backend/`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(backend): remove subjects routes + services"
```

---

### Task 3: Drop Subject/Lesson models + Session.subject_id + migration

**Files:**
- Modify: `backend/db/models.py` (remove `Subject`, `Lesson`, `Session.subject_id` + relationship)
- Modify: `backend/routes/sessions.py:60,80,274` (remove `subject_id=` kwargs)
- Create: `backend/db/alembic/versions/<rev>_drop_subjects_lessons.py`
- Test: `backend/tests/test_models_no_subjects.py`

**Interfaces:**
- Produces: `Session` has no `subject_id`; `Subject`/`Lesson` classes gone.

- [ ] **Step 1: Write the test**

```python
def test_session_model_has_no_subject_id():
    from db.models import Session as SessionModel
    assert not hasattr(SessionModel, "subject_id")

def test_subject_lesson_models_removed():
    import db.models as m
    assert not hasattr(m, "Subject")
    assert not hasattr(m, "Lesson")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_models_no_subjects.py -v`
Expected: FAIL (`subject_id`/`Subject`/`Lesson` still present).

- [ ] **Step 3: Edit models** — in `backend/db/models.py` delete the `Subject` and `Lesson` classes and, on `Session`, remove the `subject_id` column and any `subject`/`lessons` relationship.

- [ ] **Step 4: Fix response mappings** — in `backend/routes/sessions.py` remove the `subject_id=row.subject_id` / `subject_id=r.subject_id` kwargs at the three mapping sites (lines ~60, ~80, ~274).

- [ ] **Step 5: Generate the drop migration**

```bash
cd backend && alembic revision --autogenerate -m "drop subjects lessons"
```

Then hand-verify the generated `upgrade()` drops in FK-safe order and `downgrade()` recreates:

```python
def upgrade() -> None:
    op.drop_constraint("sessions_subject_id_fkey", "sessions", type_="foreignkey")
    op.drop_column("sessions", "subject_id")
    op.drop_table("lessons")
    op.drop_table("subjects")

def downgrade() -> None:
    # recreate empty subjects/lessons + sessions.subject_id (nullable) for reversibility
    ...
```

(Match exact constraint/table names to the autogen output; adjust if the FK name differs.)

- [ ] **Step 6: Run migration + tests against the local/test DB**

Run: `cd backend && alembic upgrade head && pytest tests/test_models_no_subjects.py -v && pytest -q`
Expected: migration applies clean; tests PASS; full suite green. DO NOT run against live Supabase yet - flag for user sign-off (destructive).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(backend): drop Subject/Lesson models + Session.subject_id + migration"
```

---

### Task 4: Remove subject/lesson schemas from contracts

**Files:**
- Modify: `docs/api/openapi.yaml`
- Regenerate: `backend/contracts/models.py` (codegen)
- Test: `backend/tests/test_contracts_no_subjects.py`

**Interfaces:**
- Produces: contracts export no Subject*/Lesson*/`AddLessonSuggestion`; `SessionResponse` has no `subject_id`; `CheckAnswerResponse` has no `add_lesson_suggestion`.

- [ ] **Step 1: Write the test**

```python
def test_contracts_drop_subject_symbols():
    import contracts
    for name in [
        "SubjectCreateRequest", "SubjectDetail", "SubjectListItem",
        "SubjectProfileResponse", "SubjectLessonRollup", "LessonItem",
        "LessonCreateRequest", "LessonUpdateRequest", "LessonDraft",
        "AddLessonSuggestion",
    ]:
        assert not hasattr(contracts, name), name

def test_session_response_has_no_subject_id():
    from contracts import SessionResponse
    assert "subject_id" not in SessionResponse.model_fields

def test_check_answer_response_has_no_suggestion():
    from contracts import CheckAnswerResponse
    assert "add_lesson_suggestion" not in CheckAnswerResponse.model_fields
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_contracts_no_subjects.py -v`
Expected: FAIL (symbols still present).

- [ ] **Step 3: Edit openapi.yaml** — remove all `/api/subjects*` paths; remove the schemas listed in Step 1 from `components/schemas`; remove `subject_id` from the `SessionResponse`/`SessionListItem`/`SessionDetail` schemas; remove `add_lesson_suggestion` from `CheckAnswerResponse`. Remove any `$ref`s to the deleted schemas.

- [ ] **Step 4: Regenerate + verify zero drift**

```bash
python backend/scripts/gen_contracts.py
git diff --exit-code backend/contracts/  # nonzero means regen changed files -> stage them
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && pytest tests/test_contracts_no_subjects.py -v && pytest -q`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/ backend/tests/test_contracts_no_subjects.py
git commit -m "feat(contracts): drop subject/lesson schemas + subject_id + add_lesson_suggestion"
```

---

## PHASE 2 - Backend diagnostic

### Task 5: `record_from_answer` gains `apply_profile_effects` bypass

**Files:**
- Modify: `backend/services/learning_event_service.py:64-106`
- Test: `backend/tests/test_learning_event_service.py`

**Interfaces:**
- Produces: `record_from_answer(db, session_id, *, gap, question, correct, clear_pending=True, commit=True, apply_profile_effects=True)`. When `apply_profile_effects=False`, the `LearningEvent` is still written but `mastered_concepts` is not mutated.

- [ ] **Step 1: Write the tests**

```python
def test_record_from_answer_skips_mastery_when_disabled(db, session_id):
    from services import learning_event_service as les, profile_service
    les.record_from_answer(db, session_id, gap="warmup", question="q",
                           correct=True, clear_pending=False,
                           apply_profile_effects=False)
    prof = profile_service.load_profile(db, session_id)
    assert "warmup" not in (prof.mastered_concepts or [])

def test_record_from_answer_applies_mastery_by_default(db, session_id):
    from services import learning_event_service as les, profile_service
    les.record_from_answer(db, session_id, gap="loops", question="q",
                           correct=True, clear_pending=False)
    prof = profile_service.load_profile(db, session_id)
    assert "loops" in (prof.mastered_concepts or [])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_learning_event_service.py -k apply_profile_effects -v`
Expected: FAIL (`apply_profile_effects` is an unexpected keyword argument).

- [ ] **Step 3: Implement** — add the parameter and guard the mutation block:

```python
def record_from_answer(
    db, session_id, *, gap, question, correct,
    clear_pending=True, commit=True, apply_profile_effects=True,
):
    event = LearningEvent(...)  # unchanged
    db.add(event)
    if apply_profile_effects:
        profile = profile_service.load_profile(db, session_id)
        mastered = list(profile.mastered_concepts or [])
        if correct:
            if gap not in mastered:
                mastered.append(gap)
                profile.mastered_concepts = mastered
                profile_service.save_profile(db, session_id, profile, commit=False)
        else:
            if gap in mastered:
                profile.mastered_concepts = [c for c in mastered if c != gap]
                profile_service.save_profile(db, session_id, profile, commit=False)
    if clear_pending:
        check_question_service.clear_pending_check(db, session_id, commit=False)
    if commit:
        db.commit()
```

(Preserve the existing `clear_pending`/`commit` logic exactly; only wrap the mastery block in `if apply_profile_effects:`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && pytest tests/test_learning_event_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(backend): add apply_profile_effects bypass to record_from_answer"
```

---

### Task 6: Tag diagnostic batches + route grading past mastery mutation

**Files:**
- Modify: `backend/services/check_question_service.py` (`register`, `answer`)
- Test: `backend/tests/test_check_question_service.py`

**Interfaces:**
- Consumes: `record_from_answer(..., apply_profile_effects=...)` from Task 5.
- Produces: `pc["purpose"]` in `{"diagnostic","check"}`; `answer()` passes `apply_profile_effects=(purpose != "diagnostic")`. `public_view` unchanged (purpose is server-only, not leaked).

- [ ] **Step 1: Write the tests**

```python
def test_register_tags_diagnostic_when_level_unknown(db, ctx_fresh_session):
    # profile.knowledge_level is None on a fresh session
    from services import check_question_service as cqs
    cqs.register(db, ctx_fresh_session, one_item_args(gap="warmup"))
    pc = cqs.get_pending_check(db, ctx_fresh_session.session_id)
    assert pc["purpose"] == "diagnostic"

def test_register_tags_check_when_level_known(db, ctx_session_with_level):
    from services import check_question_service as cqs
    cqs.register(db, ctx_session_with_level, one_item_args(gap="loops"))
    pc = cqs.get_pending_check(db, ctx_session_with_level.session_id)
    assert pc["purpose"] == "check"

def test_diagnostic_correct_answer_does_not_master(db, ctx_fresh_session):
    from services import check_question_service as cqs, profile_service
    sid = ctx_fresh_session.session_id
    cqs.register(db, ctx_fresh_session, one_item_args(gap="warmup", correct_index=0))
    cqs.answer(db, sid, 0, 0)  # correct
    assert "warmup" not in (profile_service.load_profile(db, sid).mastered_concepts or [])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_check_question_service.py -k "diagnostic or purpose" -v`
Expected: FAIL (`purpose` key absent).

- [ ] **Step 3: Implement in `register`** — after loading, derive purpose and store it in `pc`:

```python
from services import profile_service
level = profile_service.load_profile(db, ctx.session_id).knowledge_level
purpose = "diagnostic" if level is None else "check"
pc = {
    "gap": args.gap,
    "purpose": purpose,
    "current_index": 0,
    ...  # rest unchanged
}
```

- [ ] **Step 4: Implement in `answer`** — pass the bypass based on purpose:

```python
apply_effects = pc.get("purpose", "check") != "diagnostic"
learning_event_service.record_from_answer(
    db, session_id, gap=pc["gap"], question=item["question"],
    correct=correct, clear_pending=False, commit=False,
    apply_profile_effects=apply_effects,
)
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && pytest tests/test_check_question_service.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(backend): tag diagnostic check batches + bypass mastery mutation"
```

---

### Task 7: Score->level assignment on diagnostic completion

**Files:**
- Modify: `backend/routes/sessions.py` (`answer_check`)
- Create: `backend/services/diagnostic_service.py` (score->level helper)
- Test: `backend/tests/test_diagnostic_grading.py`

**Interfaces:**
- Consumes: `check_question_service.get_pending_check`, `is_done`; `profile_service.load_profile/save_profile`.
- Produces: `diagnostic_service.level_for_score(n_correct: int, total: int) -> str` returns `"beginner"|"intermediate"|"advanced"`. On the final answer of a diagnostic batch, `answer_check` writes `knowledge_level`.

- [ ] **Step 1: Write the helper + route tests**

```python
import pytest
from services.diagnostic_service import level_for_score

@pytest.mark.parametrize("n,expected", [(0,"beginner"),(1,"beginner"),(2,"intermediate"),(3,"advanced")])
def test_level_for_score_3q(n, expected):
    assert level_for_score(n, 3) == expected

def test_answer_check_sets_level_on_diagnostic_completion(client, db, fresh_session_with_diagnostic_batch):
    sid, correct_indices = fresh_session_with_diagnostic_batch  # 3-item diagnostic batch, all correct
    for i, ci in enumerate(correct_indices):
        r = client.post(f"/api/sessions/{sid}/check/answer", json={"index": i, "selected_index": ci})
        assert r.status_code == 200
    from services import profile_service
    assert profile_service.load_profile(db, sid).knowledge_level == "advanced"

def test_answer_check_normal_check_leaves_level(client, db, session_with_level_and_check_batch):
    sid = session_with_level_and_check_batch  # knowledge_level already "intermediate"
    client.post(f"/api/sessions/{sid}/check/answer", json={"index": 0, "selected_index": 0})
    from services import profile_service
    assert profile_service.load_profile(db, sid).knowledge_level == "intermediate"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_diagnostic_grading.py -v`
Expected: FAIL (`diagnostic_service` missing; level not set).

- [ ] **Step 3: Create the helper** — `backend/services/diagnostic_service.py`:

```python
"""Deterministic knowledge-level assignment from a diagnostic check batch."""
from __future__ import annotations


def level_for_score(n_correct: int, total: int) -> str:
    """Map a diagnostic score to a coarse knowledge level.

    Tuned for a 3-question batch: 0-1 beginner, 2 intermediate, 3 advanced.
    Generalizes by ratio for other batch sizes."""
    if total <= 0:
        return "beginner"
    ratio = n_correct / total
    if ratio >= 1.0:
        return "advanced"
    if ratio >= (2 / 3):
        return "intermediate"
    return "beginner"
```

- [ ] **Step 4: Wire into `answer_check`** — after `write_check_batch(...)` in `sessions.py`:

```python
    pc_after = check_question_service.get_pending_check(db, session_id)
    if (
        pc_after
        and pc_after.get("purpose") == "diagnostic"
        and check_question_service.is_done(pc_after)
    ):
        items = pc_after.get("items", [])
        graded = [it for it in items if it["status"] == "answered"]
        n_correct = sum(1 for it in graded if it.get("correct"))
        level = diagnostic_service.level_for_score(n_correct, len(items))
        profile = profile_service.load_profile(db, session_id)
        profile.knowledge_level = level
        profile_service.save_profile(db, session_id, profile)
    return CheckAnswerResponse(**result)
```

Add `diagnostic_service` to the `from services import ...` line in `sessions.py`.

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && pytest tests/test_diagnostic_grading.py -v && pytest -q`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(backend): set knowledge_level from diagnostic batch score"
```

---

### Task 8: `diagnostic_required` in prompt state + tutor protocol

**Files:**
- Modify: `backend/routes/chat.py:93-99` (add `diagnostic_required` to `prompt_state`)
- Modify: `backend/agent/prompts.py` (`build_dynamic_context` DIAGNOSTIC label + IMMUTABLE_RULES protocol line)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: `profile.knowledge_level`.
- Produces: dynamic context includes `DIAGNOSTIC: REQUIRED|OFF`; protocol instructs emitting a 3-question diagnostic batch before teaching when REQUIRED.

- [ ] **Step 1: Write the tests**

```python
def test_dynamic_context_diagnostic_required():
    from agent.prompts import build_dynamic_context
    s = build_dynamic_context({"topic": "Recursion", "diagnostic_required": True})
    assert "DIAGNOSTIC: REQUIRED" in s

def test_dynamic_context_diagnostic_off_by_default():
    from agent.prompts import build_dynamic_context
    s = build_dynamic_context({"topic": "Recursion"})
    assert "DIAGNOSTIC: OFF" in s
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && pytest tests/test_prompts.py -k diagnostic -v`
Expected: FAIL (no DIAGNOSTIC label).

- [ ] **Step 3: Render the label** — in `build_dynamic_context`, after the `retrieval_label` line:

```python
    diagnostic_required = bool(state.get("diagnostic_required", False))
    diagnostic_label = "REQUIRED" if diagnostic_required else "OFF"
```

and add `f"DIAGNOSTIC: {diagnostic_label}\n"` to the returned block (place it right after the `RETRIEVAL:` line).

- [ ] **Step 4: Add the protocol rule** — in `IMMUTABLE_RULES` add a concise block:

```
KNOWLEDGE DIAGNOSTIC:
When DIAGNOSTIC is REQUIRED, before any teaching, call ask_check_questions ONCE with
exactly 3 multiple-choice items on the TOPIC at increasing difficulty (easy, medium, hard).
Do not teach or explain first. After the learner answers, continue teaching at their level.
When DIAGNOSTIC is OFF, follow the normal check-question protocol.
```

- [ ] **Step 5: Set the flag in chat.py** — in `prompt_state` (lines 93-99) add:

```python
        "diagnostic_required": profile.knowledge_level is None,
```

- [ ] **Step 6: Run to verify pass**

Run: `cd backend && pytest tests/test_prompts.py -v && pytest -q`
Expected: PASS; full suite green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(backend): inject diagnostic_required + first-turn diagnostic protocol"
```

---

## PHASE 3 - Frontend

### Task 9: Home - remove Build-a-subject card, rename to "New lesson"

**Files:**
- Modify: `frontend/src/views/HomeView.vue:36-47,96-98`
- Test: `frontend/src/__tests__/homeView.test.js`, `frontend/src/__tests__/smoke.test.js`

**Interfaces:**
- Produces: single card headed "New lesson"; no `home-mode-subject` / `home-build-start` testids; no `buildSubject`/`subject-new` reference.

- [ ] **Step 1: Update the tests** — in `homeView.test.js`:

```js
it('shows a single New lesson card, no Build a subject', () => {
  const wrapper = mountHome()
  expect(wrapper.text()).toContain('New lesson')
  expect(wrapper.text()).not.toContain('Build a subject')
  expect(wrapper.find('[data-testid="home-mode-subject"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="home-build-start"]').exists()).toBe(false)
})

it('Start still creates a session and navigates', async () => {
  const wrapper = mountHome()
  await wrapper.find('[data-testid="home-quick-topic"]').setValue('Recursion')
  await wrapper.find('[data-testid="home-quick-go"]').trigger('click')
  expect(createSessionMock).toHaveBeenCalledWith({ topic: 'Recursion', seedMode: 'fresh', priorSessionId: null })
})
```

In `smoke.test.js`, replace any "Quick lesson"/"Build a subject" assertion with "New lesson".

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/homeView.test.js`
Expected: FAIL (card + heading still old).

- [ ] **Step 3: Edit HomeView.vue** — delete the entire second `mode-card` block (`data-testid="home-mode-subject"`, lines ~36-47); rename the first card heading `Quick lesson` -> `New lesson`; delete the `buildSubject()` function (lines ~96-98) and its usage. Leave `startQuick`, the input, Start button, and "Add reference files" link intact.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/homeView.test.js src/__tests__/smoke.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): single New lesson card on Home; drop Build a subject"
```

---

### Task 10: Router - remove subject routes

**Files:**
- Modify: `frontend/src/router/index.js:59-69,87-92`
- Test: `frontend/src/__tests__/router.test.js` (create if absent)

**Interfaces:**
- Produces: no routes named `subject-new`, `subject-overview`, `subject-mastery`.

- [ ] **Step 1: Write the test**

```js
import router from '../router/index.js'
it('has no subject routes', () => {
  const names = router.getRoutes().map((r) => r.name)
  expect(names).not.toContain('subject-new')
  expect(names).not.toContain('subject-overview')
  expect(names).not.toContain('subject-mastery')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/router.test.js`
Expected: FAIL (routes present).

- [ ] **Step 3: Edit router** — delete the three route objects (`subject-new` lines ~59-63, `subject-overview` ~64-69, `subject-mastery` ~87-92) and their dynamic imports.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test:unit -- --run src/__tests__/router.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(frontend): remove subject routes from router"
```

---

### Task 11: Delete subject views/store/components + fix consumers

**Files:**
- Delete: `frontend/src/views/SubjectWizardView.vue`, `SubjectOverview.vue`, `SubjectProfileView.vue`, `frontend/src/components/sidebar/SidebarSubjectNode.vue`, `frontend/src/components/chat/LessonContextBar.vue`, `frontend/src/stores/subject.js`
- Modify: `frontend/src/components/sidebar/Sidebar.vue` (remove subject grouping + SidebarSubjectNode usage), `frontend/src/views/SessionView.vue` (remove LessonContextBar usage)
- Delete: subject-related component tests (`git ls-files frontend/src | grep -iE 'subject|lessoncontext'`)

**Interfaces:**
- Produces: no imports of deleted files remain; sidebar lists sessions directly.

- [ ] **Step 1: Delete the files**

```bash
git rm frontend/src/views/SubjectWizardView.vue frontend/src/views/SubjectOverview.vue \
       frontend/src/views/SubjectProfileView.vue \
       frontend/src/components/sidebar/SidebarSubjectNode.vue \
       frontend/src/components/chat/LessonContextBar.vue \
       frontend/src/stores/subject.js
# delete their unit tests too (list first):
git ls-files frontend/src | grep -iE 'subject|lessoncontext'
```

- [ ] **Step 2: Find every consumer**

Run: `cd frontend && git grep -nE "SubjectWizardView|SubjectOverview|SubjectProfileView|SidebarSubjectNode|LessonContextBar|stores/subject|useSubjectStore"`
Expected: hits in `Sidebar.vue` and `SessionView.vue` (and possibly others). Each must be removed.

- [ ] **Step 3: Edit `Sidebar.vue`** — remove the `SidebarSubjectNode` import + component registration, remove the subject-grouping computed/loop, and render the flat session list directly (follow the existing session-node rendering already present in the component). Remove any `useSubjectStore` usage.

- [ ] **Step 4: Edit `SessionView.vue`** — remove the `LessonContextBar` import and its `<LessonContextBar ... />` usage in the template. A session no longer displays subject/lesson context.

- [ ] **Step 5: Verify no dangling references + lint**

Run: `cd frontend && git grep -nE "Subject|LessonContextBar|useSubjectStore" src/ ; npm run lint`
Expected: no source references to deleted symbols; lint clean.

- [ ] **Step 6: Run full unit suite**

Run: `cd frontend && npm run test:unit -- --run`
Expected: PASS (fix any test still importing deleted modules).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(frontend): delete subject views/store + sidebar grouping + LessonContextBar"
```

---

### Task 12: Remove/adjust subject Playwright e2e

**Files:**
- Delete: `frontend/e2e/subject-blank-create.spec.js` (and any other subject wizard spec)
- Test: existing e2e config

**Interfaces:**
- Produces: no e2e spec drives the removed subject wizard.

- [ ] **Step 1: List subject e2e specs**

Run: `cd frontend && git ls-files e2e | grep -iE 'subject|lesson'`
Expected: `subject-blank-create.spec.js` (currently Phase-8-skipped).

- [ ] **Step 2: Delete them**

```bash
git rm frontend/e2e/subject-blank-create.spec.js
# plus any others listed
```

- [ ] **Step 3: Verify no e2e references removed routes/testids**

Run: `cd frontend && git grep -nE "subjects/new|home-build-start|home-mode-subject" e2e/`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(frontend): remove subject wizard e2e spec"
```

---

## PHASE 4 - Verification

### Task 13: Full-suite verification + contract drift

**Files:** none (verification only)

- [ ] **Step 1: Backend**

Run: `cd backend && pytest -q`
Expected: all green; no import errors for any deleted module.

- [ ] **Step 2: Contract drift**

Run: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/`
Expected: exit 0 (no drift).

- [ ] **Step 3: Frontend unit + lint**

Run: `cd frontend && npm run test:unit -- --run && npm run lint`
Expected: all green; lint clean.

- [ ] **Step 4: Repo-wide dangling-reference sweep**

Run: `git grep -niE "subject|plan_revision|add_lesson_suggestion|LessonContextBar" -- backend/ frontend/src/ | grep -viE "docs/|\.md"`
Expected: no live-code references (matches only in specs/plans/migrations are OK). Investigate any hit.

- [ ] **Step 5: Live-DB migration sign-off (user gate)**

Do NOT run against live Supabase automatically. Present the migration to the user; on approval run `alembic upgrade head` against the live DB and confirm existing sessions still load (no `subject_id` errors).

- [ ] **Step 6: Final commit (if any sweep fixes)**

```bash
git add -A && git commit -m "chore: final subject-removal sweep + verification"
```

---

## Self-Review Notes

- **Spec coverage:** Area 1 -> Tasks 2,3,4,10,11,12; Area 2 -> Task 1; Area 3 -> Task 9; Area 4 -> Tasks 5,6,7,8; Area 5 (port nothing) -> no task by design.
- **Ordering:** removals sequenced so each task keeps the suite green (route branch -> routes/services -> models+migration -> contracts). `add_lesson_suggestion` field kept optional until Task 4 removes it, so Task 1's route change validates meanwhile.
- **Profile-pollution guard** (Tasks 5-6) is the non-obvious correctness piece; covered by explicit tests.
- **Live-DB migration** is gated behind user sign-off (Task 13 Step 5).
- **Fixtures** named in tests (e.g. `fresh_session_with_diagnostic_batch`, `ctx_fresh_session`) must be added to `conftest.py` during the owning task if not present; each test task's implementer creates missing fixtures following existing conftest patterns.
