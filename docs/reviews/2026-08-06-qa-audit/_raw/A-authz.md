# A — Authentication & Authorization Audit

**Date:** 2026-08-06
**Scope:** `backend/routes/*.py`, `backend/services/auth.py`, `backend/services/user_service.py`, `backend/db/models.py`, `backend/agent/tools.py` (plus the ownership-relevant callees these reach: `services/documents_service.py`, `services/object_store.py`, `services/ingestion_service.py`, `services/retrieval_service.py`, `services/profile_service.py`, `services/usage_service.py`, `services/session_enrichment.py`, `services/pgvector_store.py`, `config.py`, `main.py`).
**Method:** read-only. Every endpoint traced from decorator to the SQL that actually executes. No app run, no live Supabase, no LLM calls.
**Result:** 1 finding (Low). The multi-tenant isolation model re-verified as intact — see the matrix.

> **Tooling note for whoever re-runs this:** the `Read` tool is broken in this repo when cwd is `frontend/` (the `PreToolUse` hook resolves `.claude/hooks/block_env.py` relative to cwd and the file only exists at repo root); `Write` fails the same way. Files here were read via `awk` with line numbering. Separately, `grep` routed through the `rtk` proxy returned a **false zero** for `jwt_claims` in `backend/services/auth.py` — a known repo gotcha. Every sweep whose result mattered was re-run with the native `Grep` tool. Do not trust an empty rtk-grep result.

---

## 1. Route-by-route auth matrix

29 endpoints total: **27 authenticated, 2 unauthenticated** (`/health`, `/healthz`).

Verification of completeness: a native `Grep -c current_user_id backend/routes/` returns documents=2, chat=2, me=3, profile=7, review=2, sessions=14, upload=3, usage=2. Subtracting one `import` line per file gives 1+1+2+6+1+13+2+1 = **27 uses**, exactly matching the 27 non-health route decorators. There is no authenticated endpoint missing the dependency.

Legend for **User-scoped?**:
- **DIRECT** — the SQL `WHERE` clause itself contains `user_id == <authenticated user>`.
- **GUARDED** — an explicit `row.user_id != user_id -> 404` ownership gate runs before any session-scoped query.
- **DERIVED** — the id is not client-supplied; it is produced from an already-guarded parent.
- **N/A** — no tenant data touched.

| # | Method | Path | Auth dependency | Client-supplied identifiers | User-scoped? | Anchor |
|---|---|---|---|---|---|---|
| 1 | GET | `/health` | **none** | — | N/A — returns a constant `{"status":"ok"}`, no DB access | `routes/health.py:12` |
| 2 | GET | `/healthz` | **none** | — | N/A — same constant | `routes/health.py:17` |
| 3 | POST | `/api/chat/stream` | `Depends(current_user_id)` | `session_id` (body); `message`; `review_gaps`; `review_gap`; `diagnostic_accepted` | **GUARDED** — `row[0].user_id != user_id -> 404` at `chat.py:168`, before ingestion counts, rate limit, history load or any write. `review_gap` is intersected against the caller's own profile pool (`chat.py:98-105`), so an arbitrary value cannot pull another user's concept. The background `_rolling_summary_task(req.session_id)` (`chat.py:379`) is queued only after that guard passed. | `routes/chat.py:311,168` |
| 4 | DELETE | `/api/documents/{document_id}` | `Depends(current_user_id)` | `document_id` (path, int) | **GUARDED** — joins to `sessions`, then `owner_id != user_id -> DocumentNotFound -> 404` at `documents_service.py:96-104`. Same 404 for absent and foreign. | `routes/documents.py:13` -> `services/documents_service.py:95-104` |
| 5 | GET | `/api/me` | `Depends(current_user_id)` | — (identity comes only from the JWT `sub`) | **DIRECT** — `db.get(User, user_id)` | `routes/me.py:25,33` |
| 6 | PATCH | `/api/me` | `Depends(current_user_id)` | `display_name`, `feedback_pref`, `onboarding_complete` (body; no id fields) | **DIRECT** — `ensure_user(db, user_id)`, then writes to that row only. The body carries no user id, so no cross-user write is expressible. | `routes/me.py:42,59-67` |
| 7 | GET | `/api/profile/aggregate` | `Depends(current_user_id)` | — | **DIRECT** — `WHERE sessions.user_id == user_id` | `routes/profile.py:21` -> `services/profile_service.py:572-576` |
| 8 | GET | `/api/profile/{session_id}` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `row is None or row.user_id != user_id -> 404` at `profile.py:36`; the `LearningEvent` query is then keyed on that verified `session_id`. | `routes/profile.py:29,35-45` |
| 9 | PATCH | `/api/profile/{session_id}` | `Depends(current_user_id)` | `session_id` (path); `If-Match` header; `add_mastered`, `add_gap`, `knowledge_level`, `subtopic`, `subtopic_level` (body) | **GUARDED** — `_owned_session_or_404` at `profile.py:90` runs before `lock_session_row` and the If-Match compare. | `routes/profile.py:82,90` |
| 10 | DELETE | `/api/profile/{session_id}/mastered_concepts/{item}` | `Depends(current_user_id)` | `session_id`, `item` (path); `If-Match` header | **GUARDED** — `_owned_session_or_404` at `profile.py:118`. `item` is resolved only inside that session's own JSON profile; unknown item -> 404 (`profile.py:124-125`). | `routes/profile.py:129` -> `:117-126` |
| 11 | DELETE | `/api/profile/{session_id}/confirmed_gaps/{item}` | `Depends(current_user_id)` | `session_id`, `item` (path); `If-Match` header | **GUARDED** — same `_delete_item` helper | `routes/profile.py:140` -> `:117-126` |
| 12 | DELETE | `/api/profile/{session_id}/subtopic_levels/{item}` | `Depends(current_user_id)` | `session_id`, `item` (path); `If-Match` header | **GUARDED** — `_owned_session_or_404` at `profile.py:162` | `routes/profile.py:151,162` |
| 13 | GET | `/api/review/queue` | `Depends(current_user_id)` | `limit`, `offset` (query, `ge`/`le` bounded) | **DIRECT** — `.join(Session).where(Session.user_id == user_id)` at `review.py:28-29`. The second query (`review.py:53`) selects `Session.id.in_(sids)` where `sids` is derived only from the already-user-filtered event rows (`review.py:51`) — **DERIVED**, not a hole. | `routes/review.py:18,26-58` |
| 14 | POST | `/api/sessions` | `Depends(current_user_id)` | `topic`, `seed_mode` (`Literal["fresh","resume"]`), `prior_session_id`, `declared_level` (body, `extra="forbid"`) | **GUARDED** — `prior is None or prior.user_id != user_id -> 404` at `sessions.py:175`. The new row is written with the server-side `user_id` (`sessions.py:189`), never a body value. The earlier `exclude_id=req.prior_session_id` (`sessions.py:162`) touches an unvalidated id, but only as an exclusion inside a `user_id == caller` query — see §3 for the oracle analysis. | `routes/sessions.py:121,174-176,189` |
| 15 | GET | `/api/sessions` | `Depends(current_user_id)` | — | **DIRECT** — `WHERE user_id == user_id` | `routes/sessions.py:209,216` |
| 16 | GET | `/api/sessions/library` | `Depends(current_user_id)` | `status`, `sort` (`Literal`-constrained), `q` (free text), `limit`, `offset` (bounded 1..100 / >=0) | **DIRECT** — `base = select(Session).where(user_id == user_id)` at `sessions.py:297`; the `total` count, the `last_activity` subquery (`sessions.py:322-324`) and the returned page all derive from that base. `q` reaches a parameterized `ilike`, not string-built SQL. | `routes/sessions.py:287,297,322-324` |
| 17 | GET | `/api/sessions/lookup` | `Depends(current_user_id)` | `topic` (query, `max_length=200`) | **DIRECT** — `filter(user_id == user_id, lower(trim(topic)) == normalized)` | `routes/sessions.py:345,370-373` |
| 18 | GET | `/api/sessions/{session_id}` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `sessions.py:398`; messages, profile and pending-check are all keyed on `row.id` afterwards | `routes/sessions.py:391,397-399` |
| 19 | GET | `/api/sessions/{session_id}/messages` | `Depends(current_user_id)` | `session_id` (path); `before` (required int cursor); `limit` (1..100) | **GUARDED** — `sessions.py:430`. The `before` cursor is applied as `ChatMessage.id < before` **inside** a query already restricted to `session_id == row.id` (`sessions.py:229-231`), so a cursor value harvested from another session cannot cross the boundary. | `routes/sessions.py:421,429-431` -> `:229-231` |
| 20 | POST | `/api/sessions/{session_id}/end` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `sessions.py:465` precedes `_claim_end`, the rate-limit increment and the summary LLM call | `routes/sessions.py:455,464-466` |
| 21 | POST | `/api/sessions/{session_id}/reopen` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `sessions.py:509` precedes the `ended_at = None` write | `routes/sessions.py:502,508-510` |
| 22 | GET | `/api/sessions/{session_id}/ingestion` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `sessions.py:543` precedes `list_document_statuses` | `routes/sessions.py:536,542-544` |
| 23 | PATCH | `/api/sessions/{session_id}` | `Depends(current_user_id)` | `session_id` (path); `topic`, `pinned` (body, `extra="forbid"`) | **GUARDED** — `sessions.py:565` precedes any mutation; the duplicate-topic re-check is `user_id`-scoped | `routes/sessions.py:555,564-566` |
| 24 | POST | `/api/sessions/{session_id}/check/skip` | `Depends(current_user_id)` | `session_id` (path); `index` (body) | **GUARDED** — `sessions.py:613`; `index` is validated against that session's own pending batch, mismatch -> 409 `check_conflict` | `routes/sessions.py:605,612-614` |
| 25 | POST | `/api/sessions/{session_id}/check/answer` | `Depends(current_user_id)` | `session_id` (path); `index`, `selected_index` (body) | **GUARDED** — `sessions.py:639`; grading reads that session's own `pending_check_json` | `routes/sessions.py:628,638-640` |
| 26 | POST | `/api/sessions/{session_id}/check/complete` | `Depends(current_user_id)` | `session_id` (path) | **GUARDED** — `sessions.py:680` precedes the row lock, the batch clear, the rate-limit increment and the streamed LLM turn. `ToolContext` is built with the route-derived `session_id` and `user_id` (`sessions.py:738-745`). | `routes/sessions.py:664,679-681` |
| 27 | POST | `/api/upload` | `Depends(current_user_id)` | `session_id` (form field); `file` and its `filename`; `Content-Length` header | **GUARDED** — `sess is None or sess.user_id != user_id -> 404` at `upload.py:100`, before the rate-limit increment, before the blob write and before the `Document` row is created. `filename` is sanitized at `upload.py:119-122`; `Content-Length` is advisory only, the real bound is the streamed `_read_bounded` (`upload.py:45-59`). | `routes/upload.py:62,99-101` |
| 28 | GET | `/api/upload/{document_id}` | `Depends(current_user_id)` | `document_id` (path, int) | **GUARDED** — two-step: fetch doc, then `sess is None or sess.user_id != user_id -> 404` at `upload.py:191`. The absent and the foreign case return an identical `404 {"detail":"document not found"}`. | `routes/upload.py:181,187-192` |
| 29 | GET | `/api/usage/summary` | `Depends(current_user_id)` | — | **DIRECT** — `DailyCostLedger.user_id == user_id` (`usage_service.py:30`) and `LlmCallLog.user_id == user_id` (`usage_service.py:48`); the join to `sessions` only supplies a topic label for rows already filtered to the caller. | `routes/usage.py:12` -> `services/usage_service.py:28-52` |

### 1a. Agent tool dispatch (not HTTP-reachable directly)

The LLM emits a `session_id` in its tool arguments. It is never trusted.

| Tool | LLM-supplied ids | Scoped? | Anchor |
|---|---|---|---|
| `update_topic_profile` | `session_id`, patch fields | **Overridden.** `dispatch()` rewrites `args["session_id"] = ctx.session_id` before validation (`agent/tools.py:86`); `apply_patch` then re-asserts `args.session_id != ctx.session_id -> failed` (`profile_service.py:336-341`). `ctx.session_id` is route-derived (`chat.py:289`, `sessions.py:740`). Defence in depth — the LLM cannot address another session. | `agent/tools.py:81-99` |
| `retrieve_chunks` | `session_id`, `query`, `k` | **Overridden** identically; `retrieve()` re-asserts at `retrieval_service.py:27-32`, and `query_chunks` filters `ChunkEmbedding.session_id == session_id` **and** `Document.status == "ready"` (`pgvector_store.py:78-84`). | `services/retrieval_service.py:26-61` |
| `ask_check_questions` | `session_id`, `items[]` | **Overridden** identically; `register()` re-asserts at `check_question_service.py:129-133`. | `services/check_question_service.py:123-138` |

---

## 2. Findings

### A-01 — Logout does not revoke the access token server-side, and the residual-validity window is undocumented
- **Severity:** Low
- **Category:** Security
- **Page/Area:** Authentication — session termination
- **Anchor:** `backend/services/auth.py:86-94` (validation), `backend/services/auth.py:131-163` (the only auth dependency), `frontend/src/stores/auth.js:88-92` (logout implementation)
- **Evidence:**

```python
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            issuer=expected_issuer(),
            leeway=JWT_LEEWAY_SECONDS,
            options={"verify_aud": True, "verify_exp": True, "verify_iss": True},
        )
```

  Validation is purely cryptographic and temporal. There is no `jti` denylist, no session-version column on `users` (`db/models.py:17-35` carries `id`, `created_at`, `accepted_terms_at`, `terms_version`, `display_name`, `feedback_pref`, `onboarding_complete` — nothing auth-generation related), and the full route inventory in §1 contains **no** logout, revoke, or token-introspection endpoint. Logout is client-only:

```js
  async function signOut() {
    const sb = getSupabase()
    const { error } = await sb.auth.signOut()
    if (error) throw error
    session.value = null
```

- **Steps to Reproduce:**
  1. Sign in as user A. Capture the `Authorization: Bearer <jwt>` value from any XHR (or read it from `localStorage`, where the Supabase SDK persists it — documented at `docs/security/SECURITY_REVIEW_2026-06-22.md:26`).
  2. Click Sign out in Settings (`frontend/src/components/settings/AccountTab.vue:216-218`). The SPA clears local state and Supabase invalidates the *refresh* token.
  3. Replay the captured access token against any authenticated endpoint, for example `GET /api/sessions` or `GET /api/profile/aggregate`.
- **Expected:** After an explicit sign-out, a previously issued access token is rejected — or, if the stateless tradeoff is accepted deliberately, the residual-validity window is written down so incident response knows how long a leaked token stays live.
- **Actual:** The request succeeds and returns user A's full session list / aggregate profile. `_decode_token` has no way to learn that a logout occurred; the token stays valid until its `exp`, plus the 30s `JWT_LEEWAY_SECONDS` at `auth.py:24`. A native-Grep sweep of `docs/` for `revocation|revoke|signOut|logout|token.*lifetime` returns only frontend-plumbing references in `docs/superpowers/plans/2026-08-02-unified-settings.md` and a token-storage note at `docs/security/SECURITY_REVIEW.md:170`. `docs/security/SECURITY_REVIEW_2026-06-22.md` covers the JWT `iss` claim and localStorage token storage, but never the post-logout window. It is nowhere stated.
- **Impact:** Narrow and precondition-heavy — it requires an attacker who already holds the token, at which point they already had access. The real cost is operational: "I signed out" and "I revoked access" are not the same thing here, and nothing tells an operator that. Signing out on a shared or public machine does not immediately close the window, and there is no documented answer to "how long until a leaked token dies?"
- **Fix:** The cheapest correct action is documentation, not code. Add a short subsection to `docs/security/SECURITY_REVIEW.md` stating that access tokens are stateless, that sign-out revokes only the refresh token, and recording the configured Supabase access-token TTL as the worst-case residual window. If a hard kill is wanted later, add a `token_valid_after` timestamp to `users` and reject tokens whose `iat` predates it inside `current_user_id` — one indexed read on a row the request already touches.
- **Confidence:** CONFIRMED (traced the code; the absence of a revoke endpoint is confirmed against the complete 29-route inventory in §1, and the documentation gap against a native-Grep sweep of `docs/`)

---

## 3. Verified safe — checked and explicitly cleared (no finding)

Recorded so the next audit does not have to re-derive them.

- **IDOR across every tenant object.** All 27 authenticated routes re-verified per the matrix in §1. Every session-keyed route performs `row is None or row.user_id != user_id -> 404` before touching data; every list/aggregate route filters on `user_id` in SQL. The 2026-06-22 conclusion still holds — no regression found. The service helpers that accept a bare, unvalidated `session_id` (`profile_service.py:159,186,198`; `pending_check_store.py:31,39,48`; `check_question_service.py:358,362`; `summary_service.py:167`) were traced to **every** call site: all sit downstream of a route-level ownership gate, or of another already-gated helper.
- **Background tasks do not escape the auth context.** `ingestion_service.run(doc.id)` (`upload.py:167`) is queued only after the `upload.py:100` ownership check, and operates on a `Document` the route itself just created. `_rolling_summary_task(req.session_id)` (`chat.py:379`) uses a `session_id` gated at `chat.py:168`. Both open their own DB session but derive scope from an already-owner-checked id.
- **Privilege escalation via JWT claims: not expressible.** Native `Grep` for `jwt_claims|user_metadata|app_metadata|request.state` across `backend/` (excluding tests) returns exactly three non-test hits, all in `services/auth.py` (`:126`, `:127`, `:162`). The single consumer is `accepted_terms_from_request`, reading one boolean used only for consent stamping. **No route or service reads a role, plan, tier, admin flag, or any ownership-bearing claim out of the token.** Authorization derives exclusively from `sub`, so there is no claim an attacker could self-set to gain privilege.
- **Object storage — mission item 5, answered structurally.** There is **no endpoint anywhere that serves uploaded file bytes**, and `main.py:49-57` mounts routers only — no `StaticFiles`, no upload directory exposed. User A cannot fetch user B's PDF because no user can fetch *any* PDF. Blob reads happen only inside server-side ingestion. Path construction is sound on top of that: `LocalDiskStore._path` resolves and enforces `candidate.parent == self._root` (`object_store.py:49-53`), which rejects `../` traversal *and* absolute-path replacement (`Path("C:/root") / "C:/Windows/x"` yields the absolute path, whose parent fails the check). Filenames are sanitized to `[A-Za-z0-9._-]` with `.` and `..` rejected (`upload.py:119-122`), so null bytes and separators never reach the store. `R2ObjectStore` keys are opaque S3 strings under a fixed `uploads/` prefix (`object_store.py:79,98-99`) — `../` carries no traversal meaning there.
- **Auth bypass surface (mission item 3).** Algorithms are pinned to an allowlist `["RS256","ES256"]` with a JWKS-resolved key, so `none` and HMAC confusion are both unreachable (`auth.py:86-94`). Signature, `exp`, `aud` and `iss` are all verified. JWKS behaviour is **fail-closed** in every direction: unreachable mid-request -> `PyJWKClientConnectionError` -> 503 (`auth.py:95-102`); unknown `kid` or otherwise invalid token -> 401 (`auth.py:103-107`); JWKS unconfigured at request time -> 500 `auth_not_configured` (`auth.py:40-44`); JWKS unusable at boot -> `RuntimeError`, the process dies (`auth.py:66-72`). No arm returns an unauthenticated success. Missing, malformed or empty bearer -> 401 (`auth.py:137-152`). A token lacking `sub` -> 401 (`auth.py:154-159`). Per instruction, not re-reported as findings.
- **`auth_optional` is not a prod bypass.** It defaults `False` (`config.py:44`); `main.py:20-21` raises when `env == "prod"` and `SUPABASE_URL` is empty; and even on the `auth_optional=True` path `validate_jwks_startup` merely *returns* (`auth.py:58-60`) — the request path still hard-fails at `_get_jwks_client` (`auth.py:40-44`). No path reaches a request handler with auth skipped. No finding, per instruction.
- **Session fixation and concurrent sessions.** Not applicable: the backend holds no server-side session state. Identity is re-derived per request from the JWT `sub`, so there is nothing to fixate across a login boundary. Multiple concurrent devices work by design (each holds its own token) and are correctly isolated, because all data access keys on `sub` rather than on a session handle.
- **403-vs-404 existence oracle: none found.** Every ownership failure returns 404 with the same body as the not-found case (`sessions.py:399,431,466,510,544,566,614,640,681`; `profile.py:37,70`; `upload.py:189,192`; `documents_service.py:100-104`; `chat.py:169`). 409 responses are only ever reachable *after* the ownership gate passes and describe the caller's own state (`session_ended`, `duplicate_topic`), so they leak nothing about other tenants. `documents_service.delete_document` uses one join for both the absent and the foreign case, so the two paths do comparable work.
- **`POST /api/sessions` `exclude_id` ordering — analysed, not a leak.** `_active_session_on_topic(..., exclude_id=req.prior_session_id)` at `sessions.py:161-163` consumes `prior_session_id` before ownership is checked at `sessions.py:175`. Traced: the query is `WHERE user_id == caller AND ended_at IS NULL AND lower(topic) = ... AND id != exclude_id` (`sessions.py:107-118`). Passing a victim's session id excludes an id that is not in the caller's result set, so the outcome (409, or falling through to the 404 at `:176`) is determined **solely by the caller's own sessions**. No existence oracle for another user's session.
- **Cost and rate limiting are per-tenant.** `rate_limit.check_and_increment(db, user_id)` and the `cost_meter` gate key on the authenticated `user_id` (`chat.py:137-201`, `upload.py:107`, `sessions.py:182,484,710`). One user cannot consume or observe another's quota. `usage_counters` and `daily_cost_ledger` are `user_id`-keyed (`db/models.py:100-111,165-173`).
- **Ownership checks precede irreversible side effects.** Deliberately verified, because ordering is where this class regresses: `chat.py:168` precedes the rate-limit increment and message persistence; `upload.py:100` precedes the rate-limit increment, the blob write and the `Document` insert; `sessions.py:175` precedes `_claim_end` and the summary LLM call; `sessions.py:680` precedes the batch clear and the paid follow-up turn.

---

## 4. Unanchored improvements

Not findings — these fail hard gate (b) (no concrete failure scenario provable from this repo). Listed only so they are not silently lost.

- **Supabase anonymous sign-in, if enabled on the project.** An anonymous Supabase user receives a JWT carrying `aud: "authenticated"` and a valid `sub`, which would pass `auth.py:86-94` and reach every authenticated route — granting an unregistered actor a full daily LLM quota. Whether this is reachable depends on a Supabase dashboard toggle that is not in the repo, so no failure scenario can be demonstrated here. Worth confirming the toggle is off during the deploy checklist.
- **`user_metadata.accepted_terms` is a self-attested claim.** `auth.py:122-128` reads it to stamp consent. Supabase signs `user_metadata`, but the signature attests only that Supabase issued it — an authenticated user can set the field themselves via `auth.updateUser({ data: ... })`. This is a consent-record-integrity nuance rather than an authz weakness (the user attests on their own behalf, and no privilege is attached), and the comment at `user_service.py:3-7` shows the direction was considered. Noted for the legal-record owner only.
- **`supabase_jwks_url_override` (`config.py:48,71-76`) redirects the entire trust root.** Anyone able to set that env var can make the backend accept tokens they signed. That is equivalent to full config compromise and is not a user-reachable vector, but it is worth ensuring the variable is absent from production env definitions rather than merely empty.
- **Legacy bare-filename blob fallback (`ingestion_service.py:90-95`).** `_load_blob` falls back to `store.get(doc.filename)` — an un-namespaced key — when the canonical `{doc_id}_{filename}` key is missing. In a flat shared store this could in principle read a same-named object belonging to another tenant. I could not construct a reachable scenario: ingestion is queued only after a successful canonical `put` (`upload.py:146-167`), so the fallback should fire only for pre-F-15 rows. Removing the fallback once no pre-F-15 documents remain would close the class outright.
