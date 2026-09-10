# Frontend critique - 2026-09-10

Method: dual-agent (A: design review subagent · B: detector + overlay subagent). Orchestrator swept every route in Chrome (authed, dark + light) and Playwright (guest, desktop + 390px) before dispatch; A and B ran isolated and were merged afterwards. Impeccable `critique` command, Operate mode, target `frontend/src`.

**Score: 23/40 - Acceptable** (Nielsen band 20-27: significant improvements needed before users are happy). Priority issues: 0 P0, 6 P1, 5 P2. Fix plan: `docs/superpowers/plans/2026-09-10-frontend-critique-fixes.md` (execution on hold as of 2026-09-10).

Decisions taken 2026-09-10: mastered/gap overlap fixed on the backend (Issue #288, plan Task 2 withdrawn); doubled level question tracked as Issue #287 (backend prompt, paid smoke gate); "Draft - not legal advice" line to be removed (plan Task 6); `.impeccable/` gitignored.

## Coverage

| Route | Desktop dark | Desktop light | Mobile 390 | Notes |
|---|---|---|---|---|
| `/` home | yes | yes | source-only | Captured mid-load (bare "Loading...") and loaded |
| `/sessions` library | yes (+scrolled) | yes | source-only | "Loading more..." sentinel captured |
| `/review` | yes | yes | source-only | 20 due, 3 shown |
| `/session/:id` active | yes | yes | source-only | Basic algebra; KaTeX + level-pitch card |
| `/session/:id` ended | yes | - | source-only | Mitosis; read-only banner |
| `/session/:id/profile` | yes | - | source-only | Empty profile (new session) |
| `/settings/profile` | yes | yes | source-only | Aggregate stats + chips |
| `/settings/usage` | yes | - | source-only | |
| `/settings/account` | yes | - | source-only | |
| `/settings/appearance` | yes | yes | source-only | Toggle exercised via JS, restored to dark |
| `/tos`, `/privacy` | yes | - | source-only | |
| `/login` | - | yes (guest, Playwright) | yes | |
| `/register`, `/forgot`, `/reset-password` | - | yes (guest, Playwright) | - | `/reset-password` opened with no token |
| `/onboarding` | not visually verified | | | Router guard redirects both authed and guest users; reviewed from source |

Not exercised (each turn is a paid LLM call): check-question batch, check recap card, streaming state, file upload, cap banners, error toasts. Reviewed from source only.
Authed mobile: Chrome window is maximized and refused resize; all mobile findings on authed pages are source-only.
Ignore in every screenshot: floating pill bottom-center is the Vue devtools anchor (dev-only).

Screenshots: `C:\Users\EDWARD\AppData\Local\Temp\claude-chrome-screenshots-9ndjU2\` (temp, not committed).

## Design specificity verdict

**Authored at the shell, interchangeable inside.** The token system (`frontend/src/assets/base.css`) is a real decision: slate inks, coral ramp with AA-corrected `--color-accent-text`, Bricolage Grotesque / Inter / IBM Plex Mono, four-point star mark carried from favicon to auth pages to tutor avatar, eyebrow-folio pattern ("SPACED REPETITION / Review", "PREFERENCES / Settings", "LIBRARY / All sessions"). Nobody would mistake the login page or the home hero for a template.

The interior is category-interchangeable: chat is the standard left-avatar / right-accent-bubble layout, settings rail is stock, review list is three plain buttons, legal pages are unstyled markdown. The learning model that differentiates Crux (mastered vs gap, focus target, subtopic levels, streaks) is rendered as chips and numbers, never as a designed artifact.

**Deterministic scan** (static, `impeccable detect --json frontend/src`, exit 2): 13 warnings, 4 rules. Runtime overlay on 5 pages: 0 console errors, 0 unnamed controls. Details in "Detector evidence" below.

**Visual overlays** were injected in a separate `[Human]` tab by Assessment B and screenshotted; that tab has since been closed.

## Nielsen heuristics

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Three loading vocabularies: bare `Loading...` text (`HomeView.vue:5`, `SessionsLibraryView.vue:229`, `:288` "Loading more..."), skeletons in sidebar and ProfileTab. Home first paint shows text in main and skeletons in sidebar simultaneously. |
| 2 | Match system / real world | 2 | Ended banner prints `7/30/2026, 11:45 AM GMT+8` (`formatDate.js:1-10`) while every card uses relative time. Library previews show raw `$$x = \frac{...` LaTeX source (`utils/sessionCard.js:23`) and one preview is the literal "okay". "Events 66 / check-questions" is internal vocabulary. |
| 3 | User control and freedom | 2 | ToS/Privacy have no back link or chrome. `/reset-password` traps a tokenless visitor in a form that can only fail. "Retake onboarding" sits in a red "Danger zone" for a harmless pre-filled form. |
| 4 | Consistency and standards | 2 | Sidebar filter is Active/Ended; library adds All. Home CTA "Start", sidebar "New session", chat empty-state "begin". Card radius 20px vs consent card hardcoded 8px (`DiagnosticConsentCard.vue:56`). Pill radius `999px` and `9999px` both in use. |
| 5 | Error prevention | 3 | Disabled-until-valid auth CTAs, inline mismatch hints, busy guards. Loses a point: `/reset-password` renders the full form with no recovery token and only reveals "Link expired?" after a failed submit (`ResetPasswordView.vue:40-43`). |
| 6 | Recognition rather than recall | 2 | `/review` shows "streak 1" with no explanation. Session-profile level chips show no active state when level is null (`ProfileView.vue:32-40`). Sidebar Review badge is a bare "20". |
| 7 | Flexibility and efficiency | 3 | Composer keyboard hints, roving-tabindex settings rail, sidebar search + filter, row menu, quick-pick chips. No bulk end/archive for 33 active sessions; library sort lacks "needs review". |
| 8 | Aesthetic and minimalist design | 3 | Home and auth are disciplined. Points off: level question asked twice in one viewport (tutor prose + consent card), every library card wears "Active" when 33/34 are active, `×1` badge on all 24 profile chips. |
| 9 | Error recovery | 3 | `friendlyError()` on every surface, retry in session error banner, 404 state. Usage error is a flat "unavailable right now" with no retry. |
| 10 | Help and documentation | 1 | Zero in-product explanation of mastery model, streaks, focus target, or "Needs attention (31%)". Onboarding never says what a session is. ToS/Privacy render "Draft - not legal advice" to end users. |
| **Total** | | **23/40** | **Acceptable** |

## Cognitive load (8-item checklist: 4 fail, 1 partial = high)

| Check | Result | Evidence |
|---|---|---|
| Single focus | PASS home/auth, FAIL chat | Chat viewport offers composer, attach, 4 consent-card buttons, dismiss, sidebar CTA, and the tutor prose asks what the card asks. |
| Chunking / progressive disclosure | PASS | Review shows 3 then "View all 20"; sidebar caps at 20 then "View all 33". |
| Labels carry meaning without hover | FAIL | `×1` chips explain only via `title` (`ProfileTab.vue:98-104`); usage meter tiers only via `title` (`UsagePanel.vue:26-34`); "streak 1" unexplained. |
| No contradictions on one screen | FAIL | Usage: "No usage yet" above "Most expensive sessions" with costs (`UsagePanel.vue:8` vs `:41`, `top_sessions` block is outside the `v-else`). Profile: same concept in Mastered and Confirmed gaps (`ProfileTab.vue:85-130`, no reconciliation). |
| State visible, not inferred | FAIL | Level chips with no active state; "Save name" disabled with no explanation; 33 "Active" labels. |
| Consistent reading rhythm | PASS | Folio / title / lede on every authed page. |
| No raw system output leaks | FAIL | Raw LaTeX in previews; `GMT+8` timestamps; "Events" tile label. |
| Empty states teach | PARTIAL | Chat empty state has 3 quick prompts (good). Session profile empties: "Nothing recorded yet." / "None." / "No learning events logged yet." - three registers, none says how to populate. |

Decision points with more than 4 visible options: home (6 chips + Start + New session), chat with consent card open (7 controls), sidebar row menu (5), library controls (7), Profile "Needs attention" line (3 inline links + 24 chip links).

## Emotional journey

- **Peak:** first tutor reply. KaTeX renders cleanly, display math gets a coral rule, the answer is good. The product's moment lands.
- **End is a valley:** ended session greets the learner with an amber warning banner, a machine timestamp, and "Read-only." No summary of what was mastered. The `hasGaps` "Review my gaps" button exists (`SessionEndedBanner.vue:10-20`) but the frame is restriction, not completion.
- **Onboarding** never says what Crux will do; lede "we'll tune the tutor" over-promises for two fields.
- **First session** asks for a self-assessment twice before teaching anything.
- **Retake onboarding** uses red dashed border + warning icon + "Reset removes your local profile" for a RouterLink to `/onboarding?retake=1` (`AccountTab.vue:122-129`) that clears nothing. Fear is inverted: harmless action scares, real destructive actions (delete session) live in a quiet ellipsis menu.
- **Reset password with no token** pretends everything is fine, then fails on submit.
- Present reassurance: "Sessions on the server stay put", register-sent inbox copy, `role="status"` stream announcements, "Resuming..." label.

## What's working

1. **Real token system with contrast discipline.** `base.css:96-128` documents why each accent variant exists. Dark and light both resolve through `data-theme` including teleported PrimeVue overlays; light captures hold up.
2. **Defensive interaction engineering.** Busy guards, `_loadSeq` sequence discriminators, route-query sync, drawer `inert`, body scroll lock, skip link (`App.vue:61`), roving tabindex on the settings rail.
3. **Home hero and auth pages are calm and distinctive.** One question, one input, six chips, one button. Star mark + eyebrow + display face repeated with discipline.

## Priority issues

Severity per critique.md: P0 blocks task completion, P1 causes significant confusion, P2 annoyance with workaround, P3 polish.

1. **[P1] Usage tab contradicts itself.** "No usage yet - spend history appears once you start chatting" renders above "Most expensive sessions" with dollar amounts. Cause: `noSpend` (`UsagePanel.vue:67`) checks only daily/today; `top_sessions` block at `:41` is outside the `v-else`. Fix: fold `top_sessions.length === 0` into `noSpend`. Command: clarify.
2. **[P1] Mastered / gap aggregation shown without reconciliation.** Same concept ("covalent bonds", "General glycolysis processes", "covalent bond definition") in both columns of `/settings/profile`. `ProfileTab.vue:85-130` renders both lists as received. Fix (UI-side): compute the intersection, render once in a third "Conflicting" state linking both sessions. Decision owned by design doc: whether the backend should apply most-recent-event-wins instead. Command: distill.
3. **[P1] Ended session is a warning, not a completion.** Amber banner, `formatDate` machine timestamp, "Read-only." Fix: `formatRelative` (already in `utils/formatDate.js:31`), neutral surface tokens instead of hardcoded `rgba(255,176,32,...)` (`SessionEndedBanner.vue:52-53`), lead line "Session ended 6 weeks ago", keep resume buttons. Command: delight.
4. **[P1] Level question asked twice in one viewport.** Tutor prose asks "beginner, intermediate, or advanced?" while `DiagnosticConsentCard.vue:16-48` asks the same below it. Root cause is in `backend/agent/prompts.py` (prompt should not ask in prose when the card is injected); a frontend workaround that parses tutor prose is the wrong layer. Out of frontend scope: open a GitHub Issue; needs the paid smoke gate. Command: distill.
5. **[P1] Loading pattern is three different things.** Bare text at `HomeView.vue:5` and `SessionsLibraryView.vue:229,288`; skeletons elsewhere. Fix: card-shaped skeleton grid for the library, drop the home "Loading..." (home form has no data dependency). Command: polish.
6. **[P1] Muted token fails AA.** `--color-text-faint: #5b6480` on `#0f1220` = 3.17:1, measured at three sites: sidebar `(1)` count, composer hint row (11px), `TUTOR` role tag. Token defined at `base.css:141` and `:176` (dark + prefers-dark fallback); light value is inherited from `:root` and not measured. Fix: raise dark value to about `#7a84a3` (about 4.6:1) and add a vitest contrast assertion. Command: audit.
7. **[P2] Legal pages unstyled and trapped.** Zero heading spacing (global `* { margin: 0 }` at `base.css:203-208` beats the scoped `.legal` which cannot reach `v-html` children), no back link, no chrome. Fix: `:deep()` rhythm rules + `BackButton` in `TosView.vue` and `PrivacyView.vue`. Decision (launch/legal, WS-B): removing the "Draft - not legal advice" line. Command: typeset.
8. **[P2] "Danger zone" for a non-destructive action.** `AccountTab.vue:116-132` red dashed section for a link that opens a pre-filled form; copy "Reset removes your local profile" is stale. Fix: rename to "Tutor preferences", neutral card, link copy "Edit name and feedback style". Command: quieter.
9. **[P2] Library previews leak source.** Raw LaTeX and bare "okay" as card story (`utils/sessionCard.js:23-28`). Fix: strip `$...$` / `$$...$$` spans to "[formula]", fall back to `last_session_summary` when the preview is shorter than 12 chars. Command: clarify.
10. **[P2] Duplicate `<main>` landmark on `/sessions`.** `SessionsLibraryView.vue:181` renders `<main class="library">` inside `App.vue`'s `<main id="main-content">`. Fix: change to `<section>`; e2e uses testids not `main` selectors (verified by grep). Command: audit.
11. **[P2] `/reset-password` with no token renders the form.** Fix: detect missing recovery token on mount and show the "Link expired or invalid - request a new one" state up front (`ResetPasswordView.vue:40-43`). Command: harden.

## Persona red flags

**Alex (power user, 34 sessions):** "Active" pill on 33/34 cards is noise; no bulk end/archive; library sort has no "due for review"; `×1` on all 24 chips never earns its space.

**Jordan (first-timer):** onboarding never says what a session is; first reply asks for self-assessment twice and "Quiz me" is the first CTA; "Review 20" badge, "streak 1", "Needs attention (0%)" unexplained; empty session profile pre-shows "Add a concept / Add a gap" inputs before Jordan knows what a gap is.

**Sam (screen reader / keyboard):** duplicate `<main>` on `/sessions`; Review count is a bare "20" (needs sr-only "concepts due"); `--color-text-faint` at 3.17:1; level chips use `.active` class only, no `aria-pressed` (`ProfileView.vue:32-40`); `×1` link accessible name is "×1"; focus ring `rgba(255,143,124,0.35)` is weak on light paper; `.diag-dismiss` hit box 12x18.
**Retraction:** the orchestrator's initial `read_page` sweep reported unnamed controls (Review link, settings tabs, review cards, a sidebar button). Source (A) and runtime DOM audit (B: 0 unnamed buttons/links on 5 pages) both contradict this. Those were tooling artifacts. Do not re-report.

**Casey (mobile, source-only):** sidebar breakpoint is 1280px (`useSidebar.js:3`) so every tablet gets the drawer; mobile chrome is JS-driven (`SidebarMobileTopStrip.vue`) so "9 @media rules" understates coverage. Gaps: `DiagnosticConsentCard` 4-button row has no wrap rule at 390px; `ProfileView.vue:734-739` header actions stack right-aligned under a left-aligned title; legal pages get 2.5rem gutters on a 390px screen. Composer hints correctly hide below 600px (`Composer.vue:460`).

## Detector evidence (Assessment B)

Raw JSON: `C:\Users\EDWARD\AppData\Local\Temp\impeccable-detect.json`.

**Static scan, 13 warnings:**
- `overused-font` x4: `assets/fonts.css:19,30,41,52` (Inter). One decision, four `@font-face` weight blocks. Not actionable; Inter is a deliberate body face paired with a distinctive display face.
- `side-tab` x4: `MarkdownContent.vue:89` (neutral blockquote rule, false positive), `MarkdownContent.vue:138` (coral rule on KaTeX display blocks; A rated it a strength, detector flags it; keeping it in Operate mode), `ProfileView.vue:613,616` (success/warning left rules on profile columns; real, low priority).
- `layout-transition` x3: `RouteProgressBar.vue:34,37` (standard progress idiom, ignore), `Sidebar.vue:539` (`transition: width` on sidebar collapse; real layout cost, P3).
- `bounce-easing` x2: `base.css:81` `--motion-bounce` (real, applied to `.fade-enter-active` on every route transition and to stat cards), `EmptyState.vue:70` (matched on animation name, keyframes are linear translateY; false positive).

**Runtime overlay, 5 pages, 0 console errors.** Additional rule ids not emitted by static: `kicker-above-heading` (eyebrow pattern on /sessions, /review, /settings - intentional house style, keep), `gpt-thin-border-wide-shadow` (4 `.stat` cards on profile: 1px border + 36px blur; composer when disabled), `border-accent-on-rounded` (`kbd` keycaps in composer hint; keycap idiom, false positive), `pulsing-dot` (sidebar skeleton caught mid-load; transient), `ai-color-palette` (Vue devtools anchor; dev-only). Static never fired `side-tab` at runtime and runtime never fired static's rules; the two modes do not cross-validate.

**Mechanical checks (dark):**

| Page | Interactive | Unnamed | <24px | `<main>` | Skip link |
|---|---|---|---|---|---|
| `/` | 58 | 0 | 1 | 1 | yes |
| `/sessions` | 76 | 0 | 2 | 2 | yes |
| `/review` | 54 | 0 | 2 | 1 | yes |
| `/settings/profile` | 87 | 0 | 28 | 1 | yes |
| `/session/:id` | 60 | 0 | 2 | 1 | yes |

Small targets that are real: `a.library-back` 104x21, `button.review-more` 74x17, `button.diag-dismiss` 12x18. The 28 on profile are links inside padded chips (fine).
Token drift: 3 font families (consistent); 16 font sizes incl. em-derived 14.4/16.8/17.6 in chat markdown; radii `999px` and `9999px` both used as pill.
Contrast: `rgb(91,100,128)` on `rgb(15,18,32)` = 3.17:1 at `.sb-section-count`, `.composer-hint`, `.role-tag`. All other sidebar text 5.49-6.21:1. Settings-page canvas is transparent through `html/body/#app/.shell`, so those rows were computed against an assumed `#0f1220`.

## Minor observations

- `HomeView.vue:23` `aria-label` on a plain `<div>` with no role.
- `HomeView.vue:26-32` quick-pick chip fills the input but does not submit. Left as-is: one click starting a paid session is worse than the extra Start press.
- `DiagnosticConsentCard.vue:56` hardcoded `border-radius: 8px` instead of a token.
- `Composer.vue:388-389` hint row is 11px mono; `base.css:44` `--fs-label: 0.6875rem` (11px) for all eyebrows and settings labels. 12px floor.
- `ReviewView.vue:22-23` "streak {{ n }}" with no meaning; loaded state has no back link.
- `Sidebar.vue:318` Review link only renders when `reviewTotal > 0`; empty queue means `/review` is undiscoverable.
- `Sidebar.vue:440-449` inline empty hint vs shared `EmptyState` in library: two empty-state systems.
- `ProfileTab.vue:66-68` "Knowledge level distribution" is an h2 over one sentence; "16 unknown" is the largest bucket and unexplained. `:75-83` "Needs attention" percentages lack a denominator.
- `AccountTab.vue:13-17` display name `maxlength="40"` with no counter; placeholder equals default value "Learner". `:108-111` "Sign out" floats between cards with no section. `OnboardingView.vue:12-19` name field has no `maxlength` (inconsistent with 40).
- `AppearanceTab.vue` only offers dark/light; `useTheme.js` supports `auto` but once toggled the user can never return to system-follow.
- `RegisterView.vue:60-61` ToS/Privacy links `target="_blank"` without `rel="noopener"` (same-origin, low risk).
- `SessionChips.vue:20,30` uses HTML entity glyphs while everything else uses PrimeIcons.
- `MessageList.vue:45` and `AssistantBubble.vue:29` both define an avatar: two assistant-bubble implementations.
- Library card wraps previews in curly quotes even when the preview is tutor prose; attribution ambiguous.
- Sidebar rows truncate at about 20 chars with `aria-label` but no visible `title`.
- `ResetPasswordView.vue:88-90` pushes `/login?reset=1` after success; not verified that login reads the flag.
- `Sidebar.vue:539` sidebar width transition animates layout; `base.css:81` bounce curve on every route fade.
- Pill radius drift `999px` / `9999px`.

## Questions to consider

1. Why is the learning model a spreadsheet? Mastered/gaps/events/streaks are the differentiator and every one is a chip with a number. What if the session profile were the primary surface and chat the tool you open from it?
2. Why does an ended session read as a locked door instead of a diploma? What if the banner said what was learned?
3. Who is "Active" for? 33 of 34 sessions carry it. What does the sidebar look like if only exceptions (ended, focus set, due for review) get a mark?
4. Should quick-pick chips start a session directly? (Deliberately not planned: it turns one click into a paid call.)

## Excluded from findings

- Dark-mode switch not responding to extension-synthesized clicks: JS `.click()` toggled correctly both ways; app is fine, tooling artifact.
- Vue devtools floating anchor (dev-only).
- "Ended session title is plain text, active title is a link" (A's claim): `SessionView.vue:18` passes `:session-id="props.id"` on both paths; not reproduced in source. Dropped.
- "Sidebar filter flips to Ended when opening an ended session": the orchestrator had clicked the Ended tab itself to reach the ended session; no code in `Sidebar.vue` writes `statusFilter` outside the tab click. Dropped.
