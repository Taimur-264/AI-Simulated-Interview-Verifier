"""
Rate limiting on sensitive endpoints (NFR-SEC-02).

- /auth/login    429 + Retry-After once one client IP + email exhausts its
                  window; other accounts keep their own budget.
- /face/verify   per-candidate compute budget (the per-second re-check fits
                  inside it); a different candidate is unaffected.
- the sliding-window primitive itself: window eviction and disabled limits.
"""
from __future__ import annotations

import time

import requests

from app.core.rate_limit import RateLimiter


# --------------------------------------------------------------------------- #
# Limiter primitive
# --------------------------------------------------------------------------- #
def test_limiter_blocks_after_budget_then_keeps_other_keys_open():
    rl = RateLimiter()
    assert [rl.check("alpha", 3, 60)[0] for _ in range(3)] == [True, True, True]

    allowed, retry_after = rl.check("alpha", 3, 60)
    assert allowed is False, "budget of 3 should reject the 4th hit"
    assert retry_after >= 1, "blocked caller must get a positive Retry-After"

    assert rl.check("beta", 3, 60)[0] is True, "other keys keep their own budget"
    assert rl.check("alpha", 0, 60)[0] is True, "limit 0 disables the check"


def test_limiter_window_slides():
    rl = RateLimiter()
    assert rl.check("k", 1, 0.05)[0] is True   # this hit fills the budget
    assert rl.check("k", 1, 0.05)[0] is False  # ...until the window passes
    time.sleep(0.06)
    assert rl.check("k", 1, 0.05)[0] is True, "old hit should leave the window"


# --------------------------------------------------------------------------- #
# API wiring
# --------------------------------------------------------------------------- #
def test_login_rate_limited_with_retry_after(new_user, base_url):
    user = new_user("ratelimit")
    url = base_url + "/auth/login"

    # The fixture already logged this email in once; every attempt counts,
    # wrong password or not, until the window (default 10/min) rejects one.
    statuses: list[int] = []
    last = None
    for _ in range(15):
        last = requests.post(url, json={"email": user.email, "password": "WrongPass9999"},
                             timeout=15)
        statuses.append(last.status_code)
        if last.status_code == 429:
            break

    assert statuses[-1] == 429, f"login was never rate limited: {statuses}"
    assert statuses.count(401) >= 1, "auth failures should precede the limit"
    assert "Retry-After" in last.headers, "429 must carry Retry-After"
    assert int(last.headers["Retry-After"]) >= 1

    # Even the correct password is refused while the window is hot.
    r = requests.post(url, json={"email": user.email, "password": user.password},
                      timeout=15)
    assert r.status_code == 429, f"correct login should also be limited: {r.status_code}"


def test_login_limit_is_per_account_not_global(new_user, base_url):
    """One account hitting its limit must not lock out a different email."""
    limited = new_user("ratelimit.a")
    other = new_user("ratelimit.b")
    url = base_url + "/auth/login"

    for _ in range(15):
        r = requests.post(url, json={"email": limited.email, "password": "WrongPass9999"},
                          timeout=15)
        if r.status_code == 429:
            break
    assert r.status_code == 429, "first account should reach its limit"

    r = requests.post(url, json={"email": other.email, "password": other.password},
                      timeout=15)
    assert r.status_code == 200, \
        f"second account must keep its own budget, got {r.status_code}"


def test_verify_rate_limited_per_candidate(new_user, base_url):
    """Hammering /face/verify trips the budget for that candidate only.

    A candidate without a reference face is enough: the limit is enforced
    before any face work, so each attempt is a cheap 404.
    """
    user = new_user("ratelimit.face")
    url = base_url + "/face/verify"
    body = {"candidate_id": user.id, "image_base64": "data:image/jpeg;base64,x"}

    last = None
    for _ in range(110):  # default budget is 100/min
        last = requests.post(url, json=body,
                             headers={"Authorization": "Bearer " + user.token},
                             timeout=15)
        if last.status_code == 429:
            break
    assert last is not None and last.status_code == 429, \
        "verify was never rate limited"
    assert int(last.headers.get("Retry-After", "0")) >= 1

    # A different candidate still has a full budget (keyed by user, not IP).
    other = new_user("ratelimit.face2")
    r = requests.post(
        url,
        json={"candidate_id": other.id, "image_base64": "data:image/jpeg;base64,x"},
        headers={"Authorization": "Bearer " + other.token},
        timeout=15,
    )
    assert r.status_code == 404, \
        f"other candidate must not be limited, got {r.status_code}"
