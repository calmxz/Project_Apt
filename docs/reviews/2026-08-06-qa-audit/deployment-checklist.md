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

# NOT READY

This is not a close call, and it is not a judgement on the quality of the code — which is
in several respects better than typical for a project at this stage. It is a judgement on
five specific Criticals that all live in one subsystem, one missing operational
discipline, and a backup that has never been proven.

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
| F-1 | **Cost cap bounds spend** | **B-01** — upload/ingestion never call `check_cap`. ~34x the configured cap per user per day (ratio measured; underlying rates are a placeholder table). | **Yes** |
| F-2 | **A single user cannot degrade service for others** | **B-02**, **F-02**, **F-03** — one 25 MB `.txt` (or ~3 concurrent PDFs) OOMs the instance, 10 uploads exhaust the DB pool, 40 starve the threadpool and trigger a restart that kills all live streams. | **Yes** |
| F-3 | **Production failures are diagnosable** | **G-05** — no logging config exists; `log.info` is discarded and surviving lines have no timestamp, logger, or level. **G-06** — agent-loop failures carry no session or user id. | **Yes** |
| F-4 | **Backups are restorable** | **W-02 / G-09** — `RESTORE.md:23` states "Not yet run" by the document's own admission. RPO 24h, RTO unknown. | **Yes** |
| F-5 | **Service capacity meets the stated premise** | **F-01** — 10 concurrent connection-holding requests, one worker, one instance. Short of 1M users by 3-4 orders of magnitude. | **Yes** at stated scale |
| F-6 | **Backend test suite green on a developer machine** | **Q-01** — `pytest` from `backend/` → 3 failed. Green in CI only because the runner has no `.env`. Live credentials load into every test run. | No, but fix first |
| F-7 | **Core workflows complete for screen-reader users** | **D-01, D-02, D-03, D-04** — a blind user cannot get past login unaided, and gets silence after answering a check question. | **Yes** |
| F-8 | **Upload works on the compose deploy** | **C-02** — nginx caps bodies at the 1 MB default; every realistic PDF 413s with an HTML page the frontend cannot parse. | Yes for that path |
| F-9 | **User input is never silently destroyed** | **E-05, E-11, E-14** — three paths clear the composer on non-success. | No, but high-complaint |
| F-10 | **CI gates are enforced** | **W-07** — branch protection never enabled, so every check is advisory. **Q-05** — no CI on direct pushes to `dev`. **Q-02** — the lint gate auto-fixes and cannot fail. **Q-04** — the coverage floor ignores `routes/`, `agent/`, `db/`. | No, but compounding |

---

## Warnings — owed verification gates never executed

Carried forward from the project's own ledgers (`docs/reviews/2026-07-25-owed-smokes-ledger.md`,
memory index, PR bodies #106-#214), plus two new ones from this audit. None are new
findings; all are **open**. A launch decision that ignores them is uninformed.

| # | Owed gate | Origin | Status |
|---|---|---|---|
| W-01 | **Production deploy is PAUSED at the Render step** | Phase 8 / review 2026-07-18 | Open. Step 0 banked (R2 backup armed, DB at 0021+). Everything below depends on this. |
| W-02 | **R2 restore drill never performed** | WS-D / PR #102, #150 | **Open — highest-risk gate.** Backup cron has 6 consecutive green scheduled runs; the restore half is unproven. See G-09. |
| W-03 | **Live CSP header verification** | Slice 7 / WS-C | Blocked on W-01. The `CRUX_API_HOST` placeholder is substituted at deploy time; an unverified substitution is an unverified CSP. |
| W-04 | **Cross-origin `X-Cost-Warning` expose-headers over the wire** | Slice 7 | Blocked on W-01. |
| W-05 | **Live TTFT and pool-ceiling observation** | Slice 7 | Blocked on W-01. The report carries a *computed* ceiling (10) — this gate would confirm it. |
| W-06 | **Clean-clone `docker compose` smoke** | Batch 1 / PR #116 | Open — and **C-02 is exactly what it would have caught**. |
| W-07 | **Branch protection + code scanning toggle** | Phase 6 | Open, owner dashboard action. Until enabled, all CI gates are advisory. |
| W-08 | **HNSW recall re-`EXPLAIN` at realistic volume** | Slice 7 | Open. `chunk_embeddings` had 8 rows at last check so the planner correctly ignores the index. See F-10 for what this will look like at scale. |
| W-09 | **Local docker images are stale** | Ledger 2026-07-25 | Open. Backend image built 2026-07-18, verified stale by content. Any "smoke tested in docker" claim older than a rebuild is void. |
| W-10 | **Phase 5 screencast** | Phase 5 | Open. Non-blocking for correctness. |
| W-11 | **Narrow-viewport rail check** | PR #210 | **Still open, but de-risked.** Code-read at `SettingsView.vue:187-203` says it scrolls correctly. That is a CSS-spec inference; this gate was owed as a *visual* check and no browser was run, so it is not closed. Expected to pass. |
| W-12 | **Post-merge visual pass for glance stats** | PR #212 | Open. |
| W-13 | **Assorted owed paid smokes** | PRs #103, #104, #108, #110, #111, #114, #179 | Open. This audit deliberately ran none, to respect the cost cap. |
| W-14 | **Confirm Supabase anonymous sign-in is DISABLED** | **New — Audit A** | Not verifiable from the repo. If enabled, an anonymous JWT carries `aud: "authenticated"` and a valid `sub`, passes `auth.py:86-94`, and reaches **every** authenticated route with a full daily LLM quota. Cheap to check, expensive to miss. |
| W-15 | **Confirm `SUPABASE_JWKS_URL_OVERRIDE` is absent from prod env** | **New — Audit A** | `config.py:48,71-76`. Setting it redirects the entire trust root. Must be **absent**, not merely empty. |

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
   the `CONCURRENTLY` pattern is adopted first.
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
