"""#340 "early stop = skip": a chat message sent while a check is in progress
stops the check. The open set's remaining items are graded as skipped and the
learner's turn carries the [check results] line, instead of the batch
lingering (or being frozen silently, as session end does)."""

from datetime import datetime, timezone

import pytest

from agent.stream_events import StreamEvent
from agent.types import ToolContext
from contracts import AskCheckQuestionsArgs, TopicProfile
from db.models import ChatMessage, User
from db.models import Session as SessionModel
from services import check_question_service as cq
from services import pending_check_store as pcs

USER_ID = "u_chat_stop"
SESSION_ID = "s_chat_stop"
AUTH_HEADERS = {"Authorization": f"Bearer test-{USER_ID}"}
LEARNER_TEXT = "stop, can we move on?"


@pytest.fixture(autouse=True)
def seed_session(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(SessionModel(
        id=SESSION_ID, user_id=USER_ID, topic="biology",
        topic_profile_json=TopicProfile(knowledge_level="beginner").model_dump_json(),
    ))
    db_session.commit()


def _ctx(db, suppress=False):
    return ToolContext(
        db=db, session_id=SESSION_ID, user_id=USER_ID,
        turn_started_at=datetime.now(timezone.utc), suppress_check=suppress,
    )


def _register(db, set_index, set_total, gap, suppress=False):
    res = cq.register(db, _ctx(db, suppress), AskCheckQuestionsArgs(
        session_id=SESSION_ID, gap=gap, set_index=set_index, set_total=set_total,
        items=[
            {"question": f"{gap} Q{n}?", "options": ["a", "b"],
             "correct_index": 0, "explanation": "e."}
            for n in range(2)
        ],
    ))
    assert res.ok, res.error


def _send(client, monkeypatch):
    captured = {}

    async def fake(messages, system_prompt, ctx):
        captured["messages"] = messages
        captured["system_prompt"] = system_prompt
        captured["ctx"] = ctx
        msg = ChatMessage(session_id=SESSION_ID, role="assistant", content="Why stop?")
        ctx.db.add(msg)
        ctx.db.commit()
        yield StreamEvent("done", {"message_id": str(msg.id)})

    monkeypatch.setattr("agent.tutor.run_streaming", fake)
    with client.stream(
        "POST", "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": LEARNER_TEXT},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for _ in resp.iter_lines():
            pass
    return captured


def test_chat_mid_set_stops_the_check_and_reports(client, db_session, monkeypatch):
    _register(db_session, 1, 2, "glycolysis")
    cq.answer(db_session, SESSION_ID, 0, 0)

    captured = _send(client, monkeypatch)

    last = captured["messages"][-1]
    assert last["role"] == "user"
    assert last["content"].startswith(
        "[check results] gap=glycolysis: 1/1 correct. learner stopped at set 1 of 2."
    )
    assert "  Q2 skipped." in last["content"]
    assert last["content"].endswith(LEARNER_TEXT)
    # The prompt sees the post-stop state, not the stale open batch.
    assert "PENDING_CHECK: none" in captured["system_prompt"]
    assert '"gap": "glycolysis"' in captured["system_prompt"].split("QUIZ_READINESS:")[1]

    db_session.expire_all()
    assert cq.get_pending_check(db_session, SESSION_ID) is None
    assert pcs.get_current_check(db_session, SESSION_ID) is None
    # Only the learner's own words are persisted, never the synthetic summary.
    user_rows = db_session.query(ChatMessage).filter_by(
        session_id=SESSION_ID, role="user"
    ).all()
    assert [m.content for m in user_rows] == [LEARNER_TEXT]


def test_chat_between_sets_records_where_the_learner_stopped(
    client, db_session, monkeypatch
):
    _register(db_session, 1, 3, "glycolysis")
    cq.answer(db_session, SESSION_ID, 0, 0)
    cq.answer(db_session, SESSION_ID, 1, 0)
    cq.close_set(db_session, SESSION_ID, cq.get_pending_check(db_session, SESSION_ID))

    captured = _send(client, monkeypatch)

    assert captured["messages"][-1]["content"] == (
        f"[check results] learner stopped at set 1 of 3.\n\n{LEARNER_TEXT}"
    )
    db_session.expire_all()
    assert pcs.get_current_check(db_session, SESSION_ID) is None


def test_stop_mid_diagnostic_prompts_from_the_graded_profile(
    client, db_session, monkeypatch
):
    """The stop grades the diagnostic; the same turn must see the new level,
    not the pre-stop row (else DIAGNOSTIC stays REQUIRED and a check posed in
    the reply is mis-tagged diagnostic)."""
    row = db_session.get(SessionModel, SESSION_ID)
    row.topic_profile_json = TopicProfile().model_dump_json()
    db_session.commit()
    ctx = _ctx(db_session)
    ctx.diagnostic_required = True
    assert cq.register(db_session, ctx, AskCheckQuestionsArgs(
        session_id=SESSION_ID, gap="glycolysis", set_index=1, set_total=3,
        items=[{"question": "Q?", "options": ["a", "b"],
                "correct_index": 0, "explanation": "e."}] * 2,
    )).ok
    cq.answer(db_session, SESSION_ID, 0, 0)

    captured = _send(client, monkeypatch)

    assert "DIAGNOSTIC: OFF" in captured["system_prompt"]
    assert captured["ctx"].diagnostic_required is False


def test_chat_without_a_check_is_untouched(client, db_session, monkeypatch):
    captured = _send(client, monkeypatch)
    assert captured["messages"][-1] == {"role": "user", "content": LEARNER_TEXT}
