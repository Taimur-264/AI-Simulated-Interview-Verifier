"""
One enrolled identity per candidate (replace semantics, FR-ID-01).

Historically /face/enroll APPENDED a reference-face row on every call, so two
different people enrolled on the same account would both be stored - and
either would pass the identity check. Enrol now replaces.

- a successful re-enrolment drops the previous face: only the new one verifies
- a FAILED enrolment (blank frame) keeps the face already on file

Uses the two single-face fixture photos in tests/data (two different people;
embedding cosine similarity ~ -0.03 against a 0.55 threshold).
"""
from __future__ import annotations

from app.models.face import ReferenceFace


def _enroll(api, user, image):
    return api("POST", "/face/enroll", token=user.token, timeout=60,
               body={"candidate_id": user.id, "image_base64": image, "source": "test"})


def _verify(api, user, image):
    return api("POST", "/face/verify", token=user.token, timeout=60,
               body={"candidate_id": user.id, "image_base64": image})


def _reference_count(db, user) -> int:
    db.expire_all()
    return db.query(ReferenceFace).filter(ReferenceFace.candidate_id == user.id).count()


def test_reenroll_replaces_previous_face(api, new_user, db, face_a, face_b):
    """Enrolling person B must drop person A - only B can pass afterwards."""
    user = new_user("pyenroll")

    status, first = _enroll(api, user, face_a)
    assert status == 201 and isinstance(first, dict) and first.get("success"), \
        f"face A enrolment failed: {status} {first!r}"

    status, second = _enroll(api, user, face_b)
    assert status == 201 and isinstance(second, dict) and second.get("success"), \
        f"face B enrolment failed: {status} {second!r}"

    assert _reference_count(db, user) == 1, \
        "re-enrolment must leave exactly one reference face on the account"

    # The REPLACED face must no longer be able to pass the check...
    status, result = _verify(api, user, face_a)
    assert status == 200 and isinstance(result, dict) and result.get("verified") is False, \
        f"replaced face must not verify (two people must not pass): {status} {result!r}"

    # ...while the current face still does.
    status, result = _verify(api, user, face_b)
    assert status == 200 and isinstance(result, dict) and result.get("verified") is True, \
        f"enrolled face must verify: {status} {result!r}"


def test_failed_enroll_keeps_face_on_file(api, new_user, blank_frame, face_a, db):
    """A rejected capture (no face) must never discard the enrolled identity."""
    user = new_user("pyenroll.fail")

    status, first = _enroll(api, user, face_a)
    assert status == 201 and isinstance(first, dict) and first.get("success"), \
        f"initial enrolment failed: {status} {first!r}"

    status, failed = _enroll(api, user, blank_frame)
    assert status == 201 and isinstance(failed, dict) and failed.get("success") is False, \
        f"blank frame must be rejected, not stored: {status} {failed!r}"

    assert _reference_count(db, user) == 1, \
        "a failed enrolment must not delete the reference face already on file"

    status, result = _verify(api, user, face_a)
    assert status == 200 and isinstance(result, dict) and result.get("verified") is True, \
        f"previously enrolled face must still verify: {status} {result!r}"
