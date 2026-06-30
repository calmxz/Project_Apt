# Remove AI multi-lesson plan generation — design

Date: 2026-06-30
Status: approved (brainstorming)

## Summary

The Subjects-Lessons initiative (PRs #95/#96/#97) shipped a wizard that, on
subject creation, calls an LLM (`plan_service.draft_plan`) to generate a 3-12
lesson curriculum. This was over-engineered. We are reverting to "generation of
one new topic": creating a subject seeds exactly one lesson and lands the user
on the subject overview, immediately openable.

This is a **surgical** change. The Subject -> Lessons -> Sessions data model,
the subject overview UI, `subject_profile_service` (the shared per-subject
mastery map), and `plan_revision_service` (the deterministic tutor-suggested
practice lesson) all stay. The grouping the user wanted ("a Topic groups
multiple sessions and holds the shared profile") already exists as the Subject
+ subject-profile; no `parent_topic` column is added.

## Rationale

A subject is the grouping (Claude "Project" analogue); its lessons are the
sessions/chats under it. The AI plan generator front-loaded a fixed curriculum
the learner did not ask for. Removing it makes subject creation cheap and
immediate; the plan grows organically via manual add-lesson and the existing
deterministic tutor suggestion on repeated check misses.

## Decisions

- **Revert scope:** surgical. Keep model, overview, subject-profile, tutor
  suggestion. Remove only the AI multi-lesson generation path.
- **parent_topic:** not built. Current Subject -> sessions grouping covers it.
- **Wizard shape:** minimal. `title -> duration -> Create`. No plan-source step,
  no lesson editor step.
- **Seeded lesson:** server seeds exactly ONE lesson titled after the subject,
  goal `"Introduction to <title>."` (mirrors the old single-lesson fallback).
- **Duration step:** kept, as pace/tracking metadata. It no longer drives any
  generation; the overview already renders and edits it.
- **LessonDraft contract:** dropped entirely. `subject_service.create_subject`
  seeds the one lesson from plain `title`/`goal` args, so no schema is left
  unreferenced at codegen time.
- **No new migration.** The Subject/Lesson schema is unchanged; no Alembic
  revision, `test_migration_chain.py` untouched.

## Removal surface

### Contracts (`docs/api/openapi.yaml`, then `python backend/scripts/gen_contracts.py`)

- Delete path `POST /subjects/draft-plan`.
- Delete schemas `DraftPlanRequest`, `DraftPlanResponse`, `LessonDraft`.
- `SubjectCreateRequest`: remove `mode` and `lessons`; new `required`
  is `[title, per_session_minutes, duration_mode]` (+ the duration fields).
- Regenerate `backend/contracts/models.py`; CI enforces zero drift.

### Backend

- Delete `backend/services/plan_service.py` (whole file: `draft_plan`,
  `MIN_LESSONS`, `MAX_LESSONS`, `_parse`, `_fallback`, `_duration_instruction`).
- Remove `plan_service` from `backend/services/__init__.py` exports.
- `backend/routes/subjects.py`:
  - Delete the `draft_plan_preview` route (`POST /subjects/draft-plan`).
  - In `create_subject`: drop the `if req.mode == "draft"` branch and the
    `req.lessons` handling. Call `subject_service.create_subject(...)` with the
    duration args only; the service seeds the one lesson.
  - Drop now-unused imports (`DraftPlanRequest`, `DraftPlanResponse`,
    `plan_service`).
- `backend/services/subject_service.py`:
  - `create_subject` signature drops the `lessons` param; it always seeds one
    lesson titled after the subject (goal `"Introduction to <title>."`).
  - Drop the `LessonDraft` import.
- Delete `backend/tests/test_plan_service.py`. Update `test_subjects_route.py`
  / `test_subject_service.py` cases that pass `mode`/`lessons` or assert
  multi-lesson creation; assert a freshly created subject has exactly one
  lesson titled after the subject. Contract tests
  (`test_contracts_subjects.py`) updated for the new `SubjectCreateRequest`.

### Frontend

- `frontend/src/services/subjectsApi.js`: remove `draftPlan`.
- `frontend/src/stores/subject.js`: remove `draftPlan`; `createSubject` payload
  drops `mode`/`lessons` (sends `title`, `per_session_minutes`, duration fields
  only).
- `frontend/src/views/SubjectWizardView.vue`: remove the `source` step
  (Draft with AI / Start blank), the `editor` step, `chooseDraft`,
  `chooseBlank`, `addLessonRow`/`removeLessonRow`/`moveLesson`, the
  `lessons`/`lessonTitle`/`lessonGoal`/`drafting`/`draftError` refs, and the
  associated CSS. New flow: `title` step -> `duration` step whose primary button
  calls `commitCreate` directly. `commitCreate` posts `basePayload()` (no
  `mode`, no `lessons`) and routes to `subject-overview`.
- Update `subjectWizardView.test.js`, `subjectStore.test.js`,
  `subjectsApi.test.js`: drop all draft-path assertions; assert the two-step
  wizard creates a subject from title + duration and navigates to the overview.

## Out of scope

- `parent_topic` / topic-of-topics grouping.
- Any change to subject-profile aggregation or the tutor practice-lesson
  suggestion.
- Manual add-lesson on the overview (already exists; unchanged).

## Verification

- `python backend/scripts/gen_contracts.py` produces no drift.
- Backend `pytest` green (including the rewritten subject route/service tests).
- Frontend `npm run test:unit -- --run` green.
- Manual: New Subject wizard = title -> duration -> Create lands on overview
  with one lesson titled after the subject, openable into a chat. No
  "Draft with AI" path remains.
