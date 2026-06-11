# Sessions UX + Performance — Design

Date: 2026-06-08
Status: Draft (awaiting user review)
Branch: `feat/sessions-ux-perf`

## Problem

Three observed issues on the Sessions home, the sidebar, and session loading, plus
one root-cause performance defect found while investigating:

1. **Every recent-activity card shows the same line** — "In progress — pick up where
   you left off." The home feed renders `recent_topics` from `GET /profile/aggregate`,
   whose `last_session_summary` is only written **when a session ends**
   (`summary_service.py:71`). Every active session therefore has a null summary and
   falls back to identical copy. Not a copy bug — a data-availability gap.

2. **The home feed is capped at 5 with no way to see more.** `recent_topics` is
   hardcoded to the last five sessions (`profile_service.py:230`, `sessions[-5:]`).
   The sidebar holds the full list, but there is no dedicated place to browse, search,
   or filter all sessions. The prior 2026-05-29 design intentionally locked the 5-cap
   and "no pagination" — this spec supersedes that decision for the home surface.

3. **The sidebar rows are thin** — topic + relative time + a status dot. No sense of
   where a session stands, weak current-session emphasis, and ended sessions auto-collapse
   past five rather than being a clear, switchable section.

4. **Selecting a session is slow — ~1.8–2.5s, measured live and reproducibly.**
   `GET /sessions/{id}` returns a tiny payload (19 messages, 16 KB) yet takes ~2s every
   time (not cold-start). Root cause confirmed in code: `_load_messages()` eager-loads
   all messages and calls `reconstruct_check_batch()` per check-message, issuing **N+1
   `LearningEvent` queries** against the remote Supabase DB, with **no index** on
   `chat_messages(session_id, created_at)` or the `learning_events` composite. The
   frontend compounds this: **no caching** (every revisit refetches), **no skeleton**,
   **no prefetch**, and the home page fires `GET /sessions` **twice** (sidebar + HomeView).

## Goals

- Cards (home + sidebar) describe each session distinctly and usefully.
- A full Sessions library to browse/search/filter beyond the home shelf's 5.
- A cleaner, richer, easier-to-scan sidebar with a clear active/ended split.
- Session selection that is fast on the server **and** feels instant in the UI.

## Non-goals

- No change to chat/streaming, the check-question flow, or the tutor agent.
- No redesign of the session *content* view beyond load/skeleton behavior.
- No infinite scroll on the home shelf (the 5-cap shelf stays; "View all" is the route).

## Scale & data reality (measured 2026-06-08)

Real account has 6 sessions. `topic_profile` signals are **sparse and mixed**:

| Session | `focus_target_gap` | `mastered` | last-msg preview |
|---|---|---|---|
| Glycolysis | set | 3 | rich |
| Glycolysis pathway | — | 0 | empty (cancelled turn) |
| Mitosis | — | 1 | rich |

Implication: no single signal is reliably present, so the card description must **layer
fallbacks**. The last-message preview is the most consistently distinct fallback and
therefore earns its payload cost. Empty previews (cancelled/empty assistant turns) exist
and must be skipped.

## Architecture: one initiative, four workstreams, phased

Everything hangs off one shared change — enriching session metadata — so the cards,
sidebar, and library all read the same payload. **WS0 ships first** (contract + migration
+ perf); WS1/WS2/WS3 follow as **separate plans and PRs** (matches this repo's
single-feature-PR history). WS3's warm prefetch **and** per-id cache are an **optional tail**
(both retention-based, same lifecycle risk), gated on whether the earlier perceived-speed
wins already suffice. (Reclassified 2026-06-10 — see WS3 below; warm prefetch is not "safe".)

```
WS0  Backend foundation (data + perf)   <- contract change + Alembic migration; ships first
       |
       +--> WS1  Home cards + /sessions library
       +--> WS2  Sidebar redesign
       +--> WS3  Frontend load speed (zero-retention cut first; prefetch+cache gated)
```

---

## WS0 — Backend foundation (data + performance)

Contract-first per repo discipline: edit `docs/api/openapi.yaml` →
`python backend/scripts/gen_contracts.py` → Alembic migration. CI enforces zero contract
drift.

### Payload enrichment

Add to **`SessionListItem`** (the list endpoint, consumed by sidebar + home + library):

- `message_count: int` — `COUNT(chat_messages)` per session.
- `last_activity_at: datetime | null` — `MAX(chat_messages.created_at)` per session
  (null when a session has no messages). Falls back to `created_at` for display.
- `progress: { focus_target_gap: str | null, mastered_count: int }` — derived from the
  already-stored `topic_profile_json` column (deserialize per row; no extra query).
- `last_message_preview: str | null` — trimmed content of the latest **non-empty**
  message, capped server-side at 120 chars; null when none.

All four must be produced with **set-based queries**, never per-session, so the
unbounded list endpoint does not re-introduce N+1:

- One `GROUP BY session_id` aggregate for `message_count` + `last_activity_at`.
- One `DISTINCT ON (session_id) ... ORDER BY created_at DESC` (Postgres) for the latest
  message content → preview. Filter out empty content in SQL where practical, else in
  Python.
- `progress` is a column read + JSON parse already happening for other paths.

At current scale (≤ tens of sessions, 120-char previews) the added list payload is a few
KB. If a user's session count grows large, the library route (below) is paginated; the
home shelf only needs the top 5 and the sidebar already renders all — revisit pagination
of the list endpoint only if profiling shows the enriched list itself regressing.

### Kill the N+1 on detail (`GET /sessions/{id}`)

- **Indexes** (Alembic migration): `chat_messages(session_id, created_at)` and a
  composite on `learning_events(session_id, gap_tested, question)`.
- **Batch-load check states**: replace per-message `load_check_batch()` →
  `reconstruct_check_batch()` with a single set-based load of the relevant
  `learning_events`/`check_batch_json` for the session, joined in memory.
- **Backfill `check_batch_json`** for legacy messages (migration data step or one-off
  script) so the live reconstruction path is never hit after deploy.
- Target: `GET /sessions/{id}` from ~2s to a few hundred ms.

### Library endpoint

Add a **paginated** variant for the `/sessions` library route (WS1): query params
`limit`, `offset` (or cursor), `status=active|ended|all`, `q` (topic search), `sort`.
Returns enriched `SessionListItem`s + a total/next-cursor. Keep the existing unpaginated
`GET /sessions` for the sidebar (full list) unchanged in shape aside from the new fields.

### WS0 tests

- List endpoint returns the four new fields; preview skips empty content; counts/last
  activity correct.
- Detail endpoint issues a bounded number of queries regardless of message count
  (assert no N+1 — e.g. query-count probe).
- Migration up/down; backfill idempotent.
- Contract drift check passes (codegen committed).

---

## WS1 — Home cards + `/sessions` library

### Card description (home recent-activity + reused in library/sidebar)

Layered precedence for the **primary description line**:

- **Active sessions:**
  1. `progress.focus_target_gap` set → `Focus: <gap>`
  2. else `last_message_preview` non-empty → the preview text
  3. else `progress.mastered_count > 0` → `<n> concept(s) mastered`
  4. else → fall through to meta only
- **Ended sessions:** `last_session_summary` (clamped 2 lines); else `Completed`.

Secondary **meta line** (always, subtle): `<message_count> messages · last active <rel>`
using `last_activity_at`.

This respects the chosen "focus gap first" while using preview as the strong fallback so
sparse-profile sessions are still distinct (resolves Problem 1 for active sessions).

### Home shelf

- Keep the calm **5-item** shelf (still sourced from `recent_topics`, now enriched the
  same way as the list — `recent_topics` entries gain the same fields).
- Add a **`View all sessions →`** affordance below the shelf linking to `/sessions`.

### `/sessions` library route (full library view)

- New route + view. Rich cards (same description logic), **search** by topic,
  **filter** Active | Ended | All, **sort** (last active / created / name), **pagination**
  via the WS0 library endpoint.
- Empty/loading/error states consistent with existing views.

### WS1 tests

- Card precedence unit tests across all fallback tiers incl. empty preview and ended.
- Library: search/filter/sort/pagination behavior; "View all" navigation.

---

## WS2 — Sidebar redesign

Builds on the 2026-05-30 sidebar (date groups, pins, search, rename/end/resume). Your
three asks:

- **Richer rows:** under the topic, a one-line description (same focus→preview→mastery
  layering, single line, ellipsised) + `last active <rel>`. Strong **current-session
  highlight**.
- **Tighter visual hierarchy:** density/spacing pass; clearer separation of group labels
  from rows; status conveyed without relying solely on the small dot.
- **Active/ended split:** replace the "auto-collapse ended past 5" behavior with an
  explicit **segmented toggle (Active | Ended)**. Pinned mini-group stays at the top of
  Active.

**Behavior decision — time semantics:** sidebar rows show and sort by `last_activity_at`
(falling back to `created_at`), and the Today/This-week/Older buckets are computed from
`last_activity_at`. Effect: a session you used today moves to **Today** even if created
last week. This is an intentional change from the current created-at bucketing.

### WS2 tests

- Rows render description + last-active; current session highlighted.
- Active/Ended toggle filters correctly; pinned stays under Active.
- Bucketing by last activity (a recently-touched old session appears under Today).

---

## WS3 — Frontend load speed

Two tiers, split by **retention**, not by the original "safe trio vs cache" line.

> **Reclassification (2026-06-10, brainstorm).** The original spec grouped *hover prefetch*
> with optimistic-render + de-dupe as a "safe trio," isolating only the SWR cache as risky.
> Tracing the code, that boundary is wrong. To make a **deliberate** hover (hover → pause →
> click ~600-800ms later) actually warm, you must **retain** the resolved detail and serve it
> on the click — and the moment you retain a resolved result you owe invalidation on
> `endSession` / `renameSession` / `reopenSession` / `answerCheck` / stream-start (a mutation
> can land between prefetch-resolve and click-consume). **That invalidation surface *is* the
> deferred SWR-cache work.** In-flight-*only* prefetch (never retain the resolved value) has
> zero invalidation surface but, post-WS0 (~200ms detail), the hover-to-click gap outlasts the
> request, so it warms ~nothing. Conclusion: **warm prefetch ≈ a smaller instance of the
> cache, same lifecycle risk** — so it moves into the gated tail with the cache, not the first
> cut. The honest split is **retention vs no-retention.**

### Cut 1 — no-retention (ships first, zero PR #72 exposure)

Nothing here retains a resolved detail across navigations, so there is no invalidation surface.

- **In-flight-promise guard (one primitive):** a `_inflight` Map in the store holding only
  *pending* promises (never resolved results). `listSessions()` keyed `'list'`,
  `loadSession(id)` keyed by id; concurrent calls reuse the pending promise, deleted on
  settle. This **de-dupes the double `GET /sessions`** on home load (HomeView + Sidebar now
  share one in-flight promise underneath — no change to their `onMounted` calls) *and*
  collapses concurrent same-id detail loads. No retained results ⇒ a reused promise is by
  definition as fresh as a new request.
- **Optimistic render:** on navigate, immediately paint the header from the already-known
  list row (topic, status) + a **message skeleton**, then swap when detail arrives. The
  optimistic header is **view-local in `SessionView`** (computed from `store.sessions.find(id)`);
  it is **never** written into `store.currentSession` — that ref is read by streaming/`endSession`,
  and a stub there is precisely the PR #72 bug class. **Interaction with PR #72's `notFound`:**
  optimistic paint → if the fetch fails/404s, clear the optimistic header and show the existing
  not-found state (do not leave a header for a deleted/stale session).
- **Message skeleton:** a new detail-area shimmer component, gated on a **detail-specific**
  flag (`detailLoading`), NOT the shared `loading` (list refetch also sets `loading` and would
  flash the skeleton). Hidden once messages for the current id arrive.
- **Dev-only timing log:** `performance.now()` from navigate → detail painted, behind
  `import.meta.env.DEV`. Zero prod overhead, removable. Produces the number that **gates** the
  tail below.

### Gated tail — warm prefetch + per-id SWR cache (only if still needed)

Both are **retention-based and decided together** by the Cut-1 measurement. Warm prefetch =
`GET /sessions/{id}` on sidebar row / home card hover/focus, result retained until click.
SWR cache = `Map<sessionId, detail>` serving cached detail instantly + background refetch.

**Why gated / sequenced last:** this component just shipped a switch-reload bug (PR #72, the
reason this branch exists). The store holds single live refs (`messages`, `pendingCheck`,
`currentSession`) mutated by streaming deltas, `answerCheck`, `endSession`, `reopenSession`,
`renameSession`. Any retained-detail mechanism must define snapshot-vs-live semantics and
invalidation on **each** of those mutations, or it regresses to stale/partial content (switch
away mid-stream → back → stale; end in sidebar → cached detail still "active"). **If WS0
(2s → ~200ms) + Cut 1 already make switching feel instant** (200ms behind a skeleton usually
does — confirm via the dev timing log), **build neither.** If built: entries are snapshots,
invalidated on any mutation to that session id, never used while a stream is in flight for
that id.

### Cut-1 measurement outcome (2026-06-11) — retention tail DEFERRED

Executed Cut 1 (subagent-driven-development); measured live via Chrome automation against the dev stack.

- **Median navigate→painted ≈ 693ms** across 10 real sidebar switches (warm ≈ 683ms; first 2292ms was a cold-start outlier). Per-session times were **flat ~666–985ms regardless of history length** — the 19-message Glycolysis session sat mid-pack at 804ms, not at the top. Flat-vs-length is the signature of **fixed per-request network overhead, not the `reconstruct_check_batch` N+1** (which would scale with message count). No backend N+1 hunt warranted.
- **Not production-representative.** The dev backend talks to **remote Supabase-managed Postgres**, so this measured `local FastAPI → WAN → hosted Postgres` — every query pays an internet round-trip. The ~250ms gate threshold was implicitly for production (backend co-located with the DB). A ~2.7× inflation from WAN round-trips on a multi-query endpoint is exactly expected.
- **Home issues ONE `GET /sessions`** (dedup confirmed via Network tab). **Optimistic header confirmed live** — the target topic paints immediately on click (perceived responsiveness = header-paint ~0ms, not content-arrival).

**Decision: ship Cut 1; DEFER the retention tail (warm prefetch + SWR cache) — neither cut nor built.** Switching already *feels* instant via the optimistic header + skeleton; the ~700ms is a dev WAN artifact that likely vanishes when backend and DB are co-located in prod. Building the cache + its invalidation surface (the PR #72 bug class) to mask a latency that may not exist in production would pay real complexity for a dev artifact. The **dev timing log is KEPT** to re-measure post-deploy against a production-like backend; the tail decision is re-gated on that number plus a "does switching feel instant?" human check.

**Switch-state correctness fixes landed beyond the plan-as-written** (holistic review + advisor, all reviewed): `isEnded` + `canEnd`/`canSend` use the same `currentSession?.id === props.id` discriminator as `headerTopic` (the optimistic header otherwise let the ended-banner/resume and the composer act on the *previous* session during a switch — wrong-session send + silent message loss); `loadCurrent` clears `lastError` on navigation (a prior session's send-error + wrong-session Retry could bleed over the new session); `loadSession` tracks `_latestRequestedId` and drops a superseded out-of-order commit (A→B→A with B resolving last would clobber `currentSession`/`messages`).
**Known fast-follow (pre-existing, not introduced):** a superseded load that *rejects* (e.g. an abandoned A request 404s after B paints) still runs `_setError`/`notFound` — the sentinel guards only the success-path write. Extend the discriminator into the error path in a follow-up.

### WS3 tests (Cut 1)

- In-flight guard: two concurrent `listSessions()` (and two concurrent same-id `loadSession`)
  issue **one** network call each.
- Home issues one `GET /sessions`, not two.
- Optimistic header shows (topic from list row) then swaps to real detail; 404 path clears it
  and shows not-found.
- Message skeleton shows while `detailLoading`, hidden once messages arrive.
- (If the gated tail is built) mutation invalidation: end/rename/reopen/answerCheck/stream each
  evict or update the entry, and the retained value is never served mid-stream.

---

## Phasing & PRs

1. **WS0** — contract + migration + perf (+ library endpoint). Ships first; merge to `dev`.
2. **WS1** — cards + `/sessions` library.
3. **WS2** — sidebar redesign.
4. **WS3** — Cut 1 (in-flight guard + optimistic render + skeleton + dev timing log);
   warm prefetch + SWR cache only if the measurement says Cut 1 isn't already instant.

Each workstream is its own implementation plan and PR.

## Risks

- **Live Alembic migration on Supabase** (indexes + optional backfill). Mitigation:
  indexes are additive/non-locking-ish at this size; backfill idempotent; you have run
  live upgrades before.
- **Enriched list query cost** on the unbounded sidebar list. Mitigation: strictly
  set-based queries; preview capped; profile after WS0.
- **`last_activity_at` bucketing change** alters sidebar ordering. Mitigation: explicit,
  documented, covered by tests; easy to revert to created-at if disliked.
- **Retained-detail lifecycle (warm prefetch + SWR cache).** Both retain a resolved detail
  and share one invalidation surface (end/rename/reopen/answerCheck/stream). Mitigation:
  gated/optional behind the Cut-1 dev-timing measurement, snapshot semantics, broad
  invalidation, or simply not built. Cut 1 retains nothing, so it carries none of this.

## Open questions

- Backfill of `check_batch_json`: migration data-step vs standalone script — decide in the
  WS0 plan based on row volume.
- Library sort default (last active vs created) — default to **last active**.
