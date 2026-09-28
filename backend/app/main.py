"""
AI Interview Verifier - FastAPI Application Entry Point.

This is the main application factory that:
1. Creates FastAPI app with metadata
2. Configures CORS for frontend
3. Includes API routers
4. Initializes database and models on startup
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import init_db
from app.api import auth, face, interview, review, postings
from app.services.face_service import _get_insightface_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan events (startup/shutdown).
    
    Startup: Create database tables and initialize AI models
    Shutdown: Cleanup (close connections, etc.)
    """
    # Startup
    print("[START] Starting AI Interview Verifier API...")
    init_db()
    print("[OK] Database tables ready")
    
    # Initialize InsightFace model on startup (downloads model if needed)
    print("[MODEL] Initializing InsightFace model...")
    try:
        _get_insightface_app()
        print("[OK] InsightFace model ready")
    except Exception as e:
        print(f"[WARN] InsightFace initialization failed: {e}")
    
    yield
    
    # Shutdown
    print("[STOP] Shutting down...")


app = FastAPI(
    title=settings.APP_NAME,
    description="Intelligent Interview Security, Identity Verification & Anti-Cheating System",
    version="1.0.0",
    docs_url="/docs",      # Swagger UI at /docs
    redoc_url="/redoc",    # ReDoc at /redoc
    lifespan=lifespan,
)

# CORS - Allow frontend to call API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],  # Only our frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(face.router, prefix=settings.API_V1_PREFIX)
app.include_router(interview.router, prefix=settings.API_V1_PREFIX)
app.include_router(review.router, prefix=settings.API_V1_PREFIX)
app.include_router(postings.router, prefix=settings.API_V1_PREFIX)


# Health check endpoint
@app.get("/health", tags=["Health"])
def health_check():
    """Simple health check for load balancers/monitoring."""
    return {"status": "healthy", "service": settings.APP_NAME}


# Root endpoint
@app.get("/", tags=["Root"])
def root():
    """API root - links to documentation."""
    return {
        "name": settings.APP_NAME,
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
    }