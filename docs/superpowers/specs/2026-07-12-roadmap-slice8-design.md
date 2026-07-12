# Roadmap Slice 8 — R4 Deeper Adaptivity (Design)

Date: 2026-07-12
Status: Approved (brainstorm gate per roadmap section "R4 — Deeper adaptivity")
Source: `docs/planning/2026-07-06-10x-roadmap.md` R4.1 + R4.2
Branch: `feat/roadmap-slice8` (off `dev` at `799bb08`)

## 1. Scope

Two roadmap items, one slice:

- **R4.1 Per-subtopic knowledge level** — the profile evolves from a single
  `knowledge_level` to optional per-subtopic levels with a session-level
  default.
- **R4.2 Evidence provenance on concepts** — `mastered_concepts` and
  `confirmed_gaps` entries carry `{name, evidence_type, last_event_at}`
  instead of flat strings; the R2 review scheduler weights `tested` evidence
  above `declared`.

Out of scope: R5 practice exam mode; any DB schema migration (the profile
remains a JSON blob on `sessions.topic_profile_json`); user-created
subtopics.

## 2. Decisions made during brainstorm

| Question | Decision |
|---|---|
| Where do subtopic names come from? | Agent-named free text via `update_topic_profile`. Casefold-strip canonicalization on write to limit name drift. |
| How does evidence reach the R2 scheduler? | Name-join: the review route builds an evidence map from session profiles and passes it into the pure scheduler. No `learning_events` column. |
| What does "weights tested above declared" mean? | Among due items, non-`tested` (declared or unknown) concepts sort ahead of `tested` ones — review shaky knowledge first. Intervals untouched. |
| User control over subtopics in ProfileView? | Edit level + delete. No user create — the agent owns the vocabulary (matches the WS-E "focus is agent-owned" precedent). |
| Schema representation? | Typed objects in place (Approach A): `list[ConceptEntry]` + `subtopic_levels` dict inside `TopicProfile`. Rejected: parallel metadata map (two sources of truth), DB normalization (beyond scope). |

## 3. Data model

### 3.1 New contract model

```yaml
ConceptEntry:
  name: string (1..200, required)
  evidence_type: enum [declared, tested] | null
  last_event_at: date-time | null
```

`inferred` is never persisted — `apply_patch` already rejects it as a mastery
gate; that behavior is unchanged.

### 3.2 TopicProfile changes

```yaml
TopicProfile:
  knowledge_level: enum [beginner, intermediate, advanced] | null   # session-level default, unchanged
  subtopic_levels: object (map string -> enum [beginner, intermediate, advanced])  # new, default {}
  confirmed_gaps: array of ConceptEntry        # was array of string
  mastered_concepts: array of ConceptEntry     # was array of string
  focus_target_gap: string | null              # unchanged
  last_session_summary: string | null          # unchanged
```

Contracts are codegen'd: edit `docs/api/openapi.yaml` first, then run
`python backend/scripts/gen_contracts.py`. Never hand-edit
`backend/contracts/models.py`.

### 3.3 Tolerant parse upgrade (`_parse_profile`, `backend/services/profile_service.py:42`)

Before validation, walk `mastered_concepts` and `confirmed_gaps`: any bare
string element `"limits"` upgrades to
`{"name": "limits", "evidence_type": null, "last_event_at": null}`. Dict
elements pass through to normal validation. The existing behavior is kept:
unknown top-level keys are dropped with a log line, and the function never
raises (final fallback `TopicProfile()`).

Upgrade is write-forward: the next `save_profile` persists the new shape.
`seed_from_prior` copies raw JSON forward, so resumed sessions may carry
legacy blobs indefinitely — the parse upgrade must remain permanently, not as
a transition shim.

ETag is unaffected structurally: `profile_etag` hashes the *parsed* model's
dump, and both GET and the If-Match guard parse first, so they always agree.
(A legacy blob's ETag changes once, at the moment the code ships — that is
expected and harmless; the client refetches on 412 as designed.)

### 3.4 Membership, dedup, and stamping rules

- Membership checks compare casefolded, stripped `name` (today `apply_patch`
  does `x not in list` on strings).
- `last_event_at` is stamped server-side (UTC now) — never accepted from the
  LLM or the user:
  - `apply_patch` appending a concept stamps it.
  - A graded check answer touching a concept updates its stamp.
  - A correct graded answer on a mastered concept upgrades its
    `evidence_type` to `tested`.
  - An incorrect graded answer follows the existing demotion path
    (mastered -> confirmed_gaps); the demoted gap entry carries
    `evidence_type: "tested"` and a fresh stamp.

## 4. Agent tool and prompt (R4.1)

### 4.1 `UpdateTopicProfileArgs` (via openapi.yaml + codegen)

Two new flat fields (flat args are more reliable for LLM tool calls than a
nested object):

```yaml
subtopic: string (1..100) | null
subtopic_level: enum [beginner, intermediate, advanced] | null
```

Validation: both-or-neither. Write path canonicalizes the subtopic key
(casefold + strip) before inserting into `subtopic_levels`.

### 4.2 Cap

`subtopic_levels` is capped at 20 keys. A patch introducing a new key when
the map is full returns `ToolResult(ok=False, ...)` with an explanatory
message (prompt-size guard; existing keys can always be updated).

### 4.3 Prompt context

`_profile_to_dict` already dumps the whole profile into
`CURRENT TOPIC PROFILE:` (`backend/agent/prompts.py:217`), so the new fields
reach the prompt with no plumbing. `IMMUTABLE_RULES` is extended to:

- document `subtopic_levels` and the session-default semantics
  (`knowledge_level` applies when a subtopic has no entry);
- instruct the agent when to set a subtopic level (on declared or tested
  evidence, mirroring the existing evidence rules for mastery);
- note that concept entries now show `evidence_type` so the agent can reason
  about how trustworthy a mastery claim is.

### 4.4 Reliability checkpoint (R4.1 AC3)

New `backend/scripts/eval_subtopic_levels.py`, modeled on
`reliability_focus_clear.py` / `eval_focus_clearing.py`: scripted turns that
should produce subtopic-scoped level patches; pass criterion >= 85% patch
success. Manual, paid, not in CI — an owed human gate before merge, extending
the WS-G3 obligation (per roadmap, no new mechanism).

## 5. R2 scheduler weighting (R4.2 AC2)

`compute_schedule` (`backend/services/review_queue_service.py`) gains an
optional parameter:

```python
evidence_map: dict[str, str | None]   # casefolded concept name -> evidence_type
```

The function stays pure — the caller supplies the map. The due-item sort key
changes from `due_at` to `(evidence_rank, due_at)` where `tested` -> 1 and
anything else (declared, or absent from the map) -> 0. Effect: among due
items, weakly-evidenced knowledge reviews first. The due filter and SM-2-lite
interval math are untouched.

`routes/review.py` builds the map by loading the profile of each distinct
session present in the event set (one `load_profile` per session — bounded by
the sessions already in the queue) and collecting
`{casefold(entry.name): entry.evidence_type}` from both concept lists.

## 6. API contract and routes

- `docs/api/openapi.yaml` is edited first; `gen_contracts.py` regenerates.
- GET profile **response shape changes** (list of strings -> list of
  ConceptEntry, new `subtopic_levels`). Per R4.2 AC3 this gets an explicit
  version note in the openapi description. The PATCH *request* contract is
  extended, not broken.
- `ProfilePatchRequest` gains the flat pair `subtopic` + `subtopic_level`
  (both-or-neither), added to the `_add_exclusive` mutual-exclusion set.
- New route: `DELETE /api/profile/{session_id}/subtopic_levels/{item}`,
  mirroring the two existing DELETE routes (mastered_concepts,
  confirmed_gaps), same ETag/If-Match guard (428/412).

## 7. Frontend

`ProfileView.vue` + `services/profileApi.js`:

- Concept chips read `entry.name`. Each chip shows a small evidence badge —
  `tested` or `declared`; null renders no badge.
- New subtopic section: list of subtopic names, each with the same
  beginner/intermediate/advanced pill pattern used for the session level,
  plus a remove button. No create UI.
- ETag flow unchanged (`_applyWrite` pattern).

Consumer sweep: every reader of `mastered_concepts` / `confirmed_gaps` must
handle the entry shape. Backend consumers (summary service, prompt builder,
F2 review-gaps resume, gap picker, diagnostic seeding) go through a new
helper `concept_names(entries) -> list[str]` where only names are needed.
Frontend consumers (session store, AggregateProfileView, recap rendering)
read `entry.name`. The sweep uses native Grep, not rtk (known false-zero
gotcha).

## 8. Testing

- TDD throughout (project convention).
- Backend: parse-upgrade matrix (all-legacy, mixed, malformed elements,
  already-new); `apply_patch` provenance stamping, subtopic cap, casefold
  dedup, both-or-neither validation; evidence upgrade/demotion on graded
  answers; scheduler ordering with and without evidence map; ETag 412 on
  concurrent subtopic edit; contract drift gate stays green.
- Frontend: vitest for evidence badges, subtopic render/edit/delete, ETag
  conflict path; existing Playwright profile flows must stay green.
- No alembic migration and therefore no live-DB migration gate.

## 9. Owed human gates (post-merge convention)

1. Paid subtopic-level reliability eval, >= 85% (section 4.4).
2. Paid live smoke: one session exercising subtopic set + evidence badge +
   review queue ordering.

## 10. Execution

Same machinery as slices 1-7: SDD (subagent-driven development) on
`feat/roadmap-slice8`, two-stage per-task review, opus final review over the
full branch diff, PR into `dev`.
