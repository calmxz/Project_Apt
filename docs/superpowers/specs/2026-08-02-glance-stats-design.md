# Glance Stats Design — Replace Charts with Text Summaries

**Date:** 2026-08-02
**Status:** Approved (user, 2026-08-02)
**Depends on:** `docs/superpowers/specs/2026-08-02-unified-settings-design.md` (PR #210, branch `feat/unified-settings`)

## Problem

The four data visualizations in the Settings surface fail at current data volume. Mastery-over-time renders mostly empty weekly boxes with no y-axis; the usage spend chart is 14 unlabeled bars; the knowledge-distribution segmented bar duplicates its own legend; weakest-concepts bars and dots add visual weight without adding information. Sparse data (a few events per week, a few cents per day) makes bar charts read as noise.

## Decision

Replace all four charts with glance-level text stats. No history lists, no new visual widgets. The usage cap meter (labeled progress bar with "Today $X / $Y cap") stays — it communicates clearly and is the one visualization that earns its space.

## Changes

### 1. ProfileTab — mastery trend

- Delete the `MasteryTrend` component usage (the "Mastery over time" weekly bar chart).
- Replace with one text line computed from the same `weekly_mastery` data:
  `"3 mastered this week · 10 total"`
  - "this week" = count in the latest week bucket of `weekly_mastery`.
  - "total" = existing mastered-concepts total already shown in stats.
  - Zero-data form: `"Nothing mastered yet"` (only when total is 0).

### 2. ProfileTab — knowledge level distribution

- Delete the segmented distribution bar.
- Keep a single text counts line: `"8 beginner · 7 intermediate · 5 advanced · 15 unknown"`.
- Levels with count 0 are omitted from the line.
- The line carries `data-testid="agg-dist"` so existing vitest/e2e assertions keep resolving.

### 3. ProfileTab — weakest concepts

- Delete the `WeakestConcepts` component usage (progress bars + attempt dots).
- Replace with one text line, top 3 concepts by lowest accuracy:
  `"Needs attention: formal analysis (31%), data transmission (33%), CSS selectors (67%)"`
  - Hidden entirely when there is no accuracy data (no empty "Needs attention:" stub).

### 4. UsagePanel — daily spend chart

- Delete the 14-day bar chart.
- Keep the cap meter and its "Today $X.XX / $Y.YY cap" label unchanged.
- Add one text line above the meter: `"Today $0.03 · Last 7 days $0.14"` (7-day sum from the existing `daily` array).
- Top-sessions list unchanged (it is a list, not a chart).
- Root keeps `data-testid="usage-panel"`.

## Component cleanup

- `frontend/src/components/profile/MasteryTrend.vue` and `frontend/src/components/profile/WeakestConcepts.vue` become unused: delete them and their test files. Replacement markup is plain elements inside `ProfileTab.vue`.
- `UsagePanel.vue` simplified in place; its test updated.
- Testid sweep after deletion: `mastery-trend`, `weakest-concepts` references in `frontend/src/__tests__/` and `frontend/e2e/` (native grep, not rtk rg). Note: `profileTab.test.js` currently asserts `weakest-concepts`/`mastery-trend` render — those assertions move to the new glance lines.

## Data flow

No API or contract change. All summaries derive from data the components already receive: `weekly_mastery`, `knowledge_level_distribution`, `concept_accuracy` (ProfileTab via `getAggregateProfile`) and `daily`, `today_spend_usd`, `hard_cap_usd` (UsagePanel via its `usage` prop).

## Error handling

Unchanged — fetch/error/empty states of ProfileTab and UsageTab are untouched. Glance lines render only when their source arrays are non-empty (see per-item zero-data forms above).

## Testing

- Update `profileTab.test.js`: assert glance-line text from the existing fixture (mastered-this-week count, distribution counts line, needs-attention top-3 ordering) instead of child-component presence.
- Update `usagePanel.test.js`: assert "Today · Last 7 days" line and cap meter; drop bar-chart assertions.
- Full suite + lint green.

## Branch / landing

New branch `feat/glance-stats` off `feat/unified-settings`; separate PR stacked on #210 (retarget to `dev` if #210 merges first).
