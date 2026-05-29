# AdaptLearn UI/UX Audit — 2026-05-28

Branch: `ui-audit/2026-05-28` (off `dev`). Source-of-truth: live walkthrough at `http://localhost:5173/` + source under `frontend/src/`. Backend at `:8000` rejected the synthetic JWT (401), so happy-path data on protected routes was injected via a fetch interceptor; chrome, motion, contrast, and focus rings are live observations. Screenshots: `docs/audit-screens/`.

Rubrics: `ui-refactor` (hierarchy, layout, type, color, depth) + `frontend-design` (distinctiveness, type character, color cohesion, motion, spatial composition). Scoring weights: hierarchy 1.2, layout 1.0, typography 1.0, color 1.0, depth 0.8, distinctiveness 1.5, ux 1.5, accessibility 1.0 (sum 9.0).

## BUILT / STUB inventory

User briefing said ProfileView and OnboardingView are stubs — that is stale. Both fully implemented on `dev`.

| Surface | File | Status |
|---|---|---|
| LoginView (magic-link) | `frontend/src/views/LoginView.vue` | BUILT |
| HomeView (sessions shelf) | `frontend/src/views/HomeView.vue` | BUILT |
| OnboardingView | `frontend/src/views/OnboardingView.vue` | BUILT |
| NewSessionView | `frontend/src/views/NewSessionView.vue` | BUILT |
| SessionView (chat) | `frontend/src/views/SessionView.vue` | BUILT |
| SettingsView | `frontend/src/views/SettingsView.vue` | BUILT |
| ProfileView (session profile) | `frontend/src/views/ProfileView.vue` | BUILT |
| AggregateProfileView | `frontend/src/views/AggregateProfileView.vue` | BUILT |
| App shell topnav | `frontend/src/App.vue` | BUILT |
| Logo | `frontend/src/components/Logo.vue` | BUILT |
| EmptyState (generic) | `frontend/src/components/EmptyState.vue` | BUILT |
| SessionEndedBanner | `frontend/src/components/SessionEndedBanner.vue` | BUILT |
| BackButton | `frontend/src/components/BackButton.vue` | BUILT |
| ChatHeader (teleported) | `frontend/src/components/chat/ChatHeader.vue` | BUILT |
| Composer | `frontend/src/components/chat/Composer.vue` | BUILT |
| MessageList + User/Assistant bubbles | `frontend/src/components/chat/*.vue` | BUILT |
| ChatEmptyState | `frontend/src/components/chat/EmptyState.vue` | BUILT |
| CapBanners | `frontend/src/components/chat/CapBanners.vue` | BUILT |
| UploadStatus | `frontend/src/components/chat/UploadStatus.vue` | BUILT |
| CitationsList | `frontend/src/components/chat/CitationsList.vue` | BUILT |
| ToolCallChip | `frontend/src/components/chat/ToolCallChip.vue` | BUILT |
| MarkdownContent | `frontend/src/components/chat/MarkdownContent.vue` | BUILT |

No stubs found. All 8 routes evaluated live.

## Design system observations

Tokens in `frontend/src/assets/base.css`:

- **Fonts**: `'Bricolage Grotesque'` (display, 400–700, optical sizing 12–96), `'Inter'` (sans), `'IBM Plex Mono'`. Loaded via Google Fonts CDN with `preconnect` + `display=swap` in `frontend/index.html:10`. All three are non-generic — escapes the "AI-slop" Inter-only trap because Bricolage carries the H1s.
- **Accent ramp**: 11-step coral (`--accent-coral-50…950`), primary `#FF6B5C`. Strong, singular accent — restraint-positive.
- **Neutrals**: 8-step cool slate `--ink-50…900`. Cohesive with coral. No grey-on-grey muddiness.
- **Signals**: success `#22C55E`, error `#EF4444`, warning `#FFB020`, info `#5B8DEF`. Distinct from accent so semantic colors don't fight the brand.
- **Type scale**: 0.6875 / 0.8125 / 1 / 1.125 / 1.375 / 1.875 / `clamp(2.5,5.5vw,3.75)`. Clean fifths.
- **Spacing**: 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4.5rem. Restricted scale honored across all screens (no rogue padding values found).
- **Radii**: pill 999 / card 20 / md 14 / sm 8. Friendly vocabulary.
- **Shadows**: `--shadow-lift = 0 4px 0 0 var(--ink-200), 0 10px 20px -8px rgba(...)` — bespoke "chunky press-down". `--shadow-pop` adds a `0 6px 0 0 var(--accent-coral-700)` hard ledge under primary CTAs. `--shadow-pop-pressed` for active state. This is the strongest distinctiveness signal in the system.
- **Motion**: `--motion-bounce = cubic-bezier(0.34, 1.56, 0.64, 1)`. Used on hover lifts, message-list TransitionGroup, theme toggle thumb travel. Restrained — not chaotic.
- **Dark mode**: 11-step inverted surface ramp `#0F1220 → #FFFFFF` driven by `[data-theme="dark"]` attribute + `prefers-color-scheme` fallback. Composition holds — see screenshots 13b/14/15.

## Per-screen scores (1–5)

### LoginView — screenshot `01-login-light.png`

| Category | Score | Reason (cited) |
|---|---|---|
| Hierarchy | 5 | `LoginView.vue:5-8`: lg-mark → folio `"sign in"` → `clamp(1.875,4vw,2.5)` H1 → muted lede → form-card. Clear top-down scan. |
| Layout/spacing | 5 | 30rem max-w centered; `gap: 1.75rem` between hero and form-card; form-card internal `1.75rem` padding. Consistent rhythm. |
| Typography | 5 | Display Bricolage on H1, Inter body, uppercase-tracked `var(--tracking-label) = 0.14em` on the field label. |
| Color | 5 | Coral appears only on folio + CTA; rest is paper/ink. Restraint-positive. |
| Depth/polish | 4 | Card uses `--shadow-lift`; CTA uses `--shadow-pop` + press-down at `:active translateY(4px) → --shadow-pop-pressed`. Email pill input has `0 0 0 4px var(--color-accent-ring)` on focus — observed live. |
| Distinctiveness | 4 | Spark mark SVG (two layered stars). Form is well-tuned but stops short of editorial — could have a marginal eyebrow or kicker. |
| UX flow | 5 | `canSubmit` computed regex disables submit until email is valid; sent-confirmation names the inbox address back: `LoginView.vue:27`. |
| Accessibility | 5 | `<label for="email">`, `autocomplete="email"`, `role="switch"` + `aria-checked` on the theme toggle in topnav. Focus rings visible. |
| **Weighted** | **4.66** | |

### HomeView — screenshots `02-home-error.png`, `03-home-active-populated.png`, `04-home-ended.png`, `13b-home-dark.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | `HomeView.vue:4-15`: folio `"your shelf"` → display `Sessions` at `clamp(2.25,4vw,2.75)` → muted lede → CTA row → pill tablist → tile grid. Strong vertical scan. |
| Layout/spacing | 5 | 64rem column, `flex-wrap` head, `align-items: flex-end` so eyebrow baseline-aligns to CTA pills. Grid uses `repeat(auto-fill, minmax(20rem, 1fr))`. |
| Typography | 4 | Tile-meta mixes `var(--font-mono)` for `#shortId` next to sans `started 45 minutes ago` — editorial flourish (`HomeView.vue:585`). Minor: `tile-topic` at 1.125rem feels modest beside the 2.75rem H1. |
| Color | 4 | Tile-glyph uses 8 hashed pastel gradients (`HomeView.vue:254-263`). Concern: hash is on topic spelling, so colour is not semantic — same domain can land on different tints across re-naming. |
| Depth/polish | 5 | Tiles use `--shadow-lift` and `translateY(-2px)` on hover; arrow translates `4px` and shifts colour to accent on hover. Dupe-banner uses subtle amber (`rgba(255,176,32,0.12)` bg, `0.35` border). |
| Distinctiveness | 5 | Hashed pastel glyph tints, bespoke duplicate-cleanup banner with broom icon, pill segmented tabs with count badges, "page 01" folio voice. Reads as designed, not Aura default. |
| UX flow | 3 | **Critical**: when `/api/sessions` fails, the raw `ApiError.message` lands in body as `API 401 /sessions: {"detail":"invalid_token"}` (`02-home-error.png`) because `HomeView.vue:64` renders `{{ store.error }}` directly. JSON leak. |
| Accessibility | 4 | `aria-selected` on tabs, `aria-label` on each tile router-link with relative time. Concern: tab-count `.tab-active .tab-count` is `background: rgba(255,255,255,0.22)` + `color: inherit` (white) on coral — contrast unverified on small chip glyph; [unverified live AA pass]. |
| **Weighted** | **4.18** | |

### OnboardingView — screenshot `08-onboarding.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | `OnboardingView.vue:2-9`: lg spark → folio "welcome" → display `Welcome to AdaptLearn.` at `clamp(2.25,5vw,3)` → lede → form-card with two fields → CTA. |
| Layout/spacing | 5 | 38rem column, 2.5rem outer gap, 1.75rem internal field gap, 2rem form-card padding. |
| Typography | 5 | Display H1, uppercase tracked label, 1.0625rem help line. |
| Color | 5 | Single coral CTA, coral SelectButton `:highlight` for selected feedback option, neutral elsewhere. |
| Depth/polish | 5 | **Standout**: fields rise via staggered `--delay: 0/60/120ms` keyframe (`OnboardingView.vue:160`), and `head .logo-mark` runs a `gentle-spin 8s` 12° rotation (`:113`). Pop-shadow + `translateY(4px)` press-down on CTA. |
| Distinctiveness | 5 | The choreography is hand-built — staggered reveal + slow logo wobble + PrimeVue SelectButton restyled as pill chips with coral-soft hover. Memorable. |
| UX flow | 5 | Single decision (hints vs direct answers) with live help-line that updates per selection (`:34-40`). One field optional, no required asterisks needed. |
| Accessibility | 5 | `<label for>`-bound inputs, `aria-label` carried by PrimeVue SelectButton; focus rings on CTA visible live. |
| **Weighted** | **5.00** | |

### NewSessionView — screenshots `05-new-session-empty.png`, `06-new-session-dupe-warn.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | Back-button mono caption (`BackButton.vue:48`) → folio → display H1 → lede → giant pill input as visual centerpiece → quick-picks → CTA. |
| Layout/spacing | 5 | 42rem column, `gap: 1.5rem`, centered hero. |
| Typography | 4 | **Distinctive**: topic input uses **display Bricolage at 1.25rem 500** (`NewSessionView.vue:227-229`) — unusual choice that reads like a journal page. |
| Color | 4 | Calm. Dupe-warn uses `signal-info` blue at `rgba(91,141,239,0.1)` bg / `0.3` border — semantically separate from the amber duplicate-cleanup on Home (warning vs info). Intentional split. |
| Depth/polish | 5 | Topic pill has `--shadow-paper` + 4px `accent-ring` on focus; quick-picks lift on hover. CTA gets full `--shadow-pop` press-down. |
| Distinctiveness | 5 | Display-font textbox is the strongest single design choice on this screen. Quick-pick chip row + dupe-detection card all feel hand-rolled. |
| UX flow | 5 | Live duplicate detection: typing `Recursion deep dive` surfaced the existing session (`06-new-session-dupe-warn.png`) with an "Open existing" jump CTA before the user wastes a create. Excellent friction-removal. |
| Accessibility | 5 | `<label class="sr-only">`, focus-visible rings on chip + CTA, `aria-label` on Quick-picks container. |
| **Weighted** | **4.78** | |

### SessionView (chat) — screenshots `11-session-chat.png`, `12-session-chat-dark.png`, `15-session-chat-dark-confirmed.png`, `16-session-empty-state.png`, `17-session-not-found.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | Teleported topnav: status-pill (`in session` / `archived`) + topic + Profile + End buttons (`ChatHeader.vue:1-30`). Body is purely conversation. The "tutor" `role-tag` is small caps so it reads as supporting detail not headline. |
| Layout/spacing | 4 | App-shell locks document scroll, `.messages` is the only scroller (`SessionView.vue:366-376`) — correctly engineered. Reading column 48rem. Concern: code blocks inside assistant bubble use `font-size: 12px` (`MarkdownContent.vue:69`) which is smaller than the typographic minimum elsewhere — verified live in `11-session-chat.png`. |
| Typography | 5 | `role-tag` uppercase + `var(--tracking-label)`, content 0.9375rem 1.6 line-height, inline `code` is accent-soft / accent-hover (`MarkdownContent.vue:74-81`). |
| Color | 5 | User bubble coral with `0 2px 8px -4px rgba(255,107,92,0.22)` glow (`UserBubble.vue:77`); assistant bubble on `--color-surface-raised` neutral. Tool-pill in `--color-accent-soft`. Cap banners use `signal-error` at 0.12 opacity. |
| Depth/polish | 5 | Composer `focus-within` gets coral border + 4px accent-ring + `translateY(-1px)`. Send button uses `--shadow-pop` with `:active translateY(3px) → --shadow-pop-pressed`. Typing indicator has phased dot delays `0/200/400ms` (`MessageList.vue:128`). |
| Distinctiveness | 5 | Reuses the spark SVG as the tutor avatar (`MessageList.vue:25-32`, `AssistantBubble.vue:17-24`) — small but memorable visual anchor. `pi-spin` spinner inside the attach button shares the round-icon vocabulary with send/stop so the composer reads balanced. |
| UX flow | 5 | Stop button replaces Send mid-stream (`Composer.vue:54-64`), retry of last message via error-banner Retry, cap banners + toasts, summary dialog on End. Quick-prompt cards auto-fill composer + focus it. 404 path renders an inline 404 card not a separate route (`17-session-not-found.png`). |
| Accessibility | 4 | `role="alert"` on error/cap banners, `aria-label` on stop/send, typing dots have `aria-label="Tutor is thinking"`. Concern: composer hint strip uses `⏎` and `⇧` glyphs as `<kbd>` content — screen readers may read these as their Unicode names rather than "Enter" / "Shift". |
| **Weighted** | **4.78** | |

### SettingsView — screenshot `07-settings.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | folio `preferences` → display H1 → lede → Account card → Feedback card → Save + flash → Danger Zone with dashed `signal-error` border. |
| Layout/spacing | 5 | 42rem column, 1.5rem card padding, 1rem gap, 0.625rem radio-row gap inside fieldset. |
| Typography | 5 | Card titles 1.125rem 700 display, uppercase tracked labels, 0.8125rem hint copy. |
| Color | 5 | Coral icons on primary cards; signal-error scoped to the Danger Zone (dashed border + outline link). Saved-flash uses signal-success. |
| Depth/polish | 5 | Custom radio cards animate the inner `radio-dot-inner` via `transform: scale(0→1)` on `.selected` (`SettingsView.vue:336-342`) — bespoke. `--shadow-pop` press-down on Save. |
| Distinctiveness | 5 | The radio-row "card" pattern with inline `radio-label` + `radio-sub` description is genuine design work, not a stock PrimeVue RadioButton. Dashed Danger Zone with red outline-link reads editorial. |
| UX flow | 5 | Save disabled until `dirty` (`SettingsView.vue:126-131`); `savedFlash` clears as soon as the form mutates; danger-zone link routes to `/onboarding?retake=1`. |
| Accessibility | 5 | `<fieldset>` + `<legend class="sr-only">`, native radio `position: absolute opacity: 0` but still in the tab order, label-row captures click. |
| **Weighted** | **5.00** | |

### ProfileView (session profile) — screenshot `10-session-profile.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | Back → folio `session profile` → topic title → level-pill → focus card → two-col `Mastered` / `Confirmed gaps` → `Session summary` → `Recent check-questions`. |
| Layout/spacing | 4 | Two-col `auto-fit minmax(18rem,1fr)`. Event-row `border-left: 3px solid signal-*` is visual signal; the chip-list above also uses color, slight color-load on small viewports. |
| Typography | 5 | Section titles `1.25rem` display 700 with signal-colored icon; event-q in display font 1rem 500 — gives each check-question a headline weight. |
| Color | 4 | level-pill data-attribute styling for `beginner / intermediate / advanced / unknown` is clean semantic mapping (`ProfileView.vue:196-223`). Concern: `.chip-gap` is `color: #B5800F` on `rgba(255,176,32,0.16)` — looks borderline for AA on the light theme; [unverified — needs a contrast probe]. Dark mode overrides to `signal-warning #FFC54D` so dark side is fine. |
| Depth/polish | 5 | Focus card uses a 135° coral gradient (`linear-gradient(135deg, var(--accent-coral-100), var(--accent-coral-50))`) with coral-200 border + `--shadow-paper` (`ProfileView.vue:230-238`). Event rows lift on hover. |
| Distinctiveness | 5 | Bullseye icon in coral-filled circle as a "focus" affordance, ok/bad rail in `signal-success` / `signal-warning` left-borders for events — distinct from a generic stats page. |
| UX flow | 4 | Read-only inspection. No filter / search on chip lists; not critical at v1 but worth flagging if topics grow. |
| Accessibility | 4 | Icons `aria-hidden`, h1 + h2 hierarchy correct. Same `.chip-gap` contrast caveat as Color above. |
| **Weighted** | **4.40** | |

### AggregateProfileView — screenshots `09-aggregate-profile.png`, `14-profile-dark.png`

| Category | Score | Reason |
|---|---|---|
| Hierarchy | 5 | folio `across all sessions` → display H1 `Your Learning Profile` → lede with `last_active_at` → stats grid → distribution bar → two-col chips → `Recent topics` list. |
| Layout/spacing | 5 | 60rem column, 1.75rem section rhythm, stats `repeat(auto-fit, minmax(11rem, 1fr))`, two-col `minmax(20rem, 1fr)`. |
| Typography | 5 | Stat-value at display 2.25rem 700 carries the eye; stat-label uppercase tracked; `chip-meta` mono. |
| Color | 5 | Four signal-colored gradient cards (coral / green / yellow / blue) wash into `--color-surface` so each card stays in the same surface family — bold but cohesive (`AggregateProfileView.vue:304-335`). |
| Depth/polish | 5 | Distribution bar (`AggregateProfileView.vue:368-377`) is a 0.75rem pill with 4 inner segments, 2px gap, 2px outer padding — micro-craft. Stat-glyph absolutely positioned top-right in each card. |
| Distinctiveness | 5 | The colored-corner stat-card pattern + segmented distribution bar + inline `×N` count chip that links to the first-seen session profile (`:103-110`) is bespoke and useful. |
| UX flow | 5 | Every concept chip is a deep-link to the originating session profile. Recent topics list links onward too — strong forward-navigation density on a v1 dashboard. |
| Accessibility | 4 | Stat cards lack a wrapping `role="group"` or `aria-label` summary; distribution segments have `title=` tooltips but no `aria-label` summarising the bar in one read. Otherwise solid. |
| **Weighted** | **4.89** | |

## Weighted overall

Mean of weighted screen scores: **4.71 / 5**. AdaptLearn is already a well-designed app — bespoke shadow system, distinctive Bricolage display, restrained coral palette, hand-crafted micro-interactions. The audit is therefore mostly about polish, contrast verification, and a single critical leak.

## Ranked issues

### Critical (1)

1. **Raw API error JSON leaks to user on HomeView.** When `/api/sessions` errors, `HomeView.vue:64` renders `{{ store.error }}` which contains `ApiError.message = "API 401 /sessions: {\"detail\":\"invalid_token\"}"` (`apiClient.js:10-11`). Captured live in `02-home-error.png`. ProfileView/AggregateProfileView wrap errors with `friendlyError(e)` (`ProfileView.vue:135`); HomeView does not. **User-facing.**

### Major (5)

2. **Unverified AA contrast on `.chip-gap` text.** `color: #B5800F` on `rgba(255,176,32,0.16)` over a light card. Likely passes WCAG AA on the chip but should be measured. Dark-mode override to `signal-warning #FFC54D` is safe. (`ProfileView.vue:336`, `AggregateProfileView.vue:483`.)
3. **Unverified AA contrast on level-pill `beginner` and `advanced` variants.** `#5B8DEF` on `rgba(91,141,239,0.16)` and `signal-success #22C55E` on `rgba(34,197,94,0.16)` (`ProfileView.vue:196-217`). Both are borderline at small text sizes; need a contrast probe.
4. **Tab-count chip inside an active tab is white-on-coral with `0.22` alpha background.** `.tab-active .tab-count` (`HomeView.vue:470-472`) — small text, high-saturation accent. Likely fine but worth verifying.
5. **Topnav action set is icon-only with no visible labels and no `title=` tooltips.** `.icon-btn` only carries `aria-label` (`App.vue:50-87`). First-time users get no hover-affordance — `pi-cog`, `pi-user`, `pi-sign-out` are guessable but the theme toggle is non-obvious for tertiary users. Add `title=` matching `aria-label`.
6. **Code block font-size 12px inside assistant bubble.** `MarkdownContent.vue:69` — drops below the rest of the type scale on a wide reading column. Reads cramped beside the 0.9375rem prose (`11-session-chat.png`). Bump to 0.8125rem (the existing caption token).

### Minor (8)

7. **Tile-glyph color/icon hashes on topic spelling.** Renaming "Recursion" to "Recursion deep dive" changes both the glyph and the gradient. Cosmetic but breaks recognition over time (`HomeView.vue:264-275`).
8. **Composer hint kbd uses `⏎` / `⇧` glyphs.** Screen readers may pronounce the Unicode names rather than "Enter" / "Shift" (`Composer.vue:69-72`). Either add visually-hidden text or replace with words.
9. **Distribution bar lacks an aria summary.** Segments have `title=` tooltips (`AggregateProfileView.vue:76`) but no aria-label on `.dist-bar` summarising the breakdown. Add e.g. `aria-label="Knowledge level distribution: 2 beginner, 4 intermediate, 1 advanced, 0 unknown"`.
10. **Theme-toggle `aria-label` mismatch.** The label is "Switch to light mode" / "Switch to dark mode", but the underlying state is a tri-state (`light` / `dark` / `auto`) in `useTheme.js`. The button forces light↔dark and loses the auto state on first click — accessibility-acceptable, but it under-represents the actual state machine.
11. **Empty state on chat sits with `padding: 1.75rem 1rem 1.25rem`** in a 48rem flex column that can be very tall. Quick-prompts cluster near the top. Acceptable, just noted (`components/chat/EmptyState.vue:69`).
12. **Two animations run unconditionally:** the homepage tile arrow (`translateX 4px on hover`) and the chat `empty-spark` `4.5s` breathing animation. `MessageList.vue` typing dots and `OnboardingView` `gentle-spin` are guarded by `prefers-reduced-motion` only in one place (`components/chat/EmptyState.vue:85`); the others are not. Add a global `@media (prefers-reduced-motion: reduce)` block in `base.css`.
13. **CitationsList typography uses raw `font-size: 11px` and `gap: 8px`** (`CitationsList.vue:38-44`) — not tokenized. Cosmetic drift from the rest of the system.
14. **`.back-btn :hover` background uses `--color-surface`**, which on light theme is the same paper as the page (`base.css:88` `--color-surface = --paper-50`). Hover state is therefore nearly invisible on Light theme — observed live. Use `--color-surface-soft` instead.

## What I could not verify live

- Magic-link send happy path (only stubbed in e2e). The Supabase project the dev bundle was built against did not return a session for my injected token. The `LoginView.vue:71` `auth.signInWithMagicLink(email)` call path is exercised in `e2e/auth.spec.js:66-72` via a route-stub; verification of the on-screen sent-confirmation reads from the source + e2e spec, not from a live magic-link round-trip.
- PDF upload + ingestion polling (`SessionView.vue:298-340`). Backend stub mode + real Supabase Storage would be needed; not exercised in this audit.
- Streaming SSE chat path. Live screenshot `11-session-chat.png` shows a static assistant bubble injected via store; the `Composer` stop / streaming-state transition was verified only from source (`Composer.vue:54-64`, `chatStreamService.js`).
- Real-device dark / OS contrast against pinned-down WCAG values for `.chip-gap`, `.level-pill[data-level=beginner|advanced]`, `.tab-count` — see Major issues 2–4.

---

**End of audit. Awaiting go-ahead before writing `docs/ui-remediation-spec.md` (Phase 4).**
