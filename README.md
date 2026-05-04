# AdaptLearn

Adaptive AI study companion. A web app that teaches a chosen topic and updates its model of the learner continuously, grounded in the user's own course material via RAG.

**Status:** Pre-implementation. Phase 0 validation spike pending — gates the rest of the build.

## Stack (planned)

- Frontend: Vue 3 + Vite + Pinia + PrimeVue
- Backend: Python Cloud Functions + Google ADK
- Data: Firestore + Cloud Storage
- LLM: Gemini 2.5 Pro

## Documentation

- [`docs/AdaptLearn_Spec.md`](docs/AdaptLearn_Spec.md) — full project specification (v1 design)
- [`docs/AdaptLearn_DevPlan.md`](docs/AdaptLearn_DevPlan.md) — phased build plan with verifiable checkpoints

Read both before touching code.

## Phase 0 — Validation Spike

Hard gate. Determines whether Gemini 2.5 Pro produces structurally different tutor responses across three profile pairs (knowledge level, guidance preference, engagement cadence) at both turn 1 and turn 8 of a conversation.

- **Pass:** proceed to Phase 1.
- **Knowledge only:** drop `interaction_preferences`, keep `topic_profile`.
- **Fail:** stop and rebuild the spec around a different premise.

Outputs land in `spike/outputs/`. Decision recorded in `spike/decision.md`.

## Ground Rules

- One phase at a time. No jumping ahead.
- No emojis in code or comments.
- Secrets in `.env.local` (gitignored). Never commit keys.
- Stop and report on any failed verification step.
