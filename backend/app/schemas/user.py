"""
Pydantic schemas for User API - request/response validation & serialization.

Why separate from models?
- Models = database structure (internal)
- Schemas = API contract (external)
- Decouples DB from API (can change one without breaking the other)
- Automatic validation + OpenAPI docs generation
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


# ---- Request Schemas (Input) ----

class UserCreate(BaseModel):
    """Data required to register a new user."""
    email: EmailStr = Field(..., description="User's email address")
    password: str = Field(..., min_length=8, description="Password (min 8 chars)")
    full_name: Optional[str] = Field(None, max_length=255, description="Optional full name")


class UserLogin(BaseModel):
    """Data required to log in."""
    email: EmailStr
    password: str


# ---- Response Schemas (Output) ----

class UserResponse(BaseModel):
    """User data returned by API (never includes password hash)."""
    id: int
    email: EmailStr
    full_name: Optional[str] = None
    role: str = "candidate"  # candidate | recruiter | admin
    is_active: bool
    is_verified: bool
    created_at: datetime

    # Enable ORM mode - allows creating from SQLAlchemy model directly
    class Config:
        from_attributes = True


class Token(BaseModel):
    """JWT token response after successful login."""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Decoded token payload."""
    user_id: Optional[int] = None