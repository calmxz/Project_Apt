# Sidebar Header + Settings Redesign

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/sidebar-redesign` (continuation)

## Problem

The expanded sidebar header places the logo at the far left and the collapse
arrow at the far right (`justify-content: space-between` in a 16rem column),
stranding the arrow and making the header read as two disconnected controls.
The footer rail and mobile top strip both carry four chrome controls each,
crowding the sidebar with secondary actions that belong in Settings.

User direction: separate the arrow from the logo, simplify the sidebar, and
relocate secondary controls under Settings.

## Goals

- Make the header read as one cohesive unit in every state.
- Collapsed rail shows only the expand toggle — no logo.
- Reduce the footer rail and mobile strip to primary navigation only.
- Move theme and sign-out into the Settings page, on every viewport.
- Fix the theme-label wording bug (action label vs. state label).

## Non-Goals

- No change to session list grouping, search, pin, or inline-rename behavior.
- No change to routing or the two-tier profile structure.
- No new Settings fields beyond Appearance and the Sign-out action.

## Design

### Header — three states

The header is a single component region with three distinct renderings. The
tight logo+arrow grouping is **desktop-only**; mobile keeps the conventional
far-right close affordance.

| State | Condition | Renders |
|---|---|---|
| desktop-expanded | `isDesktop && isExpanded` | logo (`variant="full"`) + collapse arrow `«`, grouped left, tight gap |
| desktop-collapsed | `isDesktop && !isExpanded` | expand toggle `»` only — no logo, no mark |
| mobile-drawer-open | `!isDesktop && drawer-open` | logo (`variant="full"`) + close `×`, with `×` pushed right via `margin-left:auto` |

CSS change: `.sb-header` drops `justify-content: space-between`. Default is a
left-aligned flex row with a tight gap. The mobile drawer-close button gets
`margin-left:auto` so it alone sits at the far edge. The collapsed header
centers its single toggle.

Logo `variant` continues to follow `isExpanded`, but in the collapsed desktop
state the brand `RouterLink` is not rendered at all (currently it renders the
mark-only logo). Only the toggle button remains.

### Footer rail

Drops from four icons to two: **Profile** and **Settings**. The theme-toggle
button and sign-out button are removed from `Sidebar.vue`'s `.sb-rail`.

### Mobile top strip

`SidebarMobileTopStrip.vue` drops `strip-theme-toggle` and `strip-sign-out`.
Resulting strip: hamburger (open drawer) + logo (home) + Profile. The
`useTheme` and `useAuthStore` sign-out wiring is removed from this component.

### Settings page additions

`SettingsView.vue` gains:

1. **Appearance card** — a labeled switch row, styled as a card matching the
   existing Account / Feedback cards (icon + title + body). Icon `pi-moon`,
   title "Appearance".
   - Control: `role="switch"`, `aria-checked="isDark"`, `data-testid="settings-theme-toggle"`.
   - **Label is state-based: "Dark mode"** (the mode the switch enables when
     on), not the action ("Switch to light mode"). This resolves the known
     wording bug where the footer toggle read "Light mode" while in dark mode.
   - Wires `useTheme()` (`isDark`, `toggle`).
   - **Instant-apply — placed OUTSIDE the save-gated `<form>`.** The existing
     form (name + feedback) is gated behind a "Save preferences" button
     (`dirty` computed). Theme applies immediately via `useTheme`, so embedding
     it in the form would falsely imply it needs saving. The Appearance card
     renders after the form's Save actions, before the sign-out / Danger zone.

Resulting page order: Account (form) → Feedback style (form) → Save actions
(form) → Appearance (instant) → Sign out → Danger zone.

2. **Sign out** — placed near the Danger zone, low-key outlined treatment
   (session-ending, not destructive — distinct from the dashed Danger card).
   - Button `data-testid="settings-sign-out"`, rendered only when authenticated.
   - On click: `authStore.signOut()`, then `router.push('/login')`; on error,
     `showError`. Mirrors the existing handler removed from the sidebar.
   - Wires `useAuthStore` + `useRouter` + `useToast` into `SettingsView.vue`.

### Accepted trade-off: collapsed home link

Removing the logo in the collapsed desktop rail removes the only home
affordance in that state (the logo is `RouterLink to="/"`). Accepted:
expanding the rail restores it, and New session / Profile remain reachable.
This is a deliberate decision, not an oversight.

## Affected Files

**Components**
- `frontend/src/components/sidebar/Sidebar.vue` — header three-state render +
  CSS; remove theme + sign-out from `.sb-rail`; remove now-unused `useTheme`
  and the sidebar `onSignOut`/auth-signout wiring if no longer referenced.
- `frontend/src/components/sidebar/SidebarMobileTopStrip.vue` — remove theme +
  sign-out controls and their wiring.
- `frontend/src/views/SettingsView.vue` — add Appearance switch card + a
  sign-out action near the Danger zone; wire theme/auth/router/toast.

**Tests (in-scope, move with the testids — not cleanup-after)**
- `frontend/src/__tests__/sidebar.test.js` — drop `sidebar-theme-toggle` /
  `sidebar-sign-out` assertions; add three-state header assertions.
- `frontend/src/__tests__/sidebarA11y.test.js` — header focus-order / toggle
  a11y for the new states; remove rail theme/signout a11y assertions.
- `frontend/src/__tests__/settingsView.test.js` — add theme-switch toggle and
  sign-out behavior (success redirect + error toast) coverage.
- Mobile-strip coverage (wherever `strip-theme-toggle` / `strip-sign-out` are
  asserted) — drop those assertions.

## Testing Strategy

- Unit (vitest): three header states render the correct controls; footer rail
  shows exactly Profile + Settings; mobile strip shows hamburger + logo +
  profile; Settings theme switch flips `isDark` and reflects `aria-checked`;
  Settings sign-out calls `signOut` then routes to `/login`, and shows a toast
  on failure.
- A11y: collapsed toggle has an accessible expand label; expanded toggle has a
  collapse label; Settings theme switch exposes `role="switch"` + `aria-checked`.
- Full suite must stay green (baseline 351 FE tests) with the testid moves
  accounted for, not net-deleted coverage.

## UI/UX Validation (live state, 2026-06-01)

Audited the running app against the ui-refactor standards. Findings confirm
the design:

- **Expanded header** (live): logo far-left, `«` far-right via `space-between`
  — a wide dead gap reads as two disconnected controls. The tight left-grouped
  fix is correct. The toggle retains its `.sb-toggle` hover-pill so it still
  reads as a button, not part of the wordmark.
- **Collapsed header** (live): logo mark + `»` crammed together top-left —
  confirms the cramped look. Toggle-only fix resolves it.
- **Footer rail** (live): renders "Light mode" with a sun icon while in dark
  theme — the wording bug, confirmed. State-label fix in Settings resolves it.
- **Settings cards** (live): rounded surface cards (icon + title + body). The
  Appearance card and outlined sign-out must adopt this same card/spacing
  system — no arbitrary new values (ui-refactor: define systems, limit choices).

`frontend-design` skill not used: this is a refactor inside an established
design system (tokens, display/sans fonts, editorial card pattern), not net-new
creative UI. Matching existing patterns is the goal; inventing a distinct
aesthetic would regress consistency. ui-refactor's tactical rules cover it.

## Out of Scope / Follow-ups

- Manual logged-in Chrome smoke (blocked by Supabase magic-link auth) — carries
  forward from the existing branch caveats.
- WCAG contrast verification on the new Settings rows under real theme values.
