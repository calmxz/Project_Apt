# Adversarial Review Batch 4 — Profile-Mutation Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 13 profile-mutation findings from `docs/adversarial-review-2026-07-12.md` (F-02, F-10, F-11, F-12, F-13, F-20, F-21, F-22, F-23, F-24, F-25, F-39, F-48) so every profile write path enforces the exclusivity invariant, the focus-clear guard is server-verified again, concurrent writes cannot silently lose updates, and the agent can neither fabricate evidence nor believe a failed/no-op patch succeeded.

**Architecture:** All changes are backend-only. Three clusters: (1) `profile_service.apply_patch` semantics — restored `tested_correct` guard (owner decision Q1), evidence downgrade, level-evidence gate, empty-patch/ignored-patch honesty; (2) write-path unification — every mastery/gap promotion routes through one public `add_exclusive` choke point (owner decision Q2), and every profile read-modify-write span takes a `SELECT ... FOR UPDATE` row lock via a new `lock_session_row` helper (chosen over a version column: no migration, no contract shape change, no-op on SQLite CI, serializes real Postgres); (3) tutor loop honesty — bundled patches dispatched instead of dropped, malformed tool-args JSON fails loudly instead of dispatching `{}`.

**Tech Stack:** FastAPI + SQLAlchemy 2.x (sync ORM), Pydantic contracts codegen'd from `docs/api/openapi.yaml`, pytest (SQLite in CI), LiteLLM.

## Global Constraints

- `backend/contracts/` is CODEGEN OUTPUT. Never hand-edit. Edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py` from repo root. A PostToolUse hook may auto-run codegen after YAML edits — verify it fired before committing. CI enforces zero drift.
- Run pytest from `backend/`, never repo root (`cd backend && pytest ...` reports collection correctly; repo root reports "no tests collected").
- After any import-touching change, run the FULL backend suite (circular-import breakage appears in unrelated modules).
- Use the native Grep tool for repo-wide sweeps (rtk rg has a false-zero gotcha).
- No emojis in code or comments.
- `services/pending_check_store.py` is a deliberate leaf module; import pending-check accessors from it directly, never re-export through `check_question_service`.
- Branch: `fix/adversarial-batch-4` (already created off `dev`). PR targets `dev`.
- Owner decisions that gate this batch (from `docs/adversarial-review-2026-07-12.md` §6, decided 2026-07-13):
  - **Q1 (F-02): RESTORE the focus-clear guard.** `apply_patch` must verify a correct `LearningEvent` with `canon(gap_tested) == canon(prior_focus)` in the session before accepting `focus_clear_reason="tested_correct"`. Session-scoped. Known limit: only polices the `tested_correct` label.
  - **Q2 (F-13): FULL PROMOTE.** Agent `apply_patch` mastery-add and server `record_from_answer` correct-branch route through the exclusivity helper (keep evidence_type/stamp semantics). SM-2 queue is event-sourced, so removing the gap does not hurt spaced repetition; a wrong retest demotes + re-adds the gap, so promotion is reversible.
- SQLite CI cannot exercise real row locking (`with_for_update` is a silent no-op there). Locking tasks prove behavior via spy tests + a Postgres-dialect SQL-compilation assertion; a live two-tab interleave check on Supabase Postgres is an owed post-merge human gate.
- Deliberate scope exclusions (do NOT implement; note for the final reviewer): agent `add_confirmed_gap` on a mastered concept still leaves dual membership — Q2's decision text names only the two mastery-add paths, and agent-declared demotion is a policy question the owner has not ruled on. F-38 (model-authored answer key) is a product-claim wording issue handled in Batch 6 docs work.

## File Structure

Modified (no new modules except tests):

- `backend/services/profile_service.py` — `add_exclusive` (public rename), `lock_session_row` (new), `_null_focus_if_removed` canon fix, `apply_patch` rewrite (guard, downgrade, level gate, empty/ignored patch), module docstring truth restore.
- `backend/services/learning_event_service.py` — `record_from_answer` both branches via `add_exclusive`.
- `backend/services/check_question_service.py` — `answer`/`skip` take the row lock.
- `backend/services/diagnostic_service.py` — all-skip no-op, None-only level write, lock.
- `backend/services/summary_service.py` — post-LLM profile re-read under lock, merge only `last_session_summary`.
- `backend/agent/tutor.py` — malformed-args synthesized failure, bundled-call preservation, `_summarize` ignored label.
- `backend/agent/prompts.py` — FOCUS PROTOCOL / EVIDENCE TYPING / PROFILE RULES notes.
- `backend/agent/tools.py` — `update_topic_profile` tool description (clear semantics).
- `backend/routes/profile.py` — lock before `_guard_if_match` (closes the check-then-act window).
- `backend/routes/sessions.py` — `grade_if_diagnostic` backstop call in `complete_check`.
- `docs/api/openapi.yaml` — `ToolResult.status` and `ToolCallRecord.status` enums gain `"ignored"`; `UpdateTopicProfileArgs` description updated → regen `backend/contracts/`.
- `docs/adversarial-review-2026-07-12.md` — FIXED markers (final task).

## Interfaces produced (cross-task contract)

- `profile_service.add_exclusive(profile: TopicProfile, target: str, item: str, *, evidence_type: str | None = None, stamp: datetime | None = None) -> None` — renamed from `_add_exclusive`, same behavior plus canon focus-null (Task 1). Used by Tasks 2, 4.
- `profile_service.lock_session_row(db: Session, session_id: str) -> SessionModel` — FOR UPDATE read, raises `ValueError` when missing (Task 8). Used by Tasks 9, 10.
- `ToolResult(ok=True, status="ignored", data={"notes": [...]})` — new status value (Task 5). Consumed by `tutor._summarize` (Task 5).

---

### Task 1: F-22 canon focus compare + public `add_exclusive`

**Files:**
- Modify: `backend/services/profile_service.py:165-193` (`_null_focus_if_removed`, `_add_exclusive`)
- Test: `backend/tests/test_profile_service.py`

**Interfaces:**
- Consumes: existing `canon`, `upsert_entry`, `find_entry`.
- Produces: `add_exclusive(profile, target, item, *, evidence_type=None, stamp=None)` — public name; `_null_focus_if_removed(profile, item)` now canon-compares. Tasks 2 and 4 call `add_exclusive` by this exact name.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_profile_service.py`:

```python
def test_null_focus_if_removed_matches_canonically():
    profile = TopicProfile(focus_target_gap="Chain Rule")
    profile_service._null_focus_if_removed(profile, "  chain rule ")
    assert profile.focus_target_gap is None


def test_null_focus_if_removed_leaves_unrelated_focus():
    profile = TopicProfile(focus_target_gap="Chain Rule")
    profile_service._null_focus_if_removed(profile, "product rule")
    assert profile.focus_target_gap == "Chain Rule"


def test_add_exclusive_is_public_and_clears_canon_focus():
    profile = TopicProfile(
        focus_target_gap="chain rule",
        confirmed_gaps=[ConceptEntry(name="Chain Rule")],
    )
    profile_service.add_exclusive(profile, "mastered_concepts", "CHAIN RULE")
    assert profile_service.concept_names(profile.confirmed_gaps) == []
    assert profile.focus_target_gap is None
    assert profile_service.concept_names(profile.mastered_concepts) == ["CHAIN RULE"]
```

(Import `ConceptEntry` from `contracts` at the top of the test file if not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `pytest tests/test_profile_service.py -k "null_focus or add_exclusive_is_public" -v`
Expected: FAIL — first test fails on exact-compare; third fails with `AttributeError: module ... has no attribute 'add_exclusive'`.

- [ ] **Step 3: Implement**

In `backend/services/profile_service.py` replace `_null_focus_if_removed` and rename `_add_exclusive`:

```python
def _null_focus_if_removed(profile: TopicProfile, item: str) -> None:
    # F-22: removal matches by canon(), so the dangling-focus check must too.
    if profile.focus_target_gap is not None and canon(profile.focus_target_gap) == canon(item):
        profile.focus_target_gap = None


def add_exclusive(
    profile: TopicProfile,
    target: str,
    item: str,
    *,
    evidence_type: str | None = None,
    stamp: datetime | None = None,
) -> None:
    """Single choke point for the exclusivity invariant (F-13, decision Q2):
    adding a concept to one list removes it from the other; removing it from
    confirmed_gaps also clears a (canon-equal) dangling focus."""
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

Then repo-wide native-Grep for `_add_exclusive` and update every reference (expected: `apply_user_patch` twice in this file, plus any tests) to `add_exclusive`.

- [ ] **Step 4: Run the full profile test file**

Run: `pytest tests/test_profile_service.py -v`
Expected: PASS (including pre-existing `_add_exclusive` tests you renamed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_profile_service.py
git commit -m "fix: canon-compare dangling focus, publicize add_exclusive (F-22)"
```

---

### Task 2: F-13 exclusivity on the two remaining write paths (decision Q2)

**Files:**
- Modify: `backend/services/profile_service.py` (`apply_patch` mastery-add block, ~line 325)
- Modify: `backend/services/learning_event_service.py:70-91` (`record_from_answer` profile effects)
- Test: `backend/tests/test_learning_event_service.py`, `backend/tests/test_profile_service.py`

**Interfaces:**
- Consumes: `profile_service.add_exclusive` (Task 1).
- Produces: behavior — a correct answer on a confirmed gap removes it from `confirmed_gaps` (and clears a canon-equal focus); agent mastery-add does the same.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_learning_event_service.py`:

```python
def test_correct_answer_promotes_out_of_confirmed_gaps(db_session, session_row):
    profile = TopicProfile(
        confirmed_gaps=[ConceptEntry(name="Chain Rule")],
        focus_target_gap="chain rule",
    )
    profile_service.save_profile(db_session, session_row.id, profile)

    record_from_answer(
        db_session, session_row.id,
        gap="Chain Rule", question="q?", correct=True,
    )

    after = profile_service.load_profile(db_session, session_row.id)
    assert profile_service.concept_names(after.confirmed_gaps) == []
    assert profile_service.concept_names(after.mastered_concepts) == ["Chain Rule"]
    entry = profile_service.find_entry(after.mastered_concepts, "Chain Rule")
    assert entry.evidence_type == "tested"
    assert entry.last_event_at is not None
    assert after.focus_target_gap is None
```

In `backend/tests/test_profile_service.py` (agent path):

```python
def test_apply_patch_mastery_add_removes_gap(db_session, tool_ctx):
    profile = TopicProfile(confirmed_gaps=[ConceptEntry(name="chain rule")])
    profile_service.save_profile(db_session, tool_ctx.session_id, profile)

    args = UpdateTopicProfileArgs(
        session_id=tool_ctx.session_id,
        add_mastered_concept="Chain Rule",
        evidence_type="declared",
    )
    result = profile_service.apply_patch(db_session, tool_ctx, args)

    assert result.ok
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    assert profile_service.concept_names(after.confirmed_gaps) == []
    assert profile_service.concept_names(after.mastered_concepts) == ["Chain Rule"]
```

(Reuse this file's existing fixtures for a session row and `ToolContext`; match the surrounding tests' fixture names — if the file builds contexts inline, do the same here.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_learning_event_service.py tests/test_profile_service.py -k "promotes_out or mastery_add_removes_gap" -v`
Expected: FAIL — gap remains in `confirmed_gaps` on both paths.

- [ ] **Step 3: Implement**

`backend/services/learning_event_service.py` — replace the `if apply_profile_effects:` body's branch logic:

```python
    if apply_profile_effects:
        profile = profile_service.load_profile(db, session_id)
        stamp = datetime.now(timezone.utc)
        if correct:
            # F-13 (decision Q2): full promote through the single exclusivity
            # choke point -- removes the gap from confirmed_gaps and clears a
            # canon-equal dangling focus. Reversible: a later wrong retest
            # demotes and re-adds the gap below.
            profile_service.add_exclusive(
                profile, "mastered_concepts", gap,
                evidence_type="tested", stamp=stamp,
            )
        else:
            # Demotion + confirmed-gap evidence via the same choke point.
            profile_service.add_exclusive(
                profile, "confirmed_gaps", gap,
                evidence_type="tested", stamp=stamp,
            )
        profile_service.save_profile(db, session_id, profile, commit=False)
```

Also update the function docstring's correct-branch line to: `- correct  -> add gap to mastered_concepts (tested mastery) and remove it from confirmed_gaps (exclusivity, F-13); a focus pointing at that gap is cleared`.

`backend/services/profile_service.py` `apply_patch` — replace the mastery-add persistence line:

```python
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
            add_exclusive(
                profile, "mastered_concepts", args.add_mastered_concept,
                evidence_type=args.evidence_type,
                stamp=datetime.now(timezone.utc),
            )
```

Note: `add_exclusive` may null the focus when it removes the concept from `confirmed_gaps`. `prior_focus` is captured BEFORE this block (line ~309) — leave that capture where it is; the focus-clear block later in the function must not resurrect a focus this removal cleared. Verify: the later block only touches `profile.focus_target_gap` when `clearing` or when `args.focus_target_gap is not None`, so a nulled focus stays null. Add a regression assertion to the Step 1 agent-path test if the file's existing tests don't already cover focus.

- [ ] **Step 4: Run both test files fully + demotion regression**

Run: `pytest tests/test_learning_event_service.py tests/test_profile_service.py tests/test_check_answer_route.py -v`
Expected: PASS. Pre-existing tests asserting the old correct-branch behavior (gap kept in `confirmed_gaps` with a `tested` stamp) will fail — update them to the new invariant (gap removed). Do not weaken demotion tests: incorrect answers must still remove from mastered AND add to gaps.

- [ ] **Step 5: Commit**

```bash
git add backend/services/learning_event_service.py backend/services/profile_service.py backend/tests/
git commit -m "fix: enforce mastery exclusivity on agent and server write paths (F-13)"
```

---

### Task 3: F-02 restore focus-clear guard + F-23 clear-intent semantics (decision Q1)

**Files:**
- Modify: `backend/services/profile_service.py` (module docstring lines 8-10; `apply_patch` focus block lines ~342-364)
- Modify: `backend/agent/prompts.py` (FOCUS PROTOCOL, lines ~58-66)
- Modify: `backend/agent/tools.py` (update_topic_profile description, lines ~35-45)
- Modify: `docs/api/openapi.yaml` (`UpdateTopicProfileArgs` description) → regen contracts
- Test: `backend/tests/test_profile_service.py`, `backend/tests/test_focus_clear_grading_turn.py`, `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: `LearningEvent` model, `canon`.
- Produces: clearing semantics — focus is cleared ONLY when `prior_focus` is set AND `args.focus_target_gap is None` AND `args.focus_clear_reason is not None`; reason `"tested_correct"` additionally requires a correct session-scoped `LearningEvent` on the (canon-equal) focused gap, else `ok=False`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_profile_service.py`:

```python
def _clear_args(session_id, reason):
    return UpdateTopicProfileArgs(session_id=session_id, focus_clear_reason=reason)


def test_tested_correct_clear_rejected_without_event(db_session, tool_ctx):
    profile = TopicProfile(focus_target_gap="chain rule")
    profile_service.save_profile(db_session, tool_ctx.session_id, profile)

    result = profile_service.apply_patch(
        db_session, tool_ctx, _clear_args(tool_ctx.session_id, "tested_correct")
    )

    assert not result.ok
    assert "tested_correct" in (result.error or "")
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    assert after.focus_target_gap == "chain rule"


def test_tested_correct_clear_accepted_with_canon_matching_event(db_session, tool_ctx):
    profile = TopicProfile(focus_target_gap="Chain Rule")
    profile_service.save_profile(db_session, tool_ctx.session_id, profile)
    db_session.add(LearningEvent(
        session_id=tool_ctx.session_id, gap_tested="  chain rule ",
        question="q?", correct=True,
    ))
    db_session.commit()

    result = profile_service.apply_patch(
        db_session, tool_ctx, _clear_args(tool_ctx.session_id, "tested_correct")
    )

    assert result.ok
    assert profile_service.load_profile(db_session, tool_ctx.session_id).focus_target_gap is None


def test_tested_correct_clear_rejected_for_event_on_other_gap(db_session, tool_ctx):
    profile = TopicProfile(focus_target_gap="chain rule")
    profile_service.save_profile(db_session, tool_ctx.session_id, profile)
    db_session.add(LearningEvent(
        session_id=tool_ctx.session_id, gap_tested="product rule",
        question="q?", correct=True,
    ))
    db_session.commit()

    result = profile_service.apply_patch(
        db_session, tool_ctx, _clear_args(tool_ctx.session_id, "tested_correct")
    )

    assert not result.ok


def test_non_tested_reasons_clear_without_event(db_session, tool_ctx):
    for reason in ("demonstrated", "user_redirected"):
        profile = TopicProfile(focus_target_gap="chain rule")
        profile_service.save_profile(db_session, tool_ctx.session_id, profile)
        result = profile_service.apply_patch(
            db_session, tool_ctx, _clear_args(tool_ctx.session_id, reason)
        )
        assert result.ok
        assert profile_service.load_profile(db_session, tool_ctx.session_id).focus_target_gap is None


def test_omitted_focus_without_reason_is_not_a_clear(db_session, tool_ctx):
    # F-23: a non-focus patch while focus is set must neither fail nor clear.
    profile = TopicProfile(focus_target_gap="chain rule")
    profile_service.save_profile(db_session, tool_ctx.session_id, profile)

    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(session_id=tool_ctx.session_id, add_confirmed_gap="product rule"),
    )

    assert result.ok
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    assert after.focus_target_gap == "chain rule"
    assert "product rule" in profile_service.concept_names(after.confirmed_gaps)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_profile_service.py -k "tested_correct_clear or omitted_focus or non_tested_reasons" -v`
Expected: FAIL — `tested_correct` clears are currently accepted with zero events; the omitted-focus patch currently fails with "focus_clear_reason required".

- [ ] **Step 3: Implement the service change**

In `backend/services/profile_service.py`, add near `canon`:

```python
def _has_correct_event_for(db: Session, session_id: str, gap: str) -> bool:
    """F-02 guard (decision Q1): session-scoped proof that a correct
    check-question answer was recorded for this gap. canon-compared in Python
    because gap_tested is stored raw."""
    key = canon(gap)
    rows = db.execute(
        select(LearningEvent.gap_tested)
        .where(
            LearningEvent.session_id == session_id,
            LearningEvent.correct.is_(True),
        )
    ).scalars().all()
    return any(canon(g) == key for g in rows)
```

Replace the focus block in `apply_patch` (current lines ~342-364, including the removal-rationale comment at ~351-355):

```python
    # focus_target_gap handling.
    # F-23: an omitted focus field is indistinguishable from an explicit null
    # after JSON parsing, so clearing is treated as INTENT only when a reason
    # accompanies it; a patch that merely omits focus leaves focus unchanged.
    clearing = (
        prior_focus is not None
        and args.focus_target_gap is None
        and args.focus_clear_reason is not None
    )
    if clearing:
        if args.focus_clear_reason == "tested_correct" and not _has_correct_event_for(
            db, ctx.session_id, prior_focus
        ):
            # F-02 (decision Q1): the flagship guard rail. "tested_correct" is
            # accepted only when a correct LearningEvent for the focused gap
            # exists in this session (record_from_answer writes one on the
            # human-click grading path). Known limit: other reason labels are
            # accepted on the agent's word.
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "focus_clear_reason 'tested_correct' rejected: no correct "
                    f"check answer recorded for '{prior_focus}' in this session"
                ),
            )
        log.info(
            "focus_clear session=%s gap=%s reason=%s",
            ctx.session_id,
            prior_focus,
            args.focus_clear_reason,
        )
        profile.focus_target_gap = None
    elif args.focus_target_gap is not None:
        profile.focus_target_gap = args.focus_target_gap
```

Update the module docstring lines 8-10 to:

```
- focus_target_gap clearing requires focus_clear_reason; omitting the focus
  field without a reason leaves focus unchanged (F-23). Reason
  "tested_correct" is server-verified against a correct LearningEvent for the
  focused gap in this session (F-02, restored per owner decision Q1).
```

- [ ] **Step 4: Update the prompt and tool description**

`backend/agent/prompts.py` FOCUS PROTOCOL — after the three reason bullets, add:

```
- Omitting focus_target_gap in a patch leaves focus UNCHANGED; it never
  clears. To clear, send focus_target_gap: null WITH focus_clear_reason.
- "tested_correct" is verified server-side: it is accepted only when a
  correct check-question answer for that gap was recorded this session. The
  server also clears focus automatically when a correct answer removes the
  focused gap from confirmed_gaps.
```

`backend/agent/tools.py` update_topic_profile description — replace the sentence `" To clear focus_target_gap, send it as null and provide focus_clear_reason."` with:

```
" To clear focus_target_gap, send it as null AND provide focus_clear_reason;"
" omitting focus_target_gap leaves focus unchanged."
```

`docs/api/openapi.yaml` — find the `UpdateTopicProfileArgs` schema description and update its focus sentence to match ("Sending `focus_target_gap: null` together with `focus_clear_reason` clears focus; omitting the field leaves focus unchanged. `focus_clear_reason=tested_correct` is verified server-side against the session's learning events."). Then run from repo root: `python backend/scripts/gen_contracts.py` and confirm `backend/contracts/models.py` picked up only the docstring change.

- [ ] **Step 5: Reconcile existing tests**

`backend/tests/test_focus_clear_grading_turn.py` covers the pre-restore semantics — read it and update: any test asserting `tested_correct` clears without an event now expects `ok=False`; any test asserting an omitted-focus patch fails with "focus_clear_reason required" now expects success-with-focus-kept. `backend/tests/test_prompts.py` may assert FOCUS PROTOCOL text — extend, don't contradict.

Run: `pytest tests/test_profile_service.py tests/test_focus_clear_grading_turn.py tests/test_prompts.py tests/test_tutor_loop.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/profile_service.py backend/agent/prompts.py backend/agent/tools.py docs/api/openapi.yaml backend/contracts/ backend/tests/
git commit -m "fix: restore server-verified tested_correct focus-clear guard (F-02, F-23)"
```

---

### Task 4: F-21 evidence downgrade + F-39a level requires evidence

**Files:**
- Modify: `backend/services/profile_service.py` (`apply_patch` — evidence normalization + level gate)
- Modify: `backend/agent/prompts.py` (EVIDENCE TYPING + PROFILE RULES notes)
- Test: `backend/tests/test_profile_service.py`, `backend/tests/test_prompts.py`

**Interfaces:**
- Consumes: `add_exclusive` (Task 1).
- Produces: agent-supplied `evidence_type="tested"` is stored as `"declared"`; `apply_patch` rejects `knowledge_level` changes without `evidence_type in ("declared", "tested")`. Server path (`record_from_answer`) remains the only writer of `"tested"`.

- [ ] **Step 1: Write the failing tests**

```python
def test_agent_tested_evidence_downgraded_to_declared(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(
            session_id=tool_ctx.session_id,
            add_mastered_concept="chain rule",
            evidence_type="tested",
        ),
    )
    assert result.ok
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    entry = profile_service.find_entry(after.mastered_concepts, "chain rule")
    assert entry.evidence_type == "declared"


def test_agent_tested_gap_evidence_downgraded(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(
            session_id=tool_ctx.session_id,
            add_confirmed_gap="chain rule",
            evidence_type="tested",
        ),
    )
    assert result.ok
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    entry = profile_service.find_entry(after.confirmed_gaps, "chain rule")
    assert entry.evidence_type == "declared"


def test_knowledge_level_requires_evidence(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(session_id=tool_ctx.session_id, knowledge_level="advanced"),
    )
    assert not result.ok
    assert "evidence" in (result.error or "").lower()
    assert profile_service.load_profile(db_session, tool_ctx.session_id).knowledge_level is None


def test_knowledge_level_with_declared_evidence_accepted(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(
            session_id=tool_ctx.session_id,
            knowledge_level="advanced",
            evidence_type="declared",
        ),
    )
    assert result.ok
    assert profile_service.load_profile(db_session, tool_ctx.session_id).knowledge_level == "advanced"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_profile_service.py -k "downgraded or knowledge_level_requires or knowledge_level_with_declared" -v`
Expected: FAIL — tested is stored verbatim; level is writable with no evidence.

- [ ] **Step 3: Implement**

In `apply_patch`, immediately after the `session_id` mismatch guard, normalize once:

```python
    # F-21: "tested" provenance is reserved for the server's own grading path
    # (record_from_answer). An agent-supplied "tested" is a self-attested
    # claim, so it is recorded as "declared".
    evidence = "declared" if args.evidence_type == "tested" else args.evidence_type
```

Then update the three consumers inside `apply_patch`:
- knowledge_level block (currently `if args.knowledge_level is not None: profile.knowledge_level = ...`):

```python
    if args.knowledge_level is not None:
        if evidence not in ("declared", "tested"):
            # F-39: level changes need the same evidence standard as mastery.
            # (The knowledge diagnostic sets level server-side and does not
            # pass through this function.)
            return ToolResult(
                ok=False,
                status="failed",
                error=(
                    "knowledge_level change requires evidence_type 'declared' "
                    "or 'tested'"
                ),
            )
        profile.knowledge_level = args.knowledge_level
```

(Note: `evidence` can never be `"tested"` after the downgrade — the tuple check keeps the gate self-describing and safe against reorderings.)
- add_confirmed_gap block: replace its local `evidence = ...` computation with `gap_evidence = evidence if evidence in ("declared", "tested") else None` and pass `evidence_type=gap_evidence`.
- add_mastered_concept block: keep the `args.evidence_type is None` failure; the `in ("declared", "tested")` branch passes `evidence_type=evidence` into `add_exclusive` (with the downgrade, this is always `"declared"` on the agent path).

- [ ] **Step 4: Prompt notes**

`backend/agent/prompts.py` EVIDENCE TYPING section, add bullet:

```
- "tested" is reserved for the server's own deterministic grading; if you
  send evidence_type="tested" it is recorded as "declared".
```

PROFILE RULES section (after the knowledge_level bullet):

```
- Change knowledge_level only with evidence_type "declared" or "tested"
  (i.e., the learner said so, or check answers showed it); a level patch
  without evidence is rejected.
```

- [ ] **Step 5: Run and reconcile**

Run: `pytest tests/test_profile_service.py tests/test_prompts.py tests/test_tutor_loop.py tests/test_chat.py -v`
Expected: PASS after updating any existing test that patched `knowledge_level` through `apply_patch` without evidence (add `evidence_type="declared"` to those arg fixtures). `apply_user_patch` (user route) is intentionally untouched — the user is authoritative for their own level.

- [ ] **Step 6: Commit**

```bash
git add backend/services/profile_service.py backend/agent/prompts.py backend/tests/
git commit -m "fix: downgrade agent-attested tested evidence, gate level on evidence (F-21, F-39)"
```

---

### Task 5: F-48 "ignored" status + F-20b empty-patch failure (contract change)

**Files:**
- Modify: `docs/api/openapi.yaml` (`ToolResult.status`, `ToolCallRecord.status` enums) → regen `backend/contracts/`
- Modify: `backend/services/profile_service.py` (`apply_patch` — empty patch + ignored notes)
- Modify: `backend/agent/tutor.py` (`_summarize`)
- Test: `backend/tests/test_profile_service.py`, `backend/tests/test_tutor_stream.py` (or `test_tutor_loop.py`, whichever hosts `_summarize` coverage), `backend/tests/test_contracts.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ToolResult.status` / `ToolCallRecord.status` accept `"ignored"`; `apply_patch` returns `ok=False, status="failed", error="empty patch..."` for all-None args and `ok=True, status="ignored", data={"notes": [...]}` when inferred mastery was the only requested change.

- [ ] **Step 1: Contract change first (schema gates the code)**

In `docs/api/openapi.yaml`, locate the `ToolResult` schema's `status` property and the `ToolCallRecord` schema's `status` property; extend both enums from `[ok, failed, no_results]` to `[ok, failed, no_results, ignored]`. Run from repo root: `python backend/scripts/gen_contracts.py`. Verify `backend/contracts/models.py` now shows `Literal["ok", "failed", "no_results", "ignored"]` on both models and NOTHING else changed.

- [ ] **Step 2: Write the failing tests**

```python
def test_empty_patch_fails(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx, UpdateTopicProfileArgs(session_id=tool_ctx.session_id)
    )
    assert not result.ok
    assert result.status == "failed"
    assert "empty patch" in (result.error or "")


def test_inferred_only_patch_returns_ignored(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(
            session_id=tool_ctx.session_id,
            add_mastered_concept="chain rule",
            evidence_type="inferred",
        ),
    )
    assert result.ok
    assert result.status == "ignored"
    assert "inferred" in json.dumps(result.data or {})
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    assert profile_service.concept_names(after.mastered_concepts) == []


def test_inferred_mastery_alongside_real_change_is_ok_with_note(db_session, tool_ctx):
    result = profile_service.apply_patch(
        db_session, tool_ctx,
        UpdateTopicProfileArgs(
            session_id=tool_ctx.session_id,
            add_mastered_concept="chain rule",
            add_confirmed_gap="product rule",
            evidence_type="inferred",
        ),
    )
    assert result.ok
    assert result.status == "ok"
    assert "inferred" in json.dumps(result.data or {})
    after = profile_service.load_profile(db_session, tool_ctx.session_id)
    assert "product rule" in profile_service.concept_names(after.confirmed_gaps)
```

And for `_summarize` (place beside existing `_summarize`/tool-label coverage):

```python
def test_summarize_labels_ignored_profile_patch():
    from agent.tutor import _summarize
    result = ToolResult(ok=True, status="ignored", data={"notes": ["inferred mastery ignored"]})
    assert "ignored" in _summarize("update_topic_profile", result).lower()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_profile_service.py -k "empty_patch or inferred" -v`
Expected: FAIL — empty patch currently returns ok=True; inferred-only returns status "ok".

- [ ] **Step 4: Implement**

`apply_patch` — after the session mismatch guard and the Task 4 `evidence` normalization, add the empty-patch gate:

```python
    if (
        args.knowledge_level is None
        and not args.add_confirmed_gap
        and not args.add_mastered_concept
        and args.focus_target_gap is None
        and args.focus_clear_reason is None
        and args.subtopic is None
    ):
        # F-20: a no-op patch (e.g. reconstructed from malformed args) must
        # not be reported to the model as "Profile updated".
        return ToolResult(ok=False, status="failed", error="empty patch: no fields provided")
```

Introduce `ignored_notes: list[str] = []` before the add blocks. In the mastery-add block, the non-(declared/tested) arm becomes explicit:

```python
        if evidence in ("declared", "tested"):
            add_exclusive(
                profile, "mastered_concepts", args.add_mastered_concept,
                evidence_type=evidence,
                stamp=datetime.now(timezone.utc),
            )
        else:
            # F-48: ignoring inferred mastery is policy (spec v1 rules), but
            # the model must be told it was a no-op, not "Profile updated".
            ignored_notes.append(
                "inferred mastery ignored: only 'declared' or 'tested' "
                "evidence promotes to mastered_concepts"
            )
```

Replace the final return:

```python
    save_profile(db, ctx.session_id, profile)

    if ignored_notes:
        only_ignored = (
            args.knowledge_level is None
            and not args.add_confirmed_gap
            and args.focus_target_gap is None
            and args.focus_clear_reason is None
            and args.subtopic is None
        )
        return ToolResult(
            ok=True,
            status="ignored" if only_ignored else "ok",
            data={"notes": ignored_notes},
        )
    return ToolResult(ok=True, status="ok")
```

`backend/agent/tutor.py` `_summarize`:

```python
def _summarize(name: str, result) -> str:
    if name == "retrieve_chunks":
        return f"Found {len((result.data or {}).get('chunks', []))} passages"
    if name == "update_topic_profile":
        if result.status == "ignored":
            return "Profile change ignored (inferred evidence)"
        return "Profile updated"
    if name == "ask_check_questions":
        return "Questions asked"
    return "ok"
```

- [ ] **Step 5: Run, sweep, verify drift**

Run: `pytest tests/ -v --timeout=120` (full backend suite — contract enums changed).
Native-Grep the frontend for `no_results|'failed'` handling of tool statuses to confirm nothing pattern-matches exhaustively on the old enum (expected: FE only branches on the SSE `tool_call_done` `status: ok|error` vocabulary, which is unchanged).
Run from repo root: `python backend/scripts/gen_contracts.py` once more and `git status` — no drift.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/ backend/services/profile_service.py backend/agent/tutor.py backend/tests/
git commit -m "fix: honest tool results for empty and inferred-only patches (F-48, F-20)"
```

---

### Task 6: F-20a malformed tool-args JSON fails without dispatch

**Files:**
- Modify: `backend/agent/tutor.py` (args-decode block in `run_streaming`, lines ~311-316; import `ToolResult` from contracts)
- Test: `backend/tests/test_tutor_stream.py`

**Interfaces:**
- Consumes: `ToolResult` contract.
- Produces: on `json.JSONDecodeError`, the loop yields `tool_call_done` with `status: "error"`, appends a failed tool message to `full`, records a failed `ToolCallRecord`, and never calls `tools.dispatch`.

- [ ] **Step 1: Write the failing test**

Follow the existing fake-stream harness in `backend/tests/test_tutor_stream.py` (it fabricates acompletion chunk sequences). Add:

```python
async def test_malformed_tool_args_yield_error_not_dispatch(monkeypatch, tool_ctx):
    # One iteration returns a tool call whose accumulated arguments are not
    # valid JSON; the next returns plain text so the loop terminates.
    dispatched = []
    monkeypatch.setattr(
        "agent.tools.dispatch",
        lambda name, args, ctx: dispatched.append(name),
    )
    events = await collect_stream_events_with_tool_call(
        args_fragments=['{"session_id": "s1", "add_confirm'],  # truncated JSON
    )
    done_events = [e for e in events if e.type == "tool_call_done"]
    assert done_events and done_events[0].data["status"] == "error"
    assert "malformed" in done_events[0].data["error"]
    assert dispatched == []
```

(`collect_stream_events_with_tool_call` stands for this file's existing helper pattern for fabricating a tool-call iteration followed by a text iteration — reuse the real helper/fixture names in that file; if none exists for two-iteration flows, build the chunk list inline exactly as the file's other tool-call tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_tutor_stream.py -k malformed -v`
Expected: FAIL — current code dispatches `{}` and reports ok.

- [ ] **Step 3: Implement**

In `backend/agent/tutor.py`, add `ToolResult` to the contracts import, then replace the decode block inside the per-slot loop:

```python
                try:
                    args = json.loads(slot["args"]) if slot["args"] else {}
                except json.JSONDecodeError as e:
                    # F-20: a truncated/garbled streamed argument blob must
                    # fail loudly. Dispatching {} would validate (session_id
                    # is injected) and report "Profile updated" for a no-op.
                    log.warning("invalid tool args json (stream): %s", e)
                    result = ToolResult(
                        ok=False, status="failed",
                        error="malformed tool arguments (invalid JSON); retry the call",
                    )
                    tool_calls_record.append(
                        ToolCallRecord(name=name, args={}, status=result.status, error=result.error)
                    )
                    yield StreamEvent(
                        "tool_call_start", {"id": call_id, "name": name, "args": {}}
                    )
                    yield StreamEvent(
                        "tool_call_done",
                        {"id": call_id, "status": "error", "error": result.error},
                    )
                    full.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "name": name,
                            "content": json.dumps(result.model_dump()),
                        }
                    )
                    continue
```

The success path below (dispatch, record, yield, append) stays untouched.

- [ ] **Step 4: Run the stream test files**

Run: `pytest tests/test_tutor_stream.py tests/test_tutor_stream_check_events.py tests/test_sse_event_schemas.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py backend/tests/test_tutor_stream.py
git commit -m "fix: fail malformed tool-args instead of dispatching empty patch (F-20)"
```

---

### Task 7: F-10 dispatch bundled patches before the single ask

**Files:**
- Modify: `backend/agent/tutor.py` (ask-reduction block, lines ~280-288 and its comment)
- Test: `backend/tests/test_tutor_stream_check_events.py`

**Interfaces:**
- Consumes: existing dispatch loop (ask remains turn-terminating via `asked_check`).
- Produces: ordering — non-ask tool calls keep their relative order and run first; exactly one `ask_check_questions` runs last; additional asks are dropped.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_tutor_stream_check_events.py`, using its existing fabricated-stream harness, add a response bundling `update_topic_profile` + `ask_check_questions` in one iteration:

```python
async def test_bundled_profile_patch_dispatches_before_ask(...):
    # fabricate one iteration with two tool calls:
    #   index 0: update_topic_profile(focus_target_gap="chain rule")
    #   index 1: ask_check_questions(gap="chain rule", items=[...1 valid item...])
    events = await run_fabricated_stream(...)
    # the ask still terminates the turn:
    assert any(e.type == "check_question" for e in events)
    # the profile patch was NOT dropped:
    profile = profile_service.load_profile(db_session, session_id)
    assert profile.focus_target_gap == "chain rule"
    # persisted record lists both calls, patch first:
    names = [tc["name"] for tc in json.loads(persisted_assistant_message.tool_calls_json)]
    assert names == ["update_topic_profile", "ask_check_questions"]


async def test_second_bundled_ask_still_dropped(...):
    # fabricate: ask + ask -> only one check_question event, one registered batch
    ...
    assert len([e for e in events if e.type == "check_question"]) == 1
```

(Adapt to the harness's real fixture and assertion style; the file already asserts registered batches and `check_question` events — extend those patterns. The dropped-second-ask test may already exist in spirit: the current suite asserts bundles are REDUCED TO the ask alone — update any such assertion to the new "patch kept, extra ask dropped" contract.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_tutor_stream_check_events.py -v`
Expected: new test FAILS (focus is None — the patch was dropped).

- [ ] **Step 3: Implement**

Replace the reduction block and its comment in `run_streaming`:

```python
            ordered = [tool_frags[k] for k in sorted(tool_frags)]
            # ask_check_questions is turn-terminating and must be the LAST call
            # of the turn. F-10: bundled non-ask calls (profile patches,
            # retrieval) are legitimate and are dispatched FIRST in their
            # original order instead of being dropped; only ADDITIONAL asks
            # (e.g. the model prematurely grading its own question) are
            # dropped. Reduce BEFORE building the assistant message so the
            # persisted tool calls and `full` stay consistent.
            ask_slots = [s for s in ordered if s["name"] == "ask_check_questions"]
            if ask_slots:
                non_ask = [s for s in ordered if s["name"] != "ask_check_questions"]
                ordered = non_ask + ask_slots[:1]
```

- [ ] **Step 4: Run the stream + check suites**

Run: `pytest tests/test_tutor_stream_check_events.py tests/test_tutor_stream.py tests/test_ask_check_question.py tests/test_chat_check_attach.py -v`
Expected: PASS after updating any test asserting the old drop-everything behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tutor.py backend/tests/
git commit -m "fix: dispatch bundled profile patches before the ask instead of dropping (F-10)"
```

---

### Task 8: F-12 row-lock every profile read-modify-write span

**Files:**
- Modify: `backend/services/profile_service.py` (add `lock_session_row`; use in `apply_user_patch`, `remove_profile_item`, `remove_subtopic`, `apply_patch`)
- Modify: `backend/services/learning_event_service.py` (`record_from_answer` locks before profile effects)
- Modify: `backend/routes/profile.py` (lock before `_guard_if_match` in `patch_profile`, `_delete_item`, `delete_subtopic_level`)
- Test: `backend/tests/test_profile_service.py`, `backend/tests/test_profile_route.py`

**Interfaces:**
- Consumes: `SessionModel`.
- Produces: `lock_session_row(db, session_id) -> SessionModel` (raises `ValueError` when the session does not exist). Tasks 9 and 10 call it by this exact name.

**Why locks, not a version column:** a version column needs an alembic migration (owes a live upgrade), a contract-visible field, and conflict-retry logic on the agent path (which has no client round-trip to resolve conflicts). `SELECT ... FOR UPDATE` serializes each short load→mutate→save span on Postgres so no update is lost, is a silent no-op on SQLite (single-writer database — CI-safe), and needs no schema or contract change. Rule: NEVER hold the lock across an LLM await (see Task 9 for the summary path's re-read pattern).

- [ ] **Step 1: Write the failing tests**

```python
def test_lock_session_row_returns_row(db_session, session_row):
    row = profile_service.lock_session_row(db_session, session_row.id)
    assert row.id == session_row.id


def test_lock_session_row_missing_session_raises(db_session):
    with pytest.raises(ValueError):
        profile_service.lock_session_row(db_session, "nope")


def test_lock_session_row_emits_for_update_on_postgres():
    # SQLite ignores FOR UPDATE, so prove intent at the SQL layer instead.
    from sqlalchemy import select
    from sqlalchemy.dialects import postgresql
    from db.models import Session as SessionModel
    stmt = select(SessionModel).where(SessionModel.id == "x").with_for_update()
    assert "FOR UPDATE" in str(stmt.compile(dialect=postgresql.dialect()))


def test_apply_user_patch_takes_the_lock(db_session, session_row, monkeypatch):
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        profile_service, "lock_session_row",
        lambda db, sid: calls.append(sid) or real(db, sid),
    )
    profile_service.apply_user_patch(db_session, session_row.id, add_gap="x")
    assert calls == [session_row.id]
```

Add equivalent spy tests for `apply_patch` (agent path) and, in `backend/tests/test_learning_event_service.py`, for `record_from_answer` with `apply_profile_effects=True`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_profile_service.py -k "lock_session_row or takes_the_lock" -v`
Expected: FAIL with `AttributeError: ... has no attribute 'lock_session_row'`.

- [ ] **Step 3: Implement the helper**

In `backend/services/profile_service.py` after `save_profile`:

```python
def lock_session_row(db: Session, session_id: str) -> SessionModel:
    """F-12: SELECT ... FOR UPDATE on the session row, serializing profile
    read-modify-write spans on Postgres (blind whole-blob writes were losing
    concurrent updates). No-op on SQLite (single-writer). The lock releases at
    the transaction's commit/rollback -- callers must commit promptly and must
    NEVER hold it across an LLM await. Raises ValueError when missing."""
    row = db.get(SessionModel, session_id, with_for_update=True)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    return row
```

Wire it in (each replaces or precedes the span's first profile read):
- `apply_user_patch`: replace `if db.get(SessionModel, session_id) is None: raise ValueError(...)` with `lock_session_row(db, session_id)`.
- `remove_profile_item` and `remove_subtopic`: insert `lock_session_row(db, session_id)` as the first line.
- `apply_patch`: insert `lock_session_row(db, ctx.session_id)` immediately after the session-mismatch guard (before `load_profile`).
- `learning_event_service.record_from_answer`: inside `if apply_profile_effects:`, insert `profile_service.lock_session_row(db, session_id)` before `load_profile`. (When the batch caller `answer()` already holds the lock — Task 10 — this re-lock inside the same transaction is a no-op.)
- `routes/profile.py`: in `patch_profile`, `_delete_item`, and `delete_subtopic_level`, insert `profile_service.lock_session_row(db, session_id)` between the ownership check and `_guard_if_match(...)` — the ETag compare and the write now happen under one lock, closing the check-then-act window. Add a route-file comment: `# F-12: lock before the If-Match read so compare and write are one atomic span.`

- [ ] **Step 4: Run the affected suites**

Run: `pytest tests/test_profile_service.py tests/test_profile_route.py tests/test_learning_event_service.py tests/test_chat.py tests/test_sessions_route.py -v`
Expected: PASS. (Watch for tests that call these services on a session id that does not exist and previously got an empty-profile no-op — they will now get `ValueError`; update them to create the row, which is the honest fixture anyway.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/services/learning_event_service.py backend/routes/profile.py backend/tests/
git commit -m "fix: row-lock profile read-modify-write spans (F-12)"
```

---

### Task 9: F-11 summary merges onto a fresh post-LLM profile

**Files:**
- Modify: `backend/services/summary_service.py` (`generate_and_persist` final write window, lines ~117-135)
- Test: `backend/tests/test_summary_service.py`

**Interfaces:**
- Consumes: `profile_service.lock_session_row`, `profile_service.profile_from_row` (both exist after Task 8).
- Produces: behavior — profile mutations landed during the summary LLM await survive; only `last_session_summary` is written by the summary path.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_summary_service.py` (match its existing monkeypatch style for `litellm.acompletion` and its settings handling for `llm_stub_enabled=False`):

```python
async def test_concurrent_profile_write_survives_summary(db_session, session_row, monkeypatch):
    # seed one message so the LLM branch runs
    db_session.add(ChatMessage(session_id=session_row.id, role="user", content="hi"))
    db_session.commit()

    async def slow_llm(**kwargs):
        # simulate a write landing while the summary call is in flight
        profile_service.apply_user_patch(db_session, session_row.id, add_gap="mid-await gap")
        return make_fake_completion("A real summary.")  # this file's existing fake-resp helper

    monkeypatch.setattr("services.summary_service.litellm.acompletion", slow_llm)

    await summary_service.generate_and_persist(db_session, session_row)

    after = profile_service.load_profile(db_session, session_row.id)
    assert "mid-await gap" in profile_service.concept_names(after.confirmed_gaps)  # not clobbered
    assert after.last_session_summary == "A real summary."
```

(If the file's fake-response helper has a different name, use that one; if none exists, build the minimal object the code reads: `resp.choices[0].message.content` plus benign `completion_cost`/`extract_usage` behavior, following whatever the file's other LLM-branch tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_summary_service.py -k concurrent_profile_write -v`
Expected: FAIL — the pre-await profile blob is written back whole, erasing "mid-await gap".

- [ ] **Step 3: Implement**

In `generate_and_persist`, the pre-LLM `profile = profile_service.load_profile(db, session.id)` stays (it feeds the prompt). Replace the final write window (from the `# F-33: single write window ...` comment through `db.commit()`):

```python
    # F-33: single write window AFTER the LLM await; F-30: the caller's
    # _claim_end owns ended_at. F-11 + F-12: re-read the profile UNDER THE ROW
    # LOCK now that the await is over -- the pre-await copy fed the prompt but
    # any write that landed during the multi-second call (user PATCH, check
    # answer in another tab) must not be clobbered, so only
    # last_session_summary is merged onto the fresh blob. Cost-ledger writes
    # above publish with this same commit (see prior F-33 note): if the commit
    # fails after a won claim, the session is ended with no summary -- an
    # honest state; later end calls take the idempotent replay path.
    row = profile_service.lock_session_row(db, session.id)
    check_question_service.abandon_open_batch(db, session.id, commit=False)
    fresh = profile_service.profile_from_row(row)
    fresh.last_session_summary = summary
    profile_service.save_profile(db, session.id, fresh, commit=False)
    db.commit()
    db.refresh(session)
    return summary
```

(Keep the docstring's F-31/F-33 sentences; add "F-11: the summary merges onto a freshly re-read profile; concurrent writes during the LLM call survive.")

- [ ] **Step 4: Run the summary + end-session suites**

Run: `pytest tests/test_summary_service.py tests/test_sessions_route.py tests/test_end_abandons_open_batch.py tests/test_rolling_summary.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/summary_service.py backend/tests/test_summary_service.py
git commit -m "fix: summary merges onto fresh locked profile, not pre-await blob (F-11)"
```

---

### Task 10: F-24 answer/skip lock + grade backstop, F-25 all-skip no-op, F-39b None-only level

**Files:**
- Modify: `backend/services/check_question_service.py` (`answer`, `skip` take the lock)
- Modify: `backend/services/diagnostic_service.py` (`grade_if_diagnostic`)
- Modify: `backend/routes/sessions.py` (`complete_check` calls `grade_if_diagnostic` before clearing)
- Test: `backend/tests/test_check_question_service.py`, `backend/tests/test_diagnostic_grading.py`, `backend/tests/test_check_complete_route.py`

**Interfaces:**
- Consumes: `profile_service.lock_session_row` (Task 8), `check_question_service.is_done`, `get_pending_check`.
- Produces: behavior — double-submitting the same answer index serializes into one graded event + one 409; a fully-skipped diagnostic leaves `knowledge_level` None (re-offered); a level set by the user mid-batch is not clobbered; a diagnostic whose last item resolves without the per-item grade call still gets graded at `complete`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_diagnostic_grading.py`:

```python
def test_all_skip_diagnostic_leaves_level_none(db_session, session_with_diagnostic_batch):
    sid = session_with_diagnostic_batch
    for i in range(3):
        check_question_service.skip(db_session, sid, i)
    diagnostic_service.grade_if_diagnostic(db_session, sid)
    assert profile_service.load_profile(db_session, sid).knowledge_level is None


def test_user_set_level_not_clobbered_by_diagnostic(db_session, session_with_diagnostic_batch):
    sid = session_with_diagnostic_batch
    check_question_service.answer(db_session, sid, 0, correct_choice(sid, 0))
    profile_service.apply_user_patch(db_session, sid, knowledge_level="advanced")
    check_question_service.answer(db_session, sid, 1, correct_choice(sid, 1))
    check_question_service.answer(db_session, sid, 2, correct_choice(sid, 2))
    diagnostic_service.grade_if_diagnostic(db_session, sid)
    assert profile_service.load_profile(db_session, sid).knowledge_level == "advanced"
```

(Reuse this file's existing batch fixture/builders; `correct_choice` stands for however the file reads an item's `correct_index` — inline it if no helper exists. Note the diagnostic purpose means `answer()` applies no profile effects, so the user PATCH is the only level writer here.)

`backend/tests/test_check_question_service.py` — lock spy:

```python
def test_answer_takes_row_lock(db_session, session_with_batch, monkeypatch):
    sid = session_with_batch
    calls = []
    real = profile_service.lock_session_row
    monkeypatch.setattr(
        "services.profile_service.lock_session_row",
        lambda db, s: calls.append(s) or real(db, s),
    )
    check_question_service.answer(db_session, sid, 0, 0)
    assert sid in calls
```

(and the same for `skip`.)

`backend/tests/test_check_complete_route.py` — grade backstop:

```python
def test_complete_grades_diagnostic_before_clearing(client, db_session, resolved_diagnostic_batch_session):
    # Simulate the F-24 crash window: the batch is fully resolved but the
    # per-item grade_if_diagnostic never ran (e.g. crash after the answer
    # commit). POST /check/complete must grade before clearing the batch.
    sid = resolved_diagnostic_batch_session
    assert profile_service.load_profile(db_session, sid).knowledge_level is None
    resp = client.post(f"/api/sessions/{sid}/check/complete")
    assert resp.status_code == 200
    assert profile_service.load_profile(db_session, sid).knowledge_level is not None
```

(Build `resolved_diagnostic_batch_session` by writing a fully-answered diagnostic `pending_check_json` directly onto the session row — mirroring how this file fabricates batch state; do NOT route through `answer()`, which would grade.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_diagnostic_grading.py tests/test_check_question_service.py tests/test_check_complete_route.py -k "all_skip or clobbered or row_lock or grades_diagnostic" -v`
Expected: FAIL — all-skip currently grades beginner; the user level is overwritten; no lock; complete never grades.

- [ ] **Step 3: Implement**

`backend/services/diagnostic_service.py` — replace `grade_if_diagnostic` body after the guard line:

```python
    pc = check_question_service.get_pending_check(db, session_id)
    if not pc or pc.get("purpose") != "diagnostic" or not check_question_service.is_done(pc):
        return
    items = pc.get("items", [])
    graded = [it for it in items if it["status"] == "answered"]
    if not graded:
        # F-25: an all-skip batch is zero evidence. Leave knowledge_level None
        # so diagnostic_required fires again next turn instead of branding the
        # learner "beginner" forever.
        return
    n_correct = sum(1 for it in graded if it.get("correct"))
    level = level_for_score(n_correct, len(items))
    profile_service.lock_session_row(db, session_id)
    profile = profile_service.load_profile(db, session_id)
    if profile.knowledge_level is not None:
        # F-39: a user PATCH mid-batch already set the level; the diagnostic
        # must not clobber explicit user intent. (This also makes re-grading
        # a resolved batch a no-op, replacing the old recompute-idempotency.)
        return
    profile.knowledge_level = level
    profile_service.save_profile(db, session_id, profile)
```

Update the docstring sentence about re-grading ("resolving the same already-graded batch twice is harmless") to reflect the new None-only write.

`backend/services/check_question_service.py` — first line of `answer()` and `skip()` (before `get_pending_check`):

```python
    from services import profile_service  # local import avoids circular

    # F-24: serialize concurrent submits on the session row; the loser then
    # sees the advanced current_index and raises CheckStateError -> 409.
    profile_service.lock_session_row(db, session_id)
```

(`answer()` already has a local `learning_event_service` import — add `profile_service` to that import line rather than a second import statement.)

`backend/routes/sessions.py` `complete_check` — insert one line before `write_check_batch(db, pc)`:

```python
    # F-24 crash-window backstop: if the per-item grade call never ran (crash
    # between the answer commit and grade), grade the diagnostic NOW, while
    # the resolved batch still exists -- clearing below would otherwise leave
    # knowledge_level None and re-trigger the diagnostic.
    diagnostic_service.grade_if_diagnostic(db, session_id)
```

- [ ] **Step 4: Run the check/diagnostic suites**

Run: `pytest tests/test_check_question_service.py tests/test_diagnostic_grading.py tests/test_check_answer_route.py tests/test_check_skip_route.py tests/test_check_complete_route.py tests/test_check_complete_cap.py -v`
Expected: PASS after updating any existing all-skip-grades-beginner or regrade-overwrites assertions to the new semantics.

- [ ] **Step 5: Commit**

```bash
git add backend/services/check_question_service.py backend/services/diagnostic_service.py backend/routes/sessions.py backend/tests/
git commit -m "fix: lock answer path, grade backstop at complete, no level from zero evidence (F-24, F-25, F-39)"
```

---

### Task 11: Docs FIXED markers + full verification gate

**Files:**
- Modify: `docs/adversarial-review-2026-07-12.md`
- Verify: whole branch.

- [ ] **Step 1: Mark findings fixed**

In `docs/adversarial-review-2026-07-12.md`, append ` — FIXED (Batch 4, fix/adversarial-batch-4, 2026-07-15)` to the heading/lead line of each of: F-02, F-10, F-11, F-12, F-13, F-20, F-21, F-22, F-23, F-24, F-25, F-39, F-48 (same marker format Batches 1-3 used — see F-07/F-30 for the pattern). For F-02 also strike/annotate the "docs still claim it is enforced" clause: the guard is restored, so the design doc and CLAUDE.md §Agent Architecture claims are true again (no CLAUDE.md edit needed — verify its focus-clear paragraph matches shipped behavior and note the verification in the task report).

- [ ] **Step 2: Full verification gate**

From `backend/`: `pytest` — expect ALL green (target: prior 679 + this batch's additions).
From `frontend/`: `npm run test:unit -- --run` — expect all green (no FE source changes; this catches accidental contract fallout).
From `frontend/`: `npm run lint`.
From repo root: `python backend/scripts/gen_contracts.py` then `git status` — zero contract drift.
Native-Grep sweeps: `_add_exclusive` (expect zero hits), `focus_clear_reason is None` in the old required-error form (expect zero hits in `profile_service.py`).

- [ ] **Step 3: Commit**

```bash
git add docs/adversarial-review-2026-07-12.md
git commit -m "docs: mark Batch 4 findings fixed in adversarial review doc"
```

---

## Owed post-merge human gates (paid/live — record in memory, do not automate)

1. Live two-tab interleave on Supabase Postgres: PATCH profile in tab A while a check-answer resolves in tab B — both effects persist (F-11/F-12 proof; SQLite cannot exercise FOR UPDATE).
2. Paid live smoke: a session where the model bundles a focus patch with a quiz — focus persists and the quiz renders (F-10), and a `tested_correct` clear after a correct answer succeeds while an unearned one is refused in logs (F-02).
3. Live check: skip all 3 diagnostic questions — the next turn re-offers the diagnostic instead of teaching at beginner level (F-25).

## Carried-forward gates from Batch 3 (unchanged, still owed)

- Expired-token 401 refresh-retry in a real browser (F-09), live double-end race (F-30), fresh-user first chat (F-36).
