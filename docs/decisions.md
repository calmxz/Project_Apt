# Decisions

Durable "why": decisions, findings, tradeoffs. Newest first. Technical
how-it-works lookup belongs in `docs/reference.md` instead.

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
