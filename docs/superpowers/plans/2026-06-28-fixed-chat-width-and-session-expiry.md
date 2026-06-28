# Fixed Chat Width + Session Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the assistant chat bubble from resizing mid-stream by giving it a fixed column width, and document the Supabase session-expiry configuration.

**Architecture:** Part 1 is a scoped-CSS-only change in one Vue component (`AssistantBubble.vue`) so the streaming and settled renders share one stable width. Part 2 is verification of already-correct logout behavior plus a documented Supabase dashboard setting (no code).

**Tech Stack:** Vue 3 SFC scoped CSS, Vitest (`@vue/test-utils`), Supabase Auth.

## Global Constraints

- No emojis in code or comments.
- Frontend is pure JavaScript — no TypeScript files.
- Scope guard: assistant bubbles only. Do not touch `UserBubble.vue` or the
  `.session` column width in `SessionView.vue`.
- Run frontend unit tests from `frontend/`: `npm run test:unit -- --run`.
- Spec source of truth: `docs/superpowers/specs/2026-06-28-fixed-chat-width-and-session-expiry-design.md`.

---

### Task 1: Fix assistant bubble width (stop streaming jitter)

**Files:**
- Modify: `frontend/src/components/chat/AssistantBubble.vue` (scoped `<style>` only, lines ~74-103)
- Test (regression guard): `frontend/src/__tests__/assistantBubble.test.js`

**Interfaces:**
- Consumes: nothing new. `AssistantBubble` already receives `message` and
  `streaming` props; the streaming and settled renders are the same component
  instance shape (`MessageList.vue` passes `:streaming="true"` for the live one).
- Produces: no API change. Only the rendered width of `.msg.assistant` changes.

**Why no width unit test:** scoped CSS is not applied to computed style under
jsdom, so a `getComputedStyle().width` assertion would be meaningless. The
regression guard is the existing class-based tests still passing; correctness is
confirmed by manual in-app verification (Step 5).

- [ ] **Step 1: Run the existing tests to establish a green baseline**

Run (from `frontend/`):
```bash
npm run test:unit -- --run src/__tests__/assistantBubble.test.js
```
Expected: PASS (existing tests for classes `msg` + `assistant`, `streaming`
class, and `data-testid` values).

- [ ] **Step 2: Apply the CSS fix**

In `frontend/src/components/chat/AssistantBubble.vue`, change the assistant
article from content-shrink to column-fill.

Replace this rule:
```css
.msg.assistant {
  align-self: flex-start;
  max-width: 95%;
}
```
with:
```css
.msg.assistant {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
}
```

And change `.msg-body` so it fills the row width instead of sizing to content.
Replace:
```css
.msg-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  max-width: calc(100% - 2.6rem);
}
```
with:
```css
.msg-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  flex: 1 1 auto;
  max-width: calc(100% - 2.6rem);
}
```

Leave `.content` (the bubble background, padding, border-radius) unchanged — it
now spans the available column width at a constant size.

- [ ] **Step 3: Run the regression tests**

Run (from `frontend/`):
```bash
npm run test:unit -- --run src/__tests__/assistantBubble.test.js
```
Expected: PASS (no class/testid behavior changed).

- [ ] **Step 4: Run the full frontend unit suite**

Run (from `frontend/`):
```bash
npm run test:unit -- --run
```
Expected: PASS (whole suite — guards against any MessageList/SessionView
snapshot or layout assertion regressing).

- [ ] **Step 5: Manual in-app verification**

Start the app (`docker compose up`, or `npm run dev` from `frontend/` with the
backend running). Open a session and send a prompt. Confirm:
1. The assistant bubble width does NOT change as tokens stream in.
2. A one-line reply and a long multi-paragraph reply render at the same bubble
   width.
3. Tool-call chips, citations, and check-recap cards inside the bubble still
   render correctly.
4. User bubbles are unchanged (still right-aligned / content-sized).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/AssistantBubble.vue
git commit -m "fix(chat): give assistant bubble a fixed column width to stop streaming jitter"
```

---

### Task 2: Verify logout wipe + document session expiry

**Files:**
- Verify (no change expected): `frontend/src/stores/auth.js` (`signOut`)
- Modify: `docs/auth/supabase-setup.md` (append a new section after section 7 /
  "Password reset + change password")

**Interfaces:**
- Consumes: existing `signOut()` which calls `sb.auth.signOut()` and sets
  `session.value = null`.
- Produces: documentation only. No code interface change.

- [ ] **Step 1: Verify logout fully wipes credentials (manual)**

With the app running and logged in:
1. Open DevTools → Application → Local Storage. Note the Supabase auth key
   (e.g. `sb-<ref>-auth-token`).
2. Click sign out.
3. Confirm the app redirects to `/login` AND the Supabase auth key is gone from
   Local Storage.

If the key persists, that is a code bug — stop and fix `signOut()` before
continuing. Expected: key is gone (current behavior). No code change expected.

- [ ] **Step 2: Document the session-expiry dashboard setting**

Append the following section to the end of `docs/auth/supabase-setup.md`:

```markdown
## 8. Session lifetime (token expiry)

The app uses short-lived access tokens (JWT, ~1hr default) backed by a
long-lived refresh token. `persistSession: true` + `autoRefreshToken: true`
(in `frontend/src/services/supabase.js`) keep the user logged in across app
restarts and silently refresh the access token while a tab is open. Explicit
sign-out clears the local session.

To make a session eventually expire (low-sensitivity-app behavior) instead of
living forever while it keeps refreshing, configure the Supabase dashboard:

1. Supabase Dashboard -> Authentication -> Sessions.
2. Set **Inactivity timeout** to **30 days**. A session not refreshed within
   30 days expires. Adjust the value to taste.
3. Leave **Time-box user sessions** (absolute max session duration) **unset**,
   so an actively-used session is never force-logged-out mid-work.
4. Keep **refresh token rotation** enabled (the Supabase default).
5. Leave the **access token (JWT) expiry** at its default (~1hr).

This is dashboard configuration only; there is no corresponding frontend code.
The dashboard state is not version-controlled, so these steps are the
reproducible record.
```

- [ ] **Step 3: Commit**

```bash
git add docs/auth/supabase-setup.md
git commit -m "docs(auth): document Supabase session inactivity-timeout setting"
```

---

## Self-Review

**Spec coverage:**
- Part 1 width fix → Task 1. Covered (`AssistantBubble.vue`, assistant-only scope).
- Part 2a verify logout wipe → Task 2 Step 1. Covered.
- Part 2b bounded session lifetime (dashboard) → Task 2 Step 2. Covered (30-day
  inactivity timeout documented).
- Out-of-scope items (sessionStorage, idle timer, JWT TTL, user bubbles) → not
  present in any task. Correct.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows
exact CSS/markdown. Pass.

**Type consistency:** No new functions/types introduced. CSS selectors
(`.msg.assistant`, `.msg-body`, `.content`) match `AssistantBubble.vue` as read.
Pass.
