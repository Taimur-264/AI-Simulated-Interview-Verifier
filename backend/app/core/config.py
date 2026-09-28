"""
Configuration settings for the AI Interview Verifier backend.

Uses Pydantic Settings to load from environment variables (.env file)
with sensible defaults for development.
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "AI Interview Verifier"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # Database (PostgreSQL)
    # Format: postgresql://user:password@host:port/database
    DATABASE_URL: str = "postgresql://dev_user:dev_password@localhost:5432/interview_verifier"

    # Security / JWT
    SECRET_KEY: str = "your-super-secret-key-change-in-production-min-32-chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30 * 24 * 60  # 30 days

    # CORS (Frontend URL)
    FRONTEND_URL: str = "http://localhost:5173"

    # Access control for the recruiter dashboard (FR-ADMIN-01, NFR-PRIV-03).
    # Comma-separated emails that receive the "recruiter" role on startup.
    # New registrations always start as candidates.
    REVIEWER_EMAILS: str = "kafeel@gmail.com"

    # Rate limiting for sensitive endpoints (NFR-SEC-02); 0 disables a check.
    # Login window is keyed by client IP + email, verify by user id, so a
    # legitimate user or another account behind the same NAT is never locked
    # out by someone else's traffic. Verify must allow the per-second
    # identity re-check (60/min) with headroom for retries.
    LOGIN_RATE_LIMIT: int = 10
    LOGIN_RATE_WINDOW_SECONDS: int = 60
    VERIFY_RATE_LIMIT: int = 100
    VERIFY_RATE_WINDOW_SECONDS: int = 60

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Singleton instance - import this everywhere you need settings
settings = Settings()