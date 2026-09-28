"""
Question draw behaviour (FR-Q-02, FR-Q-03).

Pure-function tests against `_draw_questions`: every posting question is
delivered exactly once, and the order is shuffled so consecutive interviews
never show a fixed sequence.

No server is needed for these, but they run with the rest of the suite
(which skips entirely when the backend is down).
"""
from __future__ import annotations

from app.api.interview import _draw_questions
from app.models.posting import JobPosting, PostingQuestion

PROBE_TEXTS = [f"Probe question {i}" for i in range(5)]


def _posting_with(texts: list[str]) -> JobPosting:
    """An in-memory posting (never flushed) with one text question per label."""
    return JobPosting(
        title="Shuffle probe",
        duration_minutes=30,
        questions=[
            PostingQuestion(text=text, type="text", time_limit=60)
            for text in texts
        ],
    )


def test_draw_includes_every_posting_question_once():
    """FR-Q-02: the posting's own questions fill the whole draw (5 of 5)."""
    draw = _draw_questions(_posting_with(PROBE_TEXTS))
    texts = [question["text"] for question in draw]
    assert sorted(texts) == sorted(PROBE_TEXTS), \
        f"expected each posting question exactly once, got {texts}"


def test_draw_order_is_shuffled():
    """FR-Q-03: consecutive draws must not repeat one fixed question order."""
    posting = _posting_with(PROBE_TEXTS)
    orders = {
        tuple(question["text"] for question in _draw_questions(posting))
        for _ in range(30)
    }
    assert len(orders) > 1, \
        "question order was identical across 30 draws - draw is not shuffled"
    assert all(set(order) == set(PROBE_TEXTS) for order in orders), \
        "a draw contained questions outside the posting's own set"
