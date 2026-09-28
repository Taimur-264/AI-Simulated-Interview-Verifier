"""
Authentication API routes - register, login, get current user.

Endpoints:
- POST   /api/v1/auth/register  - Create new account
- POST   /api/v1/auth/login     - Get JWT token
- GET    /api/v1/auth/me        - Get current user (protected)
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.core.security import create_access_token, decode_access_token
from app.schemas.user import UserCreate, UserLogin, UserResponse, Token
from app.services.user_service import create_user, authenticate_user, get_user_by_id

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.
    
    - **email**: Must be unique, valid email format
    - **password**: Minimum 8 characters
    - **full_name**: Optional
    
    Returns: Created user (without password)
    """
    try:
        user = create_user(db, user_data)
        return user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/login", response_model=Token)
def login(credentials: UserLogin, http_request: Request, db: Session = Depends(get_db)):
    """
    Authenticate user and return JWT access token.
    
    - **email**: Registered email
    - **password**: Plain password (sent over HTTPS only!)
    
    Returns: JWT token (use as `Authorization: Bearer <token>`)

    Throttled per client IP + email (429 + Retry-After when over budget).
    """
    # Brute-force guard runs before any password check (NFR-SEC-02).
    client = http_request.client
    enforce_rate_limit(
        scope="login",
        key=f"login|{client.host if client else 'unknown'}|"
            f"{credentials.email.strip().lower()}",
        limit=settings.LOGIN_RATE_LIMIT,
        window_seconds=settings.LOGIN_RATE_WINDOW_SECONDS,
    )

    user = authenticate_user(db, credentials.email, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )
    
    # Create JWT with user ID as subject
    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}


# Dependency: get current user from JWT token
from fastapi import Request

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> UserResponse:
    """
    Extract and validate JWT token, return current user.
    
    Usage in protected routes:
        @router.get("/protected")
        def protected_route(current_user: UserResponse = Depends(get_current_user)):
            ...
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Extract token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise credentials_exception
    
    token = auth_header.replace("Bearer ", "")
    
    payload = decode_access_token(token)
    if not payload:
        raise credentials_exception
    
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise credentials_exception
    
    try:
        user_id = int(user_id_str)
    except ValueError:
        raise credentials_exception
    
    user = get_user_by_id(db, user_id)
    if not user:
        raise credentials_exception
    
    return user


@router.get("/me", response_model=UserResponse)
def get_me(current_user: UserResponse = Depends(get_current_user)):
    """
    Get current authenticated user's profile.
    
    Requires: Authorization: Bearer <token>
    """
    return current_user