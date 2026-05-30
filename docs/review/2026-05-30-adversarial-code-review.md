# AdaptLearn — Adversarial Code Review (live codebase)

**Date:** 2026-05-30
**Branch:** `review/code-adversarial` (off `dev`, even with `origin/dev`)
**Reviewer pass:** backend read-through + adversarial refutation of prior findings against current source.

## Why this supersedes the pasted doc-review

The review prompt that triggered this pass audited the three **design docs**
(`AdaptLearn_Spec.md`, `AdaptLearn_DevPlan.md`, `2026-05-03-adaptlearn-v1-design.md`).
The user flagged "details here could be outdated" — they are. The code has moved
well past those docs:

| Pasted doc finding | Live-code status |
|---|---|
| 0.1 / 0.2 three-doc canonical conflict | Still true **in the markdown**, but `CLAUDE.md` already declares `v1-design` canonical and records the shipped stack. Doc-staleness section below. |
| B.1/B.2 asymmetric mastery gate dropped | Code ships **direct promotion** (profile_service.py:79-81). This is a design **decision**, not a bug — surfaced, not rewritten (Source-of-Truth Discipline). |
| C.1 `turn=current_turn` false-reject | **RESOLVED in code** — uses a recency window, not exact-turn. See C.1 below. |
| D.1/D.2 ChromaDB server mode | **Moot** — migrated to pgvector (one less service). |
| D.3 no streaming | **Resolved** — real SSE token streaming shipped (tutor.run_streaming). |
| H.1 no backend authz / "pass any userId" | **Resolved (verified)** — Supabase JWT auth + per-route ownership checks. Auth detail below. |

So the doc-level review is largely historical. The real deliverable is the
**live-code review** below.

## Threat model (set once, used to rank severity)

- Auth **is** implemented (Supabase magic-link JWT; `user_id` is the authenticated
  caller, not client-supplied). IDOR-class findings are refuted on that basis.
- v1 runtime = **single dogfooder**, localhost/SQLite default, Postgres+pgvector in
  prod. Repo is **intended to go public** (CLAUDE.md, 7-week public deadline).
- Ranking: concurrency-dependent races are near-zero blast radius for one user;
  data-precondition bugs (stale rows) matter during an iterative build; config
  coupling that fails *loudly* is lower risk than one that fails *silently*.

## Method

Findings from the prior morning audit (memory obs S1205) were treated as
**hypotheses to refute**, not confirmed bugs. Each was checked against exact
source lines. Verdicts: CONFIRMED / REFUTED / RESOLVED / BY-DESIGN.

## Scope & coverage

**Backend only.** All route handlers, the agent loop (streaming + non-streaming),
every service, DB models, contracts, and `auth.py` were read this pass. The **Vue
frontend was not reviewed** — so the pasted finding **H.2** (ingestion poll: 3s
interval, no cap/backoff) and the streaming-UX affordance (D.3) are **outstanding,
not dispositioned**. Recommend a separate frontend pass.

(Pasted finding **E.2** — "reset semantics disagree, UI lies" — is **resolved**:
the backend uses fixed UTC-midnight consistently in both `cost_meter.midnight_utc_iso`
and the `(user_id, date_utc)` ledger rollover, and returns `resets_at` for the UI
to render.)

---

## Severity summary

| # | Finding | Verdict | Severity | Action |
|---|---|---|---|---|
| 1 | Streaming cost undercharge on tool-call turns | CONFIRMED | HIGH | **FIX** |
| 2 | Profile load 500 on legacy `topic_profile_json` | CONFIRMED (latent) | MED-HIGH | **FIX** |
| 3 | Non-atomic rate-limit + cost-meter (RMW race) | CONFIRMED | MED | Document |
| 4 | Demotion guard near-inert | BY-DESIGN | LOW | Document |
| 5 | Rate-limit consumed before session ownership check | REFUTED (cross-user) | LOW | Document |
| 6 | Embedding dim hardcoded 768 | PARTIAL | LOW | Document |
| 7 | `estimate_cancelled_cost` KeyError on cancel | REFUTED (handled) | INFO | Document |
| 8 | Ingestion commits partial state on mid-pipeline failure | CONFIRMED | MED | Document |
| C.1 | focus-clear guard `turn=current_turn` off-by-one | RESOLVED | — | Note |

---

## Findings (detail)

### #1 — Streaming cost undercharge on tool-call turns — CONFIRMED — HIGH — FIX

`backend/agent/tutor.py` `run_streaming()`. Cost is recorded **only** inside the
`if not tool_frags:` branch (the final text-answer iteration), tutor.py:319-330.
Every iteration that *assembles tool calls* makes a billed `litellm.acompletion(stream=True)`
call (tutor.py:277) but records **$0** — control skips the cost block and goes
straight to dispatch.

Contrast non-streaming `run()` (tutor.py:81-90): it records cost **every
iteration**, before checking for tool calls. So streaming and non-streaming
diverge, and the streaming path systematically undercounts spend on any
multi-tool turn.

**Blast radius:** the daily cost cap ($2 soft / $3 hard) is a shipped feature.
Tool-heavy turns let real spend exceed the cap because the cap check
(tutor.py:250) reads an under-counted ledger. Not a security hole — a
correctness/feature-integrity bug on the cost guard. Financial, bounded by
free-tier reality, but it defeats the exact mechanism built to bound it.

**Fix:** compute and record cost after the streaming chunk loop on **every**
iteration (mirror `run()`), using `litellm.stream_chunk_builder(chunks, ...)`
→ `litellm.completion_cost(...)`, regardless of whether tool calls were
assembled. Status: APPLIED (see "Fixes applied").

### #2 — Profile load 500 on legacy topic_profile_json — CONFIRMED (latent) — MED-HIGH — FIX

`TopicProfile` is codegen'd with `extra="forbid"` (contracts/models.py:12-15).
`profile_service.load_profile` re-parses the stored column through
`TopicProfile.model_validate_json` (profile_service.py:38). Resume copies the
prior session's **raw** JSON forward unparsed (sessions.py:97 / `seed_from_prior`
profile_service.py:49-51) — the failure surfaces on the *next* load.

If any stored `topic_profile_json` contains a field no longer in the model
(the schema demonstrably shed 5+ fields across the build — `mastered_candidates`,
`interaction_preferences`, `focus_areas`, evidence counters), `extra="forbid"`
raises `ValidationError` → unhandled 500 on every read of that session
(session detail, chat pre-flight, resume seeding's next load). `aggregate_for_user`
parses the column directly too (profile_service.py:142, :196) → the whole
`/profile` dashboard 500s if any one session has a stale blob.

(`extra="forbid"` fails only on *unknown* keys, not missing ones — missing keys
fall back to defaults. So the trigger is specifically a removed/renamed field
left in an old row, which is exactly what an iterative schema produces.)

**Blast radius:** latent — needs a row written under an older schema. Plausible
in the dev DB; a hard 500 with no recovery once present.

**Fix:** a service-layer tolerant parser (contracts are codegen — **do not**
hand-edit `contracts/models.py`). Catch `ValidationError`, drop unknown keys,
re-validate; fall back to `TopicProfile()` + a logged warning if still invalid.
Route `load_profile` **and** the two `aggregate_for_user` parse sites through it.
Status: APPLIED (see "Fixes applied").

### #3 — Non-atomic rate-limit + cost-meter — CONFIRMED — MED — Document

`rate_limit.check_and_increment` (rate_limit.py:22-47) and `cost_meter.record_cost`
(cost_meter.py:63-78) are both read-modify-write with no row lock. Two concurrent
requests can each read `count=49`, each write `50` → cap overrun + a lost
increment; cost adds can lose-update → undercharge.

**Blast radius:** requires concurrency. v1 is a single dogfooder → near-zero.
Matters for the public-deploy future.

**Recommendation (do not half-fix):** an atomic DB-level update —
`UPDATE usage_counters SET count = count + 1 WHERE ... AND count < :cap` and
branch on rowcount; for cost, `INSERT ... ON CONFLICT DO UPDATE SET cost = cost + :c`.
Behaves differently on SQLite vs Postgres, so it needs its own change + tests,
not a drive-by. Documented, not applied.

### #4 — Demotion guard near-inert — BY-DESIGN — LOW — Document

`learning_event_service.record` demotes only if `gap_tested in mastered_concepts`
(exact string match, learning_event_service.py:34-40). The focus protocol tests
*gaps under focus* (which live in `confirmed_gaps`), and nothing re-quizzes
already-mastered concepts, so the demotion path rarely fires. The match is also
verbatim (no stemming — canonicalization was deliberately dropped), so
`"B-tree insertion"` ≠ `"inserting into a B-tree"` misses.

This is the documented v1 simplified model (Spec §3.4 "Direct promotion + retest
demotion"), not a regression. Flag, don't fix. If post-promotion correctness is
wanted back, that's the B.1 design decision (re-add a lightweight gate), out of
scope for a code review.

### #5 — Rate-limit consumed before ownership check — REFUTED (cross-user) — LOW — Document

The prior hypothesis was "attacker burns a victim's quota via a guessed
session_id." Refuted: `rate_limit.check_and_increment(db, user_id)` keys the
counter on the **authenticated caller's** `user_id` (from the JWT), not on the
session. An attacker only burns their **own** quota.

Residual (genuine but minor): both chat (`_prepare_turn` chat.py:51 before :67)
and upload (upload.py:45 before :71) increment the counter **before** validating
session ownership, so a caller wastes their own daily slot on a request that
404s. One-line reorder (validate session, then increment) removes it.
Documented; trivial reorder left as a recommendation to keep this pass scoped.

### #6 — Embedding dim hardcoded 768 — PARTIAL — LOW — Document

`config.embedding_dim = 768` (config.py:24) feeds `Vector(settings.embedding_dim)`
(models.py:115). The live `chunk_embeddings` column dimension is fixed by Alembic
migration `0002`, not by config at runtime. If `embedding_model` is swapped to one
emitting a different dim without a matching migration, pgvector **rejects the
insert** → ingestion `status="failed"` with the error surfaced (ingestion_service.py:105-113).
Fails loudly, not silently; no corruption. pgvector verified live 2026-05-24
against the current model at dim 768.

**Recommendation:** keep `embedding_dim`, the `embedding_model`, and migration `0002`
in lockstep; add a startup assertion that the configured dim matches the live
column. Documented.

### #7 — estimate_cancelled_cost KeyError — REFUTED (handled) — INFO — Document

`estimate_cancelled_cost` docstrings + raises `KeyError` for unregistered models
(cost_meter.py:126-127). But the only caller wraps it in `try/except Exception`
and falls back to `Decimal("0")` (tutor.py:443-449), then still persists the
cancelled message. No crash. The current model **is** in `MODEL_RATES`
(cost_meter.py:97), so it never fires. Worst case = $0 cancellation charge for an
unregistered model. Optional hardening: `MODEL_RATES.get(model)` → `Decimal("0")`
instead of raising. Documented, not applied.

### #8 — Ingestion commits partial state on mid-pipeline failure — CONFIRMED — MED — Document

`ingestion_service.run` mutates `db` across the whole pipeline (page_count →
`insert_chunks` :86 → keyword merge :100 → status) with a **single** trailing
`db.commit()` (:104). On an exception *after* `insert_chunks` succeeds (e.g. the
keyword merge at :100), the `except` block sets `status="failed"` and commits
(:113) — flushing the **already-added chunk rows** alongside the failure status.

Those orphan chunks belong to a `failed` document, but `pgvector_store.query_chunks`
is scoped by **session_id** (retrieval_service.py:57), gated only on the *latest*
doc being `ready`. So once any later upload in the same session goes `ready`,
retrieval can surface orphan chunks from the earlier failed doc.

**Blast radius:** needs a failure *between* insert and final commit — narrow, since
the post-insert steps are a cheap JSON merge. Real but low-likelihood.

**Recommendation:** `db.rollback()` at the top of the `except` (then re-fetch the
doc) so only the failure status persists; and/or scope retrieval by the resolved
`document_id`, and/or delete chunks for failed docs. Needs `pgvector_store`
inspection + a test — documented, not applied.

### C.1 — focus-clear guard off-by-one — RESOLVED — Note

The pasted finding warned the spec's guard used `turn=current_turn`, which would
false-reject legitimate clears on an off-by-one. The live guard does **not** do
that. `profile_service.apply_patch` (profile_service.py:92-106) verifies a
correct `LearningEvent` via a **recency window**:
`LearningEvent.created_at >= ctx.turn_started_at` (where `turn_started_at` is
stamped at route entry, chat.py:113) — exactly the recommended fix. Both
timestamps are server-generated UTC processed by the same SQLAlchemy
`DateTime(timezone=True)` type, so the comparison is consistent on both SQLite and
Postgres. No off-by-one. Resolved correctly.

### H.1 — Auth verification — RESOLVED (verified this pass)

`backend/services/auth.py` read and checked (the IDOR-resolved and
quota-keyed-to-caller verdicts both depend on `user_id` being a genuinely
verified token claim):
- **Signature:** `PyJWKClient.get_signing_key_from_jwt` fetches the signing key
  from Supabase JWKS by `kid`; `jwt.decode(token, signing_key, ...)` verifies the
  signature against it. Not `verify=False`. (auth.py:46-54)
- **Algorithm:** pinned to `["RS256", "ES256"]` — asymmetric only, so `alg=none`
  and HS/RS key-confusion are rejected. (auth.py:51)
- **Claims:** `verify_aud=True` with `audience="authenticated"`, `verify_exp=True`.
  (auth.py:52-53)
- **Identity:** `user_id` is the verified `sub` (auth.py:60-66); routes inject it
  via `Depends(current_user_id)` from the `Authorization: Bearer` header
  (auth.py:69-91) — never from request body/form.

**Minor hardening (LOW):** `iss` is not explicitly verified (no `issuer=`). Risk
is low because the JWKS origin (the configured Supabase project) already pins the
issuer — only that project's keys validate. Adding an explicit `iss` check is
cheap defense-in-depth. Not applied.

---

## Documentation staleness (facts the code already settled) — APPLIED

Per Source-of-Truth Discipline: update factual records the code has settled;
**do not** rewrite design *intent* to match code. The mastery-gate fork (B.1/B.2)
is intent — flagged above, left for the user to decide, not rewritten.

**Applied** to `docs/superpowers/specs/2026-05-03-adaptlearn-v1-design.md`
(matching the doc's existing inline "— was X (Phase/date)" convention): a dated
reconciliation banner after the supersession line, plus corrections to the §1
stack table and §2 architecture diagram/rationale/latency —
- Default model `gemini-2.5-pro` → `gemini/gemini-3.1-flash-lite` (config.py:20).
- Embedding `text-embedding-004` → `gemini/gemini-embedding-2` (config.py:21).
- Streaming `None` → SSE token streaming (`/api/chat/stream`).
- Vector store ChromaDB + SQLite → pgvector on Supabase Postgres (D.1/D.2 moot).
- Auth note already present (Phase 7).

Deeper sections (swap-path, test plan) retain as-authored ChromaDB/SQLite
references; the banner flags this rather than rewriting ~25 scattered lines.

**Not applied (recommendation):** `AdaptLearn_Spec.md` / `AdaptLearn_DevPlan.md`
should carry a `SUPERSEDED — reference only` banner and the DevPlan "read this +
Spec" pointer should point at the v1-design doc (finding 0.1). Left for the user —
these are the v2-reference docs and the change is doc hygiene, not code.

---

## Fixes applied (this branch, uncommitted)

Scope: confirmed HIGH/MED-HIGH only (#1, #2). Everything else is documented
above, not changed. Full backend suite after fixes: **190 passed, 4 skipped,
92% coverage** (gate 75%).

- [x] **#1** — `backend/agent/tutor.py` `run_streaming()`: moved the
  `stream_chunk_builder` → `completion_cost` → `record_cost` block out of the
  `if not tool_frags:` branch to run after the chunk loop on **every** iteration.
  Tool-dispatch iterations now charge the daily cost ledger. Fail-safe: any
  exception degrades to the prior (zero-cost) behavior, never crashes.
- [x] **#2** — `backend/services/profile_service.py`: added `_parse_profile()`
  (strict parse → drop unknown keys & re-validate → empty-profile fallback,
  logging dropped legacy fields). Routed `load_profile` + both
  `aggregate_for_user` parse sites through it. Contracts left codegen-pure.

Regression tests added (each fails on pre-fix code):
- `tests/test_tutor_stream.py::test_run_streaming_records_cost_on_tool_iterations`
  — a 2-iteration turn must record cost twice.
- `tests/test_profile_service.py::test_load_profile_tolerates_legacy_fields`
  — legacy-field blob loads clean, unknown keys dropped.
- `tests/test_profile_service.py::test_load_profile_falls_back_on_unparseable_blob`
  — corrupt blob degrades to empty profile.

## Not committed

Per instructions, no commit. Working tree on `review/code-adversarial` holds:
`backend/agent/tutor.py`, `backend/services/profile_service.py`,
`backend/tests/test_tutor_stream.py`, `backend/tests/test_profile_service.py`,
and this report.
