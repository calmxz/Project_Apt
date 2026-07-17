"""Guards the CORS allow-list.

Profile edits (WS-E) send a custom `If-Match` request header. Browsers issue a
CORS preflight for that header before every PATCH/DELETE; if the server does not
list `If-Match` in allow_headers the browser blocks the request and the write
never reaches the API. TestClient and mocked-fetch tests do not exercise a real
preflight, so this asserts the middleware config directly.
"""

from starlette.middleware.cors import CORSMiddleware

from main import app


def _cors_options():
    for mw in app.user_middleware:
        if mw.cls is CORSMiddleware:
            return mw.kwargs
    raise AssertionError("CORSMiddleware is not configured")


def test_cors_allows_if_match_header():
    assert "If-Match" in _cors_options()["allow_headers"]


def test_cors_allows_patch_and_delete_methods():
    methods = _cors_options()["allow_methods"]
    assert "PATCH" in methods
    assert "DELETE" in methods
