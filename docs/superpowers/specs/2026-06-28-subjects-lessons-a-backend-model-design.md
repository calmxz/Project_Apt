# Subjects & Lessons — Spec A: Backend + Data Model

Date: 2026-06-28
Status: Approved (brainstorm), pending implementation
Branch: `feat/subjects-lessons`

## Supersession Notice

The primary design doc [`2026-05-03-crux-v1-design.md`](2026-05-03-crux-v1-design.md)
defines the unit of work as **one session = one topic**. This feature introduces a
hierarchy **above** the session:

```
Subject  →  Lessons  →  Session (chat)
```

This spec **supersedes** the v1 unit-of-work definition only in that a session may now
optionally belong to a lesson within a subject. A "quick lesson" remains a subject-less
session, identical to today's behavior — the old model is preserved as a special case
(`subject_id = NULL`).

## Scope

This is **Spec A** of three. It covers the data model, migrations, services, and API
routes. It does **not** cover frontend (Spec B) or companion features — plan-revision and
subject-level profile (Spec C). Implementation order is A → B → C.

A's deliverable: a backend that can create subjects (LLM-drafted or blank), list/read
them with progress, manage lessons, and lazily open a lesson into a chat session — all
behind the existing auth + cost-cap machinery.

## Data Model

Two new tables; one nullable column added to `sessions`.

### `subjects`

| Column | Type | Notes |
|---|---|---|
| `id` | str PK | uuid4 string, matches `sessions.id` convention |
| `user_id` | str FK → users.id | not null |
| `title` | str | the subject name, e.g. "Organic Chemistry" |
| `per_session_minutes` | int | 15 / 30 / 60 — depth of a single sitting |
| `timeline_days` | int NULL | study horizon; pace is **derived**, not stored |
| `created_at` | datetime(tz) | default now |
| `archived_at` | datetime(tz) NULL | soft-archive; mirrors `sessions.ended_at` semantics |

`pace_per_week` is **not stored** — it is computed for display as
`ceil(lesson_count / max(timeline_days / 7, 1))`. Timeline is the primary knob.
(If the user later prefers pace-primary, this flips to storing `pace_per_week` and
deriving timeline; noted as a one-line change, not a redesign.)

### `lessons`

| Column | Type | Notes |
|---|---|---|
| `id` | str PK | uuid4 string |
| `subject_id` | str FK → subjects.id | not null, indexed |
| `order_idx` | int | 0-based position within the subject |
| `title` | str | lesson title |
| `goal` | str | one-line "what you'll get from this lesson" |
| `status` | str | `not_started` \| `in_progress` \| `done` (CheckConstraint) |
| `session_id` | str FK → sessions.id NULL | back-filled on first open (lazy) |
| `created_at` | datetime(tz) | default now |

- A drafted/blank lesson has `session_id = NULL` — it is a plan item with no chat yet.
- `(subject_id, order_idx)` is the natural sort key for the overview. Reorder updates
  `order_idx` on affected rows.

### `sessions` (modified)

Add one nullable column:

| Column | Type | Notes |
|---|---|---|
| `subject_id` | str FK → subjects.id NULL | denormalized for fast sidebar grouping |

Rationale for the denormalized `sessions.subject_id` **and** `lessons.session_id`:
each serves a distinct read path. The sidebar groups sessions by subject (one-hop read
off `sessions`); the overview reads lessons with their session state inline (one-hop read
off `lessons`). The pair avoids a two-hop join on both hot paths. Both are set together in
the same transaction at `POST /lessons/{id}/open`, so they cannot drift.

Quick lessons: `sessions.subject_id = NULL`, no lesson row. Unchanged from today.

### Migrations

One Alembic migration: create `subjects`, create `lessons`, add `sessions.subject_id`
(nullable, no backfill needed — existing rows stay NULL = quick lessons). Indexes:
`lessons.subject_id`, `sessions.subject_id`.

## Services

### `plan_service.py` (new)

`draft_plan(db, user_id, title, per_session_minutes, timeline_days) -> list[LessonDraft]`

- Takes the DB session (`db`) because the cost meter (`check_cap` / `record_cost`)
  requires it.
- One LiteLLM call. Prompt asks for an ordered lesson list sized to the timeline and
  per-session depth: each lesson = `{title, goal}`. Bounded (e.g. 3–12 lessons).
- Routed through the existing **cost meter** (`services/cost_meter.py`) and daily cap —
  a draft is a metered LLM call like any tutor turn.
- Returns drafts only; the route persists them. Deterministic fallback so **creation
  never hard-fails**: on LLM failure **or daily-cap reached**, return a single lesson
  titled after the subject (no 429 from the draft path).
- New prompt lives in `agent/prompts.py` (or a sibling) to keep the immutable-rules /
  dynamic-context split intact.

### Subject/lesson persistence

CRUD lives in a new `services/subject_service.py` (mirrors `sessions.py` service
patterns): create subject + lessons in one transaction, list, read-with-progress,
add/patch/delete lesson, reorder, open-lesson (create session + link both pointers).

Progress for the overview: `done_count / total_count` computed via SQL count grouped by
status — cheap because `lessons` is a real table.

## API Routes

Contract-first: edit [`docs/api/openapi.yaml`](../../api/openapi.yaml) **then** run
`python backend/scripts/gen_contracts.py`. CI enforces zero drift (per project rule).

New router `routes/subjects.py`:

| Method + Path | Purpose |
|---|---|
| `POST /subjects/draft-plan` | **Preview only, no persist.** Body: `{title, per_session_minutes, timeline_days}`. Calls `plan_service.draft_plan` and returns `{lessons: [{title, goal}]}` for the wizard to review/edit before committing. Metered (counts against the cap like any LLM call). This is what powers Spec B's "review/edit plan" step. |
| `POST /subjects` | Create subject. Body: `{title, per_session_minutes, timeline_days, lessons[]}`. Persists the subject and the supplied (already-reviewed) lessons; `lessons` may be empty (blank path). The wizard always sends the reviewed list — drafted-then-edited or hand-entered. (`mode=draft` server-side persist is retained as a non-wizard convenience/fallback that calls `draft_plan` itself.) |
| `GET /subjects` | List the user's subjects (id, title, progress, archived). |
| `GET /subjects/{id}` | Overview: subject fields + ordered lessons (with status + session_id) + progress counts. |
| `PATCH /subjects/{id}` | Rename / set `timeline_days` / archive (`archived_at`). |
| `POST /subjects/{id}/lessons` | Add a lesson (blank/manual path, and Spec C plan-revision). Body: `{title, goal}`. Appends at end. |
| `PATCH /lessons/{id}` | Edit `title`/`goal`/`status`/`order_idx`. Status→`done` is the "mark done" write. |
| `DELETE /lessons/{id}` | Remove a lesson. If `session_id IS NULL` → delete. If it has a session → **409 by default** (don't silently orphan a chat); with `?force=true` the session is ended (`ended_at` set) and `session_id` cleared before the lesson is deleted. The `force` path is what makes Spec C's plan-revision delete-a-started-lesson achievable. |
| `POST /lessons/{id}/open` | Idempotent: if lesson has a session, return it; else create a session (`subject_id` set, `topic = lesson.title`), link `lessons.session_id`, set status `in_progress`, return `session_id`. |

All routes: auth required (existing dependency), scoped to `user_id`, return 404 on
cross-user access. Reuse existing error-code conventions (`lib/error_codes.py`).

### Duplicate-guard fix

The duplicate-topic guard is **frontend-only** — `findActiveSessionByTopic` in
`frontend/src/utils/formatDate.js`; the backend has no such guard. Spec A's deliverable
here is just to **expose `subject_id` on session response payloads** (`SessionListItem` /
`SessionResponse` / `SessionDetail`) so Spec B can re-scope the JS check to **within the
same subject** (or among subject-less quick sessions). The re-scope of
`findActiveSessionByTopic` itself is a **Spec B** task. This prevents a false "duplicate"
when two different subjects each have a lesson titled, e.g., "Introduction".

## Lesson Completion (server side)

Reuses the existing check-question + `topic_profile_json` machinery — **no new grading
system**. The "mark done?" suggestion logic (detecting that a lesson's target gaps are
cleared) is surfaced in the chat layer; Spec A only provides the persistence side:
`PATCH /lessons/{id}` with `status=done`, written on the user's confirmation. The
auto-suggest signal (when to prompt) is specified in Spec B, since it rides the existing
tutor/check-question flow.

## Testing

- Model + migration: table creation, FK constraints, CheckConstraint on `status`,
  `sessions.subject_id` nullable + existing rows unaffected.
- `subject_service`: create-with-lessons transaction, progress counts, reorder integrity,
  open-lesson idempotency + dual-pointer set, delete-with-session 409.
- `plan_service`: drafts parsed into bounded lesson list; LLM-failure fallback; cost-meter
  invoked (mock LiteLLM).
- Routes: auth scoping (404 cross-user), `mode=draft` vs `mode=blank`, dupe-guard now
  subject-scoped.
- Contract drift: `gen_contracts.py` produces zero diff after openapi edits.

## Out of Scope (Spec A)

- Any Vue/frontend work (Spec B).
- Plan revision UI, subject-level aggregate profile (Spec C).
- Pace reminders / streaks / notifications (deferred beyond all three specs).
