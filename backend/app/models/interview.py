"""
Interview persistence models.

Replaces the old in-memory `interviews_db` dict so an interview survives a
backend restart: the drawn questions, the candidate's answers, the graded
result and every proctoring event are rows in PostgreSQL.

Tables:
- interviews            - one row per interview session (FR-AUTH-03/04)
- interview_questions   - the random question draw + the candidate's answer
- interview_events      - timestamped proctoring events (FR-EVENT-01..04)
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Interview(Base):
    """One interview session for one candidate."""

    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # The job posting this interview is for (nullable for pre-posting rows;
    # ON DELETE SET NULL keeps interview history when a posting is removed)
    posting_id = Column(Integer, ForeignKey("job_postings.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=False, default="Interview")
    # pending | active | completed
    status = Column(String(20), nullable=False, default="active", index=True)
    duration_minutes = Column(Integer, nullable=False, default=60)
    current_question = Column(Integer, nullable=False, default=0)

    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    # Graded once at submission (/interview/{id}/end) - study-aid score only,
    # never an automatic verdict (NFR-SAFE-01).
    score_correct = Column(Integer, nullable=True)
    score_total = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    candidate = relationship("User", backref="interviews")
    questions = relationship(
        "InterviewQuestion",
        backref="interview",
        order_by="InterviewQuestion.position",
        cascade="all, delete-orphan",
    )
    events = relationship(
        "InterviewEvent",
        backref="interview",
        order_by="InterviewEvent.timestamp",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Interview(id={self.id}, candidate_id={self.candidate_id}, status='{self.status}')>"


class InterviewQuestion(Base):
    """
    One drawn question inside an interview.

    `position` (1..N) is the id the candidate sees and submits answers under,
    so ids stay small and stable for the session. The reference/model answer
    lives here too - it is only ever revealed on the candidate's own
    completion screen and on the recruiter dashboard, never mid-interview.
    """

    __tablename__ = "interview_questions"
    __table_args__ = (
        UniqueConstraint("interview_id", "position", name="uq_interview_question_position"),
    )

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False)  # candidate-facing question id

    text = Column(Text, nullable=False)
    # mcq | coding | text
    type = Column(String(20), nullable=False, default="text")
    options = Column(JSON, nullable=True)  # MCQ options, if any
    time_limit = Column(Integer, nullable=False, default=300)

    model_answer = Column(Text, nullable=True)
    # Index of the correct MCQ option (question bank reference)
    answer_index = Column(Integer, nullable=True)

    # Candidate submission (written immediately on "Submit & next" - one-way flow)
    your_answer = Column(Text, nullable=True)
    # Grading result, computed once when the interview is submitted
    correct = Column(Boolean, nullable=True)
    grading_method = Column(String(20), nullable=True)  # mcq | keywords | unanswered

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InterviewEvent(Base):
    """
    A timestamped proctoring event (FR-EVENT-01/02).

    `source`          which detector produced it (identity, camera, audio,
                      browser, mouse, system)
    `classification`  Normal | Review | High Review - assists human review only
                      and never decides the outcome (FR-CLASS-01..03,
                      NFR-SAFE-01).
    """

    __tablename__ = "interview_events"
    __table_args__ = (
        Index("ix_interview_events_session", "interview_id", "timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    event_type = Column(String(60), nullable=False, index=True)
    source = Column(String(30), nullable=False, default="system")
    classification = Column(String(20), nullable=False, default="normal", index=True)

    # Server-side clock keeps the timeline trustworthy (NFR-TRACE-01)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    data = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<InterviewEvent(interview_id={self.interview_id}, type='{self.event_type}')>"
