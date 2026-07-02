# Phase 8 — Launch: Design (umbrella)

Date: 2026-07-02
Status: active
Type: umbrella / sequencing doc (NOT a full feature design)

This is the parent doc for Phase 8. It frames and sequences the launch
workstreams; it does not design them. Each child workstream (WS-B..WS-G) gets
its own `docs/superpowers/specs/` design and `docs/superpowers/plans/` plan.

Source: `docs/planning/2026-07-02-post-v1-gap-backlog.md` (the gap analysis this
phase executes). Design doc `docs/superpowers/specs/2026-05-03-crux-v1-design.md`
remains the product source of truth.

---

## 1. Goal + exit criteria

**Goal:** take AdaptLearn from local-only (Phases 0-7 complete) to a publicly
reachable, legally-covered, backed-up v1 launch.

**Exit criteria — Phase 8 is done when:**
- Backend live on Render; frontend live on Vercel; both reach Supabase
  (Postgres + Auth) in production.
- ToS + Privacy Policy published; acceptance captured at registration.
- Automated R2 backup runs on a schedule; a restore has been performed once
  end-to-end and documented.
- Owed quality gates (WS-G) are cleared, or explicitly deferred with a recorded
  reason.

Out of scope for Phase 8: the v1 simplifications listed in the backlog
(mastered_candidates, evidence counters, gap canonicalization, background
finalizer, in-chat profile-edit tool, force-quiz selector, async
canonicalization, lemmatized keyword index) and the **waitlist gate** (cut
2026-07-02).

---

## 2. Cross-cutting decisions (locked 2026-07-02)

| Decision | Choice | Note |
|---|---|---|
| Backend host | Render (web service) | Free tier auto-sleeps ~15 min idle → cold start ~30-50s first hit. Acceptable for v1; revisit paid/keep-alive later. |
| Frontend host | Vercel (Hobby), **no payment card on file** | No card = hard cap, cannot incur a surprise bill. Hobby ToS is non-commercial — revisit host if the app monetizes. |
| DB + Auth | Supabase-managed (unchanged) | Not deployed by us. |
| Backups | Cloudflare R2 free (10 GB), accessed via an S3 client behind an interface | R2 speaks the S3 API. Migrating to paid AWS S3/R2 later = swap endpoint + keys, same client code. |
| Legal | Draft ToS + Privacy Policy in-repo; acceptance checkpoint at registration | Draft is a starting point, not legal advice. Label as such. |
| Waitlist gate | **CUT** | Do not build. |

These decisions are fixed for the child specs. A child may not re-open them
without updating this table.

---

## 3. Workstream sequence + dependencies

```
WS-A (this doc) ── frames ──> WS-B legal   ─┐
                              WS-C deploy   ─┼─ P0 launch trio (parallelizable)
                              WS-D backups  ─┘
                                             └─> WS-E editable profile (P1)
                                                  └─> WS-F product fixes (P1/P3)
                                                       └─> WS-G owed gates (fold in per-WS)
```

- WS-B / WS-C / WS-D have no dependency on each other and can run in parallel.
- WS-E is independent of the launch trio but sequenced after for priority.
- WS-F is small batchable fixes; F3 (persistent rate limit) may fold into WS-C
  if the deploy scales past one instance.
- WS-G is quality gates, not features; fold each into the relevant WS as it
  lands (e.g. live migration + diagnostic smoke alongside deploy).

---

## 4. Per-workstream pointers (scope only — full design lives in child specs)

- **WS-B · Legal (P0)** — draft ToS + Privacy Policy markdown; `/tos` and
  `/privacy` frontend routes/pages; registration checkbox + stored acceptance
  timestamp. Open: where acceptance is stored (User row column) + lawyer review
  is out of our scope (draft only).
- **WS-C · Deploy (P0)** — Render backend service with health-check path,
  SIGTERM graceful shutdown, migrate-on-deploy step, prod env/secrets; Vercel
  frontend with SPA rewrite + `VITE_*` build env; deploy runbook doc.
- **WS-D · Backups (P0)** — scheduled `pg_dump` of Supabase Postgres → R2 via an
  S3 client hidden behind a backup interface; retention policy; restore
  procedure doc; one proven end-to-end restore.
- **WS-E · Editable profile (P1)** — `PATCH`/`DELETE` for `mastered_concepts`
  and `confirmed_gaps`; optimistic-concurrency guard; ProfileView edit UI;
  contract additions (edit `docs/api/openapi.yaml` first, then codegen).
- **WS-F · Product fixes (P1/P3)** — F1 daily-cap 90% warning; F2 resume
  "review gaps" mode (3rd resume option starting on a gap); F3
  distributed/persistent rate limit (replaces in-memory `rate_limit.py`).
- **WS-G · Owed gates (P2)** — G1 live migration 0011 on Supabase + live-LLM
  diagnostic smoke (PR #99); G2 e2e suite rebuild (skipped since Phase 7, needs
  auth + Postgres in CI); G3 LLM reliability checkpoints (Phase 2
  `update_topic_profile` >=85%, Phase 3 focus-clear >=85%); G4 Phase 5 manual
  smoke + screencast.

---

## 5. Risks / watch items

- **Render cold start** hurts first-hit UX after idle. Acceptable for v1;
  revisit paid tier or a keep-alive ping if it bites.
- **Vercel non-commercial ToS** — revisit host if the app monetizes.
- **Unreviewed legal drafts** — publish labelled "draft, not legal advice";
  seek review before any real data collection at scale.
- **G3 reliability may miss >=85%** — per CLAUDE.md, that triggers 2-3 prompt
  iterations then a swap to `anthropic/claude-sonnet-4-6`.
- **Backup restore untested = false safety** — WS-D is not done until a restore
  has actually been run once.

---

## 6. Live status (single source of truth for Phase 8 progress)

Update this table as each child workstream advances. States: Not started /
Spec'd / Planned / In progress / Done / Deferred.

| WS | Title | Priority | State | Spec | Plan | Notes |
|---|---|---|---|---|---|---|
| A | Phase 8 umbrella doc | P0 | Done | this file | n/a | frames B-G |
| B | Legal: ToS + Privacy | P0 | Not started | - | - | |
| C | Deploy stack (Render + Vercel) | P0 | Not started | - | - | |
| D | DB backups (R2, S3-ready) | P0 | Not started | - | - | |
| E | Editable profile | P1 | Not started | - | - | |
| F | Product-gap fixes (F1/F2/F3) | P1/P3 | Not started | - | - | F3 may fold into C |
| G | Owed verification gates | P2 | Not started | - | - | fold into each WS |

---

## 7. Suggested execution order

1. **WS-A** (this doc) — frames everything. *Done on write.*
2. **WS-B legal + WS-C deploy + WS-D backups** — P0 launch trio, parallelizable.
3. **WS-E editable profile** — highest user-felt P1.
4. **WS-F product fixes** — quick wins.
5. **WS-G owed gates** — fold live-smoke / e2e / reliability in as each WS lands.
