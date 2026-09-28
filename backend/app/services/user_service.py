"""
User service - business logic for user operations.

Separates DB logic from API routes:
- Routes handle HTTP (request/response, status codes)
- Service handles business rules (validation, DB queries)
- Easier to test, reuse, and maintain
"""
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.models.user import User
from app.schemas.user import UserCreate
from app.core.security import get_password_hash, verify_password


def get_user_by_email(db: Session, email: str) -> User | None:
    """Find user by email (case-insensitive)."""
    statement = select(User).where(User.email == email.lower())
    return db.execute(statement).scalar_one_or_none()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Find user by primary key."""
    return db.get(User, user_id)


def create_user(db: Session, user_data: UserCreate) -> User:
    """
    Create a new user with hashed password.
    
    Raises:
        ValueError: If email already exists
    """
    # Normalize email
    email = user_data.email.lower()
    
    # Check duplicate
    if get_user_by_email(db, email):
        raise ValueError("Email already registered")
    
    # Hash password (NEVER store plain text)
    hashed_password = get_password_hash(user_data.password)
    
    # Create user instance
    user = User(
        email=email,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
    )
    
    # Save to DB
    db.add(user)
    db.commit()
    db.refresh(user)  # Load generated fields (id, created_at)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """
    Verify credentials and return user if valid.
    
    Returns:
        User if email exists and password matches, None otherwise
    """
    user = get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user