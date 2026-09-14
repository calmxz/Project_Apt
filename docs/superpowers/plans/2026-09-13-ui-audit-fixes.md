# UI Audit 2026-09-13 and Fix Plan

Technical audit of `frontend/src` (impeccable `audit`, code-level, not a design critique),
followed by a rendered check in Chrome (see "Browser verification" at the end).
Baseline: `dev` at `c4953a6` (PR #295 merged). Detector run: `impeccable detect --json src`.
This file is the plan for the fix pass. Each finding carries its fix so tasks can be
dispatched straight from it. Verification gate for the whole pass is at the bottom.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Composer textarea and the two profile add-inputs have no accessible name |
| 2 | Performance | 2 | PrimeIcons font (~600 KB across svg/eot/woff/ttf) ships for one `.pi-spin` rule |
| 3 | Responsive | 2 | 390px: open check card leaves a 191px transcript; expanded cue hides transcript and composer |
| 4 | Theming | 4 | Tokens everywhere; only intentional hard-codes (swatches, confirm-delete, PrimeVue preset) |
| 5 | Implementation integrity | 3 | World is coherent; residue = PrimeIcons dependency, global 0.01ms motion kill |
| **Total** | | **14/20** | **Good: address weak dimensions** |

## Implementation Integrity Verdict

**Pass.** The Cornell Page world is expressed consistently: 183 of 208 `line-height`
declarations resolve to `var(--line-pitch)`, every separator is `inset 0 -1px 0`, radius
above 4px appears once (typing-dot circles), no `text-transform: uppercase` anywhere, no
`transition: all`, no `will-change`, every route lazy-loads, highlight.js is imported from
`lib/core` with explicit languages. Detector returned 2 findings, both false positives
(`--motion-bounce` is named "bounce" but resolves to `cubic-bezier(0.16, 1, 0.3, 1)`,
an exponential ease-out, per `base.css:86-88`).

Residue that contradicts DESIGN.md's own claims:

- DESIGN.md says "the PrimeIcons font is loaded by no Vue file". True for glyphs, but
  `main.js:3` still imports `primeicons/primeicons.css` globally and three SVGs borrow
  `.pi-spin` for rotation. The dependency and its four font files ship in `dist/`.
- The `prefers-reduced-motion` alternative is a global `0.01ms !important` kill
  (`base.css:371-380`) layered under per-component `animation: none` rules. The
  per-component rules are the intentional alternative; the global kill is a blanket.

## Executive Summary

- Score **14/20** (Good). Code-level score was 15; the browser check dropped
  Responsive from 3 to 2.
- Issues: P0 0, P1 4, P2 5, P3 4.
- Top issues: (1) mobile session with an open check: transcript 191px, and 0px plus
  composer off-screen once the cue strip expands (R2), (2) unlabeled composer textarea
  and profile add-inputs, (3) PrimeIcons dead weight in the bundle (confirmed loaded
  at runtime), (4) sub-44px hit targets on every icon control (measured 28x28 and
  32x28), (5) shell sidebar collapse animates `grid-template-columns`.
- Next: run the fix pass below in task order, then `/impeccable polish`.

## Findings

### P1

**A1. Composer textarea has no accessible name**
- Location: `frontend/src/components/chat/Composer.vue:58-70`
- Category: Accessibility. WCAG 1.3.1 / 4.1.2.
- Impact: screen readers announce "edit text, multi-line" with only the placeholder,
  which is not a name and disappears once the learner types.
- Fix: add `aria-label="Message the tutor"` to the `<textarea>`. Keep
  `aria-describedby`, `data-testid="session-input"`, placeholder unchanged.
- Test: `composer.test.js` assert `getByLabelText('Message the tutor')` resolves.

**A2. Profile add-concept and add-gap inputs have no label**
- Location: `frontend/src/views/ProfileView.vue:176-182` and `:236-242`
- Category: Accessibility. WCAG 1.3.1 / 3.3.2.
- Impact: placeholder is the only cue; unnamed inputs for a screen-reader user.
- Fix: `aria-label="Add a mastered concept"` and `aria-label="Add a gap"` on the two
  inputs. Placeholders and testids stay.
- Test: `profileView.test.js` assert both inputs resolve by label text.

**P1. PrimeIcons ships for a single spin rule**
- Location: `frontend/src/main.js:3`, `frontend/package.json:31`,
  `Composer.vue:42,83,410`, `ReferenceStatusBanner.vue:12`
- Category: Performance / Implementation integrity.
- Impact: `dist/assets` carries `primeicons-*.svg` 342 KB, `.eot` 85 KB, `.woff` 85 KB,
  `.ttf` 85 KB plus the CSS. No glyph is used (`grep 'pi pi-'` in src = 0). Only the
  `.pi-spin` keyframe is consumed, on three inline SVG spinners. Contradicts DESIGN.md.
- Fix:
  1. Add a `@keyframes spin` and `.spin { animation: spin 1s linear infinite; }` to
     `assets/base.css` (or a scoped rule in each of the two components).
  2. Replace `pi-spin` with `spin` in `Composer.vue` (2 places) and
     `ReferenceStatusBanner.vue` (1 place); update the comment at `Composer.vue:410`.
  3. Remove `import 'primeicons/primeicons.css'` from `main.js`.
  4. `npm uninstall primeicons`; confirm PrimeVue does not require it at runtime
     (PrimeVue 4 with unstyled icon slots does not; ConfirmDialog/Toast icons are
     already overridden in `dialogs.css`, verify visually).
  5. Also drop `primeicons` from `.github/dependabot.yml` groups if listed.
- Test: existing reduced-motion tests still pass (`.composer-spinner` and
  `.ref-spinner` keep `animation: none` under the media query). `npm run build` then
  `ls dist/assets | grep primeicons` returns nothing.

### P2

**R1. Icon controls below 44px on the 390px viewport**
- Location: `Composer.vue:317-323` (send/stop 32x28), `CueColumn.vue:438-449`
  (disclosure 32x32), `Sidebar.vue:803-815` (toggle 28x28), `SidebarRowMenu.vue:240-250`
  (menu trigger 28x28), `SidebarSessionRow.vue` rename/pin, `ProfileView.vue` remove
  buttons (`text-btn`), `SidebarMobileTopStrip.vue`.
- Category: Responsive. WCAG 2.5.8 (24px AA) passes; 2.5.5 (44px AAA) fails.
- Impact: thumb misses on the phone, especially send/stop next to the textarea.
- Fix: keep the drawn box at 28/32px (rhythm) but grow the hit area with a
  pseudo-element under `@media (pointer: coarse)`:
  ```css
  @media (pointer: coarse) {
    .composer-send, .composer-stop, .composer-attach, .cue-disclosure,
    .sb-toggle, .sb-row-menu-trigger { position: relative; }
    .composer-send::after, /* ... same list */ {
      content: ''; position: absolute; inset: -8px;
    }
  }
  ```
  Put the shared rule in `base.css` under a `.hit-44` utility class and add the class
  to each control so it is one rule, not six copies.
- Test: Playwright at 390 with `hasTouch: true`: bounding box of `session-send` hit
  region >= 44 in both axes (measure via `::after` is not possible; instead assert the
  class is present and the base.css rule exists in a vitest CSS snapshot).

**P2. Shell sidebar collapse animates `grid-template-columns`**
- Location: `frontend/src/App.vue:94-108`
- Category: Performance.
- Impact: every frame of the 240ms collapse relayouts the whole shell, including the
  ruled notes column and the session list. Visible hitch on long sessions. Issue #290
  moved it here from `width` on the sidebar, which fixed the sidebar jank but kept a
  layout animation.
- Fix (choose one, first is recommended):
  1. Snap the column (no transition on `grid-template-columns`) and fade the sidebar
     contents instead: `.sb-body { transition: opacity var(--motion-fast) }`, with
     `.shell--sb-collapsed .sb-body { opacity: 0 }` on the expanded content and the
     rail content fading in. Matches DESIGN.md motion grammar ("opacity, clip-path, or
     a stroke draw"; "nothing slides").
  2. Keep the transition but add `contain: layout` on `.shell-main` so only the
     sidebar column relayouts. Cheaper change, still a layout animation.
- Test: `app.test.js` or `sidebar.test.js` asserts `.shell` has no `transition` on
  `grid-template-columns` (option 1), reduced-motion block updated to match.

**M1. Global reduced-motion kill is a blanket, not an alternative**
- Location: `frontend/src/assets/base.css:371-380`
- Category: Accessibility (motion). WCAG 2.3.3.
- Impact: `animation-iteration-count: 1 !important` freezes the three spinners and the
  typing dots on their first frame, so "working" states show a static arc with no
  motion and no replacement text. Per-component rules already set `animation: none`
  with final-state fallbacks (`stroke-dashoffset: 0`), so the global rule adds only
  the spinner freeze.
- Fix: delete the global block. Audit each `@keyframes` owner (14 files, listed
  below) has its own reduced-motion rule; add the missing ones:
  - `MessageList.vue` typing dots: under reduced motion show the dots at steady
    opacity (0.6) instead of pulsing.
  - `Sidebar.vue`, `SidebarSkeletonList.vue`, `MessageListSkeleton.vue` shimmer: steady
    fill.
  - Spinners (`Composer`, `ReferenceStatusBanner`, `UploadStatus`): keep
    `animation: none`, but the arc is meaningless static; replace with the text
    already present (`Uploading...`, `Sending message`) shown via `.sr-only` today.
    Make it visible under reduced motion: `.composer-spinner { display: none }` and
    show the "Sending" caption.
- Test: `tokenContrast.test.js`-style CSS grep test asserting no
  `animation-duration: 0.01ms` remains in `base.css`.

**T1. Dark-theme tokens defined twice (identical today, drift risk)**
- Location: `frontend/src/assets/base.css:127` (`:root[data-theme='dark']`) and
  `:175` (`@media (prefers-color-scheme: dark) :root:not([data-theme='light'])`)
- Category: Theming.
- Impact: none today. Verified both blocks define the same 38 tokens. But
  `useTheme.js:32` always pins `data-theme`, so the media block only matters for the
  first paint before hydration, and any future token added to one block and not the
  other silently diverges for users whose OS theme differs from their Settings choice.
- Fix: keep the attribute block authoritative. Reduce the media block to the pre-paint
  need: either delete it (accept a light first frame on dark OS, ~1 frame) or keep it
  but generate it from the same source by moving the dark set into a
  `@mixin`-style shared block via CSS nesting (`:root:is([data-theme='dark'],
  :not([data-theme='light']):where(@media ...))` is not valid; so the practical fix is
  a vitest guard, not a CSS restructure).
- Test: extend `tokenContrast.test.js` with a set-equality assertion: the `--` names
  in the attribute dark block equal the names in the media dark block, and both equal
  the light block's names. Fails the moment a token is added to only one.

**S1. Sidebar section heading skips a level**
- Location: `frontend/src/components/sidebar/Sidebar.vue:535` (`<h3>` with no h2
  ancestor); `components/EmptyState.vue:26` (`<h3>` used inside views whose only
  heading is an h1).
- Category: Accessibility. WCAG 1.3.1 (best practice, not a hard failure).
- Impact: heading outline jumps h1 to h3 on Home, Library, Review.
- Fix: Sidebar section label to `<h2 class="sb-section-label label">` (styling is by
  class, unchanged). `EmptyState.vue` headline to `<h2>`. Check `sidebarA11y.test.js`
  and any `getByRole('heading', { level: 3 })` assertions and update the level.
- Test: existing heading-role tests updated; add a vitest assertion on Sidebar that no
  h3 renders without an h2 ancestor.

**R2. (promoted to P1 after browser check) Mobile: open check card starves the
transcript; expanded cue strip hides transcript and composer entirely**
- Location: `frontend/src/views/SessionView.vue:1311-1330` (`.sheet-cue`
  `max-height: 50vh` at 899px), `MessageList.vue` / `SessionView.vue` (check card is
  rendered outside the `.messages` scroller, pinned below it), `CueColumn.vue:460-475`
- Category: Responsive. P1 because it blocks the task (answer the check, send a reply).
- Measured at 390x844 (same-origin iframe, OSI model session with an open check):

  | State | `.messages` scroller height | Check card | Composer top |
  |---|---|---|---|
  | Cue collapsed | 191px (content 2212px) | 420px, pinned outside scroller | 783 (visible) |
  | Cue expanded | **0px** | 420px | **846 (below 840px viewport)** |

  With the cue expanded the learner sees profile + check card and nothing else; the
  send button is off-screen and the conversation is unreachable until they collapse
  the strip again. Collapsed, the transcript is a 191px slit above a 420px card.
- Fix:
  1. At <=899px, make the check card scroll with the transcript: render it inside
     `.messages` (last child) instead of as a sibling, or set the notes column to
     `grid-template-rows: minmax(0,1fr) auto` with `min-height: 0` on the messages row
     so the card cannot claim more than half the column (`max-height: 50%` on the
     card with its own `overflow-y: auto`).
  2. `.sheet-cue` at <=899px: drop `max-height: 50vh; overflow-y: auto`; make
     `.cue-strip` `position: sticky; top: 0` and cap `.cue-body` at `40vh` with
     `overflow-y: auto` so the expanded profile never pushes the composer out.
  3. Composer stays `position: sticky; bottom: 0` inside the notes column (verify it
     is not already; measured top 846 says it is in flow today).
- Test: Playwright at 390x844: open a session fixture with an active check, expand the
  cue strip, assert `session-send` bounding box bottom <= viewport height and
  `.messages` clientHeight >= 160.

### P3

**T2. Hard-coded confirm-delete button colours**
- Location: `frontend/src/assets/base.css:387-397` (`#b8352c`, `#94271f`, `#ffffff`)
- Fix: use `var(--ink-marker-text)`, `var(--color-text-on-accent)`, and add
  `--ink-marker-text-hover` to both theme blocks (dark value must clear 4.5:1 under
  white text; `#ff6a5e` does not, so dark hover needs a darker red like `#c9463b`).
  Add the new token to `tokenContrast.test.js`.

**T3. Theme swatch colours hard-coded in AppearanceTab**
- Location: `frontend/src/components/settings/AppearanceTab.vue:139-191`
- Note: intentional (the swatch must show the *other* theme; comment at :128
  explains). Keep, but move the 8 values to `--sw-*` tokens declared once in
  `base.css` next to the theme blocks so a palette change updates the swatches.
  Low priority; skip if the palette is frozen.

**P3. Route fade re-runs on every navigation including back**
- Location: `frontend/src/App.vue:75-88, 142-150`
- Note: enter-only 160ms opacity is cheap. Only flag: `transition name="fade"` wraps
  the sheet route too, so the ruled background repaints on entry. Acceptable. No fix
  unless the polish pass sees a flash on `/session/:id` entry.

**M2. Typing dots use a 1200ms infinite pulse**
- Location: `frontend/src/components/chat/MessageList.vue:133-142`
- Note: the only infinite animation besides spinners. Under reduced motion it is
  covered by M1. Consider replacing the three dots with the drawn ink caret blinking
  at the composer instead (one motion vocabulary). Design call, not a defect.

## Patterns and Systemic Notes

- **Hit targets** are consistently the 28px pitch or 32px. One utility class fixes all.
- **Reduced motion** is handled twice (global + local). Pick local.
- **Dark theme** is defined in two selectors with identical token sets today. Guard
  with a test so they cannot drift.
- **PrimeVue residue**: only `primeicons` is dead. PrimeVue itself (InputText, Toast,
  ConfirmDialog, Dialog) is live and reskinned in `dialogs.css` and `aura-tokens.css`.

## Positive Findings

- Token discipline: 152 custom properties, every Vue colour resolves through `var()`;
  the only literal hex outside `base.css` are swatches and the PrimeVue preset, and
  `tokenContrast.test.js` asserts AA on 9 text tokens in both themes.
- Motion grammar holds: no `transition: all`, no `will-change`, no layout-property
  transitions except the shell column (P2 above); marks animate via
  `stroke-dashoffset`; new ink via `clip-path`.
- Every route is a dynamic import; `highlight.js` uses `lib/core` with explicit
  languages; fonts are self-hosted with `font-display: swap`.
- Landmarks and live regions: skip link to `<main tabindex="-1">`, `<nav
  aria-label="Sessions">`, `<aside>` for cue column, `role="status"`/`"alert"` on every
  transient state (cap banners, check grading, upload, reference ingestion), `aria-expanded`
  and `aria-controls` on disclosures, `aria-pressed` on toggles.
- 35 files define `:focus-visible` rings; every `outline: none/0` found sits on an
  element that replaces it with a border-bottom or ring on the same selector.
- Radios are wrapped in `<label>` with a `<legend>`; search inputs carry `aria-label`.

## Recommended Actions (priority order)

1. **[P1] `/impeccable adapt`**: R2 mobile check card + cue strip layout; R1 44px
   coarse-pointer hit areas.
2. **[P1] `/impeccable harden`**: A1, A2 accessible names; M1 reduced-motion
   alternatives; T1 dark-block drift guard.
3. **[P1] `/impeccable optimize`**: P1 drop PrimeIcons; P2 shell collapse to opacity.
4. **[P2] `/impeccable harden`**: S1 heading levels.
5. **[P3] `/impeccable polish`**: T2, T3 tokens; final visual pass both themes, 1440 and 390.

## Execution Plan

Branch: `fix/ui-audit-2026-09-13` from `dev`. Dispatch by task; non-overlapping files.
Every task: failing test first, then the change, then `npm run test:unit -- --run` and
`npm run lint` green before the next task.

| Task | Findings | Files | Executor |
|------|----------|-------|----------|
| 1 | A1, A2 | `Composer.vue`, `ProfileView.vue`, their tests | sonnet |
| 2 | P1 | `main.js`, `package.json`, `package-lock.json`, `base.css` (spin keyframe), `Composer.vue`, `ReferenceStatusBanner.vue` | sonnet |
| 3 | M1 | `base.css` (delete global block), `MessageList.vue`, `Sidebar.vue`, `SidebarSkeletonList.vue`, `MessageListSkeleton.vue`, `UploadStatus.vue`, new CSS-grep test | opus |
| 4 | T1, T2 | `base.css` theme blocks, `tokenContrast.test.js` | sonnet |
| 5 | P2 | `App.vue`, `Sidebar.vue` body fade, `app`/`sidebar` tests | opus |
| 6 | R1 | `base.css` (`.hit-44` utility), six control components | sonnet |
| 7 | R2 | `SessionView.vue`, `MessageList.vue`, `CueColumn.vue`, new Playwright 390 spec | opus |
| 8 | S1 | `Sidebar.vue`, `EmptyState.vue`, `sidebarA11y.test.js` | sonnet |
| 9 | T3 (optional) | `AppearanceTab.vue`, `base.css` | haiku |

Task 2 must run before Task 3 (Task 3 deletes the spinner's reliance on `.pi-spin`
reduced-motion behaviour). Tasks 4 and 5 both touch `Sidebar.vue`? No: Task 4 is
`base.css` only; Task 3 and Task 5 both touch `Sidebar.vue`, run sequentially.

## Browser Verification (2026-09-13, Chrome, dev server on :5173)

Desktop viewport was 1879x982 (window maximized; resize ignored). Mobile was
emulated with a same-origin 390x844 iframe so media queries and layout ran at true
390 width. Theme toggled by setting `data-theme` on `<html>`.

Confirmed from rendered pages:
- Session page 1440-class, light and dark: Cornell layout intact, red margin rule,
  cue column, learner turn right-aligned, check card as ruled box. Dark theme rules,
  pencil and inks all switch. No console errors checked.
- PrimeIcons stylesheet present at runtime (`primeiconsLoaded: true`).
- Measured hit boxes: send 32x28, attach 32x28, sidebar toggle 28x28, row menu 28x28,
  cue disclosure 32x32, Home Start button 56x28, Home topic input 328x28.
- Home at 390: no horizontal overflow (document 376 < 386 viewport).
- Session at 390 with an open check: see R2 table. This is the one finding the code
  read under-called.
- Review page renders as the recitation page (covers at fixed height).
- Sidebar rendered 50 session rows in a scroller plus "View all" (the dynamic cap
  from the 2026-09-13 feedback pass allows this at 982px tall; not an audit defect,
  noted for the polish pass).

Not verified: reduced-motion emulation, keyboard-only traversal, real touch input,
Profile/Settings/Library at 390, dark theme at 390.

## Verification Gate

- `npm run test:unit -- --run` all green (baseline 923).
- `npm run lint` clean.
- `npm run build`; `ls dist/assets | grep -c primeicons` = 0; report bundle delta.
- `impeccable detect --json src` shows only the two `--motion-bounce` false positives
  or zero.
- Browser pass (one batched round, both themes): 1440 session page with sidebar
  collapse; 390 session page with cue strip expanded and composer send tap; Settings
  dark override on a light OS shows dark rules and pencil; reduced-motion emulation
  shows "Sending" caption instead of a frozen arc.
- Re-run `/impeccable audit`; target 18/20.
