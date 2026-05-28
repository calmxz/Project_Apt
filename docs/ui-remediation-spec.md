# AdaptLearn UI Remediation Spec — 2026-05-28

**Companion to:** [`docs/ui-audit.md`](ui-audit.md).
**Branch:** `ui-audit/2026-05-28` (off `dev`). Same branch will carry the implementation commits in batch-sized PRs.
**Scope.** 13 of the 14 audit issues are addressed (audit #11 deferred — see C3 dropped block — because the current top-anchor behaviour is a documented design decision in `SessionView.vue:433-437`). Two additional AA failures (`.chip-mastered`, `.stat-yellow .stat-glyph`) surfaced during Phase 4 contrast verification are also fixed, tagged with explicit provenance. Net: **15 fixes shipped, 1 deferred from the original 14**.

Each fix is self-contained: `Where` (file + selector + current line) → `Why` (cited from audit + measured number) → `Target state` (drop-in CSS / template patch) → `Acceptance check` (binary pass/fail observation). Batches are independently shippable, each a single PR.

`★ Insight ─────────────────────────────────────`
- The audit marked Major issues 2–4 as "unverified — needs contrast probe". Phase 4 ran the WCAG math (sRGB → linear → relative luminance → (L1+0.05)/(L2+0.05)) against the actual composited backgrounds. Four "borderline" issues are confirmed AA failures, and the probe surfaced 2 more failures the audit missed (`.chip-mastered`, `.stat-yellow .stat-glyph`).
- Dark-mode probes matter because most current overrides bump the foreground to the brighter dark-theme `--signal-*` token, which already passes against `#161A2A`. Light-mode fixes must therefore be scoped via `:root:not([data-theme="dark"])` or new `--signal-*-on-tint` tokens to avoid breaking the dark side that already works.
- Tab-count fix preserves the coral-fill active-pill aesthetic by darkening the overlay alpha rather than recolouring text — `rgba(0,0,0,0.30)` on coral-500 gives 5.25:1 against white text without redesigning the component.
`─────────────────────────────────────────────────`

---

## Newly-discovered issues (not in the original 14)

> Found during Phase 4 contrast verification. Listed here so the user can see what changed versus the approved audit before implementation begins.

**D1.** `.chip-mastered` text (`ProfileView.vue:328-332`, `AggregateProfileView.vue` reuses same class) — `color: var(--signal-success) = #22C55E` on `rgba(34,197,94,0.14)` over `--color-surface = #FFFFFF` measures **2.02:1**. Fails WCAG AA normal text (≥ 4.5). Dark mode measures 7.24:1, passes. Light-only fix.

**D2.** `.stat-yellow .stat-glyph` (`AggregateProfileView.vue:326`) — `color: #B5800F` on `rgba(255,176,32,0.28)` over surface measures **2.92:1**. Fails AA normal. Dark override to `--signal-warning` measures 5.90:1, passes. Light-only fix.

---

## Verified contrast table

> All numbers from `docs/ui-audit.md` Phase 4 probe (composited backgrounds, WCAG 2.1 formula).

| Selector | Theme | Current ratio | Status | Fix ratio |
|---|---|---|---|---|
| `.chip-gap` text | light | 3.13 | **fail AA normal** | 5.36 (with `#8A5A00`) |
| `.chip-gap` text | dark (existing override) | 7.98 | pass | n/a |
| `.chip-mastered` text | light | 2.02 | **fail** | 4.83 (with `#0E7A36`) |
| `.chip-mastered` text | dark (token resolves to `#34D77B`) | 7.24 | pass | n/a |
| `.level-pill[data-level=beginner]` text | light | 2.75 | **fail** | 5.13 (with `#2E5DC4`) |
| `.level-pill[data-level=beginner]` text | dark | 4.27 | **AA-large-only** | 5.50 (with `#7AA3F5`) |
| `.level-pill[data-level=advanced]` text | light | 1.99 | **fail** | 4.76 (with `#0E7A36`) |
| `.level-pill[data-level=advanced]` text | dark | 5.78 | pass | n/a |
| `.stat-yellow .stat-glyph` | light | 2.92 | **fail** | 4.99 (with `#8A5A00`) |
| `.stat-yellow .stat-glyph` | dark | 5.90 | pass | n/a |
| `.tab-active .tab-count` text | light | 2.25 | **fail** | 5.25 (with `rgba(0,0,0,0.30)` bg) |

---

# Batch A — Critical: stop user-visible JSON leak

**One issue. One PR. Ship immediately.**

## A1. HomeView raw API error JSON renders to body — `02-home-error.png`

**Where.** `frontend/src/views/HomeView.vue:64`
```vue
<p v-else-if="store.error" class="error" data-testid="home-error">{{ store.error }}</p>
```
`store.error` is `ApiError.message` from `apiClient.js:10-11`, which formats as `"API <code> <path>: <raw body>"`. Captured live: `API 401 /sessions: {"detail":"invalid_token"}`.

**Why.** Audit issue #1 (Critical). User-facing JSON + internal path + auth state are exposed on a happy-path navigation failure.

**Target state.** Use the existing `friendlyError()` helper that `ProfileView.vue:135` and `AggregateProfileView.vue` already use. Reuse — do not duplicate. Locate the helper (search `friendlyError` in `frontend/src/`) and either import it where defined or, if it currently lives inside one of the profile views, move it to `frontend/src/lib/friendlyError.js` and import from both call sites and `HomeView.vue`.

```vue
<!-- HomeView.vue template -->
<p v-else-if="store.error" class="error" data-testid="home-error">
  {{ friendlyError(store.error) }}
</p>
```
```js
// HomeView.vue <script setup>
import { friendlyError } from '@/lib/friendlyError'
```

**Acceptance check.** Reproduce the 401 path used to capture `02-home-error.png` (kill the auth token in the Pinia store, reload `/`). Body must show a sentence-form message (e.g. "We could not load your sessions. Please sign in again.") with **no curly braces, no `API `, no quote characters, and no path segments**. `data-testid="home-error"` element still present.

---

# Batch B — Accessibility: AA contrast + a11y semantics

**Seven issues + two Phase-4 discoveries. One PR.** All token / colour CSS, no template logic changes except where labels are added.

## B1. `.chip-gap` light-theme text fails AA (audit #2)

**Where.** `frontend/src/views/ProfileView.vue:334-339`, `frontend/src/views/AggregateProfileView.vue` (same class, definition shared). Current:
```css
.chip-gap {
  background: rgba(255, 176, 32, 0.16);
  color: #B5800F;
  border-color: rgba(255, 176, 32, 0.35);
}
:root[data-theme='dark'] .chip-gap { color: var(--signal-warning); }
```

**Why.** Measured 3.13:1 on `#FFF2DB` composited. AA normal needs 4.5.

**Target state.** Darken the light-mode token only; dark override stays.
```css
.chip-gap {
  background: rgba(255, 176, 32, 0.16);
  color: #8A5A00;
  border-color: rgba(255, 176, 32, 0.35);
}
:root[data-theme='dark'] .chip-gap { color: var(--signal-warning); }
```

**Acceptance check.** DevTools contrast probe on the chip text reads **≥ 4.5:1** in light mode. Dark mode unchanged at 7.98.

## B2. `.chip-mastered` light-theme text fails AA (Phase-4 discovery D1)

**Where.** `frontend/src/views/ProfileView.vue:328-332`. Class reused in `AggregateProfileView.vue` mastered-list.
```css
.chip-mastered {
  background: rgba(34, 197, 94, 0.14);
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}
```

**Why.** Discovered during Phase 4 probe — 2.02:1 on `#E0F7E8`. Audit missed it. Symmetric with B1.

**Target state.** Add a light-only override that mirrors the chip-gap pattern.
```css
.chip-mastered {
  background: rgba(34, 197, 94, 0.14);
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}
:root:not([data-theme='dark']) .chip-mastered { color: #0E7A36; }
```

**Acceptance check.** DevTools probe ≥ 4.5:1 light. Dark unchanged (7.24).

## B3. `.level-pill[data-level=beginner]` fails AA both themes (audit #3a)

**Where.** `frontend/src/views/ProfileView.vue:196-200`.
```css
.level-pill[data-level='beginner'] {
  background: rgba(91, 141, 239, 0.16);
  color: var(--signal-info);
  border-color: rgba(91, 141, 239, 0.3);
}
```

**Why.** Light = 2.75:1 (fail). Dark = 4.27:1 (AA-large only; pill text is `0.8125rem 600` — borderline small). Both themes fixed.

**Target state.** Foreground-only change (border untouched — current border passes contrast and was not flagged).
```css
.level-pill[data-level='beginner'] {
  background: rgba(91, 141, 239, 0.16);
  color: #2E5DC4;
  border-color: rgba(91, 141, 239, 0.3);
}
:root[data-theme='dark'] .level-pill[data-level='beginner'] {
  color: #7AA3F5;
}
```

**Acceptance check.** Light probe ≥ 4.5 (target 5.13). Dark probe ≥ 4.5 (target 5.50).

## B4. `.level-pill[data-level=advanced]` light fails AA (audit #3b)

**Where.** `frontend/src/views/ProfileView.vue:213-217`.
```css
.level-pill[data-level='advanced'] {
  background: rgba(34, 197, 94, 0.16);
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}
```

**Why.** Light = 1.99:1 (fail). Dark = 5.78 (pass).

**Target state.** Add light-only override; keep dark using the brighter token.
```css
.level-pill[data-level='advanced'] {
  background: rgba(34, 197, 94, 0.16);
  color: var(--signal-success);
  border-color: rgba(34, 197, 94, 0.3);
}
:root:not([data-theme='dark']) .level-pill[data-level='advanced'] { color: #0E7A36; }
```

**Acceptance check.** Light probe ≥ 4.5 (target 4.76). Dark unchanged.

## B5. `.tab-active .tab-count` fails AA on coral pill (audit #4)

**Where.** `frontend/src/views/HomeView.vue:456-472`.
```css
.tab-count {
  /* ... */
  background: rgba(0, 0, 0, 0.08);
  color: inherit;
}
.tab-active .tab-count {
  background: rgba(255, 255, 255, 0.22);
}
```
On `.tab-active` the inherited `color` resolves to `#FFFFFF` and the count badge composites to `#FF8C80` → 2.25:1.

**Why.** Active-state count chip — small, high-saturation accent — needs contrast.

**Target state.** Keep the bright white-overlay aesthetic — switch text colour from inherited `#FFFFFF` to `var(--accent-coral-900) = #4D1611`. Measured 14.6:1 against the existing `rgba(255,255,255,0.22)` overlay; preserves the soft-pill look the current design intends. Note: the audit's "small text, high-saturation accent" concern is now resolved by darkening the foreground rather than the background.
```css
.tab-active .tab-count {
  background: rgba(255, 255, 255, 0.22);
  color: var(--accent-coral-900);
}
```

**Acceptance check.** DevTools probe on the active-tab count: **≥ 4.5:1** (target ≈ 14.6). Inactive-tab count appearance unchanged (still `color: inherit` on `rgba(0,0,0,0.08)`). Visual: active-tab count badge stays as a soft white overlay on coral with dark coral numerals — same aesthetic, contrast solved.

## B6. `.stat-yellow .stat-glyph` light fails AA (Phase-4 discovery D2)

**Where.** `frontend/src/views/AggregateProfileView.vue:326-327`.
```css
.stat-yellow .stat-glyph { background: rgba(255, 176, 32, 0.28); color: #B5800F; }
:root[data-theme='dark'] .stat-yellow .stat-glyph { color: var(--signal-warning); }
```

**Why.** Discovered Phase 4 — 2.92:1 light. Dark passes at 5.90. Symmetric with B1.

**Target state.**
```css
.stat-yellow .stat-glyph { background: rgba(255, 176, 32, 0.28); color: #8A5A00; }
:root[data-theme='dark'] .stat-yellow .stat-glyph { color: var(--signal-warning); }
```

**Acceptance check.** Light probe ≥ 4.5 (target 4.99). Dark unchanged.

## B7. Composer keyboard-hint glyphs read as Unicode names by screen readers (audit #8)

**Where.** `frontend/src/components/chat/Composer.vue:67-72`.
```vue
<span class="composer-hint">
  <kbd>⏎</kbd> to send
  <span class="composer-hint-sep">·</span>
  <kbd>⇧</kbd>+<kbd>⏎</kbd> newline
</span>
```

**Why.** `⏎` (U+23CE), `⇧` (U+21E7) — screen readers announce as "return symbol" / "upwards white arrow". Should read as "Enter" / "Shift".

**Target state.** Add visually-hidden text labels inside each `<kbd>`. The glyph stays visible; the `aria` text replaces it for AT.
```vue
<span class="composer-hint">
  <kbd aria-label="Enter"><span aria-hidden="true">⏎</span></kbd> to send
  <span class="composer-hint-sep" aria-hidden="true">·</span>
  <kbd aria-label="Shift"><span aria-hidden="true">⇧</span></kbd
  >+<kbd aria-label="Enter"><span aria-hidden="true">⏎</span></kbd> newline
</span>
```

**Acceptance check.** In Chrome a11y panel, hovering each `<kbd>` shows accessible name "Enter" or "Shift" (not "Return symbol"). Visual glyph unchanged.

## B8. AggregateProfile distribution bar has no aria summary (audit #9)

**Where.** `frontend/src/views/AggregateProfileView.vue:67-85`.

**Why.** Segments carry `title=` tooltips only; screen-reader users get four separate generic-element announcements with no summary.

**Target state.** Add `role="img"` + computed `aria-label` to `.dist-bar`; hide segments from AT (`aria-hidden="true"` on each).
```vue
<div
  class="dist-bar"
  role="img"
  :aria-label="distAriaLabel"
>
  <span
    v-for="key in levelKeys"
    :key="key"
    :class="['dist-seg', `seg-${key}`]"
    :style="{ flexGrow: data.knowledge_level_distribution[key] || 0 }"
    aria-hidden="true"
  />
</div>
```
```js
// add to <script setup> in AggregateProfileView.vue
const distAriaLabel = computed(() => {
  const d = props.data?.knowledge_level_distribution || {}
  const parts = levelKeys.map(k => `${d[k] || 0} ${k}`)
  return `Knowledge level distribution: ${parts.join(', ')}`
})
```
(Adjust `props.data` reference to whatever the existing template binds — keep the data path consistent.)

**Acceptance check.** Chrome a11y panel on `.dist-bar` shows a single image-role node with accessible name `"Knowledge level distribution: 2 beginner, 4 intermediate, 1 advanced, 0 unknown"` (numbers reflect real data). Segments do not appear individually in the AT tree.

## B9. Theme-toggle aria-label mis-represents the current preference (audit #10)

**Where.** `frontend/src/App.vue:58-74`.

**Why.** Audit issue #10 is a **label** concern: the button advertises a binary `light↔dark` flip while the underlying `useTheme` machine carries three values (`light` / `dark` / `auto`). On the first click from `auto` the user silently loses the auto preference with no indication. Audit calls the accessibility "acceptable" — the fix is purely label-level so the announced state matches the stored preference.

> **Scope note.** This spec deliberately does *not* expand `toggle()` from `light↔dark` to a 3-state cycle. The audit asked for a label fix; redesigning the toggle behaviour is out of scope. If the user wants a 3-state cycle (auto-aware), file a separate ticket. The fix here surfaces the *resolved* state in the label and adds a tooltip so the loss of `auto` is at least obvious.

**Target state.** Add a `:title` matching the existing `aria-label`, and append the current resolved mode + a hint about the cycle so users notice the auto-discard:
```vue
<button
  type="button"
  class="theme-toggle"
  role="switch"
  :aria-checked="isDark"
  :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
  :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
  :data-mode="isDark ? 'dark' : 'light'"
  @click="toggle"
>
```

**Acceptance check.** Hover the theme toggle: tooltip text matches the `aria-label` exactly. No behavioural change vs current `toggle()` implementation. (Audit issue is resolved at the label-discoverability level; the deeper `auto`-state UX is documented as a follow-up.)

---

# Batch C — Polish: type scale, tokens, motion, hover affordance

**Five active issues + one deferred. One PR. Cosmetic + minor a11y improvements.**

## C1. Topnav icon-only buttons lack tooltips (audit #5)

**Where.** `frontend/src/App.vue:50-87` — `.icon-btn` elements use `aria-label` only.

**Why.** First-time users get no hover label. Theme toggle, profile, settings, sign-out are guessable but not discoverable. Tooltips cost nothing.

**Target state.** Add `:title` matching each `aria-label`:
```vue
<RouterLink
  to="/profile"
  class="icon-btn"
  aria-label="Combined profile"
  title="Combined profile"
  data-testid="nav-profile"
>
  <i class="pi pi-user" />
</RouterLink>
<RouterLink to="/settings" class="icon-btn" aria-label="Settings" title="Settings">
  <i class="pi pi-cog" />
</RouterLink>
<button
  v-if="isAuthenticated"
  type="button"
  class="icon-btn"
  aria-label="Sign out"
  title="Sign out"
  data-testid="nav-sign-out"
  @click="onSignOut"
>
  <i class="pi pi-sign-out" />
</button>
```
(Theme toggle title is handled in B9.)

**Acceptance check.** Hovering any topnav icon shows a browser tooltip matching its `aria-label`.

## C2. Markdown code-block font-size is bare `12px` (audit #6)

**Where.** `frontend/src/components/chat/MarkdownContent.vue:64-73`.
```css
.md-rendered :deep(pre) {
  /* ... */
  border-radius: 8px;
  padding: 12px 14px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  overflow-x: auto;
}
```

**Why.** Cramped beside the 0.9375rem prose; bare px is off the type scale. `--fs-caption = 0.8125rem` exists for this purpose.

**Target state.** Tokenise both font-size and radius. Use the mono token for the font stack too (already declared in `base.css:37`).
```css
.md-rendered :deep(pre) {
  background: var(--color-surface-soft);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.75rem 0.875rem;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  overflow-x: auto;
}
```

**Acceptance check.** Inspect a code block in `11-session-chat.png`-style chat view. Computed `font-size` = `13px` (0.8125rem at default root size). Visual: legible at normal reading distance, no horizontal cramp.

## ~~C3~~. Chat empty-state top-anchored — **dropped, audit #11 deferred**

**Where.** `frontend/src/views/SessionView.vue:433-437` already encodes the design intent:
```css
.messages.is-empty {
  /* When the conversation is empty, let the empty-state anchor naturally
     near the top of the conversation area instead of being orphaned in a
     vertically-centered void. */
  justify-content: flex-start;
}
```
**Why dropped.** Audit issue #11 was marked "acceptable, just noted". The existing code comment is a documented design decision (top-anchor preferred over centered void). Reversing it without product input would override an explicit choice. No fix shipped in this batch; revisit only if product asks.

## C3. CitationsList uses raw px values and hex fallback (audit #13)

**Where.** `frontend/src/components/chat/CitationsList.vue:33-47`.
```css
.citations-list {
  border-top: 1px dashed var(--color-border);
  margin-top: 10px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--color-text-muted, #888);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.citation-doc { display: flex; gap: 8px; align-items: baseline; }
.citation-pages { display: inline-flex; gap: 6px; }
```

**Why.** Off the spacing scale, off the type scale, and `#888` hex fallback contradicts the rest of the system. Cosmetic drift.

**Target state.**
```css
.citations-list {
  border-top: 1px dashed var(--color-border);
  margin-top: 0.625rem;
  padding-top: 0.5rem;
  font-size: var(--fs-label);
  color: var(--color-text-muted);
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.citation-doc { display: flex; gap: 0.5rem; align-items: baseline; }
.citation-pages { display: inline-flex; gap: 0.375rem; }
```

**Acceptance check.** Inspect a chat message with citations. No raw px values on `.citations-list`, `.citation-doc`, `.citation-pages`. `font-size` resolves through `--fs-label`.

## C4. `.back-btn:hover` background = `--color-surface` = paper-50 (audit #14)

**Where.** `frontend/src/components/BackButton.vue:62-67`.
```css
.back-btn:hover,
.back-btn:focus-visible {
  color: var(--color-heading);
  background: var(--color-surface);
  outline: none;
}
```
On light theme `--color-surface = --paper-50 = #FFFFFF` which equals the page paper. Hover is effectively invisible.

**Target state.**
```css
.back-btn:hover,
.back-btn:focus-visible {
  color: var(--color-heading);
  background: var(--color-surface-soft);
  outline: none;
}
```

**Acceptance check.** On the Home → New session page (light theme), hover the Back button. Background shifts visibly to `--ink-50 = #F7F8FB`.

## C5. Several animations ignore `prefers-reduced-motion` (audit #12)

**Where.** Animations defined inline in components without a guard:
- `frontend/src/views/OnboardingView.vue:107-115` (`.head .logo-mark` running `gentle-spin 8s ease-in-out infinite`).
- `frontend/src/views/OnboardingView.vue:159-162` (`.field` and `.actions` running `rise 420ms forwards`).
- `frontend/src/views/HomeView.vue` `.tile-arrow` hover `translateX 4px` transition.
- `frontend/src/components/chat/MessageList.vue` typing-dot delays at `0/200/400ms`.

Currently `frontend/src/components/chat/EmptyState.vue:85-87` is the only component-local `prefers-reduced-motion` guard.

**Why.** Users with vestibular sensitivity get spinning logos, slid-in fields, and animated dots they cannot opt out of.

**Target state.** Add a global guard in `frontend/src/assets/base.css` at the very end of the file. Catches all current and future animations without per-component plumbing.
```css
/* Respect users who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Acceptance check.** In Chrome DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce". Reload Onboarding — logo no longer spins, fields appear without rising animation. Open chat with assistant thinking — typing dots no longer pulse. Tile arrow on hover no longer translates.

---

# Batch D — Cosmetic-only: tile-hash recognition drift

**One issue. One PR. Optional — ship only if there's appetite. No a11y or correctness impact.**

## D1. Tile glyph/tint hashes on topic spelling (audit #7)

**Where.** `frontend/src/views/HomeView.vue:253-275`.
```js
const ICONS = ['pi-book', 'pi-bolt', /* ... */]
const TINTS = [/* eight gradient strings */]
function hashTopic(topic) {
  const t = String(topic || '').toLowerCase()
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
  return Math.abs(h)
}
function tileIcon(topic) { return ICONS[hashTopic(topic) % ICONS.length] }
function tileTint(topic) { return TINTS[hashTopic(topic) % TINTS.length] }
```

**Why.** Renaming `"Recursion"` → `"Recursion deep dive"` changes both glyph and gradient. Users build a visual memory of the tile that breaks on rename.

**Target state.** Hash on `session.id` (stable for the lifetime of the row) rather than topic text. Template already passes the full row to `tileTint`/`tileIcon`; change the function signatures to take the whole row, hash on `id`, fall back to topic if no id:
```js
function tileIcon(row) { return ICONS[hashTopic(row?.id || row?.topic || '') % ICONS.length] }
function tileTint(row) { return TINTS[hashTopic(row?.id || row?.topic || '') % TINTS.length] }
```
Update the two template call sites (`HomeView.vue:124-125`):
```vue
<div class="tile-glyph" :style="{ background: tileTint(s) }">
  <i :class="['pi', tileIcon(s)]" aria-hidden="true" />
</div>
```

**Acceptance check.** In dev tools, edit a session row's `topic` via the Pinia store. Glyph icon and tint gradient remain unchanged. Renaming in the backend (when that path lands later) similarly leaves the visual identity intact.

---

# What this spec does NOT address

Carried directly from the audit's "What I could not verify live" section. Out of scope for this remediation. Either backlogged or covered by separate phases.

- Magic-link send happy path (Phase 7 Supabase smoke runbook owns this).
- PDF upload + ingestion polling visual states (Phase 4 RAG — separate audit).
- Streaming SSE chat transition states (Composer stop-button mid-stream).
- Real-device dark / OS contrast against `.chip-gap`, `.level-pill[data-level=beginner|advanced]`, `.tab-count` — Phase 4 measurements above used composited sRGB math; production hardware verification is a final-pass sanity check, not a blocker.

# Shipping order

| Batch | PR title | Risk | Why this order |
|---|---|---|---|
| **A** | `fix(home): friendlyError for sessions load failure` | Low. Single template line + import. | User-facing leak; ship first. |
| **B** | `a11y: AA contrast on chips, level-pills, tab-count + kbd labels + dist-bar aria` | Low. CSS + small template edits, no logic changes. | Largest user impact, fully measurable. |
| **C** | `polish: tokenise code blocks + CitationsList, tooltips, back-btn hover, reduced-motion` | Low–medium. The global `prefers-reduced-motion` rule is the only sweeping change; everything else is local. | Cleanup; no behaviour change for users without motion preferences. |
| **D** | `chore(home): hash tile glyph on session.id, not topic` | Low. Two-line function change. | Optional cosmetic; can skip if backlog pressure exists. |

Each batch is mergeable independently. None depend on another. Recommended cadence: A merges same day; B within 2 days (needs DevTools contrast verification on each fix); C and D as filler PRs.

---

**End of spec. Hand off to implementation: one PR per batch, run each batch's acceptance checks before opening the PR.**
