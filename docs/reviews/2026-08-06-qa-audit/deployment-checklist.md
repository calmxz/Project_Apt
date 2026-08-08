# Crux — Production Deployment Checklist

**Date:** 2026-08-06 · **Branch:** `dev` @ `a0cebfb`
**Companion to:** `qa-report.md` (107 findings), `bug-tracker.csv`, `improvements.md`

This checklist separates three things that are easy to conflate:

- **Code gates** — judgeable by reading and running the repo. This audit judges them.
- **Verification gates** — require a live environment, a paid API call, or a mutating
  operation. This audit **cannot** close them; it can only report whether they were ever closed.
- **Human gates** — require a decision or a dashboard action by the owner.

A gate that was never executed is **not** a passing gate. It is an unknown, and for
launch purposes an unknown is a failure.

---

## Recommendation

# READY-for-closed-beta

**Updated 2026-08-07** after the launch-gating remediation sprint (PRs #215–#219, all
merged to `dev`) and the human-gate session of the same date. The original NOT READY
rationale is preserved below for the record; every item it names is now closed:

- **B-01 / F-03 / B-04** (cost cap, OOM, global ceiling) — PR #216.
- **F-02 / F-04 / B-02** (in-process ingestion) — PR #218 worker with DB queue + resume.
- **G-05 / G-06** (no production logging) — PR #217.
- **D-01..D-04 + C-02** (screen-reader blockers, nginx body cap) — PR #219.
- **Q-01 / Q-02 / Q-05** (test/CI foundations) — PR #215.
- **W-02** (unproven backup) — restore drill run 2026-08-07, PASS, mechanical RTO 2m29s
  (`docs/deploy/RESTORE.md`).
- **W-14** (anonymous sign-in) — verified disabled over the wire.

Scope note: this verdict is for a **closed beta of tens of users**, the narrower launch
the original audit itself called defensible. The 1M-user premise is formally out of scope
for v1 (see F-5).

**Conditions attached to this verdict** — deploy-time gates that cannot be closed until
the RUNBOOK deploy actually runs (no provider services exist as of 2026-08-07): W-15
(`SUPABASE_JWKS_URL_OVERRIDE` absent), `GLOBAL_DAILY_COST_CAP_USD` set on both services,
live alembic upgrade to head, `nginx -t` + real-PDF upload smoke, worker kill/resume
smoke, deployed-log observation of a chat turn and an ingestion run (W-01, W-03..W-05).
The W-13 owed paid smokes remain open and are accepted as closed-beta risk.

---

### Original recommendation (2026-08-06, superseded)

NOT READY — this is not a close call, and it is not a judgement on the quality of the
code — which is in several respects better than typical for a project at this stage. It
is a judgement on five specific Criticals that all live in one subsystem, one missing
operational discipline, and a backup that has never been proven.

**The three things that make this a hard NOT READY:**

1. **One user with one large file can take the service down for everyone.** A single
   25 MB `.txt` — an allowed extension — allocates roughly 630 MB and OOM-kills a 512 MB
   instance on its own (F-03); a text-dense PDF takes about three concurrent uploads to
   do the same. Ten uploads exhaust the entire database pool (F-02, F-01). Forty starve
   the request threadpool until Render restarts the box and kills every live chat stream
   (B-02). None of this requires malice — it is one person uploading their lecture notes.
2. **The dollar cap is not a cap.** Upload and ingestion never consult it (B-01), so spend
   is bounded by request count rather than dollars — roughly **34x** the configured limit
   per user per day, on a path the code itself calls "the largest embedding spender."
   (The multiplier is measured from chunk counts; the underlying per-token *rates* come
   from a table flagged in-code as a placeholder, so quote the ratio rather than a dollar
   figure until it is verified.) With no global ceiling and no kill switch (B-04), there
   is no server-side brake at all.
3. **The backup has never been restored** (W-02, G-09), and there is **no production
   logging** (G-05). If either the first or second item happens in production, you will
   have no diagnostic artifact and no proven recovery path. Those two facts compound: an
   incident you cannot debug and cannot roll back from is not an incident, it is an outage
   of unknown duration.

**What would change this verdict.** A focused remediation, not a rewrite. Fix B-01 (one
function call), cap documents by chunk count (F-03), move ingestion off the request
process (F-02, F-04, B-02), add `logging.dictConfig` plus a request id (G-05, G-06), and
run the restore drill once (W-02). That is on the order of a week, and it converts every
one of the launch blockers.

**A narrower launch is defensible sooner.** If the audience is a closed beta of tens of
users rather than a public launch, the capacity ceilings (F-01, F-06, F-07, F-08) drop to
Medium and the picture changes materially — but **B-01, F-03, G-05, and W-02 stay
blocking at any scale**, because they are about correctness, cost, and recoverability
rather than throughput.

---

## Passed

### Verified by execution in this audit

| Check | Evidence |
|---|---|
| Frontend unit suite green | `npm run test:unit -- --run` → 79 files, **831/831 passed**, 27.1s |
| Frontend linters clean (read-only run) | `oxlint .` → no output; `eslint . --no-cache` → "No issues found" |
| Frontend production build succeeds | `npm run build` → completed in 1.11s, chunk sizes recorded in the report |
| Repo working tree clean on `dev` | `git status` clean at audit start |

### Verified by source analysis

| Check | Evidence |
|---|---|
| **Multi-tenant isolation** | 29 endpoints traced decorator-to-SQL. 27 authenticated, 2 constant-returning health routes. Completeness proven by count, not assertion. **Zero IDOR findings.** |
| **Ownership-gate ordering** | Gates verified to run *before* rate-limit increments, blob writes, row inserts and paid LLM calls — not merely before the response. |
| **Agent tool-call scoping** | The LLM's `session_id` argument is overwritten server-side (`agent/tools.py:113`) and independently re-asserted by each service. The model provably cannot address another session. `user_id` appears in no tool schema at all. |
| **JWT handling** | Algorithms pinned to `["RS256","ES256"]`; `exp`/`aud`/`iss` all verified; JWKS **fail-closed in all four failure modes** (503 / 401 / 500 / boot `RuntimeError`). |
| **No file-serving endpoint** | Cross-tenant PDF access is structurally impossible — no route serves upload bytes and `main.py:49-57` mounts no `StaticFiles`. |
| **SQL injection** | Clean. No f-string, `%`-format or `.format()` reaches any SQL constructor in production code. |
| **Path traversal** | Triple-defended: `Path(...).name`, a `[A-Za-z0-9._-]` filter, and an independent containment assertion in the object store. |
| **Prompt injection (direct)** | Retrieved chunks are **not** raw-concatenated — `wrap_chunk` neutralizes an embedded `</document_excerpt>` so a PDF cannot close the fence early, backed by a dedicated rule block. (The *indirect* path via summaries is G-01.) |
| **Profile guard rails** | The `tested_correct` guard is real and session-scoped; the agent cannot self-attest `evidence_type="tested"`; `max_profile_list` is enforced at the write site on every path. |
| **Citations cannot be fabricated** | Built from DB rows, never parsed from model text. (Over-citation is G-11.) |
| **No secrets in the browser** | All three `VITE_` vars verified safe; the Supabase *publishable* key is the correct client-side key. `.env` gitignored; `gitleaks` runs over full history. |
| **Optimistic concurrency + check-question locking** | Correct, including lock-before-compare ordering. |
| **CI security tooling** | `gitleaks`, `semgrep` (OWASP), `bandit`, `trivy`, `pip-audit`, `npm audit`, `hadolint`, and **all 27 `uses:` SHA-pinned.** Above-average hygiene; see Q-06 for threshold caveats. |
| **Narrow-viewport settings rail (gate W-11)** | **Code-read suggests PASS** — `SettingsView.vue:187-203` is a grid item with non-visible overflow, so it receives `auto` min-size 0 and scrolls. This is a CSS-spec inference, **not** a browser observation, and W-11 was owed specifically as a visual check. See W-11 below: still open pending confirmation. |

---

## Failed

| # | Check | Evidence | Blocking? |
|---|---|---|---|
| F-1 | **Cost cap bounds spend** | **CLOSED 2026-08-07** — PR #216: ingestion cap gate (B-01), chunk caps (F-03), global daily ceiling (B-04). | ~~Yes~~ Closed |
| F-2 | **A single user cannot degrade service for others** | **CLOSED 2026-08-07** — PR #216 (chunk caps close the OOM, F-03) + PR #218 (ingestion moved to a worker with DB queue, streaming batches, idempotent resume — B-02/F-02/F-04). Live worker kill/resume smoke owed at deploy. | ~~Yes~~ Closed |
| F-3 | **Production failures are diagnosable** | **CLOSED 2026-08-07** — PR #217: `dictConfig` logging + request ids (G-05/G-06). Deployed-log observation owed at deploy. | ~~Yes~~ Closed |
| F-4 | **Backups are restorable** | **CLOSED 2026-08-07** — restore drill run and PASSED (see W-02). RPO 24h, mechanical RTO proven at 2m29s. | ~~Yes~~ Closed |
| F-5 | **Service capacity meets the stated premise** | **DOWNGRADED 2026-08-07** — launch scope is a closed beta of tens of users, at which the capacity ceilings drop to Medium (per this document's own Recommendation). PR #218 additionally removed the worst offender (connection-holding in-process ingestion). 1M-user premise formally abandoned for v1. | ~~Yes~~ Out of scope |
| F-6 | **Backend test suite green on a developer machine** | **CLOSED 2026-08-07** — PR #215: hermetic tests (Q-01), real lint gate (Q-02), CI on dev pushes (Q-05). | Closed |
| F-7 | **Core workflows complete for screen-reader users** | **CLOSED 2026-08-07** — PR #219: D-01..D-04 fixed. Manual screen-reader pass still advisable post-deploy. | ~~Yes~~ Closed |
| F-8 | **Upload works on the compose deploy** | **CLOSED 2026-08-07** — PR #219: nginx `client_max_body_size` raised (C-02). Live `nginx -t` + upload smoke owed at deploy. | ~~Yes~~ Closed |
| F-9 | **User input is never silently destroyed** | **CLOSED 2026-08-08** — PR #220: typed `StreamAbortedError` rethrown from the send-stream error arms; SessionView restores the draft (E-11), stashes it to `sessionStorage` across the auth redirect (E-05), and retry sends the edited composer text (E-14). E-05 end-to-end auth round-trip smoke (real token expiry through login and back) still owed — tests cover the two halves separately. | ~~No~~ Closed |
| F-10 | **CI gates are enforced** | **PARTIALLY CLOSED 2026-08-07** — Q-05 (CI on dev pushes) and Q-02 (real lint gate) fixed in PR #215. W-07 (branch protection) deliberately deferred by owner — solo-dev friction call; script at `docs/deploy/enable-branch-protection.sh`. Q-04 closed 2026-08-08 (PR #220): coverage gate widened to `routes`/`agent`/`db`, measured TOTAL 95% against the intact 75 floor. Follow-up recommended: ratchet floor toward 90. | No, but compounding (W-07 only) |

---

## Warnings — owed verification gates never executed

Carried forward from the project's own ledgers (`docs/reviews/2026-07-25-owed-smokes-ledger.md`,
memory index, PR bodies #106-#214), plus two new ones from this audit. None are new
findings; all are **open**. A launch decision that ignores them is uninformed.

| # | Owed gate | Origin | Status |
|---|---|---|---|
| W-01 | **Production deploy is PAUSED at the Render step** | Phase 8 / review 2026-07-18 | Open. Step 0 banked (R2 backup armed, DB at 0021+). Everything below depends on this. |
| W-02 | **R2 restore drill never performed** | WS-D / PR #102, #150 | **CLOSED — PASS 2026-08-07.** Newest dump restored into a scratch pgvector/pg17 container; all app-table row counts verified, alembic head `0022`, live vector query, `auth.users` intact. Mechanical RTO 2m29s. 268 ignored errors, all Supabase-infra, zero on `public.*`. Full log + findings in `docs/deploy/RESTORE.md`. C-15/C-16/C-18 did not fire. |
| W-03 | **Live CSP header verification** | Slice 7 / WS-C | Blocked on W-01. The `CRUX_API_HOST` placeholder is substituted at deploy time; an unverified substitution is an unverified CSP. |
| W-04 | **Cross-origin `X-Cost-Warning` expose-headers over the wire** | Slice 7 | Blocked on W-01. |
| W-05 | **Live TTFT and pool-ceiling observation** | Slice 7 | Blocked on W-01. The report carries a *computed* ceiling (10) — this gate would confirm it. |
| W-06 | **Clean-clone `docker compose` smoke** | Batch 1 / PR #116 | **CLOSED — PASS 2026-08-08.** Fresh `git clone` → `dev` @ 09af5da, user-placed root `.env`, `docker compose up --build -d`: backend healthy + `/health` 200, frontend 200, worker up. Real-PDF upload exercised through the browser (602B PDF via composer attach): nginx proxy → backend → worker ingestion → "1 reference ready" — the C-02-class path works from a clean checkout. Test doc deleted via UI afterward; clone torn down. |
| W-07 | **Branch protection + code scanning toggle** | Phase 6 | **DEFERRED — owner decision 2026-08-07.** Solo-dev closed beta; friction outweighs benefit for now. Not launch-blocking (F-10 is "No, but compounding"). Ready-to-run script preserved; revisit when a second contributor or public traffic arrives. |
| W-08 | **HNSW recall re-`EXPLAIN` at realistic volume** | Slice 7 | Open. `chunk_embeddings` had 8 rows at last check so the planner correctly ignores the index. See F-10 for what this will look like at scale. |
| W-09 | **Local docker images are stale** | Ledger 2026-07-25 | **CLOSED — PASS 2026-08-08.** `docker compose build --no-cache` on `dev` @ 09af5da (post-#220): frontend, backend, worker images rebuilt; `docker compose up -d` → backend `/health` 200 + container healthcheck healthy, frontend 200 on :5173, worker up. |
| W-10 | **Phase 5 screencast** | Phase 5 | Open. Non-blocking for correctness. |
| W-11 | **Narrow-viewport rail check** | PR #210 | **CLOSED — PASS 2026-08-08.** Verified in a real Chrome window at a true 500px viewport (script-opened popup on the rebuilt local stack; the main window refused programmatic resize, so evidence is programmatic DOM assertions at 500px rather than a screenshot): `documentElement.scrollWidth` 485 ≤ 500 (no horizontal overflow), settings `.layout` grid collapsed to a single 445px column, `.rail` has `overflow-y: auto`, sidebar switched to `sidebar--drawer` (breakpoint fired), zero elements clipping with `overflow-x: visible`. |
| W-12 | **Post-merge visual pass for glance stats** | PR #212 | **CLOSED — PASS 2026-08-08.** Settings Profile + Usage glance areas checked in the browser on the rebuilt stack, light and dark: stat tiles (33 sessions = 32 active + 1 ended, 10 mastered, 12 gaps, 63 events), knowledge-level distribution line, needs-attention links, mastered/gap chips, usage line (`Today $0.00 · Last 7 days $0.03`), cap bar and top-3 session costs all render sanely in both themes. Evidence: `evidence/w12-settings-{profile,usage}-glance-{dark,light}.jpg`. |
| W-13 | **Assorted owed paid smokes** | PRs #103, #104, #108, #110, #111, #114, #179 | Open. This audit deliberately ran none, to respect the cost cap. |
| W-14 | **Confirm Supabase anonymous sign-in is DISABLED** | **New — Audit A** | **CLOSED — PASS 2026-08-07.** Verified empirically over the wire, not by dashboard read: `POST /auth/v1/signup` with empty body and the publishable key returned `422 {"error_code":"anonymous_provider_disabled","msg":"Anonymous sign-ins are disabled"}`. |
| W-15 | **Confirm `SUPABASE_JWKS_URL_OVERRIDE` is absent from prod env** | **New — Audit A** | **RECLASSIFIED 2026-08-07 → deploy-time gate.** No Render services exist yet (deploy still paused at W-01), so there is no prod env to inspect. Must be verified — absent, not merely empty — during the RUNBOOK deploy, alongside setting `GLOBAL_DAILY_COST_CAP_USD` on both services. `config.py:48,71-76`. |

---

## Remaining risks

Risks that persist even after the blockers above are fixed.

1. **The upload pipeline's shape, not just its bugs.** Five Criticals in one subsystem is
   a design signal. Patching them individually leaves in-process background work holding
   pooled connections on a memory-constrained instance. The durable fix is a worker
   service; anything less means the next load-related defect lands in the same place.
2. **No global cost brake.** Even with B-01 fixed, per-user caps compose into an
   unbounded fleet exposure (B-04). The only lever is revoking the API key — manual,
   total, and after the fact.
3. **Latent restore hazards that only fire during recovery.** C-15 (`documents.status`
   unconstrained), C-16 (`created_at` nullable), and C-18 (non-deterministic prompt
   ordering) are all unreachable through the current API and all become reachable during
   a restore or manual data repair — which is precisely when you least want a 500. The
   restore drill (W-02) is the gate that would surface them.
4. **Migration locking as the dataset grows.** C-12 shows three applied migrations that
   take blocking locks with no `lock_timeout`. They ran clean only because the tables are
   small. The next index migration on a populated table is a self-inflicted outage unless
   the `CONCURRENTLY` pattern is adopted first. *2026-08-08: the required patterns
   (CONCURRENTLY via `autocommit_block`, `NOT VALID` then `VALIDATE`, `lock_timeout = '5s'`
   on hot tables) are now codified in the local migration-reviewer checklist item 4 and the
   project-conventions skill — local-only files (`.claude/` is gitignored), so no repo diff;
   the reviewer agent enforces them on every future migration.*
5. **No account-deletion path, against a published privacy policy.** The schema cannot
   support one today — every session-scoped FK is `NO ACTION`. This is a design decision
   deferred, not a bug, but the deadline for making it is set externally.
6. **Accessibility will regress without automation.** Twenty findings were reachable by
   static analysis alone. Roughly half would be caught by `axe-core` in the existing
   Playwright setup; without it, the same defects return with the next feature.
7. **The audit itself has blind spots, stated plainly.** No live browser session, no paid
   LLM traffic, no live database queries. Every UI, UX, and accessibility finding is
   code-read rather than observed. Runtime-only defect classes — real rendering, actual
   screen-reader behaviour, genuine network conditions, live model outputs — were not
   exercised and could hold further findings.

---

## Suggested order of work

1. **QW-01** — make the test suite hermetic. Everything else is verified against it.
2. **B-01** — one function call. Closes the largest cost hole.
3. **F-03** — cap documents by chunk count at upload. Closes the OOM.
4. **G-05 + G-06** — logging config and correlation ids, with the PII caveat handled.
5. **W-02** — run the restore drill. Expect it to fail the first time; that is the point.
6. **F-02 / F-04 / B-02** — move ingestion to a worker. The architectural fix.
7. **D-02, D-01, D-03, D-04** — the accessibility blockers. Small diffs, large populations.
8. **W-07 + Q-05 + Q-02** — make the gates real, then keep them green.
