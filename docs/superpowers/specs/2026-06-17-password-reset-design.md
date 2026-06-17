# Password Reset + Change Password — Design

Date: 2026-06-17
Branch base: `feat/email-password-auth` (extends the email/password migration, PR #85)
Status: approved design, pre-implementation

## Problem

The email/password migration replaced magic-link sign-in. Existing magic-link
accounts have a user row in Supabase `auth.users` but **no password set**, so
they cannot sign in through the new email/password form. There is also no way
for any user to recover a forgotten password or rotate a known one. The app's
auth store currently exposes only `register`, `signIn`, `resendConfirmation`,
and `signOut`.

This adds two capabilities:

1. **Forgot-password recovery** — request a reset email, then set a new password
   from the emailed link.
2. **Change password while signed in** — rotate the password from Settings.

## Scope

In scope (frontend + Supabase dashboard config only):

- New route/view `ForgotPasswordView.vue` at `/forgot`.
- New route/view `ResetPasswordView.vue` at `/reset-password`.
- Three new auth-store actions + a `userEmail` getter.
- Router guard exemption so the recovery link reaches the set-new-password page.
- "Forgot password?" link + post-reset success banner on `LoginView`.
- A "Security" change-password card in `SettingsView`.
- Tests (unit + one e2e) and docs.

Out of scope:

- Backend changes. GoTrue (Supabase Auth) handles the email, token, and
  password update entirely; the FastAPI backend is untouched.
- Custom reset-email rate limiting (Supabase enforces its own).
- Email template customization (default `{{ .ConfirmationURL }}` works).

## Decisions (resolved during brainstorming)

- **Post-reset behavior:** after a successful reset-confirm, **sign the user out
  and redirect to `/login?reset=1`** so they log in fresh with the new password.
  (Change-password from Settings does NOT sign out — the user stays in their
  session.)
- **Settings change-password re-verifies the current password** before updating,
  so a hijacked but unattended session cannot silently rotate the credential.

## Architecture

### Routes (`router/index.js`)

| Path | Name | View | meta |
|---|---|---|---|
| `/forgot` | `forgot-password` | `ForgotPasswordView.vue` | `{ public: true, sidebar: false }` |
| `/reset-password` | `reset-password` | `ResetPasswordView.vue` | `{ public: true, sidebar: false }` |

### Recovery-session handling (the load-bearing detail)

The Supabase client is created with `detectSessionInUrl: true`
(`services/supabase.js`). When the user clicks the reset email, the link lands on
`${SITE}/reset-password#access_token=...&type=recovery`. The SDK parses the hash,
**establishes a session**, and fires a `PASSWORD_RECOVERY` auth event. From the
router's perspective the user is now authenticated.

The existing guard (`router/index.js`) has three relevant rules:

1. unauthenticated + non-public route → `/login`
2. authenticated + (`login` | `register`) → `/home`
3. authenticated + onboarding incomplete + route ≠ `onboarding` → `/onboarding`

Rule 3 would hijack the recovery landing and bounce the user to onboarding
before they can set a password. Fix: add `reset-password` to rule 3's exemption:

```js
if (
  auth.isAuthenticated &&
  !user.onboardingComplete &&
  to.name !== 'onboarding' &&
  to.name !== 'reset-password'
) {
  return { name: 'onboarding' }
}
```

Rule 1 is satisfied because the route is `public: true` (renders before the
session is processed). Rule 2 does not list `reset-password`, so an authenticated
(recovery) user is not bounced to home. No other guard change is needed.

### Auth store (`stores/auth.js`)

Add three actions and one getter. All actions throw on Supabase error, matching
the existing `signIn`/`register` convention.

```js
const userEmail = computed(() => session.value?.user?.email ?? null)

async function requestPasswordReset(email) {
  const sb = getSupabase()
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo:
      typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined,
  })
  if (error) throw error
}

async function updatePassword(password) {
  const sb = getSupabase()
  const { error } = await sb.auth.updateUser({ password })
  if (error) throw error
}
```

`userEmail` is added to the returned store object alongside the existing getters.

### Views

All three forms reuse the existing `.login`/`.form`/`.field`/`.cta` styling from
`LoginView.vue`/`RegisterView.vue` (or the `.card` pattern in `SettingsView.vue`)
so the look is consistent. Password validity mirrors `RegisterView`:
`password.length >= 8` and `confirm === password`.

**`ForgotPasswordView.vue`** — request a reset email.
- Email field; submit gated on a valid email.
- On submit: `auth.requestPasswordReset(email)` → show a "check your inbox at
  `<email>`" sent state (mirrors `RegisterView`'s confirmation panel).
- On error: inline error banner.
- testids: `forgot-form`, `forgot-email`, `forgot-submit`, `forgot-error`,
  `forgot-sent`, `forgot-to-login`.

**`ResetPasswordView.vue`** — set a new password from the email link.
- New-password + confirm fields; submit gated on `len >= 8 && match`; mismatch
  hint mirrors `RegisterView`.
- On submit: `auth.updatePassword(newPassword)` → `auth.signOut()` →
  `router.push('/login?reset=1')`.
- On error (expired/missing recovery session, weak password): inline error
  banner with a link back to `/forgot`.
- testids: `reset-form`, `reset-password`, `reset-confirm`, `reset-submit`,
  `reset-mismatch`, `reset-error`, `reset-to-forgot`.

**`LoginView.vue`** — add discovery + post-reset feedback.
- "Forgot password?" `RouterLink` to `/forgot` (testid `login-to-forgot`),
  placed near the existing "Create an account" swap line.
- When `route.query.reset === '1'`, show a success banner "Password updated —
  sign in with your new password." (testid `login-reset-done`).

**`SettingsView.vue`** — new "Security" card (between Appearance and Sign out).
- Fields: current password, new password, confirm new password.
- Submit gated on: all three present, new `len >= 8`, new === confirm.
- On submit:
  1. `auth.signIn(auth.userEmail, currentPassword)` to re-verify the current
     password (throws on wrong → inline error "Current password is incorrect").
  2. `auth.updatePassword(newPassword)`.
  3. On success: clear the fields, show success (`useToast` `showSuccess` +
     inline `settings-pw-success`). User stays signed in.
- testids: `settings-security`, `settings-pw-current`, `settings-pw-new`,
  `settings-pw-confirm`, `settings-pw-submit`, `settings-pw-error`,
  `settings-pw-success`.

## Data flow

```
Forgot:   /forgot --requestPasswordReset--> GoTrue /auth/v1/recover --> email
Reset:    email link --> /reset-password (detectSessionInUrl sets recovery
          session) --updatePassword--> GoTrue /auth/v1/user --signOut-->
          /login?reset=1
Change:   /settings --signIn(verify)--> /auth/v1/token  then
          --updatePassword--> /auth/v1/user  (session retained)
```

## Error handling

- Invalid/expired recovery link: `updateUser` returns an auth error →
  `ResetPasswordView` shows the inline banner + a `/forgot` link to retry.
- Wrong current password in Settings: `signIn` throws → inline error; no
  `updateUser` call is made.
- Supabase env not configured (placeholder client): auth calls fail loudly with
  the SDK error surfaced in the banner — same behavior as existing auth views.

## Testing (TDD — test first)

Unit (Vitest):
- `auth.js` store: `requestPasswordReset` calls `resetPasswordForEmail` with the
  `redirectTo` and throws on error; `updatePassword` calls `updateUser` and
  throws on error; `userEmail` reflects the session user.
- `forgotPasswordView.test.js`: submit gated on valid email; submit calls
  `requestPasswordReset`; sent state renders the email; error banner on throw.
- `resetPasswordView.test.js`: gated on `len >= 8 && match`; mismatch hint;
  submit calls `updatePassword` then `signOut` then navigates to `/login?reset=1`;
  error banner on throw.
- `loginView.test.js`: "Forgot password?" link present; reset banner shows when
  `route.query.reset === '1'`.
- `settingsView.test.js`: change-password gating; wrong current password shows
  error and does not call `updatePassword`; happy path calls `signIn` then
  `updatePassword` and shows success.

e2e (Playwright, `e2e/auth.spec.js`):
- "requesting a reset shows the sent confirmation" — stub `**/auth/v1/recover**`
  200, fill `/forgot`, assert `forgot-sent` contains the email.
- Reset-confirm and change-password stay unit-only: faking a recovery session in
  the URL hash offline is brittle and low-value versus the unit coverage.

## Dashboard / docs

- Supabase dashboard → Authentication → URL Configuration → Redirect URLs: add
  `${SITE}/reset-password` (and `http://localhost:5173/reset-password` for dev).
- Document the redirect-URL requirement and the reset/change flows in
  `docs/auth/supabase-setup.md`.

## Acceptance criteria

1. A magic-link/forgotten-password user can request a reset at `/forgot`,
   receive the email, set a new password at `/reset-password`, land on
   `/login?reset=1`, and sign in with the new password.
2. The recovery link reaches the set-new-password form without being bounced to
   `/onboarding` or `/home`.
3. A signed-in user can change their password from Settings; a wrong current
   password is rejected without changing anything; the session is retained.
4. All new unit tests and the new e2e test pass; existing suites stay green;
   lint clean; no contract drift (no backend/contract changes).
```
