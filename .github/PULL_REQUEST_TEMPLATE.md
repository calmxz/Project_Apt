# Phase N — Short Slug

<!-- Replace N with the phase number from docs/Crux_DevPlan.md -->

## Summary

<!-- 1-2 lines. What ships in this PR? -->

## DevPlan section

Link or quote the relevant phase header from `docs/Crux_DevPlan.md`.

## Verification checklist

Paste the **exact** "Verification" bullets from DevPlan for this phase, then check each off with the evidence that proves it.

- [ ] _bullet 1_ — evidence: ...
- [ ] _bullet 2_ — evidence: ...

For phases with reliability checkpoints (3, 8): include the measured pass rate and the sample size.

## Test evidence

Paste the relevant terminal output. Examples:

```
$ npm run test:unit -- --run
... summary ...

$ pytest functions/tests
... summary ...

$ curl http://localhost:5001/demo-adaptlearn/us-central1/<fn>
... response ...
```

## Decision gate (Phases 0, 5.5, 10 only)

State the outcome: **Pass / Knowledge-only / First-turn-only / Fail** (Phase 0), **Yes / Yes-with-caveats / No** (5.5, 10). Link the analysis doc if one was written.

## Risks / follow-ups

- New `// TODO` markers added: _yes/no, where_
- Out-of-scope work uncovered:
- Spec/DevPlan drift introduced:

## Pre-merge checklist

- [ ] CI green (Vitest + pytest)
- [ ] `npm run build` clean
- [ ] No secrets committed (grep `.env`, API keys)
- [ ] `CLAUDE.md` updated if architecture or commands changed
- [ ] `docs/Crux_DevPlan.md` / `docs/Crux_Spec.md` updated if scope shifted
- [ ] Memory observations recorded for surprising findings

## Notes

<!-- Anything reviewers (or future-me) should know. -->
