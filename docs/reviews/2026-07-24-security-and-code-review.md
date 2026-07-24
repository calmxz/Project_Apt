# Full-Codebase Security Review + Code Review — 2026-07-24

Scope: entire codebase on `dev` (working tree clean, up to date with `origin/dev`).
Method: two independent review passes, each fanned out across trust boundaries
(backend / frontend / infra-CI), followed by an adversarial false-positive
verification pass on every candidate finding. Only findings that survived
verification appear below.

Result summary:

| Pass | Findings |
|---|---|
| Security review (backend, frontend, infra/CI/deploy) | 0 vulnerabilities |
| Code review (backend, frontend, cross-cutting) | 1 Important (confirmed), 1 Informational |

---

## Part 1 — Security Review

**No HIGH or MEDIUM findings.** All three areas came back clean. Verification
detail retained below so future reviews do not re-litigate settled ground.

### 1.1 Backend (`backend/`) — clean

- **AuthZ / IDOR:** every data route uses `Depends(current_user_id)`; every
  session/document/profile lookup enforces `row.user_id != user_id -> 404`
  (verified in `routes/sessions.py`, `profile.py`, `upload.py`,
  `documents.py`, `chat.py`, `review.py`, `usage.py`, `me.py`). Non-owned and
  non-existent both return generic 404 — no existence oracle despite
  sequential document IDs.
- **JWT (`services/auth.py`):** `algorithms=["RS256", "ES256"]` only (no
  HS256 alg-confusion), `verify_aud`/`verify_exp`/`verify_iss` all enforced,
  audience `"authenticated"`, issuer pinned, JWKS key resolved by `kid`,
  `alg: none` rejected. `AUTH_OPTIONAL` misconfiguration fails closed (500),
  never bypasses.
- **Agent tool layer (`agent/tools.py`):** dispatch overwrites
  `args["session_id"]` with the route-derived `ctx.session_id` before
  validation (`tools.py:84`); services re-check. A chat user cannot coerce
  `retrieve_chunks` / `update_topic_profile` / `ask_check_questions` into
  another tenant's session.
- **Injection:** no raw SQL with user input (ORM/parameterized throughout,
  library search uses bound `ilike`); no `pickle`/`eval`/`exec`/`yaml.load`/
  `subprocess` on user-controlled input.
- **Uploads / path traversal:** filename sanitized to `[A-Za-z0-9._-]`,
  `.`/`..` rejected, extension allowlist + magic-byte sniff,
  `LocalDiskStore._path` enforces `candidate.parent == self._root`; R2 keys
  prefixed.
- **Prior audit cross-check:** findings 2 (JWT `iss`), 3 (JWKS fail-fast),
  5 (excerpt delimiter forgery), 6 (check/complete rate-limit bypass) from
  `docs/security/SECURITY_REVIEW_2026-06-22.md` all confirmed fixed in
  current code.

### 1.2 Frontend (`frontend/`) — clean

- **XSS:** only 3 `v-html` sites (`MarkdownContent.vue:52`, `TosView.vue:2`,
  `PrivacyView.vue:2`), all fed exclusively by
  `lib/markdownRenderer.js`: `MarkdownIt({ html: false })` + full
  `DOMPurify.sanitize()` pass. KaTeX plugin is the patched
  `@vscode/markdown-it-katex` fork, and its output is still sanitized.
  Fence renderer escapes lang and body; linkify blocks
  `javascript:`/`data:` URIs. Citations (`doc_name` is attacker-influenced
  via uploaded PDF names) render via `{{ }}` interpolation only.
- **Tokens:** travel only in `Authorization: Bearer` headers (SSE is
  fetch-based, no token-in-URL). Supabase sessions in SDK-default
  localStorage — standard pattern; with no XSS vector and a strict CSP
  (`script-src 'self'`, no inline) there is no exploitation path.
- **Secrets:** only `VITE_SUPABASE_URL` + publishable key reach the bundle
  (publishable by design). No other secrets in `src/`, `vite.config.js`, or
  `index.html`.

### 1.3 Infra / CI / deploy — clean

- **CI:** no `pull_request_target` / `workflow_run` / `issue_comment`
  triggers; no attacker-controllable `${{ github.event.* }}` interpolated
  into `run:` steps. Secrets appear only in `backup.yml`
  (`schedule`/`workflow_dispatch` only — unreachable from fork PRs).
- **Docker/nginx:** prod backend uses `expose`, not host-published; nginx
  proxies only `/api/` and `= /health` (FastAPI `/docs` unreachable through
  the nginx tier); non-root containers; CSP + security headers present.
- **CORS:** explicit env allowlist, `allow_credentials=False`, pinned by
  tests.
- **Secrets in repo:** pattern greps (`sk-`, `AKIA`, `AIza`, JWT-shaped,
  `postgres://user:pass@`) across tracked files found nothing; only
  `.env.example` placeholders tracked; root `.env` sits outside the
  `./backend` Docker build context.
- **Debug flags:** `debug_timing` and `auth_optional` default False with
  fail-fast boot guard; `ENV: prod` set explicitly in prod compose and
  `render.yaml`; `LLM_STUB` defaults off.

Hardening note (below reporting bar, recorded for awareness): Render's
`crux-api` serves `/docs`/`/openapi.json` publicly when hit directly (not via
nginx). Schema disclosure only — all data endpoints require JWT. Optional fix:
`app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` when
`env == "prod"`.

---

## Part 2 — Code Review

Backend: no findings at high confidence (contracts, all 21 migrations,
profile guard rails, cost-ledger atomicity, `FOR UPDATE` locking, cancellation
handling all traced and verified). Cross-cutting: no drift between
`docs/api/openapi.yaml`, `backend/contracts/`, handlers, frontend services,
SSE event vocabulary, deploy env vars, or the alembic chain
(0001 -> 0021 linear, no orphans).

### Finding 1 (Important, CONFIRMED 9/10): upload-status poll has no session-switch guard

> **Status: FIXED 2026-07-24** on branch `fix/upload-poll-session-guard` via
> TDD (regression test "a session switch invalidates an in-flight upload poll"
> in `frontend/src/__tests__/sessionView.test.js`; watched fail, then pass).
> Full frontend suite 703/703 green, lint clean.

`frontend/src/views/SessionView.vue:479-535`

**Defect.** `onAttachFile` (line 479) awaits `pollUploadStatus` (506-535), a
30 x 1s `setTimeout` polling loop that writes the component-local
`uploadStatus` (writes at 512, 519, 523, 531) and `uploading` (set at 486,
cleared only in `onAttachFile`'s `finally`, 502) refs with no discriminator
tying the loop to the session it started in.

`/session/:id` reuses the same `SessionView` instance across session switches:
single route record with `props: true` (`router/index.js:82-86`), no `:key` on
`<component :is="Component">` (`App.vue:61-65`), and the component's own
comment at `SessionView.vue:393-395` states onMounted does not re-fire. The
`props.id` watcher (396-401) and `loadCurrent` (355-389) reset `notFound` and
`lastError` but never `uploadStatus`/`uploading`. Nothing cancels the poll:
no `onBeforeRouteLeave`, and the three `onUnmounted` hooks don't touch it (nor
would they help — the instance is never unmounted on an A -> B switch).

**Failure scenario.** User attaches a file in session A, clicks session B in
the sidebar before ingestion finishes (up to ~30s). The stale poll keeps
running (keyed by document id only, so requests keep succeeding) and paints
A's status text ("<A's filename> is ready. Ask a question about it." or a
failure message) into B's view via `<UploadStatus :upload="uploadStatus" />`
(line 105). Meanwhile `uploading` stays true, disabling B's attach button
(`Composer.vue:17`: `:disabled="disabled || uploading || locked"`) for up to
30 seconds. Attach only — the send path does not gate on `uploading`.
Self-heals when the loop ends; no data-integrity or billing impact — hence
Important, not Critical.

**Fix.** Adopt the generation-counter idiom already used for the identical
race in `ReferenceStatusBanner.vue:54-103` (guard checks at 85, 88, 94; bump
on `props.sessionId` watch at 132):

```js
// SessionView.vue, near line 197
let uploadGen = 0

// props.id watcher (396-401) becomes:
watch(
  () => props.id,
  (id) => {
    if (!id) return
    uploadGen += 1          // invalidate in-flight upload/poll from previous session
    uploading.value = false
    uploadStatus.value = null
    loadCurrent(id)
  },
)

// onAttachFile: capture gen at entry, guard every write
async function onAttachFile(file) {
  const gen = uploadGen
  // ...
  try {
    const resp = await uploadDocument({ sessionId: props.id, file })
    if (gen !== uploadGen) return
    referenceBannerRef.value?.refresh?.()
    await pollUploadStatus(resp.document_id, file.name, gen)
  } catch (e) {
    if (gen !== uploadGen) return
    // existing error handling
  } finally {
    if (gen === uploadGen) uploading.value = false
  }
}

// pollUploadStatus(documentId, filename, gen): add
//   if (gen !== uploadGen) return
// after each await, before every uploadStatus.value write (512, 519, 523, 531)
```

The guarded `finally` matters: after the watcher resets `uploading` and the
user starts a new upload in session B, the stale `finally` must not clobber
the new upload's `uploading = true`.

Suggested test: mount SessionView for session A, start an attach with a
never-resolving `getUploadStatus` mock, flip `props.id` to B, resolve the
mock, assert `uploadStatus` stays null and `uploading` stays false.

### Finding 2 (Informational): e2e CI gate still non-blocking past its sunset

`.github/workflows/e2e.yml:23` — job-level `continue-on-error: true` was a
deliberate Phase 3 soak, slated for revisit "after Phase 6". The project is
past Phase 8 + post-v1 slices; e2e failures still cannot fail CI. Not a code
defect (nothing is masked or fake-passing). Decision owed: either remove the
flag and make e2e blocking, or re-document the current rationale.

---

## Process notes

- Every candidate security finding path was checked by an independent agent
  per boundary; the single code-review finding was adversarially verified by
  a separate agent instructed to refute it (verdict: CONFIRMED, 9/10).
- Browser verification (claude-in-chrome) was not needed: no finding depended
  on rendered-page behavior beyond what the code establishes statically.
