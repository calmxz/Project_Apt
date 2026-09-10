# Prompt Audit - 2026-09-10

Audit of every surface that reaches a model as text, for patterns tuned to older models. Hunks 1-15 applied 2026-09-10 on branch fix/prompt-audit-2026-09-10 (plus README.md and design doc line 468 swap-candidate model id, both missed by the audit). Owed before merge: paid smoke on gemini-3.5-flash-lite for hunks 2 and 13 per the verification plan.

## Assumptions (Step 0)

- **Scope:** whole working tree. Two distinct surfaces with two distinct targets:
  - **App prompts** (`backend/agent/prompts.py`, `backend/agent/tools.py`, tool schemas in `docs/api/openapi.yaml`, `backend/services/summary_service.py`, request builders in `tutor.py` / `summary_service.py`, eval scripts under `backend/scripts/`). Target model: **`gemini/gemini-3.5-flash-lite`** via LiteLLM (`config.py:27`, bumped from 3.1 on 2026-08-24).
  - **Agent-instruction files** (`CLAUDE.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/migration-reviewer.md`). Target: Claude Code on Claude Fable 5.1.
- **Provider marker:** the app is non-Anthropic (LiteLLM -> Gemini). The only Anthropic touchpoint is the documented fallback model. No switch to the Anthropic SDK is proposed. Claude-specific API replacement rows (structured outputs, thinking config, prefill) do not apply to the app and are not actions here.
- **Calibration caveat:** the guide's "emphasis over-triggers on current models" claim is documented for Claude, not Gemini Flash-Lite. `git blame` shows most `MUST` / `Do NOT` lines were added 2026-07-29 to 2026-08-02 as live-smoke fixes on `gemini-3.1-flash-lite`, and the model bumped to 3.5 on 2026-08-24 with no re-test. Those lines fall under keep-list item 5 (prohibitions against demonstrated failures) until re-tested, so pressure-language findings are capped at Medium and marked re-test-before-merge.

## Inventory (Step 1)

| Surface | File | Notes |
|---|---|---|
| System prompt | `backend/agent/prompts.py:20-214` (`IMMUTABLE_RULES`), `:266-356` (dynamic context) | Stable prefix first, per-turn state after. Cache-friendly. |
| Tool descriptions | `backend/agent/tools.py:30-78` | Three tools. Parameter schemas generated from `docs/api/openapi.yaml`. |
| Tool parameter schemas | `docs/api/openapi.yaml` -> `UpdateTopicProfileArgs`, `RetrieveChunksArgs`, `AskCheckQuestionsArgs` | Codegen runs with `--use-field-description`; no property has a `description:` today. |
| Summary prompts | `backend/services/summary_service.py:24-30`, `:151-158` | Session-end and rolling summaries. |
| Request builders | `backend/agent/tutor.py:213-221`, `summary_service.py:87-95`, `:218-223` | `temperature` 0.3 / 0.0, `tool_choice="auto"`, explicit timeouts, no retry loop on chat. |
| Eval scripts | `backend/scripts/eval_*.py`, `reliability_focus_clear.py` | LLM-judge with `max_tokens=5`, `temperature=0`. Judge prompt strings grepped for Group 1 signals: none. Dev tooling, not production; only the model pin (F-05) is actionable. |
| Cost table | `backend/services/cost_meter.py:245-270` | Model pricing pins. |
| Agent files | `CLAUDE.md`, `.claude/skills/project-conventions/SKILL.md`, `.claude/skills/live-smoke/SKILL.md`, `.claude/agents/migration-reviewer.md` | |
| Design doc | `docs/superpowers/specs/2026-05-03-crux-v1-design.md` | Declared source of truth; feeds Claude Code every session via CLAUDE.md. |

Tests that pin prompt text: `backend/tests/test_prompts.py` (lines 30-37, 60-64, 84-96, 123-135, 156-215, 333-335, 387-416) and `test_chat_diagnostic_accepted.py:64`. Every prompt hunk below names the pin it touches.

## Summary

| Group | High | Medium | Low / flag |
|---|---|---|---|
| 1 Dated prompt text | 0 | 2 | 2 |
| 2 Skill / rule files | 3 | 1 | 2 |
| 3 Tool descriptions | 3 | 1 | 1 |
| 4 Request config / architecture | 0 | 0 | 0 (clean) |

The three highest-impact findings are all factual rot, not register:

1. **No tool parameter has a description** (F-01). The model sees `k`, `correct_index`, `evidence_type`, `focus_clear_reason` as bare names. Guide Group 3 calls under-description the most common tool failure; the fix is more text, in `openapi.yaml`.
2. **`retrieve_chunks` returns a cosine *distance* labelled `score`** (F-02) and the description never says which direction is better. A flash-lite model will plausibly treat higher as better and cite the worst chunk.
3. **A dead tool, `record_learning_event`, is still documented as live** in `CLAUDE.md`, the design doc, and the live-smoke runbook (F-04). It has not been an LLM tool since the 2026-06-04 batch-check redesign.

Group 4 is clean: the system prompt is ordered stable-first, cost accounting exists (`cost_meter.log_call` with usage), there is no assistant prefill, no `stop_sequences`, no JSON-forcing retry loop, no budget countdown rendered into context, and the only non-deterministic-looking model calls (summaries, judge) are genuine judgment steps with mechanical fallbacks.

## Findings (Step 5), highest confidence first

### F-01 - Tool parameters have no descriptions
- **Location:** `docs/api/openapi.yaml` schemas `UpdateTopicProfileArgs`, `RetrieveChunksArgs`, `AskCheckQuestionsArgs` (all `properties:` blocks); manifests in `backend/contracts/models.py` (0 occurrences of `description=`).
- **Evidence:** `k: { type: integer, default: 5, minimum: 1, maximum: 20 }`, `correct_index: { type: integer, minimum: 0 }`, `evidence_type: oneOf [...]` - no `description` on any of the 19 parameters.
- **Pattern:** Group 3, "parameters without descriptions - under-described, add".
- **Why obsolete:** the tool-description rubric is contract accuracy. The prompt carries some of this (evidence typing, focus clearing) but the parameter schema is what the model reads at call time, and codegen already runs with `--use-field-description`, so the fix flows into the contracts with no code change.
- **Confidence:** High.
- **Action:** `add` - see diff hunk 1. Run `python backend/scripts/gen_contracts.py` after.

### F-02 - `retrieve_chunks` description omits score orientation, `k`, and return statuses
- **Location:** `backend/agent/tools.py:55-59`.
- **Evidence:** "Returns chunks with doc_id, text, page, score."
- **Pattern:** Group 3, under-described / contract mismatch.
- **Why obsolete:** `score` is the pgvector cosine **distance** (`pgvector_store.py:92`, `distance.label("score")`), so lower is closer. The description does not say so, does not mention `k`, and does not list the `no_results` / `failed` statuses the prompt tells the model to react to (`prompts.py:183`).
- **Confidence:** High.
- **Action:** `rewrite` - diff hunk 2.

### F-03 - `AskCheckQuestionsArgs` schema claims the first question is streamed as assistant text
- **Location:** `docs/api/openapi.yaml` -> `AskCheckQuestionsArgs.description`, sentence "The first question's text is also streamed as assistant text."
- **Evidence:** Added in the 2026-06-05 quiz merge (#53) for the single-question design. `tutor.py:423-433` now emits a `check_question` event carrying `items`; no `assistant_delta` carries question text. The prompt (`prompts.py:127-131`) instead asks the model to write its own lead-in line.
- **Pattern:** Group 3, contract/behavior mismatch (the worst Group 3 defect).
- **Why obsolete:** superseded by the batched multiple-choice redesign (2026-06-04 / 06-07). A model that believes the first stem is already shown may omit it from the card or duplicate it.
- **Confidence:** High.
- **Action:** `remove` the sentence - diff hunk 3.

### F-04 - Dead tool `record_learning_event` documented as live
- **Location:** `CLAUDE.md:54-57`; `docs/superpowers/specs/2026-05-03-crux-v1-design.md:120-124`, `:145`; `.claude/skills/live-smoke/SKILL.md:37`.
- **Evidence:** "Three tools: ... `record_learning_event(session_id, gap_tested, question, correct)` - logs check-question."
- **Pattern:** Group 2, volatile specifics / factual rot; also Group 3 "tool names in prose that shadow the real tool list".
- **Why obsolete:** `tools.py` registers `update_topic_profile`, `retrieve_chunks`, `ask_check_questions`. `learning_event_service.py:6` states the tool is gone and grading is server-side. `test_prompts.py:61` asserts the name is absent from the prompt. Claude Code reads CLAUDE.md every session and will look for a tool that does not exist.
- **Confidence:** High (verified against code).
- **Action:** `rewrite` - diff hunks 4, 5, 6. The design doc is the declared source of truth, so per CLAUDE.md "surface conflicts, don't pick" the hunk is proposed with a dated reconciliation note rather than silently rewritten.

### F-05 - Fallback model pinned to a previous generation (`anthropic/claude-sonnet-4-6`)
- **Location:** `CLAUDE.md:112`; `backend/scripts/eval_focus_clearing.py:290`; `backend/scripts/eval_missed_concept_reference.py:244`; `backend/services/cost_meter.py:260-264`; design doc `:29`, `:468`.
- **Evidence:** "then swap to `anthropic/claude-sonnet-4-6`".
- **Pattern:** Group 2, pinned model names ("silently degrade after the next release"); Group 1d fossil.
- **Why obsolete:** Sonnet 4.6 is the previous Sonnet generation; the current one is `claude-sonnet-5` (1M context, $2 / $10 per 1M, cheaper than 4.6's $3 / $15). If the fallback ever fires it will land on an older, more expensive model. The eval report headers also pin "CLAUDE.md line 105-107", which is already wrong (the rule is at line 112).
- **Confidence:** High (model table).
- **Action:** `rewrite` - diff hunks 7-11. Pricing row: Sonnet 5 is `0.002` / `0.010` per 1k. This is also the owed "design-doc model-id divergence" from the 2026-08-24 dependency audit.

### F-06 - Design doc default model disagrees with config
- **Location:** design doc `:12`, `:29`, `:59` say `gemini-3.1-flash-lite`; `:460` says `gemini/gemini-2.5-pro`; `config.py:27` says `gemini-3.5-flash-lite`.
- **Pattern:** Group 2, volatile specifics; duplicated info that has drifted.
- **Why obsolete:** the doc is the declared primary source of truth and is loaded into Claude Code context via CLAUDE.md. Three different model IDs across one doc plus config is exactly the "duplicates disagree" case the keep list carves out for consolidation.
- **Confidence:** High.
- **Action:** `rewrite` - diff hunk 12 (dated reconciliation note, same style the doc already uses at line 29).

### F-07 - `ask_check_questions` description carries steering, not contract
- **Location:** `backend/agent/tools.py:68-73`.
- **Evidence:** "The ONLY way to quiz, test, or check the learner's understanding." ... "You do NOT grade."
- **Pattern:** Group 3, "`MUST|ALWAYS|NEVER` steering inside descriptions - dial back"; behaviour-smuggling.
- **Why obsolete:** the same rule, with its reason ("no interactive card renders"), already lives in `prompts.py:84-88`. The description duplicates it as a shout. Provenance: 2026-06-04 on `gemini-3.1-flash-lite`, where prose quizzes were a demonstrated failure. The prompt copy stays (keep-list 5); the description copy is the one to convert to contract.
- **Confidence:** Medium (target-model behaviour undocumented; re-test per Step 7).
- **Action:** `rewrite` - diff hunk 13.

### F-08 - Migration-relative label in the system prompt
- **Location:** `backend/agent/prompts.py:25`.
- **Evidence:** `PROFILE RULES (v1 simplified):`
- **Pattern:** Group 1d, migration-relative phrasing ("a diff against a previous prompt version the model never saw").
- **Why obsolete:** "v1 simplified" only means something to someone who read the original spec's mastered_candidates design. The model reads it as an unexplained qualifier.
- **Confidence:** Medium.
- **Action:** `rewrite` to `PROFILE RULES:` - diff hunk 14. No test pins the parenthetical.

### F-09 - Pressure-language density in `IMMUTABLE_RULES`
- **Location:** `backend/agent/prompts.py:20-214`.
- **Evidence:** 5x `MUST`, ~12x `Do NOT` / `do NOT`, plus `ONLY`, `IGNORED`, `FIRST`, `TOGETHER`, `UNCHANGED`, `WITH`, `BEFORE`. Representative: `:84-88` "you MUST do it by calling ask_check_questions ... the ONLY sanctioned way ... a protocol violation"; `:136` "MUST contain a genuine 2-4 sentence"; `:166-172` "you MUST call ... Do NOT offer ... Do NOT ask ... do NOT end".
- **Pattern:** Group 1a, pressure language; Group 1c prohibition runs.
- **Why obsolete / why not:** for current Claude models this register over-triggers. For Gemini 3.5 Flash-Lite it is undocumented, and blame ties almost every instance to a live-smoke failure on the prior Gemini generation (2b7d6e4 2026-07-31, b73febb / a56bfea 2026-08-02, a44518b 2026-07-05, bc3bb5a 2026-06-07). Most carry an adjacent "because". Test pins at `test_prompts.py:84-96`, `:178-190`, `:193-204`, `:207-215` assert the emphatic wording.
- **Confidence:** Medium for the pattern, Low for any specific removal.
- **Action:** `flag`. Recommended path: after the 3.5 bump, re-run `scripts/eval_focus_clearing.py` and `eval_diagnostic_consent.py`, then trial one section at a time at normal volume (guide Step 7). No hunk proposed.

### F-10 - Numeric clamps on judgment outputs
- **Location:** `prompts.py:136` "2-4 sentence neutral-level answer"; `:167` "at most one sentence"; `:126` "not more than roughly once every several turns"; `summary_service.py:25` "2-3 sentences"; `:152` "3-5 sentences".
- **Pattern:** Group 1f, numeric output ceilings.
- **Why obsolete / why not:** the guide removes numeric caps tuned against older models' padding. Here `:136` is a *floor* added because the model under-delivered (offer-only reply, 2026-07-31), and the summary caps align with storage caps (`ROLLING_SUMMARY_MAX_CHARS`), making them contract. `1-5` items, `2-4` options, and `exactly 3` diagnostic items are schema / product constraints, not style caps.
- **Confidence:** Low.
- **Action:** `flag`.

### F-11 - `Do not hallucinate citations or facts.` / `Be concise.`
- **Location:** `prompts.py:22-23`. Provenance bbb596f 2026-05-05 (phase 1, original scaffold).
- **Pattern:** Group 1c padding / generic virtue; guide signal `do not hallucinate` is explicitly low-confidence.
- **Confidence:** Low.
- **Action:** `flag`. Re-test removal only after F-09's re-baseline; "Be concise" is acceptable qualitative length guidance.

### F-12 - Tool names throughout the system prompt
- **Location:** `prompts.py` (every protocol section names `update_topic_profile`, `retrieve_chunks`, `ask_check_questions`).
- **Pattern:** Group 3, "tool names in system-prompt prose - delete".
- **Why not:** the tool set is fixed at three and never toggled, the prompt and descriptions agree, and ten tests pin the names. Keep-list 8 (working redundancy) wins.
- **Confidence:** Low.
- **Action:** `flag`, no edit.

### F-13 - Stale project name and incident IDs in agent files
- **Location:** `.claude/skills/project-conventions/SKILL.md:7` "(AdaptLearn / Crux)"; `.claude/agents/migration-reviewer.md:9` "AdaptLearn backend", `:10-11` "Postgres 17 with pgvector 0.8"; both files "(C-12)".
- **Pattern:** Group 2, history narratives / volatile version pins.
- **Why obsolete:** project renamed to Crux; the pgvector version is a factual claim nobody re-checks; "C-12" is an incident ID that carries no authority for the rule.
- **Confidence:** Medium (name), Low (version, IDs).
- **Action:** `rewrite` name only - diff hunk 15. Version pin and IDs: `flag`.

### F-14 - `update_topic_profile` description
- **Location:** `tools.py:35-47`.
- **Assessment:** six sentences of contract, matches `profile_service` behaviour. Clean. Listed so the inventory is complete.
- **Action:** none.

## Proposed diff (Step 6)

One finding per hunk. High and Medium only. F-09 through F-12 are report-only.

### Hunk 1 - F-01: parameter descriptions (`docs/api/openapi.yaml`)

Run `python backend/scripts/gen_contracts.py` afterwards; CI enforces zero drift.

```diff
     UpdateTopicProfileArgs:
       ...
       properties:
-        session_id:           { type: string, maxLength: 64 }
+        session_id:
+          type: string
+          maxLength: 64
+          description: Ignored; the server injects the authoritative session id.
         knowledge_level:
           oneOf:
             - $ref: "#/components/schemas/KnowledgeLevel"
             - type: "null"
           default: null
+          description: >-
+            New session-wide level. Requires evidence_type declared or tested;
+            the patch fails without it.
-        add_confirmed_gap:    { type: [string, "null"], default: null, maxLength: 200 }
-        add_mastered_concept: { type: [string, "null"], default: null, maxLength: 200 }
-        focus_target_gap:     { type: [string, "null"], default: null, maxLength: 200 }
+        add_confirmed_gap:
+          type: [string, "null"]
+          default: null
+          maxLength: 200
+          description: >-
+            Concept the learner does not yet know. Short noun phrase. Upserted
+            into confirmed_gaps (an existing entry is refreshed, not
+            duplicated) and removed from mastered_concepts if present there.
+        add_mastered_concept:
+          type: [string, "null"]
+          default: null
+          maxLength: 200
+          description: >-
+            Concept the learner has demonstrated. Recorded only with
+            evidence_type declared (learner said so) or tested; inferred is
+            ignored server-side. Upserted into mastered_concepts and removed
+            from confirmed_gaps if present there.
+        focus_target_gap:
+          type: [string, "null"]
+          default: null
+          maxLength: 200
+          description: >-
+            Gap to concentrate on. Omit to leave focus unchanged. Send null
+            together with focus_clear_reason to clear it.
         focus_clear_reason:
           oneOf:
             - $ref: "#/components/schemas/FocusClearReason"
             - type: "null"
           default: null
+          description: >-
+            Required when focus_target_gap is null. tested_correct is accepted
+            only if a correct check answer for that gap was recorded this
+            session.
         evidence_type:
           oneOf:
             - $ref: "#/components/schemas/EvidenceType"
             - type: "null"
           default: null
+          description: >-
+            How you know. declared = learner stated it; inferred = observed
+            from engagement; tested = check-question outcome (server-owned;
+            if sent it is stored as declared). Optional for a focus-only patch.
         subtopic:
           type: [string, "null"]
           default: null
           minLength: 1
           maxLength: 100
+          description: >-
+            Subtopic name for a per-subtopic level. Short noun phrase; reuse an
+            existing name when one matches. Must be sent with subtopic_level.
         subtopic_level:
           oneOf:
             - $ref: "#/components/schemas/KnowledgeLevel"
             - type: "null"
           default: null
+          description: Learner's level on subtopic. Must be sent with subtopic.

     RetrieveChunksArgs:
       type: object
       additionalProperties: false
       required: [session_id, query]
       properties:
-        session_id: { type: string, maxLength: 64 }
-        query:      { type: string, maxLength: 500 }
-        k:          { type: integer, default: 5, minimum: 1, maximum: 20 }
+        session_id:
+          type: string
+          maxLength: 64
+          description: Ignored; the server injects the authoritative session id.
+        query:
+          type: string
+          maxLength: 500
+          description: >-
+            Natural-language search text. Phrase it as the learner's question
+            or the concept name, not as an instruction.
+        k:
+          type: integer
+          default: 5
+          minimum: 1
+          maximum: 20
+          description: Maximum number of chunks to return, 1-20. Default 5.

     AskCheckQuestionsArgs:
       ...
       properties:
-        session_id: { type: string, maxLength: 64 }
-        gap:        { type: string, maxLength: 200 }
+        session_id:
+          type: string
+          maxLength: 64
+          description: Ignored; the server injects the authoritative session id.
+        gap:
+          type: string
+          maxLength: 200
+          description: >-
+            The single confirmed gap every item probes. Use the exact name from
+            confirmed_gaps so grading updates the right profile entry.
         items:
           type: array
           minItems: 1
           maxItems: 5
+          description: Ordered batch of questions, all on gap. One batch per turn.
           items:
             type: object
             additionalProperties: false
             required: [question, options, correct_index, explanation]
             properties:
-              question:      { type: string, maxLength: 1000 }
+              question:
+                type: string
+                maxLength: 1000
+                description: The stem only. Do not number or letter the options inside it; the options array is rendered by the UI.
               options:
                 type: array
                 minItems: 2
                 maxItems: 4
                 items: { type: string, maxLength: 200 }
+                description: Answer choices, exactly one correct, all plausible.
-              correct_index: { type: integer, minimum: 0 }
-              explanation:   { type: string, maxLength: 500 }
+              correct_index:
+                type: integer
+                minimum: 0
+                description: 0-based index into options of the correct answer. Must be less than the number of options.
+              explanation:
+                type: string
+                maxLength: 500
+                description: One sentence shown to the learner after they answer, whether right or wrong.
```

### Hunk 2 - F-02: `retrieve_chunks` description (`backend/agent/tools.py:55-59`)

```diff
             "description": (
-                "Vector search over the session's ingested documents."
-                " Returns chunks with doc_id, text, page, score. Call this"
-                " when RETRIEVAL is REQUIRED and INGESTION_STATUS is ready."
+                "Semantic search over the documents the learner uploaded to this"
+                " session. Returns up to k chunks, each with doc_id, doc_name,"
+                " page, text, and score. score is a cosine distance: lower means"
+                " a closer match, and results are already ordered best-first."
+                " Returns status=no_results when ingestion is not ready or"
+                " nothing matches; status=failed on a search error. Call it when"
+                " RETRIEVAL is REQUIRED and INGESTION_STATUS is ready, or when"
+                " the learner refers to their notes. Not needed when RETRIEVAL"
+                " is PROVIDED: those excerpts are already in the prompt."
             ),
```

Field list verified against `retrieval_service.py:92-101`; best-first ordering verified against `pgvector_store.py:101` (`order_by(distance)` ascending). Exclusivity and upsert semantics in hunk 1 verified against `profile_service.py:233-251`. None of the three `*Args` schemas is referenced by a REST path, so the "session_id is ignored" wording is accurate for every caller.

### Hunk 3 - F-03: stale streaming claim (`docs/api/openapi.yaml` -> `AskCheckQuestionsArgs.description`)

```diff
       description: |
         Register an ordered batch of 1..5 multiple-choice check-questions and end
-        the turn. The first question's text is also streamed as assistant text.
-        Per-item correct_index must be < len(options); that cross-field rule is
+        the turn. The card renders from this payload; any lead-in prose is the
+        model's own text in the same turn.
+        Per-item correct_index must be < len(options); that cross-field rule is
         enforced in check_question_service, not here.
```

### Hunk 4 - F-04: `CLAUDE.md:54-57`

The second line also adds `subtopic?, subtopic_level?` to the `update_topic_profile` signature, which CLAUDE.md omits (added in roadmap slice 8, `a4ef826`). Same file, same stale-tool-list defect; take or leave that line independently.

```diff
-One **TutorAgent** via LiteLLM direct. Three tools:
+One **TutorAgent** via LiteLLM direct. Three tools (`backend/agent/tools.py`):
 - `retrieve_chunks(session_id, query, k=5)` — pgvector cosine-distance search over `chunk_embeddings` (Supabase Postgres).
 - `update_topic_profile(session_id, knowledge_level?, add_confirmed_gap?, add_mastered_concept?, focus_target_gap?, focus_clear_reason?, subtopic?, subtopic_level?, evidence_type)` — Pydantic-validated patch.
-- `record_learning_event(session_id, gap_tested, question, correct)` — logs check-question. Incorrect on mastered concept → server-side demotion.
+- `ask_check_questions(session_id, gap, items[1..5])` — registers a multiple-choice batch and ends the turn. The server grades answers deterministically and writes `LearningEvent`s; a correct answer promotes the gap to `mastered_concepts`, an incorrect answer on a mastered concept demotes it. The model never grades.
```

### Hunk 5 - F-04: design doc `:120-124`, `:145`

Proposed as a dated reconciliation note in the doc's existing style (line 29 precedent), because the doc is the declared source of truth and CLAUDE.md says to surface conflicts rather than pick.

```diff
-3. **`record_learning_event(session_id, gap_tested, question, correct)`** — log check-question. Side-effect: if `correct=false` and `gap_tested` is in `mastered_concepts`, server-side demote (remove from list).
+3. **`ask_check_questions(session_id, gap, items[1..5])`** — register a multiple-choice batch and end the turn (reconciled 2026-09-10; was `record_learning_event`, removed in the 2026-06-04 interactive check-question redesign). The server grades each answer and writes the `LearningEvent`; `correct=false` on a `mastered_concepts` entry demotes it server-side.
 ...
-**End-of-focus protocol:** when agent clears `focus_target_gap`, system prompt instructs: generate 2–3 check questions, log each via `record_learning_event`.
+**End-of-focus protocol:** when the agent wants to verify a focus gap it calls `ask_check_questions`; a correct server-graded answer is what makes `focus_clear_reason=tested_correct` valid (reconciled 2026-09-10).
```

### Hunk 6 - F-04: `.claude/skills/live-smoke/SKILL.md:37`

```diff
-... Watch backend logs for tool calls (`retrieve_chunks`, `update_topic_profile`, `record_learning_event`).
+... Watch backend logs for tool calls (`retrieve_chunks`, `update_topic_profile`, `ask_check_questions`).
```

### Hunk 7 - F-05: `CLAUDE.md:112`

```diff
-- LLM reliability checkpoints: Phase 2 (`update_topic_profile` ≥85%), Phase 3 (`focus_target_gap` clearing ≥85%). Below threshold → 2-3 prompt iterations, then swap to `anthropic/claude-sonnet-4-6`.
+- LLM reliability checkpoints: Phase 2 (`update_topic_profile` ≥85%), Phase 3 (`focus_target_gap` clearing ≥85%). Below threshold → 2-3 prompt iterations, then swap to `anthropic/claude-sonnet-5`.
```

### Hunk 8 - F-05: `backend/scripts/eval_focus_clearing.py:15`, `:287-290`

```diff
-Per CLAUDE.md line 105-107: PASS threshold is >=85% across patterns x replicates.
+Per the CLAUDE.md reliability checkpoints: PASS threshold is >=85% across patterns x replicates.
 ...
-            "Per CLAUDE.md line 105-107: gate threshold is >=85% across the four"
+            "Per the CLAUDE.md reliability checkpoints: gate threshold is >=85% across the four"
             " Design Doc S6.3 patterns. Below 85% triggers prompt iteration; if"
             " still failing after 2-3 iterations, swap default model to"
-            " `anthropic/claude-sonnet-4-6`.\n\n"
+            " `anthropic/claude-sonnet-5`.\n\n"
```

### Hunk 9 - F-05: `backend/scripts/eval_missed_concept_reference.py:20`, `:238-244`

Same two substitutions as hunk 8.

### Hunk 10 - F-05: `backend/services/cost_meter.py:259-264`

```diff
-    # Anthropic Claude Sonnet 4.6 — project fallback model if gemini underperforms (verify at anthropic.com/pricing)
-    "anthropic/claude-sonnet-4-6": {
-        "input_per_1k": Decimal("0.003"),      # $3.00  / 1M tokens
-        "output_per_1k": Decimal("0.015"),     # $15.00 / 1M tokens
+    # Anthropic Claude Sonnet 5 — project fallback model if gemini underperforms
+    # (verified against the Claude API price table 2026-09-10)
+    "anthropic/claude-sonnet-5": {
+        "input_per_1k": Decimal("0.002"),      # $2.00  / 1M tokens
+        "output_per_1k": Decimal("0.010"),     # $10.00 / 1M tokens
     },
```

Check `tests/test_cost_meter_estimate.py` and `test_llm_call_log.py` for the old key before regenerating; grep found none, but confirm after applying.

### Hunk 11 - F-05: design doc `:29`, `:468`

```diff
-| LLM | `gemini/gemini-3.1-flash-lite` via LiteLLM (free tier) — was `Gemini 2.5 Pro` (reconciled 2026-05-30) | Cost; paid `claude-sonnet-4-6` as fallback if reliability issues |
+| LLM | `gemini/gemini-3.5-flash-lite` via LiteLLM (reconciled 2026-09-10; was 3.1-flash-lite, bumped 2026-08-24) | Cost; paid `claude-sonnet-5` as fallback if reliability issues |
 ...
-1. `anthropic/claude-sonnet-4-6` (paid, ~$3/M input). Strongest tool-call reliability.
+1. `anthropic/claude-sonnet-5` (paid, $2/M input). Strongest tool-call reliability.
```

### Hunk 12 - F-06: design doc `:12`, `:59`, `:460`

```diff
-> default LLM is **`gemini/gemini-3.1-flash-lite`** (not 2.5 Pro); embeddings are
+> default LLM is **`gemini/gemini-3.5-flash-lite`** (reconciled 2026-09-10); embeddings are
 ...
-- LLM call dominates wall time (`gemini-3.1-flash-lite`: a few seconds typical; mitigated by SSE streaming)
+- LLM call dominates wall time (`gemini-3.5-flash-lite`: a few seconds typical; mitigated by SSE streaming)
 ...
-**Default:** `gemini/gemini-2.5-pro` via LiteLLM, free tier.
+**Default:** `gemini/gemini-3.5-flash-lite` via LiteLLM (reconciled 2026-09-10; `config.py` is authoritative).
```

### Hunk 13 - F-07: `ask_check_questions` description (`backend/agent/tools.py:67-74`)

Re-test per Step 7 before merging (Gemini 3.5 Flash-Lite, prose-quiz failure).

```diff
             "description": (
-                "The ONLY way to quiz, test, or check the learner's understanding."
-                " Pose a BATCH of 1-5 multiple-choice questions probing one focus"
-                " gap via items[]. Each item: 2-4 plausible options, the 0-based"
-                " correct_index, and a one-sentence explanation shown after answering."
-                " This ends your turn. The learner answers each; the server grades"
-                " deterministically and updates the profile. You do NOT grade."
+                "Render an interactive multiple-choice check card for one"
+                " confirmed gap. items holds 1-5 questions; each has 2-4 options,"
+                " a 0-based correct_index, and a one-sentence explanation shown"
+                " after the learner answers. Calling it ends the turn. The server"
+                " grades every answer and updates the profile; results arrive in"
+                " the next turn as a [check results] user message. Only one batch"
+                " can be open at a time; a second call while one is open fails."
+                " Quizzes written as plain prose render no card, so this is the"
+                " mechanism for any check of understanding."
             ),
```

The last sentence keeps the routing intent with its reason instead of "ONLY". `test_prompts.py:30` pins the name in `IMMUTABLE_RULES`, not the description; no test change.

### Hunk 14 - F-08: `backend/agent/prompts.py:25`

```diff
-PROFILE RULES (v1 simplified):
+PROFILE RULES:
```

No test pins the parenthetical (`test_prompts.py` splits on `KNOWLEDGE DIAGNOSTIC:`, `LESSON FLOW:`, `REVIEW-GAPS MODE:`, `RETRIEVAL POLICY:`, `SUBTOPIC LEVELS:` only).

### Hunk 15 - F-13: project name

```diff
 # .claude/skills/project-conventions/SKILL.md:7
-# Project Conventions (AdaptLearn / Crux)
+# Project Conventions (Crux)

 # .claude/agents/migration-reviewer.md:9
-You are a database migration reviewer for the AdaptLearn backend. CI runs the test
+You are a database migration reviewer for the Crux backend. CI runs the test
```

## Verification plan (Step 7)

1. Hunks 1, 3: `python backend/scripts/gen_contracts.py`, then `pytest tests/test_contracts.py tests/test_prompts.py` from `backend/`. Descriptions do not change validation, so the full suite should stay green.
2. Hunks 2, 13: paid smoke on `gemini-3.5-flash-lite` - one retrieval turn (confirm the cited chunk is the lowest-distance one) and one quiz request (confirm `ask_check_questions` fires, not prose). Run `scripts/eval_diagnostic_consent.py` as the regression gate for hunk 13.
3. Hunk 10: `pytest tests/test_cost_meter_estimate.py tests/test_llm_call_log.py`.
4. F-09 re-baseline (not in diff): `scripts/eval_focus_clearing.py` and `eval_diagnostic_consent.py` on 3.5 first, then trial one section at normal volume per run.
5. Out-of-band grep before applying any prompt hunk: `test_prompts.py`, `test_chat_diagnostic_accepted.py`, `frontend/e2e/` for the exact strings.
