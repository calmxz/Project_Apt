# Email/Password Auth — Design

**Date:** 2026-06-16
**Branch:** `feat/email-password-auth`
**Status:** Approved (brainstorming)
**Supersedes:** the magic-link sign-in flow added in Phase 7

## 1. Goal

Replace Supabase magic-link (passwordless OTP) sign-in with conventional
email + password registration and login. Add a set of pre-made, pre-confirmed
debug accounts for local development. Keep every existing API route protected.

## 2. Approach (decided)

Stay on **Supabase Auth**. Swap only the sign-in *flow* from
`signInWithOtp` to `signUp` / `signInWithPassword`. Supabase continues to:

- hash and store passwords in its managed `auth.users` table,
- issue the same RS256/ES256 JWTs the backend already validates.

Because the JWT the backend receives is identical regardless of how the user
signed in, **`backend/services/auth.py` does not change**. The backend remains
auth-agnostic: it validates a Supabase JWT and extracts `sub` as `user_id`.

### Rejected alternative

Custom backend auth (own `users.password_hash`, backend-issued JWTs, register/
login endpoints). Rejected: large security surface, replaces a hardened managed
service, and a full `auth.py` rewrite — for no functional gain over Supabase
password auth.

## 3. Database impact

**No Alembic migration. No `password_hash` column. No `email` column.**

Under this approach the relational schema is unchanged. Database-side work is:

- **Supabase dashboard config**: Password provider ON; "Confirm email" ON;
  magic-link/OTP-only sign-in off.
- **Debug accounts** inserted into `auth.users` (pre-confirmed) by a seed
  script (see §6).
- App-side `users` rows keep auto-creating lazily on first authenticated
  request — existing get-or-create `db.add(User(id=user_id))` in
  `backend/routes/chat.py` and `backend/routes/sessions.py`. Nothing to add.

Decision: app `users` table stays `(id, created_at)`; email lives only in
Supabase `auth.users`.

## 4. Authentication flows

### 4.1 Register (real user)

1. User submits email + password + confirm-password on `/register`.
2. Frontend client-side validation: valid email, password ≥ 8 chars,
   confirm matches.
3. `auth.register(email, password)` calls
   `sb.auth.signUp({ email, password, options: { emailRedirectTo: origin } })`.
4. Because "Confirm email" is ON, Supabase returns a user but **no active
   session**. The view shows a "check your inbox to confirm" state.
5. User clicks the confirmation link → returns to the app origin →
   `detectSessionInUrl` (already enabled) + `onAuthStateChange` establish the
   session → router routes to onboarding/home. No new callback route needed.

### 4.2 Login (real user)

1. User submits email + password on `/login`.
2. `auth.signIn(email, password)` calls `sb.auth.signInWithPassword(...)`.
3. On success → session set → router proceeds (onboarding if incomplete, else
   home).
4. On `"Email not confirmed"` error → show the message plus a "Resend
   confirmation email" action calling `auth.resendConfirmation(email)`
   (`sb.auth.resend({ type: 'signup', email })`).

### 4.3 Debug account login

Debug accounts are created **pre-confirmed** (§6), so they skip the inbox step
and log in immediately via the normal `/login` password flow.

## 5. Frontend changes

| File | Change |
|---|---|
| `frontend/src/stores/auth.js` | Remove `signInWithMagicLink`. Add `register(email, password)`, `signIn(email, password)`, `resendConfirmation(email)`. Keep `init()`, `signOut()`, computed getters, `_resetForTests()`. Update the module header comment (magic-link → email/password). |
| `frontend/src/views/LoginView.vue` | Replace magic-link form with email + password fields, "Sign in" button, and a "Create account" link to `/register`. Surface Supabase errors; on "Email not confirmed" show a resend action. |
| `frontend/src/views/RegisterView.vue` (new) | Email + password + confirm-password fields, client-side validation, "Create account" button, "Already have an account? Sign in" link to `/login`. On success → "check your inbox" confirmation state. |
| `frontend/src/router/index.js` | Add `/register` route with `meta: { public: true }`. All other routes stay auth-gated; guard logic unchanged. |
| `frontend/src/services/supabase.js` | No change (still publishable key, `detectSessionInUrl: true`). |

UX shape (decided): **separate `/login` and `/register` pages** with links
between them. New views reuse `LoginView.vue`'s existing card/token styling for
visual consistency (no new design system).

## 6. Pre-made debug accounts

- **`backend/scripts/seed_debug_accounts.py`** (new): for each account, POST to
  the Supabase GoTrue Admin REST endpoint
  `POST {SUPABASE_URL}/auth/v1/admin/users` via `httpx`, authenticated with the
  existing `SUPABASE_SECRET_KEY` (service role), body
  `{ "email", "password", "email_confirm": true }`. No new dependency.
  Idempotent: on a 422/duplicate response, skip and report "already exists".
  Reads the account list from `docs/dev/debug-accounts.txt`.
- **`docs/dev/debug-accounts.txt`** (new, **gitignored**): the throwaway
  email/password pairs plus an in-file warning ("DEV ONLY — disposable Supabase
  dev project, never production, never real passwords").
- **`docs/dev/debug-accounts.example.txt`** (new, committed): documents the file
  format and the warning, with placeholder values, so the file's purpose is
  discoverable without leaking credentials.
- **`.gitignore`** += `docs/dev/debug-accounts.txt`.

## 7. Security

- All existing API routes remain gated by `current_user_id`. Unchanged, still
  enforced. No route loosens.
- The only new public *frontend* route is `/register`. There are **no new
  backend endpoints** — register/login network calls hit Supabase's own
  hardened, rate-limited GoTrue endpoints.
- Password policy: client-side min 8 + confirm-match; Supabase enforces its
  server-side minimum independently.
- `SUPABASE_SECRET_KEY` is used **only** in the backend seed script, never
  shipped to the client (publishable key only on the frontend, as today).
- Debug `.txt` is gitignored, throwaway creds, dev project only, with an in-file
  warning. The example file carries no real creds.
- Email-enumeration / "user already exists" responses are handled by Supabase;
  the frontend surfaces Supabase's message verbatim rather than adding its own
  enumeration signal.

## 8. Tests

- **Frontend unit (vitest):**
  - Rewrite the existing magic-link store test for `register` / `signIn` /
    `resendConfirmation` (mock Supabase client).
  - Rewrite `LoginView` test for the password flow (including "Email not
    confirmed" → resend).
  - Add `RegisterView` test (validation, success → confirmation state).
- **E2E (Playwright):** update the login spec to the password flow, reusing the
  existing `placeholder.invalid` Supabase fallback + route-stub pattern.
- **Backend:** no logic change, so no required new tests. Optional: light
  httpx-mocked unit test for `seed_debug_accounts.py` (idempotency + payload
  shape).

## 9. Docs

- `docs/auth/supabase-setup.md`: update the provider section — Password ON,
  Confirm email ON, magic-link-only off, redirect URLs unchanged; document the
  seed script and the debug-accounts files.
- `docs/superpowers/specs/2026-05-03-crux-v1-design.md`: update the Auth
  constraint line and Phase 7 note (`magic-link` → `email/password`).

## 10. Out of scope

- Custom backend auth / self-issued JWTs.
- Password reset / "forgot password" flow (Supabase supports it; not requested
  — can be a fast follow).
- OAuth / social providers.
- Phase 8 waitlist gate (registration is open for now, per decision).
- Storing email or any credential material in the app database.

## 11. Acceptance criteria

1. A new user can register with email + password, receives a confirmation
   email, and after confirming can log in and reach the app.
2. `/login` authenticates with email + password; an unconfirmed account is told
   to confirm and can resend.
3. Debug accounts from the seed script log in immediately (pre-confirmed) via
   `/login`.
4. All previously protected API routes still reject requests without a valid
   Supabase JWT (no regression).
5. `docs/dev/debug-accounts.txt` is gitignored; no credentials are committed.
6. Frontend unit tests and the login e2e pass; lint clean; no API contract
   drift.
