# Decisions

Durable "why": decisions, findings, tradeoffs. Newest first. Technical
how-it-works lookup belongs in `docs/reference.md` instead.

## 2026-09-26 - Recall page order is weakest proof first, not most overdue (#363)

The #351 resolution asks for "queue order preserved (most overdue group
first, most overdue card first within it)". Those two halves agree only
when every due concept has the same evidence: the review queue sorts by
`(tested evidence last, due_at)` (R4.2 AC2, `review_queue_service.py`), so a
not-tested concept due 2 hours ago leads a tested one due 9 days ago.

- **Queue order wins** (owner call). The Recall page keeps the backend's
  order for dividers, cards within a divider, and the concept "Check <topic>
  now" starts with. A concept the learner never proved is the more useful
  check, even when its due date is newer.
- **The frontend does not re-sort by `due_at`.** Doing so would silently undo
  R4.2 AC2 on this one page and disagree with every other queue consumer.
  Due dates can therefore read out of order inside a divider; that is
  expected.
- **The 100-item cap stays for this PR.** The page fetches `limit=100` (the
  route's max); anything past 100 is unreachable until pagination lands
  (#385).

## 2026-09-25 - Topic card gating lives on the session row (#354)

Builds the #341 resolution (a `suggest_topics` card under the first at-level
reply).

- **"Level became known this session" is recorded at create, not inferred.**
  The level picker's PATCH leaves no trace, a chat-declared level lands
  mid-turn, and a graded diagnostic lands in the follow-up turn, so no single
  turn can tell. `sessions.topic_suggest_state` (migration 0031) is
  `awaiting_level` only when a session starts without a level and flips to
  `done` when the tool runs. Seeded, resumed-with-level, and
  declared-at-create sessions stay NULL and never get the card; so do rows
  created before the migration.
- **The prompt sees `TOPIC_SUGGEST: DUE | AFTER_LEVEL | OFF`.** AFTER_LEVEL
  lets the model call it in the same turn it records a declared level; the
  handler re-reads the profile and refuses while the level is still unknown.
- **A dismissed level picker does not cancel the card** (owner call). If the
  learner later states a level in chat, the reply that records it carries
  the card. Level wording is mapped to the nearest level ("I know the
  basics" -> intermediate); when the model cannot tell, it records nothing
  and asks one clarifying question, the only case where asking about level
  is allowed.
- **No second column for the card.** The ok `suggest_topics` call already
  persists in the message's `tool_calls_json`; the transcript reads it back
  from there (the `reconstruct_check_batch` precedent).
- **Prose first is enforced, not just prompted.** A call made before any reply
  text fails, so the model writes the reply and calls again. When a check and
  a topic card are bundled, the first terminal tool wins and the card stays
  owed.

## 2026-09-25 - Check items resolve in any order within a set (#348)

Follows the multi-set decision in #339: Skip survives as the explicit "don't
know", a skipped item satisfies Done, free navigation applies within one set,
and sets stay sequential batches.

- **The server dropped its linear guard.** `answer()` / `skip()` accept any
  still-pending index; a resolved or out-of-range index is still a 409, which
  also keeps the F-24 double-submit loser rejected.
- **`current_index` now means "first unresolved item"** (`len(items)` once
  every item is resolved). The response shape is unchanged, so `is_done`,
  Stop, and resume-on-reload keep working; the card counts its set-rule fill
  from item status instead, because the pointer no longer equals the resolved
  count.
- **Card:** Next shows on every item but the last, Back on every item but the
  first, and Done shows on the last item (or any item once all resolve) but
  stays disabled until every item is answered or skipped. A skip lands on the
  next unresolved item, wrapping; skipping the final one still ends the set.

## 2026-09-24 - Session view scrolls the page, not the messages box (#346)

Reverses the app-shell lock from PR #24 (`body.chat-locked`, `.messages` as the
sole scroller), which had no decision record.

- **The document is the scroller.** A body class (`session-page`) now drives
  only a flex-height cascade, so a short transcript still puts the composer at
  the foot of the viewport. The composer is pinned by a sticky `.notes-foot`.
- **Cards scroll with the transcript at every width.** The check batch and the
  level picker (DiagnosticConsentCard) render at the end of `.messages`, never
  in the foot. The width-dependent `isNarrow` split is gone.
- **Profile stays pinned, the header does not.** The cue strip (under 900px)
  and the profile panel (900px and up) stay sticky so the learner's focus and
  gaps stay in view. The session header scrolls away with the page: it is
  page chrome, and pinning it too would cost a third band of a phone screen.
- **Leaving the session resets the scroll.** There is no router
  `scrollBehavior`, so without the reset the next route would open scrolled
  down.
- **`overflow: clip` stays on the narrow sheet** so the expanded profile's
  overlay never grows the page; clip is not a scroll container, so sticky
  still resolves to the viewport. The 390px e2e spec now guards that the page
  height is unchanged when the profile opens.

## 2026-09-24 - Learner preferences reach the tutor prompt (#342, #356)

Supersedes the v1 design spec's "drop interaction_preferences, profile-only"
spike outcome (see also the 2026-05-04 entry below): #342 decided learners
set three preferences, and the tutor honors them.

- **Three enums on the users row.** `feedback_pref` [hints, direct_answers],
  `check_ins` [often, sometimes, only_when_asked], `reply_length` [brief,
  balanced, thorough]; defaults hints / sometimes / balanced. Migration 0030
  coerces pre-enum `feedback_pref` values to `hints`; NULL stays "never set"
  and reads as `hints`.
- **Per-request, not cached.** The `LEARNER PREFERENCES` block sits next to
  `CURRENT TOPIC PROFILE` in the dynamic context, so changing a preference
  never invalidates the cached `IMMUTABLE_RULES` prefix. The prefs ride the
  existing step-1 guard read, so a turn costs no extra statement.
- **only_when_asked is bounded.** DIAGNOSTIC and REVIEW-GAPS still call
  `ask_check_questions` on their own, and finishing a multi-set check the
  learner already started does not count as unprompted.
- **reply_length is guidance only.** No token cap; `thorough` overrides the
  base "Be concise" rule.

## 2026-09-24 - Check-question sets: diagnostic grading and learner stop (#340)

Departs from two points of the #339 resolution, decided while reviewing
PR #366.

- **Diagnostic is 1-3 sets, tutor's choice.** #339 point 5 fixed the
  diagnostic at 3 sets of 3. The tutor now picks `set_total`: 1 for a narrow
  topic, up to 3 when the topic has distinct subtopics worth sampling.
- **Diagnostic level graded once, over every set.** #339 point 4 keeps
  grading per batch. Grading the level from set 1 alone would have placed
  the learner on one subtopic's 3 items, while sets 2-3 ran as ordinary
  checks and wrote mastered/gap entries for subtopics never taught. Now the
  current-check pointer carries `purpose`, so later sets stay diagnostic (no
  mastery effects), and a running `diag` score. The level is written when
  the final set resolves, or when the learner stops or the session ends
  mid-check. Items a stop leaves unreached count as skipped, and skipped items
  stay in the denominator exactly as a Skip click does (#339 point 8, "early
  stop = skip"). An all-skip diagnostic still leaves the
  level unset (F-25).
- **Chat clarifies; the Stop button stops.** #339 point 8 left "the learner
  stops" open. The composer stays enabled and the card stays open while the
  learner chats, so a chat message never ends a check: the tutor sees the
  open question (stem and options, never the answer) and may clarify its
  wording without hinting. A "Stop check" button on the card calls
  POST /sessions/{id}/check/stop, which grades the rest of the open set as
  skipped and streams the results turn like /check/complete. Considered and
  rejected: "any message stops the check" plus an "Ask about this" button,
  which would have killed a check on every clarifying question typed into the
  normal composer.

## 2026-09-23 - Shell, chat and settings redesign

Replaced the broken half-tab sidebar toggle, the identity-less sidebar foot,
the two-stocks thread and the four-tab Settings with the Card Box's rail,
identity row, tutor-on-desk and three-tab Settings. Tickets 01-10, this repo's
`.scratch/shell-settings-redesign/`.

- **Icon rail over full hide.** Folding no longer hides the sidebar to a bare
  strip; it folds to a 3rem icon rail (ChatGPT-style) carrying the drawn
  "sidebar" toggle, New session, Search, Review (with due count), one dot per
  session, then the foot (Settings, identity initial). The old half-tab
  chevron overlapped the centred Crux mark at 3rem with neither cleanly
  clickable; the drawn toggle now sits in the head, above the mark when
  folded, so the two never share space. Ctrl+B, the persisted
  `crux.sidebar.expanded` key, the 60/40 widths and the mobile top strip /
  drawer are unchanged — only the toggle glyphs moved.
- **Identity row and user menu replace Sign out.** The sidebar foot now shows
  a 28px initial circle (card stock, 1px card edge, blue initial at 700)
  plus the display name, opening a lifted user-menu card (name, email,
  Account, Sign out) on click or keyboard. Root cause of the blank-identity
  bug: `stores/user.js` writes the literal string `'Learner'` when the
  learner leaves the display name field blank (`completeOnboarding` and
  `updateProfile`), so the identity row treats that placeholder as unset and
  falls back to the sign-in email. The store still writes the placeholder;
  a follow-up should stop writing it so `'Learner'` isn't baked into
  `display_name` rows that a future surface might render verbatim.
- **Account is its own route, not a Settings tab.** `/account` holds display
  name (with save and saved-flash), read-only email, password change and
  delete-account, styled in the same Settings-sheet grammar
  (`frontend/src/assets/sheet.css`, shared with `SettingsView.vue`) so the
  card shell, `.sec`, `.saved-flash` and `.skel-block` furniture are declared
  once. `/settings/profile` redirects to Learning; `/settings/account`
  redirects to `/account`. The Account page is a single column top to
  bottom (Account, Security, Danger sections stacked); the old Settings
  two-column-from-60rem grid was dropped rather than carried over, since
  password fields and the delete section read better in one line of sight
  than split across columns.
- **Tutor on the desk, not a second card stock.** The "Two Stocks Rule" is
  gone: `AssistantBubble.vue` renders the pencil head line and body flat on
  the desk (no edge, no drop, no stock) at the same 78% measure (92% under
  600px) the tutor card used; the landed tick, tool-activity aside,
  citations and typing dots keep their slots. The learner keeps its blue
  card unchanged. `MessageList.vue` grows the gap to 1.5rem only at a
  change of voice (`speakerChangeAt`), 0.75rem within one voice. Inline
  code chips now sit directly on the desk with no card to frame them; the
  Impeccable pass should confirm whether they read cleanly without a border
  or need one added.
- **Session action bar: 56px, shared handlers.** `SessionHeader.vue` is now
  a 56px bar with a 1px `card-edge` rule below it (was 72px, no rule, no
  actions). Left: topic link, level mark/word, middot, started. Right: 28px
  drawn icon buttons for Rename, Pin, End (Resume when ended), plus an
  8px reference-file status dot. Rename/pin/end/resume were lifted out of
  the sidebar row menu into `composables/useSessionActions.js` so the header
  and the sidebar row call the same implementation; End is disabled while
  `streaming` is true, since `store.endSession` never aborts an in-flight
  reply. The status dot reads the same `useReferencePoll` aggregate as
  `ReferenceStatusBanner`, mapping its `'pending'` value onto the header's
  `'processing'` vocabulary (`'ready'`/`'failed'`/`null` pass through).
- **Usage chart choices.** The today meter's soft/urgent/hard ticks are
  positioned as a fraction of the hard cap (`pctOfHard`), since hard is the
  only cap guaranteed non-zero. The seven-day chart draws past days in a new
  `--chart-bar-past` token (light `#5a78c2` / dark `#5570ad`, both clearing
  3:1 non-text contrast on `--desk-deep`, asserted by `tokenContrast.test.js`)
  and today in `--color-accent`, not `--color-accent-strong` as the spec
  named — in the dark theme `accent-strong` (3.16:1) reads fainter than the
  past-day token, which would make today the least prominent column instead
  of the most. The ledger rows stay the one accessible table; the SVG is
  `aria-hidden`.
- **Learning tab reads the aggregate endpoint.** `LearningTab.vue` calls
  `GET /profile/aggregate` for the per-topic overview, a weekly mastery
  series and a concept accuracy list. The server always returns 12
  zero-filled weekly points (`profile_insights.py`), so the tab gates its
  empty state on `total_sessions === 0`, not on array length, and shows
  "none yet" per section when every point is zero. Concept accuracy shows
  the 3 least- and 3 most-accurate concepts (server-sorted ascending, so
  the two slices are the array's head and tail). Grading ticks and crosses
  on the accuracy rows use `--ink-marker`, the same correctness exemption
  from the tab law that check-card grading already uses.
- **Delete account (`DELETE /api/me`).** 503 before touching any row when
  `admin_configured()` is false (checked against `supabase_secret_key` /
  `supabase_url`, not a new setting — the spec called for "a new
  service-role setting", but the repo already has one under a different
  name: `supabase_secret_key` replaced the legacy `service_role` key
  end-to-end, see `services/supabase_admin.py`). `services/user_service.py
  delete_user_account` deletes in one transaction in explicit FK order —
  chunk embeddings, documents, learning events, chat messages, LLM call
  log, usage counter, daily cost ledger, session rows (topic profiles are a
  JSON column on the session row, not a separate table, so they go with
  it), then the user row — commits, then best-effort deletes the object
  store blobs, then calls the Supabase GoTrue admin API to delete the auth
  user. A failure at the auth step after commit returns 503 naming that
  step (`"app data deleted; auth user removal failed"`); the frontend
  matches that literal string to show a retry-safe message instead of raw
  backend prose, and does not sign the learner out, since the delete is
  idempotent and a retry can finish the job. Known gap: between the app-data
  commit and a successful auth-user delete, the learner's still-valid JWT
  plus `ensure_user`'s lazy row creation could recreate an empty `users`
  row on any authenticated request; mitigated by the client signing out
  immediately on success, but not closed for the failure path until the
  auth step succeeds or the token expires. Object storage keys are per
  document (`object_store.key_for(doc_id, filename)`), not a per-user
  directory, so deletion iterates the user's document keys rather than
  removing one directory.
- **Rejected:** a keyboard shortcut reference card, and an in-app
  reduced-motion toggle (the OS-level `prefers-reduced-motion` media query
  already drives every animation in the build).
- **Process note:** destructive confirm buttons (`.confirm-delete-strong`)
  were painting PrimeVue's default blue inside `crux-dialog` and
  `p-confirmdialog` footers — a `(0,2,0)`-specificity PrimeVue rule beat the
  app's own selector. Fixed once in `frontend/src/assets/dialogs.css` with a
  `(0,5,0)` override covering both dialog contexts, rather than per-caller.

## 2026-09-23 - Archived the executed QA re-triage, the 10x roadmap, and the branch-protection script

Removed from the working tree. Everything is recoverable with
`git show c2ef3db:<path>` (last commit on `dev` before the removal).

| Path | What it was | Why removed |
|---|---|---|
| `docs/planning/2026-09-19-qa-retriage.md` | Re-verification of all 107 findings from the 2026-08-06 QA audit: 30 FIXED, 1 OBSOLETE, 1 ACCEPTED, 75 open (62 STILL + 13 PARTIAL) | All 75 open items were closed via waves 1-4 (issues #320-#326, #330, #331; PRs through #334, 2026-09-19 to 2026-09-21). Per-wave deviations are recorded in the entries below. |
| `docs/superpowers/plans/2026-09-19-qa-wave-{1,2,3,4}.md` | Executor plans for the four waves | Executed and merged. Same precedent as the 2026-07-12 slice-plan removal. |
| `docs/planning/2026-07-06-10x-roadmap.md` | Post-v1 roadmap (tracks R/P/D/S, dead-code audit, sequencing) | Status EXECUTED since 2026-07-12; slices 1-8 merged via PRs #106-#114. Only R5 remained; its acceptance criteria are preserved below so the demand gate survives the removal. |
| `docs/deploy/enable-branch-protection.sh` | W-07 script to apply branch protection + code-scanning default setup | Protection is now live on `dev` and `main` (verified via `gh api` 2026-09-23). Supersedes the 2026-09-19 note "W-07 deferred, not done". |

**Branch protection as actually configured** (diverges from the Phase 6 plan in
`docs/security/CI_INVENTORY.md`, which now records the live state):

- `dev`: required checks `Backend (pytest)`, `Frontend (Vitest + lint)`,
  `Security (SAST + deps + secrets + images)`, `Analyze (javascript-typescript)`;
  1 approving review required (maintainer merges with `--admin`);
  `enforce_admins` off.
- `main`: same checks plus `Analyze (python)`; no review requirement;
  `enforce_admins` off; signed commits required.
- `Playwright (chromium)` is not a required check on either branch (e2e is
  advisory; it runs on push/PR but does not gate merge).
- GitHub code-scanning *default setup* is `not-configured`; the `Analyze (*)`
  checks come from `.github/workflows/codeql.yml` (advanced setup). GitHub does
  not allow both, so enabling default setup would require removing the
  workflow first. The deleted script's default-setup PATCH was never run.

**R5 - Practice exam mode (demand-gated; do not build without user demand).**
Generate a timed, mixed practice exam from a session's uploaded documents plus
its gap list, reusing the existing check-batch machinery (batches of 1-5, MC,
server-graded).
- AC1: "Practice exam" action on sessions with a ready document: N questions
  (configurable 5-15) drawn to cover confirmed gaps first, then document
  keyword coverage; generated via one agent call using `ask_check_questions`
  batching (multiple sequential batches, no new grading path).
- AC2: Exam summary card: score, per-gap breakdown, wrong answers feed
  `learning_events` exactly like normal checks (so R2/R3 pick them up free).
- AC3: Cost-guard: exam generation respects the hard cap pre-check and shows
  estimated cost before starting.
- AC4: Live-LLM smoke checklist written (paid gate) before merge, matching the
  project's owed-smoke convention.

**Kept on purpose:** `docs/Crux_Spec.md` and `docs/Crux_DevPlan.md` (historical
v2 reference, listed in CLAUDE.md read order), `docs/deploy/ngrok.md` (still the
local public-demo path referenced by `docker-compose.prod.yml` and the READMEs),
`docs/dev/debug-accounts.example.txt` (template consumed by
`backend/scripts/seed_debug_accounts.py`), `docs/security/CI_INVENTORY.md`
(living CI rationale, updated this pass).

## 2026-09-21 - Issue #331: backend ETag (F-18 backend half)

- **Middleware, not per-route logic.** One allowlist of path prefixes
  (`/api/sessions`, `/api/profile`, `/api/review/queue`, `/api/usage/summary`)
  covers every hot GET with zero route churn -- no decorator, no response-model
  change, nothing for a new sibling route under those prefixes to remember. It
  also makes the SSE exemption structural rather than a convention: the layer
  filters on GET/HEAD, so the streaming POSTs (`/api/chat/stream`,
  `/api/sessions/{id}/check/complete`) are forwarded message-by-message and
  cannot be buffered even by mistake.
- **Pure ASGI, not `BaseHTTPMiddleware`.** Same reason as `lib/request_id.py`,
  `lib/body_limit.py` and `lib/error_handlers.py`: `BaseHTTPMiddleware` wraps
  every response in an anyio stream and would break SSE for the whole app.
- **Strong sha256 of the body, not `updated_at`.** Several hot GETs aggregate
  rows the caller never names -- session detail folds in the profile, the
  message page, the pending check and ingestion status; the usage summary folds
  14 days of ledger plus top sessions. A max-`updated_at` tag would need
  per-model plumbing on every one of them and would still miss a derived field.
  Hashing the serialised body is exact by construction and costs one sha256
  over an already-materialised payload. The tag is strong (no `W/`) because it
  is byte-exact; comparison on the request side is weak, per RFC 9110.
- **`cache-control: no-cache` on every tagged 200.** "Revalidate before reuse",
  not "do not store". Without a freshness header the browser heuristically
  reuses an ETag-bearing body without asking, and the `If-None-Match` this
  whole layer exists to answer never gets sent. A route that already set its
  own `Cache-Control` is left alone.
- **Registered between `BodySizeLimit` and `UnhandledError`.** That slot puts
  it inside `UnhandledErrorMiddleware` (a bug in the new layer surfaces as a
  coded 500, not a bare crash) and inside `CORSMiddleware` (a 304 carries
  `access-control-allow-origin`, so the browser can read it). `If-None-Match`
  and `ETag` had to be added to `allow_headers` / `expose_headers` -- neither
  is CORS-safelisted.
- **Not the body `etag` on the profile.** `profile_service.profile_etag` stays
  a body field used for `If-Match` optimistic concurrency on profile writes.
  Deliberately not unified with the HTTP header: they have different lifetimes
  (the body tag covers the profile only, the header covers the whole response)
  and conflating them would make a profile write's 412 depend on unrelated
  fields like `recent_learning_events`.

## 2026-09-21 - QA re-triage Wave 4 (issue #326): triage and deviations

- **A-01**: access tokens are stateless JWTs with no revocation primitive
  (`token_valid_after` / `denylist` / `jti` / `revoke` grep to zero hits in
  `backend/`); `backend/services/auth.py` verifies signature, `exp`, `aud`
  and `iss` only. Logout or a ban therefore takes effect only at the next
  access-token expiry, not immediately. Worst-case residual window = the
  configured access-token TTL, left at the Supabase default of **~1 hour**
  (`docs/auth/supabase-setup.md` section 8: "Leave the access token (JWT)
  expiry at its default (~1hr)"). Refresh tokens ARE revoked server-side by
  Supabase on sign-out, so a stolen refresh token cannot mint new access
  tokens post-logout; only the already-issued access token still works, and
  only until it expires. Accepted as-is: a revocation list is a feature, not
  a Wave 4 docs fix.
- **B-08**: the Render blueprint's cap tiers (soft 0.80 / urgent 0.90 / hard
  1.00; `cost_meter.py:213` derives urgent as `hard_cap * 0.9`) left only
  0.10 USD between soft warning and hard cutoff, too tight to act on. The
  hard cap is untouched (changing user-facing spend behavior is out of scope
  for a docs wave); only the blueprint's `LLM_SOFT_CAP_USD` in `render.yaml`
  drops to `0.50`, making the tiers 0.50 / 0.90 / 1.00. `backend/config.py`
  local/dev defaults (2.00 / 3.00) are unchanged and remain the source of
  truth outside the Render deploy target. See "Cost cap tiers" in
  `docs/reference.md`. These are blueprint values, not confirmed deployed.
- **C-14 deviation**: the recommended fix mapped service-layer `ValueError`
  to 409/422. Shipped 422 only, and only for the exact `ValueError` type;
  subclasses (pydantic `ValidationError`, `json.JSONDecodeError`) fall through
  to the coded 500 because an escaped one is almost always corrupt stored
  data, not a rejected input. 409 stays route-owned (If-Match / conflict paths
  already raise it explicitly).
- **G-13 wontfix**: `run_streaming` is a ~494-line generator with metering,
  partial-persist and tool dispatch interleaved across `yield` points.
  Extracting three seams is a behaviour-neutral refactor with a large
  regression surface (streaming order, abort persistence, cost double-count
  guard at `tutor.py:591-600`) and only a readability payoff. Revisit when a
  feature next touches `run_streaming`; do it then under that feature's
  tests.
- **Triage** (19 items from `docs/planning/2026-09-19-qa-retriage.md`, 17 fixed
  in this PR, 1 already fixed by Wave 1, 1 wontfix): A-01 fix, docs only (above). B-08 fix, docs
  + blueprint soft cap (above). C-14 fix, global exception handlers with
  `X-Request-Id` (Task A). C-15 fix, `documents.status` / `chat_messages.role`
  CHECK constraints (Task B). C-16 fix, `created_at` NOT NULL + server
  default (Task B). C-17 fix, `q` search param length cap and LIKE escaping
  (Task A). C-18 fix, tie-break ordering on `chat_messages` queries (Task A).
  D-21 fix, visually-hidden session `h1` fallback (Task C). D-22 fix, resting
  underline on the topic link (Task D). D-25 fix, composer Skip button
  removed (Task C, with E-20). E-15 fix, stuck "still processing" chip
  cleared on timeout (Task C). E-17 fix, check-question double-submit guard
  (Task C). E-18 fix, `ProfileView` reloads on id change (Task D). E-19 already
  fixed by Wave 1 E-01 (919d3a0: `startQuick` awaits inside try/catch and
  shows the error inline), no change. E-20 fix, dead `checkLocked`
  computed removed (Task C). F-20 fix, `useTheme` media-query listener leak
  (Task D). F-21 fix, optimistic chat row keyed by `client_id` (Task C).
  G-13 wontfix (above). G-14 fix, `profile_insights` split out of
  `profile_service` (Task A).

## 2026-09-20 - QA re-triage Wave 3 (issue #325): deviations from the recommended fixes

- **F-18 split: frontend half only.** The retriage asked for HTTP `ETag` /
  `If-None-Match` on hot GETs plus client retry and cache. The wave is
  frontend-only, so `apiClient.js` got the bounded GET retry (network errors and
  502/503/504 only, never for writes) and a 5 s in-memory GET cache; the server
  `ETag` is issue #331. The cache key is url **plus access token** and is cleared
  on auth expiry, because a sign-out/sign-in inside the TTL would otherwise serve
  account A's `/sessions` to account B. `getSessionProfile` bypasses the cache:
  the tutor writes the profile server-side mid-turn, which path-prefix
  invalidation cannot see, and a stale body ETag would 412 the next write.
- **F-16: cap on live append only.** `MAX_RETAINED_MESSAGES = 200` evicts from
  the top when a new message is appended and re-arms `hasMoreMessages`; a manual
  "load earlier" prepend is exempt, since dropping "the oldest page" there would
  evict what the user just asked for. The load-earlier cursor is the oldest
  retained server id, so eviction and paging line up.
- **D-16: `aria-controls` only on the selected tab**, not all four panels
  rendered hidden. Rendering every panel would defeat the `<KeepAlive>` that E-10
  relies on for refetch-on-reactivate.
- **E-08: writes serialised, not rejected.** The plan said both "ignore
  re-entrant calls" and "chain onto the previous ETag"; the profile view queues
  writes and threads each response's ETag into the next. Buttons are disabled
  while writing; the add-concept input stays enabled so Enter can queue several.
- **F-17 nginx: `map` + server-block `add_header`**, not `expires` inside
  `location /assets/`. An `add_header` in a location block drops every
  server-level header (CSP, HSTS, X-Frame-Options) for that location, which is
  an nginx inheritance trap; the map keeps one `Cache-Control` and all security
  headers. Same value as `vercel.json`: `public, max-age=31536000, immutable`.
- **F-15: list and indented-code closes are never a cache boundary.** markdown-it
  re-opens a list across a cut, so a cached head ending on
  `bullet_list_close` / `ordered_list_close` / `code_block` falls back to a full
  render. Parity with the full render is byte-identical across the fixture set
  and asserted in `markdownIncremental.test.js`.
- **E-12 / E-08 confirm dialogs reuse the file-delete contract**
  (`ReferenceStatusBanner.vue`): neutral text cancel, `confirm-delete-strong`
  accept, no icon.

## 2026-09-20 - QA re-triage Wave 2 (issue #324): deviations from the recommended fixes

- **F-10: no `chunk_embeddings.doc_ready` column.** The recommended
  denormalisation buys little: the join to `documents` stays for `filename`, and
  the status predicate is a PK-joined filter per candidate. pgvector 0.8.0 (live
  on Supabase) fixes the filtered-HNSW under-fetch directly with
  `hnsw.iterative_scan`, so the fix is `SET LOCAL hnsw.ef_search` +
  `iterative_scan = strict_order` on the search transaction. Partitioning stays a
  note in `docs/reference.md`. Owed: live EXPLAIN smoke.
- **F-09: no `learning_events (created_at, id)` composite.** Wave 1's 0025 added
  `(created_at)`; the review query filters `created_at >= window` over
  `session_id IN (...)` and the composite would not change the plan. Only the
  `chat_messages (session_id, id DESC)` index was added (0027).
- **C-11: enumerated human-readable strings, not codes.** `documents.error` is
  rendered verbatim by `ReferenceStatusBanner.vue` and `SessionView.vue`, so the
  value stays readable but is drawn from a fixed frozenset; only the raw
  exception text was removed. No contract or frontend change.
- **B-05: reservation instead of a row lock.** A `SELECT .. FOR UPDATE` in the
  gate releases at the gate's own commit, before the LLM call, so it cannot close
  the burst window. A provisional per-turn charge (`LLM_TURN_RESERVE_USD`, 0.02)
  added atomically at the gate and released at turn end does. Cost: the ledger
  reads 0.02 high during a turn; a crash mid-turn leaves it until midnight.
- **G-07: Render health check repointed to `/ready`.** A Supabase outage now
  fails the instance health check (Render restarts the instance) instead of
  serving 500s while "healthy". Takes effect at the next deploy.
- **F-19: `PyJWKClient(cache_jwk_set=True, lifespan=3600)` pinned** rather than
  inheriting PyJWT's 300 s default, which refetched JWKS 12x per hour behind the
  app's own 1 h cache.
- **Q-03: ruff backlog folded into the wave PR**, not a dedicated PR as the
  retriage suggested: import sorting after the fact would conflict with every
  file the wave touched. Ruleset `E,F,B,I`, ignore `B008` (FastAPI `Depends`
  defaults) and `E501`.
- **Q-05 stays open for the repo owner**: branch protection is a GitHub UI
  action (`docs/deploy/enable-branch-protection.sh`), not code.

## 2026-09-19 — Archived finished reviews, audits, and the Phase 0 spike

Removed from the working tree. Everything is recoverable with
`git show 1d0f4aa:<path>` (last commit on `dev` before the removal).

| Path | What it was | Why removed |
|---|---|---|
| `spike/` | Phase 0 validation spike: scripts, profiles, six committed transcripts, `decision.md` | Gate passed 2026-05-04. Never imported by app code, excluded from Docker, not in CI. Scripts referenced ADK and gemini-2.5, both long gone. Verdict preserved below. |
| `docs/reviews/2026-07-24-security-and-code-review.md` | Full-codebase review, 0 vulns, 1 Important | Only finding (upload-poll race) merged via PR #159. |
| `docs/reviews/2026-07-25-owed-smokes-ledger.md` | Ledger of owed live gates from PRs #106-#159 | Closed gates are evidenced in PR bodies. The PARTIAL items (ENV=prod compose smoke, HNSW re-EXPLAIN) and the still-open audit gates W-03/04/05/08/13 now live in `docs/deploy/RUNBOOK.md` step 7. |
| `docs/reviews/2026-08-06-qa-audit/` | 107-finding QA audit: `qa-report.md`, `_raw/A-G`, `bug-tracker.csv`, `deployment-checklist.md`, `improvements.md`, evidence JPGs | Verdict READY-for-closed-beta 2026-08-07. Remediation landed via PRs #215-#219 and the 2026-09-02 batch. Note: the CSV status column was never re-triaged after remediation, so 106 rows still read "Open" in git history; treat the CSV as the audit-time snapshot, not a live tracker. Deploy-time gate W-15 ported to `docs/deploy/RUNBOOK.md` step 2. |
| `docs/security/SECURITY_REVIEW.md` | 2026-05-23 audit, 12 findings H-1..L-2 | All resolved and re-verified 2026-06-22. H-3 request-size caps are locked by `backend/tests/test_max_length_validation.py`. |
| `docs/security/SECURITY_REVIEW_2026-06-22.md` | Addendum, 6 findings | All fixed by 2026-07-11 (vercel.json headers, JWT `iss`, JWKS fail-fast, S1 delimiter escaping, S2 rate-limit bypass). Live CSP curl verification is a deploy-time gate in RUNBOOK step 7. |
| `docs/screencast/script.md` | 2-3 min walkthrough script | Screencast never recorded (open since Phase 5). README linked a video that never existed. Record from the git-history script if the screencast is ever picked up. |

Kept on purpose: `docs/security/CI_INVENTORY.md` (living "why is this CI job
here"), `docs/deploy/enable-branch-protection.sh` (W-07 deferred, not done),
`docs/deploy/ngrok.md` (still the local public-demo path referenced by
`docker-compose.prod.yml`).

## 2026-05-04 — Phase 0 spike: profile differentiation validated

Question: do two hand-crafted learner profiles produce structurally different
tutor responses on the same topic, at turn 1 and still at turn 8? This was the
blocking gate for the whole premise (design doc section 7, Phase 0).

Method: three A/B pairs over database normalization, each run for 8 turns
through the immutable-rules prompt with a static profile injected.

| Pair | Model | Turn 1 differs | Turn 8 differs | Result |
|---|---|---|---|---|
| Knowledge level (beginner vs advanced) | gemini-2.5-flash | Yes, clear | Yes, clear | PASS |
| Guidance preference (hints vs direct) | gemini-2.5-flash-lite | Marginal | Yes, clear from turn 4 | WEAK PASS |
| Engagement (quiz-as-we-go vs absorb-then-test) | gemini-2.5-flash-lite | No | Subtle | MARGINAL |

Verdict: knowledge-dominant pass. Per the DevPlan matrix this is strictly
"Knowledge only", but pairs 2 and 3 ran on the lite model after the daily
flash quota ran out, so their result is a lower bound.

Decision: proceed to Phase 1 and 2 with `interaction_preferences` retained but
flagged for re-validation on the production model in Phase 3. That
re-validation was never formally recorded; Phase 3 shipped, the field stayed,
and later prompt audits (2026-09-10) treated guidance and engagement steering
as working. Treat the flag as closed by usage, not by measurement.

Side finding: the model attempted `update_topic_profile` calls in plain text
before any tool was registered, which is what justified betting on native
tool-calling for Phase 2.
