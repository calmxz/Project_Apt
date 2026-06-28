# Subjects & Lessons — Spec B: Frontend Flow

Date: 2026-06-28
Status: Approved (brainstorm), pending implementation
Branch: `feat/subjects-lessons`
Depends on: [Spec A](2026-06-28-subjects-lessons-a-backend-model-design.md) (built first)

## Scope

Spec B builds the Vue 3 frontend against Spec A's API: the two-mode homepage, the subject
creation wizard, the subject overview page, sidebar grouping, and lesson-aware session
view. It assumes all Spec A routes exist and are stable.

Does **not** cover plan-revision UI or subject-level profile (Spec C).

## 1. Homepage — Two Modes

Replace today's `HomeView.vue` dashboard with two clear mode cards (the chosen shape):

```
        What do you want to learn?

  ┌─ Quick lesson ────┐   ┌─ Build a subject ─┐
  │ One topic.         │   │ Multiple lessons,  │
  │ Type and go.       │   │ a guided plan.     │
  │ [topic input → go] │   │ [Start a plan →]   │
  └────────────────────┘   └────────────────────┘

  Continue →  (resume nudge: most-recent active lesson/session)
```

- **Quick lesson card** wraps today's `NewSessionView` flow (topic input, quick picks,
  optional file attach) — behavior unchanged, just relocated/embedded. Creates a
  subject-less session.
- **Build a subject card** routes into the wizard (section 2).
- **Resume nudge** (companion, in v1): a single "Continue where you left off" row showing
  the most-recent in-progress lesson or active quick session. This absorbs today's
  recent-activity feed — the full list lives in the sidebar and `/sessions`.
- **Duplicate-cleanup banner** from today's HomeView **moves** to the subject overview /
  sidebar context (not deleted). The homepage no longer carries it.

Routing: `/` → two-mode home. Keep `/new` working (or fold into the Quick card) for the
quick path. `/sessions` library view unchanged.

## 2. Subject Creation Wizard

A short multi-step flow (single view with steps, not separate routes):

1. **Title** — "What subject do you want to learn?"
2. **Duration** — `per_session_minutes` chips (15 / 30 / 60), then a **toggle** that pins
   either knob (`duration_mode`):
   - *By deadline* → `timeline_days` chips (1 week / 2 weeks / 1 month); derived pace shown
     live ("~3 lessons/week").
   - *By pace* → `pace_per_week` stepper (e.g. 1-5 / week); derived finish horizon shown
     live ("~3 weeks").
   Only the pinned field is sent. The derived value is display-only and recomputes from
   the lesson count (so it updates after the review/edit step changes the lesson list).
3. **Plan source** — two buttons: *Draft a plan for me* (LLM) | *I'll add my own* (blank).
4. **Review/edit plan**:
   - Draft path: show the LLM-proposed ordered lessons (title + goal). User can edit
     titles/goals, reorder (drag or up/down), delete, and add lessons.
   - Blank path: empty list, user adds lessons (title + goal) manually.
5. **Create** → `POST /subjects` → redirect to the subject overview.

Loading + error states for the draft LLM call (it is a metered call; show a spinner, and
on failure fall back to the blank editor with a notice — never dead-end).

## 3. Subject Overview — `/subjects/:id`

New `SubjectOverview.vue`:

```
Organic Chemistry            [████████░░ 3/6 done]
per session ~30 min · 2-week plan · ~3/week

  ✓ Bonding basics
  ✓ Alkanes & isomers
  ▶ Reaction types        ← next (highlighted)
  · Stereochemistry
  · Spectroscopy
  · Synthesis

  [ Open next lesson → ]
```

- Lesson rows show status: ✓ done / ▶ next-suggested / · not-started.
- **No gating — every lesson is freely openable.** "Next" is the first non-done lesson,
  highlighted as a suggestion only (the lock icon in early mockups was cosmetic).
- Clicking a lesson → `POST /lessons/{id}/open` → navigate to its session (`/session/:id`).
- "Open next lesson" opens the highlighted lesson.
- Progress bar from `done_count / total_count`.
- This view hosts the relocated duplicate-cleanup affordance if duplicates exist.

## 4. Sidebar Grouping

Extend `components/sidebar/Sidebar.vue`:

- Subjects render as **expandable nodes**; expanding lists that subject's lesson-sessions
  (those lessons with a `session_id`), each showing lesson status.
- Subject-less **quick sessions** render as a flat list (today's behavior) in their own
  group.
- Progress hint on the subject node (e.g. "3/6").
- Reuse existing `SidebarSessionRow` / `SidebarRowMenu` for rows; add a subject-node
  header component.

## 5. Lesson-Aware Session View

`SessionView.vue` gains light lesson awareness when the session belongs to a lesson:

- Header shows the lesson goal (alongside the topic) and a back-link to the subject
  overview.
- **Mark-done confirm:** when the tutor's check-question flow signals the lesson's target
  gaps are cleared, surface an inline "Looks like you've got this — mark *Reaction types*
  done?" prompt with **[Yes]** / **[Keep going]**. *Yes* → `PATCH /lessons/{id}
  status=done` → toast + the subject progress updates on next overview visit.
- The auto-suggest trigger reuses the existing mastery signal already computed for the
  topic profile / check questions — no new evaluation pass.

## State / Stores

- New `stores/subject.js` (Pinia): subjects list, current subject overview, lesson
  mutations. Mirrors `stores/session.js` patterns.
- New `services/subjectsApi.js` wrapping the Spec A routes (mirrors `sessionsApi.js`).

## Testing

- Vitest unit: two-mode home renders + routes; wizard step flow + derived-pace display +
  draft-failure fallback; overview lesson states + open navigation; sidebar grouping
  (subjects expandable, quick sessions flat); mark-done confirm writes status.
- Playwright e2e: create a subject (blank path, deterministic — no live LLM), open a
  lesson, send a message, return to overview. Draft path mocked.
- Reuse existing test ids conventions; grep repo-wide before removing any test id (per
  prior lesson: vitest ≠ Playwright e2e).

## Out of Scope (Spec B)

- Plan revision mid-subject, subject-level mastery map (Spec C).
- Live-LLM draft assertions (mock in CI; manual smoke owed).
