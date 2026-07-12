"""Task 13: Tests for POST /api/chat/stream (SSE).

These tests are written FIRST (TDD). They will fail until the route is implemented.

Setup mirrors test_chat.py exactly: uses the `client` and `db_session` fixtures
from conftest.py, seeds a SessionModel, and patches tutor.run_streaming at the
module level so _prepare_turn still runs for real (cost/rate checks, session
lookup, user-message persistence).

Auth note: the _AuthInjectingClient shim only intercepts `.request()`, NOT
`.stream()`. For streaming tests we pass `Authorization: Bearer test-<user_id>`
explicitly in headers and omit `user_id` from the JSON body (ChatRequest has
extra="forbid" so extra fields cause 422).

Disconnect/cancellation note
-----------------------------
The sync Starlette TestClient does not reliably trigger `request.is_disconnected()`
under ASGI test transport - there is no network layer to disconnect. Attempting to
force a network-level disconnect test produces flaky/non-deterministic results.

Instead, we test the cancellation WIRING via a focused unit test: a fake
run_streaming that yields a `cancelled` terminal event (simulating what the real
agent yields after asyncio.CancelledError) confirms that the stream terminates
cleanly after that event and does not hang. True network-disconnect cancellation
(the `await request.is_disconnected()` guard path) is verified manually against
a running server; it is not reliably testable under TestClient.
"""

import pytest
from contracts import TopicProfile
from db.models import Session as SessionModel, User
from agent.stream_events import StreamEvent
from services import summary_service


SESSION_ID = "stream-s1"
USER_ID = "stream-u1"
AUTH_HEADERS = {"Authorization": f"Bearer test-{USER_ID}"}


@pytest.fixture(autouse=True)
def seed_session(db_session):
    db_session.add(User(id=USER_ID))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()


def _make_fake_run_streaming(*events):
    """Return an async generator function that yields the given StreamEvent objects."""
    async def fake(messages, system_prompt, ctx):
        for event in events:
            yield event
    return fake


# ---------------------------------------------------------------------------
# Test: content-type
# ---------------------------------------------------------------------------


def test_chat_stream_content_type(client, monkeypatch):
    """POST /api/chat/stream returns 200 with text/event-stream content-type."""
    fake = _make_fake_run_streaming(
        StreamEvent("assistant_delta", {"text": "Hi"}),
        StreamEvent("done", {"message_id": "1"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        ct = resp.headers.get("content-type", "")
        assert ct.startswith("text/event-stream")


# ---------------------------------------------------------------------------
# Test: delta then done events appear in order
# ---------------------------------------------------------------------------


def test_chat_stream_emits_delta_then_done(client, monkeypatch):
    """Stream body contains event: assistant_delta before event: done."""
    fake = _make_fake_run_streaming(
        StreamEvent("assistant_delta", {"text": "Hi"}),
        StreamEvent("done", {"message_id": "42"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    lines = []
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            lines.append(line)

    body = "\n".join(lines)
    delta_pos = body.find("event: assistant_delta")
    done_pos = body.find("event: done")
    assert delta_pos != -1, "expected event: assistant_delta in stream"
    assert done_pos != -1, "expected event: done in stream"
    assert delta_pos < done_pos, "assistant_delta must precede done"


# ---------------------------------------------------------------------------
# Test: unknown session -> 404 (pre-flight guard applies to stream route)
# ---------------------------------------------------------------------------


def test_chat_stream_unknown_session_404(client, monkeypatch):
    """_prepare_turn raises 404 before StreamingResponse is returned.
    HTTPException propagates as a normal 404 JSON response."""
    fake = _make_fake_run_streaming(
        StreamEvent("done", {"message_id": "1"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    r = client.post(
        "/api/chat/stream",
        json={"session_id": "does-not-exist", "message": "x"},
        headers=AUTH_HEADERS,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Test: cancellation wiring - cancelled terminal event ends the stream cleanly
# ---------------------------------------------------------------------------


def test_chat_stream_cancelled_event_terminates_stream(client, monkeypatch):
    """When run_streaming yields a 'cancelled' terminal event, the stream
    terminates without hanging or emitting further events.

    This verifies the cancellation-wiring logic (the `if event.type in
    ('done', 'error', 'cancelled'): break` guard in event_stream). It does NOT
    test the network-disconnect path (request.is_disconnected()), which is not
    reliably exercisable under the sync TestClient ASGI transport.
    """
    fake = _make_fake_run_streaming(
        StreamEvent("assistant_delta", {"text": "partial"}),
        StreamEvent(
            "cancelled",
            {"message_id": "99", "partial_content_chars": 7, "estimated_cost_usd": "0"},
        ),
        # Any event after cancelled must NOT appear in the stream output.
        StreamEvent("assistant_delta", {"text": "should not appear"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    lines = []
    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            lines.append(line)

    body = "\n".join(lines)
    assert "event: cancelled" in body
    assert "should not appear" not in body


def test_chat_stream_includes_quiz_readiness(client, db_session, monkeypatch):
    from services import check_question_service
    check_question_service.set_quiz_cooldown(
        db_session, SESSION_ID, {"gap": "joins", "last_score": "0/1", "missed": ["q0"]}
    )

    captured = {}

    async def fake(messages, system_prompt, ctx):
        captured["system_prompt"] = system_prompt
        yield StreamEvent("done", {"message_id": "1"})

    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    with client.stream(
        "POST", "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for _ in resp.iter_lines():
            pass

    # Assert on the session-specific rendered QUIZ_READINESS line, not the bare
    # word "cooling_down" (which also appears in the immutable POST-QUIZ PROTOCOL
    # prose). "gap": "joins" can only come from threading this turn's cooldown.
    sp = captured["system_prompt"]
    assert '"gap": "joins"' in sp
    assert '"status": "cooling_down"' in sp


# ---------------------------------------------------------------------------
# Test: post-stream rolling summary trigger (Task 5, P2 AC3)
# ---------------------------------------------------------------------------


def test_stream_schedules_rolling_summary(client, monkeypatch):
    """The stream response attaches a BackgroundTask that calls
    summary_service.update_rolling_summary(db, session_id) after the SSE
    body is fully consumed. TestClient runs background tasks once the
    response completes, so a synchronous .post() (which reads the full
    body) is enough to observe the call."""
    fake = _make_fake_run_streaming(
        StreamEvent("assistant_delta", {"text": "Hi"}),
        StreamEvent("done", {"message_id": "1"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    calls = []

    async def fake_update(db, session_id):
        calls.append(session_id)
        return None

    monkeypatch.setattr(summary_service, "update_rolling_summary", fake_update)

    resp = client.post(
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    _ = resp.text  # drain the SSE body; TestClient runs background tasks after

    assert calls == [SESSION_ID]


def test_semantic_fallback_escalates_gate(client, monkeypatch):
    """D2.2: lexical gate is False (default empty kw_index_json), so the
    semantic fallback runs and its True result escalates retrieval_required
    all the way through to _build_prompt_state."""
    message = "hello"
    calls = {}

    def fake_fallback(db, session_id, query):
        calls["args"] = (session_id, query)
        return True

    monkeypatch.setattr(
        "routes.chat.retrieval_service.semantic_fallback_required", fake_fallback
    )

    captured = {}
    import routes.chat as chat_module

    real_build = chat_module._build_prompt_state

    def spy_build(**kwargs):
        captured["retrieval_required"] = kwargs.get("retrieval_required")
        return real_build(**kwargs)

    monkeypatch.setattr(chat_module, "_build_prompt_state", spy_build)

    fake = _make_fake_run_streaming(StreamEvent("done", {"message_id": "1"}))
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": message},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for _ in resp.iter_lines():
            pass

    assert calls["args"] == (SESSION_ID, message)
    assert captured["retrieval_required"] is True


def test_semantic_fallback_not_called_when_lexical_gate_true(client, db_session, monkeypatch):
    """D2.2: when the lexical gate already matches, the semantic fallback
    must never run. A raising stub proves the OPTIONAL-only escalation
    path (the `if not retrieval_required:` guard) is respected."""
    import json

    from lib import keyword_index

    message = "explain foreign keys"
    stems = keyword_index.build_from_text(message)
    session = db_session.get(SessionModel, SESSION_ID)
    session.kw_index_json = json.dumps(sorted(stems))
    db_session.commit()

    def fail_if_called(db, session_id, query):
        raise AssertionError("fallback must not run when lexical gate is True")

    monkeypatch.setattr(
        "routes.chat.retrieval_service.semantic_fallback_required", fail_if_called
    )

    fake = _make_fake_run_streaming(StreamEvent("done", {"message_id": "1"}))
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    with client.stream(
        "POST",
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": message},
        headers=AUTH_HEADERS,
    ) as resp:
        assert resp.status_code == 200
        for _ in resp.iter_lines():
            pass


def test_stream_rolling_summary_failure_does_not_break_turn(client, monkeypatch):
    """A raising update_rolling_summary must not surface to the client: the
    chat turn already completed and sent its response before the background
    task runs. The helper's try/except/finally is what's under test here."""
    fake = _make_fake_run_streaming(
        StreamEvent("assistant_delta", {"text": "Hi"}),
        StreamEvent("done", {"message_id": "1"}),
    )
    monkeypatch.setattr("agent.tutor.run_streaming", fake)

    async def fake_update_raises(db, session_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(summary_service, "update_rolling_summary", fake_update_raises)

    resp = client.post(
        "/api/chat/stream",
        json={"session_id": SESSION_ID, "message": "hello"},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.text  # drain the SSE body; background task raises after this
    assert "event: done" in body
