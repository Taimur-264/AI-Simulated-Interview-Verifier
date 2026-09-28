"""
User model - represents the 'users' table in PostgreSQL.

SQLAlchemy ORM maps Python classes to database tables.
Each instance = one row. Each attribute = one column.
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text
from sqlalchemy.sql import func
from app.core.database import Base


# Role decides what a login may open:
#   candidate  - runs interviews (default)
#   recruiter  - may open the recruiter dashboard (FR-ADMIN-01, NFR-PRIV-03)
#   admin      - recruiter access plus future platform administration
ROLE_CANDIDATE = "candidate"
ROLE_RECRUITER = "recruiter"
ROLE_ADMIN = "admin"
REVIEWER_ROLES = (ROLE_RECRUITER, ROLE_ADMIN)


class User(Base):
    """
    User table schema:
    
    | Column           | Type        | Constraints              |
    |------------------|-------------|--------------------------|
    | id               | Integer     | Primary Key, Autoinc     |
    | email            | String(255) | Unique, Not Null, Index  |
    | hashed_password  | String(255) | Not Null                 |
    | full_name        | String(255) | Nullable                 |
    | role             | String(20)  | candidate/recruiter/admin|
    | is_active        | Boolean     | Default True             |
    | is_verified      | Boolean     | Default False            |
    | created_at       | DateTime    | Auto-set on insert       |
    | updated_at       | DateTime    | Auto-set on insert/update|
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(String(20), nullable=False, default=ROLE_CANDIDATE, server_default=ROLE_CANDIDATE)
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}')>"