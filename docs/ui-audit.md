# AdaptLearn Frontend — UI/UX Audit

- **Date:** 2026-06-13
- **Scope:** `frontend/src/` only (views, components, router, composables, stores referenced for state, `assets/*.css`, PrimeVue/Aura theme setup in `main.js`).
- **Method:** Source read of every view + component + token file, cross-checked against the running app at `http://localhost:5173` (authenticated session). Inspected rendered output at 1440px in both dark and light themes. Sub-desktop window resize was **not honored by the automation harness** — the captured viewport stayed ≥1280px — so 375px responsive behavior is reasoned from CSS + media queries, not a live render. Those items are tagged `[uncertain]`.
- **Standards (priority order):** (1) project `ui-refactor` + `frontend-design` skills, (2) Nielsen's 10 heuristics, (3) WCAG 2.2 AA, (4) PrimeVue/Aura usage consistency, (5) responsive at 375px / 1440px.
- **Supersedes:** the prior `docs/ui-audit.md` dated 2026-05-28 (retained in git history). That audit predated the sidebar redesign, the `/sessions` library, card-differentiation, and MC check-questions, and is stale.
- **Contrast note:** Ratios below are computed against the **light** theme surfaces (`--paper-100` #F5F7FC / white cards), which is where almost every contrast issue lives. The **dark** theme brightens the same signal/accent tokens (coral-400, success #34D77B) and clears AA — verified visually. Unless stated, contrast findings are light-theme-specific.
- **Implementation:** This document is **findings only**. No source file was modified. The remediation plan is a separate file (`docs/ui-remediation-spec.md`), produced after sign-off at the Gate.

---

## Phase 1 — Inventory

### Routes → Views (`frontend/src/router/index.js`)

| Path | Name | View | Shell? | Notes |
|---|---|---|---|---|
| `/login` | `login` | `LoginView.vue` | no (`sidebar:false`) | public, magic-link |
| `/` | `home` | `HomeView.vue` | yes | session shelf + recent feed |
| `/onboarding` | `onboarding` | `OnboardingView.vue` | no | name + feedback style |
| `/settings` | `settings` | `SettingsView.vue` | yes | profile + appearance + danger zone |
| `/profile` | `profile-aggregate` | `AggregateProfileView.vue` | yes | cross-session stats |
| `/new` | `new-session` | `NewSessionView.vue` | yes | topic entry |
| `/sessions` | `sessions-library` | `SessionsLibraryView.vue` | yes | paginated library |
| `/session/:id` | `session` | `SessionView.vue` | yes | chat surface |
| `/session/:id/profile` | `session-profile` | `ProfileView.vue` | yes | per-session profile (read-only) |

Guard (`router/index.js:61-81`): unauth → `/login`; auth + onboarding-incomplete → `/onboarding`. Sound.

### App shell (`App.vue`)
- `.shell` = CSS grid `auto 1fr` (sidebar | main). Skip link → `#main-content` (`App.vue:49`). RouterView with fade transition.
- `<SidebarMobileTopStrip>` rendered only when `!isDesktop` (`App.vue:54`).
- Global error bus → toast, with 429/404 suppressed (`App.vue:37-42`).
- Body scroll-lock class for the mobile drawer.

### Shared components
- **Layout/nav:** `Sidebar.vue`, `SidebarSessionRow.vue`, `SidebarRowMenu.vue`, `SidebarMobileTopStrip.vue`, `SidebarSkeletonList.vue`, `BackButton.vue`, `Logo.vue`.
- **Chat:** `chat/Composer.vue`, `MessageList.vue`, `MessageListSkeleton.vue`, `AssistantBubble.vue`, `UserBubble.vue`, `MarkdownContent.vue`, `CheckQuestion.vue`, `CheckRecap.vue`, `CitationsList.vue`, `ToolCallChip.vue`, `CapBanners.vue`, `UploadStatus.vue`, `SessionHeader.vue`, `chat/EmptyState.vue`.
- **Generic:** `EmptyState.vue`, `SessionChips.vue`, `SessionEndedBanner.vue`.
- **Composables:** `useSidebar.js` (breakpoint 1280, drawer/collapse state, localStorage), `useTheme.js` (auto/light/dark, system media query), `useToast.js`, `useSessionGroups.js`.

### Global styles / design tokens
- `assets/base.css` — the real design system: cool-slate neutrals (`--ink-*`), coral accent ramp (`--accent-coral-*`), signal triad, type scale, spacing scale, radii, "chunky press-down" shadows, motion, **semantic tokens** (`--color-*`) for light + dark + `prefers-color-scheme` fallback, global `:focus-visible`, `.skip-link`, reduced-motion guard.
- `assets/aura-tokens.css` — re-points legacy chat tokens to `base.css` semantics (safe fallbacks only).
- `assets/main.css` — `#app` flex column, `.profile-link` shared style.

### Theme / PrimeVue setup (`main.js`)
- `definePreset(Aura, …)` overrides `primary` to the coral ramp, `surface` to cool-slate, `formField.borderRadius:14px`, `content.borderRadius:20px`, dark via `[data-theme="dark"]` selector (`main.js:19-94`).
- Registered PrimeVue components in use: `InputText` (Login, Onboarding), `SelectButton` (Onboarding), `Dialog` + `Button` (Session summary), `Toast` (App). **Everything else is hand-rolled native markup styled with the design tokens** — a deliberate "native-first, minimal PrimeVue" architecture (chat input was migrated off PrimeVue `Textarea` because Aura tokens bled through the wrapper).

### Typography (`base.css:35-37`)
- Display: **Bricolage Grotesque** (distinctive). Body: **Inter**. Mono: **IBM Plex Mono** (distinctive).

---

## Standards scoring legend

Each screen scored 1–5 per category. 5 = exemplary, 4 = solid with nits, 3 = works but with a clear gap, 2 = notable violations, 1 = broken. Categories: **DS** (ui-refactor + frontend-design), **Nie** (Nielsen), **WCAG** (2.2 AA), **Aura** (PrimeVue/Aura consistency), **Resp** (375/1440).

Severity: **blocker** (unusable / fails for a class of users with no workaround) · **high** (real defect, common path) · **medium** (degraded experience or edge path) · **low** (polish / nit).

---

## Cross-cutting findings (apply to multiple screens)

### S1 — `--color-text-faint` fails AA as body/meta text — **high** — WCAG 1.4.3
`--color-text-faint: var(--ink-400)` = `#7E8AA3` (`base.css:100`). On the light page background it is **≈3.2:1**, below the 4.5:1 normal-text minimum. It is the default color for small secondary text used everywhere: sidebar row meta (`SidebarSessionRow.vue:303`), recent-card arrows/time (`HomeView.vue:561`, `:486`), event timestamps (`ProfileView.vue:431`), composer hint strip (`Composer.vue:381`), recap eyebrow (`CheckRecap.vue:81`), distribution counts (`AggregateProfileView.vue:424`). The brighter `--color-text-muted` (#58637A ≈5.5:1) passes; faint does not.

### S2 — Filled coral-500 + white text fails AA, and is inconsistent with the app's own `--color-accent-strong` convention — **high** — WCAG 1.4.3 + Nielsen #4 (consistency)
White on `--color-accent` (coral-500 #FF6B5C) is **≈2.8:1**. The codebase's documented pattern (`base.css:108-116`) is that filled white-text CTAs use `--color-accent-strong` (coral-700, ≈5.5:1). Two surfaces break that rule:
- `SessionsLibraryView.vue:390-394` — `.library-filter-btn.active { background: var(--color-accent); color:#fff }`.
- `CheckQuestion.vue:177-181` — `.check-next { background: var(--color-accent); color: var(--color-text-on-accent, #fff) }`. **`--color-text-on-accent` is never defined** in `base.css`, so it falls back to `#fff` on coral-500. The inline comment even flags the coral-on-coral risk but the chosen fallback still fails.

### S3 — `outline: none` on `:focus-visible` substituting only a transform/border tint — **medium** — WCAG 2.4.7 / 2.4.11
Several interactive elements remove the focus outline and rely on an insufficient cue. Worst cases:
- `Composer.vue:320-324` — `.composer-send:focus-visible` applies **only** `transform: translateY(-2px)` (a position change is not a perceivable focus indicator).
- `CheckQuestion.vue:130-134` — `.check-option:focus-visible` only swaps a 1px border to coral, outline removed.
- `chat/EmptyState.vue:136-143`, `NewSessionView.vue:283` quick-picks change background (acceptable). The global `:focus-visible` (`base.css:235`) is good — the problem is components overriding it away.

### S4 — Signal colors used as text on their own tint — **medium** — WCAG 1.4.3
Green `--signal-success` (#22C55E ≈2.3:1 on white) and red/amber used as foreground text on light tinted backgrounds:
- `SessionChips.vue:64-70` — mastered chip text+border green (see C-SC1).
- `UploadStatus.vue:37-45` — `ready` green text, `failed` red text.
- `LoginView.vue:203-207` — `.sent` confirmation green.
- `CapBanners.vue:53-56` — `strong` red (#EF4444 ≈3.7:1, sub-AA for 15px bold).
Dark theme brightens these and passes; light fails.

### S5 — Body font is Inter — **low** (portfolio-oriented) — frontend-design skill
`--font-sans: 'Inter'` (`base.css:36`). The `frontend-design` skill explicitly names Inter as a generic "AI-slop" font to avoid. The display (Bricolage Grotesque) and mono (IBM Plex Mono) choices are distinctive and good; the body face is the one default-feeling pick. Given the portfolio/LinkedIn goal, a more characterful text face would sharpen differentiation. Functionally fine — flagged for the secondary goal only.

---

## Per-screen findings

### LoginView (`views/LoginView.vue`)
- **LG1 — medium — WCAG 1.4.3:** `.sent` success line uses `--signal-success` green, ≈1.9–2.3:1 on the card (`LoginView.vue:203-207`). (instance of S4)
- **LG2 — low — A11y:** `Logo variant="mark-only"` (`:4`) is `aria-hidden`, so the logo has no accessible name; the `<h1>` "Welcome to AdaptLearn" covers it, so acceptable.
- **Good:** real `<label for>` + `InputText`, `autocomplete="email"`, client-side email validation gating submit (`:61-63`), disabled+"Sending…" state, post-send inbox confirmation. Strong status visibility.

### OnboardingView (`views/OnboardingView.vue`)
- **O1 — low — WCAG 2.4.7 `[uncertain]`:** `SelectButton` is heavily `:deep`-themed (`:218-245`) but no explicit `:focus-visible` is set on the toggle buttons; relies on PrimeVue's default focus ring surviving the override. Could not confirm the ring renders from CSS alone.
- **O2 — not a defect (labeled):** fields start `opacity:0` with a staggered `rise` animation (`:155-162`); the global reduced-motion guard (`base.css:291-300`) collapses the duration so content still resolves to `opacity:1`. OK.
- **Good:** logo `gentle-spin` respects reduced-motion; `:allow-empty="false"` prevents an empty selection; live help text per choice.

### HomeView (`views/HomeView.vue`)
- **H1 — high — WCAG 2.1.1 (keyboard):** the recent-activity row is a `div role="button" tabindex="0"` with `@click` + `@keydown.enter` but **no Space-key handler** (`HomeView.vue:65-71`). A native button activates on both Enter and Space; this one ignores Space.
- **H2 — medium — ARIA (nested interactive):** a real `<button class="recent-continue">` is nested inside that `div[role=button]` (`:81-90`). Interactive-inside-interactive is invalid and confuses AT.
- **H3 — low — semantics:** the whole-card click target would be better as a `RouterLink`/`<button>` than a `div[role=button]`, which would also fix H1 for free.
- **Inherits:** S1 (faint meta), S4 (green mastered chip via SessionChips).
- **Good:** clear editorial hierarchy (folio → display title → lede → cards), duplicate-session detection banner with cleanup (`:28-50`), empty state with CTA, hover lift micro-interactions.

### NewSessionView (`views/NewSessionView.vue`)
- **N1 — low — WCAG 1.4.3:** quick-pick hover sets text to `--color-accent` (coral-500) on `--color-accent-soft` (coral-100) ≈2:1 (`:276-281`); hover-only so low impact.
- **Good:** `sr-only` label on the topic input, Enter-to-submit, active-session-on-topic warning with "Open existing" (`:42-64`), submit disabled while duplicate-blocked, focus ring via box-shadow on the topic field.

### SessionView — chat (`views/SessionView.vue`)
- **SV1 — medium — Nielsen #4/visual order:** `<BackButton>` (`:18`) renders **below** the sticky `<SessionHeader>` h1 (`:16`), so the back affordance sits under the page title rather than above it. Minor order confusion.
- **SV2 — medium — WCAG 4.1.3 (status messages):** streamed assistant text in `MessageList` is not wrapped in an `aria-live` region (`MessageList.vue:13-45`); the typing indicator has an `aria-label` but new/streaming responses are not announced to screen readers.
- **Inherits:** S1, plus C-MD1 (inline-code contrast) inside tutor markdown.
- **Good:** error banner is `role="alert"` with Retry + collapsible technical details (`:46-66`); composer `aria-describedby` is wired to the active cap banner so SR users hear why input is disabled (`:197-202`); robust 404 / superseded-load handling; daily/cost cap banners + toasts.

### SessionsLibraryView (`views/SessionsLibraryView.vue`)
- **L1 — high — WCAG 1.4.3 + consistency:** active filter pill is coral-500 + white ≈2.8:1 (`:390-394`). (instance of S2)
- **L2 — high — WCAG 2.1.1 + ARIA:** library card is `role="button" tabindex="0"` with Enter-only, no Space (`:168-177`); nested `<button class="library-continue">` inside it (`:183-192`). Same defect class as H1/H2.
- **L3 — medium — DS consistency (ui-refactor):** this screen uses an **older px-based idiom** divergent from every other view: `max-width:880px` (others use rem like 72rem), px paddings (`24px 16px 64px`, `14px`, `12px`), px font sizes (`0.85rem`/`1.4rem`), and a bare `<h1 class="library-title">` at 1.4rem with **no folio eyebrow and no display-font treatment** (`:238-262`, `:113`, `:258-262`). It reads as a different, less-finished design language than Home/Profile/Settings.
- **L4 — medium — ARIA tabs:** filter uses `role="tablist"`/`role="tab"`/`aria-selected` (`:117-131`) without roving-tabindex arrow-key navigation or a connected `tabpanel` — an incomplete ARIA tabs contract. (Same Active/Ended concept is implemented differently in the Sidebar; see C-SB2.)
- **Good:** debounced search, status filter, sort, pagination with range label and disabled edge states.

### ProfileView — per-session (`views/ProfileView.vue`)
- **P1 — low — token consistency:** mixes hardcoded AA-safe hex (`#2E5DC4`, `#0E7A36`, `#8A5A00` at `:198`, `:337`, `:342`) with semantic tokens; values are AA-correct but bypass the token system (maintainability).
- **Good:** level pills have per-theme AA overrides (`:196-227`), mastered/gap chips, learning-event rows with correct/missed marks (icon + color + `aria-label`, not color-only), read-only by design (labeled v1 cut).

### AggregateProfileView (`views/AggregateProfileView.vue`)
- **P2 — low — WCAG 1.4.1:** the distribution bar segments are distinguished by **coral lightness only** (`seg-beginner` coral-200 → `advanced` coral-600, `:396-399`); mitigated by `role="img"` + full `aria-label` (`:69-73`) and a text legend with counts, so acceptable.
- **Inherits:** P1-style hardcoded hex.
- **Good:** colorful stat cards, `role="img"` distribution bar, chips linking to source sessions, clean responsive `auto-fit` grids.

### SettingsView (`views/SettingsView.vue`)
- **ST1 — high — WCAG 2.4.7:** the feedback radios use custom cards with the native input visually removed (`opacity:0;width:0;height:0`, `:364-369`) and **no focus-visible style** on `.radio-row` or `.radio-dot`. Keyboard focus on the radio group is invisible — a keyboard user cannot see which option is focused.
- **ST2 — medium — Nielsen #4 (consistency):** the same "feedback style" setting is a PrimeVue `SelectButton` in Onboarding (`OnboardingView.vue:26-33`) but custom radio cards here (`:37-59`). Two controls for one concept across the flow.
- **Good:** dark-mode `role="switch"` + `aria-checked` with a real focus ring (`:565-568`); Save disabled until dirty + saved-flash confirmation; danger zone visually separated (dashed error border); sign-out present.
- **Low (labeled):** the theme toggle only flips light↔dark — once toggled there is no UI path back to `auto` (`useTheme.js` supports `auto`, the toggle does not expose it).

---

## Per-component findings (shared)

### Composer (`components/chat/Composer.vue`)
- **C-CMP1 — medium — WCAG 2.4.7:** `.composer-send:focus-visible` = transform only (`:320-324`). (instance of S3)
- **Exemplary otherwise:** Enter-to-send / Shift+Enter newline (`:143-156`), `aria-describedby`, char count `aria-live` (`:85-87`), kbd hints with `aria-label`s, auto-resize, dedicated Stop button using `--signal-error`, ≥600px hint strip hidden on mobile. 40px → 36px buttons (AA-sized).

### CheckQuestion (`components/chat/CheckQuestion.vue`)
- **C-CQ1 — high — WCAG 1.4.3:** `.check-next` coral-500 + undefined-token #fff fallback (`:177-181`). (instance of S2)
- **C-CQ2 — medium — WCAG 2.4.7:** `.check-option:focus-visible` border-tint only, outline removed (`:130-134`). (instance of S3)
- **Good:** options are real `<button>`s, disabled after answer, verdict is text ("Correct"/"Not quite") + color (not color-only), batch progress indicator.

### SessionChips (`components/SessionChips.vue`)
- **C-SC1 — high — WCAG 1.4.3:** `.chip--mastered` sets text **and** border to raw `--signal-success` (#22C55E ≈2.3:1 on white card, `:64-70`). Unlike ProfileView/Aggregate, which darken to `#0E7A36` in light, this shared component never darkens — so it fails AA on **every** home card, library card, and sidebar rail row that shows a mastered chip. Visually confirmed pale in the light-theme render.
- **Good:** focus chip uses `--color-accent-text` (AA), `sr-only` prefixes for rail variant, ellipsis truncation.

### MarkdownContent + renderer (`components/chat/MarkdownContent.vue`, `lib/markdownRenderer.js`)
- **C-MD1 — medium — WCAG 1.4.3:** inline `code` uses `--color-accent-hover` (coral-600) on `--color-accent-soft` (coral-100) ≈3.3:1 (`MarkdownContent.vue:74-81`), sub-AA for normal text.
- **C-MD2 — low — security/privacy:** linkified links get no `rel="noopener"`; low risk because no `target="_blank"` is added.
- **Good (security):** `markdown-it` with `html:false`, output run through DOMPurify, KaTeX via the Microsoft fork that avoids the known `markdown-it-katex@2` XSS, lang attributes escaped. No XSS exposure on the `v-html` path.

### SidebarRowMenu (`components/sidebar/SidebarRowMenu.vue`)
- **C-RM1 — medium — responsive/discoverability:** the `⋯` trigger is `opacity:0` until `:hover`/`:focus-within` (`:156`; revealed on row hover by `SidebarSessionRow`). On touch (the mobile drawer) there is no hover, and a row tap navigates into the session — so Rename / Pin / End are effectively undiscoverable on mobile.
- **Good:** full ARIA menu (`aria-haspopup`, `aria-expanded`, `role="menu"`/`menuitem`), Escape-to-close, focus returned to trigger, outside-pointerdown close.

### Sidebar (`components/sidebar/Sidebar.vue`)
- **C-SB2 — medium — consistency:** the Active/Ended toggle uses `role="group"` + `aria-pressed` buttons (`:228-247`) — a valid toggle-group — but the *same* Active/Ended concept in SessionsLibraryView uses `role="tablist"`. Pick one pattern.
- **C-SB3 — low — WCAG 2.5.8:** collapse toggle is 28px (`1.75rem`, `:459-464`) and the row `⋯` trigger 28px — above the 24px AA minimum, below 44px.
- **Good:** mobile drawer focus trap + Escape + scroll lock + focus restore (`:42-87`), `aria-label`s, sticky layout, active-row scroll-into-view, localStorage-persisted collapse.

### SidebarSessionRow (`components/sidebar/SidebarSessionRow.vue`)
- **Model implementation:** real `<button>`, `aria-current="page"`, `aria-label`, `aria-describedby` → chips+meta, full rename keyboard support (Enter/Esc/blur) with focus management, collapsed-state tooltip. Inherits S1 (faint meta) + C-SC1 (green chip).

### Smaller components
- **CapBanners** (`:53-56`) — `role="alert"`; `strong` red ≈3.7:1 (sub-AA bold). **medium** (instance of S4). Good live-region semantics + `id`s for composer describedby.
- **UploadStatus** — `role="status"` + `aria-live="polite"`; ready/failed text use signal colors (S4). **medium**/good.
- **ToolCallChip** (`:42-44`) — raw px (`font-size:11px`, `border-radius:12px`) + hardcoded rgba fallbacks; minor token/scale drift. **low**.
- **SessionEndedBanner** — amber bg with `#2A1F00` dark text (good contrast), resume button, read-only messaging. **good**.
- **CitationsList** — tokenized, dashed separator, grouped by doc. **good**.
- **MessageList** — typing indicator + TransitionGroup; see SV2 (no live region). **good** otherwise.
- **BackButton** — history-state guard with fallback, `aria-label`, mono uppercase label at 11px (small but ≥24px target). **good**.
- **Logo / EmptyState** — clean, `aria-hidden` decorative SVGs, reduced-motion-aware bounce. **good**.

---

## Responsive (375 / 1440)

Reasoned primarily from CSS (`[uncertain]` for live 375 — harness did not reflow the captured viewport below 1280px).

- **1440px — verified live:** sidebar (16rem) + 72rem content column, comfortable gutters via `clamp()` page padding (`App.vue:98`). Cards, stat grids, two-col profile grids all read well. No issues.
- **375px — from CSS:** `useSidebar.js:3` breakpoint 1280 → below it the sidebar becomes a fixed off-canvas drawer (`Sidebar.vue:399-417`) and `SidebarMobileTopStrip` (hamburger + logo + profile) appears. Page padding `clamp()` floors at ~1rem. `auto-fit`/`auto-fill` grids (stats `minmax(11rem)`, two-col `minmax(18–20rem)`, library `minmax(260px)`) collapse to a single column at 375. Composer `@media ≤600px` shrinks buttons to 36px and hides the hint strip (`Composer.vue:446-454`). SessionHeader sits below the 3rem strip (`SessionHeader.vue:40-44`). Structurally sound.
- **R2 — low:** breakpoint 1280 is high — 1024–1279px tablets/small laptops get the mobile drawer rather than the rail. Reasonable, but worth a conscious decision.
- **R3 — see C-RM1:** the row action menu is hover-gated, so it is unreachable by touch — the main responsive *functionality* gap (not just layout).

---

## Score table — screens

| Screen | DS | Nie | WCAG | Aura | Resp | One-line justification |
|---|:--:|:--:|:--:|:--:|:--:|---|
| LoginView | 5 | 4 | 3 | 4 | 5 | Strong form UX; green `.sent` text sub-AA (`LoginView.vue:206`). |
| OnboardingView | 5 | 4 | 4 | 4 | 5 | Polished editorial; SelectButton focus ring unverified (`:218-245`). |
| HomeView | 5 | 4 | 2 | 4 | 5 | Excellent hierarchy; `div[role=button]` no Space + nested button (`:65-90`). |
| NewSessionView | 5 | 5 | 4 | 4 | 5 | Best-balanced screen; only hover-contrast nit (`:276-281`). |
| SessionView (chat) | 5 | 4 | 3 | 4 | 5 | Great error/cap UX; no live region for streamed text (`MessageList.vue`). |
| SessionsLibraryView | 2 | 4 | 2 | 3 | 4 | Off-system px idiom + no folio (`:238-262`); coral-500 active fail + Enter-only card. |
| ProfileView | 5 | 4 | 4 | 5 | 5 | Read-only (cut) but clean; hardcoded hex bypasses tokens. |
| AggregateProfileView | 5 | 4 | 4 | 5 | 5 | Strong dashboard; dist-bar color-only mitigated by `role=img`+legend. |
| SettingsView | 5 | 4 | 2 | 4 | 5 | Invisible keyboard focus on custom radios (`:364-369`); control inconsistency vs Onboarding. |

## Score table — shared components

| Component | DS | Nie | WCAG | Aura | Resp | One-line justification |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Composer | 5 | 5 | 4 | 4 | 5 | Exemplary input; send focus = transform only (`:320-324`). |
| CheckQuestion | 4 | 5 | 2 | 4 | 5 | Good interaction; coral-500 #fff `.check-next` fails AA (`:177-181`). |
| SessionChips | 4 | 4 | 2 | 5 | 5 | Green mastered chip ≈2.3:1 on every card (`:64-70`). |
| MarkdownContent | 5 | 5 | 4 | 5 | 5 | Secure pipeline; inline-code contrast ≈3.3:1 (`:74-81`). |
| SidebarRowMenu | 4 | 4 | 4 | 4 | 2 | Full ARIA menu; hover-gated trigger hidden on touch (`:156`). |
| Sidebar | 5 | 5 | 4 | 4 | 5 | Focus trap + scroll lock; toggle pattern differs from Library. |
| SidebarSessionRow | 5 | 5 | 4 | 5 | 5 | Model accessible row; inherits faint-meta + green-chip. |
| CapBanners / UploadStatus | 4 | 5 | 3 | 5 | 5 | Correct live regions; signal-color-as-text sub-AA in light. |
| ToolCallChip | 4 | 4 | 4 | 4 | 5 | Works; raw px sizing off the token scale (`:42-44`). |
| EmptyState / SessionEndedBanner / BackButton / Logo / Citations | 5 | 5 | 5 | 5 | 5 | Clean, accessible, on-system. |

---

## Deliberate v1 cuts (labeled as cuts, not defects)
- **ProfileView is read-only** — no in-place editing of the session profile. Intentional v1 scope.
- **No `aria-live` on streamed chat** — streaming itself works; the SR-announcement region is unbuilt. (SV2 still flagged because it is a low-cost a11y add, but the absence is a known scope edge, not a regression.)
- **Theme toggle exposes only light/dark, not `auto`** — `useTheme` supports `auto`; the Settings switch is binary by design.
- **375px responsiveness not e2e-tested** — verified by CSS structure, not an automated mobile render.

---

## Summary counts
- **Blocker:** 0
- **High:** 6 — S1 (faint text), S2 (coral-500 fill; surfaces L1 + C-CQ1), C-SC1 (green chip), H1 (Home Space-key), L2 (Library Space-key + nesting), ST1 (invisible radio focus).
- **Medium:** 11 — S3 (focus-outline removal; C-CMP1 + C-CQ2), S4 (signal-as-text; LG1 + CapBanners + UploadStatus), H2 (nested button), SV1 (back-button order), SV2 (no live region), L3 (off-system Library styling), L4 (incomplete tablist), ST2 (control inconsistency), C-MD1 (inline-code contrast), C-RM1 (hover-gated row menu on touch), C-SB2 (toggle pattern mismatch).
- **Low:** ~9 — S5 (Inter), H3, N1, P1, P2, C-MD2, C-SB3, ToolCallChip px, R2 (1280 breakpoint), theme `auto` unreachable.

**Lowest-scoring screens:** SessionsLibraryView (off-system styling + two high a11y fails), SettingsView (invisible radio focus), HomeView (keyboard activation). The chat surface, profiles, and most shared components are strong; the design system itself is cohesive and well-tokenized — most issues are **light-theme contrast** and a cluster of **keyboard/focus** gaps, both concentrated and fixable.
