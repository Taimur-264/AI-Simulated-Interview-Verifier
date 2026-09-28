"""
Interview Session API Endpoints

Every interview is persisted to PostgreSQL (interviews, interview_questions,
interview_events) so a backend restart never loses a session - see
app/models/interview.py.

Endpoints:
- POST /interview/start              - create a session + random question draw
- GET  /interview/{id}               - fetch a session (owner only)
- POST /interview/{id}/answer        - save one answer (one-way flow)
- POST /interview/{id}/event         - record a proctoring event
- POST /interview/{id}/end           - grade, persist and return the debrief
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel
import random

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.interview import Interview, InterviewQuestion, InterviewEvent
from app.models.posting import JobPosting
from app.services.question_bank import QUESTION_POOL
from app.services.grading import grade_answer
from app.services.event_classification import classify_event

router = APIRouter(prefix="/interview", tags=["Interview"])

# ---- Schemas ----
class InterviewCreate(BaseModel):
    title: str
    duration_minutes: int = 60

class InterviewResponse(BaseModel):
    id: int
    candidate_id: int
    title: str
    status: str  # pending, active, completed
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_minutes: int
    current_question: int = 0

    class Config:
        from_attributes = True


class Question(BaseModel):
    id: int
    text: str
    type: str  # mcq, coding, text
    options: Optional[List[str]] = None
    time_limit: int = 300


class AnswerSubmit(BaseModel):
    question_id: int
    answer: str


# Note: the stored event row type is app.models.interview.InterviewEvent -
# there is deliberately no Pydantic twin here; the event route takes a dict.


# Questions drawn per interview from QUESTION_POOL (different every time)
QUESTIONS_PER_INTERVIEW = 5

# Fields never sent to the candidate during the interview (answers are revealed
# only on /complete for self-review)
_PRIVATE_QUESTION_FIELDS = ("model_answer", "answer_index")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    """ISO-8601 with a Z suffix (the frontend parses it as UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _posting_questions(posting: Optional[JobPosting]) -> List[dict]:
    """Custom questions of a posting in question-bank dict shape."""
    if posting is None:
        return []
    return [
        {
            "text": row.text,
            "type": row.type,
            "options": row.options,
            "time_limit": row.time_limit,
            "model_answer": row.model_answer,
            "answer_index": row.answer_index,
        }
        for row in posting.questions
    ]


def _draw_questions(posting: Optional[JobPosting] = None) -> List[dict]:
    """
    Pick a random, shuffled subset of questions for this interview (FR-Q-02).

    The posting's own questions come first; when it has fewer than
    QUESTIONS_PER_INTERVIEW of them the rest is topped up from the shared
    question bank, so every posting still runs a full interview.
    """
    custom = _posting_questions(posting)
    picked = random.sample(custom, k=min(QUESTIONS_PER_INTERVIEW, len(custom))) if custom else []
    if len(picked) < QUESTIONS_PER_INTERVIEW:
        used = {row["text"] for row in picked}
        pool = [q for q in QUESTION_POOL if q["text"] not in used]
        needed = QUESTIONS_PER_INTERVIEW - len(picked)
        picked.extend(random.sample(pool, k=min(needed, len(pool))))
    random.shuffle(picked)
    return picked


def _public_question(row: InterviewQuestion) -> dict:
    """Question safe to return while the interview is running."""
    return {
        "id": row.position,
        "text": row.text,
        "type": row.type,
        "options": row.options,
        "time_limit": row.time_limit,
    }


def _review_question(row: InterviewQuestion) -> dict:
    """Question with its model answer - for the /complete screen only."""
    model_answer = row.model_answer
    if row.type == "mcq" and row.options and row.answer_index is not None:
        model_answer = row.options[row.answer_index]
    return {
        "id": row.position,
        "text": row.text,
        "type": row.type,
        "options": row.options,
        "model_answer": model_answer,
    }


def _serialize(interview: Interview, include_answers: bool = False) -> dict:
    """Response shape shared by start/get (public questions only)."""
    payload = {
        "id": interview.id,
        "candidate_id": interview.candidate_id,
        "posting_id": interview.posting_id,
        "title": interview.title,
        "status": interview.status,
        "started_at": _iso(interview.started_at),
        "ended_at": _iso(interview.ended_at),
        "duration_minutes": interview.duration_minutes,
        "current_question": interview.current_question,
        "questions": [_public_question(q) for q in interview.questions],
    }
    if include_answers:
        payload["answers"] = {
            str(q.position): (q.your_answer or "")
            for q in interview.questions
            if q.your_answer is not None
        }
    return payload


def _get_owned_interview(db: Session, interview_id: int, user: User) -> Interview:
    """Load an interview the current user owns - 404 hides other people's ids."""
    interview = db.get(Interview, interview_id)
    if interview is None or interview.candidate_id != user.id:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview


@router.post("/start", response_model=dict)
def start_interview(
    request: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title = request.get("title", "Interview")
    duration = int(request.get("duration_minutes", 60) or 60)

    # Optional job posting: the interview is then tied to that position and
    # draws its questions from the posting's own set (topped up from the bank).
    posting: Optional[JobPosting] = None
    posting_id = request.get("posting_id")
    if posting_id:
        posting = db.get(JobPosting, int(posting_id))
        if posting is None or not posting.is_active:
            raise HTTPException(status_code=404, detail="Job posting not found")
        title = posting.title
        duration = posting.duration_minutes

    # FR-AUTH-03: every interview gets a unique identifier (DB sequence)
    interview = Interview(
        candidate_id=current_user.id,
        posting_id=posting.id if posting else None,
        title=title,
        status="active",
        started_at=_utcnow(),
        duration_minutes=duration,
        current_question=0,
    )
    db.add(interview)
    db.flush()  # obtain interview.id

    # Random subset of the bank (or the posting's questions) - FR-Q-02
    for position, question in enumerate(_draw_questions(posting), start=1):
        db.add(
            InterviewQuestion(
                interview_id=interview.id,
                position=position,
                text=question.get("text", ""),
                type=question.get("type", "text"),
                options=question.get("options"),
                time_limit=int(question.get("time_limit", 300) or 300),
                model_answer=question.get("model_answer"),
                answer_index=question.get("answer_index"),
            )
        )
    db.commit()
    db.refresh(interview)

    return _serialize(interview, include_answers=True)


@router.get("/{interview_id}")
def get_interview(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    interview = _get_owned_interview(db, interview_id, current_user)
    return _serialize(interview, include_answers=True)


@router.post("/{interview_id}/answer")
def submit_answer(
    interview_id: int,
    answer: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    interview = _get_owned_interview(db, interview_id, current_user)

    position = answer.get("question_id")
    question = next((q for q in interview.questions if q.position == position), None)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    # Stored immediately - the one-way flow has no "go back" step
    question.your_answer = str(answer.get("answer") or "")
    db.commit()
    return {"status": "saved"}


@router.post("/{interview_id}/event")
def log_event(
    interview_id: int,
    event: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    interview = _get_owned_interview(db, interview_id, current_user)

    event_type = str(event.get("event_type") or "unknown")[:60]
    source, classification = classify_event(event_type)

    data = dict(event.get("data") or {})
    # Keep stored payloads small: the sampled cursor path is dropped and only
    # its sample count is kept (the path itself is never needed for review).
    path = data.pop("path", None)
    if isinstance(path, list):
        data["path_samples"] = len(path)

    db.add(
        InterviewEvent(
            interview_id=interview.id,
            candidate_id=interview.candidate_id,
            event_type=event_type,
            source=source,
            classification=classification,
            # Server clock keeps the shared timeline trustworthy (NFR-TRACE-01)
            timestamp=_utcnow(),
            data=data,
        )
    )
    db.commit()
    return {"status": "logged"}


@router.post("/{interview_id}/end")
def end_interview(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    interview = _get_owned_interview(db, interview_id, current_user)

    interview.status = "completed"
    interview.ended_at = _utcnow()

    # ---- End-of-interview debrief: questions, grading, score, moments ----
    review = []
    correct_count = 0
    for row in interview.questions:  # ordered by position
        submitted = row.your_answer or ""
        grade = grade_answer(
            {
                "type": row.type,
                "options": row.options,
                "answer_index": row.answer_index,
                "model_answer": row.model_answer,
            },
            submitted,
        )
        row.correct = bool(grade["correct"])
        row.grading_method = grade["method"]
        correct_count += 1 if row.correct else 0

        item = _review_question(row)
        review.append(
            {
                **item,
                "your_answer": submitted,
                "correct": row.correct,
                "grading_method": row.grading_method,
            }
        )

    # Quiz score only - the human reviewer decides the outcome (NFR-SAFE-01)
    interview.score_correct = correct_count
    interview.score_total = len(review)

    # Recorded moments (proctoring events) - cursor paths were already
    # condensed to a sample count when the event was stored.
    moments = [
        {
            "event_type": e.event_type,
            "timestamp": _iso(e.timestamp),
            "data": e.data or {},
        }
        for e in interview.events  # ordered by timestamp
    ]
    answers = {str(q.position): (q.your_answer or "") for q in interview.questions}

    db.commit()

    return {
        "status": "completed",
        "score": {"correct": correct_count, "total": len(review)},
        "questions": review,
        "answers": answers,
        "events": moments,
    }
