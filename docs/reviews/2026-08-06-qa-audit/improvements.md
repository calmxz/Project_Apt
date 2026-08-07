# Crux — Recommended Improvements

**Date:** 2026-08-06 · **Branch:** `dev` @ `a0cebfb`
**Companion to:** `qa-report.md` (107 findings) and `bug-tracker.csv`

This file holds **recommendations**, not defects. Anything with a reproducible failure
lives in the report and the tracker. Items here are improvements, hardening, and
opinionated suggestions — things that are not broken but that scale, launch, or a
second engineer would expose.

Keeping these separate is deliberate. Mixing "this is broken" with "this could be
better" is how audit reports stop being actionable.

---

## Quick wins

Low effort, meaningful payoff, ordered by payoff per hour. Every one of these is a
single sitting.

| # | Improvement | Effort | Why |
|---|---|---|---|
| QW-01 | Make the backend test suite hermetic (**Q-01**) | ~30 min | Restores the ability to trust a local test run and stops live production credentials entering every pytest process. Everything else here is easier once the suite is trustworthy. |
| QW-02 | Add `role="alert"` to five auth error paragraphs (**D-02**) | ~10 min | Five lines. Unblocks blind users from the login screen — currently a total workflow loss. The convention already exists in five other components. |
| QW-03 | Normalize the body-phase `TypeError` in the SSE client (**E-02**) | ~5 min | One line, mirroring the header-phase handler eight lines above. Removes "Failed to fetch" from the chat UI. |
| QW-04 | Use the tolerant profile parser in `sessions/lookup` (**C-01**) | ~5 min | One line. Fixes a High that is otherwise permanent and self-propagating per topic lineage. |
| QW-05 | Add `client_max_body_size 25m` to nginx (**C-02**) | ~5 min | One line. Un-breaks PDF upload — the entire RAG feature — on every compose deploy. |
| QW-06 | `inert` on the closed mobile drawer (**D-03**) | ~10 min | One attribute removes ~17 phantom tab stops. |
| QW-07 | Lighten dark-theme `--color-text-faint` to `#9099b0` (**D-05**) | ~5 min | One token. Makes the composer placeholder readable in dark mode. Use exactly this value — `#8089a3` still fails against `--color-surface-raised`. |
| QW-08 | Add a check-only `lint:check` script and point CI at it (**Q-02**) | ~10 min | Verified clean today, so it costs nothing *right now*. Every week deferred grows the backlog it will eventually surface. |
| QW-09 | `100dvh` in the sidebar (**D-18**) | ~2 min | The fix is already used correctly in `SessionView.vue`. Unhides the only route to Sign out on mobile. |
| QW-10 | Add `dev` to the `push:` trigger in both workflows (**Q-05**) | ~5 min | One line each. Closes the direct-push-to-integration-branch hole. |
| QW-11 | Add `, ChatMessage.id.desc()` to two `order_by` clauses (**C-18**) | ~2 min | Free determinism, and it makes the query index-friendly once F-09 lands. |
| QW-12 | `.catch(() => {})` on `startQuick` (**E-19**) | ~2 min | Matches three sibling call sites that already do this. Removes unhandled-rejection noise before error reporting is wired up. |
| QW-13 | `timeout-minutes: 15` + `if: failure()` on the backup workflow (**G-10**) | ~15 min | Turns a silent backup failure into a signal. Currently the only notification is an email nobody is watching for. |
| QW-14 | Enable branch protection on `dev` and `main` (**W-07**) | ~5 min, owner only | Dashboard action. Until this is on, every CI gate in the repository is advisory. |

### Sequencing note

**QW-01 comes first and is not negotiable.** An audit that recommends adding gates to a
project whose existing gate is permanently red is recommending noise. Fix the signal,
then add gates.

---

## UX improvements

### UI-UX-01 — Introduce one draft-preservation helper, and stop clearing input on non-success

Three separate findings (**E-05**, **E-11**, **E-14**) destroy user-typed text, and all
three share a root cause: an error arm in `stores/session.js` that `return`s instead of
throwing, so `SessionView.send()` reaches `lastSentText.value = ''` — a line that was
only ever meant to run on success.

The durable fix is not more `catch` blocks. It is making the success path unreachable on
failure. Persist the draft to `sessionStorage` keyed by session id before the send,
rehydrate it in `loadCurrent`, and clear it **only** on a confirmed `done` event. That
single change closes all three findings and makes the fourth (a future one) impossible.

### UI-UX-02 — Add cross-tab state sync

There is no cross-tab mechanism in the app except Supabase's `onAuthStateChange`. Two
tabs on the same account keep entirely independent `sessions`, `messages`, and
`pendingCheck`. Messages sent in tab A never appear in tab B until a reload; a check
question answered in A leaves B's card live and clickable, and B's POST then 409s
out of order. E-11 is the one case that was handled — and it is the one that loses data.

A `BroadcastChannel('crux')` emitting `{sessionId, event}` on send/end/answer, with the
store invalidating and refetching the open session, would close the whole class.

### UI-UX-03 — Give streaming a reconnect, not just a timeout

`SSE_IDLE_TIMEOUT_MS = 60000` is a give-up, not a retry. A three-second tunnel loses the
whole turn, and per E-03 the visible text with it — even though the server already
persisted the partial with status `cancelled`. A `Last-Event-ID`-style resume, or even a
simple "the connection dropped — [Resume]" affordance that refetches the session and
shows the server's partial, would turn the worst failure in the product into a two-click
recovery.

### UI-UX-04 — Guard unsaved input

No route leave-guard, no `beforeunload`, no dirty check anywhere: the composer draft,
the Settings display name, the ProfileView "add a concept" inputs, and the sidebar
rename field all evaporate on navigation. One shared `useUnsavedGuard(dirtyRef)`
composable registered via `onBeforeRouteLeave` covers all five.

### UI-UX-05 — There is no way to delete a session, ever

Sessions can be ended, reopened, renamed, and pinned — never removed. For a study tool
where the first few sessions are inevitably throwaway experiments, the Ended tab becomes
permanent clutter, and there is no privacy story for "I typed something I regret."

This is a product gap rather than a bug, but it is the most conspicuous missing verb in
the sidebar menu, and it interacts with a real constraint: per the cascade matrix in the
report, **the schema cannot support it today.** Every session-scoped FK is `NO ACTION`,
so a delete would fail on the first FK violation. Ship the migration and the endpoint
together, or not at all.

### UI-UX-06 — Reduce the click count to practise a weak concept

Getting from "I want to practise a weak concept" to an actual question is: sidebar →
Review (only visible when `reviewTotal > 0`) → pick an item → a new session is created →
land in chat → wait for the seeded turn. The alternative route is session → topic
heading → profile → Review gaps → gap picker → back to the session.

Two long, non-obvious routes to the same place — and the shorter one **hides its own
entry point exactly when a new user would go looking for it**, because the Review rail
item is gated on the queue being non-empty.

### UI-UX-07 — Phrase cost caps in units the user owns

"Daily cost limit reached ($0.42 / $0.50)" tells a learner about dollars they are not
spending. Phrase it in their terms: "you've used today's tutoring budget — resets at
midnight." Related to **B-08**, which compresses soft, urgent, and hard tiers into a
20-cent band so the warning arrives with almost no runway.

---

## UI improvements

- **Make the session topic link look like a link** (**D-22**). It is the *only* route to
  the richest screen in the app — gaps, mastery, subtopic levels, learning events — and
  it is styled as page furniture with a `title` attribute as the sole hint.
- **Give the composer a perceivable boundary** (**D-20**). At 1.21-1.45:1 the primary
  input of the application has effectively no visible edge in either theme.
- **Stop conveying correctness by colour alone** (**D-19**). Add an icon or text marker
  to check-question results; the current borders fail both 1.4.1 and 1.4.11.
- **Audit the remaining fixed-width containers.** D-12 found one dialog at a hard
  `24rem`; the same pattern is worth sweeping for before it appears again.
- **Adopt `min-width: 0` as a house rule on flex children.** D-13 is the classic flexbox
  overflow bug, and chat transcripts are exactly where users paste long URLs.

---

## Performance optimizations

Ordered by impact. The first three are not optimizations — they are the Criticals, and
they belong in the report. Listed here only as the shape of the work.

1. **Get ingestion out of the request process entirely.** A `render.yaml` `type: worker`
   fed by a durable queue, with the document row as the job record and an idempotent
   re-run, resolves **F-02**, **F-04**, and most of **B-02** in one architectural change.
   Everything else in the upload pipeline is a mitigation of the fact that it runs
   in-process.
2. **Cap documents by chunk count, not file bytes.** The 25 MB gate measures the wrong
   thing — a text-dense PDF decompresses far past it. `MAX_CHUNKS` rejected at upload
   time with a coded 413 fixes **F-03** at the source, and unlike horizontal scaling it
   actually works.
3. **Materialise the session centroid** (**F-05**). A `sessions.chunk_centroid vector(768)`
   column written once at ingestion replaces a 150-400ms event-loop block on every chat
   turn. This is the single highest-leverage query change in the codebase.
4. **Make the three unbounded list endpoints bounded** (**F-06**, **F-07**, **F-08**).
   All three scale with account age and all three sit on boot paths, so the pain arrives
   from your most engaged users first.
5. **Move synchronous DB I/O off the event loop** (**F-11**). Converting the handlers to
   `def`, or wrapping the DB segments in `run_in_threadpool`, removes the cross-stream
   coupling that makes a single worker degrade non-linearly.
6. **Cache the stable markdown prefix during streaming** (**F-15**) and virtualise the
   transcript (**F-16**). Both are mobile-first wins.
7. **Exclude the markdown/KaTeX chunk from the entry preload** (**F-14**) and add
   immutable cache headers to `vercel.json` (**F-17**). Together, roughly 160 kB and
   seven round-trips off every cold load.

---

## Security improvements

### SI-01 — Carry the taint boundary on the data, not on the turn

**G-01** is the sharpest finding in the audit, and it defeats a defense that is otherwise
well built. `agent/excerpt.py` wraps retrieved text in `<document_excerpt>` and
neutralizes embedded closing tags so a document cannot escape its own fence — correct
design, and it holds for the turn.

The flaw is that the fence is **per-turn, not per-provenance**. Summarization launders
the text through a trusted intermediary and it re-enters a *later* session as an unfenced
directive line. The general lesson generalises past this bug: any transformation passing
through a trusted intermediary — summarization, translation, "let the model rephrase it",
embed-then-retrieve — will strip a boundary that is not carried on the data itself.

Treat provenance as a property of the string, not of the code path it is currently in.

### SI-02 — Remove the legacy bare-filename blob fallback

`ingestion_service.py:90-95` falls back to `store.get(doc.filename)` — an un-namespaced
key — when the canonical `{doc_id}_{filename}` key is missing. In a flat shared store this
could in principle read a same-named object belonging to another tenant.

No reachable scenario could be constructed, which is why this is an improvement and not a
finding: ingestion is queued only after a successful canonical `put`, so the fallback
should only ever fire for pre-F-15 rows. But "should only fire for legacy rows" is a
property maintained by convention, not by the type system. Query for remaining pre-F-15
documents; if there are none, delete the fallback and close the class outright.

### SI-03 — Document the consent-record provenance of `user_metadata.accepted_terms`

`auth.py:122-128` reads this claim to stamp consent. Supabase signs `user_metadata`, but
the signature attests only that Supabase issued the token — an authenticated user can set
that field themselves via `auth.updateUser({ data: ... })`.

This is not an authorization weakness (the user attests on their own behalf, and no
privilege attaches to the claim), and `user_service.py:3-7` shows the direction was
considered. It matters only for the legal durability of the consent record. Route it to
whoever owns the legal record, not to engineering.

### SI-04 — Add a server-side token kill switch, if the threat model warrants it

Optional follow-on to **A-01**. A `token_valid_after` timestamp on `users`, checked
against the token's `iat` inside `current_user_id`, converts sign-out from "stop using
this token" into "this token is dead" — one indexed read on a row the request already
touches. Only build it if documentation proves insufficient.

### SI-05 — Guard against operator error on `llm_stub_enabled`

`config.py:80` returns true when `gemini_api_key == "test"`, in addition to the explicit
`LLM_STUB` flag. `render.yaml` correctly pins `LLM_STUB=false`, so prod is safe today —
but a placeholder key of exactly `test` would silently disable all LLM calls, tool
dispatch, and cost metering while still returning 200s. Not filed as a finding because it
requires an operator error that cannot be demonstrated, but the failure mode is silent
and total, which is exactly the kind worth removing.

### SI-06 — Plan for account deletion before the first request arrives

The product has a published privacy policy and **no delete path of any kind** — no
`DELETE /api/sessions/{id}`, no delete-account endpoint. A GDPR erasure request today
requires manual ordering across six child tables plus the object store, with no tested
script. Decide the approach now, while it is a design question rather than a deadline.

---

## Accessibility improvements

Beyond the 20 filed findings, three structural changes would stop this category
regressing:

- **Add automated a11y checks to CI.** `axe-core` via the existing Playwright setup would
  have caught D-08 (nested `main`), D-16 (dangling `aria-controls`), D-07 (labels on
  name-prohibited roles), and the contrast failures — roughly half of the D findings —
  automatically and on every PR.
- **Adopt a contrast budget in the token layer.** Every failure found (D-05, D-10, D-19,
  D-20) is a *token* problem, not a component problem. A test asserting each semantic
  token pair clears its threshold against every surface it is used on would make these
  unshippable rather than undetectable. Note the binding constraint is usually the
  *lightest* dark surface, not the darkest — the intuitive fix for D-05 fails.
- **Treat "blocks a core workflow" as a release blocker regardless of category.** All five
  High a11y findings independently prevent a real user population from completing a task
  that has no alternative route. That is not a polish backlog.

---

## Architecture suggestions

- **The upload/ingestion pipeline needs an owner and a redesign, not five patches.** All
  five Criticals live there. A worker service with a durable queue addresses F-02, F-04,
  B-02, and most of F-03 at once; patching them individually leaves the shape that
  produced them.
- **Add observability before adding features.** G-05 and G-06 mean the next incident is
  unresolvable regardless of how good the code is. `logging.dictConfig` plus
  `sentry-sdk[fastapi]` plus a request-id middleware is roughly a day of work and changes
  the operability of everything else. Handle the PII caveat in G-05 as part of it —
  turning INFO on *creates* an exposure that does not exist today.
- **Split liveness from readiness** (**G-07**), and make `/health` `async def` so it
  cannot be starved (**B-02**). The probe currently fails in both directions.
- **Introduce a global cost ceiling with a kill switch** (**B-04**). Per-user caps are the
  right primitive but they compose into an unbounded fleet exposure with no brake.
- **Decide the `session_id` guard convention in one direction** (**G-15**). Three services
  disagree about whether the downstream mismatch check is load-bearing. Either is fine;
  the mixed state is what will eventually get `tools.py:113` "simplified" away.

---

## Code quality suggestions

- **Add `ruff`** (**Q-03**). The backend has zero correctness-oriented static analysis
  today, against a frontend with two linters. Expect a first-run backlog; fix it in one
  dedicated PR.
- **Make the gates able to fail** (**Q-02**, **Q-04**). A lint step that auto-fixes and a
  coverage floor that ignores `routes/` and `agent/` both report green unconditionally.
  A gate that cannot fail is worse than no gate, because it manufactures confidence.
- **Write a direct test for `agent/tutor.py:_record_partial_cost`.** It is the money path
  on the cancel and error arms, its own docstring says it must never raise, and it has no
  direct test — only its dependency is covered. Coverage elsewhere on critical paths is
  genuinely strong, which makes this gap conspicuous rather than typical.
- **Add a regression test asserting document-derived text stays fenced across
  summarization.** This is the scenario G-01 exploits, and no test covers it.
- **Extract the three seams in `run_streaming`** (**G-13**) and split the aggregate half
  out of `profile_service.py` (**G-14**). Both splits are clean; neither is urgent.
- **Fix the `block_env.py` hook path.** Root `.claude/settings.json` registers the
  `PreToolUse` hook by relative path, so `Read`/`Write`/`Edit` are hard-blocked for any
  agent whose working directory is `frontend/`. **Six of the eight audit agents hit this
  and had to fall back to shell commands.** Making it `$CLAUDE_PROJECT_DIR`-absolute is a
  one-line change that stops silently degrading every subdirectory-scoped agent.
- **Note the `rtk` grep gotcha is real and cost time.** Two agents independently reported
  `rtk`-proxied `grep`/`rg` returning false zeros. The existing convention (use the native
  search tool for sweeps) is correct and worth keeping prominent.

---

## Long-term improvements

1. **Move to an async database engine and session.** The threadpool wrap fixes F-11 today,
   but a synchronous ORM under an async framework is the structural reason the event loop
   is contended at all.
2. **Partition `chunk_embeddings`.** At the stated scale the table reaches ~300M rows and
   ~920 GB, and any one session owns roughly one row in a million — which is precisely the
   shape that makes HNSW post-filtering pathological (**F-10**). Partition by session or
   user hash before ~10M rows, not after.
3. **Build a real job system.** Ingestion is the first background workload; spaced
   repetition, summaries, and any future batch work will want the same infrastructure.
4. **Introduce a materialised per-user aggregate.** F-07 and F-08 both scan history to
   produce a small summary. A row updated on session end serves both and removes two
   boot-path scans.
5. **Formalise the untrusted-content model.** G-01, G-02, and G-03 are three instances of
   the same gap: text from an untrusted origin loses its marking when it passes through a
   trusted transformation. A single wrapper type that survives summarization and
   interpolation would close all three and prevent the fourth.
6. **Decide the multi-tenancy story for cost.** Per-user caps, a global ceiling, and
   per-IP throttling are three different controls answering three different threats. The
   codebase has one of the three.
