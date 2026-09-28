"""
Face/Identity models - stores reference face embeddings for verification.
"""
from sqlalchemy import Column, Integer, String, LargeBinary, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ReferenceFace(Base):
    """
    Stores authorized reference face for a candidate.
    One candidate can have multiple reference faces (different angles).
    """
    __tablename__ = "reference_faces"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Face embedding (512-dim vector from InsightFace/ArcFace)
    embedding = Column(LargeBinary, nullable=False)  # Pickled numpy array
    
    # Metadata
    image_hash = Column(String(64), nullable=True)  # SHA256 of source image
    quality_score = Column(Float, nullable=True)    # Face quality 0-1
    source = Column(String(50), default="enrollment")  # enrollment, upload, etc.
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationship
    candidate = relationship("User", backref="reference_faces")


class IdentityVerificationEvent(Base):
    """
    Records identity verification attempts during interview.
    """
    __tablename__ = "identity_verification_events"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, nullable=True, index=True)  # No FK yet - interviews table in later phase
    candidate_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Verification result
    verified = Column(Integer, nullable=False)  # 1=match, 0=mismatch, -1=error
    similarity_score = Column(Float, nullable=True)  # Cosine similarity 0-1
    threshold_used = Column(Float, nullable=True)
    
    # Liveness
    liveness_verified = Column(Integer, nullable=True)  # 1=live, 0=spoof, -1=not checked
    liveness_score = Column(Float, nullable=True)
    liveness_action = Column(String(50), nullable=True)  # blink, head_turn, etc.
    
    # Face detection info
    faces_detected = Column(Integer, nullable=True)
    face_bbox = Column(Text, nullable=True)  # JSON: [x, y, w, h]
    
    # Error/info
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)