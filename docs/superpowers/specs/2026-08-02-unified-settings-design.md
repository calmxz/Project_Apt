# Unified Settings — Design

**Date:** 2026-08-02
**Status:** Approved (user, 2026-08-02)
**Supersedes:** the separate aggregate Profile page (`AggregateProfileView.vue`). Per-session profile pages are out of scope and unchanged.

## Goal

One claude.ai-style Settings surface with a tab rail replaces the two sidebar
destinations (Profile, Settings). Everything the learner configures or inspects
about their account lives under `/settings/:tab`.

## Tabs

Four tabs, grouped (not 1:1 with today's cards):

| Tab | Slug | Contents |
|---|---|---|
| Profile | `profile` | Aggregate learning profile moved from `AggregateProfileView.vue`: knowledge levels, mastered concepts, confirmed gaps, subtopic levels — all editing behavior preserved exactly. Plus the Feedback style picker (moved from current Settings). |
| Usage | `usage` | Existing `UsagePanel` (daily spend chart, cap meter with soft/urgent markers, most-expensive sessions) plus its fetch and error states. |
| Account | `account` | Display name field, change-password form, danger zone (delete account). |
| Appearance | `appearance` | Dark-mode switch. |

## Routing

- `/settings` redirects to `/settings/profile`.
- `/settings/:tab` renders the shell with the matching tab active. An invalid
  `:tab` value redirects to `/settings/profile`.
- `/profile` (the aggregate profile route) redirects to `/settings/profile`.
  Its route name is preserved so existing `router.push({ name: ... })` calls
  keep working.
- `/session/:id/profile` (per-session profile) is untouched.
- The URL is the single source of truth for the active tab; switching tabs
  navigates (replace or push — push, so browser back walks tab history).

## Sidebar

Footer shows only Settings. The Profile entry is removed.

## Component structure

```
views/SettingsView.vue            shell: title + tab rail + <ActiveTab>
components/settings/ProfileTab.vue
components/settings/UsageTab.vue
components/settings/AccountTab.vue
components/settings/AppearanceTab.vue
```

- `SettingsView.vue` keeps only the page chrome and the rail. Each current
  settings card's markup and logic moves into its tab component.
- `AggregateProfileView.vue` is deleted once its content lives in
  `ProfileTab.vue`.
- Reused as-is: `UsagePanel.vue`, `FeedbackStylePicker.vue`, the existing
  password-change and delete-account logic, profile editing components.

## Data flow

- Lazy per-tab fetch: `ProfileTab` fetches the aggregate profile on first
  activation; `UsageTab` fetches the usage summary on first activation.
  Account and Appearance need nothing beyond the auth store and theme state.
- Fetched state is kept while the Settings page stays mounted — switching
  tabs does not refetch. A fresh page load refetches as today.
- Error states carry over unchanged (e.g. "Usage data is unavailable right
  now.").
- No backend or API contract changes. Zero contract drift.

## Responsive and accessibility

- Desktop: vertical rail on the left.
- Narrow viewports: rail becomes a horizontal, scrollable chip row above the
  panel.
- Rail uses `role="tablist"` / `role="tab"`, `aria-selected`, and arrow-key
  navigation between tabs (activation follows focus via router push).

## Testing

- Router: `/settings` redirect, `/profile` redirect, invalid-tab redirect,
  valid tab renders.
- Shell: rail renders four tabs; active tab follows the URL; clicking a tab
  updates the URL.
- Existing aggregate-profile tests move to `ProfileTab`; usage tests move to
  `UsageTab`; settings card tests move to their tab components.
- Sidebar test updated: Profile entry absent.
- Grep sweep for testids removed with `AggregateProfileView.vue` — check both
  vitest and Playwright specs (they are separate suites; a testid dead in one
  can still be referenced in the other).

## Out of scope

- Per-session profile pages.
- Any backend change.
- Visual redesign of the moved content beyond fitting it into the panel.
