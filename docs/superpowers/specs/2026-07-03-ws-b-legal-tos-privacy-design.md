# WS-B — Legal: ToS + Privacy Policy + Acceptance

Phase 8 child workstream. Parent: `2026-07-02-phase-8-launch-design.md` (WS-A umbrella).
Priority: P0. Depends on: nothing. Blocks: launch (can't collect user data without
published terms + a recorded consent act).

Status: design approved 2026-07-03. Implementation not started.

---

## 1. Goal

Ship the legal baseline required to launch collecting user data:

1. Draft Terms of Service + Privacy Policy documents (labelled "draft, not legal
   advice").
2. Public `/tos` and `/privacy` pages that render them.
3. A consent act at registration (required checkbox) plus a server-side record of
   acceptance (timestamp + policy version) on the user row.

Out of scope: lawyer review, cookie banner (no third-party tracking cookies),
GDPR/CCPA data-export tooling, re-consent on version bump.

## 2. Locked decisions

- **Acceptance store** → server profile-row column on `users`. Auditable,
  queryable, survives Supabase auth changes.
- **Enforcement** → client gate + server record. Checkbox blocks submit in the UI;
  backend records acceptance on user-row creation. Backend does NOT hard-reject a
  missing flag (no separate failure path in v1).
- **Retroactive** → new registrations only. Pre-launch, no real users; existing dev
  rows stay `null` and are not back-filled.
- **Consent recording mechanism** → row-create stamp (see §3). Not JWT-metadata
  mining; that would touch security-sensitive `auth.py` for no v1 benefit.

## 3. Consent recording — row-create stamp

### The constraint

Registration cannot write the `users` row. Supabase `signUp` is client-side and
the user has no JWT until after email-confirm + first sign-in. The backend only
sees a user once an authenticated request arrives. User rows are already created
lazily, scattered across call sites:

- `backend/routes/chat.py:64` — `db.add(User(id=user_id))`
- `backend/routes/sessions.py:111` — same
- (scripts: `eval_focus_clearing.py`, `reliability_focus_clear.py` — test/eval
  harnesses, out of scope but should use the helper if convenient)

### Approach

- The RegisterView checkbox is the consent act (UI-gated; cannot submit unchecked).
- Centralize the scattered `db.add(User(id=user_id))` into one helper
  `ensure_user(db, user_id) -> User`. On row *create* it stamps:
  - `accepted_terms_at = <server now, tz-aware>`
  - `terms_version = CURRENT_TERMS_VERSION`
- Idempotent: if the row already exists, return it unchanged (do not re-stamp).

A `users` row can only exist after the user signed in, which required passing the
registration checkbox. So row-existence implies the consent act occurred. The
server owns the timestamp (not client-supplied — better evidence). v1 launches a
single terms version, so "version current at first login" equals "version
consented to".

### Why not carry the exact version through signUp metadata

Faithful version-at-consent would pass `options.data = { terms_version }` to
`signUp`, land it in Supabase `user_metadata`, and read it from the JWT payload on
the backend. But `verify_supabase_jwt` currently returns only `sub` and discards
the payload; wiring metadata means changing the security-critical auth path. Only
matters once terms versions bump mid-flow. Deferred (YAGNI). Documented here as the
upgrade path.

## 4. Schema

Alembic migration `0012_terms_acceptance`:

- `users.accepted_terms_at` — `TIMESTAMP(timezone=True)`, nullable.
- `users.terms_version` — `String`, nullable.

Nullable so existing rows remain valid without back-fill. Downgrade drops both
columns.

Model change in `backend/db/models.py` `User`:

```python
accepted_terms_at: Mapped[datetime | None] = mapped_column(
    DateTime(timezone=True), nullable=True, default=None
)
terms_version: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
```

## 5. Legal content

Files: `docs/legal/terms-of-service.md`, `docs/legal/privacy-policy.md`.

Each opens with a banner: **"Draft — not legal advice. Seek professional review
before large-scale data collection."** Front-matter carries `version` and
`effective_date`.

Privacy Policy must describe what the app actually collects and processes:

- Account email — Supabase Auth.
- Uploaded PDFs — stored on disk (`./data/uploads`), used for retrieval within the
  owning session.
- Study/profile data (topics, mastered concepts, gaps, learning events, chat) —
  Supabase Postgres.
- LLM processing — chat + document content sent to model providers via LiteLLM for
  tutoring responses.
- No sale of personal data.
- Deletion: how a user requests account + data deletion (contact path for v1).

Terms of Service covers: acceptable use, service provided "as is" / no warranty,
account termination, that it is a study aid not professional/academic authority,
governing terms may change.

Content is a starting draft authored in-repo, explicitly not lawyer-reviewed.

## 6. Frontend

- Router: add `/tos` (`TosView`) and `/privacy` (`PrivacyView`), both
  `meta: { public: true, sidebar: false }` so unauthenticated visitors can read
  them.
- Views render the bundled markdown. Reuse the existing markdown rendering path if
  one is already wired for chat; otherwise import the `.md` as a string and render
  through the existing markdown-it pipeline. No new heavyweight dependency.
- RegisterView: add a required consent checkbox above the submit button, with inline
  `<RouterLink>`s to `/tos` and `/privacy`. Extend the existing `canSubmit` computed
  so submit stays disabled until checked. No backend field is sent (consent is
  inferred at row-create).
- `CURRENT_TERMS_VERSION`: single source of truth. Define once and share; the
  frontend uses it only for display/linking, the backend for the stamp. If a shared
  constant across the FE/BE boundary is awkward, the backend const is authoritative
  (it writes the record) and the frontend hardcodes the same string with a comment
  pointing at the backend const.

## 7. Testing

Frontend (vitest):

- `/tos` and `/privacy` routes resolve and render their content.
- RegisterView: submit disabled until checkbox checked; enabling requires the
  existing field validations too.
- Consent links point at `/tos` and `/privacy`.

Backend (pytest):

- `ensure_user` creates a row stamping `accepted_terms_at` (non-null) and
  `terms_version == CURRENT_TERMS_VERSION`.
- `ensure_user` on an existing row returns it without re-stamping (idempotent, does
  not overwrite an earlier timestamp).
- Callers previously doing `db.add(User(id=...))` now route through `ensure_user`
  and behavior is unchanged.
- Migration `0012` upgrade adds columns; downgrade removes them.

## 8. Scope / non-goals

- No `docs/api/openapi.yaml` change: no new request/response field. Consent is not
  transmitted; it is inferred at row-create. (Supersedes the earlier "send
  `accepted_terms: true` request field" idea from initial brainstorming.)
- No re-consent flow on version bump.
- No data-export/erasure tooling beyond a documented contact path.
- Scripts under `backend/scripts/` may keep direct `User(...)` creation if routing
  them through `ensure_user` is inconvenient; they are eval harnesses, not user
  paths.

## 9. Build order (for the plan)

1. Legal content drafts (`docs/legal/*.md`) — no code deps.
2. Backend: model columns + migration `0012` + `ensure_user` helper + swap call
   sites + tests.
3. Frontend: `/tos` `/privacy` routes + views + markdown render + tests.
4. Frontend: RegisterView consent checkbox + `CURRENT_TERMS_VERSION` + tests.
5. Full suite green (pytest + vitest).

## 10. Risks

- **Unreviewed drafts** — published labelled draft/not-legal-advice; real review
  owed before scaled data collection.
- **Weak consent proof** — row-create stamp is corroborating evidence, not a signed
  agreement. Acceptable for v1 by the locked "client gate + server record"
  decision; the metadata-carried-version upgrade (§3) strengthens it later.
- **Markdown-in-bundle** — confirm the chosen import path bundles the `.md` at build
  and does not attempt a runtime fetch (which would break offline / CSP).
