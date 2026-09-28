"""
Regression: /face/verify must record ABSENCES, not only successes.

- blank frame (nobody in front of the camera) -> verified=false, error set,
  AND a stored identity event (verified=0, error_message set, no similarity
  or threshold claimed)
- condensed logging: a repeated same-status call inside 10s reuses the event

The reference face is enrolled through the API from the in-repo fixture photo
(tests/data/face_a.jpg, shared `face_a` fixture in conftest.py) so the suite
never depends on faces left in the database. The blank frame comes from the
shared `blank_frame` fixture.
"""
from __future__ import annotations

import pytest

from app.models.face import IdentityVerificationEvent


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture()
def user_with_face(api, new_user, face_a):
    """Temp account with a reference face on file (passes FaceEnrollCheck)."""
    user = new_user("pyidentity")
    status, body = api(
        "POST", "/face/enroll", token=user.token, timeout=60,
        body={"candidate_id": user.id, "image_base64": face_a, "source": "test"},
    )
    assert status == 201 and isinstance(body, dict) and body.get("success"), \
        f"fixture enrolment failed: {status} {body!r}"
    return user


def _verify(api, user, frame, timeout=60):
    return api("POST", "/face/verify", token=user.token, timeout=timeout,
               body={"candidate_id": user.id, "image_base64": frame})


def _events(db, user):
    db.expire_all()
    return (
        db.query(IdentityVerificationEvent)
        .filter(IdentityVerificationEvent.candidate_id == user.id)
        .order_by(IdentityVerificationEvent.id)
        .all()
    )


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #
def test_blank_frame_rejected_with_event(api, user_with_face, blank_frame):
    status, result = _verify(api, user_with_face, blank_frame)
    assert status == 200, f"verify should respond 200, got {status}: {result!r}"
    assert isinstance(result, dict) and result.get("verified") is False, \
        f"blank frame must not be verified: {result!r}"
    assert result.get("error") == "No face detected", \
        f"error not reported to the client: {result!r}"
    assert result.get("event_id"), \
        f"no event recorded for the absence: {result!r}"


def test_absence_recorded_in_identity_trail(api, user_with_face, blank_frame, db):
    status, result = _verify(api, user_with_face, blank_frame)
    assert status == 200 and isinstance(result, dict) and result.get("event_id"), \
        f"verify failed: {status} {result!r}"

    events = _events(db, user_with_face)
    assert len(events) == 1, f"expected 1 stored absence, got {len(events)}"
    ev = events[0]
    assert ev.verified == 0, f"stored verified={ev.verified}, expected 0"
    assert ev.error_message == "No face detected", \
        f"stored error_message={ev.error_message!r}"
    assert ev.similarity_score is None, \
        f"similarity must not be claimed for an absence: {ev.similarity_score}"
    assert ev.threshold_used is None, \
        f"threshold must not be claimed for an absence: {ev.threshold_used}"
    assert ev.faces_detected == 0, f"faces_detected={ev.faces_detected}, expected 0"


def test_condensed_logging_reuses_event(api, user_with_face, blank_frame, db):
    _, first = _verify(api, user_with_face, blank_frame)
    assert isinstance(first, dict) and first.get("event_id"), f"no event: {first!r}"

    status, second = _verify(api, user_with_face, blank_frame)
    rows = len(_events(db, user_with_face))
    assert status == 200 and isinstance(second, dict), f"second verify failed: {status}"
    assert second.get("event_id") == first.get("event_id"), \
        "repeated absence inside 10s should reuse the same event id"
    assert rows == 1, f"condensed logging should keep 1 row, found {rows}"
