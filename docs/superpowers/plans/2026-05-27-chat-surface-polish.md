# Chat Surface Polish — Spec + Plan

> **For agentic workers:** This file is self-contained (design rationale + phased execution). Execute task-by-task with `superpowers:executing-plans` or inline. Steps use checkbox (`- [ ]`) syntax. Use `ui-refactor` / `frontend-design` for judgement calls. **Do not start until the user says go.**

**Date:** 2026-05-27
**Author:** brainstormed with user (calmxz)
**Status:** executed on `feat/chat-surface-polish` — Tasks 0-7 shipped, Task 8 gates green (tests 284/284, lint clean, build OK). **Deferred:** manual smoke + before/after screenshots in both themes (needs a live session — handed to reviewer), and the inline-code AA contrast check (§5 Risk 3). Edge-fade took the documented fallback (skipped); scrollbar fix shipped (commit 09101ac).

---

## 1. Goal

The 3-phase chat-surface redesign (PRs #19/#20/#23, merged to `dev`) shipped the *structure* — 10-component split, SSE streaming, markdown pipeline — but **explicitly deferred the visual-token / polish pass** (Phase 3 plan, "Outstanding": *"Manual smoke + visual-token walk-through (Task 29 step 1) — deferred to a human pass … aura-tokens.css left as-is, component CSS preserved verbatim"*).

This is that deferred pass. Refine the **existing playful-editorial coral identity** — do not reinvent it. Make the in-session chat read as a polished product in **both light and dark** themes.

### Decisions (locked with user)

- **Direction:** Refine current identity (coral accent, Bricolage display, chunky press-down shadows, rounded radii). Not a Claude-minimal rewrite.
- **Scope:** Full polish pass over the in-session surface — header, bubbles, message list, composer, scroll area, dark-mode tokens.
- **Pain points (all four in scope):** native scrollbar/chevrons, boxed tutor reply, tall header, spacing/width.

### Out of scope

| Item | Verdict |
|---|---|
| Global pill navbar (`App.vue`) | **Out.** Not touched. (Its top padding is addressed only via the in-session pull-up in Task 7 — see note.) |
| Light/dark **toggle** behavior | Out. Toggle works; only the *rendered result* in each theme is fixed. |
| Streaming logic / SSE / Pinia store | Out. Pure presentation. |
| Backend / contracts / migrations | Out. Frontend-only. |

Pulled **in** because it is needed for "chat starts higher": a scoped vertical-rhythm trim inside `SessionView` (Task 7). The global `.page-inner` top padding stays untouched to avoid regressing every other route.

---

## 2. Design

### 2.1 Header — halve the height (`ChatHeader.vue`)

**Now:** `IN SESSION` folio (label) + display title `clamp(1.875rem, 4vw, 2.25rem)` + mono id line, stacked vertically, sitting under the global navbar. Two tall headers before any message.

**Target:** compact, status-as-badge, title smaller, actions on the same row.

```
[ IN SESSION ]  Big-O notation                 [Profile]  [End session]
                id · 21258e0…
```

- Status (`in session` / `archived`) becomes a small **pill badge**: `background: var(--color-accent-soft)`, `color: var(--color-accent)`, uppercase label type, sits inline to the left of the title (archived variant uses `--color-text-muted` on `--color-surface-soft`).
- Topic title: drop to `font-size: clamp(1.375rem, 2.5vw, 1.625rem)`, keep `font-family: var(--font-display)`, keep `<h1>` (a11y), keep `overflow-wrap: anywhere`, add `line-clamp: 2`.
- Id line: shrink to `var(--fs-label)`, `--color-text-faint`, `text-overflow: ellipsis` so the hash truncates instead of running wide. Keep `data-testid="session-id"`.
- Layout: title block left, action block right, `align-items: center`. Badge + title share a flex row; id sits under the title.
- Keep all existing markup hooks: `data-testid="session-id"`, `data-testid="session-profile-link"`, `data-testid="session-end"`, the `end-session` emit, `Profile` router-link.

### 2.2 Tutor reply — soften the box (`AssistantBubble.vue`)

**Now:** `.msg.assistant .content` = `background: var(--color-surface)` + `border: 1px solid var(--color-border)` + `box-shadow: var(--shadow-paper)` + asymmetric radius. Reads as a hard raised card; the top corner clipping at the scroll edge is the "stray box" in the screenshot.

**Target:** keep a bubble (identity cue) but lighten it.

- `background: var(--color-surface-raised)` (light `#FFFFFF`, dark `#262B43` — both already defined, both dark-aware).
- `border: none`.
- `box-shadow: none` (lift now comes from surface-vs-background contrast, not a drawn border + shadow).
- Keep the asymmetric radius `var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)`.
- `role-tag` and tool-call rows unchanged.

### 2.3 User reply — calm the glow (`UserBubble.vue`)

Keep coral fill (`--color-accent`, white text). Only soften the drop shadow from `0 4px 12px -4px rgba(255,107,92,0.35)` to `0 2px 8px -4px rgba(255,107,92,0.22)` so it sits closer to the surface and matches the lighter tutor bubble.

### 2.4 Scrollbar / chevrons (`SessionView.vue` `.messages`, `Composer.vue` `.composer-input`)

**Root cause:** CSS sets `::-webkit-scrollbar` width + `::-webkit-scrollbar-thumb`, but never `::-webkit-scrollbar-button` (Chrome/Windows then paints default up/down **arrow chevrons**) nor `::-webkit-scrollbar-track`. `scrollbar-color` only affects Firefox.

**Target** (apply identically to both scroll regions):

```css
.messages::-webkit-scrollbar { width: 8px; }
.messages::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.messages::-webkit-scrollbar-thumb:hover { background: var(--color-text-faint); }
```

Keep `scrollbar-width: thin; scrollbar-color: var(--color-border-strong) transparent;` for Firefox.

**Edge fade:** instead of a hard clip at the scroll-container top/bottom, add sticky gradient overlays so messages dissolve into the background. Use `::before`/`::after` on the messages wrapper (sticky, `pointer-events: none`, height `~16px`, `linear-gradient` from `var(--color-background)` to `transparent`). **Do not** use `mask-image` on `.messages` — it clips the custom scrollbar and bubble shadows. (If the sticky-pseudo approach fights the flex layout in practice, fall back to no fade — the scrollbar fix alone resolves the reported eyesore.)

### 2.5 Spacing / rhythm (`SessionView.vue`, `MessageList.vue`)

- Reading column stays `max-width: 48rem` (≈72ch — correct for prose).
- `MessageList` gap: increase the **between-turn** gap to `1.25rem`; keep the **within-turn** (role-tag → content) gap tight at `0.3rem`.
- `.messages` horizontal padding: symmetric small inset (e.g. `0 0.25rem`) so the right-aligned user bubble and left-aligned tutor bubble breathe evenly (currently `0.75rem 0.25rem 1rem 0` — asymmetric right/left).
- `.session` gap: `1.5rem` → `1.25rem` to tighten the header→hairline→messages→composer stack.

### 2.6 Dark-mode token pass — the core deferred work

`frontend/src/assets/aura-tokens.css` declares chat tokens with **light-only** values (`--code-block-bg:#f7f3ed`, `--math-bg:#fff8ed`, `--user-bubble-*`, etc.). Components mostly use the dark-aware `--color-*` semantics, so most of those tokens are **dead**; but `MarkdownContent.vue` and friends still fall back to **hardcoded light hex**, which renders cream/tan blocks and invisible black borders on the dark surface.

**Fix:** route every chat color through the existing dark-aware semantic tokens in `base.css`. Retire the dead `aura-tokens.css` chat tokens (delete the file's now-unused declarations, or repoint them to semantics). Concrete mapping:

| Element (file) | Current | Target (dark-aware) |
|---|---|---|
| Code block bg — `MarkdownContent` `pre` | `var(--code-block-bg, #f7f3ed)` | `var(--color-surface-soft)` |
| Code block text — `pre` | `var(--code-block-text, #2c2316)` | `var(--color-text)` |
| Code block border — `pre` | `var(--code-block-border, rgba(0,0,0,.06))` | `var(--color-border)` |
| Inline code bg — `code:not(pre code)` | `#f4e9d8` (hardcoded) | `var(--color-accent-soft)` |
| Inline code text — `code:not(pre code)` | `#8a4a00` (hardcoded) | `var(--color-accent-hover)` (AA on accent-soft in both themes) |
| Math display bg — `.katex-display` | `var(--math-bg, #fff8ed)` | `var(--color-surface-soft)` |
| Math accent border — `.katex-display` | `var(--math-accent, #ff6b5b)` | `var(--color-accent)` |
| Table cell borders — `th,td` | `rgba(0,0,0,.08)` | `var(--color-border)` |
| Citation divider — `CitationsList` | `rgba(0,0,0,.15)` dashed | `var(--color-border)` dashed |
| Tool-pill error bg — `ToolCallChip` `--error` | `rgba(0,0,0,.04)` | `var(--color-surface-soft)` |
| Tool-pill error border — `--error` | `rgba(0,0,0,.1)` | `var(--color-border)` |

`highlight.js` syntax-token colors: the pipeline registers languages but **no hljs theme CSS is imported**, so highlighted spans inherit `--color-text`. Acceptable for this pass (mono, readable in both themes). A proper dual-theme hljs stylesheet is a follow-up, not part of this polish — note only.

### 2.7 Identity guardrails

- Coral (`--color-accent`) stays the only chromatic accent. Signals (error/success/warning) keep their triad.
- Keep Bricolage display for headings, Inter for body, IBM Plex Mono for captions/code-chrome.
- Keep the chunky press-down shadow vocabulary on **interactive** elements (composer send/stop buttons, primary actions). Remove it only from the **passive** tutor bubble (§2.2).
- Every change is CSS or light template restructure. No new dependencies.

---

## 3. Execution Plan

### Task 0 — Branch
- [ ] From repo root: `git checkout dev && git pull --ff-only origin dev`
- [ ] `git checkout -b feat/chat-surface-polish`
- [ ] Baseline green before edits — from `frontend/`: `npm run test:unit -- --run` (expect 284 pass / 38 files). If red on a clean branch, stop and report.

### Task 1 — Dark-aware token foundation
**Files:** `frontend/src/assets/aura-tokens.css` (retire dead chat tokens or repoint to semantics), `frontend/src/assets/base.css` (only if a genuinely new token is needed — prefer reusing existing `--color-*`).
- [ ] Decide: delete the unused light-only chat tokens vs repoint them to `--color-*`. Repointing is lower-risk (any stray consumer still resolves). Document choice in the commit.
- [ ] No visual change expected from this task alone (components still reference fallbacks until Task 5/6). Verify build: `npm run build`.
- [ ] Commit: `refactor(chat): retire dead light-only chat tokens; route to dark-aware semantics`

### Task 2 — Scrollbar fix (kill chevrons) + edge fade
**Files:** `frontend/src/views/SessionView.vue` (`.messages`), `frontend/src/components/chat/Composer.vue` (`.composer-input`).
- [ ] Add `::-webkit-scrollbar-button { display:none }` + transparent track + rounded padding-box thumb + hover (§2.4) to both regions.
- [ ] Add sticky `::before`/`::after` gradient edge-fade to the messages wrapper (or skip per §2.4 fallback if it fights layout).
- [ ] Manual: dark + light, scroll a long session — no chevrons, thumb subtle, no hard clip.
- [ ] `npm run test:unit -- --run` (no structural change → green).
- [ ] Commit: `fix(chat): hide native scrollbar arrows, restyle thumb, soften scroll edges`

### Task 3 — Header compaction
**Files:** `frontend/src/components/chat/ChatHeader.vue`.
- [ ] Restructure template to single-row: `[status badge] [topic h1]` left, `[Profile][End session]` right; id line under title (§2.1).
- [ ] Preserve `data-testid="session-id"`, `session-profile-link`, `session-end`; preserve `end-session` emit and `canEnd`/`isEnded` logic.
- [ ] `npm run test:unit -- --run` — watch `chatHeader.test.js` (6 tests). Update assertions only if they pin removed structure; keep behavior coverage.
- [ ] Manual: long topic clamps to 2 lines; archived badge variant renders.
- [ ] Commit: `feat(chat): compact session header (status badge + smaller title)`

### Task 4 — Soften bubbles
**Files:** `frontend/src/components/chat/AssistantBubble.vue`, `frontend/src/components/chat/UserBubble.vue`.
- [ ] Assistant `.content`: `--color-surface-raised` bg, no border, no shadow, keep radius (§2.2).
- [ ] User `.content`: soften drop shadow (§2.3).
- [ ] `npm run test:unit -- --run` — `assistantBubble` / `userBubble` tests assert testids + rendered content, not box CSS → green.
- [ ] Manual: tutor bubble reads soft in both themes; cut-off-edge artifact gone.
- [ ] Commit: `feat(chat): soften tutor + user bubbles`

### Task 5 — MarkdownContent dark-mode colors
**Files:** `frontend/src/components/chat/MarkdownContent.vue`.
- [ ] Apply the §2.6 mapping to `pre`, `code:not(pre code)`, `.katex-display`, `th/td`, `.deferred` (deferred already uses `--color-text-muted` — fine).
- [ ] Manual: dark mode — code block uses surface-soft, inline code is coral-tinted, math block dark, table borders visible. Light mode unchanged in feel.
- [ ] `npm run test:unit -- --run` — `markdownContent` / `codeBlockChrome` assert rendered HTML structure (`<strong>`, `language-python`, `katex`), not colors → green.
- [ ] Commit: `fix(chat): dark-aware code/inline/math/table colors in MarkdownContent`

### Task 6 — Citations + ToolCallChip dark fixes
**Files:** `frontend/src/components/chat/CitationsList.vue`, `frontend/src/components/chat/ToolCallChip.vue`.
- [ ] Citation divider → `var(--color-border)` dashed.
- [ ] Tool-pill `--error` bg/border → `--color-surface-soft` / `--color-border`.
- [ ] `npm run test:unit -- --run` — `citationsList` / `toolCallChip` assert text/class/grouping → green.
- [ ] Manual: dark mode — citation rule + error pill visible.
- [ ] Commit: `fix(chat): dark-aware citations divider + tool-pill error state`

### Task 7 — Spacing / rhythm + session pull-up
**Files:** `frontend/src/views/SessionView.vue`, `frontend/src/components/chat/MessageList.vue`.
- [ ] `MessageList` between-turn gap `1.25rem`; `.messages` symmetric inset; `.session` gap `1.25rem` (§2.5).
- [ ] In-session pull-up: tighten the top of the session stack so the conversation starts higher **without** editing global `.page-inner`. Acceptable: reduce `.session` top spacing / BackButton margin. (Leave `.page-inner` global padding alone.)
- [ ] `npm run test:unit -- --run` — green.
- [ ] Manual: both themes — balanced rhythm, chat visibly higher than before.
- [ ] Commit: `feat(chat): tighten chat vertical rhythm and message spacing`

### Task 8 — Verify
- [ ] `npm run test:unit -- --run` → **all green** (≈284+). Quote the count.
- [ ] `npm run lint` → clean (oxlint + eslint).
- [ ] `npm run build` → succeeds.
- [ ] **Manual smoke (both themes):** open a session with markdown + a fenced code block + inline math + a citation; verify header height, soft tutor bubble, coral inline code, no scrollbar chevrons, balanced spacing. Capture before/after screenshots (dark + light).
- [ ] Backend untouched — no `pytest` needed (note it).

### Task 9 — PR
- [ ] Push `feat/chat-surface-polish`.
- [ ] Open PR → `dev`. Body: link this file, list the 6 visual fixes, attach before/after dark+light screenshots, note "frontend-only, 0 new deps, N tests green, lint+build clean."

---

## 4. Verification summary

| Gate | Command / check |
|---|---|
| Unit tests | `npm run test:unit -- --run` — all green, no testid/contract regressions |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Manual | dark + light smoke of an in-session chat with code/math/citation |
| Scope | no backend, no deps, no streaming/store/toggle changes |

## 5. Risks

- **Test coupling to markup:** header restructure (Task 3) is the only task likely to touch `data-testid`/structure. Keep every hook; update assertions only when they pin *removed* structure, never to mask a real break.
- **Edge-fade vs scrollbar:** sticky-pseudo fade can conflict with the flex scroll container — fallback documented (drop the fade; scrollbar fix is the real win).
- **Inline-code contrast:** `--color-accent-hover` on `--color-accent-soft` — verify AA in both themes during manual smoke; bump to `--color-text` if it reads weak.
