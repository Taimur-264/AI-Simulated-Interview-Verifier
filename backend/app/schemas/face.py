"""
Pydantic schemas for Face/Identity Verification API.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ---- Request Schemas ----

class FaceEnrollRequest(BaseModel):
    """Enroll a reference face for a candidate."""
    candidate_id: int = Field(..., description="Candidate user ID")
    image_base64: str = Field(..., description="Base64 encoded face image")
    source: Optional[str] = Field("enrollment", description="Source of reference face")


class FaceVerifyRequest(BaseModel):
    """Verify a face against enrolled reference."""
    candidate_id: int = Field(..., description="Candidate user ID")
    image_base64: str = Field(..., description="Base64 encoded face image")
    interview_id: Optional[int] = Field(None, description="Associated interview ID")


class LivenessCheckRequest(BaseModel):
    """Liveness detection check."""
    candidate_id: int = Field(..., description="Candidate user ID")
    image_base64: str = Field(..., description="Base64 encoded face image")
    action: str = Field(..., description="Liveness action: blink, head_turn")
    previous_landmarks: Optional[List[List[float]]] = Field(None, description="Previous landmarks for comparison")


class ReferenceFaceListRequest(BaseModel):
    """List reference faces for a candidate."""
    candidate_id: int = Field(..., description="Candidate user ID")


# ---- Response Schemas ----

class FaceDetectionResponse(BaseModel):
    """Face detection result."""
    faces_detected: int
    faces: List[Dict[str, Any]]  # bbox, confidence


class FaceEnrollResponse(BaseModel):
    """Face enrollment result."""
    success: bool
    reference_face_id: Optional[int] = None
    quality_score: Optional[float] = None
    faces_detected: int
    error: Optional[str] = None


class FaceVerifyResponse(BaseModel):
    """Face verification result."""
    verified: bool
    similarity: float
    threshold: float
    faces_detected: int
    liveness_verified: Optional[bool] = None
    liveness_score: Optional[float] = None
    liveness_action: Optional[str] = None
    event_id: Optional[int] = None
    error: Optional[str] = None


class LivenessCheckResponse(BaseModel):
    """Liveness check result."""
    live: bool
    score: float
    action: str
    details: Dict[str, Any]


class ReferenceFaceResponse(BaseModel):
    """Reference face info."""
    id: int
    candidate_id: int
    image_hash: Optional[str] = None
    quality_score: Optional[float] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True


class IdentityEventResponse(BaseModel):
    """Identity verification event."""
    id: int
    interview_id: Optional[int] = None
    candidate_id: int
    verified: int
    similarity_score: Optional[float] = None
    threshold_used: Optional[float] = None
    liveness_verified: Optional[int] = None
    liveness_score: Optional[float] = None
    liveness_action: Optional[str] = None
    faces_detected: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True