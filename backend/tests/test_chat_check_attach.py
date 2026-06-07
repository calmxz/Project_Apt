"""TDD: non-streaming /chat attaches message_id to pending_check when a
check-question batch is asked.

Part A of the check-recap fix: without this, write_check_batch no-ops because
message_id stays None, the recap card always shows selected_index=None.

Covers:
  A1/A2 - failing test that asserts message_id is attached after /chat
  A3/A4 - passes after the fix in routes/chat.py
  A5    - end-to-end: wrong answer -> resolve -> GET /sessions confirms
           selected_index and correct are preserved in check_batch
"""

import pytest

from contracts import AskCheckQuestionsArgs, TopicProfile, ToolCallRecord
from db.models import ChatMessage, Session as SessionModel, User
from services import check_question_service


# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

USER_ID = "u_chat_check"
SESSION_ID = "s_chat_check"
AUTH_HEADERS = {"Authorization": f"Bearer test-{USER_ID}"}


# ---------------------------------------------------------------------------
# Fixture: seed a user + session
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def seed_session(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="algebra",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()


# ---------------------------------------------------------------------------
# Fake tutor.run that registers a check batch and returns the right shape
# ---------------------------------------------------------------------------


def _make_fake_run_asking(db_session):
    """Fake tutor.run: registers a check batch via check_question_service,
    then returns (reply, tool_calls, citations) shaped like the real function.

    The db_session passed here is the same one the route uses (same engine via
    override_get_db), so the pending_check row is visible after the call.
    """

    async def fake_run(messages, system_prompt, ctx):
        # Register the batch using the same ctx the route built (same db/session_id).
        check_question_service.register(
            ctx.db,
            ctx,
            AskCheckQuestionsArgs(
                session_id=ctx.session_id,
                gap="linear_algebra",
                items=[
                    {
                        "question": "What is 2+2?",
                        "options": ["3", "4"],
                        "correct_index": 1,
                        "explanation": "2+2=4",
                    }
                ],
            ),
        )
        tool_call = ToolCallRecord(
            name="ask_check_questions",
            args={
                "session_id": ctx.session_id,
                "gap": "linear_algebra",
                "items": [
                    {
                        "question": "What is 2+2?",
                        "options": ["3", "4"],
                        "correct_index": 1,
                        "explanation": "2+2=4",
                    }
                ],
            },
            status="ok",
            error=None,
        )
        return ("What is 2+2?", [tool_call], [])

    return fake_run


# ---------------------------------------------------------------------------
# Step A1/A2: failing test - message_id attached after non-streaming /chat
# ---------------------------------------------------------------------------


def test_chat_check_attach_message_id(client, db_session, monkeypatch):
    """After a non-streaming /chat turn that asks a check question, the open
    pending_check must have message_id set to the persisted assistant message id.

    Without the fix this fails because chat.py never calls attach_message_id.
    """
    monkeypatch.setattr("agent.tutor.run", _make_fake_run_asking(db_session))

    resp = client.post(
        "/api/chat",
        json={"session_id": SESSION_ID, "message": "quiz me"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    response_msg_id = resp.json()["message_id"]

    pc = check_question_service.get_pending_check(db_session, SESSION_ID)
    assert pc is not None, "pending_check should be set after ask"
    assert pc["message_id"] is not None, (
        "message_id must be attached to the pending_check by the non-streaming /chat route"
    )
    assert pc["message_id"] == response_msg_id, (
        f"message_id in pending_check ({pc['message_id']}) must equal "
        f"the assistant message id returned by /chat ({response_msg_id})"
    )


# ---------------------------------------------------------------------------
# Step A5: end-to-end bug regression - wrong pick persisted in check_batch
# ---------------------------------------------------------------------------


def test_chat_check_wrong_pick_persists_in_recap(client, db_session, monkeypatch):
    """Full flow: ask (via /chat) -> answer wrong -> complete -> GET /sessions
    shows selected_index != None and correct=False.

    Before the fix, message_id was None so write_check_batch no-oped.
    reconstruct_check_batch (fallback) sets selected_index=None.
    After the fix, message_id is set, write_check_batch persists the real pick.
    """
    # 1. Ask a check question via the non-streaming /chat route.
    monkeypatch.setattr("agent.tutor.run", _make_fake_run_asking(db_session))

    ask_resp = client.post(
        "/api/chat",
        json={"session_id": SESSION_ID, "message": "quiz me"},
        headers=AUTH_HEADERS,
    )
    assert ask_resp.status_code == 200
    asking_msg_id = ask_resp.json()["message_id"]

    # Confirm the fix: message_id is now attached.
    pc_after_ask = check_question_service.get_pending_check(db_session, SESSION_ID)
    assert pc_after_ask is not None
    assert pc_after_ask["message_id"] == asking_msg_id

    # 2. Answer wrong: correct_index=1, we submit selected_index=0.
    answer_resp = client.post(
        f"/api/sessions/{SESSION_ID}/check/answer",
        json={"index": 0, "selected_index": 0},
        headers=AUTH_HEADERS,
    )
    assert answer_resp.status_code == 200
    answer_data = answer_resp.json()
    assert answer_data["correct"] is False

    # 3. Complete the batch (hidden follow-up stream). Patch run_streaming to
    #    avoid real LLM while still exercising write_check_batch.
    from agent.stream_events import StreamEvent

    async def fake_run_streaming(messages, system_prompt, ctx):
        msg = ChatMessage(session_id=SESSION_ID, role="assistant", content="Better luck!")
        ctx.db.add(msg)
        ctx.db.commit()
        yield StreamEvent("assistant_delta", {"text": "Better luck!"})
        yield StreamEvent("done", {"message_id": str(msg.id)})

    monkeypatch.setattr("agent.tutor.run_streaming", fake_run_streaming)

    complete_resp = client.post(
        f"/api/sessions/{SESSION_ID}/check/complete",
        headers=AUTH_HEADERS,
    )
    assert complete_resp.status_code == 200

    # 4. GET /sessions/{sid} and check the asking message's check_batch.
    session_resp = client.get(
        f"/api/sessions/{SESSION_ID}",
        headers=AUTH_HEADERS,
    )
    assert session_resp.status_code == 200
    messages = session_resp.json()["messages"]

    # Find the asking assistant message by id.
    asking_msg = next((m for m in messages if m["id"] == asking_msg_id), None)
    assert asking_msg is not None, f"asking message {asking_msg_id} not found in session messages"

    check_batch = asking_msg.get("check_batch")
    assert check_batch is not None, (
        "check_batch must be set on the asking message after the batch resolves"
    )
    items = check_batch.get("items", [])
    assert len(items) == 1
    item = items[0]
    assert item["selected_index"] is not None, (
        "selected_index must be persisted (not None) after the fix - "
        "before fix it was None because write_check_batch was a no-op"
    )
    assert item["selected_index"] == 0, (
        f"wrong pick (0) must be stored; got {item['selected_index']}"
    )
    assert item["correct"] is False, (
        f"correct must be False for the wrong answer; got {item['correct']}"
    )


def _make_fake_run_failed_ask(prior_msg_id_holder):
    """Fake tutor.run: returns a FAILED ask_check_questions ToolCallRecord.

    Does NOT call check_question_service.register (no open batch is created
    by this turn). Used to verify that a name-only gate would wrongly repoint
    a prior open batch's message_id to a non-asking message.
    """

    async def fake_run(messages, system_prompt, ctx):
        # A prior batch may be open; this turn's ask FAILED - do not register.
        tool_call = ToolCallRecord(
            name="ask_check_questions",
            args={},
            status="failed",
            error="a check-question batch is already open; resolve it first",
        )
        return ("Please answer the open question first.", [tool_call], [])

    return fake_run


def test_failed_ask_does_not_clobber_prior_batch_message_id(
    client, db_session, monkeypatch
):
    """Gate correctness: a FAILED ask_check_questions must NOT attach the
    current message's id to an already-open pending_check.

    A name-only gate ('ask_check_questions' in tool_calls) would fire even on
    failed asks and repoint the prior batch's message_id to the wrong message.
    The status=='ok' guard in the fix prevents this.

    Flow:
      1. Open a batch manually (prior turn's register).
      2. Monkeypatch tutor.run to return a failed ask ToolCallRecord (no register).
      3. POST /chat.
      4. Assert the prior batch's message_id is unchanged (still the id from
         step 1's attach, or still None if we never attached in the prior turn).
    """
    from datetime import datetime, timezone
    from agent.types import ToolContext

    # 1. Manually register a batch to simulate a prior open batch.
    prior_ctx = ToolContext(
        db=db_session,
        session_id=SESSION_ID,
        user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc),
    )
    check_question_service.register(
        db_session,
        prior_ctx,
        AskCheckQuestionsArgs(
            session_id=SESSION_ID,
            gap="prior_gap",
            items=[
                {
                    "question": "Prior Q?",
                    "options": ["a", "b"],
                    "correct_index": 0,
                    "explanation": "a.",
                }
            ],
        ),
    )
    # Stamp the prior message_id to a known sentinel value (99999) so we can
    # detect whether the gate fires and overwrites it.
    check_question_service.attach_message_id(db_session, SESSION_ID, 99999)

    pc_before = check_question_service.get_pending_check(db_session, SESSION_ID)
    assert pc_before["message_id"] == 99999

    # 2. POST /chat with a failed ask turn.
    monkeypatch.setattr("agent.tutor.run", _make_fake_run_failed_ask({}))

    resp = client.post(
        "/api/chat",
        json={"session_id": SESSION_ID, "message": "quiz me again"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    new_msg_id = resp.json()["message_id"]
    assert new_msg_id != 99999  # the new message should have a different id

    # 4. The prior batch's message_id must still be 99999 (not clobbered).
    pc_after = check_question_service.get_pending_check(db_session, SESSION_ID)
    assert pc_after is not None
    assert pc_after["message_id"] == 99999, (
        f"Failed ask must NOT repoint the prior batch's message_id "
        f"(got {pc_after['message_id']!r}, expected 99999). "
        "The gate must check status=='ok', not name only."
    )
