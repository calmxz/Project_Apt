import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, Request, status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main as main_module
from db.database import Base, get_db
from main import app
from services.auth import current_user_id


def _fake_current_user_id(request: Request) -> str:
    """Test convention: `Authorization: Bearer test-<userid>` resolves to <userid>.

    If no header is present, returns "test-user" as a default so existing tests
    that don't yet send a bearer token keep working until they're migrated.
    """
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return "test-user"
    token = auth.split(None, 1)[1].strip()
    if token.startswith("test-"):
        return token[len("test-"):]
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token"
    )


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db_session, monkeypatch):
    test_engine = db_session.get_bind()

    monkeypatch.setattr(main_module, "create_tables", lambda: Base.metadata.create_all(bind=test_engine))

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user_id] = _fake_current_user_id
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _text(content: str) -> SimpleNamespace:
    """Build a fake LiteLLM completion response with a plain text reply."""
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=None)
            )
        ]
    )


def _tool_call(name: str, args: dict[str, Any], tool_call_id: str = "tc_1") -> SimpleNamespace:
    """Build a fake LiteLLM completion response with a single tool call."""
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    tool_calls=[
                        SimpleNamespace(
                            id=tool_call_id,
                            type="function",
                            function=SimpleNamespace(
                                name=name,
                                arguments=json.dumps(args),
                            ),
                        )
                    ],
                )
            )
        ]
    )


@pytest.fixture
def mock_litellm(monkeypatch):
    """Scriptable response queue. Append SimpleNamespace items via _text/_tool_call.
    Empty queue returns a default text response so existing tests keep working."""
    queue: list[Any] = []

    async def fake_acompletion(**kwargs):
        if not queue:
            return _text("This is a mocked tutor response.")
        return queue.pop(0)

    monkeypatch.setattr("agent.tutor.litellm.acompletion", fake_acompletion)
    return queue


@pytest.fixture
def llm_text():
    """Helper exposed for tests to build text responses."""
    return _text


@pytest.fixture
def llm_tool_call():
    """Helper exposed for tests to build tool-call responses."""
    return _tool_call
