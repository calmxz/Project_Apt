# Owed-smoke sweep — 2026-07-25

Ledger built from the PR bodies of #106-#159 (the authoritative gate list), then
executed against live Supabase, the current repo build, and Chrome. Branch `dev`,
clean, at `df79a68`.

Legend: **CLOSED** = evidence produced this session. **PARTIAL** = substance
verified, one leg still blocked. **BLOCKED** = cannot be run unattended.

## Closed

| Gate | Origin | Evidence |
|---|---|---|
| Nightly R2 backup cron is armed and green | Phase 8 WS-D / PR #150 | `#150` merged 2026-07-18T09:40Z. `db-backup` workflow: 6 consecutive scheduled runs green (2026-07-19 → 2026-07-24), preceded by the 4 red dispatch runs that PR #150 fixed. Restore drill still owed (mutating). |
| 0021 pre-deploy duplicate-active-topic check | PR #151 | `SELECT user_id, lower(topic), count(*) FROM sessions WHERE ended_at IS NULL GROUP BY 1,2 HAVING count(*)>1` → **0 rows** on live. Index build will not fail. |
| Alembic 0017 HNSW index applied | Slice 7 | `ix_chunk_embeddings_embedding … USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)` present on live. |
| Alembic 0018 cascade FK name check | Batch 5 / PR #120 | `chunk_embeddings_document_id_fkey` has `confdeltype='c'` (ON DELETE CASCADE) on live. |
| Live Postgres smoke of the R2 spaced-repetition queue query | Slice 5 / PR #110 | Current `dev` code (`routes/review.py:get_review_queue`) run against live Supabase: user A total=1, user B total=13 due items, earliest due 2026-05-30. Non-empty, so the join + purpose filter + schedule path is genuinely exercised. |
| Live Postgres check of the 2 new insights read queries | Slice 6 / PR #111 | `profile_service.aggregate_for_user` on live: user B → 14 sessions, `concept_accuracy` 13 rows, `weekly_mastery` 12 buckets. Both new aggregates return data, not empties. |
| D-G3 e2e `.summary-dialog` selector sweep | Batch D / PR #154 | Zero dialog-class selectors in `frontend/e2e/*.spec.js`; `SessionView.vue:140` still carries `class="crux-dialog summary-dialog"`. Gate is a no-op — nothing to break. |
| D-G4 zero-CDN + self-hosted font render | Batch D / PR #154 | `npm run build` → zero `googleapis`/`gstatic`/`fonts.google` strings anywhere in `dist/`; 7 app woff2 emitted (bricolage 1, ibm-plex-mono 2, inter 4). `vite preview` in Chrome: `performance.getEntriesByType('resource')` CDN hits = **0**; `document.fonts` loaded = Bricolage Grotesque 400/700, Inter 400/600; headings computed to Bricolage, body to Inter. Zero console messages on reload. |
| Built-bundle meta CSP emitted by the Vite plugin (I-06) | Batch E / PR #155 | `dist/index.html` carries `default-src 'self'; connect-src 'self' https://*.supabase.co http://localhost:8000; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self';` — `connect-src` correctly tracks `VITE_API_BASE_URL`. No CSP violations on load. Scope: built in the `.env.local` (`http://localhost:8000`) configuration only — the docker path, where `Dockerfile` sets `VITE_API_BASE_URL=/api` so the meta CSP must come out byte-identical to nginx's header, was not built and remains unverified. |

## Round 2 — after the user applied 0021 and left the docker stack logged in

| Gate | Origin | Evidence |
|---|---|---|
| 0021 applied and correct | PR #151 | Live `alembic_version` = `0021_sessions_indexes`. Both indexes present: `ix_sessions_user_id`, and `uq_sessions_active_topic` as `UNIQUE (user_id, lower(topic)) WHERE ended_at IS NULL` — B-05 guard is now DB-authoritative. |
| F-08 route-change focus (D-G1) | PR #154 | `#main-content` has `tabindex="-1"`; sidebar nav to `/profile` leaves `document.activeElement` = `MAIN#main-content`. On `/session/:id` the composer autofocuses instead — intentional, not a miss. |
| F-10 focus rings present (D-G1) | PR #154 | 14 consecutive Tab stops instrumented via `focusin`: 14/14 resolved either a `2px solid var(--color-accent-ring)` outline (buttons, links) or the documented accent-border treatment (text inputs, per the 2026-07-23 composer ruling) — zero bare stops. **But see the contrast finding below.** |
| F-18 live regions (D-G1) | PR #154 | In SessionView the transcript (`div.messages`) has no `aria-live` and no `role`; exactly one `div.sr-only[role=status][aria-live=polite]` exists. Matches D4 exactly. |
| F-09 SidebarRowMenu ARIA | PR #154 | Open row menu: `div.sb-row-menu-popover[role="group"]`, children are plain `<button>` (Rename / Pin / End session), zero `role="menuitem"`, zero `aria-haspopup` in the document. |
| D-G2 dialog visual parity | PR #154 | `.crux-dialog` chrome probe rendered in both themes: identical geometry (radius 20px, header Bricolage 700 at 20/24/12px, pill button 10x24px, `--color-accent-strong` fill), tokens swap correctly (light border `#dde2ee` / surface `#fff` + soft lift; dark border `#2a3050` / surface `#161a2a` + deeper shadow). Probe removed afterwards. |
| Docker-path CSP intersection (closes the I-06 scope gap) | PR #155 | On the served docker bundle, meta CSP `connect-src` = `'self' https://*.supabase.co` and nginx's header `connect-src` = the same string — **byte-identical**, so the intersection really is the no-op Batch E assumed. Fonts still resolve under both policies: all 7 self-hosted woff2 loaded (Inter 400/500/600/700, Bricolage, IBM Plex Mono, primeicons). |
| Post-#158 visual pass | PR #158 | Home, Settings, and SessionView swept in both themes on the docker prod bundle: flat styling, simplified Home, `/review` in the rail with a live badge of 13 (matches the queue query's `total=13`), composer shows the flat accent border on focus. No layout defects seen. |

### New finding — focus-ring contrast fails WCAG 2.2 SC 1.4.11

`--color-accent-ring` is too faint to serve as the focus indicator in either theme.
Composited against the surfaces it is drawn on:

The ring sits at `outline-offset: 2-3px`, so its adjacent colors are the surface behind
the control and — on accent-filled controls — that control's own fill. Both measured
(fresh reads, no mutation in the same call):

| Theme | Token | Adjacent color | Contrast | Required |
|---|---|---|---|---|
| Dark | `#ff8f7c73` (alpha 0.45, `base.css:148`/`:183`) | `#0f1220` sidebar/body — every control | **2.60:1** | 3:1 |
| Dark | same | own fill of `.sb-new-session` / primary CTA `rgb(181,65,58)` | **1.54:1** | 3:1 |
| Dark | same | own fill of the active `.sb-status-toggle` pill `rgb(255,119,102)` | **1.07:1** | 3:1 |
| Light | `#ff8f7c59` (alpha 0.35, `base.css:104`) | `#f5f7fc` body / `#ffffff` card | **1.29 / 1.31:1** | 3:1 |

So it fails against the page surface everywhere in both themes, and on accent-filled
controls it is coral-on-coral — effectively invisible (1.07:1 on the Active pill).
Consumed at `base.css:257` (global `:focus-visible`), `base.css:303` (`.skip-link`),
`main.css:45` (`.profile-link`). Visually confirmed: the ring around a focused
"New session" button in light mode is barely perceptible. F-10 fixed fill colors but
left the ring token itself under-contrast. Fix is a token change — raise alpha
substantially or use a solid non-accent ring so it separates from accent fills — plus
a re-measure; no structural change.

## Partial

**ENV=prod compose smoke (I-07, Batch E).** `docker compose -f docker-compose.prod.yml
--env-file .env config` renders `ENV: prod` and a non-empty `SUPABASE_URL`, so the
wiring is real. Both guards fire correctly (`backend/main.py:19-21`): with the repo
venv, `assert_prod_database('prod', 'sqlite:///…')` raises, `('prod', 'postgresql://…')`
and `('dev', 'sqlite:///…')` pass. **Not run:** a real prod-stack boot, because
`backend/entrypoint.sh:3` is `alembic upgrade head` — booting it against `.env`'s live
`DATABASE_URL` would apply migration 0021 to production unattended. That needs an
explicit go-ahead (see below).

**HNSW re-EXPLAIN (Slice 7).** The index exists, but the gate cannot be closed on
current data. `EXPLAIN ANALYZE … ORDER BY embedding <=> …` returns a **Seq Scan over
8 rows** — with `chunk_embeddings` at 8 rows the planner is right to ignore the index,
so this proves nothing about HNSW recall. Re-run once the table has meaningful volume.

## Blocked — needs the user

1. ~~**Apply migration 0021 to live.**~~ Done by the user 2026-07-25; verified above.
2. **Rebuild the docker images.** Both are stale (see below). The backend at 2026-07-18
   blocks every backend-side gate (X-Cost-Warning emission, cap tiers, ENV=prod boot);
   the frontend at 2026-07-23 predates #159, so the upload-poll session-switch smoke
   would test the pre-fix code and prove nothing.
3. **Still needs a live LLM turn (paid), even though the app is logged in:** KaTeX render
   and authenticated SSE under the meta CSP — no stored message in the database contains
   LaTeX, so there is nothing to render without generating one.
4. **Paid LLM smokes** (batch these into one session): continue-topic carry, gap picker,
   rolling summary at >30 messages, D1 missed-concept eval, `eval_subtopic_levels` (≥85%),
   subtopic patch + evidence badges, insights dashboard against real data, retention-check
   framing, force-retrieve citation, embedding `completion_cost` sanity, `DAILY_CAP=1`
   cap-skip notice, urgent-cost-tier toast.
5. **Deploy-dependent — impossible while deploy is paused at the Render step:** live curl
   of deployed CSP headers, cross-origin `X-Cost-Warning` expose-headers, soft-vs-urgent
   level over the wire, live TTFT + pool-ceiling observation, R2 restore drill, clean-clone
   compose smoke.

## Incidental finding — the local docker stack is stale

`project_apt-backend` image was built **2026-07-18**; the container (created 07-23) reuses
it from cache. Confirmed by content, not just the timestamp: no `0021_sessions_indexes.py`
on disk (`alembic current` inside the container reports `0020_users_onboarding (head)`,
which is why 11 minutes of uptime against live Supabase did not apply 0021); no
`X-Cost-Warning` emission anywhere under `/app/routes/` (Batch E I-03, merged 07-20); no
`cost_holder` (Batch B B-08, merged 07-19). The `X-Cost-Warning` string does appear in
`/app/services/cost_meter.py` — it predates Batch E and is not evidence of newer code.
`project_apt-frontend` is from 07-23, so it predates the #159 upload-poll fix.

Consequences: (a) any *backend* behavior checked against `:5173` is 2026-07-18 code — all
five P3 batches are absent, so backend-side gates cannot be closed there; (b) the frontend image does carry the
Batch D code the gates above target — verified by observing the markers run, not inferred
from the build date: `role="group"` on the row-menu popover, the single `sr-only`
`role=status` region with no `aria-live` transcript, and the `.crux-dialog` chrome
resolving in both themes. It does not carry #159 (merged 07-24, after the 07-23 build); (c) the entrypoint's `alembic upgrade head` runs on every boot, so a rebuild
also re-runs migrations against live. 0021 is already applied, so that is currently a
no-op, but rebuild deliberately.
