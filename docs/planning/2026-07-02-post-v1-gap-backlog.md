# Post-v1 Gap Backlog — 2026-07-02

Source: feature-gap analysis run 2026-07-02 (Phases 0-7 complete). This is a
BACKLOG / decomposition doc, not a design spec. Each workstream below gets its
own `docs/superpowers/specs/` design + `docs/superpowers/plans/` plan before
implementation.

User decisions folded in (2026-07-02):
- Draft legal (ToS + privacy).
- **Waitlist gate: REMOVED from scope** (do not build).
- Create the Phase 8 doc.
- DB backups: S3 is the eventual target; for now use a FREE alternative.
- Do the deploy stack.
- Build editable profile.
- Fix the product gaps.
- Do the owed tasks.

Legend: P0 launch-blocker · P1 core gap · P2 quality/owed · P3 polish

---

## Workstreams (divided)

### WS-A · Phase 8 umbrella doc  (P0, do FIRST)
The Phase 8 launch phase has no plan doc. Write it as the parent that sequences
the deploy/legal/backup workstreams below. Waitlist gate explicitly cut.
- Deliverable: `docs/superpowers/specs/` Phase 8 design + plan.
- Depends on: nothing. Blocks: framing for WS-B/C/D.

### WS-B · Legal: ToS + Privacy Policy  (P0)
No legal docs, no `/tos` `/privacy` routes, no acceptance flow. Can't launch
collecting user data without them.
- Scope: draft ToS + Privacy Policy markdown; frontend routes/pages to display;
  minimal acceptance checkpoint at registration (checkbox + stored timestamp).
- Evidence: no legal docs in repo; `routes/` has no tos/privacy.
- Open Q: acceptance stored where (User row column?) + is a lawyer review needed
  (draft = starting point, not legal advice).

### WS-C · Deploy stack  (P0)
Only local `docker-compose.yml`. No prod deploy config.
- Scope: production container/deploy config, prod env/secrets handling, health
  check suitable for the platform, graceful shutdown (SIGTERM), migration-on-
  deploy strategy, deploy runbook doc.
- Evidence: no `fly.toml`/prod IaC; `main.py` shutdown handler unverified.
- Open Q: target platform (Fly.io per CLAUDE.md, or other free-tier?).

### WS-D · DB backups (free-tier now, S3-ready later)  (P0)
No backup/restore. Data-loss risk.
- Scope: scheduled logical backup (pg_dump) of the Supabase Postgres to a FREE
  destination now, written behind an interface so an S3/R2 driver drops in
  later. Restore procedure + doc. Retention policy.
- Evidence: no S3 client, no `backup_service.py`.
- Open Q: which free destination (see options at bottom).

### WS-E · Editable profile  (P1 — most-felt user gap)
`routes/profile.py` is GET-only. User can't fix a wrong mastered-concept / gap.
- Scope: PATCH/DELETE routes for `mastered_concepts` + `confirmed_gaps`,
  optimistic-concurrency guard, ProfileView edit UI (delete + maybe rename),
  contract additions (openapi.yaml first, then codegen).
- Evidence: `routes/profile.py` GET-only; ProfileView read-only.

### WS-F · Product-gap fixes  (P1/P3, batchable)
Small independent fixes:
- F1 · Daily-cap 90% warning (P3) — warn before hard block.
- F2 · Resume "review gaps" mode (P1) — 3rd resume option starting on a gap.
- F3 · Distributed/persistent rate limit (P1) — `rate_limit.py` is in-memory,
  resets on restart + breaks multi-instance. Only matters once WS-C scales past
  one instance; scope may fold into WS-C.

### WS-G · Owed verification tasks  (P2)
Not features — quality gates already promised.
- G1 · Live migration 0011 on Supabase (USER GATE) + live-LLM diagnostic smoke (PR #99).
- G2 · e2e suite rebuild — `resume-carries-profile.spec.js` skipped since Phase 7;
  needs auth + Postgres in CI. Plus remaining Playwright scenarios.
- G3 · LLM reliability checkpoints — Phase 2 `update_topic_profile` ≥85% +
  Phase 3 focus-clear ≥85%, never measured/recorded.
- G4 · Phase 5 manual smoke + screencast walkthrough.

---

## Explicitly OUT of scope (intentional v1 simplifications — do NOT build)
mastered_candidates, evidence counters, gap canonicalization (0.88 cosine),
background stale-session finalizer, in-chat profile-edit tool, force-quiz gap
selector, async canonicalization, lemmatized keyword index. (design doc §3.4/§5)
**Waitlist gate** — cut per user 2026-07-02.

---

## Free backup destination options (for WS-D decision)
- **Supabase built-in** — paid plans have daily backups; free tier does NOT.
  So need our own.
- **GitHub Actions cron + pg_dump → private repo / release asset / Actions
  artifact** — free, simple, size-limited, behind our own interface.
- **Cloudflare R2 free tier** — 10 GB storage, S3-compatible → same driver as
  the eventual S3 target (best "S3-ready later" fit).
- **Backblaze B2 free tier** — 10 GB, S3-compatible.
Recommendation to confirm in WS-D brainstorm: **R2 free tier** (S3-compatible
now = zero-rewrite migration to paid S3/R2 later).

---

## Suggested sequence
1. WS-A (Phase 8 doc) — frames everything.
2. WS-B legal + WS-D backups + WS-C deploy — the P0 launch trio (parallelizable).
3. WS-E editable profile — highest user value P1.
4. WS-F product fixes — quick wins.
5. WS-G owed tasks — fold live-smoke/e2e in as each feature lands.
