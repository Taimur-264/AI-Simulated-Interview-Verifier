"""
Recruiter / reviewer dashboard API (FR-ADMIN-01..05).

Endpoints (recruiter or admin role required - NFR-SEC-02, NFR-PRIV-03):
- GET /review/interviews                - list active + completed interviews
- GET /review/interviews/{id}           - identity, answers, flags and timeline
- GET /review/interviews/{id}/report    - post-interview security report

All responses are advisory review context. No endpoint produces a verdict
about the candidate (NFR-SAFE-01).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_reviewer
from app.models.interview import Interview
from app.models.user import User
from app.services import review_service

router = APIRouter(prefix="/review", tags=["Recruiter Review"])


def _load_interview(db: Session, interview_id: int) -> Interview:
    interview = db.get(Interview, interview_id)
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview


@router.get("/interviews")
def list_interviews(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_reviewer),
):
    """Candidate sessions with status, score and review-flag counts."""
    return {"interviews": review_service.list_sessions(db)}


@router.get("/interviews/{interview_id}")
def get_interview(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_reviewer),
):
    """One session: candidate, identity checks, answers, flags and timeline."""
    interview = _load_interview(db, interview_id)
    return review_service.session_detail(db, interview)


@router.get("/interviews/{interview_id}/report")
def get_report(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_reviewer),
):
    """Security report for one interview (FR-REPORT-01..05)."""
    interview = _load_interview(db, interview_id)
    return review_service.build_report(db, interview)
