"""
Sliding-window rate limiting for sensitive endpoints (NFR-SEC-02).

Why these two endpoints:
- /auth/login     slows credential stuffing: the window is keyed by
  client IP *and* email, so one account cannot be brute-forced without
  tripping the limit, and other accounts behind the same NAT are unaffected.
- /face/verify    caps the face-detection compute per candidate (the interview
  legitimately calls it about once per second, so the default budget leaves
  generous headroom for retries and tab restores).

Storage is in-memory and per-process, which matches the single-worker uvicorn
setup this app runs with. If the API is ever scaled horizontally, swap the
singleton for a shared store (e.g. Redis) - the call sites stay the same.

A limit of 0 (or less) disables that check.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from fastapi import HTTPException

# Drop a key from the map once it has been idle this long (seconds)
_STALE_KEY_SECONDS = 3600
# Prune opportunistically only when the map grows large enough to matter
_PRUNE_AT_KEYS = 10_000


class RateLimiter:
    """Thread-safe sliding-window counter (sync endpoints run in a threadpool)."""

    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: float) -> Tuple[bool, float]:
        """
        Record one hit for `key`.

        Returns (allowed, retry_after_seconds); retry_after is 0 while allowed
        and the wait until the oldest hit leaves the window once blocked.
        """
        if limit <= 0:
            return True, 0.0
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(hits[0] + window_seconds - now) + 1)
                return False, float(retry_after)
            hits.append(now)
            if len(self._hits) > _PRUNE_AT_KEYS:
                self._prune(now)
            return True, 0.0

    def _prune(self, now: float) -> None:
        """Forget keys whose whole window has elapsed (called under lock)."""
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or now - hits[-1] > _STALE_KEY_SECONDS
        ]
        for key in stale:
            del self._hits[key]

    def reset(self) -> None:
        """Clear all counters (used by tests)."""
        with self._lock:
            self._hits.clear()


# Process-wide singleton used by the API routes
limiter = RateLimiter()


def enforce_rate_limit(scope: str, key: str, limit: int, window_seconds: int) -> None:
    """
    Record a hit and raise 429 with a Retry-After header when over budget.

    Call at the top of the endpoint body, before doing expensive work.
    """
    allowed, retry_after = limiter.check(key, limit, float(window_seconds))
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many {scope} attempts - try again in "
                f"{int(retry_after)} seconds"
            ),
            headers={"Retry-After": str(int(retry_after))},
        )
