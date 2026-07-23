# UI Polish: Flat Styling, Home Simplification, Review Relocation, Sidebar Cleanup

Date: 2026-07-23
Status: Approved (brainstorm 2026-07-23)

## Goal

Remove the "generic AI-generated" visual tells (coral 3D pop shadows, glow, bouncy
motion), simplify Home and the sidebar, relocate the review queue out of Home, and
trim verbose copy. Pure frontend effort: no backend, contract, or migration changes.

## Scope summary

| # | Item | Action |
|---|------|--------|
| 1 | Coral 3D shadows + bounce motion | Flatten globally |
| 2 | Home page | Remove review card + ref-files link, recenter |
| 3 | Review queue | Sidebar entry + new `/review` view |
| 4 | Sidebar rows | Title-only rows, no date group labels |
| 5 | Chat composer | Neutral border, accent on focus only |
| 6 | Copy | Trim /new helper text, dedupe headline |
| 7 | Profile loading | Skeleton instead of "Loading..." text |

## 1. Flatten shadows and motion (global)

Tokens (`frontend/src/assets/base.css`, all three theme blocks):

- `--shadow-pop` and `--shadow-pop-pressed`: retire. Remove the definitions and all
  usages. No component may keep a coral shadow.
- `--shadow-lift`: drop the hard `0 4px 0 0 <ink>` edge; keep only the soft blur
  component (neutral elevation for dialogs).
- `--shadow-paper`: unchanged (subtle neutral).

`frontend/src/assets/aura-tokens.css`: `--chat-bubble-shadow` stays mapped to
`--shadow-paper`.

Component rules — applies to every element currently using `--shadow-pop`
(`cta-primary` in HomeView and NewSessionView, `.sb-new-session` in Sidebar,
`dialogs.css` confirm button, composer send, and any other hit from a repo-wide
grep for `shadow-pop`):

- `box-shadow: none` (delete the declaration).
- Remove `transform: translateY(...)` hover lift and active sink; remove
  `--motion-bounce` from their transitions.
- Replacement feedback: hover `filter: brightness(1.08)` (or a darker bg token),
  active `filter: brightness(0.95)`. Keep existing `:focus-visible` outline rings
  unchanged.
- Home `.mode-card` (whatever survives as the New-lesson block): no `shadow-pop`;
  border + at most `--shadow-paper`.

Buttons that already use `filter: brightness()` hover (warn-action, open-existing)
only lose their `translateY` and `--motion-bounce`.

## 2. Home page (`HomeView.vue`)

- Delete the "Due for review" card, its state (`reviewQueue`, `reviewExpanded`),
  `loadReviewQueue`, `startReview`, `expandReview`, and the `getReviewQueue` import.
  This logic moves to the new ReviewView (section 3).
- Delete the "Add reference files" RouterLink (`quick-more`). Users attach files via
  `/new` (reachable from the sidebar New session button), whose paperclip button is
  unchanged.
- Layout: single centered column, `max-width: 42rem`. Headline, topic input, Start
  button. Drop the two-column `.modes` grid and the card box entirely: input and
  button sit directly on the page background, matching /new's layout language.
- Headline stays "What do you want to learn?".

## 3. Review queue relocation

### Sidebar entry (`Sidebar.vue`)

- New compact row directly under the New session button, expanded mode only:
  icon + label "Review" + count badge (e.g. "13").
- Hidden entirely when count is 0 or the fetch fails.
- Count fetched once on mount via `getReviewQueue({ limit: 1, offset: 0 }, { silent: true })`
  (only `total` is needed). Silent: a sidebar badge must never toast.
- Click navigates to `/review` (and closes the drawer on mobile).
- Collapsed rail: no review icon (YAGNI; revisit if asked).

### New `/review` view (`ReviewView.vue`)

- Route name `review`, path `/review`, auth-guarded like other views.
- Reuses the exact logic removed from HomeView: list of due concepts (concept,
  source topic, streak), initial limit 3 with "View all N" expanding to 100,
  `startReview(item)` -> `store.continueTopic` -> navigate to session with
  `review_gap` query param. Silent initial load; user-initiated "View all" keeps
  toasts. Failure shows a quiet empty state, never blocks.
- Page header: small folio label + title "Review" + one-line sub ("Concepts due for
  a quick check.").
- Empty state (count 0): short message, link back home.
- `data-testid`s `home-review-item`, `home-review-more`, `home-review-count` migrate
  as `review-item`, `review-more`, `review-count`. Repo-wide grep for the old
  testids (vitest + Playwright) is mandatory per project conventions.

## 4. Sidebar simplification

`SidebarSessionRow.vue`:

- Row content = session title only (plus existing pin indicator and row menu).
  Remove gap chips, check-count badges, and the "N msgs · Xw ago" meta line.
- Keep ended-state dimming and active-row highlight.

`Sidebar.vue` / `useSessionGroups.js`:

- Remove date-bucket group labels ("Today", "Yesterday", "Older", ...) from both
  Active and Ended views: render one flat recency-sorted list per tab.
- Keep: Pinned mini-group (with its label), Active/Ended tabs, search, empty hints,
  skeleton, collapsed rail behavior.
- `useSessionGroups` may keep returning groups internally; the sidebar flattens
  them (`groups.flatMap(g => g.rows)`) — or the composable gains a flat output.
  Implementation's choice; observable behavior is a flat list in original recency
  order.

## 5. Chat composer

- Default border: neutral (`--color-border`), no accent outline at rest.
- `:focus-within`: accent border (and existing ring if present).
- Send button follows section 1 flat rules.

## 6. Copy trim

- `/new` hero title: "What do you want to learn?" -> "Start a session" (removes the
  duplicate headline with Home). Folio "begin" stays.
- `/new` lede: shorten to "One topic per session. The tutor adapts to you."
- `/new` help paragraph under the topic input: shorten to "Continuing an ended
  topic? Use \"Continue topic\" on its card in the Sessions library."
- Home: no lede paragraph.

## 7. Profile loading skeleton

- `AggregateProfileView.vue` (and `ProfileView.vue` if it has the same plain
  "Loading..." text): replace with simple skeleton blocks (reuse the sidebar
  skeleton pattern or minimal shimmer rectangles, neutral colors).

## Explicitly out of scope

- In-chat review nudge (tutor offering due checks inside a session) — future work.
- Collapsed-rail review icon.
- Any backend/API/contract change. `getReviewQueue` API is used as-is.
- Redesign of /new attach flow (paperclip button unchanged).

## Testing

- Vitest: update HomeView specs (review card + ref link gone, quick-start intact);
  new ReviewView spec covering list, expand, startReview navigation, silent-load
  failure; Sidebar spec for review entry (visible with count, hidden at 0/failure);
  SidebarSessionRow spec trimmed to title-only assertions; flat-list rendering
  assertions replace group-label assertions.
- Playwright: repo-wide grep for every removed/renamed `data-testid` before commit;
  update e2e specs that reference `home-review-*` or removed sidebar meta.
- Visual: manual pass over Home, /new, session chat, /review, Profile in light and
  dark themes (live-gate, post-merge).
