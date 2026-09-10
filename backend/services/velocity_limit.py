"""B-07: per-user burst limiter for paid endpoints.

Sliding 60 s window per user_id, in process memory. Correct for the current
deployment (one Render instance, one uvicorn worker; see entrypoint.sh and
main.py's in-process ingest loop which make the same assumption). If the
API is ever scaled to multiple processes, move the window to Postgres or a
shared cache before raising --workers.

Complements, does not replace, rate_limit.check_and_increment (daily cap):
that bounds spend per day; this bounds how fast the day's budget can be
burned so a leaked token or a runaway client cannot fire 50 LLM turns in
one second.
"""

import math
import threading
import time
from collections import deque

from fastapi import Depends, HTTPException

from config import settings
from lib.error_codes import TOO_MANY_REQUESTS
from services.auth import current_user_id

WINDOW_S = 60.0
_SWEEP_THRESHOLD = 1000

_lock = threading.Lock()
_hits: dict[str, deque[float]] = {}


def reset() -> None:
    """Test hook: drop all state."""
    with _lock:
        _hits.clear()


def check(user_id: str, now: float | None = None) -> int | None:
    """Record one hit for user_id. Return None if allowed, else the number of
    whole seconds until the oldest in-window hit expires (>= 1)."""
    limit = settings.burst_limit_per_minute
    if limit <= 0:
        return None
    t = time.monotonic() if now is None else now
    with _lock:
        q = _hits.setdefault(user_id, deque())
        while q and t - q[0] >= WINDOW_S:
            q.popleft()
        if len(q) >= limit:
            retry = WINDOW_S - (t - q[0])
            return max(1, math.ceil(retry))
        q.append(t)
        if len(_hits) > _SWEEP_THRESHOLD:
            _sweep(t)
        return None


def _sweep(now: float) -> None:
    """Drop entries whose deque is fully expired against `now`. Caller must
    hold _lock. Keeps idle users from lingering in memory forever."""
    stale = []
    for uid, q in _hits.items():
        while q and now - q[0] >= WINDOW_S:
            q.popleft()
        if not q:
            stale.append(uid)
    for uid in stale:
        del _hits[uid]


def enforce_velocity(user_id: str = Depends(current_user_id)) -> None:
    retry_after = check(user_id)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail={"code": TOO_MANY_REQUESTS, "retry_after_s": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
