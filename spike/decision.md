# Phase 0 — Spike Decision

**Date:** 2026-05-04  
**Models used:** gemini/gemini-2.5-flash (knowledge pair) · gemini/gemini-2.5-flash-lite (guidance + engagement pairs)  
**Spec drift:** Spec §6 names Claude as the default LLM; this spike used Gemini due to API key availability. Implications noted per pair below.

---

## Decision: KNOWLEDGE-DOMINANT PASS

Per DevPlan §Phase 0 decision matrix this maps to **"Knowledge only"**:  
Pair 1 (knowledge) differs at both turn 1 and turn 8. Pairs 2 & 3 do not clearly differ at turn 1.

**However, context matters:** Pairs 2 & 3 were run on `gemini-2.5-flash-lite` (daily quota exhausted on full flash before they ran), a weaker instruction-follower. Guidance shows clear structural difference by turn 4+. Engagement shows subtle but present differences by turn 8. The lite-model result is a lower bound.

**Operational decision:** Proceed to Phase 2. Treat `interaction_preferences` as provisionally valid but flag it for re-validation in Phase 3 (first real tool-call run, on Claude). If Phase 3 shows guidance/engagement differentiation is reliable on Claude, the spec stands fully. If not, drop `interaction_preferences` then.

---

## Pair-by-pair analysis

### Pair 1 — Knowledge level (gemini-2.5-flash)

**A:** beginner profile, `confirmed_gaps: ["what a foreign key is", "why data duplication causes update anomalies"]`  
**B:** advanced profile, `mastered_concepts: ["1NF", "2NF", "functional dependencies"]`

**Turn 1 (turn 2 response):**
- A: Opens with "have you encountered situations where...?" — probing for prior knowledge, zero jargon, conceptual framing.
- B: Immediately acknowledges mastered 1NF/2NF/functional dependencies, asks "dive straight into 3NF and BCNF?" — assumes fluency, jumps ahead.
- **Verdict: CLEARLY DIFFERENT.** No blind-test confusion possible.

**Turn 8 (turn 8 response):**
- A: Still at update-anomaly basics with a concrete address table (Alice Smith rows).
- B: Step-by-step BCNF violation detection, formal `X -> Y` notation, candidate key enumeration.
- **Verdict: CLEARLY DIFFERENT.** Depth, vocabulary, scaffolding all structurally distinct.

**Blind-distinguishable:** Yes, with high confidence.  
**Result: PASS**

**Side observation:** Model tried to call `update_topic_profile` inline in the text even without ADK tools registered (Profile A turn 4, Profile B turn 8). This confirms the immutable-rules prompt is strong enough to trigger tool-call intent; ADK registration in Phase 2 should work cleanly.

---

### Pair 2 — Guidance preference (gemini-2.5-flash-lite)

**A:** `guidance_preference: "hints"`, neutral topic_profile  
**B:** `guidance_preference: "direct_answers"`, neutral topic_profile

**Turn 1 (turn 2 response):**
- A: "what are your initial thoughts on why organizing data efficiently might be important?" — open-ended WHY question, Socratic.
- B: "what do you already know about databases?" — also a question, but prior-knowledge probe rather than conceptual provocation.
- **Verdict: SUBTLE.** Both use questions; different KIND of question. A blind third party might not reliably distinguish from turn 1 alone.

**Turn 4:**
- A: Pure Socratic question: "what might happen if a customer changes their address?" — no explanation given, waits for user response.
- B: Directly explains the spreadsheet scenario and lists normalization's three goals, then asks "Does this make sense?" — answer first, then checks.
- **Verdict: CLEARLY DIFFERENT.** This is the clean signal.

**Turn 8 (turn 8 response):**
- A: Scaffold-heavy, continues Socratic style, guided questions back to the example.
- B: Delivers direct explanation of 1NF atomicity + repeating groups with two concrete code/table examples, then asks for comprehension check.
- **Verdict: STRUCTURALLY DIFFERENT.** Direct vs. guided scaffolding clearly present.

**Blind-distinguishable:** Yes by turn 4+; borderline at turn 1.  
**Result: WEAK PASS** — differentiation present but delayed one turn. Likely a lite-model instruction-following limitation; Claude should show the split at turn 1. Flag for Phase 3 re-validation.

---

### Pair 3 — Engagement preference (gemini-2.5-flash-lite)

**A:** `engagement_preference: "quiz_as_we_go"`, neutral topic_profile  
**B:** `engagement_preference: "absorb_then_test"`, neutral topic_profile  

Note: Engagement A uses same `interaction_preferences` as Guidance A (hints + quiz_as_we_go). Its transcript is word-for-word identical to Guidance A — this is correct behavior and confirms the prompt renderer isolates variables properly.

**Turn 1 (turn 2 response):**
- A: "what are your initial thoughts on why organizing data efficiently might be important?"
- B: "what comes to mind when you hear the term 'database normalization'? No worries if nothing."
- **Verdict: VERY SUBTLE.** Both probe prior knowledge; phrasing and tone slightly different. Not reliably blind-distinguishable at turn 1.

**Turn 4:**
- A: Single probing question — stays in Socratic mode, no forward content delivery.
- B: Delivers three-goal explanation directly ("Reduce Redundancy:", "Improve Data Integrity:", "Make Databases More Flexible:"), ends with open invitation.
- **Verdict: PRESENT.** B moves content forward; A holds back waiting for user response. But both still feel similar in surface structure.

**Turn 8 (turn 8 response):**
- A: "Does this example help illustrate..." — comprehension check mid-concept.
- B: Delivers full 1NF table example, then ends with "what do you think violates the 'atomic values' rule?" — application question after content absorption.
- **Verdict: DISTINGUISHABLE.** quiz_as_we_go = checks comprehension throughout; absorb_then_test = delivers content then poses problem. The end of turn 8 makes it clear.

**Blind-distinguishable:** Marginally yes at turn 8; no at turn 1.  
**Result: MARGINAL** — weakest pair. The engagement cadence distinction exists but the lite model underdelivers it. On a more capable model (Claude), the "check every 2-3 turns" vs "hold until end" cadence should be starker over an 8-turn conversation.

---

## Summary table

| Pair | T1 different? | T8 different? | Blind-distinguishable? | DevPlan result |
|---|---|---|---|---|
| Knowledge | YES (clear) | YES (clear) | Yes | PASS |
| Guidance | Marginal | YES (clear) | Yes by T4+ | WEAK PASS |
| Engagement | No | YES (subtle) | Marginally | MARGINAL |

---

## Final call

**DevPlan strict: "Knowledge only"** — Pair 1 satisfies full pass; Pairs 2 & 3 do not clearly satisfy turn-1 criterion.

**Operational decision: Proceed to Phase 2** with `interaction_preferences` retained in the spec but flagged:
- The knowledge-level premise is validated. Core spec holds.
- Guidance + engagement differentiation needs Claude re-validation in Phase 3.
- If Phase 3 guidance/engagement reliability is below ~85%, consider dropping `interaction_preferences` from the data model (DevPlan "Knowledge only" branch: proceed with `topic_profile` only).

**Model caveat:** Guidance and engagement runs used gemini-2.5-flash-lite due to daily quota exhaustion on full flash. Lite model is a weaker instruction-follower; results are a lower bound on differentiation. Production target is Claude (spec §6); a separate Claude validation is needed before interaction_preferences can be considered fully confirmed.

---

## Transcripts (committed)

- `outputs/knowledge/A_transcript.md` / `B_transcript.md`
- `outputs/guidance/A_transcript.md` / `B_transcript.md`
- `outputs/engagement/A_transcript.md` / `B_transcript.md`
