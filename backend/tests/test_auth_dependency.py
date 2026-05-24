"""Real `current_user_id` dependency tests (Phase 7 T9).

Generates an RSA keypair in-process and patches `services.auth._get_jwks_client`
to return a stub PyJWKClient that vends the corresponding public key. Lets us
exercise the actual `jwt.decode` path (RS256, audience check, exp check) with
zero network access and no Supabase dependency.

Covers the happy path plus the failure modes the dependency must reject:
missing header, malformed scheme, expired, wrong audience, wrong signature,
missing `sub` claim.
"""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from services import auth as auth_module
from services.auth import current_user_id


@pytest.fixture(scope="module")
def rsa_keys() -> dict:
    """One keypair per test module; generation is ~100ms so worth caching."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return {"private_pem": private_pem, "public_key": public_key, "private_key": private_key}


@pytest.fixture(autouse=True)
def patch_jwks_client(monkeypatch, rsa_keys):
    """Stub _get_jwks_client so signing-key lookup returns our test public key.

    Also resets the module-level cache so a prior test's stub doesn't leak.
    """
    auth_module._JWKS_CACHE["client"] = None
    auth_module._JWKS_CACHE["fetched_at"] = 0.0

    class _FakeSigningKey:
        def __init__(self, key):
            self.key = key

    class _FakeJWKSClient:
        def __init__(self, public_key):
            self._public_key = public_key

        def get_signing_key_from_jwt(self, _token):
            return _FakeSigningKey(self._public_key)

    monkeypatch.setattr(
        auth_module,
        "_get_jwks_client",
        lambda: _FakeJWKSClient(rsa_keys["public_key"]),
    )


def _sign(rsa_keys: dict, *, sub: str = "user-123", aud: str = "authenticated",
          exp_offset: int = 3600, extra: dict | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": aud,
        "iat": now,
        "exp": now + exp_offset,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, rsa_keys["private_pem"], algorithm="RS256")


@pytest.fixture
def app() -> FastAPI:
    """Minimal FastAPI app with a single auth-protected route to exercise
    the dependency through the full request lifecycle."""
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user_id: str = Depends(current_user_id)) -> dict:
        return {"user_id": user_id}

    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def test_valid_token_returns_sub(client, rsa_keys):
    token = _sign(rsa_keys, sub="user-abc")
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"user_id": "user-abc"}


def test_missing_authorization_header_returns_401(client):
    r = client.get("/whoami")
    assert r.status_code == 401
    assert r.json()["detail"] == "missing_token"
    assert r.headers.get("www-authenticate") == "Bearer"


def test_non_bearer_scheme_returns_401(client, rsa_keys):
    token = _sign(rsa_keys)
    r = client.get("/whoami", headers={"Authorization": f"Basic {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "missing_token"


def test_empty_bearer_returns_401(client):
    r = client.get("/whoami", headers={"Authorization": "Bearer "})
    assert r.status_code == 401
    assert r.json()["detail"] == "missing_token"


def test_expired_token_returns_401(client, rsa_keys):
    token = _sign(rsa_keys, exp_offset=-60)
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"


def test_wrong_audience_returns_401(client, rsa_keys):
    token = _sign(rsa_keys, aud="some-other-service")
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"


def test_missing_sub_returns_401(client, rsa_keys):
    """Token signs cleanly but has no `sub` claim — must still be rejected."""
    now = int(time.time())
    token = jwt.encode(
        {"aud": "authenticated", "iat": now, "exp": now + 3600},
        rsa_keys["private_pem"],
        algorithm="RS256",
    )
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"


def test_wrong_signature_returns_401(client, rsa_keys):
    """Token signed by an unrelated keypair must fail signature verification."""
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    now = int(time.time())
    token = jwt.encode(
        {"sub": "user-x", "aud": "authenticated", "iat": now, "exp": now + 3600},
        other_pem,
        algorithm="RS256",
    )
    r = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"


def test_malformed_token_returns_401(client):
    r = client.get(
        "/whoami", headers={"Authorization": "Bearer not.a.real.jwt"}
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_token"


def test_auth_not_configured_when_jwks_url_missing(monkeypatch, app, rsa_keys):
    """Restore the real `_get_jwks_client` and clear the URL — dependency
    must raise 500 `auth_not_configured` rather than crash with a None."""
    auth_module._JWKS_CACHE["client"] = None

    real_get = auth_module._get_jwks_client.__wrapped__ if hasattr(
        auth_module._get_jwks_client, "__wrapped__"
    ) else None

    # Re-import the original function (the autouse fixture patched it; undo here).
    import importlib
    fresh = importlib.reload(auth_module)
    monkeypatch.setattr(fresh.settings, "supabase_url", "")
    monkeypatch.setattr(fresh.settings, "supabase_jwks_url_override", "")
    fresh._JWKS_CACHE["client"] = None

    # Re-bind the route to the freshly reloaded dependency, otherwise the
    # original module-level reference still points at the patched stub.
    app2 = FastAPI()

    @app2.get("/whoami")
    def whoami(user_id: str = Depends(fresh.current_user_id)) -> dict:
        return {"user_id": user_id}

    token = _sign(rsa_keys)
    c = TestClient(app2)
    r = c.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 500
    assert r.json()["detail"] == "auth_not_configured"

    # Restore module state for any later tests in the session.
    importlib.reload(auth_module)
