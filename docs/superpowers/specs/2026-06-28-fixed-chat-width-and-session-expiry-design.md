# Fixed Chat Width + Session Expiry — Design

Date: 2026-06-28
Status: Approved (brainstorm), pending spec review
Branch: `feat/fixed-chat-width-session-expiry`

## Problem

Two unrelated UX issues raised together:

1. **Chat width jitter.** While the tutor streams a reply, the assistant
   bubble starts narrow and visibly widens as tokens arrive, settling to a
   "normal" width only when the reply finishes. The reading column itself is
   fine; the bubble inside it resizes.

2. **Session/token behavior.** User wants short-lived access tokens backed by a
   long-lived refresh token, login that survives an app restart, full
   credential wipe on explicit logout, and a session that *eventually* expires
   like a low-sensitivity app (rather than persisting forever).

## Scope Reconciliation (read this first)

The initial request said "if I close the tab, credentials should expire."
During brainstorming the user **revised** this: do **not** tie tab-close to
logout — keep the user logged in across restart, and let the token expire over
time instead.

That clarified behavior is **already Supabase's default** in this codebase:

| Desired behavior | Current status |
|---|---|
| Short-lived access token (~1hr) | Already — Supabase default JWT TTL |
| Long-lived refresh token, auto-refresh while tab open | Already — `autoRefreshToken: true` (`frontend/src/services/supabase.js`) |
| Login survives app/browser restart | Already — `persistSession: true` (localStorage) |
| Explicit logout fully wipes credentials | Already — `signOut()` in `frontend/src/stores/auth.js` calls `sb.auth.signOut()` and nulls `session` |
| Session eventually expires (bounded lifetime) | **Not set** — this is the only new lever, and it is a Supabase **dashboard** setting, not frontend code |

So the only **code** deliverable is Part 1 (width). Part 2 is verification of
existing behavior plus one documented dashboard configuration step.

## Part 1 — Fixed Chat Width (code)

### Root cause

`frontend/src/components/chat/AssistantBubble.vue` scoped CSS:

```css
.msg.assistant {
  align-self: flex-start;
  max-width: 95%;
}
```

`.msg` is `display: flex` and the assistant `<article>` has no fixed width, so
`align-self: flex-start` makes the article shrink to its content. A
partially-streamed reply is literally narrower than the finished one. The
`64rem` column in `SessionView.vue` (`.session { max-width: 64rem }`) is stable;
only the bubble width changes.

### Fix

Make the assistant article fill the column width so the bubble holds a constant
width independent of streamed content length. CSS-only, in
`AssistantBubble.vue`:

- `.msg.assistant` → `width: 100%; max-width: 100%;` (remove the content-shrink).
- `.msg-body` → allow it to fill the row: `flex: 1 1 auto;` (it currently relies
  on `max-width: calc(100% - 2.6rem)` with content-based width).
- The `.content` bubble (`background`, `border-radius`, padding) is unchanged —
  it now spans the available column width at a stable size, matching the chosen
  "keep bubbles, fix their width" layout.

### Scope guard

- **Assistant bubbles only.** User bubbles (`UserBubble.vue`) do not stream and
  stay right-aligned/content-sized. Do not touch them.
- The streaming `AssistantBubble` (`:streaming="true"` in `MessageList.vue`) and
  the settled one are the **same component**, so a single CSS change covers both
  the in-progress and final render — that is what removes the jitter.

### Verification (manual, in-app)

Run the app, open a session, send a prompt. Confirm:

1. Mid-stream bubble width equals the final bubble width (no widening).
2. A one-line reply and a long multi-paragraph reply both render at the same
   bubble width.
3. Tool-call chips, citations, and check-recap cards inside the bubble still
   render correctly.

### Tests

- Existing `AssistantBubble` / `MessageList` unit tests must still pass
  (`npm run test:unit -- --run`).
- Add/extend a snapshot or class assertion only if an existing test already
  asserts on `.msg.assistant` width classes; otherwise the change is visual and
  covered by manual verification (no brittle pixel-width unit test).

## Part 2 — Session Expiry (verify + dashboard config)

### 2a. Verify existing logout wipe (no code expected)

Confirm `signOut()` in `frontend/src/stores/auth.js` fully clears local
credentials:

- It calls `sb.auth.signOut()` (clears Supabase's localStorage entry) and sets
  `session.value = null`.
- Manual check: log in, log out, reload — user must land on `/login`, and the
  Supabase auth key must be gone from `localStorage` (DevTools → Application →
  Local Storage).

If any credential survives logout, that becomes a code fix; otherwise no change.

### 2b. Bounded session lifetime (Supabase Dashboard)

User chose to set a concrete expiry so the session does not live forever.

**This is a dashboard setting, not frontend code.** Document these steps:

1. Supabase Dashboard → **Authentication** → **Sessions** (Session settings).
2. Set **Inactivity timeout** to **30 days** — a session not refreshed within
   30 days expires (low-sensitivity-app default; user may adjust).
3. Leave **Time-box user sessions** (absolute max) **unset** so an actively-used
   session is not force-logged-out mid-work.
4. Keep **refresh token rotation** enabled (Supabase default) for security.
5. Note that **access token (JWT) expiry** stays at the default (~1hr); the
   short-lived access token + long-lived (but now bounded) refresh token is the
   intended "short-term tokens" behavior.

Record these steps in `docs/auth/supabase-setup.md` so the config is reproducible
(the dashboard state is not version-controlled).

### Part 2 verification

- After setting inactivity timeout: existing login/refresh flow unaffected for
  active users (manual smoke — log in, refresh, still in).
- Documented expiry value present in `docs/auth/supabase-setup.md`.

## Out of Scope (YAGNI)

- sessionStorage / tab-close logout (explicitly de-scoped by user).
- Idle auto-logout timer in frontend code.
- Changing access-token JWT TTL.
- Any change to user bubbles or the chat column width.

## Files Touched

| File | Change |
|---|---|
| `frontend/src/components/chat/AssistantBubble.vue` | Scoped CSS: assistant article fills column width |
| `docs/auth/supabase-setup.md` | Document inactivity-timeout dashboard step |

No backend, contract, or migration changes.
