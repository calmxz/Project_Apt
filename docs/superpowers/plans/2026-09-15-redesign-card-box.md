# Redesign: The Card Box (2026-09-15)

Status: PLANNED, not executed. Direction locked by user 2026-09-15 (roll `3b073036`, assigned card).
Direction contract: `.impeccable/surfaces/frontend-src-views-sessionview-vue.md`.
Visual comp: `.impeccable/mocks/decision/2026-09-15-redesign-directions.html` (section A + Marks; serve the folder locally, not `file://`).
Branch: `redesign/2026-09-15-card-box` off `dev`.

## What changes (user decisions)

- Cornell note page retired: no ruled ground, no gutter role tags, no margin rule, no page-mark C.
- Turns are index cards. Tutor = white stock, learner = blue stock, blue ink, right-aligned. Voices told apart by material, no avatars.
- Profile panel (CueColumn) stays beside chat, moves to the RIGHT of the thread, becomes tabbed dividers (Focus / Gaps / Mastered / Level), collapsible to a vertical tab strip.
- Sidebar stays, collapse control made visible (half-tab on its edge), Ctrl+B added. Profile panel gets Ctrl+.
- Mark = tabbed card (red tab). Favicon regenerated.
- Settings = divider tabs joined to a white sheet, desk-grey section cards, two columns from 60rem.
- Every other route restyled into the same world (list in Task 9).
- Both themes stay. Fonts stay (Atkinson Hyperlegible Next / Familjen Grotesk / JetBrains Mono).

## What must not change

Every `data-testid`, aria attribute, route, store contract, copy string. Tests that read CSS source text (below) are the hard edges.

| Test | Asserts | Consequence |
|---|---|---|
| `appView.test.js:89-124` | `.shell {` block has `grid-template-columns`, no `transition`; Sidebar.vue has `@keyframes sb-mode-fade` (opacity 0) + `animation: sb-mode-fade var(--motion-fast)`, no `will-change`; LAST `prefers-reduced-motion` block in Sidebar.vue mentions `sb-mode-fade|sidebar--expanded|sidebar--collapsed` and `animation: none` | keep collapse as opacity fade; keep that reduced-motion block last |
| `tokenContrast.test.js` | 6-digit hex; foreground list >= 4.5:1 on `--color-background` per theme; `:root[data-theme='dark']` and `:root:not([data-theme='light'])` declare identical sets; every dark token exists in `:root {` | add new tokens to all three blocks, never delete |
| `reducedMotion.test.js` | every file with `@keyframes` has `prefers-reduced-motion`; no `0.01ms` | |
| `turnPitch.test.js` | Cornell CSS text (`padding: var(--line-pitch) 0 0`, gutter `flex-direction: column`, `.landed-tick { position: absolute`) | REWRITE: this test pins the retired world (Task 3) |
| `hitTargets.test.js` | `.hit-44 {` in base.css, `hit-44` on upload/send/stop/cue-disclosure/collapse toggle/menu trigger/hamburger/strip-settings | new panel toggle also gets `hit-44` |
| `sessionView.test.js:1659,1673` | `.notes-foot [data-testid="check-card"]` absent narrow / present wide | keep `.notes-foot` class and the 899px `isNarrow` JS switch |
| `cueColumn.test.js` | `cue-focus/gap/mastered/level/subtopic/strip/disclosure` testids, `svg.cue-mark--focus`, `.cue-word`, `.is-testing`, `path stroke-width`, `landed` emit, strip copy "1 gap"/"1 mastered"/"0 gaps", disclosure `aria-expanded` | |
| `e2e/mobile-390-check-card.spec.js:176` | click `cue-disclosure` then `cue-focus` visible | mobile strip keeps the disclosure button |
| `assistantBubble/userBubble/messageList/checkQuestion/checkRecap/composer tests` | classes `.msg .assistant .user .streaming .role-tag .content .msg-gutter .landed-tick .tool-call-row .cancelled-marker .message-list .msg-skel-row .composer-count .composer-input`, `is-correct/is-incorrect`, `.check-mark(--tick/--cross)`, `coarse-2x`; role-tag text exactly `tutor` / `you` | role tag becomes the card head line, same element |
| `sidebar.test.js`, `sidebarA11y.test.js`, `useSidebar.test.js` | `sb-row--current/--ended`, `.sb-row-pin`, `.sb-brand` (collapsed must NOT contain "Crux"), `sb-toggle--end`, `aside.sidebar` inert, `body.sb-scroll-lock`, LS key `crux.sidebar.expanded` | |
| settings tests | `settings-tab-*` carry `coarse-2x`; `btn-fill` / `btn-fill--busy` on the three submits; UsagePanel `.glance-* .ledger-bar(--filled) .meter-* .tier-marker .top-rank`; FeedbackStylePicker `.radio-row .radio-sub selected`; AppearanceTab `.mode-label` | |

## Tokens (Task 1, sets everything else)

Add to all three base.css blocks (light / `[data-theme='dark']` / `:not([data-theme='light'])`, identical names, 6-digit hex):

| Token | Light | Dark | Role |
|---|---|---|---|
| `--desk` | `#e6e8ec` | `#15171b` | page ground |
| `--desk-deep` | `#dfe2e7` | `#1b1d22` | sidebar, settings ground, section cards |
| `--card` | `#ffffff` | `#22252b` | tutor card, panel bodies, composer, settings sheet |
| `--card-edge` | `#cfd3da` | `#2e323a` | 1px card border |
| `--card-drop` | `#c4c8d0` | `#0b0c0e` | 1px hard drop under a card |
| `--card-learner` | `#dbe6fb` | `#1e2a44` | learner card stock |
| `--card-learner-edge` | `#b9cdf5` | `#2f4470` | |
| `--tab-focus` | `#b8352c` | `#ff6a5e` | Focus tab fill (light = `--ink-marker-text`, AA with white) |
| `--tab-gaps` | `#8a5a00` | `#e6b450` | Gaps tab fill (= `--signal-warning`) |
| `--tab-mastered` | `#1f7a3f` | `#5fcf8a` | Mastered tab fill (= `--signal-success`) |
| `--tab-level` | `#63635e` | `#a3a39c` | Level tab (= pencil) |
| `--tab-ink` | `#ffffff` | `#141518` | text on tabs (dark tabs are light fills, so ink goes dark) |
| `--radius-card` | `6px` | same | was 0 |

Rules: tab colours are law (red only Focus, amber only Gaps, green only Mastered). Blue (`--ink-learner` / `--color-accent`) remains every control, link, focus ring. Add a `tokenContrast` case: `--tab-ink` >= 4.5:1 on each `--tab-*` in both themes. Repoint `--color-background` to `--desk`, `--color-surface` to `--card`, `--color-surface-soft` to `--desk-deep` so PrimeVue overlays and old consumers move with the world. Retire consumers of `--ruled-bg` / `--ruled-offset` / `--margin-rule` (tokens stay declared; drift guard).

Motion: `--motion-fast` 140ms fade-in for new cards; filing = 120ms lift (`translateY(-4px)` + drop) then 240ms fade at the new home; count ticks; reduced motion = final state.

## Tasks

Non-overlapping file scopes. Verify per task: `npm run test:unit -- --run`, `npm run lint`, browser at 1440 and 390 (light + dark).

### Task 1. Tokens + globals (sonnet)
Files: `frontend/src/assets/base.css`, `frontend/src/assets/dialogs.css`, `frontend/src/__tests__/tokenContrast.test.js`.
- Tokens table above. `.btn-fill` unchanged. `.hit-44 {` literal stays.
- dialogs.css: overlays become raised cards (`--card`, `--card-edge`, 6px, `--shadow-lift`); toast the same.
- Add the `--tab-ink` contrast case.

### Task 2. Shell, sheet grid, panel collapse (opus)
Files: `frontend/src/App.vue`, `frontend/src/views/SessionView.vue`, `frontend/src/components/chat/SessionHeader.vue`, new `frontend/src/composables/usePanel.js`, new `frontend/src/__tests__/usePanel.test.js`, `frontend/src/__tests__/sessionView.test.js` (only if a selector must move).
- `.shell {` keeps `grid-template-columns`, no transition (App P2 test).
- SessionView grid: `grid-template-columns: minmax(0,1fr) var(--panel-col)`; rows `auto minmax(0,1fr)`. Remove `.sheet-margin-rule` element and CSS. `.sheet-cue` moves to column 2 (DOM order: notes then cue, so reading order is thread first; `aria-label` on the aside stays). `--panel-col` = `17rem` expanded, `2.75rem` collapsed, set by a class on `.session` from `usePanel`.
- `.messages` loses ruled background and `scrollbar-gutter` tricks; ground is `--desk`; `padding: 1rem clamp(1rem,3vw,2rem)`; cards 0.75rem apart. `.notes-measure` max-width 72ch + card slack; `.notes-foot` stays (test selector), no top border, composer card sits in it.
- `usePanel.js`: mirror `useSidebar.js` (desktop >= 1280, LS key `crux.panel.expanded`, `toggleDesktop`, `__test__` hatch). Keyboard: `Ctrl+.` toggles panel, `Ctrl+B` toggles sidebar; bind in App.vue on `keydown`, ignore when target is input/textarea/contenteditable or a PrimeVue overlay is open; `preventDefault` only when handled. Tests for both shortcuts and the ignore rule.
- Below 900px: panel becomes the horizontal strip under the head (Task 4 owns the strip markup); `--panel-col` unused; `isNarrow` JS switch unchanged.
- SessionHeader: topic in display face 20px, level stroke + level word + "started N days ago" in pencil right, no underline rule, ground `--desk`.

### Task 3. Turn cards (sonnet)
Files: `frontend/src/components/chat/AssistantBubble.vue`, `UserBubble.vue`, `MessageList.vue`, `MessageListSkeleton.vue`, `CheckQuestion.vue`, `CheckRecap.vue`, `Composer.vue`, `EmptyState.vue` (chat), `ToolCallChip.vue`, `CitationsList.vue`, `SessionEndedBanner.vue`, `DiagnosticConsentCard.vue`, `frontend/src/__tests__/turnPitch.test.js` (rewrite).
- Card anatomy shared by tutor/learner/check: `.msg` is the card (`--card`, 1px `--card-edge`, `--radius-card`, `box-shadow: 0 1px 0 var(--card-drop)`, padding `0.55rem 0.9rem 0.7rem`), `.msg-gutter` is now the head line (flex row, label size, pencil: `.role-tag` text `tutor`/`you` + time on the right), `.content` body. Keep every class name. `.landed-tick` stays `position: absolute` (top-right of the head line) or rewrite turnPitch accordingly.
- Tutor: max-width 78%, left. Learner: `--card-learner` stock, `--card-learner-edge`, ink `--ink-learner`, `align-self: flex-end`, head line blue at 75% opacity. Check: `--card` with the head line carrying a 3px graphite rule as part of the head (not a side border), max-width 84%, options as lines with blue letters, ticks/crosses unchanged. Recap: same card grammar, score in title size text-safe red.
- MessageList: cards `gap: 0.75rem`; drop the pitch-doubling `+` rules; enter fade 140ms; typing row = a tutor card with dots.
- Composer: white card in `.notes-foot`, attach left, `.composer-send` a 28px blue square that arms on non-empty draft, hints in pencil under the card, count near-limit red.
- Empty state, ended banner (summary card, last in the stack), consent card (check card grammar), citations (footnote block inside the card), tool chip (pencil aside inside the card).
- `turnPitch.test.js` -> rename to `turnCard.test.js`: assert `.msg {` block has `border-radius: var(--radius-card)` and no `padding: var(--line-pitch)`, `.msg-gutter {` is `display: flex` row, mount both bubbles and assert `msg` root class. Delete the pitch assertions with a one-line comment naming the world change.

### Task 4. Profile panel as dividers (opus)
Files: `frontend/src/components/chat/CueColumn.vue`, `frontend/src/__tests__/cueColumn.test.js` (additions only), `frontend/src/__tests__/hitTargets.test.js` (add the new toggle).
- Four `.cue-section` become dividers: `.cue-heading` is the coloured tab (`--tab-*`, `--tab-ink`, 5px top radius, name + `.cue-count`), `.cue-list` sits on a `--card` body with the top-left corner square where the tab joins. Focus entry: graphite 700 with a 2px red underline (`.cue-mark--focus` svg stays on the row). Gap: pencil circle. Mastered: green tick, blue word. Level: stroke + word + last movement in pencil ("from unset, today", derived from the existing evidence/subtopic data only; if no timestamp exists, omit the phrase, do not invent). `.is-fresh` keeps a class but the animation becomes the filing motion (`@keyframes cue-file`), reduced motion honoured.
- Collapsed (desktop): `.cue.is-collapsed` renders a vertical strip of the three coloured tabs with counts (writing-mode vertical) plus the toggle. Toggle button: `data-testid="cue-collapse-toggle"`, `class="cue-toggle hit-44"`, aria-label "Collapse profile" / "Expand profile", half-tab on the panel's left edge. State from `usePanel` (Task 2).
- Under 900px: `.cue-strip` becomes the horizontal tab row (Focus word / "N gaps" / "N mastered" copy unchanged) and the existing `cue-disclosure` button opens `.cue-body` as a sheet over the thread (one divider open at a time is a stretch goal, not required for tests).
- Tests: add cases for the toggle aria-label flip and collapsed rendering; existing cases stay untouched.

### Task 5. Sidebar (sonnet)
Files: `frontend/src/components/sidebar/Sidebar.vue`, `SidebarSessionRow.vue`, `SidebarRowMenu.vue`, `SidebarSkeletonList.vue`, `SidebarMobileTopStrip.vue`, `frontend/src/__tests__/sidebar.test.js` (additions only).
- Ground `--desk-deep`, right edge 1px `--card-edge`. Current row = a white card (`--card`, radius, drop); ended rows pencil; hover `--card` at 60%.
- Existing toggle (`sidebar-collapse-toggle`) restyled as a visible half-tab on the sidebar's right edge (22x28, `--card`, edge border, chevron), still `hit-44`; keep `sb-toggle--end` for the drawer close.
- Collapsed spine: mark (mark-only Logo, no "Crux" text), plus, one 8px dot per session (current blue), settings at foot. Keep `sb-session-list--collapsed [data-session-id]` and `sb-rail--column`.
- `sb-mode-fade` keyframes/animation kept verbatim; reduced-motion block stays last; no `will-change`.
- Mobile strip: ground `--desk-deep`, bottom edge `--card-edge`.

### Task 6. Mark + favicon (sonnet)
Files: `frontend/src/components/Logo.vue`, `frontend/public/favicon.svg`, `frontend/public/favicon.ico`, `frontend/index.html` (bump `?v=3` to `?v=4`), delete orphan `frontend/src/assets/logo.svg`, new `frontend/scripts/gen-favicon.py` (Pillow, writes ico at 16/32/48 from a rasterised svg; document in `docs/reference.md` under Frontend).
- Geometry (32 viewBox): rect 25x19 at (3.5, 9.5) rx 2, stroke 2.5 currentColor; red tab `M3.5 9.5 V5.5 a2 2 0 0 1 2-2 H12.5 a2 2 0 0 1 2 2 V9.5` fill `--tab-focus`; lines `M9 16 h14` and `M9 21.5 h8` stroke 2.5 round. Sizes 22/28/56 unchanged. `logo-name` unchanged.
- favicon.svg: same geometry, `prefers-color-scheme: dark` swaps ink to `#ecebe6` and tab to `#ff6a5e`.

### Task 7. Settings (sonnet)
Files: `frontend/src/views/SettingsView.vue`, `frontend/src/components/settings/ProfileTab.vue`, `AccountTab.vue`, `AppearanceTab.vue`, `UsageTab.vue`, `frontend/src/components/profile/UsagePanel.vue`, `frontend/src/components/FeedbackStylePicker.vue`.
- Page ground `--desk-deep` inside `.page-inner`. Title, then `.rail` as divider tabs: `.rail-tab` = tab shape (top radius, `--desk` fill, pencil text), `.rail-tab--active` = `--card` fill, graphite, joined to the `.panel` which is a white sheet (`--card`, edge, radius except top-left). Keep `role=tab`, roving tabindex, `coarse-2x`.
- Sections (`.sec`) become `--desk-deep` cards inside the sheet, two columns from 60rem (existing media blocks), `sec--ruled` rule removed.
- FeedbackStylePicker rows: lines inside the card, blue letter, green tick when selected (`selected` class, `.radio-row`, `.radio-sub` kept).
- UsagePanel: meter and ledger rows on the card; class names kept.
- AppearanceTab: theme swatches redrawn as two small cards (desk + card + blue) per theme; `.mode-label` kept.

### Task 8. Other routes (sonnet, two executors, split A/B)
A: `HomeView.vue`, `ReviewView.vue`, `SessionsLibraryView.vue`, `ProfileView.vue`, `SessionChips.vue`, `LibrarySkeletonGrid.vue`, `EmptyState.vue` (root), `GapPickerDialog.vue`, `RouteProgressBar.vue`, `StartTopicIntercept.vue`.
B: `LoginView.vue`, `RegisterView.vue`, `ForgotPasswordView.vue`, `ResetPasswordView.vue`, `OnboardingView.vue`, `TosView.vue`, `PrivacyView.vue`, `NotFoundView.vue`, `BackButton.vue`, `CapBanners.vue`, `ReferenceStatusBanner.vue`, `UploadStatus.vue`.
- Home: one centred card (question, field, Start). Review: each row a covered card (cover = blue stock, lifted = white). Library: session cards in a list, three-cell label kept. ProfileView: the four dividers at full width. Auth/onboarding: one white card centred on the desk. Legal: white reading card. Status captions: a small card with the tab-colour edge ONLY as a 3px head rule, never a side border. Skeletons: card-shaped grey blocks, no shimmer.
- Remove every `--ruled-bg` / `--ruled-offset` / `--margin-rule` consumer; grep must return product-code hits only in base.css.

### Task 9. Finish (main loop)
- `impeccable detect --json` once over changed targets; fix mechanical findings.
- Browser pass: 1440 and 390, light and dark, session / settings / home / review / library / login. Screenshots to `.impeccable/review/desktop.png`, `mobile.png`.
- Spawn `impeccable-finish-reviewer` with the contract, comp HTML, screenshots, detector output. Act on disposition (fix budget: two rounds).
- Spawn `impeccable-documenter` to rewrite DESIGN.md and `.impeccable/design.json` from the built world (also clears the stale-sidecar finding).
- Full suite green, lint clean, PR to `dev`.

## Order and routing

1 -> 2 -> (3, 4, 5, 6, 7 in parallel, disjoint files) -> 8A + 8B in parallel -> 9.
Task 2 and 4 are opus (grid, collapse state, keyboard, animation, test edges). Rest sonnet. Escalate to opus on any test-text assertion failure rather than re-dispatching sonnet.

## Open risks

- Mobile "one divider at a time" sheet is new behaviour; ship the strip + existing disclosure first, sheet as polish.
- `--tab-gaps` dark `#e6b450` with dark ink: verify >= 4.5:1 in the new contrast case before Task 4 starts.
- Level "last movement" needs a timestamp the store may not hold; omit rather than fake.
