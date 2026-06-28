# Subjects & Lessons — Spec C: Companions

Date: 2026-06-28
Status: Approved (brainstorm), pending implementation
Branch: `feat/subjects-lessons`
Depends on: [Spec A](2026-06-28-subjects-lessons-a-backend-model-design.md) +
[Spec B](2026-06-28-subjects-lessons-b-frontend-flow-design.md) (both built first)

## Scope

Spec C adds the two companion features chosen for v1 on top of a working
Subjects/Lessons system: **plan revision mid-subject** and a **subject-level profile /
mastery map**. Subject progress + resume nudge already shipped in Spec B.

**Deferred beyond this spec:** pace reminders / streaks / notifications (needs scheduling
+ notification infrastructure — its own future phase).

Implementation order: C is built after A and B are merged and smoke-tested.

## 1. Plan Revision Mid-Subject

Let the plan change after the subject has started — both user-driven and tutor-suggested.

### Mechanism

Rides Spec A's existing lesson routes (`POST /subjects/{id}/lessons`, `PATCH /lessons/{id}`
for `order_idx`/`title`/`goal`, `DELETE /lessons/{id}`). No new persistence beyond what A
provides; this spec is mostly UX + the tutor suggestion path.

### User-driven (overview UI)

On `SubjectOverview.vue`, add an edit affordance:
- Add a lesson (title + goal) at any position.
- Reorder lessons (drag / up-down) — writes `order_idx`.
- Rename / edit goal inline.
- Delete a lesson (guarded: only if it has no session, per Spec A's 409 rule; offer to
  end+detach the session first if it does — confirm dialog).

### Tutor-suggested

When the tutor detects a struggle pattern (e.g. repeated incorrect check-questions on a
lesson's concept), it surfaces an inline suggestion in the session:
"You're finding *Alkanes* tricky — want me to add a short *Alkanes practice* lesson?"
**[Add]** / **[No thanks]**. *Add* → `POST /subjects/{id}/lessons` inserting after the
current lesson, then a toast linking to the overview.

- The struggle signal reuses existing `LearningEvent` history (incorrect count per
  gap) — no new tracking. A new tutor tool or server-side check emits the suggestion;
  define it to mirror the existing check-question suggestion plumbing.
- Keep it non-nagging: suggest at most once per lesson per session.

## 2. Subject-Level Profile / Mastery Map

Aggregate the per-lesson `topic_profile_json` across a subject into one view.

### Backend

New route `GET /subjects/{id}/profile`: walks the subject's lessons → their sessions →
`topic_profile_json`, and merges into a subject-level summary:
- `mastered_concepts`: union across lessons (deduped).
- `open_gaps`: union of unresolved gaps across lessons.
- Per-lesson roll-up: `{lesson_title, mastered[], gaps[]}` for a drill-down.

Reuses the existing aggregation approach behind `AggregateProfileView` /
`profileApi` / `getAggregateProfile` — extend, don't reinvent. Pure read; no new tables.

### Frontend

Extend `AggregateProfileView.vue` (or a new `SubjectProfileView.vue` reusing its pieces)
reachable from the subject overview ("View mastery map"):

```
Organic Chemistry — mastery map

  Mastered:  bonding · hybridization · alkane naming
  Still shaky:  stereochemistry · E/Z isomerism

  By lesson ▾
   Bonding basics      ✓ mastered: bonding, hybridization
   Stereochemistry     ⚠ gaps: chirality, R/S
```

## Testing

- Plan revision: insert-after-current ordering; reorder integrity; delete guard +
  end-then-detach path; tutor suggestion fires on repeated-incorrect signal and is capped
  once per lesson per session.
- Subject profile: aggregation merges/dedupes mastered + gaps across multiple lesson
  sessions; empty subject (no opened lessons) returns an empty-but-valid shape; route is
  user-scoped (404 cross-user).
- Frontend: mastery map renders mastered/gaps + per-lesson drill-down; "add practice
  lesson" suggestion confirm path.

## Out of Scope (Spec C)

- Pace reminders, streaks, email/push notifications (future phase — scheduling +
  notification infra).
- Cross-subject profile (this is per-subject; the existing global aggregate profile
  remains separate).
