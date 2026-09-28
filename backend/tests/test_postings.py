"""
Job postings + admin console: candidate position board, admin CRUD,
posting-specific question draw, and role gating.

Ported from the standalone posting scripts; every original check is kept.
"""
from __future__ import annotations

import pytest

from app.models.interview import Interview
from app.models.posting import JobPosting
from app.models.user import User


@pytest.fixture()
def admin_user(new_user, promote):
    u = new_user("posting.admin")
    promote(u.email, "admin")
    return u


@pytest.fixture()
def cand_user(new_user):
    return new_user("posting.cand")


@pytest.fixture()
def zz_cleanup(db):
    """Remove the flow's 'ZZ Test Posting...' leftovers even if a test dies midway."""
    yield
    leftovers = db.query(JobPosting).filter(JobPosting.title.like("ZZ %")).all()
    for posting in leftovers:
        db.delete(posting)  # ORM delete cascades to posting_questions
    db.commit()


# --------------------------------------------------------------------------- #
# Candidate board + role gating
# --------------------------------------------------------------------------- #
def test_candidate_board_lists_open_postings(api, cand_user):
    status, postings = api("GET", "/postings", token=cand_user.token)
    assert status == 200 and isinstance(postings, list) and len(postings) >= 3, \
        f"expected >=3 seeded postings, got {status} {postings!r}"
    for p in postings:
        assert {"id", "title", "duration_minutes", "is_active", "question_count"} <= set(p), \
            f"posting payload missing fields: {p}"


def test_candidate_blocked_from_admin_postings(api, cand_user):
    status, _ = api("GET", "/admin/postings", token=cand_user.token)
    assert status == 403, f"candidate listed admin postings: {status}"
    status, _ = api("POST", "/admin/postings", token=cand_user.token,
                    body={"title": "Hacker Posting"})
    assert status == 403, f"candidate created a posting: {status}"


def test_seeded_postings_and_questions(api, admin_user):
    status, admin_list = api("GET", "/admin/postings", token=admin_user.token)
    assert status == 200 and isinstance(admin_list, list) and len(admin_list) >= 3, \
        f"admin list failed or under-seeded: {status} {admin_list!r}"
    by_title = {p["title"]: p for p in admin_list}

    frontend = by_title.get("Frontend Engineer")
    assert frontend and frontend["question_count"] == 3 \
        and len(frontend.get("questions") or []) == 3, \
        f"Frontend Engineer missing/expected 3 questions: {frontend}"
    qa = by_title.get("QA Analyst")
    assert qa and qa["question_count"] == 0, \
        f"QA Analyst missing/expected 0 questions: {qa}"
    for q in frontend["questions"]:
        assert {"id", "text", "type", "time_limit"} <= set(q), \
            f"question payload missing fields: {q}"


# --------------------------------------------------------------------------- #
# Full lifecycle: create -> questions -> draw -> close/reopen -> delete
# --------------------------------------------------------------------------- #
def test_posting_crud_and_question_draw(api, admin_user, cand_user, db, zz_cleanup):
    # --- create posting ---
    status, posting = api("POST", "/admin/postings", token=admin_user.token,
                          body={"title": "ZZ Test Posting", "department": "QA",
                                "location": "Remote",
                                "description": "Temporary posting for the pytest suite.",
                                "duration_minutes": 30})
    assert status == 201 and posting.get("id"), f"create posting failed: {status} {posting!r}"
    pid = posting["id"]

    # --- MCQ validation: one option rejected ---
    status, _ = api("POST", f"/admin/postings/{pid}/questions", token=admin_user.token,
                    body={"text": "Bad MCQ", "type": "mcq", "options": ["only one"],
                          "answer_index": 0})
    assert status == 400, f"1-option MCQ accepted: {status}"

    # --- add custom questions (mcq + text) ---
    status, mcq = api("POST", f"/admin/postings/{pid}/questions", token=admin_user.token,
                      body={"text": "Which HTTP status means Created?", "type": "mcq",
                            "options": ["200", "201", "404"], "answer_index": 1,
                            "time_limit": 120})
    assert status == 201 and mcq.get("id"), f"add mcq failed: {status} {mcq!r}"
    status, txt = api("POST", f"/admin/postings/{pid}/questions", token=admin_user.token,
                      body={"text": "Describe API versioning strategies.", "type": "text",
                            "model_answer": "url path versioning header date media type",
                            "time_limit": 300})
    assert status == 201 and txt.get("id"), f"add text failed: {status} {txt!r}"

    status, admin_list = api("GET", "/admin/postings", token=admin_user.token)
    zz_now = next((p for p in admin_list if p["id"] == pid), None)
    assert zz_now and zz_now["question_count"] == 2, \
        f"expected 2 custom questions: {zz_now and zz_now['question_count']}"

    # --- candidate sees the new active posting ---
    status, board = api("GET", "/postings", token=cand_user.token)
    assert status == 200 and any(p["id"] == pid for p in board), \
        "new active posting not on candidate board"

    # --- start interview: draw = 2 custom + 3 bank questions, posting title/duration ---
    status, interview = api("POST", "/interview/start", token=cand_user.token,
                            body={"title": "ignored", "duration_minutes": 60,
                                  "posting_id": pid})
    assert status == 200 and interview.get("id"), f"start failed: {status} {interview!r}"
    iv_id = interview["id"]
    assert interview.get("posting_id") == pid, f"posting link lost: {interview!r}"
    assert interview.get("title") == "ZZ Test Posting", \
        f"posting title should win: {interview.get('title')!r}"
    assert interview.get("duration_minutes") == 30, \
        f"posting duration not applied: {interview.get('duration_minutes')}"

    questions = interview.get("questions") or []
    q_texts = {q.get("text") for q in questions}
    assert len(questions) == 5 \
        and "Which HTTP status means Created?" in q_texts \
        and "Describe API versioning strategies." in q_texts, \
        f"draw must be 5 questions incl. both custom ones, got {len(questions)}"

    mcq_drawn = next((q for q in questions if q.get("type") == "mcq"
                      and "Created?" in (q.get("text") or "")), None)
    assert mcq_drawn and mcq_drawn.get("options") == ["200", "201", "404"], \
        f"mcq options lost in draw: {mcq_drawn}"
    assert mcq_drawn.get("answer_index") in (None, 1), \
        f"answer_index leaked/incorrect: {mcq_drawn.get('answer_index')}"

    # --- close posting: hidden from candidates, start refused ---
    status, _ = api("PUT", f"/admin/postings/{pid}", token=admin_user.token,
                    body={"is_active": False})
    assert status == 200, f"close failed: {status}"
    status, board = api("GET", "/postings", token=cand_user.token)
    assert status == 200 and all(p["id"] != pid for p in board), \
        "closed posting still on candidate board"
    status, body = api("POST", "/interview/start", token=cand_user.token,
                       body={"posting_id": pid, "title": "closed start"})
    assert status == 404, f"start on closed posting returned {status}: {body!r}"

    # --- rename + reopen ---
    status, _ = api("PUT", f"/admin/postings/{pid}", token=admin_user.token,
                    body={"title": "ZZ Renamed", "is_active": True})
    assert status == 200, f"rename/reopen failed: {status}"
    status, admin_list = api("GET", "/admin/postings", token=admin_user.token)
    assert status == 200 and any(p["id"] == pid and p["title"] == "ZZ Renamed"
                                 for p in admin_list), \
        "renamed posting missing from admin list"

    # --- edit + delete a question on the posting ---
    status, edited = api("PUT", f"/admin/postings/{pid}/questions/{txt['id']}",
                         token=admin_user.token,
                         body={"text": "Describe API versioning strategies (edited)."})
    assert status == 200 and "(edited)" in (edited.get("text") or ""), \
        f"question edit failed: {status} {edited!r}"
    status, _ = api("DELETE", f"/admin/postings/{pid}/questions/{txt['id']}",
                    token=admin_user.token)
    assert status == 200, f"question delete failed: {status}"
    status, admin_list = api("GET", "/admin/postings", token=admin_user.token)
    zz_now = next((p for p in admin_list if p["id"] == pid), None)
    assert zz_now and zz_now["question_count"] == 1, \
        f"expected 1 question after delete: {zz_now and zz_now['question_count']}"

    # --- legacy start (no posting_id) still works ---
    status, legacy = api("POST", "/interview/start", token=cand_user.token,
                         body={"title": "Technical Interview", "duration_minutes": 60})
    assert status == 200 and legacy.get("posting_id") is None \
        and legacy.get("title") == "Technical Interview", \
        f"legacy start failed: {status} {legacy!r}"

    # --- delete posting; posting-linked interview keeps history with link cleared ---
    db.expire_all()
    row = db.get(Interview, iv_id)
    assert row is not None and row.posting_id == pid, "test interview lost its posting link"
    status, _ = api("DELETE", f"/admin/postings/{pid}", token=admin_user.token)
    assert status == 200, f"delete posting failed: {status}"
    db.expire_all()
    row = db.get(Interview, iv_id)
    assert row is not None, "posting-linked interview should survive posting deletion"
    assert row.posting_id is None, \
        f"posting link should be cleared (ON DELETE SET NULL): {row.posting_id}"
    assert row.title == "ZZ Test Posting", \
        f"interview history should keep the posting title: {row.title!r}"


# --------------------------------------------------------------------------- #
# Seed / role expectations
# --------------------------------------------------------------------------- #
def test_owner_account_is_admin(db):
    owner = db.query(User).filter(User.email == "kafeel@gmail.com").first()
    if owner is None:
        pytest.skip("seed account kafeel@gmail.com not present in this database")
    assert owner.role == "admin", f"owner role is {owner.role!r}, expected 'admin'"
