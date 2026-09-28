"""
Shared fixtures for the API integration suite.

These tests talk to a RUNNING backend exactly like a browser would (HTTP),
and use the database only for setup (role promotion, donor reference face)
and for verifying what got recorded. Everything the suite creates is deleted
again in fixture teardown, even when a test fails.

Run (from ai-interview-verifier/):

    backend\\venv\\Scripts\\python -m pytest        # Windows
    python -m pytest -v

Requires uvicorn on 127.0.0.1:8000 + PostgreSQL; if the server is down the
whole suite skips with a clear reason instead of erroring.

Env: AIV_BASE_URL overrides the API base (default http://127.0.0.1:8000/api/v1).
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

# The test package must be able to import `app.*` for direct-DB setup/teardown.
# We deliberately do NOT chdir into the backend dir: pytest resolves testpaths
# with a cwd-relative glob AFTER conftests are imported, so a chdir here would
# break collection. Instead the backend's .env is loaded into os.environ
# (real environment variables keep priority), which pydantic-settings prefers.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_backend_env() -> None:
    """Mirror python-dotenv for backend/.env without changing the cwd."""
    import re

    env_file = BACKEND_DIR / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = re.split(r"\s+#", value, maxsplit=1)[0].strip().strip("\"'")
        os.environ.setdefault(key.strip(), value)


_load_backend_env()

BASE_URL = os.environ.get("AIV_BASE_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")
HEALTH_URL = BASE_URL.rsplit("/api/", 1)[0] + "/health"


# --------------------------------------------------------------------------- #
# API helper
# --------------------------------------------------------------------------- #
def call(method: str, path: str, token: str | None = None, body: dict | None = None,
         timeout: int = 30):
    """Call the API and return (status_code, parsed_json_or_text)."""
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        resp = requests.request(method, BASE_URL + path, json=body, headers=headers,
                                timeout=timeout)
    except requests.RequestException as exc:  # pragma: no cover - server-down path
        pytest.fail(f"backend unreachable at {BASE_URL}{path}: {exc}")
    try:
        return resp.status_code, resp.json()
    except ValueError:
        return resp.status_code, resp.text


# --------------------------------------------------------------------------- #
# Session / database fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session", autouse=True)
def _backend_up():
    """Skip the whole suite (with the reason shown) if uvicorn isn't running."""
    try:
        requests.get(HEALTH_URL, timeout=3)
    except requests.RequestException:
        pytest.skip(f"backend not running at {HEALTH_URL} - start uvicorn first")


@pytest.fixture()
def api():
    """The `call(method, path, token, body)` API helper."""
    return call


@pytest.fixture()
def base_url() -> str:
    """API base URL (same source the `api` helper uses)."""
    return BASE_URL


@pytest.fixture(scope="session")
def blank_frame() -> str:
    """A JPEG data URL of an empty scene with no face in it."""
    import base64

    import cv2
    import numpy as np

    img = np.full((480, 640, 3), 60, np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok, "cv2.imencode failed for blank frame"
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


_DATA_DIR = Path(__file__).parent / "data"


def _image_data_url(name: str) -> str:
    import base64

    path = _DATA_DIR / name
    assert path.is_file(), f"missing fixture image {path}"
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()


@pytest.fixture(scope="session")
def face_a() -> str:
    """Data URL of the first fixture person's photo (single face)."""
    return _image_data_url("face_a.jpg")


@pytest.fixture(scope="session")
def face_b() -> str:
    """Data URL of a SECOND person's photo - a clearly different identity."""
    return _image_data_url("face_b.jpg")


@pytest.fixture()
def db():
    from app.core.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Account helpers
# --------------------------------------------------------------------------- #
def _wipe_user(db, email: str) -> None:
    """Delete a test account and every row attached to it (cascade-safe order)."""
    from app.models.face import IdentityVerificationEvent, ReferenceFace
    from app.models.interview import Interview, InterviewEvent, InterviewQuestion
    from app.models.user import User

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        return
    interviews = db.query(Interview).filter(Interview.candidate_id == user.id).all()
    for interview in interviews:
        db.query(InterviewEvent).filter(InterviewEvent.interview_id == interview.id) \
            .delete(synchronize_session=False)
        db.query(InterviewQuestion).filter(InterviewQuestion.interview_id == interview.id) \
            .delete(synchronize_session=False)
    db.query(Interview).filter(Interview.candidate_id == user.id) \
        .delete(synchronize_session=False)
    db.query(IdentityVerificationEvent).filter(IdentityVerificationEvent.candidate_id == user.id) \
        .delete(synchronize_session=False)
    db.query(ReferenceFace).filter(ReferenceFace.candidate_id == user.id) \
        .delete(synchronize_session=False)
    db.query(User).filter(User.id == user.id).delete(synchronize_session=False)


@pytest.fixture()
def new_user(db):
    """Factory: register + log in a uniquely-named account; wiped on teardown."""
    created: list[str] = []

    def _create(prefix: str = "pytest") -> SimpleNamespace:
        from app.models.user import User

        email = f"{prefix}.{uuid.uuid4().hex[:10]}@example.com"
        password = "Pytest12345!"
        status, _ = call("POST", "/auth/register",
                         body={"email": email, "password": password, "full_name": "Pytest"})
        assert status in (201, 200), f"register failed: {status}"
        status, login = call("POST", "/auth/login",
                             body={"email": email, "password": password})
        assert status == 200 and isinstance(login, dict) and login.get("access_token"), \
            f"login failed: {status} {login!r}"
        created.append(email)
        row = db.query(User).filter_by(email=email).first()
        return SimpleNamespace(email=email, password=password,
                               token=login["access_token"], id=row.id if row else None)

    try:
        yield _create
    finally:
        for email in created:
            _wipe_user(db, email)
        db.commit()


@pytest.fixture()
def promote(db):
    """Promote a test account to a role directly in the DB (setup only)."""
    from app.models.user import User

    def _promote(email: str, role: str) -> None:
        db.query(User).filter(User.email == email) \
            .update({"role": role}, synchronize_session=False)
        db.commit()

    return _promote
