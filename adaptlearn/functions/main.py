"""AdaptLearn Cloud Functions entry point."""

from firebase_functions import https_fn


@https_fn.on_request()
def health_check(req: https_fn.Request) -> https_fn.Response:
    """Smoke endpoint. Returns ADK version when importable.

    Phase 1 verification target: returns 200 with adk_version populated.
    """
    payload = {"status": "ok", "adk_version": _adk_version()}
    return https_fn.Response(_json(payload), mimetype="application/json")


def _adk_version() -> str:
    try:
        from importlib.metadata import version

        return version("google-adk")
    except Exception:
        return "unavailable"


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj)
