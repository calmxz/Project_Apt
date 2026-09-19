# Decisions

Durable "why": decisions, findings, tradeoffs. Newest first. Technical
how-it-works lookup belongs in `docs/reference.md` instead.

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
