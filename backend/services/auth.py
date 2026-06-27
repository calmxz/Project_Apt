"""Supabase JWT verification + FastAPI auth dependency.

JWKS is fetched lazily from `settings.supabase_jwks_url` on first verify call
and cached in-process. Tokens are validated against the cached keys; on
unknown `kid`, JWKS is refetched once before failing.

For tests that don't want to hit Supabase, override the `current_user_id`
dependency on `app.dependency_overrides`.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient

from config import settings


_JWKS_CACHE: dict[str, Any] = {"client": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 60 * 60  # refresh hourly


def _get_jwks_client() -> PyJWKClient:
    now = time.time()
    if (
        _JWKS_CACHE["client"] is None
        or now - _JWKS_CACHE["fetched_at"] > _JWKS_TTL_SECONDS
    ):
        if not settings.supabase_jwks_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="auth_not_configured",
            )
        _JWKS_CACHE["client"] = PyJWKClient(settings.supabase_jwks_url)
        _JWKS_CACHE["fetched_at"] = now
    return _JWKS_CACHE["client"]


def verify_supabase_jwt(token: str) -> str:
    """Return the Supabase user id (`sub`) for a valid JWT, else raise 401."""
    try:
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            options={"verify_aud": True, "verify_exp": True, "verify_iss": True},
        )
    except (jwt.InvalidTokenError, httpx.HTTPError, KeyError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        ) from e
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
        )
    return sub


def current_user_id(request: Request) -> str:
    """FastAPI dependency: extract bearer token, verify, return user id.

    Routes use `user_id: str = Depends(current_user_id)` instead of accepting
    `user_id` from the request body or form.
    """
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # `auth[7:]` skips the "Bearer " prefix matched above; safer than split
    # because `"Bearer "` (trailing space, no token) returns "" cleanly,
    # whereas split(None, 1)[1] raises IndexError on whitespace-only suffix.
    token = auth[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_token",
        )
    return verify_supabase_jwt(token)
