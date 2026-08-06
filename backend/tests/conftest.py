import os

# Q-01: must run before anything imports `config`, or the real .env loads
# into the test process. Do not move below the imports.
os.environ["CRUX_SKIP_DOTENV"] = "1"

import json
from types import SimpleNamespace
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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


class _AuthInjectingClient(TestClient):
    """TestClient shim: any `user_id` field in request body/data/query is
    stripped from the payload and converted to `Authorization: Bearer
    test-<user_id>`. Lets Phase 6-and-earlier tests keep their original
    `user_id="u1"` style without per-file refactors.

    Tests that need to assert auth failure can either: pass
    `headers={"Authorization": "..."}` explicitly (wins over the shim) or
    pass `headers={"Authorization": ""}` to suppress and trigger 401.
    """

    def request(self, method, url, **kw):
        json = kw.get("json")
        data = kw.get("data")
        params = kw.get("params")
        headers = dict(kw.get("headers") or {})

        user_id = None
        if isinstance(json, dict) and "user_id" in json:
            user_id = json["user_id"]
            kw["json"] = {k: v for k, v in json.items() if k != "user_id"}
        if isinstance(data, dict) and "user_id" in data:
            user_id = user_id or data["user_id"]
            kw["data"] = {k: v for k, v in data.items() if k != "user_id"}
        if isinstance(params, dict) and "user_id" in params:
            user_id = user_id or params["user_id"]
            kw["params"] = {k: v for k, v in params.items() if k != "user_id"}

        # Strip user_id from URL-embedded query strings too.
        if isinstance(url, str) and "user_id=" in url:
            parts = urlsplit(url)
            qs = parse_qsl(parts.query, keep_blank_values=True)
            stripped = [(k, v) for (k, v) in qs if k != "user_id"]
            for k, v in qs:
                if k == "user_id":
                    user_id = user_id or v
            url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(stripped), parts.fragment))

        lower_keys = {k.lower() for k in headers}
        if user_id and "authorization" not in lower_keys:
            headers["Authorization"] = f"Bearer test-{user_id}"
        kw["headers"] = headers
        return super().request(method, url, **kw)


@pytest.fixture
def client(db_session, monkeypatch):
    test_engine = db_session.get_bind()

    monkeypatch.setattr(main_module, "create_tables", lambda: Base.metadata.create_all(bind=test_engine))
    monkeypatch.setattr(main_module, "validate_jwks_startup", lambda: None)
    # F-26: lifespan now opens its own SessionLocal() to run the startup
    # reaper. Without this, that session binds to the real (possibly
    # Postgres) engine from db.database instead of the test's isolated
    # in-memory sqlite -- hitting a live database from every client-based
    # test, or erroring on an unmigrated real sqlite file in CI.
    monkeypatch.setattr(
        main_module,
        "SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=test_engine),
    )

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user_id] = _fake_current_user_id
    with _AuthInjectingClient(app) as c:
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
