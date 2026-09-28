"""
Security utilities: password hashing and JWT token handling.

Why bcrypt? 
- Slow by design (prevents brute force)
- Salt included in hash (no rainbow tables)
- Industry standard for password storage

Why JWT?
- Stateless (no server-side session store needed)
- Contains user info (sub=user_id, exp=expiry)
- Signed with SECRET_KEY (tamper-proof)
"""
from datetime import datetime, timedelta, UTC
from typing import Optional
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.core.config import settings
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.user import User

# Password hashing context - bcrypt with 12 rounds (secure but fast enough)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bcrypt truncates at 72 bytes - we handle it explicitly for clarity
BCRYPT_MAX_LENGTH = 72

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _truncate_password(password: str) -> str:
    """Truncate password to 72 characters for bcrypt compatibility."""
    # Encode to bytes, truncate to 72 bytes, decode back to string
    return password.encode('utf-8')[:BCRYPT_MAX_LENGTH].decode('utf-8', errors='ignore')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Check if a plain password matches the stored hash.
    Returns True/False.
    """
    truncated = _truncate_password(plain_password)
    return pwd_context.verify(truncated, hashed_password)


def get_password_hash(password: str) -> str:
    """
    Hash a plain password for storage.
    Returns the bcrypt hash (includes salt).
    """
    truncated = _truncate_password(password)
    return pwd_context.hash(truncated)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.
    
    Args:
        data: Payload to encode (typically {"sub": user_id})
        expires_delta: Optional custom expiry (default: settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    Returns:
        Encoded JWT string
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT token.
    
    Returns:
        Payload dict if valid, None if invalid/expired
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    Get current authenticated user from JWT token.
    
    Args:
        token: JWT access token
        db: Database session
        
    Returns:
        User object if token is valid
        
    Raises:
        HTTPException: If token is invalid or user not found
    """
    from app.models.user import User
    from app.core.database import get_db
    from fastapi import Depends, HTTPException, status
    from fastapi.security import OAuth2PasswordBearer
    from sqlalchemy.orm import Session
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
    
    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise credentials_exception
    
    try:
        user_id = int(user_id_str)
    except ValueError:
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    
    return user


def require_reviewer(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Authorization gate for the recruiter dashboard and its API (FR-ADMIN-01,
    NFR-SEC-02, NFR-PRIV-03): only recruiter/admin roles may inspect stored
    monitoring records.
    """
    from app.models.user import REVIEWER_ROLES

    if current_user.role not in REVIEWER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Recruiter access required",
        )
    return current_user


def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Admin-only gate for the job-posting console (create/edit postings and
    questions - FR-ADMIN-01, NFR-SEC-02). Review endpoints keep the wider
    require_reviewer gate.
    """
    from app.models.user import ROLE_ADMIN

    if current_user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user