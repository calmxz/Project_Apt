# Interactive Multiple-Choice Check-Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn check-questions into claude.ai-style clickable multiple-choice cards graded instantly server-side, replacing the typed-answer + LLM-grading turn.

**Architecture:** The tutor's `ask_check_question` tool gains `options` + `correct_index` + `explanation`. The pending check stores all of these server-side; only `{gap, question, options}` is ever sent to the browser (anti-cheat). A new `POST /sessions/{id}/check/answer` grades a clicked index, writes the `LearningEvent`, and applies the deterministic profile effects (add-to-mastered on correct, demote on incorrect) — the only signal the agent reads on its next turn. The LLM no longer grades: `record_learning_event` is removed as a tool, which makes the `tested_correct` focus-clear guard moot, so it is dropped.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (codegen'd contracts) backend; Vue 3 + Pinia + Vitest frontend; pytest backend tests.

**Source of truth:** [`docs/superpowers/specs/2026-06-04-interactive-mc-check-questions-design.md`](../specs/2026-06-04-interactive-mc-check-questions-design.md)

**Branch:** `feat/mc-check-questions` (already created).

**No DB migration:** `Session.pending_check_json` is a JSON-in-Text column. Adding keys to the stored dict needs no Alembic migration.

---

## Task 1: Contract changes + codegen

**Files:**
- Modify: `docs/api/openapi.yaml` (schemas `AskCheckQuestionArgs` ~447, `PendingCheck` ~460; add `CheckAnswerRequest`, `CheckAnswerResponse`)
- Generated: `backend/contracts/models.py` (do not hand-edit; codegen)
- Test: `backend/tests/test_contracts.py` (existing drift test)

- [ ] **Step 1: Edit `AskCheckQuestionArgs` in `docs/api/openapi.yaml`**

Replace the existing block (lines ~447-458) with:

```yaml
    AskCheckQuestionArgs:
      type: object
      additionalProperties: false
      required: [session_id, gap, question, options, correct_index, explanation]
      description: |
        Register an open multiple-choice check-question and end the turn. The
        question text is also streamed to the learner as normal assistant text.
        options/correct_index/explanation drive the interactive card and the
        server-side deterministic grade. correct_index must be < len(options);
        this cross-field rule is enforced in check_question_service, not here.
      properties:
        session_id:    { type: string, maxLength: 64 }
        gap:           { type: string, maxLength: 200 }
        question:      { type: string, maxLength: 1000 }
        options:
          type: array
          minItems: 2
          maxItems: 4
          items: { type: string, maxLength: 200 }
        correct_index: { type: integer, minimum: 0 }
        explanation:   { type: string, maxLength: 500 }
```

- [ ] **Step 2: Edit `PendingCheck` in `docs/api/openapi.yaml`**

Replace the existing block (lines ~460-467) with:

```yaml
    PendingCheck:
      type: object
      additionalProperties: false
      required: [gap, question, options]
      description: |
        An open check-question awaiting a learner answer. PUBLIC projection:
        never carries correct_index or explanation.
      properties:
        gap:      { type: string }
        question: { type: string }
        options:
          type: array
          items: { type: string }
```

- [ ] **Step 3: Add `CheckAnswerRequest` and `CheckAnswerResponse`**

Insert immediately after the `PendingCheck` block:

```yaml
    CheckAnswerRequest:
      type: object
      additionalProperties: false
      required: [selected_index]
      description: A learner's clicked answer to the open check-question.
      properties:
        selected_index: { type: integer, minimum: 0 }

    CheckAnswerResponse:
      type: object
      additionalProperties: false
      required: [correct, explanation, correct_index]
      description: Deterministic grade of a clicked check-question answer.
      properties:
        correct:       { type: boolean }
        explanation:   { type: string }
        correct_index: { type: integer }
```

- [ ] **Step 4: Run codegen**

Run: `python backend/scripts/gen_contracts.py`
Expected: regenerates `backend/contracts/models.py` with the new fields and the two new models; exits 0.

- [ ] **Step 5: Verify the generated models exist**

Run: `python -c "from contracts import AskCheckQuestionArgs, PendingCheck, CheckAnswerRequest, CheckAnswerResponse; print(AskCheckQuestionArgs.model_fields.keys()); print(CheckAnswerResponse.model_fields.keys())"` (from `backend/`)
Expected: prints keys including `options`, `correct_index`, `explanation` for the args, and `correct`, `explanation`, `correct_index` for the response.

- [ ] **Step 6: Run the drift test**

Run: `pytest tests/test_contracts.py -v` (from `backend/`)
Expected: PASS (zero drift between YAML and generated models).

- [ ] **Step 7: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py
git commit -m "feat(contracts): MC options + check-answer request/response"
```

---

## Task 2: `check_question_service` stores + projects options

**Files:**
- Modify: `backend/services/check_question_service.py`
- Test: `backend/tests/test_check_question_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_check_question_service.py` (follow the existing fixture style in that file for `db` / a created session and `ToolContext`):

```python
def test_public_view_includes_options_never_answer_fields():
    stored = {
        "gap": "atp_yield",
        "question": "What does glycolysis net per glucose?",
        "options": ["2 ATP", "36 ATP", "0 ATP"],
        "correct_index": 0,
        "explanation": "Net 2 ATP per glucose.",
        "asked_at_turn": "2026-06-04T00:00:00",
    }
    view = check_question_service.public_view(stored)
    assert view == {
        "gap": "atp_yield",
        "question": "What does glycolysis net per glucose?",
        "options": ["2 ATP", "36 ATP", "0 ATP"],
    }
    assert "correct_index" not in view
    assert "explanation" not in view


def test_register_persists_options_and_rejects_bad_correct_index(db, ctx, session_id):
    args = AskCheckQuestionArgs(
        session_id=session_id, gap="g", question="q?",
        options=["a", "b"], correct_index=5, explanation="e",
    )
    bad = check_question_service.register(db, ctx, args)
    assert bad.ok is False
    assert "correct_index" in (bad.error or "")

    ok_args = AskCheckQuestionArgs(
        session_id=session_id, gap="g", question="q?",
        options=["a", "b"], correct_index=1, explanation="b is right",
    )
    res = check_question_service.register(db, ctx, ok_args)
    assert res.ok is True
    stored = check_question_service.get_pending_check(db, session_id)
    assert stored["options"] == ["a", "b"]
    assert stored["correct_index"] == 1
    assert stored["explanation"] == "b is right"
    assert res.data["options"] == ["a", "b"]
```

(If the file lacks `ctx` / `session_id` fixtures, add them mirroring the existing setup that creates a `SessionModel` row and a `ToolContext(db=..., session_id=..., turn_started_at=...)`. Import `AskCheckQuestionArgs` from `contracts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_check_question_service.py -k "options or correct_index" -v` (from `backend/`)
Expected: FAIL (`public_view` lacks `options`; `register` does not validate `correct_index` or persist new fields).

- [ ] **Step 3: Update `set_pending_check`**

Replace the function with:

```python
def set_pending_check(
    db: Session,
    session_id: str,
    gap: str,
    question: str,
    options: list[str],
    correct_index: int,
    explanation: str,
    asked_at: datetime,
) -> None:
    row = db.get(SessionModel, session_id)
    if row is None:
        raise ValueError(f"session not found: {session_id}")
    row.pending_check_json = json.dumps(
        {
            "gap": gap,
            "question": question,
            "options": options,
            "correct_index": correct_index,
            "explanation": explanation,
            "asked_at_turn": asked_at.isoformat(),
        }
    )
    db.commit()
```

- [ ] **Step 4: Update `public_view` (anti-cheat boundary)**

```python
def public_view(pc: dict | None) -> dict | None:
    """Project a stored pending_check to the PendingCheck contract shape.

    PUBLIC: returns gap + question + options only. correct_index and explanation
    are server-only and MUST NOT be emitted here.
    """
    if not pc:
        return None
    return {
        "gap": pc["gap"],
        "question": pc["question"],
        "options": pc.get("options", []),
    }
```

- [ ] **Step 5: Update `register`**

Replace the `register` function with:

```python
def register(db: Session, ctx: ToolContext, args: AskCheckQuestionArgs) -> ToolResult:
    if args.session_id != ctx.session_id:
        return ToolResult(
            ok=False,
            status="failed",
            error=f"session_id mismatch: args={args.session_id} ctx={ctx.session_id}",
        )
    if not (0 <= args.correct_index < len(args.options)):
        return ToolResult(
            ok=False,
            status="failed",
            error=(
                f"correct_index {args.correct_index} out of range for "
                f"{len(args.options)} options"
            ),
        )
    if get_pending_check(db, ctx.session_id) is not None:
        return ToolResult(
            ok=False,
            status="failed",
            error="a check-question is already open; grade or skip it first",
        )
    set_pending_check(
        db,
        ctx.session_id,
        gap=args.gap,
        question=args.question,
        options=args.options,
        correct_index=args.correct_index,
        explanation=args.explanation,
        asked_at=ctx.turn_started_at,
    )
    return ToolResult(
        ok=True,
        status="ok",
        data={"gap": args.gap, "question": args.question, "options": args.options},
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_check_question_service.py -v` (from `backend/`)
Expected: PASS (all, including the existing tests).

- [ ] **Step 7: Commit**

```bash
git add backend/services/check_question_service.py backend/tests/test_check_question_service.py
git commit -m "feat(check): store + project MC options; validate correct_index"
```

---

## Task 3: `record_from_answer` (deterministic grade + profile effects)

**Files:**
- Modify: `backend/services/learning_event_service.py`
- Test: `backend/tests/test_learning_event_service.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_learning_event_service.py` (reuse the file's existing `db` + session fixtures; these need NO prior pending-check turn, since the click path bypasses the barrier — but set one so `clear_pending_check` has something to clear):

```python
def test_record_from_answer_correct_adds_mastered_and_clears(db, session_id):
    check_question_service.set_pending_check(
        db, session_id, gap="atp", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    event = learning_event_service.record_from_answer(
        db, session_id, gap="atp", question="q?", correct=True,
    )
    assert event.correct is True
    profile = profile_service.load_profile(db, session_id)
    assert "atp" in profile.mastered_concepts
    assert check_question_service.get_pending_check(db, session_id) is None


def test_record_from_answer_incorrect_demotes_mastered(db, session_id):
    profile = profile_service.load_profile(db, session_id)
    profile.mastered_concepts = ["atp"]
    profile_service.save_profile(db, session_id, profile)
    check_question_service.set_pending_check(
        db, session_id, gap="atp", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    learning_event_service.record_from_answer(
        db, session_id, gap="atp", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db, session_id)
    assert "atp" not in profile.mastered_concepts


def test_record_from_answer_incorrect_non_mastered_is_noop_on_profile(db, session_id):
    check_question_service.set_pending_check(
        db, session_id, gap="krebs", question="q?", options=["a", "b"],
        correct_index=0, explanation="e", asked_at=datetime(2026, 1, 1),
    )
    learning_event_service.record_from_answer(
        db, session_id, gap="krebs", question="q?", correct=False,
    )
    profile = profile_service.load_profile(db, session_id)
    assert "krebs" not in (profile.mastered_concepts or [])
```

(Import `datetime` from `datetime`, plus `check_question_service` and `profile_service`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_learning_event_service.py -k record_from_answer -v` (from `backend/`)
Expected: FAIL (`record_from_answer` not defined).

- [ ] **Step 3: Implement `record_from_answer`**

Add to `backend/services/learning_event_service.py` (the module already imports `check_question_service` and `profile_service`):

```python
def record_from_answer(
    db: Session, session_id: str, gap: str, question: str, correct: bool
) -> LearningEvent:
    """Record a learner's clicked check-question answer (deterministic path).

    Unlike record(), this bypasses the is_gradable turn-barrier: a human click
    is not the LLM, and record_learning_event is no longer a tool, so the
    ask-and-self-grade exploit the barrier guarded against is impossible.

    Applies the deterministic profile effects, because the click is silent and
    the agent's only next-turn signal is the profile state:
    - correct  -> add gap to mastered_concepts (tested mastery)
    - incorrect-> remove gap from mastered_concepts if present (demotion)
    Then clears the pending check, all in one transaction.
    """
    event = LearningEvent(
        session_id=session_id,
        gap_tested=gap,
        question=question,
        correct=correct,
    )
    db.add(event)
    db.flush()

    profile = profile_service.load_profile(db, session_id)
    mastered = list(profile.mastered_concepts or [])
    if correct:
        if gap not in mastered:
            mastered.append(gap)
            profile.mastered_concepts = mastered
            profile_service.save_profile(db, session_id, profile)
    else:
        if gap in mastered:
            profile.mastered_concepts = [c for c in mastered if c != gap]
            profile_service.save_profile(db, session_id, profile)

    check_question_service.clear_pending_check(db, session_id, commit=False)
    db.commit()
    db.refresh(event)
    return event
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_learning_event_service.py -v` (from `backend/`)
Expected: PASS (new tests + existing `record()` tests untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/services/learning_event_service.py backend/tests/test_learning_event_service.py
git commit -m "feat(learning): record_from_answer with server-side profile effects"
```

---

## Task 4: Drop the moot `tested_correct` focus-clear guard

**Files:**
- Modify: `backend/services/profile_service.py` (lines ~140-160)
- Test: `backend/tests/test_focus_clear_grading_turn.py`

- [ ] **Step 1: Update the existing guard test to assert the new behavior**

In `backend/tests/test_focus_clear_grading_turn.py`, the suite currently asserts that clearing focus with `focus_clear_reason="tested_correct"` FAILS without an in-turn correct `LearningEvent`. Invert that: it should now SUCCEED with no event. Replace the relevant test body with:

```python
def test_tested_correct_clear_no_longer_requires_in_turn_event(db, ctx, session_id):
    profile = profile_service.load_profile(db, session_id)
    profile.focus_target_gap = "atp"
    profile_service.save_profile(db, session_id, profile)

    res = profile_service.apply_patch(
        db, ctx,
        UpdateTopicProfileArgs(
            session_id=session_id,
            focus_target_gap=None,
            focus_clear_reason="tested_correct",
            evidence_type="tested",
        ),
    )
    assert res.ok is True
    profile = profile_service.load_profile(db, session_id)
    assert profile.focus_target_gap is None
```

Keep any existing test that asserts clearing focus WITHOUT a `focus_clear_reason` still fails (that rule stays).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_focus_clear_grading_turn.py -k tested_correct -v` (from `backend/`)
Expected: FAIL (current guard rejects the clear with no in-turn event).

- [ ] **Step 3: Remove the evidence check**

In `backend/services/profile_service.py`, delete the entire `if args.focus_clear_reason == "tested_correct":` block (the comment + the `db.execute(select(LearningEvent)...)` query + the `if ev is None: return ToolResult(... )`). The surrounding structure becomes:

```python
    clearing = prior_focus is not None and args.focus_target_gap is None
    if clearing:
        if args.focus_clear_reason is None:
            return ToolResult(
                ok=False,
                status="failed",
                error="focus_clear_reason required when clearing focus",
            )
        # The tested_correct evidence guard was removed: record_learning_event is
        # no longer a tool, so the LLM cannot fabricate a LearningEvent, and the
        # ask-and-self-grade exploit the guard prevented is impossible. Mastery is
        # now server-authoritative (record_from_answer), so the agent clears focus
        # by judgment from the profile it reads, not from in-turn event evidence.
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

If `select` and `LearningEvent` are now unused in this module, remove their imports (check with a grep first — `LearningEvent` is still used by `aggregate_for_user` near line 235, so keep that import; `select` is also used there, keep it).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_focus_clear_grading_turn.py -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_focus_clear_grading_turn.py
git commit -m "feat(profile): drop moot tested_correct focus-clear evidence guard"
```

---

## Task 5: `POST /sessions/{id}/check/answer` endpoint

**Files:**
- Modify: `backend/routes/sessions.py` (add endpoint after `skip_check` ~272)
- Test: `backend/tests/test_check_answer_route.py` (new) — mirror `backend/tests/test_check_skip_route.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_check_answer_route.py`, mirroring the auth/client setup in `backend/tests/test_check_skip_route.py`:

```python
# Reuse the same client/auth/session fixtures as test_check_skip_route.py.
from datetime import datetime
from services import check_question_service, profile_service


def _open_check(db, session_id):
    check_question_service.set_pending_check(
        db, session_id, gap="atp", question="What nets per glucose?",
        options=["2 ATP", "36 ATP", "0 ATP"], correct_index=0,
        explanation="Net 2 ATP per glucose.", asked_at=datetime(2026, 1, 1),
    )


def test_answer_correct_returns_verdict_and_masters(client, db, auth_headers, session_id):
    _open_check(db, session_id)
    r = client.post(f"/api/sessions/{session_id}/check/answer",
                    json={"selected_index": 0}, headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True
    assert body["correct_index"] == 0
    assert body["explanation"] == "Net 2 ATP per glucose."
    assert check_question_service.get_pending_check(db, session_id) is None
    assert "atp" in profile_service.load_profile(db, session_id).mastered_concepts


def test_answer_incorrect_returns_false(client, db, auth_headers, session_id):
    _open_check(db, session_id)
    r = client.post(f"/api/sessions/{session_id}/check/answer",
                    json={"selected_index": 1}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["correct"] is False


def test_answer_out_of_range_is_422(client, db, auth_headers, session_id):
    _open_check(db, session_id)
    r = client.post(f"/api/sessions/{session_id}/check/answer",
                    json={"selected_index": 9}, headers=auth_headers)
    assert r.status_code == 422


def test_answer_no_pending_is_409(client, db, auth_headers, session_id):
    r = client.post(f"/api/sessions/{session_id}/check/answer",
                    json={"selected_index": 0}, headers=auth_headers)
    assert r.status_code == 409


def test_answer_foreign_session_is_404(client, auth_headers):
    r = client.post("/api/sessions/does-not-exist/check/answer",
                    json={"selected_index": 0}, headers=auth_headers)
    assert r.status_code == 404
```

(Adjust the `/api` prefix and fixture names to match `test_check_skip_route.py` exactly.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_check_answer_route.py -v` (from `backend/`)
Expected: FAIL (404/route not found for the new path).

- [ ] **Step 3: Implement the endpoint**

In `backend/routes/sessions.py`, add to the contracts import line `CheckAnswerRequest, CheckAnswerResponse`, ensure `learning_event_service` is imported from `services`, and add after `skip_check`:

```python
@router.post("/sessions/{session_id}/check/answer", response_model=CheckAnswerResponse)
def answer_check(
    session_id: str,
    req: CheckAnswerRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    pc = check_question_service.get_pending_check(db, session_id)
    if pc is None:
        raise HTTPException(status_code=409, detail="no open check-question")
    options = pc.get("options") or []
    if not (0 <= req.selected_index < len(options)):
        raise HTTPException(status_code=422, detail="selected_index out of range")
    correct = req.selected_index == pc.get("correct_index")
    learning_event_service.record_from_answer(
        db, session_id, gap=pc["gap"], question=pc["question"], correct=correct,
    )
    return CheckAnswerResponse(
        correct=correct,
        explanation=pc.get("explanation") or "",
        correct_index=pc.get("correct_index"),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_check_answer_route.py -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_check_answer_route.py
git commit -m "feat(api): POST /sessions/{id}/check/answer deterministic grade"
```

---

## Task 6: Remove `record_learning_event` tool; require options on ask

**Files:**
- Modify: `backend/agent/tools.py`
- Test: `backend/tests/test_ask_check_question.py` (existing — make ask args include options)

- [ ] **Step 1: Write/adjust the failing test**

In `backend/tests/test_ask_check_question.py`, ensure a test asserts `record_learning_event` is NOT in the tool manifest and that `ask_check_question`'s schema requires `options`. Add:

```python
def test_tool_manifest_drops_record_learning_event_and_requires_options():
    from agent.tools import TOOLS
    names = [t["function"]["name"] for t in TOOLS]
    assert "record_learning_event" not in names
    ask = next(t for t in TOOLS if t["function"]["name"] == "ask_check_question")
    required = ask["function"]["parameters"]["required"]
    assert "options" in required and "correct_index" in required
```

Update any existing test in this file that dispatches `ask_check_question` to pass `options`, `correct_index`, `explanation`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ask_check_question.py -k manifest -v` (from `backend/`)
Expected: FAIL (`record_learning_event` still present).

- [ ] **Step 3: Edit `backend/agent/tools.py`**

- Remove the `record_learning_event` entry from the `TOOLS` list (the whole dict at lines ~47-57).
- Remove the `if name == "record_learning_event":` branch in `dispatch` (lines ~99-102).
- Remove the now-unused `RecordLearningEventArgs` import.
- Update the `ask_check_question` description to:

```python
            "description": (
                "The ONLY way to quiz, test, or check the learner's understanding."
                " Pose ONE multiple-choice question: provide 2-4 plausible options,"
                " the 0-based correct_index, and a one-sentence explanation shown"
                " after the learner answers. This ends your turn. The learner clicks"
                " an option; the server grades it and updates the profile. You do NOT"
                " grade answers yourself."
            ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ask_check_question.py -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tools.py backend/tests/test_ask_check_question.py
git commit -m "feat(tools): remove record_learning_event tool; MC ask schema"
```

---

## Task 7: Tutor prompt — MC protocol, no self-grading

**Files:**
- Modify: `backend/agent/prompts.py` (CHECK-QUESTION PROTOCOL ~53-69; evidence notes ~29-48)
- Test: `backend/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_prompts.py`:

```python
def test_prompt_describes_mc_and_drops_self_grading():
    from agent.prompts import IMMUTABLE_RULES
    assert "record_learning_event" not in IMMUTABLE_RULES
    assert "options" in IMMUTABLE_RULES
    # no instruction to grade the learner's typed answer next turn
    assert "Grade it by calling" not in IMMUTABLE_RULES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_prompts.py -k mc -v` (from `backend/`)
Expected: FAIL.

- [ ] **Step 3: Rewrite the CHECK-QUESTION PROTOCOL block**

Replace lines ~53-69 of `backend/agent/prompts.py` with:

```python
CHECK-QUESTION PROTOCOL (interactive multiple-choice, one question per turn):
- Whenever you want to quiz, test, or check the learner's understanding, you MUST
  do it by calling ask_check_question(gap, question, options, correct_index,
  explanation). That tool call is the ONLY sanctioned way to pose a check-question.
  Writing a quiz question as plain prose WITHOUT calling the tool is a protocol
  violation: no interactive card renders and the learner cannot answer.
- Provide 2-4 plausible options, exactly one correct, the 0-based correct_index,
  and a one-sentence explanation shown after the learner answers. Do NOT number or
  letter the options inside the question text; the options array is the UI.
- Calling ask_check_question ends your turn. The learner clicks an option; the
  server grades it deterministically and updates the profile.
- You do NOT grade answers. There is no record_learning_event tool. You learn the
  outcome on the learner's NEXT turn from the CURRENT TOPIC PROFILE: a correct
  answer adds the gap to mastered_concepts; an incorrect answer demotes it.
- To cover a focus area, ask up to 2-3 such questions across turns (ask, wait for
  the profile to update, ask again). When the profile shows the focus gap is
  mastered and you judge it covered, clear focus_target_gap (send it null with
  focus_clear_reason).
- Only one check-question can be open at a time.
```

- [ ] **Step 4: Fix the evidence-note lines**

In the same file, update lines ~29-48: remove references to `record_learning_event` as the grading call. Change line ~31 "If a learner answers a check-question incorrectly via record_learning_event..." to "If the profile shows a previously mastered concept was demoted (an incorrect check-answer)...". Change "tested_correct": description (~48) to: `"tested_correct": the learner answered the check-question correctly (the gap now appears in mastered_concepts).`

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_prompts.py -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/prompts.py backend/tests/test_prompts.py
git commit -m "feat(prompts): MC check-question protocol; remove self-grading"
```

---

## Task 8: Tutor loop — options on check_question, drop check_result

**Files:**
- Modify: `backend/agent/tutor.py` (run_streaming ~448-461)
- Test: `backend/tests/test_tutor_stream_check_events.py`

- [ ] **Step 1: Update the streaming-events test**

In `backend/tests/test_tutor_stream_check_events.py`:
- Change the test that drives `ask_check_question` so its stubbed tool args include `options`, `correct_index`, `explanation`, and assert the emitted `check_question` event payload includes `options`.
- Remove (or invert) the test that asserts a `check_result` event is emitted after `record_learning_event` — that path no longer exists. Add an assertion that no `check_result` event is emitted in a stream.

Concretely, the check_question assertion becomes:

```python
ev = next(e for e in events if e.name == "check_question")
assert ev.data["options"] == ["2 ATP", "36 ATP"]
assert "check_result" not in {e.name for e in events}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_tutor_stream_check_events.py -v` (from `backend/`)
Expected: FAIL (`options` not in payload; `check_result` still emitted).

- [ ] **Step 3: Edit `run_streaming` in `backend/agent/tutor.py`**

- In the `ask_check_question` block (~448-453), include options:

```python
                if name == "ask_check_question" and result.ok:
                    data = result.data or {}
                    yield StreamEvent(
                        "check_question",
                        {
                            "gap": data.get("gap"),
                            "question": data.get("question"),
                            "options": data.get("options", []),
                        },
                    )
                    asked_check = True
```

- Delete the entire `if name == "record_learning_event" and result.ok:` block (~456-461) that emits `check_result`.

The sibling-filtering logic (`ask_slots`) and the early break stay unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_tutor_stream_check_events.py -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Run the full backend suite (catch cascade)**

Run: `pytest -q` (from `backend/`)
Expected: PASS. If `test_tutor_loop.py` or others reference `record_learning_event` via the agent, update them: those scenarios are no longer reachable (the tool is gone), so drop or rewrite the specific cases to use `ask_check_question` + the new answer route instead. Fix until green.

- [ ] **Step 6: Commit**

```bash
git add backend/agent/tutor.py backend/tests/
git commit -m "feat(tutor): emit options on check_question; drop check_result"
```

---

## Task 9: Frontend store + API client for clicked answers

**Files:**
- Modify: `frontend/src/services/sessionsApi.js`
- Modify: `frontend/src/stores/session.js`
- Test: `frontend/src/__tests__/sessionCheckFlow.test.js`

- [ ] **Step 1: Write the failing test**

In `frontend/src/__tests__/sessionCheckFlow.test.js`, add (mock `sessionsApi.answerCheck` to resolve `{ correct: true, explanation: 'x', correct_index: 1 }`):

```js
it('answerCheck sets verdict, selectedIndex, explanation, correctIndex and unlocks', async () => {
  const store = useSessionStore()
  store.currentSessionId = 's1'
  store.pendingCheck = { gap: 'g', question: 'q', options: ['a', 'b'], verdict: null }
  vi.spyOn(sessionsApi, 'answerCheck').mockResolvedValue({
    correct: true, explanation: 'x', correct_index: 1,
  })
  await store.answerCheck(1)
  expect(sessionsApi.answerCheck).toHaveBeenCalledWith('s1', 1)
  expect(store.pendingCheck.verdict).toBe(true)
  expect(store.pendingCheck.selectedIndex).toBe(1)
  expect(store.pendingCheck.explanation).toBe('x')
  expect(store.pendingCheck.correctIndex).toBe(1)
  expect(store.checkLocked).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run sessionCheckFlow` (from `frontend/`)
Expected: FAIL (`answerCheck` not a function).

- [ ] **Step 3: Add the API client function**

In `frontend/src/services/sessionsApi.js`, append:

```js
export const answerCheck = (sessionId, selectedIndex) =>
  apiPost(`/sessions/${sessionId}/check/answer`, { selected_index: selectedIndex })
```

- [ ] **Step 4: Update the store**

In `frontend/src/stores/session.js`:

- In `loadSession`, map options through:

```js
      pendingCheck.value = s.pending_check
        ? {
            gap: s.pending_check.gap,
            question: s.pending_check.question,
            options: s.pending_check.options || [],
            verdict: null,
          }
        : null
```

- In `sendMessage`, do the same mapping for `resp.pending_check` (add `options: resp.pending_check.options || []`).

- Update `handleCheckQuestion` to carry options:

```js
  function handleCheckQuestion({ gap, question, options }) {
    pendingCheck.value = { gap, question, options: options || [], verdict: null }
  }
```

- Remove `handleCheckResult` (function, its `case 'check_result':` line in `sendMessageStreaming`, and its entry in the returned object) — the stream no longer emits `check_result`.

- Add the `answerCheck` action:

```js
  async function answerCheck(index) {
    const id = currentSessionId.value
    if (!id || !pendingCheck.value) return
    const resp = await sessionsApi.answerCheck(id, index)
    pendingCheck.value = {
      ...pendingCheck.value,
      verdict: resp.correct,
      selectedIndex: index,
      explanation: resp.explanation,
      correctIndex: resp.correct_index,
    }
  }
```

- Export `answerCheck` in the returned object; remove `handleCheckResult` from it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- --run sessionCheckFlow` (from `frontend/`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/sessionsApi.js frontend/src/stores/session.js frontend/src/__tests__/sessionCheckFlow.test.js
git commit -m "feat(fe-store): answerCheck action + options; drop check_result"
```

---

## Task 10: `CheckQuestion.vue` — clickable options + verdict

**Files:**
- Modify: `frontend/src/components/chat/CheckQuestion.vue`
- Modify: `frontend/src/views/SessionView.vue` (wire `@answer`)
- Test: `frontend/src/__tests__/checkQuestion.test.js`

- [ ] **Step 1: Write the failing test**

Replace the body of `frontend/src/__tests__/checkQuestion.test.js` with tests for the MC card:

```js
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CheckQuestion from '../components/chat/CheckQuestion.vue'

const base = {
  gap: 'atp', question: 'Net ATP per glucose?',
  options: ['2 ATP', '36 ATP', '0 ATP'], verdict: null,
}

describe('CheckQuestion (multiple choice)', () => {
  it('renders one button per option while unanswered', () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    const opts = w.findAll('[data-testid="check-option"]')
    expect(opts).toHaveLength(3)
  })

  it('emits answer with the clicked index', async () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    await w.findAll('[data-testid="check-option"]')[1].trigger('click')
    expect(w.emitted('answer')[0]).toEqual([1])
  })

  it('after answering: disables options, shows verdict + explanation', () => {
    const w = mount(CheckQuestion, {
      props: { check: { ...base, verdict: true, selectedIndex: 0, correctIndex: 0, explanation: 'Net 2 ATP.' } },
    })
    expect(w.find('[data-testid="check-verdict"]').text()).toContain('Correct')
    expect(w.text()).toContain('Net 2 ATP.')
    expect(w.findAll('[data-testid="check-option"]')[0].attributes('disabled')).toBeDefined()
  })

  it('emits skip when skip is clicked', async () => {
    const w = mount(CheckQuestion, { props: { check: { ...base } } })
    await w.find('[data-testid="check-skip"]').trigger('click')
    expect(w.emitted('skip')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --run checkQuestion` (from `frontend/`)
Expected: FAIL (no option buttons rendered).

- [ ] **Step 3: Rewrite `CheckQuestion.vue`**

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  // { gap, question, options, verdict: boolean|null, selectedIndex?, correctIndex?, explanation? }
  check: { type: Object, required: true },
})
const emit = defineEmits(['answer', 'skip'])

const answered = computed(() => props.check.verdict !== null)
const correct = computed(() => props.check.verdict === true)

function optionClass(i) {
  if (!answered.value) return ''
  if (i === props.check.correctIndex) return 'is-correct'
  if (i === props.check.selectedIndex) return 'is-incorrect'
  return ''
}
</script>

<template>
  <section
    class="check-card"
    :class="{ answered, correct, incorrect: answered && !correct }"
    data-testid="check-card"
  >
    <span class="check-eyebrow">Check question</span>
    <p class="check-question">{{ check.question }}</p>

    <ul class="check-options">
      <li v-for="(opt, i) in check.options" :key="i">
        <button
          type="button"
          class="check-option"
          :class="optionClass(i)"
          data-testid="check-option"
          :disabled="answered"
          @click="emit('answer', i)"
        >
          {{ opt }}
        </button>
      </li>
    </ul>

    <div v-if="answered" class="check-verdict" data-testid="check-verdict">
      {{ correct ? 'Correct' : 'Not quite' }}
    </div>
    <p v-if="answered && check.explanation" class="check-explanation">
      {{ check.explanation }}
    </p>

    <button
      v-if="!answered"
      type="button"
      class="check-skip"
      data-testid="check-skip"
      @click="emit('skip')"
    >
      Skip this question
    </button>
  </section>
</template>

<style scoped>
.check-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.125rem;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: var(--color-accent-soft);
}
.check-eyebrow {
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}
.check-question {
  margin: 0;
  font-weight: 600;
  color: var(--color-text);
}
.check-options {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.check-option {
  width: 100%;
  text-align: left;
  background: var(--color-surface, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 0.6rem);
  padding: 0.6rem 0.85rem;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.check-option:not(:disabled):hover,
.check-option:not(:disabled):focus-visible {
  border-color: var(--color-accent);
  outline: none;
}
.check-option:disabled {
  cursor: default;
}
.check-option.is-correct {
  border-color: var(--signal-success, #2e7d32);
  background: color-mix(in srgb, var(--signal-success, #2e7d32) 14%, transparent);
}
.check-option.is-incorrect {
  border-color: var(--signal-warning, #b26a00);
  background: color-mix(in srgb, var(--signal-warning, #b26a00) 14%, transparent);
}
.check-skip {
  align-self: flex-start;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.35rem 0.9rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  cursor: pointer;
}
.check-skip:hover,
.check-skip:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent);
  outline: none;
}
.check-verdict {
  font-weight: 600;
}
.check-explanation {
  margin: 0;
  color: var(--color-text-muted);
}
.check-card.correct {
  border-color: var(--signal-success, #2e7d32);
}
.check-card.incorrect {
  border-color: var(--signal-warning, #b26a00);
}
</style>
```

- [ ] **Step 4: Wire `@answer` in `SessionView.vue`**

In `frontend/src/views/SessionView.vue`, on the `<CheckQuestion>` element (~67-70) add `@answer="onAnswerCheck"`. In the script, add:

```js
async function onAnswerCheck(index) {
  await store.answerCheck(index)
}
```

(Keep the existing `onSkipCheck`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- --run checkQuestion` (from `frontend/`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/CheckQuestion.vue frontend/src/views/SessionView.vue frontend/src/__tests__/checkQuestion.test.js
git commit -m "feat(fe): clickable multiple-choice check-question card"
```

---

## Task 11: Composer copy + full suites

**Files:**
- Modify: composer placeholder string (locate via grep)
- Test: full backend + frontend suites

- [ ] **Step 1: Update the locked-composer placeholder copy**

Run: `grep -rn "Answer the question, or Skip" frontend/src`
Change the locked-state placeholder to `"Pick an answer above, or Skip..."` (it no longer makes sense to type an answer). If the string is built from a prop/computed, update at the source. This is copy-only; no test change required unless a test asserts the old string — update it if so.

- [ ] **Step 2: Full backend suite**

Run: `pytest -q` (from `backend/`)
Expected: PASS, coverage gate holds.

- [ ] **Step 3: Full frontend suite**

Run: `npm run test:unit -- --run` (from `frontend/`)
Expected: PASS.

- [ ] **Step 4: Lint/format frontend**

Run: `npm run lint` (from `frontend/`)
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: composer copy for MC checks; full suites green"
```

---

## Task 12: Live smoke (Chrome, real LLM)

**Files:** none (manual verification)

- [ ] **Step 1: Start the stack** (frontend 5173, backend 8000 — already running in this environment; otherwise `docker compose up`).

- [ ] **Step 2: Open a session, prompt for a check** — e.g. "Quiz me on glycolysis." Confirm the card now renders **clickable option buttons** (not "A) ... B) ..." inline text), and the composer is locked with a Skip button.

- [ ] **Step 3: Click a correct option.** Confirm: card flips to "Correct" + explanation inline, options disabled, correct option highlighted green, composer unlocks. No ~10s LLM grading turn.

- [ ] **Step 4: Click a wrong option (new question).** Confirm "Not quite", wrong pick amber, correct option green.

- [ ] **Step 5: Verify the profile channel.** Send a follow-up message; confirm in the tutor's behavior / ProfileView that a correctly-answered gap appears in mastered_concepts and a wrong answer on a previously-mastered concept demoted it.

- [ ] **Step 6: Skip path.** Open another check, click Skip; confirm the card clears and the composer unlocks.

- [x] **Step 7: Record the smoke result** in the plan (check the boxes) and note any defects as follow-up tasks.

### Live smoke result (2026-06-04, Chrome, real LLM — PASS)

Driven against the running stack (frontend :5173, backend :8000), session topic "Glycolysis":
- **Card renders:** prompting "Quiz me with one multiple-choice check question" produced a CHECK QUESTION card with 4 clickable option buttons (0/1/2/4 ATP), NOT inline "A)... B)..." text. Composer locked with the new placeholder "Pick an answer above, or Skip..." + Skip button.
- **Correct click:** clicked "2 ATP" -> option highlighted green, verdict "Correct", explanation rendered inline, composer unlocked. Grade was instant (deterministic; no ~10s LLM grading turn).
- **Incorrect click:** new question ("net products of glycolysis"); clicked the wrong option ("6 CO2 and 6 H2O") -> wrong pick amber, correct option ("2 pyruvate, 2 ATP, and 2 NADH") green, verdict "Not quite" + explanation.
- **Profile channel:** the aggregate Learning Profile then showed "Glycolysis net ATP yield" in Mastered concepts (MASTERED 3, EVENTS 6) — i.e. the correctly-answered gap was promoted server-side via record_from_answer.
- **Skip path:** opened a third question, clicked "Skip this question" -> card cleared, composer unlocked.

No defects found. Feature is live-verified end to end. (Smoke session: topic "Glycolysis", session 7da17332.)

---

## Self-Review notes

- **Spec coverage:** contract (T1), anti-cheat public_view (T2), record_from_answer both effects (T3), drop guard (T4), answer endpoint (T5), tool removal + MC ask (T6), prompts (T7), stream events (T8), store/api (T9), card UI (T10), copy + suites (T11), live smoke (T12). All spec sections mapped.
- **Type consistency:** `record_from_answer(db, session_id, gap, question, correct)` used identically in T3/T5; store fields `verdict/selectedIndex/explanation/correctIndex` consistent across T9/T10; `correct_index` (snake) on the wire, `correctIndex` (camel) in the store/component.
- **No DB migration** (JSON column).
