# Remove Subjects Workflow + Knowledge Diagnostic on New Lesson

Date: 2026-07-01
Status: Approved design, pending implementation plan
Branch: fresh off `dev` (supersedes PR #98)

## Summary

Remove the "Build a subject" workflow end-to-end (frontend, backend, DB, contracts).
Collapse the Home screen to a single lesson-creation entry, renaming "Quick lesson" to
"New lesson". Add a knowledge-level diagnostic that runs on the first turn of a fresh
lesson: the tutor asks a 3-question multiple-choice batch, the server grades it
deterministically and sets `knowledge_level`, then the tutor teaches calibrated to that level.

No subject-specific features (mastery map, plan revision, duration planning) are ported —
the only genuinely useful addition, the diagnostic, is new and independent of subjects.

## Context / Decisions

- **Supersedes PR #98.** That branch removed the AI multi-lesson draft but kept subjects.
  Its edits live inside files this work deletes (`subjects.py`, `plan_service.py`,
  `SubjectCreateRequest`). Branch fresh off current `dev` (#97 already merged); close #98
  with a pointer to this work.
- **Diagnostic is tutor-first-turn, not a pre-session UI.** A pre-session UI would need
  topic-specific questions before the session exists (chicken/egg). Tutor-first-turn reuses
  the existing MC check-question machinery and matches the intent ("check-questions the tutor
  uses to infer level").
- **Level assignment is server-side deterministic** (score to level), not LLM-judged. This is
  the robustness anchor against the Phase 2/3 >=85% tool-reliability checkpoints.

## Area 1 - Full-stack subject removal

### Frontend (delete)
- `frontend/src/views/SubjectWizardView.vue`
- `frontend/src/views/SubjectOverview.vue`
- `frontend/src/views/SubjectProfileView.vue`
- `frontend/src/components/sidebar/SidebarSubjectNode.vue`
- `frontend/src/stores/subject.js`

### Frontend (edit)
- `frontend/src/router/index.js` - remove routes `subject-new`, `subject-overview`,
  `subject-mastery` (and their imports).
- `frontend/src/components/sidebar/Sidebar.vue` - remove subject-grouping logic and the
  `SidebarSubjectNode` usage; sidebar lists sessions directly.
- `frontend/src/components/chat/LessonContextBar.vue` - subject/lesson-coupled. Remove the
  component and its usage in `SessionView.vue` (a session is no longer "a lesson in a
  subject"; it is a standalone lesson).
- Any remaining `RouterLink`/`router.push` targets pointing at the three removed routes.
- Any consumer of the deleted `stores/subject.js`.

### Backend (delete)
- `backend/routes/subjects.py`
- `backend/services/subject_service.py`
- `backend/services/subject_profile_service.py`
- `backend/services/plan_service.py`
- `backend/services/plan_revision_service.py` (see Area 2)

### Backend (edit)
- `backend/main.py` - unregister the subjects router.
- `backend/routes/sessions.py` - remove `subject_id` from `SessionResponse` mappings
  (lines ~60, ~80, ~274) and the `plan_revision` import/usage (Area 2).
- `backend/db/models.py` - remove `Subject` and `Lesson` models and the
  `Session.subject_id` column + relationship.

### Database migration (Alembic)
Drop in FK-safe order:
1. `lessons` table (has FK to `subjects` and to `sessions`)
2. `subjects` table
3. `Session.subject_id` column

Existing sessions survive: `subject_id` is nullable and no non-subject code depends on it.
This is the destructive step the user approved; confirm before running against live Supabase.
Include a downgrade path that recreates the columns/tables (empty) for reversibility.

### Contracts (codegen, not hand-edit)
Edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py`:
- Remove schemas: `SubjectCreateRequest`, `SubjectDetail`, `SubjectListItem`,
  `SubjectProfileResponse`, `SubjectLessonRollup`, `LessonItem`, `LessonCreateRequest`,
  `LessonUpdateRequest`, `LessonDraft`, `AddLessonSuggestion`.
- Remove all `/api/subjects*` paths.
- Remove `subject_id` from `SessionResponse`.
- Remove `add_lesson_suggestion` from `CheckAnswerResponse` (Area 2).
- Add diagnostic fields to the check/session contracts (Area 4).

CI enforces zero contract drift, so codegen output must be committed.

## Area 2 - Excise plan_revision from surviving code

`plan_revision_service.maybe_suggest_lesson` is subject-coupled but is called from the
check-answer route that **quick/new lessons still use**. This is the one place subject removal
reaches into surviving code.

- `backend/routes/sessions.py:403-406` - remove the `suggestion = ...` branch and the
  `add_lesson_suggestion=suggestion` kwarg; return `CheckAnswerResponse(**result)`.
- Delete `backend/services/plan_revision_service.py`.
- `backend/tests/test_check_answer_route.py` - drop assertions on `add_lesson_suggestion`.
- Delete `backend/tests/test_plan_revision_service.py`.
- Check-question grading itself is untouched.

## Area 3 - Home: single entry, "New lesson"

`frontend/src/views/HomeView.vue`:
- Remove the `mode-card` for "Build a subject" (`data-testid="home-mode-subject"`), the
  `buildSubject()` handler, and the `subject-new` navigation.
- Rename the remaining card heading "Quick lesson" -> "New lesson". Keep subhead
  "One topic. Type and go.", the topic input, Start button, and "Add reference files" link.
- Keep the single card layout and existing card styling (the `.modes` grid collapses to one
  column naturally via `auto-fit`).
- Resume nudge is unchanged.
- Update `frontend/src/__tests__/homeView.test.js` and `smoke.test.js` for the removed card
  and renamed heading.

## Area 4 - Knowledge diagnostic (tutor-first-turn)

### Trigger (server-derived, no new column)
Diagnostic runs when **all** hold:
- `seed_mode == "fresh"` (resume sessions already carry a profile - skip)
- `topic_profile.knowledge_level is None`
- no diagnostic batch has already been graded this session

Like `retrieval_required`, `diagnostic_required` is a boolean derived per-turn in the
prompt-build path (`backend/agent/prompts.py`, mirroring the `retrieval_required` label at
line ~112) and injected into the system prompt. Since it derives from
`knowledge_level is None`, it naturally flips false once the level is set.

### Flow
1. Fresh session created (no `knowledge_level`).
2. Server injects `diagnostic_required: REQUIRED` into the first-turn prompt.
3. Tutor emits a **3-question multiple-choice batch** using the existing MC check-question
   machinery, at ramping difficulty, scoped to the session topic.
4. User answers via the existing MC UI. Each answer is graded server-side (existing
   deterministic grade path).
5. When the diagnostic batch is fully graded, the server computes level from the score and
   **writes `knowledge_level` itself** (does not rely on the tutor's `update_topic_profile`):
   - 0-1 correct -> `beginner`
   - 2 correct -> `intermediate`
   - 3 correct -> `advanced`
6. `diagnostic_required` clears (level is now set). Tutor continues teaching calibrated to
   `knowledge_level`.

### Distinguishing the diagnostic batch from a normal check
A normal check batch tests a confirmed gap and can trigger demotion/plan logic. The
diagnostic batch must be tagged so the grade handler routes it to level-assignment instead.
Add a `purpose` marker (e.g. `"diagnostic"` vs `"check"`) to the check-question record and its
public view so the grade handler in `sessions.py` knows to run score->level on the final
answer of a diagnostic batch. Exact field name/placement finalized in the plan against the
current `check_question_service` shape.

### Fallback / edge cases
- Tutor fails to emit the batch on turn 1: `knowledge_level` stays `null` (today's behavior);
  tutor still teaches. Graceful degrade, no error.
- User abandons mid-diagnostic: level stays `null`; on next fresh turn the trigger still holds
  and the tutor may re-offer. Acceptable for v1.
- Reference-file (ingested) fresh sessions: diagnostic still runs; the topic is known from the
  user's typed topic.
- The prompt must instruct: emit the diagnostic batch **before** any teaching content on a
  `diagnostic_required` turn.

### Reliability
The decision to run the diagnostic is server-controlled; the level value is deterministic from
graded results. The only LLM-dependent step is emitting a batch on turn 1 - covered by the
existing MC-batch prompting that already meets the check-question reliability bar, with the
null fallback above as the safety net.

## Area 5 - Subject features NOT ported (user may veto)

- **Mastery map** - already covered by the user-wide aggregate profile
  (`AggregateProfileView` / `AggregateProfileResponse`).
- **Plan revision / deterministic lesson suggestion** - intrinsically multi-lesson; meaningless
  for a standalone lesson.
- **Duration planning (deadline/pace)** - a subject-level concept; no single-lesson analog.

Conclusion: nothing from subjects needs porting. The diagnostic (Area 4) is the one valuable
addition and is new.

## Testing

- **Backend:** migration up/down; `sessions.py` check-answer no longer returns
  `add_lesson_suggestion`; diagnostic trigger derivation (fresh+null -> required; resume ->
  not; level-set -> not); score->level mapping at each threshold; server writes level on final
  diagnostic answer; null fallback when no batch emitted. Full `pytest` green after deletions
  (watch for imports of deleted modules).
- **Frontend:** `homeView.test.js` (card removed, heading renamed, Start still creates a
  session); router has no subject routes; sidebar renders without subject grouping; no
  dangling imports of `stores/subject.js` or `LessonContextBar`. `vitest` + `eslint` green.
- **E2E:** update/remove any Playwright spec that drove the subject wizard; add/adjust a spec
  for New lesson -> diagnostic batch -> teaching (may stay Phase-8-skipped per existing e2e
  gating).
- **Contracts:** `gen_contracts.py` produces zero drift; CI contract check green.

## Out of scope

- Redesigning the aggregate profile / mastery visualization.
- Changing the onboarding questionnaire (`OnboardingView` still captures name + feedback
  style only; knowledge level is per-session, set by the diagnostic).
- Any change to resume/summary behavior beyond skipping the diagnostic on resume.
