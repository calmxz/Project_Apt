# Crux redesign: The Cornell Page

**Goal:** Replace the incumbent visual world (slate + coral + Bricolage, bubble chat) with the Cornell Page world across every route, anchored on the session view, without changing behavior, routes, store contracts, copy that tests assert, `data-testid` hooks, or aria attributes.

**Direction contract (authoritative):** `.impeccable/surfaces/frontend-src-views-sessionview-vue.md` (six blocks + seed key 0da73f14). Product truth: `PRODUCT.md`. Craft floor: `C:/Users/EDWARD/.claude/plugins/cache/impeccable/impeccable/4.3.1/skills/impeccable/reference/craft-floor.md`. Test hook inventory: `docs/superpowers/plans/2026-09-10-redesign-test-hooks.md`.

**Branch:** `redesign/2026-09-10-world` (off `fix/frontend-critique-2026-09-10`). PR target `dev`.

**Verification per phase (from `frontend/`):** `npm run test:unit -- --run` (870 baseline, must stay green or tests updated with reason), `npm run lint`, then `npm run build` at the end of each phase. The impeccable detector runs once after Phase B and once after Phase C.

## World summary (for executors; the contract wins on conflict)

- **Scene:** a student at a desk at night with a laptop. Light theme = lamp on (white notebook paper). Dark theme = lamp off (the same page, screen-lit).
- **Ground and rules:** light page `#fcfcfa`, feint rules `#d3dfee` on a 28px pitch; dark page `#141518`, rules `#262a33`. Red margin rule `#d8433a` 2px (light) / `#ff6a5e` (dark). The margin rule is page structure, not a card border; the craft floor's side-border refusal does not apply to it.
- **Three inks, palette law:** black `#1b1b1a` / dark `#ecebe6` = tutor and body text. Blue `#1d4fc4` / dark `#8fb0ff` = the learner: user messages, cue words, answers, every interactive control, links, focus rings. Red `#d8433a` mark, `#b8352c` text / dark `#ff6a5e` = margin rule, grading ticks and crosses, focus underline. Nothing else may use blue or red. Pencil `#63635e` / dark `#a3a39c` = dates, counts, hints. Success/error/warning/info signals stay but are re-tuned to sit on paper (muted, AA as text).
- **Faces (self-hosted, already in `frontend/src/assets/fonts/`):** `Atkinson Hyperlegible Next` variable 200..800 (+ italic) for body, cues, UI; `Familjen Grotesk` variable 400..700 (+ italic) for page titles and the wordmark; `JetBrains Mono` variable 100..800 for code only. Drop Bricolage, Inter, IBM Plex Mono files and faces.
- **Rhythm:** 4px base, 28px line pitch for ruled text, body 17px/28px, measure 72ch max. Type scale: title 28px/32px Familjen 600, h2 22px, h3 18px, body 17px, caption 14px, small 13px. No letterspaced uppercase labels, no eyebrows or kickers anywhere.
- **Shape:** paper has no radius. Controls: 4px radius max. No cards with shadows; separation comes from rules (1px `--rule-strong`) and whitespace. Sheets (page regions) may carry a 1px rule border. No gradients, no glass, no blur decoration.
- **Motion:** ink appears, never slides or bounces. Reveal = `clip-path: inset(0 100% 0 0)` to `inset(0)` over 320ms with `cubic-bezier(0.16, 1, 0.3, 1)`. Marks draw with `stroke-dashoffset` over 240ms. Route transition: opacity only, 160ms. `prefers-reduced-motion`: final state immediately.
- **Icons:** PrimeIcons stay (drawn icon set, consistent stroke). No unicode glyphs as icons (the current `&#9678;` / `&#10003;` chips get SVG marks).
- **Logo:** new mark = a 24x24 page glyph: 1px ink rounded-rect outline (2px radius), three feint horizontal rules, one red vertical margin rule at x=8. Wordmark "Crux" in Familjen Grotesk 600. Keep `Logo.vue` props (`size`, `variant`).

## Token mapping (Phase A must ship this; consumers keep working)

Keep every existing semantic token name that components consume; change values and add new ones. Table:

| Token | New meaning / value (light -> dark) |
|---|---|
| `--color-background` | page `#fcfcfa` -> `#141518` |
| `--color-surface` | same as background (paper has one surface) |
| `--color-surface-soft` | `#f3f3ef` -> `#1b1c20` (code blocks, hover fills) |
| `--color-surface-raised` | `#ffffff` -> `#1f2126` (teleported overlays only) |
| `--color-text`, `--color-heading` | ink `#1b1b1a` -> `#ecebe6` |
| `--color-text-muted`, `--color-text-faint` | pencil `#63635e` -> `#a3a39c` (both; faint is no longer lighter) |
| `--color-border` | rule `#d3dfee` -> `#262a33` |
| `--color-border-strong` | `#b9c6da` -> `#363b47` |
| `--color-accent`, `--color-accent-hover`, `--color-accent-text`, `--color-accent-strong` | blue ink `#1d4fc4` / hover `#173fa0` / text `#1d4fc4` / strong `#1d4fc4` -> dark `#8fb0ff` / `#a9c2ff` / `#8fb0ff` / `#3b63d6` (strong = filled button bg with white text: check AA) |
| `--color-accent-soft` | `#e6ecfa` -> `rgba(143,176,255,0.14)` |
| `--color-accent-ring` | `rgba(29,79,196,0.35)` -> `rgba(143,176,255,0.45)` |
| `--color-text-on-accent` | `#ffffff` both |
| `--color-wordmark`, `--color-stub-heading` | ink |
| new `--ink`, `--ink-learner`, `--ink-marker`, `--ink-marker-text`, `--pencil`, `--rule`, `--rule-strong`, `--margin-rule`, `--line-pitch: 28px`, `--ruled-bg` (repeating-linear-gradient producing the feint rules at the pitch) | as above |
| `--font-display` | `'Familjen Grotesk', system-ui, sans-serif` |
| `--font-sans` | `'Atkinson Hyperlegible Next', system-ui, sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` |
| `--fs-*` | display 2.25rem, h1 1.75rem, h2 1.375rem, h3 1.125rem, body 1.0625rem, caption 0.875rem, label 0.8125rem |
| `--tracking-label` | `0` (no tracked labels in this world), `--tracking-display` `-0.01em`, `--tracking-tight` `0` |
| `--lh-body` | `1.647` (28/17); `--lh-display` 1.15 |
| `--radius-sm/md/lg/card` | 4px / 4px / 4px / 0; `--radius-pill` stays 999px (chips are the one pill form) |
| `--shadow-paper` | `none`; `--shadow-lift` | `0 12px 24px -12px rgba(0,0,0,0.25)` (overlays only) |
| `--gradient-spark`, `--gradient-surface` | removed; grep and replace consumers with `--color-accent` / `--color-background` |
| `--motion-bounce` | `cubic-bezier(0.16, 1, 0.3, 1)` (name kept, no longer bounces); `--motion-fast` 140ms, `--motion-base` 240ms, new `--motion-ink` 320ms |
| `--accent-coral-*`, `--ink-*`, `--paper-*` primitives | removed; the ~25 direct consumers in .vue files are repointed to semantic tokens |
| `--signal-*` and `--color-*-text` | success `#1f7a3f`/text `#1f7a3f`, error `#b8352c`, warning `#8a5a00`, info `#1d4fc4`; dark: `#5fcf8a`, `#ff6a5e`, `#e6b450`, `#8fb0ff` |
| aura-tokens.css chat tokens | `--chat-bubble-*` map to transparent/none; `--user-bubble-bg` transparent, `--user-bubble-text` `--ink-learner`; `--math-accent` `--ink-marker`; `--code-block-*` to soft surface |

## Phase A: foundation (executor-opus, one agent)

Files: `frontend/src/assets/base.css`, `fonts.css`, `main.css`, `aura-tokens.css`, `dialogs.css`, `frontend/src/App.vue`, `frontend/src/components/Logo.vue`, `frontend/src/assets/logo.svg`, `frontend/public/favicon*` (regenerate the favicon SVG from the new mark if an SVG favicon exists; leave raster favicons), `frontend/src/__tests__/tokenContrast.test.js`, `frontend/src/router/index.js` (route meta only), plus any `.vue` file that references a removed primitive token (repoint only, no layout changes in this phase).

1. Rewrite `fonts.css`: three variable families with the weight ranges above, `font-display: swap`, latin unicode-range as today. Delete the seven old woff2 files.
2. Rewrite `base.css` tokens per the mapping; keep the reset and global element styles but retune: body on `--color-background`, `font-size` 17px, `line-height` 28px; headings in `--font-display`; links blue with `text-decoration-thickness: 1px; text-underline-offset: 3px`; `::selection` blue soft; caret color blue; focus-visible ring 2px blue offset 2px; scrollbars thin, thumb `--rule-strong`; `font-variant-numeric: tabular-nums` on `[data-tabular]` and tables.
3. Both themes fully resolved under `:root` and `:root[data-theme='dark']` plus the existing `prefers-color-scheme` fallback block; keep whatever selector structure `tokenContrast.test.js` slices on.
4. Widen `tokenContrast.test.js`: assert `--color-text`, `--color-text-muted`, `--color-text-faint`, `--color-accent-text`, `--ink-marker-text`, `--color-success-text`, `--color-error-text`, `--color-warning-text`, `--color-info-text` against `--color-background` at >= 4.5 in both the light `:root` block and every dark block, and `--color-text-on-accent` on `--color-accent-strong` >= 4.5 in both.
5. `App.vue`: route fade becomes opacity-only 160ms. Add a full-width escape: routes with `meta.sheet === true` render `.page-inner` without the 72rem cap and with zero horizontal padding (set `meta: { sheet: true }` on the `session` route only in `router/index.js`). Keep skip link, shell grid, testids.
6. `Logo.vue` and `logo.svg`: the new page mark and wordmark, same props and sizes.
7. `dialogs.css` and `aura-tokens.css`: PrimeVue dialog, confirm, toast, input reskinned: paper surface, 1px rule border, 4px radius, `--shadow-lift`, title in `--font-display`, toast as a status caption (one line, ink on paper, blue rule on the left is NOT allowed; use a 1px full border). Toast enter: ink reveal; leave: opacity.
8. Repoint every `.vue` that used `--accent-coral-*`, `--ink-*`, `--paper-*`, `--gradient-*`: grep from repo root with `rg -n -- '--accent-coral|--ink-[0-9]|--paper-|--gradient-' frontend/src`. Value-only edits.
9. Gate: `npm run test:unit -- --run`, `npm run lint`, `npm run build`. Report counts and any test you changed with the reason.

## Phase B: anchor surface (two parallel agents, disjoint files)

### B1 session sheet (executor-opus)

Files: `frontend/src/views/SessionView.vue`, everything in `frontend/src/components/chat/`, `frontend/src/components/SessionEndedBanner.vue`, `DiagnosticConsentCard.vue`, `GapPickerDialog.vue`, `SessionChips.vue`, `BackButton.vue`, and their tests in `frontend/src/__tests__/`. Read the direction contract and the test-hook inventory first.

Build the FIRST VIEWPORT block exactly:

- Sheet layout: CSS grid `[cue 232px] [rule 2px] [notes minmax(0, 1fr)]` inside the full-width page; on `< 900px` the cue column becomes a single strip under the header (focus cue, "N gaps", "N mastered") with a disclosure that expands it in place (`aria-expanded`, keep keyboard).
- Header line: `SessionHeader` becomes the page header: topic in `--font-display` 28px; right side "started {relative}" and the level mark in pencil; 1px rule below. Keep `session-topic-link` testid and the link to the session profile.
- Cue column (new component `chat/CueColumn.vue`): sticky under the header; sections Focus / Gaps / Mastered as plain headings in ink 14px 700 (no eyebrow styling), entries as cue words in blue 17px; the focus entry is ink with a 2px red underline and a small red margin tick drawn as SVG; mastered entries carry a blue SVG tick; gaps carry an open circle outline. The level mark: one SVG stroke glyph rendered at five stepped stroke weights for beginner..advanced (define the five steps; unknown level shows the hairline step in pencil with the word "level not set"). Cue-lands: when `topic_profile` gains an entry, that entry mounts with the ink reveal (clip-path inset) and the gutter of the latest assistant turn gets a blue tick; `prefers-reduced-motion` skips the reveal. Data comes from `store.currentSession.topic_profile` (ConceptEntry objects with a `concept` field; check `docs/api/openapi.yaml` ConceptEntry for the exact key).
- Notes column: the message list sits on `--ruled-bg`; every text line aligns to the 28px pitch (body 17/28, paragraphs margin 28px, headings inside markdown snap to multiples of 28). `AssistantBubble`: no avatar, no role tag as a pill; a small pencil "tutor" label in the gutter (keep the class names the tests assert or update the tests, per inventory). `UserBubble`: no bubble; blue ink text with a pencil "you" gutter label. Tool-call chips become a single pencil line "looked up your notes" style caption in the gutter; citations become superscript numbers resolving to a footnote list in pencil at the end of the turn (`CitationsList` restyled, same testids). Markdown: code blocks on `--color-surface-soft` with a 1px rule, JetBrains Mono 15px; KaTeX display math gets 28px of space above and below and a 1px red rule under it (the one red mark inside notes); tables ruled with 1px rules.
- Check question: `CheckQuestion` becomes a ruled box spanning the notes column (1px ink border, no radius, paper background over the rules), question in ink, options as lettered lines A. B. C. D. each a full-width button with a blue focus ring; the answered state stamps a red SVG tick or cross drawn with stroke-dashoffset beside the chosen option and reveals the explanation only after grading (hidden-until-graded raise). Progress "1/3" stays as plain pencil text (the inventory says which strings tests assert). While a check is open, the cue being tested gets the red underline in the cue column.
- `CheckRecap`: the score set in red pen as "3 / 4" in `--font-display` beside the gap name, options listed as lines with your answer in blue and the correct one ticked in red.
- `Composer`: one ruled line at the foot of the notes column, sticky bottom; textarea on the rule with a blue caret; attach and send as PrimeIcons buttons in blue; hints in pencil 13px under the line; the stop button replaces send while streaming. Keep all testids and aria.
- `SessionEndedBanner` becomes the summary strip: a region below the notes column ruled off by a 1px ink rule on top with "Session ended {relative}" in `--font-display` 22px, the summary text if any (`topic_profile.last_session_summary`), and the resume buttons as blue text buttons. Keep the emitted events and testids.
- Status captions (`CapBanners`, `ReferenceStatusBanner`, `UploadStatus`, stream errors): one line each, ink on paper with a 1px full rule border, appearing in a single slot above the composer, entering with the ink reveal and leaving with opacity; never more than one visible (queue them). Keep `role="status"` / `alert` and testids.
- `DiagnosticConsentCard`: a ruled box in the notes column like a check (same box grammar), level options as lettered lines, consent copy unchanged.
- Chat `EmptyState` and `MessageListSkeleton`: the empty sheet shows three feint rules with a pencil prompt line; the skeleton is pencil-gray bars on the rules, no shimmer gradients.
- `GapPickerDialog`: PrimeVue dialog restyled per Phase A; entries as cue words.
- `SessionChips`: keep the component API; render the three-cell label (topic / level / mastered count) grammar for the `card` variant and the compact cue glyphs for the header variant, SVG marks instead of unicode.

Gate: vitest, lint, build. Update tests only where the inventory shows a class or copy assertion that the contract changes; note each.

### B2 sidebar as contents column (executor-opus)

Files: `frontend/src/components/sidebar/*.vue`, `frontend/src/__tests__/sidebarA11y.test.js` and any sidebar test. Disjoint from B1.

- The sidebar is the notebook's contents: paper ground with a 1px rule on its right edge, no shadow; wordmark at top; "New session" as a blue text button with a PrimeIcon; search field on a rule; the Active / Ended filter as two blue text toggles with an ink underline on the active one (no pills); session rows as ruled lines (28px pitch) carrying the three-cell label: topic in ink, level mark, mastered count in pencil, with the focus cue in a second line when present. The active row has a 2px blue rule on the left inside the gutter (this is the one allowed side mark: it is a bookmark, 2px, on the paper ground; do not exceed 2px). Row menu via PrimeVue overlay restyled. Collapsed rail: 48px with the page mark and icons in ink. Mobile top strip: one rule with wordmark and a menu button. Drawer: same paper, `--shadow-lift`.
- Keep every testid, aria, roving tabindex, inert, and scroll-lock behavior.

Gate: vitest, lint.

## Inspect and finish (orchestrator, after Phase B)

Screenshots of `/session/:id` at 1440 and 390 in light and dark via the authed Chrome tab into `.impeccable/review/desktop.png`, `mobile.png`, `desktop-dark.png`, `mobile-dark.png`. Run `impeccable detect --json frontend/src/views/SessionView.vue frontend/src/components/chat frontend/src/components/sidebar frontend/src/assets`. Fix mechanical findings. Spawn `impeccable:impeccable-finish-reviewer` fresh with the packet. Act on the disposition. Then spawn `impeccable:impeccable-documenter` to write `DESIGN.md` and `.impeccable/design.json` from the built world.

## Phase C: every other surface inside the established world (three parallel agents)

Each agent reads `DESIGN.md` first. Same rules: no eyebrows, no cards-with-shadows, three inks, ruled structure, keep testids/aria/copy.

- **C1 entry and library (executor-opus):** `HomeView.vue` (a fresh sheet: the header line is the topic input "What are we studying?" written on the rule, quick-pick chips as blue cue words, recent sessions as contents rows), `SessionsLibraryView.vue` (the contents page: ruled rows with the three-cell label, sort and filter as text toggles, cursor pagination as a "more" line), `ReviewView.vue` (cue recitation: the due cues listed as blue cue words on the left with the notes column hidden by a paper cover the learner lifts per item; streak in pencil with one line explaining it), `components/start/*`, `components/EmptyState.vue`, `LibrarySkeletonGrid.vue`, `RouteProgressBar.vue` (a 2px blue rule), `utils/sessionCard.js` only if a label needs it. Tests: `homeView`, `sessionsLibraryView`, `reviewView`, `sessionCard`, `components`.
- **C2 settings and profile (executor-opus):** `SettingsView.vue`, `components/settings/*.vue`, `ProfileView.vue`, `components/profile/*.vue`, `FeedbackStylePicker.vue`. Settings rail as a contents list; Profile tab as the cue column at full width (Focus / Gaps / Mastered across sessions with the session name in pencil under each cue), subtopic levels as the stepped mark; Usage as a ruled table with tabular numerals; Appearance as two labelled swatches (lamp on / lamp off); Account as ruled fields; the retake-onboarding link as a plain blue link. Tests: `accountTab`, `usagePanel`, `profile*`, `settings*`.
- **C3 covers (executor-sonnet):** `LoginView`, `RegisterView`, `ForgotPasswordView`, `ResetPasswordView`, `OnboardingView`, `TosView`, `PrivacyView`, `legal/*.md` untouched. Auth pages are the notebook cover: a centered sheet with the page mark and wordmark, fields on rules, a filled blue button. Onboarding is the inside cover: "This notebook belongs to" name field, feedback style as two lettered lines. Legal pages are ruled reading columns with a back link. Tests: `legalViews`, `resetPasswordView`, `loginView`, `registerView`, `onboarding*`.

Gate per agent: vitest, lint. Orchestrator then: build, detector on the changed targets, screenshot round of Home, Library, Review, Settings/Profile, Login at 1440 and 390, finish reviewer round two against `DESIGN.md`, fixes, documenter recheck.

## Phase D: close

Full `npm run test:unit -- --run`, `npm run lint`, `npm run build`, Playwright `auth.spec.js` locally if the backend stub is available. Commit per phase (A, B1+B2, C1..C3, docs). Open PR to `dev` with the direction contract summary and the reviewer verdict. Log deferred findings as GitHub Issues.
