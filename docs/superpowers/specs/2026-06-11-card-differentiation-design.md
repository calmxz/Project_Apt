# Sidebar vs Home Card Differentiation — Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm with visual mockups, hybrid direction selected)
**Scope:** Frontend only. No backend, OpenAPI, or contract changes.
**Branch:** `feat/card-differentiation` (off `dev` at `7a2a17b`)

## Problem

The sidebar session rows, the home "Recent activity" cards, and the `/sessions` library cards all render the same two strings from `frontend/src/utils/sessionCard.js` (`cardDescription` + `cardMeta`). Picking a session from the sidebar feels identical to picking it from home, even though the surfaces have different jobs:

- **Sidebar** is a persistent quick-switch rail. It wants dense, scannable, structured content: which session, is it current, where does it stand.
- **Home recent-activity and the library** are re-entry hubs. They want rich, narrative content: what was I doing, how far did I get.

The enriched payload fields `progress.focus_target_gap` and `progress.mastered_count` (shipped in WS0/WS1, present on both `SessionListItem` and `RecentSessionSummary`) are underused: today they only appear as text fallbacks inside `cardDescription`.

## Decision

Hybrid of the two directions explored in mockups:

- **Sidebar — hard split, structured only.** Rows show chips built from structured signals (focus gap, mastered count), or nothing. Prose (message preview, session summary) never appears in the rail. One rule for active AND ended rows. Signal-poor rows self-compress to two lines (topic + meta).
- **Home + library — rich superset.** Cards show the narrative story line (preview for active, summary for ended), plus the same chips, plus the verbose meta line.

Decisions locked during brainstorm:

1. Library (`/sessions`) gets the same rich treatment as home — one shared card shape.
2. Ended sidebar rows follow the same rule as active rows: chips if any, else meta only. Session summary prose lives on home/library cards only.
3. Active home/library cards stay click-to-open with no Resume button. Ended cards keep the existing Continue button (reopen + navigate — a real distinct action).
4. Sidebar meta line is compacted to rail shorthand: `"12 msgs · 2h ago"`. Home/library keep the verbose `cardMeta` string.

## Shared helpers — `frontend/src/utils/sessionCard.js`

`cardDescription` is **removed**. New surface-specific API:

### `cardStory(session) -> string`

Narrative line for home/library cards only.

- Ended: `stripAutoPrefix(session.last_session_summary) || 'Completed'`
- Active: `(session.last_message_preview || '').trim()` — may return `''`; the caller renders the existing muted placeholder `'No activity yet'`.
- No focus or mastered fallback. Those signals are chips now.

### `cardChips(session) -> Array<{ type, label, count? }>`

Single source of truth for chip content on BOTH surfaces (sidebar and cards style it differently, content identical).

- `{ type: 'focus', label: <focus_target_gap> }` — only when `session.progress?.focus_target_gap` is set.
- `{ type: 'mastered', label: '<n> mastered', count: n }` — only when `session.progress?.mastered_count > 0`.
- `progress` null/undefined → `[]`. Order: focus first, mastered second.

### `railMeta(session) -> string`

Compact sidebar meta: `"<n> msgs · <short-rel>"` (e.g. `"12 msgs · 2h ago"`). Timestamp source identical to `cardMeta`: `last_activity_at || created_at`; no timestamp → just `"<n> msgs"`. Singular: `"1 msg"`.

### Unchanged

`cardMeta` (verbose, home/library) and `stripAutoPrefix` keep their current behavior.

## New formatter — `frontend/src/utils/formatDate.js`

`formatRelativeShort(iso) -> string`: always-numeric compact relative time. `< 60s → 'now'`; then `5m ago`, `2h ago`, `3d ago`, `2w ago`, `4mo ago`, `1y ago`. Unit boundaries reuse the existing `STEPS` thresholds already defined in `formatDate.js` (single threshold table, two renderings). No `Intl.RelativeTimeFormat` wording ("yesterday", "last week") — deterministic and cheap to test. Empty/null input → `''`.

## Sidebar — `frontend/src/components/sidebar/SidebarSessionRow.vue`

- The `.sb-row-desc` prose span is replaced by a chips row rendered from `cardChips`.
  - Focus chip: accent-soft pill, decorative glyph, `max-width` + ellipsis truncation.
  - Mastered chip: success-soft pill, `✓ N`.
- Meta line switches from `cardMeta` to `railMeta`.
- Rows with no chips render topic + meta only (two lines) — the rail self-compresses.
- Ended rows: same rule. No summary prose in the rail.
- Collapsed-mode tooltip: `"<topic> — <chip labels joined with ', '>"`, or just the topic when there are no chips.
- Accessibility: the chips row carries the existing desc id in `aria-describedby`. Screen-reader text is the plain chip labels without glyphs (e.g. `"Focus: chain rule applications, 3 mastered"`); glyphs are `aria-hidden`. The meta span keeps its id. The `describedBy` computed already conditionally includes the desc id only when content exists — reuse that for "has chips".

## Home + library cards — `HomeView.vue`, `SessionsLibraryView.vue`

Same rich shape in both views:

- **Story line** = `cardStory(s)`. Active preview renders italic-quoted; ended summary renders plain; empty story falls back to the existing muted-italic `'No activity yet'` (current copy and testids preserved).
- **Chips row** under the story — full-size variant of the same `cardChips` data (focus chip labeled `"Focus: <gap>"`, mastered chip `"✓ <n> mastered"`). Absent chips → no empty container rendered.
- **Meta line** = `cardMeta(s)`, unchanged.
- Ended cards keep the Continue button; active cards remain whole-card click with no extra CTA.

## Edge cases

- `progress` null, `mastered_count` 0, or focus null → chips silently absent; layout collapses cleanly (flex gap, no empty wrappers).
- Long focus text: ellipsis inside the sidebar chip; on cards the chip may ellipsize at card width.
- Whitespace-only `last_message_preview` → story `''` → placeholder (Python-side trim already exists; the JS `.trim()` is the belt-and-braces).
- `[auto]` summary prefix is stripped by `stripAutoPrefix` exactly as today.

## Testing

- Rewrite `sessionCard` unit tests around the new API (`cardStory`, `cardChips`, `railMeta`); delete `cardDescription` tests.
- Add `formatRelativeShort` unit tests (boundaries: 59s, 60s, hour/day/week/month/year edges, null input).
- Update `SidebarSessionRow` tests: chips render for signal-rich rows, sparse rows have no desc node (two-line), ended rows follow the same rule, `aria-describedby` text matches plain chip labels, tooltip content.
- Update `HomeView` and `SessionsLibraryView` tests: story line per state (preview/summary/placeholder), chips presence/absence, Continue stays ended-only.
- Known tripwires: `homeView.test.js` asserts on old description fallback strings (updates expected, not regressions). After removing any testid/class, grep the whole repo including `frontend/e2e/` — vitest does not cover Playwright selectors.

## Non-goals

- No backend or contract changes (all fields already served).
- No change to session selection, ordering, bucketing, pinning, rename, or the Active|Ended toggles.
- No Resume CTA on active cards.
- No retention/caching work (separate deferred WS3 tail).

## Deliverable

One PR from `feat/card-differentiation` into `dev`.
