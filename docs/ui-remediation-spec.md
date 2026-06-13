# AdaptLearn Frontend — UI/UX Remediation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this spec task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Date:** 2026-06-13
- **Companion to:** [`docs/ui-audit.md`](ui-audit.md) (2026-06-13 audit). Finding IDs below (S1, H1, C-SC1, …) refer to that document.
- **Supersedes:** the prior `docs/ui-remediation-spec.md` dated 2026-05-28 (retained in git history), which was the companion to the now-superseded 2026-05-28 audit and predates the sidebar redesign, `/sessions` library, card-differentiation, and MC check-questions.

**Goal:** Close the findings in the audit (0 blocker / 6 high / 11 medium / ~9 low) without regressing the dark theme, the markdown security pipeline, or the test suite.

**Architecture:** Token-first. Most contrast findings (S1, S2, S4, C-SC1, C-CQ1, L1, C-MD1, LG1, CapBanners, UploadStatus) share one root cause — a `--signal-*` or bright-`--color-accent` value used as foreground text where the app already has an AA-safe variant it neglected to use. Batch 1 adds the missing semantic tokens to `assets/base.css`; later batches are mechanical consumer swaps. The keyboard/focus cluster (S3, ST1, H1/H2/L2) is structural and isolated to the offending components. Each batch is independently shippable and testable.

**Tech Stack:** Vue 3 SFCs, scoped CSS over `base.css` design tokens, PrimeVue/Aura preset (`main.js`), Vitest + Vue Test Utils, Playwright e2e (not required for these fixes). Contrast verified with the WCAG relative-luminance formula and axe DevTools.

**Source-of-truth discipline:** the audit governs *what* is wrong; the design doc (`docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`) governs anything not covered here.

---

## Scope

**In scope:** all 6 high + 11 medium findings, plus the low findings that are cheap token/consistency wins (Batch 7). **Deferred** (need a product decision, not a fix): the S5 body-font question, the R2 breakpoint, and the labeled v1 cuts — see the end.

**Theme invariant (must hold after every batch):** the dark theme already passes AA on these surfaces (audit "Contrast note"). Every token change lands a **light-theme** value and either inherits or brightens for dark. After each batch, eyeball both themes; no dark-theme contrast may drop.

---

## New tokens (Batch 1) and their measured contrast

Ratios computed against the light surfaces where the failures live: page `--paper-100` `#F5F7FC` and card `--paper-50` `#FFFFFF`. AA normal-text minimum = 4.5:1. Formula: sRGB → linear → relative luminance → (L1+0.05)/(L2+0.05).

| Token | Light value | On `#F5F7FC` | On `#FFFFFF` | Replaces (current, failing) |
|---|---|---|---|---|
| `--color-text-faint` → `--ink-450` | `#66718A` | **4.56:1** ✓ | 4.90:1 ✓ | `--ink-400` `#7E8AA3` ≈3.2:1 ✗ |
| `--color-text-on-accent` (on `--color-accent-strong` `#B5413A`) | `#FFFFFF` | — | **5.55:1** ✓ | undefined token → `#fff` on coral-500 ≈2.8:1 ✗ |
| `--color-success-text` | `#0E7A36` | **5.08:1** ✓ | 5.45:1 ✓ | `--signal-success` `#22C55E` ≈2.3:1 ✗ |
| `--color-error-text` | `#B91C1C` | **6.03:1** ✓ | 6.40:1 ✓ | `--signal-error` `#EF4444` ≈3.7:1 ✗ |
| `--color-warning-text` | `#8A5A00` | **5.53:1** ✓ | 5.93:1 ✓ | `--signal-warning` used as text |

Dark values: `--color-text-on-accent` inherits `#FFFFFF` (filled buttons use `--color-accent-strong` = coral-700 in every theme); the three signal-text tokens brighten to the existing dark ramp (`#34D77B` / `#FF6B6B` / `#FFC54D`), which already clear AA on dark surfaces; `--color-text-faint` dark (`#5B6480`) is unchanged.

---

## Batch 1 — Token foundation (`assets/base.css`)

**Covers:** S1 (fully); creates the tokens Batch 2 consumes for S2, S4, C-SC1, C-CQ1, C-MD1, L1. No visible change except faint meta darkening slightly.

**Files:** Modify `frontend/src/assets/base.css` — light `:root` (~`7`, `100`, `118`); dark `:root[data-theme="dark"]` (~`148-151`); `@media (prefers-color-scheme: dark)` block (~`179-182`).

- [ ] **Step 1 — add the `--ink-450` ramp stop.** After `--ink-400: #7E8AA3;` (`base.css:7`):

```css
  --ink-400: #7E8AA3;
  --ink-450: #66718A;
  --ink-500: #58637A;
```

- [ ] **Step 2 — repoint light faint to the AA value** (`base.css:100`):

```css
  --color-text-faint: var(--ink-450);
```

- [ ] **Step 3 — add on-accent + signal-text tokens to light `:root`.** After `--color-stub-heading: var(--ink-700);` (`base.css:118`), before the closing `}`:

```css
  /* Foreground tokens that stay AA on LIGHT surfaces. Filled white-text CTAs use
     --color-accent-strong (coral-700); --color-text-on-accent is that white.
     Signal-as-text must use these darkened variants, NOT the raw --signal-* ramp
     (tuned for fills/borders/dark surfaces; fails as light-bg text). */
  --color-text-on-accent: #FFFFFF;
  --color-success-text: #0E7A36;
  --color-error-text:   #B91C1C;
  --color-warning-text: #8A5A00;
```

- [ ] **Step 4 — brighten signal-text for dark `:root[data-theme="dark"]`** (alongside the dark `--signal-*` overrides, after `base.css:150`, before the block's `}`):

```css
  /* Dark surfaces: the bright signal ramp already clears AA as text. */
  --color-success-text: #34D77B;
  --color-error-text:   #FF6B6B;
  --color-warning-text: #FFC54D;
```

- [ ] **Step 5 — mirror Step 4 into the `prefers-color-scheme: dark` fallback** (`:root:not([data-theme="light"])`, after `base.css:182`, before its `}`):

```css
  --color-success-text: #34D77B;
  --color-error-text:   #FF6B6B;
  --color-warning-text: #FFC54D;
```

(`--color-text-on-accent` and `--ink-450` inherit from `:root` into both dark contexts; no dark override needed.)

- [ ] **Step 6 — verify.** `cd frontend && npm run lint`. Load the app in light theme; axe DevTools shows no new contrast errors and faint meta (sidebar rows, home/library card time/arrows) reads as a deeper slate. Token-only — no unit test. Commit.

```bash
git add frontend/src/assets/base.css
git commit -m "feat(ui): add AA on-accent + signal-text tokens, darken faint meta (S1)"
```

---

## Batch 2 — Contrast consumers (swap raw signal/accent → new tokens)

**Covers:** S2 (→ L1, C-CQ1), S4 (→ C-SC1, LG1, CapBanners, UploadStatus), C-MD1, N1.

- [ ] **C-SC1 — `components/SessionChips.vue:64-70`.** `.chip--mastered` uses raw `--signal-success` for text+border (≈2.3:1 on every card). Replace:

```css
.chip--mastered {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--color-success-text);
  color: var(--color-success-text);
}
```

- [ ] **C-CQ1 — `components/chat/CheckQuestion.vue:175-187`.** `.check-next` fills bright `--color-accent` with an undefined-token white fallback. Switch the fill to the AA-strong ramp; the token from Batch 1 now backs the color:

```css
.check-next {
  align-self: flex-start;
  background: var(--color-accent-strong);
  color: var(--color-text-on-accent);
  border: 1px solid var(--color-accent-strong);
  border-radius: var(--radius-pill);
  padding: 0.4rem 1.1rem;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **L1 — `views/SessionsLibraryView.vue:390-394`.** Active filter pill is coral-500 + `#fff`. Replace:

```css
.library-filter-btn.active {
  background: var(--color-accent-strong);
  border-color: var(--color-accent-strong);
  color: var(--color-text-on-accent);
}
```

- [ ] **LG1 — `views/LoginView.vue:203-207`.** `.sent` confirmation uses `--signal-success`. Change its `color` to `var(--color-success-text)` (keep other properties).

- [ ] **CapBanners — `components/chat/CapBanners.vue:53-56`.** `strong` uses `--signal-error`/`#EF4444` (sub-AA bold). Change its `color` to `var(--color-error-text)`.

- [ ] **UploadStatus — `components/UploadStatus.vue:37-45`.** `ready` green text → `var(--color-success-text)`; `failed` red text → `var(--color-error-text)`.

- [ ] **C-MD1 — `components/chat/MarkdownContent.vue:74-81`.** Inline `code` is coral-600 on coral-100 (≈3.3:1). Change the code `color` to `var(--color-accent-text)` (coral-700, ≈5.2:1 as text); keep the soft background.

- [ ] **N1 (low, optional) — `views/NewSessionView.vue:276-281`.** Quick-pick hover text is coral-500 on coral-100 (≈2:1, hover-only). Change the hover `color` to `var(--color-accent-text)`.

- [ ] **Verify.** `cd frontend && npm run test:unit -- --run` (SessionChips / CheckQuestion / Library tests stay green). axe sweep of Home, `/sessions`, a chat with a check-question + inline code, Login, an upload — zero contrast errors in **light** theme. (jsdom can't compute color; contrast is verified manually.) Commit.

```bash
git add frontend/src/components/SessionChips.vue frontend/src/components/chat/CheckQuestion.vue \
        frontend/src/views/SessionsLibraryView.vue frontend/src/views/LoginView.vue \
        frontend/src/components/chat/CapBanners.vue frontend/src/components/UploadStatus.vue \
        frontend/src/components/chat/MarkdownContent.vue frontend/src/views/NewSessionView.vue
git commit -m "fix(a11y): use AA signal-text/on-accent tokens for light-theme contrast (S2/S4/C-MD1)"
```

---

## Batch 3 — Focus visibility (restore real focus indicators)

**Covers:** S3 (→ C-CMP1, C-CQ2), ST1, O1. The global `:focus-visible` (`base.css:235`) is correct; these components override it with `outline: none` plus an insufficient cue. Restore an outline while keeping each component's existing flourish.

- [ ] **C-CMP1 — `components/chat/Composer.vue:320-324`.** Send focus is `transform` only. Split focus from hover and add an outline:

```css
.composer-send:not(:disabled):hover,
.composer-send:not(:disabled):focus-visible {
  transform: translateY(-2px);
}
.composer-send:not(:disabled):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
```

- [ ] **C-CQ2 — `components/chat/CheckQuestion.vue:130-134` (+ `:156-161`, `:188-192`).** Options/skip/next carry `outline: none`. Split the combined hover/focus rule so focus keeps an outline:

```css
.check-option:not(:disabled):hover {
  border-color: var(--color-accent);
}
.check-option:not(:disabled):focus-visible {
  border-color: var(--color-accent);
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}
```

Apply the same to `.check-skip:focus-visible` and `.check-next:focus-visible`: drop `outline: none`, add `outline: 2px solid var(--color-accent-ring); outline-offset: 2px;` (keep their existing color/`filter` cues).

- [ ] **ST1 — `views/SettingsView.vue:364-369`.** The native radio is visually removed and nothing shows keyboard focus. After `.radio-row.selected` (`:359-362`):

```css
.radio-row:has(.radio-input:focus-visible) {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

`:has()` scopes the ring to keyboard focus (not mouse) and is supported in all evergreen targets. Non-`:has` fallback if needed: `.radio-input:focus-visible + .radio-dot { box-shadow: 0 0 0 3px var(--color-accent-ring); }`.

- [ ] **O1 (verify; may be no-op) — `views/OnboardingView.vue:218-245`.** Tab to the themed `SelectButton`; confirm a focus ring renders. If not, add `:deep(.p-togglebutton:focus-visible){ outline:2px solid var(--color-accent-ring); outline-offset:2px; }`.

- [ ] **Verify.** Manual keyboard sweep (outlines aren't easily unit-asserted): Tab the composer send, each check option/skip/next, the Settings radios — a visible ring on every one in both themes. `npm run test:unit -- --run` for regressions. Commit.

```bash
git add frontend/src/components/chat/Composer.vue frontend/src/components/chat/CheckQuestion.vue \
        frontend/src/views/SettingsView.vue frontend/src/views/OnboardingView.vue
git commit -m "fix(a11y): restore visible focus rings on send/check/radio controls (S3/ST1)"
```

---

## Batch 4 — Keyboard activation & valid semantics (card click targets)

**Covers:** H1, H2, H3, L2. HomeView recent cards and Library cards are both `role="button" tabindex="0"` with **Enter-only** activation (no Space) and a **nested `<button>`**. The audit's recommended fix (H3) resolves all of it: make the card a real `RouterLink` (links are correctly Enter-activated — Space is not expected of links, so the "no Space" finding dissolves) and **de-nest** the Continue button to a sibling. SessionChips renders inert `<span>`s in `card` variant, so a `RouterLink` wrapper introduces no nested links.

### Task 4a — HomeView recent card (`views/HomeView.vue:59-91` + script + CSS)

- [ ] **Step 1 — restructure the template.** Replace the `<li>…</li>` (`:59-91`) so the card is a `RouterLink` and Continue is a sibling:

```vue
<li
  v-for="s in sortedRecent"
  :key="s.id"
  class="recent-row"
  :data-testid="`home-recent-${s.id}`"
>
  <RouterLink class="recent-link" :to="{ name: 'session', params: { id: s.id } }">
    <span
      class="recent-dot"
      :class="{ 'recent-dot-active': !s.ended_at }"
      aria-hidden="true"
    />
    <div class="recent-body">
      <div class="recent-head">
        <span class="recent-topic">{{ s.topic || 'untitled' }}</span>
        <span class="recent-when">{{ formatRelative(s.created_at) }}</span>
      </div>
      <p
        class="recent-snippet"
        :class="{
          'recent-snippet-muted': !cardStory(s),
          'recent-snippet-quote': !s.ended_at && !!cardStory(s),
        }"
      >
        {{ cardStory(s) || 'No activity yet' }}
      </p>
      <!-- keep the existing SessionChips line that follows the snippet -->
    </div>
  </RouterLink>
  <button
    v-if="s.ended_at"
    type="button"
    class="recent-continue"
    :data-testid="`home-continue-${s.id}`"
    @click="continueSession(s.id)"
  >
    Continue
  </button>
</li>
```

The button no longer needs `@click.stop` / `@keydown.enter.stop` (it is no longer nested).

- [ ] **Step 2 — drop the now-unused `openSession` method** if nothing else references it (grep `openSession` in `HomeView.vue`; if only the removed handlers used it, delete it). Keep `continueSession`.

- [ ] **Step 3 — CSS: position the de-nested Continue.** Read the existing `.recent-row` / `.recent-head` / `.recent-continue` rules first, then make the row a positioning context and float the action where it sat before (top-right of the ended card):

```css
.recent-row {
  position: relative;
}
.recent-continue {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  /* keep existing button visual rules */
}
```

Compare to a pre-change screenshot; tune `top`/`right` so it doesn't overlap `.recent-when`.

- [ ] **Step 4 — test (`HomeView` spec).** Using the suite's RouterLink stub:

```js
it('renders each recent session as a router-link, not a role=button', () => {
  const wrapper = mountHome(/* with sessions */)
  const card = wrapper.find('[data-testid="home-recent-abc"] .recent-link')
  expect(card.element.tagName).toBe('A')
  expect(card.attributes('role')).toBeUndefined()
})

it('does not nest the Continue button inside the card link', () => {
  const wrapper = mountHome(/* with an ended session */)
  expect(wrapper.find('.recent-link button').exists()).toBe(false)
  expect(wrapper.find('[data-testid="home-continue-abc"]').exists()).toBe(true)
})
```

`npm run test:unit -- --run -t HomeView`. Manually: Tab to a card, Enter navigates; Tab to Continue, both Space and Enter activate it.

### Task 4b — Library card (`views/SessionsLibraryView.vue:167-193` + CSS)

- [ ] **Step 1 — apply the identical pattern.** Replace the `<li class="library-card" role="button" tabindex="0" @click @keydown.enter>` wrapper with a `RouterLink` and de-nest `.library-continue`:

```vue
<li
  v-for="s in items"
  :key="s.id"
  class="library-card"
  :data-testid="`library-card-${s.id}`"
>
  <RouterLink class="library-card-link" :to="{ name: 'session', params: { id: s.id } }">
    <div class="library-card-head">
      <span class="library-topic">{{ s.topic || 'Untitled' }}</span>
      <span class="library-status" :class="{ ended: !!s.ended_at }">
        {{ s.ended_at ? 'Ended' : 'Active' }}
      </span>
    </div>
    <!-- keep the existing .library-desc <p> and chips -->
  </RouterLink>
  <button
    v-if="s.ended_at"
    type="button"
    class="library-continue"
    :data-testid="`library-continue-${s.id}`"
    @click="continueSession(s.id)"
  >
    Continue
  </button>
</li>
```

- [ ] **Step 2 — CSS.** Add `.library-card { position: relative; }` and absolutely position `.library-continue` top-right (mirror 4a Step 3). Remove `open(s.id)` if now unused.

- [ ] **Step 3 — test + verify.** Mirror 4a's two tests against `library-card-*` / `library-continue-*`. `npm run test:unit -- --run -t SessionsLibrary`. Keyboard-verify. Commit both tasks:

```bash
git add frontend/src/views/HomeView.vue frontend/src/views/SessionsLibraryView.vue frontend/test/**
git commit -m "fix(a11y): cards are router-links with de-nested Continue (H1/H2/H3/L2)"
```

---

## Batch 5 — ARIA correctness & cross-screen consistency

**Covers:** L4, C-SB2, ST2, SV1, SV2, C-RM1.

- [ ] **L4 + C-SB2 — one status-toggle pattern.** The Library filter uses `role="tablist"`/`role="tab"`/`aria-selected` (`SessionsLibraryView.vue:117-131`) with no roving-tabindex or `tabpanel` — an incomplete tabs contract; the Sidebar implements the same Active/Ended concept as a valid `role="group"` + `aria-pressed` toggle group. Adopt the toggle-group pattern in the Library (the already-correct one). Edit `:117-131`:

```vue
<div class="library-filter" role="group" aria-label="Filter by status">
  <button
    v-for="opt in STATUSES"
    :key="opt.key"
    type="button"
    class="library-filter-btn"
    :class="{ active: status === opt.key }"
    :data-testid="`library-filter-${opt.key}`"
    :aria-pressed="status === opt.key"
    @click="setStatus(opt.key)"
  >
    {{ opt.label }}
  </button>
</div>
```

(Remove `role="tab"`/`aria-selected`; `.active` and `setStatus` unchanged.) Update any test asserting `aria-selected` to assert `aria-pressed`.

- [ ] **ST2 — unify the feedback-style control.** Onboarding uses a PrimeVue `SelectButton` (`OnboardingView.vue:26-33`); Settings uses custom radio cards (`SettingsView.vue:37-59`) for the same setting. The repo is native-first/minimal-PrimeVue and the (ST1-fixed) radio group is the more accessible. Extract `components/FeedbackStylePicker.vue` from the Settings radio-group markup+styles (props `modelValue`, `options`; emits `update:modelValue`) and use it in both views: replace Onboarding's `SelectButton` block and Settings' inline `<fieldset>` with `<FeedbackStylePicker v-model="…" :options="feedbackOptions" />`. Preserve Onboarding's "a choice is required" behavior (`:allow-empty="false"`) by defaulting the picker's initial value. Confirm both screens still persist the same values.

- [ ] **SV1 — back-button order (`views/SessionView.vue:16-18`).** `<BackButton>` (`:18`) renders below the sticky `<SessionHeader>` (`:16`). Move `<BackButton>` above `<SessionHeader>` so the back affordance precedes the title and is the first focusable element in the main region. Confirm the sticky header still sticks.

- [ ] **SV2 — announce streamed assistant text (`components/MessageList.vue:13-45`).** Streamed replies are not in a live region. Add `aria-live="polite"` and `aria-atomic="false"` to the message-list container so screen readers announce new turns. Keep `polite` (don't interrupt). Verify a new assistant turn is announced once, not re-read per token. (Audit labels this a known v1 cut; it is low-cost — include it.)

- [ ] **C-RM1 — reveal the row action menu on touch (`components/sidebar/SidebarRowMenu.vue:156` / the `SidebarSessionRow` hover-reveal rule).** The `⋯` trigger is `opacity:0` until hover/focus-within, so Rename/Pin/End are unreachable on touch (a row tap navigates). Keep it visible where hover is unavailable — add, against the existing `opacity:0` rule's selector:

```css
@media (hover: none) {
  /* the ⋯ trigger selector, e.g. .row-menu-trigger */
  opacity: 1;
}
```

Leave desktop hover-reveal intact. Verify in coarse-pointer emulation that the trigger shows and the menu opens.

- [ ] **Verify.** `npm run test:unit -- --run`. Manual axe + keyboard; screen-reader spot-check for SV2. Commit:

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/src/components/FeedbackStylePicker.vue \
        frontend/src/views/OnboardingView.vue frontend/src/views/SettingsView.vue \
        frontend/src/views/SessionView.vue frontend/src/components/chat/MessageList.vue \
        frontend/src/components/sidebar/SidebarRowMenu.vue frontend/test/**
git commit -m "fix(a11y): unify status toggle + feedback control; fix order/live-region/touch menu (L4/C-SB2/ST2/SV1/SV2/C-RM1)"
```

---

## Batch 6 — Design-system drift: SessionsLibraryView re-token (L3)

**Covers:** L3. The screen uses a px idiom (`max-width:880px`, px paddings/fonts) and a bare 1.4rem `<h1>` with no folio eyebrow or display-font treatment — a different, less-finished language than Home/Profile/Settings. Bring it onto the system.

**Files:** `frontend/src/views/SessionsLibraryView.vue` (template `:108-114`; styles `:237-262`, `:383-400`).

- [ ] **Step 1 — folio eyebrow + display title** in `.library-head` (`:108-114`), matching HomeView's pattern:

```vue
<header class="library-head">
  <RouterLink to="/" class="library-back" data-testid="library-back">
    <i class="pi pi-arrow-left" aria-hidden="true" />
    Back to home
  </RouterLink>
  <p class="library-folio">library</p>
  <h1 class="library-title">All sessions</h1>
</header>
```

- [ ] **Step 2 — re-token the styles** (`:237-262`):

```css
.library {
  max-width: 72rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4) var(--space-10);
}
.library-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
  font-size: var(--fs-caption);
  color: var(--color-text-muted);
  text-decoration: none;
}
.library-folio {
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 var(--space-1);
}
.library-title {
  font-family: var(--font-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--tracking-display);
  margin: 0 0 var(--space-5);
  color: var(--color-heading);
}
```

Sweep the rest of the `<style>` block for remaining raw px (`0.85rem`/`1.4rem`/`12px`/`14px`/grid `minmax(260px)`) and replace with the nearest token (`--fs-caption`, `--space-*`, `--radius-*`); keep grid `minmax` in rem (e.g. `minmax(16rem, 1fr)`) to match the other auto-fit grids.

- [ ] **Step 3 — test + verify.** Update any test asserting the old `.library-title` structure; assert `.library-folio` renders. `npm run test:unit -- --run -t SessionsLibrary`. Visually compare the header to Home/Profile in both themes. Commit.

```bash
git add frontend/src/views/SessionsLibraryView.vue frontend/test/**
git commit -m "refactor(ui): bring SessionsLibrary onto the rem/folio/display-font system (L3)"
```

---

## Batch 7 — Low-severity polish (optional; safe to defer)

Nits, not defects. Bundle or skip per budget. Each is a one-spot change.

- [ ] **P1/P2 — `views/ProfileView.vue` / `views/AggregateProfileView.vue`.** Hardcoded AA-safe hex (`#0E7A36`, `#8A5A00` at `ProfileView.vue:337,342`) bypass tokens. Where they equal the new tokens, swap: `#0E7A36` → `var(--color-success-text)`, `#8A5A00` → `var(--color-warning-text)`. Leave the blue level pill unless a `--color-info-text` token is added.
- [ ] **C-MD2 — `lib/markdownRenderer.js`.** Linkified links get no `rel`. Add `rel="noopener nofollow"` to generated anchors; keep DOMPurify permitting `rel`. (No behavior change to the `html:false` + DOMPurify security pipeline.)
- [ ] **ToolCallChip — `components/chat/ToolCallChip.vue:42-44`.** Raw `font-size:11px`/`border-radius:12px`/rgba → `var(--fs-label)` / `var(--radius-md)` / token colors.
- [ ] **C-SB3 — sizing.** Collapse toggle + row `⋯` are 28px (above the 24px AA floor). Optional bump toward 32-36px; not required for AA.
- [ ] **Theme `auto` — `useTheme.js` / `SettingsView`.** Toggle only flips light↔dark; `auto` is supported but unreachable. Optional 3-way control. Product decision — leave unless requested.
- [ ] **Verify + commit** any subset: `npm run test:unit -- --run`, axe spot-check.

---

## Deferred — needs a decision, not a fix (do NOT silently change)

- **S5 — body font is Inter.** The `frontend-design` skill flags Inter as generic; display (Bricolage Grotesque) and mono (IBM Plex Mono) are already distinctive. A body-face swap is a brand decision with load-cost and re-test footprint. **Surface to the user**; don't change unilaterally.
- **R2 — 1280px breakpoint.** Tablets/small laptops (1024-1279px) get the mobile drawer instead of the rail. Audit: "reasonable but worth a conscious decision." Leave; raise if a narrower rail breakpoint is wanted.
- **Labeled v1 cuts** (audit "Deliberate v1 cuts"): ProfileView read-only; 375px not e2e-tested. Out of remediation scope by design. (SV2 is the one cut promoted to a fix above because it is cheap.)

---

## Finding → Batch coverage matrix

| Finding | Sev | Batch | Finding | Sev | Batch |
|---|---|---|---|---|---|
| S1 faint text | high | 1 | SV1 back order | med | 5 |
| S2 coral-500 fill | high | 1→2 | SV2 no live region | med | 5 |
| C-SC1 green chip | high | 1→2 | L3 off-system library | med | 6 |
| H1 Home Space-key | high | 4a | L4 incomplete tablist | med | 5 |
| L2 Library Space + nest | high | 4b | ST2 control inconsistency | med | 5 |
| ST1 invisible radio focus | high | 3 | C-MD1 inline-code | med | 1→2 |
| S3 focus-outline removal | med | 3 | C-RM1 hover-gated menu | med | 5 |
| C-CMP1 send focus | med | 3 | C-SB2 toggle mismatch | med | 5 |
| C-CQ2 option focus | med | 3 | C-CQ1 coral-500 next | high(S2) | 1→2 |
| S4 signal-as-text | med | 1→2 | L1 active pill | high(S2) | 1→2 |
| LG1 .sent green | med | 1→2 | H2 nested button | med | 4a |
| CapBanners red | med | 1→2 | H3 div-as-button | low | 4a |
| UploadStatus signal | med | 1→2 | N1/P1/P2/C-MD2/ToolCallChip/C-SB3/theme-auto | low | 7 |
| O1 SelectButton ring | low | 3 | S5 Inter / R2 / v1 cuts | low | deferred |

**6/6 high, 11/11 medium covered.** Every high and medium finding maps to a batch.

---

## Global verification (before declaring done)

- [ ] `cd frontend && npm run test:unit -- --run` — full suite green (baseline ~458 FE tests).
- [ ] `cd frontend && npm run lint` — clean.
- [ ] **axe DevTools** in **light** theme across Login, Home, `/sessions`, New, a chat session (check-question + inline code + an upload), Settings, Profile, Aggregate, Onboarding — zero serious contrast/ARIA violations.
- [ ] **Keyboard sweep** (light + dark): every interactive control shows a visible focus ring; cards activate on Enter; de-nested Continue buttons activate on Enter **and** Space; radios show focus.
- [ ] **Dark-theme regression:** re-walk the same screens; no contrast or visual regression from the new tokens.
- [ ] Security pipeline untouched (no DOMPurify config change beyond the Batch 7 `rel` allow).

## Sequencing & dependencies

Batch 1 **must land first** (Batch 2 consumes its tokens). Batches 2-6 are independent and can be parallelized or ordered by severity. Recommended order: **1 → 3 → 4 → 2 → 5 → 6 → 7** (3 and 4 carry the remaining *high* findings — do them right after the token foundation).
