"""
Job postings and their custom questions (admin-managed).

Candidates browse the open positions (GET /postings) and pick one; the
interview for that posting draws its questions from the posting's own
question set, topped up from the shared 40-question bank whenever the
posting has fewer than 5 custom questions.

Deleting a posting never deletes interview history - interviews reference
it with ON DELETE SET NULL (only the link goes away).
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class JobPosting(Base):
    """
    One open position.

    | Column          | Type        | Constraints                  |
    |-----------------|-------------|------------------------------|
    | id              | Integer     | Primary Key                  |
    | title           | String(255) | Not Null (posting name)      |
    | department      | String(120) | Nullable                     |
    | location        | String(120) | Nullable (e.g. Remote)       |
    | description     | Text        | Nullable                     |
    | duration_minutes| Integer     | Default 60                   |
    | is_active       | Boolean     | Closed postings hide from    |
    |                 |             | candidates                   |
    """

    __tablename__ = "job_postings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    department = Column(String(120), nullable=True)
    location = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    duration_minutes = Column(Integer, nullable=False, default=60)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    questions = relationship(
        "PostingQuestion",
        backref="posting",
        order_by="PostingQuestion.id",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<JobPosting(id={self.id}, title='{self.title}', active={self.is_active})>"


class PostingQuestion(Base):
    """
    One custom question belonging to a posting.

    Same shape as the shared question bank entries so the interview draw and
    the grader can treat both identically: mcq needs `options` + `answer_index`,
    text/coding grade against `model_answer` keyword coverage.
    """

    __tablename__ = "posting_questions"

    id = Column(Integer, primary_key=True, index=True)
    posting_id = Column(
        Integer, ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False, index=True
    )

    text = Column(Text, nullable=False)
    # mcq | text | coding
    type = Column(String(20), nullable=False, default="text")
    options = Column(JSON, nullable=True)  # MCQ options, if any
    model_answer = Column(Text, nullable=True)
    # Index of the correct MCQ option
    answer_index = Column(Integer, nullable=True)
    time_limit = Column(Integer, nullable=False, default=300)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<PostingQuestion(id={self.id}, posting_id={self.posting_id}, type='{self.type}')>"
