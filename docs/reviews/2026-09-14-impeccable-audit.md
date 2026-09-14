# UI Audit 2026-09-14 (re-run after PR #296)

Technical audit of `frontend/src` (impeccable `audit`: a11y, performance, theming,
responsive, implementation integrity). Not a design critique.

Baseline: branch `fix/ui-audit-2026-09-13` at `7af3f51` (PR #296 open to `dev`).
Prior audit: `docs/superpowers/plans/2026-09-13-ui-audit-fixes.md`, 14/20.

Method:
- `impeccable detect --json frontend/src`.
- Code scan: colour literals outside token blocks, `will-change`, `transition: all`,
  layout-property transitions and keyframes, `!important`, `outline: none`, sub-12px
  type, fixed widths, lazy imports, `dist/` contents after `npm run build`.
- Rendered check via a throwaway Playwright harness (offline stubs, same approach as
  `e2e/auth.spec.js`): 1440x900 fine pointer and 390x844 coarse pointer, light and dark,
  routes `/login`, `/`, `/session/:id` (8 turns, code fence, KaTeX, citation, open
  check batch), `/session/:id/profile`, `/profile`, `/review`, `/sessions`,
  `/settings`, `/tos`. Per page-state: WCAG contrast of every text node against its
  composited background, accessible names, label association, heading order,
  landmarks, horizontal overflow, target sizes with the `.hit-44` `::after` extension
  credited under `(pointer: coarse)`, focus indicator on the first 17 Tab stops,
  running animations with `prefers-reduced-motion` forced both ways, computed
  `transition-property` on every element, console errors.
- Gates: `npm run test:unit -- --run` 952/952, `e2e/mobile-390-check-card.spec.js` pass.
- Coverage limits: Review and Insights rendered their empty or error states under the
  stubs, so content-heavy states there were not exercised; the mobile sidebar drawer
  was not opened; dialogs and toasts were not triggered.

## Audit Health Score

| # | Dimension | Prior | Now | Key finding |
|---|-----------|-------|-----|-------------|
| 1 | Accessibility | 3 | 4 | AA met on every measure taken; only AAA target-size misses remain (mobile brand link 71x22, "All" filter 18x28, both clear the 2.5.8 spacing exception) |
| 2 | Performance | 2 | 3 | Session route parses a 154 KB gzip markdown chunk (KaTeX + highlight.js) before the first reply renders |
| 3 | Responsive | 2 | 3 | 28px rows on coarse pointer for answer options and text controls (AA pass, AAA miss) |
| 4 | Theming | 4 | 4 | -- |
| 5 | Implementation integrity | 3 | 4 | Detector: 2 findings, both false positives; PrimeIcons and the global motion kill are gone |
| **Total** | **14/20** | **18/20** | **Excellent: minor polish** |

## Implementation Integrity Verdict

**Pass.** The Cornell Page world is expressed without residue. Verified:
- Zero colour literals in any `.vue` file; in the CSS files every literal sits inside a
  `:root` or `[data-theme]` token block. Every `box-shadow` is either an inset painted
  rule or `var(--shadow-lift)` on a teleported overlay (dialog, drawer, row menu).
- No `will-change`, no `transition: all`, no keyframe or transition on a layout
  property in app code (the only `transition: top` is the skip link). The shell
  sidebar collapse no longer transitions `grid-template-columns`.
- `dist/` carries no PrimeIcons font; the only fonts are the three self-hosted
  subsets (164 KB) plus KaTeX faces referenced lazily from its CSS.
- All 14 routes lazy-load; `highlight.js` is `lib/core` plus six languages.
- Detector returned 2 `bounce-easing` warnings (`OnboardingView.vue:322`,
  `ReviewView.vue:294`). Both resolve `--motion-bounce` to
  `cubic-bezier(0.16, 1, 0.3, 1)` (`base.css:89`), an exponential ease-out. Name-only
  false positive; see P3.
- Under forced `prefers-reduced-motion: reduce` the session page has 0 app
  animations running (the 3 reported belong to the Vue devtools overlay), the cue
  column is fully visible, and the check card and composer render in their final
  state. The M1 alternatives hold.

## Executive Summary

- Score **18/20** (Excellent), up from 14. Target met.
- Issues: P0 0, P1 0, P2 2, P3 7.
- Every one of the prior audit's P1s is closed and browser-verified: composer and
  profile add-inputs are named, PrimeIcons is out of the bundle, icon controls clear
  44px on coarse pointer via `.hit-44`, the shell no longer animates its grid, and the
  390px open-check layout keeps the composer on screen (R2 spec green).
- Across 28 page-states: 0 contrast failures, 0 unnamed buttons or links, 0 inputs
  without a label, 0 horizontal overflow, 1 h1 per page with correct h2 nesting.
  Focus indicators: 73 `:focus-visible` rules and no `outline: none` anywhere in
  `src`; the Tab probe found no stop without an outline or ring, though the probe
  also credited a differing bottom border, so treat that as corroboration rather
  than a measurement.
- Next: `/impeccable adapt` for the 28px answer rows and the two AAA target misses,
  `/impeccable optimize` for the markdown chunk, then `/impeccable polish`.

## Findings

### P2

**R1. Answer options are 28px rows with no gap on a phone**
- Location: `frontend/src/components/chat/CheckQuestion.vue:219` (`.check-option`).
  Measured 324x28, four stacked, separators only, at 390px coarse pointer.
- Category: Responsive. WCAG 2.5.8 passes (24px); 2.5.5 (AAA, 44px) does not.
- Impact: answering a check is the one action the server grades; a mis-tap on a
  28px row between two other 28px rows records the wrong answer with no undo.
- Fix: under `(pointer: coarse)` set `.check-option` to two pitches (56px) with the
  letter and text vertically centred; the painted separator keeps the ruled look.
  Do not use `.hit-44` here since the extensions would overlap.
- Suggested command: `/impeccable adapt`

**P1. Session route loads KaTeX and highlight.js up front**
- Location: `frontend/src/lib/markdownRenderer.js:1-20`, imported statically by
  `MarkdownContent.vue:3`. Build output: `markdownRenderer-*.js` 454.58 kB
  (153.95 kB gzip), the largest chunk, shared by the session, ToS and privacy routes.
- Category: Performance.
- Impact: the primary route parses roughly 154 KB of gzip JS before the first tutor
  turn can render, on every cold load; KaTeX and six highlight languages are only
  needed when a reply contains math or a fence.
- Fix: keep markdown-it eager; dynamic-import the KaTeX plugin and CSS on first `$`
  and `highlight.js` on first fence, with a plain `<pre>` fallback until they land.
  The legal pages would then share only the small core.
- Suggested command: `/impeccable optimize`

### P3

**A1. Mobile brand link is 71x22**
- Location: `frontend/src/components/sidebar/SidebarMobileTopStrip.vue:35` (markup),
  `:84` (style). Measured 71x22 at 390px coarse pointer on every shell route.
- Category: Accessibility / Responsive. WCAG 2.5.8 (AA) passes via the spacing
  exception: the 24px circle overhangs the box by 1px above and below only, and no
  other target sits within 1px vertically (the strip is 48px tall, one row). 2.5.5
  (AAA) misses.
- Impact: the only way home from the top strip is a 22px-tall tap target.
- Fix: give the link `min-height: var(--line-pitch)` (28px, keeps the strip rhythm)
  or apply `.hit-44`; nothing is stacked above or below, so the extension is safe.
- Suggested command: `/impeccable adapt`

**A2. Library "All" filter is 18px wide**
- Location: `frontend/src/views/SessionsLibraryView.vue:429` (`.library-filter-btn`),
  row gap at `:427` (`.library-filter { gap: 1.25rem }`). Measured 18x28 at both
  viewports; "Active" and "Ended" are 41x28.
- Category: Accessibility. WCAG 2.5.8 (AA) passes via the spacing exception: the
  circle overhangs 3px left and right and the nearest target is 20px away. 2.5.5
  (AAA) misses.
- Impact: the default filter is the smallest control on the page.
- Fix: `min-width: 2.5rem` on `.library-filter-btn`, matching `.sb-status-btn`
  (41x26) in the sidebar.
- Suggested command: `/impeccable adapt`

**A3. Auth and legal pages have no `main` landmark**
- Location: `frontend/src/views/LoginView.vue:2` (`<section class="cover">`),
  `TosView.vue:2` (`<section class="legal-page">`), same shape on Register, Forgot,
  Reset, Privacy, NotFound. The shell in `App.vue:75` provides `main` for every
  other route.
- Category: Accessibility. WCAG 1.3.1 best practice; not a conformance failure.
- Impact: screen-reader landmark navigation finds nothing on the inside-cover pages.
- Fix: change the root `<section>` of each cover and legal view to `<main>`.
- Suggested command: `/impeccable harden`

**R2. 28px text controls on coarse pointer**
- Location: settings rail tabs (`rail-tab`, 41-77x28), library search, sort and back,
  code-fence `copy` (49x28, `MarkdownContent.vue:212`), login submit (70x28), skip
  question (119x28).
- Category: Responsive. AA pass, AAA miss.
- Impact: routine mis-taps, none destructive.
- Fix: a `(pointer: coarse)` rule taking written controls to two pitches, or
  `.hit-44` on the isolated ones (copy, back, submit).
- Suggested command: `/impeccable adapt`

**H1. Views throw in render on a malformed list payload**
- Location: `SessionsLibraryView.vue:268-346` reads `items.length`;
  `settings/ProfileTab.vue:44-110` reads `data.combined_*.length`.
- Category: Implementation integrity (robustness).
- Impact: a `{}` or partial response from `/sessions/library` or
  `/profile/aggregate` throws `TypeError: Cannot read properties of undefined` inside
  `_sfc_render` and blanks the view instead of showing the existing error line.
  Surfaced by the audit stubs; the real API always returns the arrays.
- Fix: default the arrays at the store or fetch boundary (`res.sessions ?? []`).
- Suggested command: `/impeccable harden`

**P2. No font preload; first paint swaps three faces**
- Location: `frontend/index.html` (no `<link rel="preload">`), `fonts.css` uses
  `font-display: swap`.
- Category: Performance.
- Impact: a visible reflow from system-ui to Atkinson and Familjen on cold load.
- Fix: preload the two regular woff2 files (body and display) via the Vite HTML
  plugin so the hashed URLs stay correct.
- Suggested command: `/impeccable optimize`

**I1. `--motion-bounce` is misnamed**
- Location: `frontend/src/assets/base.css:89`.
- Category: Implementation integrity.
- Impact: none for users; the detector will flag it on every run.
- Fix: rename to `--motion-out-expo` (three call sites: `dialogs.css:141`,
  `OnboardingView.vue:322`, `ReviewView.vue:294`).
- Suggested command: `/impeccable polish`

## Patterns

- Every remaining target-size finding is the same shape: written controls sit on one
  28px pitch, and the pitch is the design. A single `(pointer: coarse)` rule that
  takes written controls to two pitches would close A1, R1 and R2 without touching
  the desktop rhythm.
- Cover and legal views are the only routes outside the shell, and they are the
  only routes missing a landmark; one root-tag change per view.

## Positive Findings

- Contrast: 0 failures in either theme across 28 page-states, measured against the
  composited background, not the token. The dark ink retune holds.
- Names and labels: every button, link, input, textarea and select has an accessible
  name; both `nav` landmarks are labelled ("Sessions", "Settings sections").
- Focus: every Tab stop on every page shows an indicator.
- Motion: per-owner reduced-motion rules replace the global kill, and the session
  page has 0 app animations running under `reduce` while the cue column, check card
  and composer are all present in final state.
- Theming: token discipline is total. No literal in any Vue file; the two `!important`
  strings in CSS are comments.
- Bundle: PrimeIcons gone, all routes lazy, fonts self-hosted latin subsets.
- Responsive: no horizontal overflow at 390px on any route; the open-check layout
  keeps the composer on screen with the cue strip expanded (regression spec green).

## Recommended Actions

1. **[P2] `/impeccable adapt`**: coarse-pointer sizing for the answer options (R1)
   first, then the mobile brand link (A1), the "All" filter (A2) and the remaining
   28px written controls (R2), as one `(pointer: coarse)` two-pitch rule.
2. **[P2] `/impeccable optimize`**: split KaTeX and highlight.js out of the session
   route's first load (P1); add font preloads (P2).
3. **[P3] `/impeccable harden`**: `main` landmark on cover and legal views (A3);
   default the list arrays at the fetch boundary (H1).
4. **[P3] `/impeccable polish`**: rename `--motion-bounce` (I1) and final pass.
