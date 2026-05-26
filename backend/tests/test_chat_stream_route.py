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
