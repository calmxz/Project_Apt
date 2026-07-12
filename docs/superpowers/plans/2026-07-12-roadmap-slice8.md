# Roadmap Slice 8 — R4 Deeper Adaptivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profile concepts carry `{name, evidence_type, last_event_at}` provenance; the profile gains agent-named per-subtopic knowledge levels; the R2 review scheduler surfaces weakly-evidenced concepts first.

**Architecture:** The profile stays a JSON blob on `sessions.topic_profile_json` — no DB migration. `_parse_profile` permanently upgrades legacy string list elements on read (write-forward). Contracts are codegen'd from `docs/api/openapi.yaml`. The scheduler stays pure; evidence reaches it via a name-join map built in the route.

**Tech Stack:** FastAPI + Pydantic (codegen'd contracts), SQLAlchemy (sqlite in tests, Supabase Postgres live), Vue 3 + Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-07-12-roadmap-slice8-design.md` (approved). Read it before starting any task.

## Global Constraints

- Branch: `feat/roadmap-slice8` (already created off `dev` at `799bb08`).
- No emojis in code or comments.
- Contracts: edit `docs/api/openapi.yaml` FIRST, then run `python backend/scripts/gen_contracts.py` from repo root. NEVER hand-edit `backend/contracts/models.py`. CI enforces zero drift.
- Backend tests: from `backend/`: `pytest` (full) or `pytest tests/test_foo.py::test_bar -v` (single). If piping through `tail` swallows output, use PowerShell `python -m pytest -q 2>&1 | Select-Object -Last 30`.
- Frontend tests: from `frontend/`: `npm run test:unit -- --run`. Lint: `npm run lint`.
- Repo-wide sweeps: use the native Grep tool, NOT `rtk grep` (known false-zero gotcha).
- `subtopic_levels` cap: `MAX_SUBTOPICS = 20` (single constant in `backend/services/profile_service.py`).
- Subtopic keys are canonicalized `strip().casefold()` everywhere.
- `last_event_at` is stamped server-side with `datetime.now(timezone.utc)` — never accepted from the LLM or the user.
- `evidence_type` on ConceptEntry is `declared | tested | null` — `inferred` is never persisted.
- TDD: every behavior change lands with its failing test first.

---

### Task 1: Schema flip — ConceptEntry + subtopic_levels contracts, tolerant parse upgrade, all profile mutators and consumers

This task is deliberately larger than the others: switching `TopicProfile.mastered_concepts` / `confirmed_gaps` from `list[str]` to `list[ConceptEntry]` breaks every consumer at once, so contracts + service + consumers + test repairs must land as one green-suite unit. Everything after this task is additive.

**Files:**
- Modify: `docs/api/openapi.yaml` (schemas ~line 507 `TopicProfile`, ~569 `UpdateTopicProfileArgs`, ~979 `ProfilePatchRequest`; paths after line 397; also add `ConceptEntry`, `ConceptEvidence` schemas and the new DELETE path)
- Regenerate: `backend/contracts/models.py` (via codegen only)
- Modify: `backend/services/profile_service.py`
- Modify: `backend/services/learning_event_service.py`
- Modify: `backend/routes/chat.py:84-91`
- Modify: `backend/agent/prompts.py` (`_profile_to_dict`, `_gap_accuracy_label`)
- Test: `backend/tests/test_contracts.py`, `backend/tests/test_profile_service.py`, plus repairs across `backend/tests/` (list in Step 9)

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks rely on these exact names):
  - `contracts.ConceptEntry` — Pydantic model `{name: str, evidence_type: Literal["declared","tested"] | None, last_event_at: datetime | None}`
  - `profile_service.canon(name: str) -> str` — `name.strip().casefold()`
  - `profile_service.find_entry(entries: list[ConceptEntry], name: str) -> ConceptEntry | None`
  - `profile_service.upsert_entry(entries: list[ConceptEntry], name: str, *, evidence_type: str | None, stamp: datetime | None) -> list[ConceptEntry]`
  - `profile_service.concept_names(entries: list[ConceptEntry] | None) -> list[str]`
  - `profile_service.MAX_SUBTOPICS = 20`
  - `TopicProfile.subtopic_levels: dict[str, KnowledgeLevel] | None` defaulting `{}`
  - `UpdateTopicProfileArgs.subtopic`, `UpdateTopicProfileArgs.subtopic_level` (fields exist after codegen; behavior wired in Task 3)
  - `ProfilePatchRequest.subtopic`, `ProfilePatchRequest.subtopic_level` (behavior wired in Task 4)

- [ ] **Step 1: Write failing contract tests**

Append to `backend/tests/test_contracts.py`:

```python
def test_concept_entry_defaults():
    from contracts import ConceptEntry

    e = ConceptEntry(name="limits")
    assert e.name == "limits"
    assert e.evidence_type is None
    assert e.last_event_at is None


def test_concept_entry_rejects_inferred():
    import pytest
    from pydantic import ValidationError
    from contracts import ConceptEntry

    with pytest.raises(ValidationError):
        ConceptEntry(name="limits", evidence_type="inferred")


def test_topic_profile_new_shape():
    from contracts import ConceptEntry, TopicProfile

    p = TopicProfile()
    assert p.subtopic_levels == {}
    p2 = TopicProfile(
        mastered_concepts=[{"name": "limits", "evidence_type": "tested"}],
        subtopic_levels={"integration by parts": "beginner"},
    )
    assert isinstance(p2.mastered_concepts[0], ConceptEntry)
    assert p2.subtopic_levels["integration by parts"] == "beginner"


def test_update_args_subtopic_fields():
    from contracts import UpdateTopicProfileArgs

    a = UpdateTopicProfileArgs(
        session_id="s1", subtopic="chain rule", subtopic_level="intermediate"
    )
    assert a.subtopic == "chain rule"
    assert a.subtopic_level == "intermediate"


def test_profile_patch_request_subtopic_fields():
    from contracts import ProfilePatchRequest

    b = ProfilePatchRequest(subtopic="chain rule", subtopic_level="advanced")
    assert b.subtopic == "chain rule"
    assert b.subtopic_level == "advanced"
```

- [ ] **Step 2: Run to verify failure**

Run from `backend/`: `pytest tests/test_contracts.py -v -k "concept_entry or new_shape or subtopic"`
Expected: FAIL — `ImportError: cannot import name 'ConceptEntry'`.

- [ ] **Step 3: Edit `docs/api/openapi.yaml`**

3a. Add two schemas directly above `TopicProfile` (the `# ---- Core domain ----` block, ~line 506):

```yaml
    ConceptEvidence:
      type: string
      enum: [declared, tested]
      description: >
        Persisted provenance on a profile concept. "inferred" exists as tool-arg
        EvidenceType but is never persisted onto an entry.

    ConceptEntry:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name: { type: string, minLength: 1, maxLength: 200 }
        evidence_type:
          oneOf:
            - $ref: "#/components/schemas/ConceptEvidence"
            - type: "null"
          default: null
        last_event_at:
          oneOf:
            - { type: string, format: date-time }
            - type: "null"
          default: null
```

3b. Replace the `confirmed_gaps` / `mastered_concepts` items and add `subtopic_levels` inside `TopicProfile` (~line 507), and add the version note to a `description` on the schema:

```yaml
    TopicProfile:
      type: object
      additionalProperties: false
      description: |
        v2 (slice 8, 2026-07-12): concept lists carry ConceptEntry objects
        (previously plain strings) and subtopic_levels was added. Legacy
        string-element blobs are upgraded on read by the backend's tolerant
        parser; API consumers only ever see the v2 shape.
      properties:
        knowledge_level:
          oneOf:
            - $ref: "#/components/schemas/KnowledgeLevel"
            - type: "null"
          default: null
        subtopic_levels:
          type: object
          additionalProperties:
            $ref: "#/components/schemas/KnowledgeLevel"
          default: {}
          description: >
            Per-subtopic knowledge levels keyed by canonicalized
            (strip+casefold) agent-named subtopic. knowledge_level is the
            session-wide default for subtopics without an entry.
        confirmed_gaps:
          type: array
          items: { $ref: "#/components/schemas/ConceptEntry" }
          default: []
        mastered_concepts:
          type: array
          items: { $ref: "#/components/schemas/ConceptEntry" }
          default: []
        focus_target_gap:
          type: [string, "null"]
          default: null
        last_session_summary:
          type: [string, "null"]
          default: null
```

3c. Add to `UpdateTopicProfileArgs.properties` (~line 578, after `evidence_type`), and extend its `description` with one line: `subtopic and subtopic_level must be provided together (service-enforced cross-field rule).`

```yaml
        subtopic:
          type: [string, "null"]
          default: null
          minLength: 1
          maxLength: 100
        subtopic_level:
          oneOf:
            - $ref: "#/components/schemas/KnowledgeLevel"
            - type: "null"
          default: null
```

3d. Add the same two properties to `ProfilePatchRequest.properties` (~line 986), and extend its `description` with: `subtopic + subtopic_level (together) update an EXISTING subtopic's level; unknown subtopics are rejected — subtopics are created only by the tutor.`

3e. Add the DELETE path after `/api/profile/{session_id}/confirmed_gaps/{item}` (~line 417):

```yaml
  /api/profile/{session_id}/subtopic_levels/{item}:
    delete:
      tags: [profile]
      summary: Remove one subtopic level entry. Optimistic-concurrency guarded.
      operationId: deleteSubtopicLevel
      parameters:
        - $ref: "#/components/parameters/SessionId"
        - name: item
          in: path
          required: true
          schema: { type: string }
        - $ref: "#/components/parameters/IfMatch"
      responses:
        "200":
          description: Updated profile.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProfileMutationResponse" }
        "404": { $ref: "#/components/responses/NotFound" }
        "412": { $ref: "#/components/responses/PreconditionFailed" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }
```

- [ ] **Step 4: Regenerate contracts and inspect**

Run from repo root: `python backend/scripts/gen_contracts.py`
Then inspect `backend/contracts/models.py`: `ConceptEntry` must exist with the three fields; `TopicProfile.subtopic_levels` must render as a `dict[str, ...]`-style mapping defaulting `{}`; `ConceptEntry` must be importable from `contracts`. If the generator renders the map or defaults differently (e.g. `None` default), adjust the YAML (not the generated file) until the contract tests in Step 1 pass. Run: `pytest tests/test_contracts.py -v` — Expected: PASS. The full suite is now transiently red; that is expected until Step 9.

- [ ] **Step 5: Write failing parse-upgrade and helper tests**

Append to `backend/tests/test_profile_service.py`:

```python
from datetime import datetime, timezone

from contracts import ConceptEntry
from services.profile_service import (
    _parse_profile,
    canon,
    concept_names,
    find_entry,
    upsert_entry,
)


def test_parse_upgrades_legacy_string_elements():
    raw = '{"knowledge_level": "beginner", "mastered_concepts": ["limits"], "confirmed_gaps": ["chain rule", "u-sub"]}'
    p = _parse_profile(raw)
    assert p.mastered_concepts[0] == ConceptEntry(
        name="limits", evidence_type=None, last_event_at=None
    )
    assert concept_names(p.confirmed_gaps) == ["chain rule", "u-sub"]
    assert p.knowledge_level == "beginner"


def test_parse_accepts_mixed_legacy_and_new_elements():
    raw = (
        '{"mastered_concepts": ["limits", {"name": "derivatives",'
        ' "evidence_type": "tested", "last_event_at": null}]}'
    )
    p = _parse_profile(raw)
    assert concept_names(p.mastered_concepts) == ["limits", "derivatives"]
    assert p.mastered_concepts[1].evidence_type == "tested"


def test_parse_still_drops_unknown_keys_and_never_raises():
    raw = '{"mastered_concepts": ["limits"], "retired_field": 1}'
    p = _parse_profile(raw)
    assert concept_names(p.mastered_concepts) == ["limits"]
    assert _parse_profile("not json").mastered_concepts == []
    assert _parse_profile('{"mastered_concepts": [42]}').mastered_concepts == []


def test_parse_defaults_subtopic_levels_empty():
    assert _parse_profile("{}").subtopic_levels == {}


def test_entry_helpers():
    entries = [ConceptEntry(name="Limits")]
    assert canon("  LIMITS ") == "limits"
    assert find_entry(entries, "limits").name == "Limits"
    assert find_entry(entries, "derivatives") is None
    stamp = datetime.now(timezone.utc)
    out = upsert_entry(entries, "limits", evidence_type="tested", stamp=stamp)
    assert len(out) == 1 and out[0].evidence_type == "tested" and out[0].last_event_at == stamp
    out2 = upsert_entry(out, "chain rule", evidence_type=None, stamp=stamp)
    assert concept_names(out2) == ["Limits", "chain rule"]
```

Run: `pytest tests/test_profile_service.py -v -k "parse_upgrades or mixed_legacy or entry_helpers or drops_unknown or defaults_subtopic"`
Expected: FAIL — `ImportError` on the new helper names.

- [ ] **Step 6: Restructure `_parse_profile` and add helpers in `backend/services/profile_service.py`**

Add near the top (after `log = ...`):

```python
MAX_SUBTOPICS = 20


def canon(name: str) -> str:
    return name.strip().casefold()


def concept_names(entries: list | None) -> list[str]:
    return [e.name for e in (entries or [])]


def find_entry(entries: list, name: str):
    key = canon(name)
    for e in entries or []:
        if canon(e.name) == key:
            return e
    return None


def upsert_entry(
    entries: list, name: str, *, evidence_type: str | None, stamp: datetime | None
) -> list:
    """Append a ConceptEntry if name (casefolded) is absent; otherwise update
    the existing entry's provenance in place. Returns the (new) list."""
    out = list(entries or [])
    existing = find_entry(out, name)
    if existing is None:
        out.append(
            ConceptEntry(name=name, evidence_type=evidence_type, last_event_at=stamp)
        )
        return out
    if evidence_type is not None:
        existing.evidence_type = evidence_type
    if stamp is not None:
        existing.last_event_at = stamp
    return out


def _upgrade_concept_lists(data: dict) -> dict:
    """Element-level legacy upgrade: bare-string concepts become ConceptEntry
    dicts. Permanent, not a transition shim: seed_from_prior copies raw JSON
    forward on resume, so pre-slice-8 blobs can arrive indefinitely."""
    for key in ("mastered_concepts", "confirmed_gaps"):
        items = data.get(key)
        if isinstance(items, list):
            data[key] = [
                {"name": it, "evidence_type": None, "last_event_at": None}
                if isinstance(it, str)
                else it
                for it in items
            ]
    return data
```

Add `ConceptEntry` to the `from contracts import (...)` block.

Replace the body of `_parse_profile` (keep the docstring, extend it with one line about the element upgrade):

```python
    raw = raw or "{}"
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("unparseable topic_profile_json; using empty profile")
        return TopicProfile()
    if not isinstance(data, dict):
        return TopicProfile()
    data = _upgrade_concept_lists(data)
    try:
        return TopicProfile.model_validate(data)
    except ValidationError:
        pass
    known = {k: v for k, v in data.items() if k in TopicProfile.model_fields}
    dropped = sorted(set(data) - set(known))
    try:
        profile = TopicProfile.model_validate(known)
    except ValidationError:
        log.warning("topic_profile failed strict reparse; using empty profile")
        return TopicProfile()
    if dropped:
        log.warning("dropped legacy topic_profile fields on load: %s", dropped)
    return profile
```

(The `model_validate_json` fast path is gone on purpose: every raw blob must pass through `_upgrade_concept_lists` first.)

Run the Step 5 tests: Expected PASS.

- [ ] **Step 7: Make profile_service mutators entry-aware**

Delete `_norm_list` uses for concept lists and update these four functions:

`_null_focus_if_removed` — unchanged (focus is still a plain string).

`_add_exclusive` becomes:

```python
def _add_exclusive(
    profile: TopicProfile,
    target: str,
    item: str,
    *,
    evidence_type: str | None = None,
    stamp: datetime | None = None,
) -> None:
    other = "confirmed_gaps" if target == "mastered_concepts" else "mastered_concepts"
    setattr(
        profile,
        target,
        upsert_entry(
            getattr(profile, target) or [], item,
            evidence_type=evidence_type, stamp=stamp,
        ),
    )
    key = canon(item)
    setattr(
        profile, other,
        [e for e in (getattr(profile, other) or []) if canon(e.name) != key],
    )
    if other == "confirmed_gaps":
        _null_focus_if_removed(profile, item)
```

`apply_user_patch` — the two `_add_exclusive` calls gain a stamp but no evidence (user edits are unattributed provenance by design):

```python
    if add_mastered is not None:
        _add_exclusive(
            profile, "mastered_concepts", add_mastered,
            stamp=datetime.now(timezone.utc),
        )
    if add_gap is not None:
        _add_exclusive(
            profile, "confirmed_gaps", add_gap,
            stamp=datetime.now(timezone.utc),
        )
```

`remove_profile_item` — casefolded name match:

```python
    profile = load_profile(db, session_id)
    current = list(getattr(profile, list_name) or [])
    if find_entry(current, item) is None:
        raise KeyError(item)
    key = canon(item)
    setattr(profile, list_name, [e for e in current if canon(e.name) != key])
    if list_name == "confirmed_gaps":
        _null_focus_if_removed(profile, item)
    save_profile(db, session_id, profile)
    return profile
```

`apply_patch` — replace the gap/mastered blocks (keep the session-mismatch guard, knowledge_level, and focus blocks as-is; note `confirmed`/`mastered` locals and the final two reassignment lines are gone):

```python
    if args.add_confirmed_gap:
        evidence = (
            args.evidence_type
            if args.evidence_type in ("declared", "tested")
            else None
        )
        profile.confirmed_gaps = upsert_entry(
            profile.confirmed_gaps or [], args.add_confirmed_gap,
            evidence_type=evidence, stamp=datetime.now(timezone.utc),
        )

    if args.add_mastered_concept:
        if args.evidence_type is None:
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "evidence_type must be 'declared' or 'tested' when "
                    "add_mastered_concept is set"
                ),
            )
        if args.evidence_type in ("declared", "tested"):
            profile.mastered_concepts = upsert_entry(
                profile.mastered_concepts or [], args.add_mastered_concept,
                evidence_type=args.evidence_type,
                stamp=datetime.now(timezone.utc),
            )
```

(Behavior preserved: `inferred` mastery is still a silent no-op for the list; duplicates upsert instead of append, which also upgrades declared → tested on a repeat patch.)

Write the failing tests first, in `backend/tests/test_profile_service.py`:

```python
def test_apply_patch_stamps_provenance(session_row, db_session):
    from agent.types import ToolContext
    from contracts import UpdateTopicProfileArgs
    from services import profile_service

    ctx = ToolContext(db=db_session, session_id=session_row.id)
    res = profile_service.apply_patch(
        db_session, ctx,
        UpdateTopicProfileArgs(
            session_id=session_row.id,
            add_mastered_concept="limits",
            evidence_type="declared",
        ),
    )
    assert res.ok
    p = profile_service.load_profile(db_session, session_row.id)
    entry = p.mastered_concepts[0]
    assert entry.name == "limits"
    assert entry.evidence_type == "declared"
    assert entry.last_event_at is not None

    # repeat with tested evidence upgrades in place, no duplicate
    profile_service.apply_patch(
        db_session, ctx,
        UpdateTopicProfileArgs(
            session_id=session_row.id,
            add_mastered_concept="LIMITS",
            evidence_type="tested",
        ),
    )
    p = profile_service.load_profile(db_session, session_row.id)
    assert len(p.mastered_concepts) == 1
    assert p.mastered_concepts[0].evidence_type == "tested"


def test_user_patch_and_delete_are_entry_aware(session_row, db_session):
    from services import profile_service

    profile_service.apply_user_patch(db_session, session_row.id, add_gap="chain rule")
    p = profile_service.load_profile(db_session, session_row.id)
    assert p.confirmed_gaps[0].name == "chain rule"
    assert p.confirmed_gaps[0].evidence_type is None
    assert p.confirmed_gaps[0].last_event_at is not None

    p = profile_service.remove_profile_item(
        db_session, session_row.id, "confirmed_gaps", "Chain Rule"
    )
    assert p.confirmed_gaps == []
```

(If `test_profile_service.py` has no `session_row`/`db_session` fixtures of its own, they come from `backend/tests/conftest.py` — same fixtures `test_learning_event_service.py` uses.)

- [ ] **Step 8: Make `record_from_answer` stamp provenance**

In `backend/services/learning_event_service.py`, add `from datetime import datetime, timezone` and replace the `if apply_profile_effects:` block:

```python
    if apply_profile_effects:
        profile = profile_service.load_profile(db, session_id)
        stamp = datetime.now(timezone.utc)
        if correct:
            profile.mastered_concepts = profile_service.upsert_entry(
                profile.mastered_concepts or [], gap,
                evidence_type="tested", stamp=stamp,
            )
            gap_entry = profile_service.find_entry(profile.confirmed_gaps or [], gap)
            if gap_entry is not None:
                gap_entry.evidence_type = "tested"
                gap_entry.last_event_at = stamp
        else:
            key = profile_service.canon(gap)
            profile.mastered_concepts = [
                e for e in (profile.mastered_concepts or []) if profile_service.canon(e.name) != key
            ]
            profile.confirmed_gaps = profile_service.upsert_entry(
                profile.confirmed_gaps or [], gap,
                evidence_type="tested", stamp=stamp,
            )
        profile_service.save_profile(db, session_id, profile, commit=False)
```

(Membership semantics preserved exactly: correct still does NOT remove the gap from confirmed_gaps — REVIEW-GAPS retention logic depends on that. What changed: entries instead of strings, always-save because the stamp always updates.)

Failing test first, in `backend/tests/test_learning_event_service.py`:

```python
def test_record_from_answer_stamps_tested_evidence(session_row, db_session):
    from services import learning_event_service, profile_service

    learning_event_service.record_from_answer(
        db_session, session_row.id, gap="limits", question="q?", correct=True
    )
    p = profile_service.load_profile(db_session, session_row.id)
    m = profile_service.find_entry(p.mastered_concepts, "limits")
    assert m.evidence_type == "tested" and m.last_event_at is not None

    learning_event_service.record_from_answer(
        db_session, session_row.id, gap="limits", question="q?", correct=False
    )
    p = profile_service.load_profile(db_session, session_row.id)
    assert profile_service.find_entry(p.mastered_concepts, "limits") is None
    g = profile_service.find_entry(p.confirmed_gaps, "limits")
    assert g.evidence_type == "tested"
```

- [ ] **Step 9: Fix remaining backend consumers**

9a. `backend/routes/chat.py:84-91` — the review-gaps pool works on names:

```python
    if review_gaps:
        gaps = profile_service.concept_names(profile.confirmed_gaps)
        mastered = [
            c
            for c in profile_service.concept_names(profile.mastered_concepts)
            if c not in gaps
        ]
        pool = gaps + mastered
```

(`profile_service` is already imported in chat.py; the rest of the block — `review_gap in pool` etc. — keeps working on strings.)

9b. `backend/agent/prompts.py` — two changes:

`_profile_to_dict` must dump JSON-safe (datetimes become ISO strings; `json.dumps` at line 217 would otherwise raise `TypeError`):

```python
def _profile_to_dict(profile) -> dict:
    if isinstance(profile, TopicProfile):
        return profile.model_dump(mode="json")
    return profile or {}
```

`_gap_accuracy_label` — confirmed gaps are now dicts; `gap_accuracy` is keyed by `gap_tested` name strings:

```python
def _gap_accuracy_label(profile_dict: dict, gap_accuracy: dict) -> str:
    confirmed = [
        c.get("name") if isinstance(c, dict) else c
        for c in (profile_dict.get("confirmed_gaps") or [])
    ]
    scoped = {g: gap_accuracy[g] for g in confirmed if g in (gap_accuracy or {})}
```

(rest of the function unchanged.)

9c. `backend/services/profile_service.py::aggregate_for_user` — key the count dicts by name:

```python
        for concept in profile.mastered_concepts or []:
            entry = mastered_counts.setdefault(
                concept.name, {"count": 0, "first_seen_session_id": s.id}
            )
            entry["count"] += 1

        for gap in profile.confirmed_gaps or []:
            entry = gap_counts.setdefault(
                gap.name, {"count": 0, "first_seen_session_id": s.id}
            )
            entry["count"] += 1
```

9d. `backend/services/session_enrichment.py:105` — `len(prof.get("mastered_concepts") or [])` counts list elements and is shape-agnostic; verify by reading, no change expected.

9e. Repair existing tests that assert string lists. Run `pytest -q` and fix every failure; expect them concentrated in: `tests/test_profile_service.py`, `tests/test_learning_event_service.py`, `tests/test_profile_route.py`, `tests/test_profile_aggregate.py`, `tests/test_chat.py`, `tests/test_prompts.py`, `tests/test_check_question_service.py`, `tests/test_check_answer_route.py`, `tests/test_sessions_route.py`, `tests/test_token_budget.py`, `tests/test_chat_prepare_perf.py`, `tests/test_sessions_perf.py`, `tests/test_session_enrichment.py`. Repair rules:
  - A test seeding `topic_profile_json` with string lists STAYS as strings when it exercises legacy-blob reads (that is now the upgrade path working); switch the ASSERTION side to `concept_names(...)` / `entry.name`.
  - A test asserting `profile.mastered_concepts == ["x"]` becomes `concept_names(profile.mastered_concepts) == ["x"]`.
  - A test building `TopicProfile(mastered_concepts=["x"])` directly must build `[{"name": "x"}]` (pydantic coerces dicts) — direct model construction bypasses `_parse_profile` and gets no string upgrade.
  - Do NOT weaken any assertion counts or drop tests; if a repair is unclear, stop and surface it.

Also sweep `backend/scripts/eval_focus_clearing.py` and `backend/scripts/eval_missed_concept_reference.py` for string-list reads of the two concept lists (native Grep for `mastered_concepts|confirmed_gaps`); adapt via `concept_names(...)` — these are manual scripts, keep changes minimal.

- [ ] **Step 10: Full backend suite green**

Run from `backend/`: `pytest -q`
Expected: all pass (previous baseline: 611 passed, 5 skipped). Stop and investigate any failure; do not skip.

- [ ] **Step 11: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py backend/services/profile_service.py backend/services/learning_event_service.py backend/routes/chat.py backend/agent/prompts.py backend/tests/ backend/scripts/
git commit -m "feat: ConceptEntry provenance + subtopic_levels schema flip (R4.2 AC1, R4.1 schema)"
```

---

### Task 2: R2 scheduler evidence weighting

**Files:**
- Modify: `backend/services/review_queue_service.py`
- Modify: `backend/routes/review.py`
- Test: `backend/tests/test_review_queue_service.py`, `backend/tests/test_review_route.py` (use the actual existing test filenames — Grep for `compute_schedule` under `backend/tests/` if they differ)

**Interfaces:**
- Consumes: `profile_service.load_profile`, `ConceptEntry.evidence_type`, `profile_service.canon` (Task 1).
- Produces: `compute_schedule(events, now, evidence_map: dict[str, str | None] | None = None)` — third optional kwarg; sort key `(evidence_rank, due_at)` with `tested` -> 1, anything else -> 0.

- [ ] **Step 1: Write the failing scheduler test**

Append to the test module that covers `compute_schedule`:

```python
def test_due_sort_puts_weak_evidence_first():
    from datetime import datetime, timedelta, timezone

    from services.review_queue_service import EventRow, compute_schedule

    now = datetime(2026, 7, 12, tzinfo=timezone.utc)
    old = now - timedelta(days=30)
    older = now - timedelta(days=31)
    events = [
        # "alpha" due earlier (more overdue) but tested evidence
        EventRow(concept="alpha", correct=True, created_at=older, session_id="s1", topic="t"),
        # "beta" due later but declared-only evidence
        EventRow(concept="beta", correct=True, created_at=old, session_id="s1", topic="t"),
    ]
    emap = {"alpha": "tested", "beta": "declared"}
    due = compute_schedule(events, now=now, evidence_map=emap)
    assert [e.concept for e in due] == ["beta", "alpha"]

    # without a map, ordering falls back to due_at (alpha more overdue)
    due_plain = compute_schedule(events, now=now)
    assert [e.concept for e in due_plain] == ["alpha", "beta"]
```

Run: `pytest -q -k "weak_evidence_first"` — Expected: FAIL (`unexpected keyword argument 'evidence_map'`).

- [ ] **Step 2: Implement in `review_queue_service.py`**

Change the signature and final sort of `compute_schedule`:

```python
def compute_schedule(
    events: Sequence[EventRow],
    now: datetime,
    evidence_map: dict[str, str | None] | None = None,
) -> list[ScheduleEntry]:
    """Return concepts due for review at `now`. Sorted weakest-evidence first
    (non-"tested" before "tested" per evidence_map, keys casefolded concept
    names), then most overdue first. No map -> pure due_at order."""
```

and replace `due.sort(key=lambda e: e.due_at)` with:

```python
    emap = evidence_map or {}

    def _rank(entry: ScheduleEntry) -> int:
        return 1 if emap.get(entry.concept.strip().casefold()) == "tested" else 0

    due.sort(key=lambda e: (_rank(e), e.due_at))
```

Update the module docstring's ordering sentence accordingly.

- [ ] **Step 3: Wire the route join in `backend/routes/review.py`**

Add import `from services import profile_service`, then between building `events` and calling `compute_schedule`:

```python
    evidence_map: dict[str, str | None] = {}
    for sid in {e.session_id for e in events}:
        prof = profile_service.load_profile(db, sid)
        for entry in (prof.mastered_concepts or []) + (prof.confirmed_gaps or []):
            key = profile_service.canon(entry.name)
            # tested wins across sessions; otherwise last writer is fine
            if evidence_map.get(key) != "tested":
                evidence_map[key] = entry.evidence_type
    due = compute_schedule(events, now=now, evidence_map=evidence_map)
```

Route-level failing test first (same file as existing review-route tests): seed two sessions/concepts where the profile marks one `tested` and one `declared`, both due; assert queue order puts declared first.

```python
def test_review_queue_orders_declared_before_tested(client, db_session, session_row):
    # Arrange two due concepts via learning events older than their interval,
    # then stamp evidence on the session profile.
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.mastered_concepts = [
        {"name": "alpha", "evidence_type": "tested"},
        {"name": "beta", "evidence_type": "declared"},
    ]
    profile_service.save_profile(db_session, session_row.id, p)

    from datetime import datetime, timedelta, timezone
    from db.models import LearningEvent

    old = datetime.now(timezone.utc) - timedelta(days=30)
    for concept in ("alpha", "beta"):
        db_session.add(
            LearningEvent(
                session_id=session_row.id,
                gap_tested=concept,
                question="q?",
                correct=True,
                created_at=old,
            )
        )
    db_session.commit()

    res = client.get("/api/review/queue")
    concepts = [i["concept"] for i in res.json()["items"]]
    assert concepts.index("beta") < concepts.index("alpha")
```

(Adapt fixture names/seeding helpers to what the existing review-route test file actually uses — do not invent new fixtures if that file already has due-event seeding helpers.)

- [ ] **Step 4: Run the new tests, then the full suite**

Run: `pytest -q` — Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/review_queue_service.py backend/routes/review.py backend/tests/
git commit -m "feat: review queue weights declared evidence ahead of tested (R4.2 AC2)"
```

---

### Task 3: Agent tool subtopic patches

**Files:**
- Modify: `backend/services/profile_service.py` (`apply_patch`)
- Modify: `backend/agent/tools.py:35-42` (tool description)
- Test: `backend/tests/test_profile_service.py`

**Interfaces:**
- Consumes: `UpdateTopicProfileArgs.subtopic` / `.subtopic_level` (Task 1), `MAX_SUBTOPICS`, `canon`.
- Produces: `apply_patch` handles subtopic pair — Task 5's prompt rules and Task 7's eval rely on this behavior.

- [ ] **Step 1: Failing tests**

```python
def _ctx_args(db_session, session_row, **kw):
    from agent.types import ToolContext
    from contracts import UpdateTopicProfileArgs

    ctx = ToolContext(db=db_session, session_id=session_row.id)
    return ctx, UpdateTopicProfileArgs(session_id=session_row.id, **kw)


def test_apply_patch_sets_subtopic_level(session_row, db_session):
    from services import profile_service

    ctx, args = _ctx_args(
        db_session, session_row, subtopic="  Integration BY Parts ", subtopic_level="beginner"
    )
    res = profile_service.apply_patch(db_session, ctx, args)
    assert res.ok
    p = profile_service.load_profile(db_session, session_row.id)
    assert p.subtopic_levels == {"integration by parts": "beginner"}


def test_apply_patch_subtopic_requires_pair(session_row, db_session):
    from services import profile_service

    ctx, args = _ctx_args(db_session, session_row, subtopic="chain rule")
    res = profile_service.apply_patch(db_session, ctx, args)
    assert not res.ok
    assert "together" in res.error


def test_apply_patch_subtopic_cap(session_row, db_session):
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.subtopic_levels = {f"topic {i}": "beginner" for i in range(20)}
    profile_service.save_profile(db_session, session_row.id, p)

    ctx, args = _ctx_args(db_session, session_row, subtopic="one more", subtopic_level="advanced")
    res = profile_service.apply_patch(db_session, ctx, args)
    assert not res.ok and "full" in res.error

    # updating an existing key is always allowed
    ctx, args = _ctx_args(db_session, session_row, subtopic="topic 3", subtopic_level="advanced")
    assert profile_service.apply_patch(db_session, ctx, args).ok
```

Run: `pytest tests/test_profile_service.py -v -k subtopic` — Expected: FAIL (subtopic silently ignored today; first test asserts `{}` != populated).

- [ ] **Step 2: Implement in `apply_patch`**

Insert right after the `profile = load_profile(db, ctx.session_id)` line (the guard needs the loaded profile):

```python
    if (args.subtopic is None) != (args.subtopic_level is None):
        return ToolResult(
            ok=False,
            status="failed",
            error="subtopic and subtopic_level must be provided together",
        )
    if args.subtopic is not None:
        key = canon(args.subtopic)
        if not key:
            return ToolResult(ok=False, status="failed", error="subtopic is empty")
        levels = dict(profile.subtopic_levels or {})
        if key not in levels and len(levels) >= MAX_SUBTOPICS:
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    f"subtopic_levels is full ({MAX_SUBTOPICS}); update an "
                    "existing subtopic instead"
                ),
            )
        levels[key] = args.subtopic_level
        profile.subtopic_levels = levels
```

- [ ] **Step 3: Extend the tool description in `backend/agent/tools.py`**

Append to the `update_topic_profile` description string:

```python
                " Provide subtopic and subtopic_level together to record the"
                " learner's level on a specific subtopic (agent-named, short"
                " noun phrase; reuse existing names)."
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_profile_service.py -v -k subtopic` then `pytest -q` — Expected: PASS / all green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/agent/tools.py backend/tests/test_profile_service.py
git commit -m "feat: subtopic-scoped level patches via update_topic_profile (R4.1 AC2)"
```

---

### Task 4: User subtopic edit + delete routes

**Files:**
- Modify: `backend/services/profile_service.py` (`apply_user_patch`, new `remove_subtopic`)
- Modify: `backend/routes/profile.py`
- Test: `backend/tests/test_profile_route.py`

**Interfaces:**
- Consumes: `ProfilePatchRequest.subtopic` / `.subtopic_level` (Task 1), `canon`.
- Produces: `PATCH /api/profile/{id}` accepts the pair (update-only; unknown subtopic -> 422); `DELETE /api/profile/{id}/subtopic_levels/{item}` (404 unknown, ETag-guarded). Task 6's frontend calls both.

- [ ] **Step 1: Failing route tests**

Append to `backend/tests/test_profile_route.py`, following that file's existing client/ETag helper conventions (fetch etag from GET, send If-Match):

```python
def test_patch_subtopic_level_updates_existing(client, db_session, session_row):
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.subtopic_levels = {"chain rule": "beginner"}
    profile_service.save_profile(db_session, session_row.id, p)

    etag = client.get(f"/api/profile/{session_row.id}").json()["etag"]
    res = client.patch(
        f"/api/profile/{session_row.id}",
        json={"subtopic": "Chain Rule", "subtopic_level": "advanced"},
        headers={"If-Match": etag},
    )
    assert res.status_code == 200
    assert res.json()["profile"]["subtopic_levels"] == {"chain rule": "advanced"}


def test_patch_unknown_subtopic_422(client, db_session, session_row):
    etag = client.get(f"/api/profile/{session_row.id}").json()["etag"]
    res = client.patch(
        f"/api/profile/{session_row.id}",
        json={"subtopic": "never seen", "subtopic_level": "beginner"},
        headers={"If-Match": etag},
    )
    assert res.status_code == 422


def test_patch_subtopic_without_level_422(client, db_session, session_row):
    etag = client.get(f"/api/profile/{session_row.id}").json()["etag"]
    res = client.patch(
        f"/api/profile/{session_row.id}",
        json={"subtopic": "chain rule"},
        headers={"If-Match": etag},
    )
    assert res.status_code == 422


def test_delete_subtopic_level(client, db_session, session_row):
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.subtopic_levels = {"chain rule": "beginner"}
    profile_service.save_profile(db_session, session_row.id, p)

    etag = client.get(f"/api/profile/{session_row.id}").json()["etag"]
    res = client.delete(
        f"/api/profile/{session_row.id}/subtopic_levels/chain%20rule",
        headers={"If-Match": etag},
    )
    assert res.status_code == 200
    assert res.json()["profile"]["subtopic_levels"] == {}

    res2 = client.delete(
        f"/api/profile/{session_row.id}/subtopic_levels/nope",
        headers={"If-Match": res.json()["etag"]},
    )
    assert res2.status_code == 404
```

Also the ETag-conflict path (spec section 8):

```python
def test_patch_subtopic_stale_etag_412(client, db_session, session_row):
    from services import profile_service

    p = profile_service.load_profile(db_session, session_row.id)
    p.subtopic_levels = {"chain rule": "beginner"}
    profile_service.save_profile(db_session, session_row.id, p)

    res = client.patch(
        f"/api/profile/{session_row.id}",
        json={"subtopic": "chain rule", "subtopic_level": "advanced"},
        headers={"If-Match": "stale-etag"},
    )
    assert res.status_code == 412
```

Run: `pytest tests/test_profile_route.py -v -k subtopic` — Expected: FAIL.

- [ ] **Step 2: Service implementation**

`apply_user_patch` — extend the signature with `subtopic: str | None = None, subtopic_level: str | None = None`, and add before `save_profile`:

```python
    if (subtopic is None) != (subtopic_level is None):
        raise ValueError("subtopic and subtopic_level must be provided together")
    if subtopic is not None:
        key = canon(subtopic)
        if not key:
            raise ValueError("item cannot be empty after stripping whitespace")
        levels = dict(profile.subtopic_levels or {})
        if key not in levels:
            raise ValueError("unknown subtopic; subtopics are created by the tutor")
        levels[key] = subtopic_level
        profile.subtopic_levels = levels
```

New function:

```python
def remove_subtopic(db: Session, session_id: str, subtopic: str) -> TopicProfile:
    profile = load_profile(db, session_id)
    levels = dict(profile.subtopic_levels or {})
    key = canon(subtopic)
    if key not in levels:
        raise KeyError(subtopic)
    del levels[key]
    profile.subtopic_levels = levels
    save_profile(db, session_id, profile)
    return profile
```

- [ ] **Step 3: Route wiring in `backend/routes/profile.py`**

In `patch_profile`: extend the empty-patch guard and pass-through:

```python
    if (
        body.add_mastered is None
        and body.add_gap is None
        and body.knowledge_level is None
        and body.subtopic is None
        and body.subtopic_level is None
    ):
        raise HTTPException(status_code=422, detail="empty patch")
```

and add `subtopic=body.subtopic, subtopic_level=body.subtopic_level` to the `apply_user_patch` call.

New route (mirrors the two existing DELETEs; `remove_subtopic` is not list-shaped so it gets its own handler):

```python
@router.delete(
    "/profile/{session_id}/subtopic_levels/{item}",
    response_model=ProfileMutationResponse,
)
def delete_subtopic_level(
    session_id: str,
    item: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    _owned_session_or_404(db, session_id, user_id)
    _guard_if_match(db, session_id, if_match)
    try:
        profile = profile_service.remove_subtopic(db, session_id, item)
    except KeyError:
        raise HTTPException(status_code=404, detail="item not found")
    return ProfileMutationResponse(
        profile=profile, etag=profile_service.profile_etag(profile)
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_profile_route.py -v` then `pytest -q` — Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/routes/profile.py backend/tests/test_profile_route.py
git commit -m "feat: user subtopic level edit + delete routes, ETag-guarded (R4.1 AC4 backend)"
```

---

### Task 5: Prompt rules for subtopics and provenance

**Files:**
- Modify: `backend/agent/prompts.py` (`IMMUTABLE_RULES`)
- Test: `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: profile dump already carries `subtopic_levels` + entry provenance via `_profile_to_dict(mode="json")` (Task 1).
- Produces: prompt text Task 7's eval scenarios exercise.

- [ ] **Step 1: Failing test**

```python
def test_immutable_rules_document_subtopics_and_provenance():
    from agent.prompts import IMMUTABLE_RULES

    assert "SUBTOPIC LEVELS:" in IMMUTABLE_RULES
    assert "subtopic_level" in IMMUTABLE_RULES
    assert "last_event_at" in IMMUTABLE_RULES
```

Run: `pytest tests/test_prompts.py -v -k subtopics_and_provenance` — Expected: FAIL.

- [ ] **Step 2: Add two blocks to `IMMUTABLE_RULES`**

Insert a `SUBTOPIC LEVELS:` section after the `EVIDENCE TYPING:` block, and one provenance line inside `PROFILE RULES`:

Addition to `PROFILE RULES (v1 simplified):` (after the mastered_concepts bullet):

```
- Profile entries in confirmed_gaps and mastered_concepts include
  evidence_type ("declared" or "tested") and last_event_at. Treat "tested"
  entries as stronger evidence than "declared" ones when judging what the
  learner really knows.
```

New section:

```
SUBTOPIC LEVELS:
- subtopic_levels maps a subtopic name to the learner's level for that part of
  the topic. knowledge_level is the session-wide default; a subtopic entry
  overrides it for that subtopic.
- When the learner declares or demonstrates their level on a specific subtopic
  (same declared/tested evidence standard as mastery), call
  update_topic_profile with subtopic and subtopic_level TOGETHER.
- Subtopic names: short noun phrases ("integration by parts", not sentences).
  Reuse an existing subtopic name when one matches; do not create
  near-duplicates.
- At most one subtopic_level update per turn.
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_prompts.py -v` then `pytest -q` — Expected: all green. (`IMMUTABLE_RULES` is cache-anchored per session, not per deploy — changing it is safe; it just invalidates provider prompt cache once.)

- [ ] **Step 4: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat: prompt rules for subtopic levels + concept provenance (R4.1 AC2)"
```

---

### Task 6: Frontend — entry-shaped chips, evidence badges, gap-picker names

**Files:**
- Modify: `frontend/src/views/ProfileView.vue`
- Modify: `frontend/src/views/SessionView.vue:191-198`
- Test: `frontend/src/__tests__/sessionProfileView.test.js`, `frontend/src/__tests__/sessionView.test.js`

**Interfaces:**
- Consumes: GET profile now returns ConceptEntry lists (Task 1). DELETE routes still take the name string in the path.
- Produces: chips render `entry.name` + badge; `gapNames` computed drives the picker. This task touches only the two concept lists; the subtopic section UI is Task 7.

- [ ] **Step 1: Update test fixtures to entry shape and add badge assertions (failing first)**

In `frontend/src/__tests__/sessionProfileView.test.js`, change mocked profile fixtures from `mastered_concepts: ['x']` to:

```js
mastered_concepts: [
  { name: 'x', evidence_type: 'tested', last_event_at: '2026-07-01T00:00:00Z' },
],
confirmed_gaps: [
  { name: 'y', evidence_type: null, last_event_at: null },
  { name: 'z', evidence_type: 'declared', last_event_at: null },
],
subtopic_levels: {},
```

and add:

```js
it('renders concept names with evidence badges', async () => {
  // mount with the fixture above
  const chips = wrapper.findAll('[data-testid="sprof-mastered"] .chip')
  expect(chips[0].text()).toContain('x')
  expect(chips[0].find('[data-testid="evidence-badge"]').text()).toBe('tested')
  const gapChips = wrapper.findAll('[data-testid="sprof-gaps"] .chip')
  expect(gapChips[0].find('[data-testid="evidence-badge"]').exists()).toBe(false)
  expect(gapChips[1].find('[data-testid="evidence-badge"]').text()).toBe('declared')
})
```

(Adapt mount/mock boilerplate to the file's existing pattern.) Run from `frontend/`: `npm run test:unit -- --run src/__tests__/sessionProfileView.test.js` — Expected: FAIL (chips render `[object Object]`).

- [ ] **Step 2: Update `ProfileView.vue`**

Mastered chip loop becomes (gaps chip loop mirrors it with `g`):

```html
<li
  v-for="c in data.profile.mastered_concepts"
  :key="`m-${c.name}`"
  class="chip chip-mastered"
>
  {{ c.name }}
  <span v-if="c.evidence_type" class="chip-badge" data-testid="evidence-badge">
    {{ c.evidence_type }}
  </span>
  <button
    type="button"
    class="chip-x"
    data-testid="chip-remove"
    :aria-label="`Remove ${c.name}`"
    @click="removeItem('mastered_concepts', c.name)"
  >
    <i class="pi pi-times" aria-hidden="true" />
  </button>
</li>
```

Add computed + rewire the picker and `startReview`:

```js
const gapNames = computed(
  () => (data.value?.profile?.confirmed_gaps ?? []).map((g) => g.name),
)
```

```html
<GapPickerDialog
  v-model:visible="gapPickerOpen"
  :gaps="gapNames"
  @select="goReview"
/>
```

```js
function startReview() {
  if (gapNames.value.length > 1) gapPickerOpen.value = true
  else if (gapNames.value.length === 1) goReview(gapNames.value[0])
}
```

Badge CSS (scoped styles, near `.chip-x`):

```css
.chip-badge {
  margin-left: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}
```

- [ ] **Step 3: Update `SessionView.vue:196-198`**

```js
const confirmedGaps = computed(
  () =>
    (store.currentSession?.topic_profile?.confirmed_gaps ?? []).map(
      (g) => g?.name ?? g,
    ),
)
```

(`g?.name ?? g` tolerates a stale store shape during hot swaps; `hasGaps` at line 191 counts and needs no change.) Update `sessionView.test.js` fixtures feeding `topic_profile.confirmed_gaps` to entry objects and keep assertions on names.

- [ ] **Step 4: Run frontend suite + lint**

From `frontend/`: `npm run test:unit -- --run` and `npm run lint`
Expected: all green (baseline 594 tests). Fix any other test file whose profile fixtures used string lists (Grep `confirmed_gaps` under `frontend/src/__tests__/`). Note the known gotcha: if oxlint auto-edits `apiClient.js`, revert that hunk.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ProfileView.vue frontend/src/views/SessionView.vue frontend/src/__tests__/
git commit -m "feat: entry-shaped concept chips with evidence badges (R4.2 frontend)"
```

---

### Task 7: Frontend — subtopic levels section (render, edit level, delete)

**Files:**
- Modify: `frontend/src/views/ProfileView.vue`
- Test: `frontend/src/__tests__/sessionProfileView.test.js`

**Interfaces:**
- Consumes: `PATCH {subtopic, subtopic_level}` + `DELETE /profile/{id}/subtopic_levels/{item}` (Task 4). `deleteProfileItem(sessionId, listName, item, etag)` from `profileApi.js` already builds `/profile/{id}/{listName}/{item}` — reuse with `'subtopic_levels'`; no api-client change needed.
- Produces: `data-testid="sprof-subtopics"` section; per-row level pills + remove.

- [ ] **Step 1: Failing tests**

```js
it('renders subtopic levels with editable pills and remove', async () => {
  // fixture: subtopic_levels: { 'chain rule': 'beginner' }
  const sec = wrapper.find('[data-testid="sprof-subtopics"]')
  expect(sec.exists()).toBe(true)
  expect(sec.text()).toContain('chain rule')
  const active = sec.find('.level-opt.active')
  expect(active.text()).toBe('beginner')
})

it('PATCHes subtopic level on pill click and DELETEs on remove', async () => {
  // click 'advanced' pill in the 'chain rule' row
  // assert patchProfile called with { subtopic: 'chain rule', subtopic_level: 'advanced' } and current etag
  // click the row remove button
  // assert deleteProfileItem called with (id, 'subtopic_levels', 'chain rule', etag)
})

it('hides the subtopics section when subtopic_levels is empty', async () => {
  expect(wrapper.find('[data-testid="sprof-subtopics"]').exists()).toBe(false)
})
```

(Fill mocking per the file's existing `vi.mock('../services/profileApi.js')` pattern.) Run — Expected: FAIL.

- [ ] **Step 2: Implement the section in `ProfileView.vue`**

Template, after the focus card block (line ~69):

```html
<div
  v-if="subtopicEntries.length"
  class="subtopics"
  data-testid="sprof-subtopics"
>
  <h2 class="section-title">
    <i class="pi pi-sliders-h col-icon" aria-hidden="true" />
    Subtopic levels
  </h2>
  <ul class="subtopic-list">
    <li v-for="[name, lvl] in subtopicEntries" :key="`st-${name}`" class="subtopic-row">
      <span class="st-name">{{ name }}</span>
      <div class="level-edit">
        <button
          v-for="l in LEVELS"
          :key="l"
          type="button"
          class="level-opt"
          :class="{ active: lvl === l }"
          @click="setSubtopicLevel(name, l)"
        >
          {{ l }}
        </button>
      </div>
      <button
        type="button"
        class="chip-x"
        data-testid="subtopic-remove"
        :aria-label="`Remove ${name}`"
        @click="removeSubtopic(name)"
      >
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </li>
  </ul>
</div>
```

Script additions:

```js
const LEVELS = ['beginner', 'intermediate', 'advanced']

const subtopicEntries = computed(() =>
  Object.entries(data.value?.profile?.subtopic_levels ?? {}),
)

function setSubtopicLevel(name, level) {
  return _applyWrite(() =>
    patchProfile(props.id, { subtopic: name, subtopic_level: level }, etag.value),
  )
}

function removeSubtopic(name) {
  return _applyWrite(() =>
    deleteProfileItem(props.id, 'subtopic_levels', name, etag.value),
  )
}
```

Also swap the header level-edit's hardcoded array to `LEVELS` (line 30) — one source.

Scoped CSS:

```css
.subtopic-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.subtopic-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.st-name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 3: Run frontend suite + lint**

From `frontend/`: `npm run test:unit -- --run` and `npm run lint` — Expected: green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ProfileView.vue frontend/src/__tests__/sessionProfileView.test.js
git commit -m "feat: subtopic level section in ProfileView, edit + delete (R4.1 AC4)"
```

---

### Task 8: Subtopic reliability eval script (manual, paid gate)

**Files:**
- Create: `backend/scripts/eval_subtopic_levels.py`
- Create: `backend/scripts/subtopic_patterns/declared_level.json`, `backend/scripts/subtopic_patterns/tested_progression.json`

**Interfaces:**
- Consumes: the tutor entry point and run-harness pattern from `backend/scripts/reliability_focus_clear.py` / `eval_focus_clearing.py` (READ ONE OF THESE FIRST and mirror its session-setup, turn-feeding, and profile-reload wiring exactly).
- Produces: exit 0 when >= 85% of runs per pattern produce the expected `subtopic_levels` patch; exit 1 otherwise. This script is NOT run in CI — it is the paid human gate (R4.1 AC3).

- [ ] **Step 1: Write the fixtures**

`backend/scripts/subtopic_patterns/declared_level.json`:

```json
{
  "name": "declared_level",
  "topic": "calculus integration techniques",
  "turns": [
    "I want to work on integration. I'm totally new to integration by parts, never seen it.",
    "Can you show me the formula and a first example?"
  ],
  "expected": {
    "subtopic": "integration by parts",
    "levels": ["beginner"],
    "by_turn": 2
  }
}
```

`backend/scripts/subtopic_patterns/tested_progression.json`:

```json
{
  "name": "tested_progression",
  "topic": "calculus integration techniques",
  "turns": [
    "Quiz me on u-substitution, I think I'm decent at it.",
    "[simulate correct answers to the check batch]",
    "Great, what's next?"
  ],
  "expected": {
    "subtopic": "u-substitution",
    "levels": ["intermediate", "advanced"],
    "by_turn": 3
  }
}
```

- [ ] **Step 2: Write the script**

Structure (mirror the chosen existing harness for session creation, turn submission, and check-batch simulation; the assertion core is):

```python
"""Subtopic-level patch reliability eval (R4.1 AC3, extends WS-G3).

Manual, paid, live-LLM. Not run in CI.
Pass criterion per pattern: >= 0.85 of runs produce a subtopic_levels entry
whose key contains the expected subtopic (canonicalized substring match --
naming drift like 'u-sub' vs 'u-substitution' counts as a miss only if the
expected token is absent) at one of the expected levels by the stated turn.
Failing patterns exit 1.
"""

RUNS_PER_PATTERN = 10
THRESHOLD = 0.85


def _matches(profile, expected) -> bool:
    levels = profile.subtopic_levels or {}
    want = expected["subtopic"].strip().casefold()
    for key, lvl in levels.items():
        if want in key and lvl in expected["levels"]:
            return True
    return False
```

per-run loop: create session -> feed turns (reload profile after each) -> record `_matches` at/before `expected["by_turn"]` -> per-pattern pass rate printed -> exit 1 if any pattern < THRESHOLD.

- [ ] **Step 3: Verify it imports and dry-runs**

Run from `backend/`: `python -c "import scripts.eval_subtopic_levels"` (or the import style the sibling scripts use). Expected: no import errors. Do NOT execute a live run (paid) — that is the post-merge human gate.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/eval_subtopic_levels.py backend/scripts/subtopic_patterns/
git commit -m "feat: subtopic-level reliability eval harness (R4.1 AC3, paid gate)"
```

---

### Task 9: Slice gates — full verification pass

**Files:** none new; fixes only if gates fail.

- [ ] **Step 1: Backend gate** — from `backend/`: `pytest -q`. Expected: >= 611 passed + the new tests, 0 failed. Capture the counts.
- [ ] **Step 2: Frontend gate** — from `frontend/`: `npm run test:unit -- --run`. Expected: >= 594 passed + new tests, 0 failed.
- [ ] **Step 3: Lint gate** — from `frontend/`: `npm run lint`. Known gotcha: revert any oxlint auto-edit to `apiClient.js` before judging the result.
- [ ] **Step 4: Contract drift gate** — from repo root: `python backend/scripts/gen_contracts.py` then `git status --short backend/contracts/`. Expected: no diff (codegen idempotent).
- [ ] **Step 5: Consumer sweep verify** — native Grep for `mastered_concepts|confirmed_gaps` across `backend/` and `frontend/src/` (exclude tests): every hit must be entry-aware or count-only. Grep for `\.confirmed_gaps\[` and `in profile.confirmed_gaps` style string-membership leftovers.
- [ ] **Step 6: Commit any fixes** — `git commit -m "chore: slice 8 gate fixes"` (only if fixes were needed).

---

## Post-merge human gates (owed, do not attempt in this plan)

1. Paid live run of `backend/scripts/eval_subtopic_levels.py` — >= 85% per pattern.
2. Paid live smoke: one session exercising a subtopic patch, evidence badge rendering, and review-queue ordering with mixed evidence.
