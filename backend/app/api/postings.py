"""
Job posting API - candidate position list + admin CRUD (FR-ADMIN-01).

Candidates:
    GET    /postings                          - open positions (active only)

Admin console (require_admin, NFR-SEC-02):
    GET    /admin/postings                    - all postings with questions
    POST   /admin/postings                    - create a posting
    PUT    /admin/postings/{id}               - update title/details/active
    DELETE /admin/postings/{id}               - remove (interview history kept)
    POST   /admin/postings/{id}/questions     - add a question
    PUT    /admin/postings/{id}/questions/{qid}   - edit a question
    DELETE /admin/postings/{id}/questions/{qid}   - remove a question
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.posting import JobPosting, PostingQuestion
from app.models.user import User

router = APIRouter(tags=["Postings"])

QUESTION_TYPES = {"mcq", "text", "coding"}


# ---- Schemas ----

class PostingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    department: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: int = Field(default=60, ge=5, le=480)


class PostingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    department: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=480)
    is_active: Optional[bool] = None


class QuestionCreate(BaseModel):
    text: str = Field(min_length=1)
    type: str = "text"
    options: Optional[List[str]] = None
    model_answer: Optional[str] = None
    answer_index: Optional[int] = None
    time_limit: int = Field(default=300, ge=15, le=3600)


class QuestionUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1)
    type: Optional[str] = None
    options: Optional[List[str]] = None
    model_answer: Optional[str] = None
    answer_index: Optional[int] = None
    time_limit: Optional[int] = Field(default=None, ge=15, le=3600)


# ---- Serialization ----

def _question_dict(row: PostingQuestion) -> dict:
    return {
        "id": row.id,
        "text": row.text,
        "type": row.type,
        "options": row.options,
        "model_answer": row.model_answer,
        "answer_index": row.answer_index,
        "time_limit": row.time_limit,
    }


def _posting_dict(posting: JobPosting, include_questions: bool = False) -> dict:
    payload = {
        "id": posting.id,
        "title": posting.title,
        "department": posting.department,
        "location": posting.location,
        "description": posting.description,
        "duration_minutes": posting.duration_minutes,
        "is_active": posting.is_active,
        "question_count": len(posting.questions),
        "created_at": posting.created_at.isoformat() if posting.created_at else None,
    }
    if include_questions:
        payload["questions"] = [_question_dict(q) for q in posting.questions]
    return payload


def _validate_question_type(q_type: str, options: Optional[List[str]], answer_index: Optional[int]) -> None:
    """MCQs need at least two options and a correct option index."""
    if q_type not in QUESTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Question type must be one of {sorted(QUESTION_TYPES)}")
    if q_type == "mcq":
        if not options or len(options) < 2:
            raise HTTPException(status_code=400, detail="MCQ questions need at least two options")
        if answer_index is None or not (0 <= answer_index < len(options)):
            raise HTTPException(status_code=400, detail="MCQ questions need a valid correct option")


def _get_posting(db: Session, posting_id: int) -> JobPosting:
    posting = db.get(JobPosting, posting_id)
    if posting is None:
        raise HTTPException(status_code=404, detail="Job posting not found")
    return posting


# ---- Candidate-facing list ----

@router.get("/postings")
def list_open_postings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open positions a candidate may apply to (FR-ADMIN-01)."""
    rows = (
        db.query(JobPosting)
        .filter(JobPosting.is_active.is_(True))
        .order_by(JobPosting.created_at.desc())
        .all()
    )
    return [_posting_dict(row) for row in rows]


# ---- Admin console ----

@router.get("/admin/postings", dependencies=[Depends(require_admin)])
def admin_list_postings(db: Session = Depends(get_db)):
    rows = db.query(JobPosting).order_by(JobPosting.created_at.desc()).all()
    return [_posting_dict(row, include_questions=True) for row in rows]


@router.post("/admin/postings", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def admin_create_posting(payload: PostingCreate, db: Session = Depends(get_db)):
    posting = JobPosting(
        title=payload.title.strip(),
        department=(payload.department or "").strip() or None,
        location=(payload.location or "").strip() or None,
        description=(payload.description or "").strip() or None,
        duration_minutes=payload.duration_minutes,
        is_active=True,
    )
    db.add(posting)
    db.commit()
    db.refresh(posting)
    return _posting_dict(posting, include_questions=True)


@router.put("/admin/postings/{posting_id}", dependencies=[Depends(require_admin)])
def admin_update_posting(posting_id: int, payload: PostingUpdate, db: Session = Depends(get_db)):
    posting = _get_posting(db, posting_id)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        data["title"] = data["title"].strip()
    for field in ("department", "location", "description"):
        if field in data and data[field] is not None:
            data[field] = data[field].strip() or None
    for key, value in data.items():
        setattr(posting, key, value)
    db.commit()
    db.refresh(posting)
    return _posting_dict(posting, include_questions=True)


@router.delete("/admin/postings/{posting_id}", dependencies=[Depends(require_admin)])
def admin_delete_posting(posting_id: int, db: Session = Depends(get_db)):
    posting = _get_posting(db, posting_id)
    db.delete(posting)  # interviews keep their history (posting_id -> NULL)
    db.commit()
    return {"status": "deleted"}


@router.post(
    "/admin/postings/{posting_id}/questions",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def admin_add_question(posting_id: int, payload: QuestionCreate, db: Session = Depends(get_db)):
    posting = _get_posting(db, posting_id)
    _validate_question_type(payload.type, payload.options, payload.answer_index)
    question = PostingQuestion(
        posting_id=posting.id,
        text=payload.text.strip(),
        type=payload.type,
        options=payload.options if payload.type == "mcq" else None,
        model_answer=payload.model_answer,
        answer_index=payload.answer_index if payload.type == "mcq" else None,
        time_limit=payload.time_limit,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return _question_dict(question)


@router.put(
    "/admin/postings/{posting_id}/questions/{question_id}",
    dependencies=[Depends(require_admin)],
)
def admin_update_question(
    posting_id: int,
    question_id: int,
    payload: QuestionUpdate,
    db: Session = Depends(get_db),
):
    _get_posting(db, posting_id)
    question = db.get(PostingQuestion, question_id)
    if question is None or question.posting_id != posting_id:
        raise HTTPException(status_code=404, detail="Question not found")

    data = payload.model_dump(exclude_unset=True)
    if "text" in data and data["text"] is not None:
        data["text"] = data["text"].strip()
    q_type = data.get("type", question.type)
    options = data.get("options", question.options)
    answer_index = data.get("answer_index", question.answer_index)
    _validate_question_type(q_type, options, answer_index)
    data["options"] = options if q_type == "mcq" else None
    data["answer_index"] = answer_index if q_type == "mcq" else None

    for key, value in data.items():
        setattr(question, key, value)
    db.commit()
    db.refresh(question)
    return _question_dict(question)


@router.delete(
    "/admin/postings/{posting_id}/questions/{question_id}",
    dependencies=[Depends(require_admin)],
)
def admin_delete_question(posting_id: int, question_id: int, db: Session = Depends(get_db)):
    question = db.get(PostingQuestion, question_id)
    if question is None or question.posting_id != posting_id:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(question)
    db.commit()
    return {"status": "deleted"}
