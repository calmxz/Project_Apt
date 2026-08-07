# D — UI Correctness & Accessibility Audit (static source analysis)

**Date:** 2026-08-06
**Scope:** `frontend/src/views/*`, `frontend/src/components/*`, `frontend/src/theme/*`, `frontend/src/assets/*`, `frontend/src/App.vue`, `frontend/src/router/*`
**Method:** CODE-READ only. No browser, no dev server, no screenshots. Every finding cites a file:line read during this session. Contrast ratios are computed from the CSS custom properties in `frontend/src/assets/base.css` using the WCAG 2.x relative-luminance formula; alpha layers are composited against the stated surface before the ratio is taken.

**Excluded per brief (not re-reported):** `--color-accent-ring` focus-indicator contrast; `SessionView` `div.messages` missing `aria-live`/`role`; `SidebarRowMenu` ARIA; frontend security headers; CDN/font hosting.

**Counts:** 25 findings — 5 High · 15 Medium · 5 Low · 0 Critical

---

### D-01 — Check-question answer result is never announced and keyboard focus is destroyed
- Severity: High
- Category: Accessibility
- Page/Area: SessionView — check-question quiz loop
- Anchor: `frontend/src/components/chat/CheckQuestion.vue:41`, `:54`, `:57`, `:72`
- Evidence:
```
41:        <button type="button" class="check-option" :class="optionClass(i)"
46:          :disabled="answered"
47:          @click="emit('answer', i)"
54:    <div v-if="item.status === 'answered'" class="check-verdict" data-testid="check-verdict">
55:      {{ correct ? 'Correct' : 'Not quite' }}
57:    <p v-if="item.status === 'answered' && item.explanation" class="check-explanation">
72:    <button v-if="answered && !isLast" type="button" class="check-next"
```
- Steps to Reproduce: 1. Screen-reader user (NVDA/Firefox or VoiceOver/Safari) opens a session where the tutor has issued a check question. 2. Tabs to an option button and presses Enter. 3. Waits.
- Expected: The verdict ("Correct" / "Not quite") and the explanation are announced, and focus lands somewhere useful (the verdict, or the Next button).
- Actual: `answered` flips true, so every option button gets `:disabled` at line 46. The browser removes the currently focused element from the tab order, so `document.activeElement` falls back to `<body>`. `.check-verdict` (54) and `.check-explanation` (57) are inserted with no `aria-live`, no `role="status"`, and no focus move. Nothing is spoken. The user hears silence and has lost their place in the document — the newly rendered "Next"/"Done" button at line 72 must be found by tabbing from the top of the page.
- Impact: The check-question loop is the app's core adaptive-learning mechanic. A screen-reader user cannot tell whether they answered correctly, cannot read the explanation without hunting for it, and loses focus position on every question. Complete loss of a core workflow for that population.
- Fix: Wrap the verdict + explanation in a container with `role="status" aria-live="polite" aria-atomic="true"` that is present (empty) in the DOM before the answer, and on `answered` move focus to the Next/Done button via `nextTick`. Prefer `aria-disabled="true"` + a no-op click handler over `disabled` on the option buttons so focus is not destroyed.
- Confidence: CONFIRMED (code-read)

---

### D-02 — Auth and password-change error messages are not announced (no `role="alert"`)
- Severity: High
- Category: Accessibility
- Page/Area: Login, Register, Forgot password, Reset password, Settings → Account
- Anchor: `frontend/src/views/LoginView.vue:43` (also `RegisterView.vue:54`, `ForgotPasswordView.vue:25`, `ResetPasswordView.vue:40`, `components/settings/AccountTab.vue:87`)
- Evidence:
```
LoginView.vue:43           <p v-if="error" class="error" data-testid="login-error">{{ error }}</p>
RegisterView.vue:54        <p v-if="error" class="error" data-testid="register-error">{{ error }}</p>
ForgotPasswordView.vue:25  <p v-if="error" class="error" data-testid="forgot-error">{{ error }}</p>
ResetPasswordView.vue:40   <p v-if="error" class="error" data-testid="reset-error">{{ error }}</p>
AccountTab.vue:87          <p v-if="pwError" class="pw-error" data-testid="settings-pw-error">{{ pwError }}</p>
```
- Steps to Reproduce: 1. Screen-reader user opens `/login`. 2. Enters a wrong password and activates "Sign in". 3. Server returns 401; `error` is set.
- Expected: The failure reason is announced without the user having to go looking (WCAG 3.3.1 Error Identification, 4.1.3 Status Messages).
- Actual: A bare `<p>` is inserted above the submit button (line 43 sits before `.actions` at line 54). Focus remains on the submit button. No live region exists, so nothing is spoken. The button label reverting from "Signing in…" to "Sign in" is the only (visual) cue. The same pattern applies to the four other flows listed.
- Note: `OnboardingView.vue:51`, `ProfileView.vue:59`, `AccountTab.vue:39`, `DiagnosticConsentCard.vue:53` and `SessionView.vue:90` do use `role="alert"` — so this is an inconsistency, not a missing convention.
- Impact: A blind user cannot get past the login screen unaided. Sign-in is the gate to the entire product, so this is a total workflow loss for that population with no fallback path.
- Fix: Add `role="alert"` (or `role="status" aria-live="assertive"`) to each of the five error paragraphs, matching `OnboardingView.vue:51`.
- Confidence: CONFIRMED (code-read)

---

### D-03 — Closed mobile drawer keeps its entire contents in the tab order and the accessibility tree
- Severity: High
- Category: Accessibility
- Page/Area: App shell — sidebar on viewports below the desktop breakpoint
- Anchor: `frontend/src/components/sidebar/Sidebar.vue:552`-`570`
- Evidence:
```
552:.sidebar--drawer {
553:  position: fixed;
558:  transform: translateX(-100%);
...
567:/* Collapsed grid column when the drawer is closed on mobile. */
568:.sidebar--drawer:not(.sidebar--drawer-open) {
569:  pointer-events: none;
570:}
```
- Steps to Reproduce: 1. Narrow the viewport below the desktop breakpoint (e.g. 375px) so `isDesktop` is false; the drawer is closed. 2. Click into the address bar and press Tab repeatedly. Or 2'. Use VoiceOver rotor / NVDA browse mode and read from the top of the page.
- Expected: A visually hidden off-canvas drawer is removed from the tab order and the a11y tree until opened.
- Actual: `transform: translateX(-100%)` moves the `<aside>` off-screen and `pointer-events: none` blocks mouse hits, but neither removes descendants from sequential focus navigation or from the accessibility tree. There is no `inert`, no `visibility: hidden`, no `display: none`, no `aria-hidden`. Because `isExpanded` is false in this state (`Sidebar.vue:233`), the collapsed branch at `Sidebar.vue:498`-`507` still renders a `SidebarSessionRow` for every session, each containing a focusable `.sb-row-button` (`SidebarSessionRow.vue:149`). Add the "New session" button (`:304`) and the Settings link (`:511`) and a keyboard user tabs through roughly 17+ invisible controls — pressing Enter on any navigates to a session with no visible cause — before reaching page content. `pointer-events: none` makes it worse: the focused control is invisible and silently unclickable.
- Impact: Keyboard-only and screen-reader users on narrow viewports must traverse the entire hidden sidebar before every page, and can trigger unexplained navigations.
- Fix: Add `visibility: hidden` (with a `transitionend`-safe delay) or the `inert` attribute to `.sidebar--drawer:not(.sidebar--drawer-open)`. `inert` is cleanest — it removes the subtree from focus and the a11y tree in one attribute.
- Confidence: CONFIRMED (code-read)

---

### D-04 — "Existing session found" intercept appears with no announcement and no focus move
- Severity: High
- Category: Accessibility
- Page/Area: Home — start-a-session flow
- Anchor: `frontend/src/components/start/StartTopicIntercept.vue:19`-`24`; `frontend/src/views/HomeView.vue:46`; `frontend/src/composables/useStartFlow.js:27`
- Evidence:
```
StartTopicIntercept.vue:19  <div
20                            class="intercept"
21                            data-testid="start-intercept"
22                            role="region"
23                            aria-label="Existing session found"
24                          >
useStartFlow.js:27            stage.value = 'intercept'
```
- Steps to Reproduce: 1. Screen-reader user on Home types a topic they have studied before (e.g. "Recursion"). 2. Activates the "Start" button (`HomeView.vue:35`-`44`). 3. useStartFlow sets stage to 'intercept'; the intercept card mounts below the Start button.
- Expected: The user is told a matching session already exists and is given the Open / Continue / Start-fresh choice, with focus moved into the new decision point.
- Actual: `role="region"` creates a landmark but is not a live region — nothing is announced. `useStartFlow.js` contains no `focus()` call anywhere (grepped: only `stage.value` assignments at lines 27, 31, 84, 93). Focus stays on the Start button, whose label has reverted from "Starting..." to "Start". The user's model is "I pressed Start and nothing happened." Pressing Start again is a no-op (the `watch` at `HomeView.vue:94` only cancels on topic change), so the flow dead-ends.
- Impact: Start-a-session is the primary entry point to the product. For any returning user (i.e. any user with history), a screen-reader user is blocked at this gate with no error and no feedback.
- Fix: Give the intercept container `role="status" aria-live="polite"` (or full alertdialog treatment) plus a `nextTick` focus move onto the primary action button when stage becomes 'intercept'.
- Confidence: CONFIRMED (code-read)

---

### D-05 — `--color-text-faint` fails WCAG 1.4.3 on every dark-theme surface, including the composer placeholder
- Severity: High
- Category: Accessibility
- Page/Area: Global token; most visible in the chat composer, message role tags, sidebar counts
- Anchor: `frontend/src/assets/base.css:141` (and `:176`); consumers at `frontend/src/components/chat/Composer.vue:239`, `:342`, `:375`, `:391`; `frontend/src/components/chat/UserBubble.vue:40`; `frontend/src/components/chat/MessageList.vue:128`; `frontend/src/components/chat/CheckRecap.vue:81`; `frontend/src/components/sidebar/Sidebar.vue:721`
- Evidence:
```
base.css:141        --color-text-faint: #5b6480;      /* dark theme */
Composer.vue:238    .composer-input::placeholder {
Composer.vue:239      color: var(--color-text-faint);
Composer.vue:240      opacity: 1;
Composer.vue:391      color: var(--color-text-faint);   /* .composer-hints, 0.6875rem mono */
```
- Steps to Reproduce: 1. Set the app to dark mode (Settings -> Appearance, or OS dark with theme auto). 2. Open any session. 3. Look at the empty composer placeholder ("Ask anything. Press Enter to send..."), the "you"/"tutor" role tags above each message, and the keyboard-hint strip under the composer.
- Expected: at least 4.5:1 for normal-size text (all of these are 11-16px; none qualify as large text).
- Actual (computed, see table below): #5b6480 on --color-surface #161a2a = 2.95:1; on --color-background #0f1220 = 3.17:1; on --color-surface-soft #1e2236 = 2.68:1; on --color-surface-raised #262b43 = 2.37:1. All fail. The placeholder rule additionally sets `opacity: 1`, removing the browser's own placeholder dimming as a variable, so the computed value above is exactly what renders. The light theme passes (4.56-4.89:1), making this a dark-theme-only regression.
- Impact: The primary text input of the app has an unreadable placeholder in dark mode. Low-vision users cannot read the send/newline instructions or the character counter. Affects every dark-mode user on every session screen.
- Fix: Lighten the dark-theme `--color-text-faint`. #9099b0 is the smallest value that clears 4.5:1 on ALL four dark surfaces (bg 6.53, surface 6.06, soft 5.51, raised 4.88). Note the binding constraint is --color-surface-raised #262b43, not the darker surfaces: the obvious-looking #8089a3 reaches only 3.99:1 there and would still fail. Alternatively reserve --color-text-faint for decorative glyphs only and use --color-text-muted for real text.
- Confidence: CONFIRMED (code-read + computed)

---

### D-06 — A failed session-list load removes the entire start-a-session UI from Home
- Severity: Medium
- Category: UX
- Page/Area: Home
- Anchor: `frontend/src/views/HomeView.vue:5`-`10`, `:56`, `:104`
- Evidence:
```
 5:    <p v-if="store.loading && !store.sessions.length" class="muted">Loading...</p>
 6:    <p v-else-if="store.error && !store.sessions.length" class="error" data-testid="home-error">
 7:      {{ friendlyError(store.error) }}
 8:    </p>
 9:
10:    <template v-else>
...
56:    </template>
```
- Steps to Reproduce: 1. First-ever visit, or any visit where the session cache is empty. 2. `store.listSessions()` (mounted hook, line 104) fails — backend 500, cold start, flaky network. 3. Land on Home.
- Expected: The list of past sessions fails to load, with a retry; starting a new session — which does not depend on that list — still works.
- Actual: The `v-else-if` at line 6 short-circuits the `<template v-else>` at line 10, which wraps the entire quick-start block: the topic input (line 13), the quick-pick chips (23-33) and the Start CTA (35-44). Home renders as a heading plus one error sentence. There is no retry button and no other route to session creation (`/new` redirects to Home per `router/index.js:88`-`91`). The user is stranded until a full page reload happens to succeed.
- Impact: A transient read failure on an unrelated resource takes out the product's single entry point, with no in-app recovery action.
- Fix: Render the error as a banner above the quick-start block rather than instead of it (change line 10 to a plain `<template>` so the error paragraph coexists). Add a "Try again" button calling `store.listSessions()`.
- Confidence: CONFIRMED (code-read)

---

### D-07 — `aria-label` applied to elements whose role prohibits naming; the labels are silently dropped
- Severity: Medium
- Category: Accessibility
- Page/Area: Home quick-picks, chat typing indicator, composer keyboard hints
- Anchor: `frontend/src/views/HomeView.vue:23`; `frontend/src/components/chat/MessageList.vue:55`-`56`; `frontend/src/components/chat/Composer.vue:78`, `:80`, `:81`
- Evidence:
```
HomeView.vue:23      <div class="quick-picks" aria-label="Quick topic ideas">
MessageList.vue:55       <p class="content typing-dots" aria-label="Tutor is thinking">
MessageList.vue:56         <span></span><span></span><span></span>
Composer.vue:78        <kbd aria-label="Enter"><span aria-hidden="true">[glyph]</span></kbd> to send
Composer.vue:80        <kbd aria-label="Shift"><span aria-hidden="true">[glyph]</span></kbd
Composer.vue:81        >+<kbd aria-label="Enter"><span aria-hidden="true">[glyph]</span></kbd> newline
```
- Steps to Reproduce: 1. Screen-reader user navigates Home, then a live session. 2. Listens to the region between the topic input and the Start button; then to the composer hint strip; then to the indicator while the tutor is generating a reply.
- Expected: "Quick topic ideas, group"; "Enter to send, Shift plus Enter newline"; "Tutor is thinking".
- Actual: A plain div maps to role=generic and a p maps to role=paragraph; kbd has no ARIA role mapping and is also generic. ARIA 1.2 lists these roles as name-prohibited, so browsers do not expose aria-label on them. Results: (a) the six quick-pick buttons are announced as six bare topic names with no grouping context, so a user cannot tell they populate the input; (b) the composer hint reads as "to send + newline" because the only remaining content is aria-hidden; (c) the typing indicator contains three empty spans and its label is dropped, so it announces as nothing at all — total silence while the tutor generates.
- Impact: Three separate pieces of guidance/status are invisible to assistive tech despite the code appearing to handle them. Item (c) compounds with the already-filed transcript live-region gap: there is no "the tutor is working" signal at all.
- Fix: Move each label onto a role that supports naming — `role="group"` on the quick-picks div; a visually-hidden span alongside the aria-hidden dots for the typing indicator; and for kbd, drop aria-hidden on the glyph spans and add visually-hidden text ("Enter", "Shift") inside each kbd.
- Confidence: CONFIRMED (code-read)

---

### D-08 — Two nested `<main>` landmarks on the Sessions Library route
- Severity: Medium
- Category: Accessibility
- Page/Area: /sessions
- Anchor: `frontend/src/views/SessionsLibraryView.vue:181` rendered inside `frontend/src/App.vue:61`
- Evidence:
```
App.vue:61                    <main id="main-content" class="page" tabindex="-1">
App.vue:63                      <RouterView v-slot="{ Component }">
SessionsLibraryView.vue:181   <main class="library">
```
- Steps to Reproduce: 1. Confirm the sessions-library route has no `meta.sidebar: false` (`router/index.js:97`-`101`), so `showShell` is true and the view renders inside App's main. 2. Navigate to /sessions. 3. Use a screen reader's landmark list (NVDA D key, VoiceOver rotor -> Landmarks).
- Expected: Exactly one main landmark per page. HTML allows multiple `<main>` elements only if all but one are hidden; nesting is invalid.
- Actual: Two main landmarks, one nested inside the other. Landmark navigation offers "main" twice; jumping to the first lands on the shell wrapper, jumping to the second lands mid-page. HTML validators flag this, and it makes the skip-link target (#main-content) ambiguous.
- Impact: Degraded landmark navigation on a reachable route; invalid HTML.
- Fix: Change `SessionsLibraryView.vue:181` to `<section class="library">`. No other view does this — HomeView, ReviewView, SettingsView, SessionView and ProfileView all correctly use `<section>`.
- Confidence: CONFIRMED (code-read)

---

### D-09 — Composer character counter is a live region that re-announces on every keystroke
- Severity: Medium
- Category: Accessibility
- Page/Area: SessionView — composer
- Anchor: `frontend/src/components/chat/Composer.vue:83`-`85` (with `:36`, `:116`)
- Evidence:
```
83:      <span v-if="modelValue.length" class="composer-count" aria-live="polite">
84:        {{ modelValue.length.toLocaleString() }} / {{ MAX_DRAFT_LEN.toLocaleString() }}
85:      </span>
```
- Steps to Reproduce: 1. Screen-reader user opens a session. 2. Types a normal message into the composer, e.g. 200 characters.
- Expected: The character count is available on demand, or announced only near the limit, and typing is not interrupted.
- Actual: Two compounding problems. (a) `aria-live="polite"` fires on every text-node mutation, and the `@input` handler (line 36) updates modelValue on every keystroke — so the region re-announces "1 / 4,000", "2 / 4,000", "3 / 4,000" continuously while the user types. Polite queuing does not eliminate this; it interleaves the counter with the user's own typing echo. (b) `v-if="modelValue.length"` means the element does not exist in the DOM until the first character is typed; live regions inserted at the same moment as their content are unreliably announced across AT, so the one announcement that would matter (approaching the limit) is the least dependable.
- Impact: Typing a message — done many times per session — becomes a stream of interruptions severe enough that many screen-reader users would abandon the app.
- Fix: Remove aria-live from the counter and render the element unconditionally (v-show). Add a separate always-present `role="status"` region that only populates when `nearCharLimit` becomes true (the computed already exists at line 116), e.g. "200 characters remaining".
- Confidence: CONFIRMED (code-read)

---

### D-10 — `--color-accent-text` on `--color-accent-soft` is 4.26:1 in the light theme (fails 1.4.3)
- Severity: Medium
- Category: Accessibility
- Page/Area: Settings active tab, check-question eyebrow, inline code in chat
- Anchor: `frontend/src/views/SettingsView.vue:170`-`173`; `frontend/src/components/chat/CheckQuestion.vue:105`-`111`; `frontend/src/components/chat/MarkdownContent.vue:128`-`135`
- Evidence:
```
SettingsView.vue:170  .rail-tab--active {
171                     background: var(--color-accent-soft);
172                     color: var(--color-accent-text);
173                   }
MarkdownContent.vue:128  .md-rendered :deep(code:not(pre code)) {
129                        background: var(--color-accent-soft);
130                        color: var(--color-accent-text);
134                        font-size: 0.9em;
```
- Steps to Reproduce: 1. Use the app in the light theme (default). 2. Open /settings/profile and look at the highlighted "Profile" tab (15px / 0.9375rem, weight 600). 3. Open a session where the tutor's answer contains inline code (about 13.5px). 4. Trigger a check question and read the "CHECK QUESTION" eyebrow (11px --fs-label, weight 600, uppercase, +0.14em tracking).
- Expected: at least 4.5:1 — none of these reach the 18.66px-bold / 24px large-text threshold, so the 3:1 allowance does not apply.
- Actual: --color-accent-text resolves to --accent-coral-700 #b5413a; --color-accent-soft resolves to --accent-coral-100 #ffd9d2. Computed ratio = 4.26:1. Fails at all three sizes; the 11px uppercase eyebrow is the worst case in practice. The dark theme passes (5.50:1 over the composited rgba(255,119,102,0.18) fill), so this is light-theme-only.
- Impact: The active-tab indicator in Settings, the label announcing that a graded question is being asked, and all inline code in tutor answers sit just below AA in the default theme.
- Fix: Darken to --accent-coral-800 #842922 for text on --color-accent-soft (about 7.9:1), or lighten light-theme --color-accent-soft to --accent-coral-50 #fff1ef (#b5413a on #fff1ef is about 5.2:1). The comment block at base.css:105-111 already reasons about accent-on-light pairings but does not cover accent-on-accent-soft.
- Confidence: CONFIRMED (code-read + computed)

---

### D-11 — Review page reports "Nothing due right now" when the API fails, and is blank while loading
- Severity: Medium
- Category: UX
- Page/Area: /review
- Anchor: `frontend/src/views/ReviewView.vue:28`-`31`, `:59`-`61`, `:70`-`75`
- Evidence:
```
28:    <p v-else-if="loaded" class="empty" data-testid="review-empty">
29:      Nothing due right now. Keep learning — concepts you master come back here for a check.
...
59: onMounted(() => {
60:   load(3, { silent: true })
61: })
...
70:   } catch {
71:     // The review page must never block; show the empty state on failure.
72:     queue.value = { items: [], total: 0 }
73:   } finally {
74:     loaded.value = true
75:   }
```
- Steps to Reproduce: 1. Backend /review/queue returns 500 (or the network drops). 2. Navigate to /review from the sidebar.
- Expected: An error state distinguishable from "you genuinely have nothing due", with a retry.
- Actual: The catch at line 70 discards the error, resets the queue to empty, and the finally block sets `loaded = true` — so the empty branch at line 28 renders. The `{ silent: true }` at line 60 additionally suppresses the global error toast (see App.vue:45-49). The user is confidently told they have nothing to review when the server actually failed. Separately, between mount and resolution there is no loading state at all: `v-if="queue.items.length"` is false and `v-else-if="loaded"` is false, so only the page header renders — a blank area with no explanation. There is no error branch anywhere in the template (lines 1-43).
- Impact: Spaced repetition silently appears to have no work queued; a user acting on that skips their review entirely. The stale-empty state is indistinguishable from the true-empty state, so the user has no reason to retry.
- Fix: Track the error in a ref and render a third branch ("Couldn't load your review queue" plus Retry). Add a skeleton or "Loading..." for the `!loaded` case. Reconsider `{ silent: true }` — with no inline error surface, silence means the failure is invisible in every channel.
- Confidence: CONFIRMED (code-read)

---

### D-12 — Gap-picker dialog has a fixed 24rem width and overflows the viewport at 320px
- Severity: Medium
- Category: UI
- Page/Area: SessionView — "Review my gaps" dialog
- Anchor: `frontend/src/components/GapPickerDialog.vue:6`
- Evidence:
```
2:  <Dialog
3:    :visible="visible"
4:    modal
5:    header="Which gap should we review?"
6:    :style="{ width: '24rem' }"
```
  PrimeVue's own base rule (node_modules/@primeuix/styles/dist/dialog/index.mjs) is `.p-dialog { max-height: 90%; ... }` plus `.p-dialog { margin: 1rem; }` — there is no max-width. `frontend/src/assets/dialogs.css` (read in full, 32 lines) also sets no width constraint.
- Steps to Reproduce: 1. Open an ended session that has confirmed gaps, on a 320px-wide viewport (iPhone SE, or 1280px at 400% zoom). 2. Activate "Review my gaps" (SessionEndedBanner.vue:10-20).
- Expected: The dialog fits within the viewport, per WCAG 1.4.10 Reflow.
- Actual: The inline style pins the dialog to 384px. With `margin: 1rem` the required width is 416px against a 320px viewport. The mask is `position: fixed; width: 100%` with `justify-content: center` (PrimeVue inlineStyles.mask), so an over-wide flex item overflows symmetrically — roughly 48px is pushed off each edge. Because the mask is fixed-position there is no horizontal scroll to recover it: the left edge of the dialog, and part of the header, are unreachable.
- Impact: The gap-review entry point is partially cut off and unusable at small widths and at high zoom. This is the only place fixed dialog sizing appears (grepped `:style=` across all .vue files — only this file sets a dialog width).
- Fix: `:style="{ width: '24rem', maxWidth: 'calc(100vw - 2rem)' }"`, or use PrimeVue's `:breakpoints="{ '480px': '92vw' }"`.
- Confidence: CONFIRMED (code-read)

---

### D-13 — Long unbreakable strings and wide markdown tables force horizontal scrolling in the transcript
- Severity: Medium
- Category: UI
- Page/Area: SessionView — message bubbles
- Anchor: `frontend/src/components/chat/UserBubble.vue:45`, `:68`-`69`; `frontend/src/components/chat/MarkdownContent.vue:142`-`149`
- Evidence:
```
UserBubble.vue:43  .content {
44                   margin: 0;
45                   white-space: pre-wrap;
...
68                 .msg.user .content {
69                   display: inline-block;
MarkdownContent.vue:142  .md-rendered :deep(table) {
143                        border-collapse: collapse;
144                        margin: 8px 0;
145                      }
```
- Steps to Reproduce: 1. In a session, paste a message containing a long unbroken token — a 250-character article URL, a DOI, a base64 blob, a long German compound noun — and send it. 2. Separately, ask the tutor for a comparison, which commonly returns a 4-5 column markdown table. 3. View both on a 320-375px viewport.
- Expected: Text wraps inside the bubble; wide tables get their own horizontal scroll container without the reading column scrolling (WCAG 1.4.10 Reflow).
- Actual: `overflow-wrap: anywhere` appears exactly once in the entire frontend (ProfileView.vue:824, for gap chips) — it is absent from both bubble content and rendered markdown. `white-space: pre-wrap` wraps at whitespace only, so an unbroken token establishes a min-content width larger than the 88% bubble cap; `display: inline-block` with no max-width lets it grow. `<pre>` is protected (MarkdownContent.vue:102 sets `overflow-x: auto`) but `<table>` at line 142 has no scroll wrapper. Because `.messages` sets `overflow-y: auto` (SessionView.vue:960), CSS computes its overflow-x to auto as well — so the failure mode is a horizontal scrollbar inside the transcript, with the offending row extending past the readable column, rather than a page-level break.
- Impact: Two-dimensional scrolling in the reading pane on narrow viewports and at high zoom; the user must scroll right to read a pasted link or a tutor-generated table, then back left for the next message.
- Fix: Add `overflow-wrap: anywhere` to UserBubble's `.content` and to `.md-rendered` in MarkdownContent. Wrap rendered tables in an overflow-x: auto container (in markdownRenderer.js, or `.md-rendered :deep(table) { display: block; max-width: 100%; overflow-x: auto; }`).
- Confidence: CONFIRMED (code-read)

---

### D-14 — Composer hints and the character counter vanish entirely below 600px
- Severity: Medium
- Category: UX
- Page/Area: SessionView — composer, mobile
- Anchor: `frontend/src/components/chat/Composer.vue:460`-`463` (with `:34`, `:113`, `:428`)
- Evidence:
```
113: const MAX_DRAFT_LEN = 4000
 34:        :maxlength="MAX_DRAFT_LEN"
460: @media (max-width: 600px) {
461:   .composer-hints {
462:     display: none;
463:   }
```
- Steps to Reproduce: 1. On a phone-width viewport (600px or less), open a session. 2. Paste a long passage — e.g. 5,000 characters of lecture notes the user wants explained.
- Expected: Some indication that input is capped at 4,000 characters, and that the paste was truncated.
- Actual: `.composer-hints` contains both the keyboard cheatsheet and the `.composer-count` element (lines 76-86), and the media query hides the whole strip. The native `maxlength="4000"` then truncates the paste silently — no counter, no warning, no `is-near-limit` styling (that class only ever affects `.composer-count`, line 428). The user sends a message whose last 1,000 characters were dropped without knowing.
- Impact: Silent data loss on the app's primary input, on the viewport class where long pastes are most likely to exceed the cap unnoticed.
- Fix: Keep `.composer-count` visible at mobile widths and hide only `.composer-hint` (the keyboard cheatsheet is genuinely irrelevant on touch). At minimum, toast when a paste is truncated.
- Confidence: CONFIRMED (code-read)

---

### D-15 — Route-change focus reset silently no-ops when entering or leaving chrome-less routes
- Severity: Medium
- Category: Accessibility
- Page/Area: Router — navigations involving /login, /register, /forgot, /reset-password, /tos, /privacy, /onboarding
- Anchor: `frontend/src/router/index.js:170`-`177`; `frontend/src/App.vue:56`, `:57`, `:61`, `:72`
- Evidence:
```
router/index.js:170  router.afterEach((to, from, failure) => {
171    // F-08: SPA route swaps leave keyboard/SR focus on a removed node. Reset
172    // to the main landmark on real navigations ...
174    if (failure || !from.name) return
176    document.getElementById('main-content')?.focus()
177  })
App.vue:56   <div v-if="showShell" class="shell">
App.vue:61     <main id="main-content" class="page" tabindex="-1">
App.vue:72   <RouterView v-else v-slot="{ Component }">
```
- Steps to Reproduce: 1. Screen-reader/keyboard user signs in from /login (a `sidebar: false` route, router/index.js:18) and is redirected to Home. 2. Or, from Home, is redirected to /onboarding (router/index.js:59, also `sidebar: false`).
- Expected: Focus resets to the top of the newly rendered page on every real navigation, per the F-08 intent.
- Actual: Two gaps, both from the optional-chaining at line 176 swallowing a null. (a) Leaving a shell route for a chrome-less one: `showShell` becomes false, the main element is unmounted, and the reset targets nothing. (b) Entering a shell route from a chrome-less one: afterEach fires synchronously on navigation confirmation, before Vue has rendered the shell, so #main-content does not yet exist. Both cases leave focus on the element the user just activated, which is then removed from the DOM — the exact failure F-08 was written to prevent. Chrome-less routes also have no main element at all (LoginView.vue:2 renders a bare section) and no skip link (App.vue:57 is inside `v-if="showShell"`).
- Impact: Sign-in and onboarding — the first two screens every new user meets — are precisely the navigations where focus reset fails.
- Fix: Give the chrome-less RouterView branch its own `<main id="main-content" tabindex="-1">` wrapper (and a skip link) in App.vue so the element always exists; and defer the focus call with nextTick() / requestAnimationFrame so it runs after render.
- Confidence: CONFIRMED (code-read)

---

### D-16 — Settings tabs point `aria-controls` at panels that do not exist
- Severity: Medium
- Category: Accessibility
- Page/Area: Settings — tab rail
- Anchor: `frontend/src/views/SettingsView.vue:21`, `:38`, `:9`-`11`
- Evidence:
```
15:        <button
16:          v-for="(t, i) in tabs"
...
21:          :aria-controls="`panel-${t.slug}`"
...
35:      <div
36:        class="panel"
37:        role="tabpanel"
38:        :id="`panel-${tab}`"
```
- Steps to Reproduce: 1. Open /settings/profile. 2. Inspect the four `role="tab"` buttons. 3. Screen-reader user tries to move from a non-active tab to its panel.
- Expected: Every aria-controls resolves to a real element (ARIA referential integrity), or the attribute is omitted for tabs whose panel is not rendered.
- Actual: Only one panel is rendered at a time, with id="panel-profile" (or whichever tab is active). The other three tabs carry aria-controls="panel-usage", "panel-account", "panel-appearance" pointing at IDs that are not in the document. Screen readers offering "move to controlled element" (JAWS) find nothing; automated checkers (axe aria-valid-attr-value) flag it. Related nit: `role="tablist"` is placed on a `<nav>` (lines 9-11), which overrides the navigation landmark — harmless but a misleading element choice.
- Impact: Broken ARIA relationships on a settings surface; fails automated a11y gates.
- Fix: Bind aria-controls only for the active tab, or render all four panels with `hidden` on the inactive ones (which also preserves the KeepAlive intent at line 42). Change the nav to a div.
- Confidence: CONFIRMED (code-read)

---

### D-17 — Interactive controls below 44x44px, and they shrink further on mobile
- Severity: Medium
- Category: Accessibility
- Page/Area: Composer buttons, sidebar collapse/close, session row menu, settings tabs
- Anchor: `frontend/src/components/chat/Composer.vue:276`-`277` and `:464`-`469`; `frontend/src/components/sidebar/Sidebar.vue:621`, `:290`-`300`; `frontend/src/components/sidebar/SidebarRowMenu.vue:156`-`157`; `frontend/src/views/SettingsView.vue:150`
- Evidence:
```
Composer.vue:276    width: 2.5rem;      /* 40px — attach / send / stop */
Composer.vue:277    height: 2.5rem;
Composer.vue:460  @media (max-width: 600px) {
Composer.vue:464    .composer-attach,
Composer.vue:465    .composer-send,
Composer.vue:466    .composer-stop {
Composer.vue:467      width: 2.25rem;   /* 36px */
Composer.vue:468      height: 2.25rem;
Sidebar.vue:621     height: 1.75rem;    /* 28px — .sb-toggle, incl. the drawer close X */
SidebarRowMenu.vue:156  width: 1.75rem;  /* 28px */
```
- Steps to Reproduce: 1. Use the app on a touch device at 600px or narrower. 2. Try to tap the send arrow, the paperclip, the drawer's close X, or a session row's overflow menu.
- Expected: at least 44x44px per WCAG 2.5.5 (AAA) and platform HIG guidance; at least 24x24 for WCAG 2.2 SC 2.5.8 (AA).
- Actual: The composer's three primary buttons are 40px on desktop and are explicitly reduced to 36px on the exact viewport where they are operated by finger (lines 464-469) — the wrong direction. `.sb-toggle` (Sidebar.vue:621) is 28x28 and serves as the mobile drawer's close X (Sidebar.vue:290-300). `.sb-row-menu-trigger` is 28x28. `.rail-tab` in Settings computes to about 42px tall (0.625rem padding plus 15px at normal line-height). All clear the 24px AA floor, so this is a 2.5.5 / usability finding rather than a hard AA failure — but the 28px close X sitting adjacent to the brand link, and the 36px send button, are realistic mis-tap sources.
- Impact: Mis-taps on send (focuses the textarea instead) and on the drawer close (hits the brand link, navigating home and losing drawer context). Affects motor-impaired users disproportionately.
- Fix: Remove the 600px shrink rule (lines 464-469), or grow to 2.75rem on touch. Add invisible hit-area padding to `.sb-toggle` and `.sb-row-menu-trigger` (position: relative plus an ::after inset of -8px) so the visual size stays compact while the target reaches 44px.
- Confidence: CONFIRMED (code-read)

---

### D-18 — Sidebar uses `100vh`, so the Settings link sits under mobile browser chrome
- Severity: Medium
- Category: UI
- Page/Area: App shell — sidebar footer rail
- Anchor: `frontend/src/components/sidebar/Sidebar.vue:531`, `:537`, `:510`-`522`, `:689`-`695`; contrast with `frontend/src/views/SessionView.vue:906`-`907`
- Evidence:
```
Sidebar.vue:529  display: flex;
Sidebar.vue:530  flex-direction: column;
Sidebar.vue:531  height: 100vh;
Sidebar.vue:537  overflow: hidden;
...
Sidebar.vue:510  <footer class="sb-rail" ...>   <!-- contains the only Settings entry point -->
SessionView.vue:906   height: 100vh;
SessionView.vue:907   height: 100dvh;   /* the dvh fallback this codebase already knows about */
```
- Steps to Reproduce: 1. Open the app in iOS Safari or Chrome Android with the URL bar expanded (the state on page load). 2. Open the mobile drawer. 3. Look for the Settings link at the bottom of the drawer.
- Expected: The full drawer, including its footer rail, is visible within the actual visible viewport.
- Actual: 100vh on mobile resolves to the largest viewport height (URL bar retracted). With the URL bar expanded, the bottom 60-100px of the fixed-position drawer is below the visible area. `overflow: hidden` on the aside (line 537) means it cannot be scrolled into view; the internal scroller is `.sb-list-wrap` (lines 689-695), which sits above the footer, so scrolling the list does not reveal it. Settings (Sidebar.vue:511-522) is the sole entry point to /settings in the shell. SessionView.vue:907 already applies the 100dvh fallback for exactly this reason, so the pattern is known here and simply was not applied.
- Impact: On a common mobile state, Settings — and therefore Account, Usage and the theme toggle — is unreachable until the user scrolls the page enough to retract the URL bar.
- Fix: Add `height: 100dvh;` immediately after line 531, mirroring SessionView.vue:906-907.
- Confidence: CONFIRMED (code-read)

---

### D-19 — Check-question correctness is conveyed by border colour alone, and those borders fail 3:1
- Severity: Medium
- Category: Accessibility
- Page/Area: SessionView — check-question options
- Anchor: `frontend/src/components/chat/CheckQuestion.vue:20`-`24`, `:147`-`153`, `:128`
- Evidence:
```
 20: function optionClass(i) {
 21:   if (item.value.status !== 'answered') return ''
 22:   if (i === item.value.correctIndex) return 'is-correct'
 23:   if (i === item.value.selectedIndex) return 'is-incorrect'
...
147: .check-option.is-correct {
148:   border-color: var(--signal-success, #2e7d32);
149:   background: color-mix(in srgb, var(--signal-success, #2e7d32) 14%, transparent);
151: .check-option.is-incorrect {
152:   border-color: var(--signal-warning, #b26a00);
```
- Steps to Reproduce: 1. Answer a check question incorrectly. 2. View with deuteranopia/protanopia simulation, or in the light theme at normal vision.
- Expected: Which option was correct is identifiable without relying on colour (WCAG 1.4.1), and any non-text state indicator reaches 3:1 against its surroundings (WCAG 1.4.11).
- Actual: The only per-option signal is border-color plus a 14%-alpha tint. No icon, no text, no ARIA state is added to the option buttons. `.check-verdict` (line 54) says "Correct"/"Not quite" but never identifies which option was right — so a user who cannot distinguish the green and amber borders cannot learn the answer. Computed against --color-surface #ffffff (the option background, line 128): --signal-success #22c55e = 2.28:1; --signal-warning #ffb020 = 1.83:1. Both fail the 3:1 non-text-contrast requirement, so even users with typical colour vision get a weak signal.
- Impact: Colour-blind users (about 8% of men) cannot extract the answer from a graded question — the pedagogical payload of the feature. Compounds with D-01.
- Fix: Add a text or icon marker to each option ("Correct answer" / "Your answer") as visible text, plus visually-hidden text on the option buttons after grading. Darken the state borders to --color-success-text #0e7a36 (5.45:1) and --color-warning-text #8a5a00 (5.93:1) in the light theme.
- Confidence: CONFIRMED (code-read + computed)

---

### D-20 — `--color-border` / `--color-border-strong` fail 3:1 as the composer's only visual boundary
- Severity: Medium
- Category: Accessibility
- Page/Area: SessionView composer; also `.check-option`, `.gap-option`, `.composer-skip`
- Anchor: `frontend/src/components/chat/Composer.vue:197`-`199`, `:207`, `:437`; `frontend/src/assets/base.css:99`-`100`, `:143`-`144`
- Evidence:
```
Composer.vue:191  .composer {
Composer.vue:197    background: var(--color-surface);
Composer.vue:198    border: 1px solid var(--color-border);
Composer.vue:199    border-radius: var(--radius-lg);
Composer.vue:207    border-color: var(--color-accent);   /* :focus-within */
base.css:99     --color-border: var(--ink-200);        /* #dde2ee light */
base.css:143    --color-border: #2a3050;               /* dark */
```
- Steps to Reproduce: 1. Open a session with an empty composer. 2. At the 3:1 threshold (or with a low-vision user), try to identify where the text-entry area begins and ends.
- Expected: The boundary of a text input must reach 3:1 against the adjacent background (WCAG 1.4.11 Non-text Contrast) when the border is the only thing identifying the control.
- Actual: The composer's only boundary cue is this 1px border plus --shadow-lift (a soft shadow, which does not count). Computed: light #dde2ee on #ffffff = 1.30:1, on --color-background #f5f7fc = 1.21:1. Dark #2a3050 on #161a2a = 1.35:1, on #0f1220 = 1.45:1. --color-border-strong is barely better: 1.84:1 light, 1.75:1 dark. `.composer:focus-within` swaps to --color-accent (line 207), only 2.80:1 light on white — still short. The same token is the sole boundary on `.check-option` (CheckQuestion.vue:129), `.gap-option` (GapPickerDialog.vue:59) and `.composer-skip` (Composer.vue:437). Background differentiation does not rescue it: --color-surface #ffffff vs --color-background #f5f7fc is only 1.07:1.
- Impact: Low-vision users cannot locate the text input or distinguish answer buttons from the card background.
- Fix: Introduce a --color-border-interactive at 3:1 or better for form controls and buttons (light #80889d = 3.54:1 on --color-surface #ffffff and 3.31:1 on --color-background #f5f7fc; dark #67718f = 3.57:1 on #161a2a, 3.84:1 on #0f1220, 3.24:1 on #1e2236 — each verified against the WORST surface it appears on, since #8b93a8 and #5b6480 clear 3:1 on only some surfaces) and use it on `.composer`, `.check-option`, `.gap-option`, `.composer-skip`. Leave --color-border for decorative dividers, where 1.4.11 does not apply.
- Confidence: CONFIRMED (code-read + computed)

---

### D-21 — Heading hierarchy: sidebar jumps to `h3`, and SessionView has no `h1` before a topic is set
- Severity: Low
- Category: Accessibility
- Page/Area: Sidebar section labels; SessionView header
- Anchor: `frontend/src/components/sidebar/Sidebar.vue:416`-`417`; `frontend/src/components/chat/SessionHeader.vue:9`-`10`; `frontend/src/views/SessionView.vue:6`; `frontend/src/views/HomeView.vue:3`
- Evidence:
```
Sidebar.vue:416   <h3 class="sb-section-label label">
Sidebar.vue:417     <i class="pi pi-bookmark-fill" aria-hidden="true" /> Pinned
SessionHeader.vue:9    <header v-if="topic" class="session-header" data-testid="session-header">
SessionHeader.vue:10     <h1 class="session-topic-wrap">
```
- Steps to Reproduce: 1. Screen-reader user opens Home with at least one pinned session and lists headings (NVDA H key, VoiceOver rotor). 2. Separately, open a brand-new session before the tutor has established a topic.
- Expected: No level skips (h1 then h2 then h3), and exactly one h1 per page.
- Actual: (a) The sidebar's "Pinned" label is an h3 while the page provides only an h1 (HomeView.vue:3) — there is no h2 anywhere in the shell, so the outline reads h1 then h3. (b) SessionHeader is gated on `v-if="topic"`. When topic is empty (a fresh session, or before session detail resolves), the whole header including the h1 is omitted, and SessionView's other h1 (SessionView.vue:6) only renders in the 404 branch. The page then has zero headings, so heading navigation offers nothing and the user has no announced page title.
- Impact: Degraded heading navigation. Item (b) also means the session's identity is not exposed as a heading during the initial-load window.
- Fix: Demote Sidebar.vue:416 (and the other sb-section-label occurrences) to h2. Render SessionHeader unconditionally with a fallback heading such as "New session" when topic is empty.
- Confidence: CONFIRMED (code-read)

---

### D-22 — Session topic link is visually indistinguishable from plain heading text
- Severity: Low
- Category: Accessibility
- Page/Area: SessionView — sticky header
- Anchor: `frontend/src/components/chat/SessionHeader.vue:43`-`68`, `:15`, `:20`
- Evidence:
```
43: .session-topic {
49:   color: var(--color-heading);
...
57: .session-topic-link {
58:   text-decoration: none;
...
64: .session-topic-link:hover {
65:   color: var(--color-accent-strong);
66:   text-decoration: underline;
```
- Steps to Reproduce: 1. Open a session on a touch device (no hover). 2. Look at the topic heading at the top of the screen.
- Expected: A link is identifiable without hovering.
- Actual: `.session-topic-link` inherits `color: var(--color-heading)` from `.session-topic` and explicitly removes the underline (line 58). It becomes an accent-coloured underlined link only on :hover, which never fires on touch. The only other cue is the title tooltip (line 15), also hover-only. The v-else non-link span at line 20 renders identically, so there is no distinguishing cue at rest at all.
- Impact: The session-profile view (/session/:id/profile) is effectively undiscoverable on mobile and for anyone who does not happen to mouse over the title.
- Fix: Give `.session-topic-link` a persistent cue — a subtle `text-decoration: underline` with `text-decoration-color: var(--color-border-strong)`, or a trailing chevron icon.
- Confidence: CONFIRMED (code-read)

---

### D-23 — "Follow system theme" becomes unreachable after the first manual toggle
- Severity: Low
- Category: UX
- Page/Area: Settings -> Appearance
- Anchor: `frontend/src/components/settings/AppearanceTab.vue:12`-`23`; `frontend/src/composables/useTheme.js:4`, `:11`-`13`, `:16`-`23`, `:65`-`67`
- Evidence:
```
useTheme.js:4    const VALID = ['light', 'dark', 'auto']
useTheme.js:65   function toggle() {
useTheme.js:66     setTheme(resolved.value === 'dark' ? 'light' : 'dark')
useTheme.js:67   }
AppearanceTab.vue:12  <button type="button" class="switch" role="switch" :aria-checked="isDark"
AppearanceTab.vue:20    @click="toggleTheme"
```
- Steps to Reproduce: 1. Fresh install — theme is 'auto' (useTheme.js:11-13), following the OS. 2. Toggle the Dark-mode switch once. 3. Change the OS appearance setting.
- Expected: A way to return to "follow system".
- Actual: toggle() only ever writes 'light' or 'dark', and that value is persisted to localStorage (useTheme.js:16-23). The Appearance tab exposes a single binary switch and no third option. 'auto' is supported throughout the composable and is the default, but there is no UI path back to it — the app permanently stops following the OS, per browser profile.
- Impact: A user who toggles once to preview dark mode is silently opted out of automatic day/night switching, with no discoverable way to restore it short of clearing site data.
- Fix: Replace the switch with a three-way segmented control (Light / Dark / System) calling setTheme(value). useTheme.js already exports setTheme and override, so no composable change is needed.
- Confidence: CONFIRMED (code-read)

---

### D-24 — `[data-theme='dark']`-scoped component overrides do not apply during the pre-hydration paint
- Severity: Low
- Category: UI
- Page/Area: Global — first paint for system-dark users
- Anchor: `frontend/src/composables/useTheme.js:25`-`33`, `:41`-`56`; `frontend/src/assets/base.css:167`-`200`; e.g. `frontend/src/views/ProfileView.vue:404`, `:413`, `:454`, `:486`
- Evidence:
```
useTheme.js:32     document.documentElement.setAttribute('data-theme', resolved)
useTheme.js:55     applyAttribute(resolved.value)      /* runs from init(), i.e. after JS boots */
base.css:167   @media (prefers-color-scheme: dark) {
base.css:168     :root:not([data-theme='light']) { ... }
ProfileView.vue:413  :root[data-theme='dark'] .level-pill[data-level='intermediate'] {
ProfileView.vue:414    background: rgba(255, 119, 102, 0.2);
```
- Steps to Reproduce: 1. OS set to dark, app theme 'auto' (the default). 2. Hard-reload /session/:id/profile on a slow connection or with JS execution delayed.
- Expected: A single consistent dark paint.
- Actual: base.css's prefers-color-scheme fallback (lines 167-200) correctly darkens the global tokens before JS runs, so the page background and body text are dark immediately. But every component-level dark override is written as `:root[data-theme='dark'] ...`, and that attribute is only stamped once init() executes. During the gap the page is dark while, for example, `.level-pill[data-level='intermediate']` still renders its light-theme --accent-coral-100 (#ffd9d2) pink fill (ProfileView.vue:408-412) and `.focus` still renders its light coral gradient (:447) — a flash of mismatched light-on-dark chips. The comment at useTheme.js:27-31 shows the always-pin behaviour was added deliberately for teleported PrimeVue overlays; it simply cannot cover the window before JS runs.
- Impact: Brief visual inconsistency on first paint for system-dark users. Purely cosmetic and self-correcting.
- Fix: Add a small blocking inline script in index.html that reads localStorage['crux:theme:v1'] plus matchMedia('(prefers-color-scheme: dark)') and sets data-theme on the html element before stylesheets apply. Alternatively pair each component override with a `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) ... }` block, matching what base.css already does.
- Confidence: PLAUSIBLE (code-read; the size of the flash window depends on bundle timing, which I did not measure)

---

### D-25 — Composer "Skip" and "Send" both claim `grid-column: 3`, adding a second grid row while a check is active
- Severity: Low
- Category: UI
- Page/Area: SessionView — composer while a check question is pending
- Anchor: `frontend/src/components/chat/Composer.vue:41`, `:52`, `:64`-`73`, `:192`-`194`, `:317`, `:350`, `:434`; `frontend/src/views/SessionView.vue:146`
- Evidence:
```
192:  display: grid;
193:  grid-template-columns: auto 1fr auto;
194:  align-items: end;
317:  grid-column: 3;      /* .composer-send */
350:  grid-column: 3;      /* .composer-stop */
434:  grid-column: 3;      /* .composer-skip */
```
- Steps to Reproduce: 1. Get the tutor to issue a check question so `store.checkLocked` is true and Composer receives `:locked="true"` (SessionView.vue:146). 2. Observe the composer.
- Expected: Skip sits alongside Send in the same row, or replaces it.
- Actual: Send (`v-if streamState === 'idle'`, line 41) or Stop (`v-else`, line 52) always renders, and Skip renders in addition when locked (line 65). Both carry an explicit `grid-column: 3` with no explicit row. CSS Grid sparse auto-placement puts the second one in row 2, column 3 — so the composer pill grows a second row, with the Skip button under Send and an empty gap to its left. `align-items: end` keeps the textarea in row 1, so the visible effect is extra vertical height plus a stray isolated button rather than a broken control.
- Impact: Cosmetic layout inflation on the check-question path. The Skip control still works.
- Fix: Give Skip and Send a shared cell explicitly (grid-row: 1 on all three, wrapped in a flex container in column 3), or render Skip instead of Send while locked.
- Corroboration: `frontend/src/__tests__/composerLock.test.js:6`-`8` mounts Composer with `{ modelValue: '', locked: true }` and default `streamState: 'idle'`, then asserts `[data-testid="composer-skip"]` exists. Since the Send button renders on `v-if streamState === 'idle'`, that test confirms Send and Skip are rendered simultaneously — the two-items-one-cell precondition holds. The test does not assert anything about layout.
- Confidence: PLAUSIBLE (both buttons confirmed to co-render via the test above; the resulting second grid row is inferred from CSS Grid sparse auto-placement, not observed in a browser)

---

## Computed contrast ratios

Foreground/background pairs computed from `frontend/src/assets/base.css` (light `:root`, lines 90-128; dark `:root[data-theme='dark']`, lines 130-165). Alpha fills are composited over the stated surface before the ratio is taken. Thresholds: 4.5:1 for normal text (WCAG 2.2 SC 1.4.3); 3:1 for UI component boundaries and state indicators (SC 1.4.11). None of the text sizes involved reach the large-text threshold (18.66px bold / 24px), so the 3:1 text allowance never applies. The background-pairing column names the surface the token is actually used on, verified by grepping each consumer.

| Foreground token | Value (light / dark) | Background pairing | Light | Dark | Verdict | SC |
|---|---|---|---|---|---|---|
| `--color-text` | `#141826` / `#eef0f6` | `--color-surface` / `--color-background` | 17.67 | 16.34 | PASS | 1.4.3 |
| `--color-text-muted` | `#58637a` / `#8b95ae` | `--color-background` | 5.63 | 6.21 | PASS | 1.4.3 |
| `--color-text-muted` | " | `--color-surface` | 6.03 | 5.77 | PASS | 1.4.3 |
| `--color-text-muted` | " | `--color-surface-soft` | 5.68 | 5.24 | PASS | 1.4.3 |
| `--color-text-muted` | " | `--color-surface-raised` | 6.03 | 4.64 | PASS (dark marginal) | 1.4.3 |
| **`--color-text-faint`** | `#66718a` / `#5b6480` | `--color-background` | 4.56 | **3.17** | **FAIL (dark)** — D-05 | 1.4.3 |
| **`--color-text-faint`** | " | `--color-surface` | 4.89 | **2.95** | **FAIL (dark)** — D-05 | 1.4.3 |
| **`--color-text-faint`** | " | `--color-surface-soft` | 4.61 | **2.68** | **FAIL (dark)** — D-05 | 1.4.3 |
| **`--color-text-faint`** | " | `--color-surface-raised` | 4.89 | **2.37** | **FAIL (dark)** — D-05 | 1.4.3 |
| **`--color-border`** | `#dde2ee` / `#2a3050` | `--color-surface` | **1.30** | **1.35** | **FAIL (both)** — D-20 | 1.4.11 |
| **`--color-border`** | " | `--color-background` | **1.21** | **1.45** | **FAIL (both)** — D-20 | 1.4.11 |
| **`--color-border`** | " | `--color-surface-soft` | n/a | **1.22** | **FAIL** — D-20 | 1.4.11 |
| **`--color-border-strong`** | `#b7bfd2` / `#3a4166` | `--color-surface` | **1.84** | **1.75** | **FAIL (both)** — D-20 | 1.4.11 |
| `--color-accent-text` | `#b5413a` / `#ff7766` | `--color-surface` | 5.55 | 6.65 | PASS | 1.4.3 |
| `--color-accent-text` | " | `--color-background` | 5.18 | 7.17 | PASS | 1.4.3 |
| `--color-accent-text` | " | `--color-surface-raised` | 5.55 | 5.36 | PASS | 1.4.3 |
| **`--color-accent-text`** | " | `--color-accent-soft` over `--color-background` | **4.26** | 5.50 | **FAIL (light)** — D-10 | 1.4.3 |
| **`--color-accent-text`** | " | `--color-accent-soft` over `--color-surface` | **4.26** | 5.00 | **FAIL (light)** — D-10 | 1.4.3 |
| **`--color-accent`** (as border) | `#ff6b5c` / (dark uses coral-400) | `--color-surface` | **2.80** | n/a | **FAIL (light)** — D-20 | 1.4.11 |
| **`--color-accent`** (as border) | `#ff6b5c` | `--color-background` | **2.61** | n/a | **FAIL (light)** — D-20 | 1.4.11 |
| `--color-text-on-accent` | `#ffffff` | `--color-accent-strong` `#b5413a` | 5.55 | 5.55 | PASS | 1.4.3 |
| `--color-success-text` | `#0e7a36` / `#34d77b` | `--color-surface` / `--color-background` | 5.45 | 9.89 | PASS | 1.4.3 |
| `--color-error-text` | `#b91c1c` / `#ff6b6b` | " | 6.47 | 6.71 | PASS | 1.4.3 |
| `--color-warning-text` | `#8a5a00` / `#ffc54d` | " | 5.93 | 11.83 | PASS | 1.4.3 |
| `--color-info-text` | `#2e5dc4` / `#7aa3f5` | " | 6.04 | 7.44 | PASS | 1.4.3 |
| **`--signal-success`** (state border) | `#22c55e` | `--color-surface` `#ffffff` | **2.28** | n/a | **FAIL (light)** — D-19 | 1.4.11 |
| **`--signal-warning`** (state border) | `#ffb020` | `--color-surface` `#ffffff` | **1.83** | n/a | **FAIL (light)** — D-19 | 1.4.11 |
| `--signal-error` (as border) | `#ef4444` | `--color-surface` `#ffffff` | 3.76 | n/a | PASS | 1.4.11 |
| `#2A1F00` (hardcoded) | `#2A1F00` | `--signal-warning` (SessionEndedBanner.vue:66, :101) | 8.87 | 10.31 | PASS | 1.4.3 |
| `--color-text-muted` | | warning banner `rgba(255,176,32,.12)` over bg | 5.24 | 4.92 | PASS | 1.4.3 |
| `--color-text-muted` | | error banner `rgba(239,68,68,.12)` over bg | 4.85 | 5.33 | PASS | 1.4.3 |

**Failures found:** `--color-text-faint` (dark, all four surfaces) -> D-05. `--color-accent-text` on `--color-accent-soft` (light) -> D-10. `--color-border` / `--color-border-strong` / `--color-accent` as interactive boundaries (both themes) -> D-20. `--signal-success` / `--signal-warning` as state borders (light) -> D-19.

**Passing by design:** every `--color-*-text` signal token clears AA in both themes — the reasoning block at `base.css:116`-`127` (which forbids using the raw `--signal-*` ramp as text) did its job. `--color-text-muted` clears AA on every surface in both themes; only `--color-text-faint` fails.

---

## Verified OK (checks the brief called out; no defect found)

Investigated and **not** findings. Recorded so the gates are closed rather than silently dropped.

1. **Narrow-viewport Settings tab rail** (the previously OWED, unverified gate). `SettingsView.vue:187`-`203`: at 48rem and below the grid collapses to `1fr` and `.rail` becomes `flex-direction: row; overflow-x: auto` with `flex-shrink: 0` tabs. Because a grid item with non-`visible` overflow gets an automatic minimum size of 0 (CSS Sizing 5.2), the rail scrolls horizontally instead of blowing out the grid track. At 320px the four tabs (roughly 440px total) scroll rather than overflow. **Passes.** Residual nit: no scroll affordance, so tabs 3-4 are not obviously discoverable at 320px — moved to Unanchored improvements.
2. **`prefers-reduced-motion`.** `base.css:312`-`321` applies a universal `*, *::before, *::after` reset with `!important` on `animation-duration`, `animation-iteration-count`, `transition-duration` and `scroll-behavior`. This covers every scoped component transition (route fade, message TransitionGroup, sidebar slide, typing dots, skeleton shimmer, `--motion-bounce` presses) because scoped styles cannot outrank an `!important` universal rule. **Passes.**
3. **Mobile drawer focus trap.** `Sidebar.vue:46`-`85`: Escape closes, Tab/Shift+Tab wrap at the boundaries, focus moves in on open, and `lastFocused` is restored on close, with listener cleanup in `onBeforeUnmount` (`:87`-`93`). Correct and complete — no permanent trap. (The separate defect is what happens when the drawer is *closed* — D-03.)
4. **Route-change focus reset exists.** `router/index.js:170`-`177` implements it (F-08). Only the chrome-less-route edge cases fail — D-15.
5. **Sidebar session-title overflow.** `SidebarSessionRow.vue:229`-`231` (`.sb-row-button { flex: 1; min-width: 0 }`), `:271`-`277` (`.sb-row-body { min-width: 0 }`) and `:279`-`288` (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) form a complete `min-width: 0` chain. A 200-character session title ellipsises correctly. Same for `SessionHeader.vue:38`-`55` and `SessionChips.vue:73`-`75`. **No classic flexbox overflow bug in these paths.**
6. **Row menu on touch.** `SidebarRowMenu.vue:179`-`186` has an explicit `@media (hover: none) { opacity: 1 }` escape for the `opacity: 0`-until-hover trigger, with a comment naming exactly this risk. **Passes.**
7. **Clickable non-buttons.** Swept all 49 `.vue` files for `<div|span|li|p|i|img|td|tr>` carrying `@click`. Three hits, all legitimate: `Sidebar.vue:250`-`254` (modal backdrop; Escape is also wired at `:47`), `SidebarRowMenu.vue:67` (`@click.stop` propagation guard, not a control), `MarkdownContent.vue:51` (event delegation for the generated code-copy `<button>`, which is a real button so keyboard activation bubbles normally). **No keyboard-inaccessible controls found.**
8. **Positive `tabindex`.** None anywhere. The only values in the codebase are `-1` (`App.vue:61`, `SettingsView.vue:23`) and `0` (`SettingsView.vue:23`, `:40`) — the correct roving-tabindex pattern.
9. **Skip-to-content link.** Present and correctly styled off-screen-until-focus (`App.vue:57`, `base.css:283`-`305`). Absent only on chrome-less routes, covered by D-15.
10. **Theme switch semantics.** `AppearanceTab.vue:12`-`23` uses `role="switch"` with `:aria-checked` and an `aria-label` on a real `<button>`. Correct. (The missing "System" option is D-23.)
11. **Icon-only buttons.** All icon-only controls carry `aria-label`: `Composer.vue:18`/`:46`/`:58`/`:69`, `Sidebar.vue:283`/`:294`/`:515`, `SidebarRowMenu.vue:74`, `StartTopicIntercept.vue:29`. Decorative `<i>` elements consistently carry `aria-hidden="true"`. **No unlabelled icon buttons found.**
12. **Form labels.** Every user-facing input has a real associated label, not just a placeholder: `HomeView.vue:12` (`<label for="home-topic" class="sr-only">`), `LoginView.vue:16`/`:30`, `Sidebar.vue:336` (`aria-label="Search sessions"`), `SidebarSessionRow.vue:166` (`aria-label="Rename session"`). The composer `<textarea>` (`Composer.vue:26`-`38`) is the one that relies on `placeholder` as its accessible-name fallback — acceptable per HTML-AAM but worth an explicit `aria-label`; noted under Unanchored improvements rather than filed, since a name is computed.
13. **Hardcoded colour literals.** Swept all `.vue` for `#hex` / `rgb()` / `white` / `black`. 55 hits, each traced to its enclosing selector. Every one is either (a) `#ffffff` on a `--color-accent-strong` / `--signal-error` fill where white is correct in both themes, (b) an alpha tint of a signal colour used as a background wash, which stays self-consistent across themes, or (c) already scoped inside `:root[data-theme='dark']`. The two that looked wrong on first pass — `SessionEndedBanner.vue:66`/`:101` (`#2A1F00`) and `ProfileView.vue:405` (`#7aa3f5`) — were traced and are correct (8.87:1 / 10.31:1 on the warning fill, and dark-scoped respectively). **No theme-broken literals found.** The one latent risk is that `ProfileView.vue` and `ProfileTab.vue` write dark overrides as `:root[data-theme='dark']` only — see D-24.
14. **`.messages` flex-height cascade.** `SessionView.vue:952`-`968` correctly sets `flex: 1 1 auto; min-height: 0; overflow-y: auto`, with the ancestor chain (`:909`-`919`, `:928`-`929`) also setting `min-height: 0`. The composer is not pushed off-screen by a long transcript. **Passes.**

---

## Unanchored improvements

Not filed as findings (no concrete failure scenario, or not verifiable without a browser):

- **Settings rail scroll affordance at 320px.** `SettingsView.vue:193`-`198` scrolls correctly but gives no visual hint that tabs 3-4 exist off-screen. An edge gradient or a visible thin scrollbar would help. No SC violation.
- **Composer textarea has no explicit `aria-label`.** `Composer.vue:26`-`38` relies on `placeholder` for its accessible name. Browsers do compute a name from it, but the name changes when `locked` flips (line 118-122) and disappears conceptually once text is entered. An explicit `aria-label="Message"` would be more robust.
- **Loading states are spelled three different ways.** A plain `<p>Loading...</p>` (`HomeView.vue:5`), dedicated skeleton components (`MessageListSkeleton`, `SidebarSkeletonList`), and nothing at all (`ReviewView`, filed as D-11). Worth unifying; only ReviewView's is a defect.
- **`useTheme.init()` is not idempotent.** `useTheme.js:41`-`56` adds a `matchMedia` listener on every call with no removal path. Harmless if called once; I did not trace `main.js` to confirm.
- **`--fs-label` is 0.6875rem (11px)** and is used for uppercase, letter-spaced text in at least eight components. Even where contrast passes, 11px uppercase with `+0.14em` tracking is at the edge of legibility. A bump to 0.75rem would cost little.
- **Duplicated `.sr-only` definitions.** `base.css:338`-`348` defines it globally, but `HomeView.vue:156`, `ProfileView.vue:871`, `SessionChips.vue:103`, `FeedbackStylePicker.vue:60`, `UsageTab.vue:79` and `ProfileTab.vue:647` each re-declare it locally. Maintenance only.
- **Border-radius scale drift.** `--radius-sm` is 8px, but several components hardcode `3px` (`MarkdownContent.vue:118`, `:132`) or `4px` (`Composer.vue:411`). Cosmetic.
- **Code-block copy button gives no confirmation.** `MarkdownContent.vue:114`-`127` styles a `.code-block-copy` button handled by delegation at `:51`. There is no visible or announced "Copied" feedback in the CSS; I did not read `markdownRenderer.js` closely enough to confirm whether the JS supplies one.
