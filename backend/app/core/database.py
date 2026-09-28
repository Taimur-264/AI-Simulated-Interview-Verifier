"""
Database connection and session management using SQLAlchemy 2.0.

Key concepts:
- Engine: Connection pool to PostgreSQL
- Session: Unit of work (transaction) for DB operations
- get_db(): FastAPI dependency that provides a session per request
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from app.core.config import settings


# Create engine with connection pooling
# pool_pre_ping: verifies connections before use (handles stale connections)
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    echo=settings.DEBUG,  # Log SQL queries in debug mode
)

# Session factory - each request gets its own session
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
)


# Base class for all ORM models
class Base(DeclarativeBase):
    pass


def get_db() -> Session:
    """
    FastAPI dependency that provides a database session per request.
    
    Usage in routes:
        @app.get("/users")
        def get_users(db: Session = Depends(get_db)):
            ...
    
    Yields session, ensures it's closed after request (even on error).
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Create all tables defined in models.
    Call this on startup (or use Alembic migrations for production).
    """
    # Import all models here so they're registered with Base
    from app.models import user, face, interview, posting  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _ensure_role_column()
    _ensure_posting_column()
    _promote_reviewers()
    _seed_postings()


def _ensure_role_column() -> None:
    """
    Lightweight migration: add users.role to databases created before the
    recruiter role existed (create_all never alters existing tables).
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "role" in columns:
        return
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'candidate'")
        )
    print("[OK] Migration: users.role column added")


def _ensure_posting_column() -> None:
    """
    Lightweight migration: add interviews.posting_id to databases created
    before job postings existed (create_all never alters existing tables).
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "interviews" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("interviews")}
    if "posting_id" in columns:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE interviews ADD COLUMN posting_id "
                "INTEGER REFERENCES job_postings(id) ON DELETE SET NULL"
            )
        )
    print("[OK] Migration: interviews.posting_id column added")


def _promote_reviewers() -> None:
    """
    Grant the admin console (job postings + review dashboard) to the emails
    listed in settings.REVIEWER_EMAILS (FR-ADMIN-01, NFR-SEC-02, NFR-PRIV-03).
    Listed accounts are upgraded to admin from any lower role; new
    registrations always start as candidates.
    """
    from app.core.config import settings
    from app.models.user import ROLE_ADMIN, User

    emails = [e.strip().lower() for e in settings.REVIEWER_EMAILS.split(",") if e.strip()]
    if not emails:
        return
    db = SessionLocal()
    try:
        promoted = (
            db.query(User)
            .filter(User.email.in_(emails), User.role != ROLE_ADMIN)
            .update({User.role: ROLE_ADMIN}, synchronize_session=False)
        )
        db.commit()
        if promoted:
            print(f"[OK] Admin role granted to {promoted} account(s)")
    finally:
        db.close()


# Example postings so the candidate position list is never empty on a fresh
# database. The admin can edit or delete all of these.
_DEMO_POSTINGS = [
    {
        "title": "Frontend Engineer",
        "department": "Engineering",
        "location": "Remote",
        "description": (
            "Build and maintain our React application: components, state "
            "management, accessibility and performance. 5 questions, about "
            "60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "Which React hook runs a side effect after the component renders?",
                "type": "mcq",
                "options": ["useEffect", "useState", "useMemo", "useRef"],
                "answer_index": 0,
                "model_answer": "useEffect",
                "time_limit": 120,
            },
            {
                "text": "Explain the difference between props and state in React.",
                "type": "text",
                "model_answer": (
                    "Props are passed down from a parent component and are "
                    "read-only for the child, while state is local mutable "
                    "data owned by the component itself and updating it "
                    "triggers a re-render."
                ),
                "time_limit": 300,
            },
            {
                "text": "Write a JavaScript function that debounces another function.",
                "type": "coding",
                "model_answer": (
                    "function debounce(fn, wait) { let t; return (...args) "
                    "{ clearTimeout(t); t = setTimeout(() => fn(...args), wait); "
                    "} } wait timer clearTimeout delay"
                ),
                "time_limit": 420,
            },
        ],
    },
    {
        "title": "Backend Engineer (Python)",
        "department": "Engineering",
        "location": "Hybrid - Office",
        "description": (
            "Design and ship FastAPI services: data models, background jobs, "
            "testing and observability. 5 questions, about 60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "Which FastAPI dependency convention injects a database session?",
                "type": "mcq",
                "options": ["get_db", "Depends", "Header", "Body"],
                "answer_index": 0,
                "model_answer": "get_db",
                "time_limit": 120,
            },
            {
                "text": "What is the GIL in Python and when does it matter?",
                "type": "text",
                "model_answer": (
                    "The Global Interpreter Lock allows only one thread to "
                    "execute Python bytecode at a time, so CPU-bound threads "
                    "do not run in parallel; it matters for CPU-heavy work "
                    "where multiprocessing or releasing the GIL is needed."
                ),
                "time_limit": 300,
            },
            {
                "text": "Write a Python function that merges two sorted lists into one sorted list.",
                "type": "coding",
                "model_answer": (
                    "def merge(a, b): out = []; i = j = 0; while i < len(a) "
                    "and j < len(b): if a[i] <= b[j]: out.append(a[i]); i += 1 "
                    "else: out.append(b[j]); j += 1; return out + a[i:] + b[j:] "
                    "two pointers while append"
                ),
                "time_limit": 420,
            },
        ],
    },
    {
        "title": "QA Analyst",
        "department": "Quality Assurance",
        "location": "On-site",
        "description": (
            "Test planning, defect reporting and exploratory testing for our "
            "product suite. Questions are drawn from the shared bank - "
            "5 questions, about 60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [],
    },
    {
        "title": "Data Analyst",
        "department": "Data & Analytics",
        "location": "Remote",
        "description": (
            "Turn raw data into decisions: SQL reporting, data cleaning and "
            "clear stakeholder communication. 5 questions, about 60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "Which SQL clause filters rows before aggregation?",
                "type": "mcq",
                "options": ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
                "answer_index": 0,
                "model_answer": "WHERE",
                "time_limit": 120,
            },
            {
                "text": "How would you spot and handle duplicate records in a dataset?",
                "type": "text",
                "model_answer": (
                    "Define a unique key, group or count on it to find "
                    "duplicates, decide which record is authoritative, then "
                    "deduplicate with rules, verify row counts and add "
                    "validation to prevent future duplicates."
                ),
                "time_limit": 300,
            },
        ],
    },
    {
        "title": "DevOps Engineer",
        "department": "Engineering",
        "location": "Hybrid - Office",
        "description": (
            "Keep delivery fast and reliable: CI/CD, containers, "
            "infrastructure as code and observability. 5 questions, about "
            "60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "What is the main benefit of managing infrastructure as code?",
                "type": "mcq",
                "options": [
                    "Reproducible, version-controlled environments",
                    "Faster CPU clock speeds",
                    "Smaller application logs",
                    "No need for monitoring",
                ],
                "answer_index": 0,
                "model_answer": "Reproducible, version-controlled environments",
                "time_limit": 120,
            },
            {
                "text": "Explain blue-green deployment and how you roll back a bad release.",
                "type": "text",
                "model_answer": (
                    "Two identical environments run side by side; traffic is "
                    "switched from blue to green atomically, so a bad release "
                    "is rolled back by switching traffic back to the previous "
                    "environment - instant rollback, verified by health checks "
                    "and version pinning."
                ),
                "time_limit": 300,
            },
        ],
    },
    {
        "title": "Product Manager",
        "department": "Product",
        "location": "On-site",
        "description": (
            "Define what to build and why: user research, prioritisation and "
            "clear requirements. 5 questions, about 60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "Which metric best shows whether users get value from a feature?",
                "type": "mcq",
                "options": [
                    "Weekly active users engaging with the feature",
                    "Number of releases shipped",
                    "Lines of code written",
                    "Size of the product backlog",
                ],
                "answer_index": 0,
                "model_answer": "Weekly active users engaging with the feature",
                "time_limit": 120,
            },
            {
                "text": "How do you prioritise a backlog when demand exceeds capacity?",
                "type": "text",
                "model_answer": (
                    "Score items by value versus effort or cost of delay, "
                    "surface dependencies and risks, align with stakeholders "
                    "on goals, and ship a thin MVP first to learn quickly."
                ),
                "time_limit": 300,
            },
        ],
    },
    {
        "title": "UI/UX Designer",
        "department": "Design",
        "location": "Remote",
        "description": (
            "Design usable, accessible product experiences: research, "
            "wireframes, prototypes and usability testing. 5 questions, "
            "about 45 minutes."
        ),
        "duration_minutes": 45,
        "questions": [
            {
                "text": "What does a wireframe primarily communicate?",
                "type": "mcq",
                "options": [
                    "Layout and hierarchy, not final visual styling",
                    "Final colours and typography",
                    "Backend API contracts",
                    "Deployment pipeline steps",
                ],
                "answer_index": 0,
                "model_answer": "Layout and hierarchy, not final visual styling",
                "time_limit": 120,
            },
            {
                "text": "Describe how you would run a usability test for a new checkout flow.",
                "type": "text",
                "model_answer": (
                    "Recruit representative users, give realistic tasks, ask "
                    "them to think aloud, record success and time on task, "
                    "note where they struggle, then iterate and re-test the "
                    "prototyped fixes."
                ),
                "time_limit": 300,
            },
        ],
    },
    {
        "title": "Mobile Developer (React Native)",
        "department": "Engineering",
        "location": "Remote",
        "description": (
            "Build and ship our cross-platform mobile app: native modules, "
            "offline behaviour and app-store releases. 5 questions, about "
            "60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "What is Metro in a React Native project?",
                "type": "mcq",
                "options": [
                    "The JavaScript bundler for React Native apps",
                    "The native database layer",
                    "The end-to-end testing framework",
                    "The CI server",
                ],
                "answer_index": 0,
                "model_answer": "The JavaScript bundler for React Native apps",
                "time_limit": 120,
            },
            {
                "text": "How do you handle data in a mobile app when the user is offline?",
                "type": "text",
                "model_answer": (
                    "Cache data locally (SQLite or an offline-first store), "
                    "queue writes, sync when connectivity returns, resolve "
                    "conflicts deliberately, and use optimistic updates so "
                    "the UI stays responsive."
                ),
                "time_limit": 300,
            },
        ],
    },
    {
        "title": "Security Analyst",
        "department": "Security",
        "location": "On-site",
        "description": (
            "Detect and respond to threats: monitoring, triage, containment "
            "and clear incident reporting. 5 questions, about 60 minutes."
        ),
        "duration_minutes": 60,
        "questions": [
            {
                "text": "Which control best protects accounts from phishing?",
                "type": "mcq",
                "options": [
                    "Multi-factor authentication",
                    "Shorter password expiry",
                    "IP allowlisting alone",
                    "Security questions",
                ],
                "answer_index": 0,
                "model_answer": "Multi-factor authentication",
                "time_limit": 120,
            },
            {
                "text": "Walk through your first hour after suspecting a workstation is compromised.",
                "type": "text",
                "model_answer": (
                    "Isolate the machine from the network, preserve volatile "
                    "evidence and logs, identify the scope and initial access "
                    "vector, contain the threat, then eradicate, verify and "
                    "report through the incident process with chain of custody."
                ),
                "time_limit": 300,
            },
        ],
    },
]


def _seed_postings() -> None:
    """Insert the example postings once (skipped when any posting exists)."""
    from app.models.posting import JobPosting, PostingQuestion

    db = SessionLocal()
    try:
        if db.query(JobPosting).count() > 0:
            return
        for spec in _DEMO_POSTINGS:
            posting = JobPosting(**{key: value for key, value in spec.items() if key != "questions"})
            db.add(posting)
            db.flush()
            for question in spec["questions"]:
                db.add(PostingQuestion(posting_id=posting.id, **question))
        db.commit()
        print(f"[OK] Seeded {len(_DEMO_POSTINGS)} example job postings")
    finally:
        db.close()