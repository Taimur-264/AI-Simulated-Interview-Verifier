"""
Face/Identity Verification API endpoints.

Endpoints:
- POST   /api/v1/face/enroll - Enroll reference face
- POST   /api/v1/face/verify - Verify face against reference
- POST   /api/v1/face/liveness - Liveness detection
- GET  /api/v1/face/reference/{candidate_id} - List reference faces
- GET  /api/v1/face/events/{interview_id} - Get identity events
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

import numpy as np

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.core.security import get_current_user
from app.models.user import User
from app.models.face import ReferenceFace, IdentityVerificationEvent
from app.schemas.face import (
    FaceEnrollRequest, FaceVerifyRequest, LivenessCheckRequest,
    FaceEnrollResponse, FaceVerifyResponse, LivenessCheckResponse,
    ReferenceFaceResponse, IdentityEventResponse
)
from app.services.face_service import (
    decode_base64_image, 
    detect_faces_yunet,  # CHANGED: detect_faces_yunet instead of detect_faces_mediapipe
    extract_embedding_insightface,
    verify_face, 
    check_liveness_blink, 
    check_liveness_head_turn,
    serialize_embedding,
    deserialize_embedding,
    calculate_image_hash,
    get_face_landmarks,
)

router = APIRouter(prefix="/face", tags=["Face Verification"])


@router.post("/enroll", response_model=FaceEnrollResponse, status_code=status.HTTP_201_CREATED)
def enroll_reference_face(
    request: FaceEnrollRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Enroll a reference face for a candidate.
    
    - **candidate_id**: Target candidate (admin can enroll for others)
    - **image_base64**: Base64 encoded face image
    - **source**: Source identifier (enrollment, upload, etc.)
    
    Re-enrolling REPLACES any previously stored reference face for this
    candidate - one enrolled identity per account, so a second person can
    never be added alongside the first and pass the identity check.

    Returns: Reference face ID and quality score
    """
    # Authorization: users can only enroll for themselves unless admin
    if current_user.id != request.candidate_id:
        # TODO: Add admin check
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only enroll reference face for yourself"
        )
    
    # Decode image
    img = decode_base64_image(request.image_base64)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    
    # Detect faces using YuNet (OpenCV built-in)
    detections = detect_faces_yunet(img)
    if not detections:
        return FaceEnrollResponse(
            success=False,
            faces_detected=0,
            error="No face detected in image"
        )
    
    if len(detections) > 1:
        return FaceEnrollResponse(
            success=False,
            faces_detected=len(detections),
            error="Multiple faces detected. Please provide image with single face."
        )
    
    # Use best detection
    best_det = max(detections, key=lambda d: d.confidence)
    bbox = best_det.bbox
    
    # Extract embedding
    embedding = extract_embedding_insightface(img, bbox)
    if embedding is None:
        return FaceEnrollResponse(
            success=False,
            faces_detected=1,
            error="Failed to extract face embedding"
        )
    
    # Calculate quality score (based on detection confidence and face size)
    face_area = bbox[2] * bbox[3]
    img_area = img.shape[0] * img.shape[1]
    size_ratio = face_area / img_area
    quality_score = float(min(best_det.confidence * size_ratio * 10, 1.0))
    
    # Store in database - re-enrolment REPLACES the previous reference face(s):
    # one enrolled identity per candidate. The old append behaviour let a second
    # person be enrolled on the same account, and either face would then pass
    # the identity check. This runs only after the new capture produced a good
    # embedding, so a failed enrolment never discards the face already on file.
    db.query(ReferenceFace).filter(
        ReferenceFace.candidate_id == request.candidate_id
    ).delete(synchronize_session=False)
    ref_face = ReferenceFace(
        candidate_id=request.candidate_id,
        embedding=serialize_embedding(embedding),
        image_hash=calculate_image_hash(img),
        quality_score=quality_score,
        source=request.source
    )
    
    db.add(ref_face)
    db.commit()
    db.refresh(ref_face)
    
    return FaceEnrollResponse(
        success=True,
        reference_face_id=ref_face.id,
        quality_score=quality_score,
        faces_detected=1
    )


def _record_verify_event(
    db: Session,
    request: FaceVerifyRequest,
    *,
    verified: bool,
    similarity: Optional[float],
    faces_detected: int,
    bbox: Optional[tuple] = None,
    error: Optional[str] = None,
) -> Optional[int]:
    """
    Persist an identity event - for EVERY outcome, not only for successes.

    The frontend re-checks every second, so the stored trail is condensed:
    every status change is written, plus a sample at most every 10 seconds
    while the status stays the same. Recording only the successful
    comparisons (the old behaviour) made the trail end green no matter how
    long the candidate sat away from the camera - absences must be in there
    too, so a human reviewer sees the real picture.
    """
    verified_flag = 1 if verified else 0

    event_query = db.query(IdentityVerificationEvent).filter(
        IdentityVerificationEvent.candidate_id == request.candidate_id
    )
    if request.interview_id is not None:
        event_query = event_query.filter(IdentityVerificationEvent.interview_id == request.interview_id)
    else:
        event_query = event_query.filter(IdentityVerificationEvent.interview_id.is_(None))
    last_event = event_query.order_by(IdentityVerificationEvent.id.desc()).first()

    should_log = True
    if last_event is not None:
        last_at = last_event.created_at
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - last_at).total_seconds()
        should_log = last_event.verified != verified_flag or age_seconds >= 10

    event_id = last_event.id if last_event is not None else None
    if should_log:
        event = IdentityVerificationEvent(
            interview_id=request.interview_id,
            candidate_id=request.candidate_id,
            verified=verified_flag,
            similarity_score=similarity,
            # no comparison happened on the error paths - no threshold applied
            threshold_used=None if error else 0.55,
            faces_detected=faces_detected,
            face_bbox=str(bbox) if bbox is not None else None,
            error_message=error,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        event_id = event.id
    return event_id


@router.post("/verify", response_model=FaceVerifyResponse)
def verify_face_endpoint(
    request: FaceVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Verify a face against enrolled reference faces.
    
    - **candidate_id**: Candidate to verify
    - **image_base64**: Base64 encoded face image
    - **interview_id**: Optional interview ID for event logging
    
    Returns: Verification result with similarity score
    """
    # Cap face-detection compute per candidate - the per-second re-check fits
    # the default budget (100/min) with headroom for retries (NFR-SEC-02).
    enforce_rate_limit(
        scope="identity verification",
        key=f"verify|user:{current_user.id}",
        limit=settings.VERIFY_RATE_LIMIT,
        window_seconds=settings.VERIFY_RATE_WINDOW_SECONDS,
    )

    # Get reference faces for candidate
    ref_faces = db.query(ReferenceFace).filter(
        ReferenceFace.candidate_id == request.candidate_id
    ).all()
    
    if not ref_faces:
        raise HTTPException(
            status_code=404,
            detail="No reference faces enrolled for this candidate"
        )
    
    # Decode image
    img = decode_base64_image(request.image_base64)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    
    # Detect faces - an empty frame means the candidate is not in front of
    # the camera; that absence is recorded like any other outcome.
    detections = detect_faces_yunet(img)
    if not detections:
        event_id = _record_verify_event(
            db, request, verified=False, similarity=None,
            faces_detected=0, error="No face detected",
        )
        return FaceVerifyResponse(
            verified=False,
            similarity=0.0,
            threshold=0.55,
            faces_detected=0,
            event_id=event_id,
            error="No face detected"
        )
    
    if len(detections) > 1:
        event_id = _record_verify_event(
            db, request, verified=False, similarity=None,
            faces_detected=len(detections), error="Multiple faces detected",
        )
        return FaceVerifyResponse(
            verified=False,
            similarity=0.0,
            threshold=0.55,
            faces_detected=len(detections),
            event_id=event_id,
            error="Multiple faces detected"
        )
    
    # Use best detection
    best_det = max(detections, key=lambda d: d.confidence)
    bbox = best_det.bbox
    
    # Extract embedding from current frame
    current_embedding = extract_embedding_insightface(img, bbox)
    if current_embedding is None:
        event_id = _record_verify_event(
            db, request, verified=False, similarity=None,
            faces_detected=1, bbox=bbox, error="Failed to extract face embedding",
        )
        return FaceVerifyResponse(
            verified=False,
            similarity=0.0,
            threshold=0.55,
            faces_detected=1,
            event_id=event_id,
            error="Failed to extract face embedding"
        )
    
    # Compare against all reference faces
    best_similarity = 0.0
    best_verified = False
    
    for ref_face in ref_faces:
        ref_embedding = deserialize_embedding(ref_face.embedding)
        result = verify_face(current_embedding, ref_embedding)
        if result.similarity > best_similarity:
            best_similarity = result.similarity
            best_verified = result.verified
    
    event_id = _record_verify_event(
        db, request, verified=best_verified, similarity=best_similarity,
        faces_detected=1, bbox=bbox,
    )

    return FaceVerifyResponse(
        verified=best_verified,
        similarity=best_similarity,
        threshold=0.55,
        faces_detected=len(detections),
        event_id=event_id
    )


@router.post("/liveness", response_model=LivenessCheckResponse)
def liveness_check(
    request: LivenessCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Perform liveness detection (blink or head turn).
    
    - **action**: "blink" or "head_turn"
    - **previous_landmarks**: For head_turn comparison
    """
    img = decode_base64_image(request.image_base64)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    
    detections = detect_faces_yunet(img)
    if not detections:
        return LivenessCheckResponse(
            live=False, score=0.0, action=request.action,
            details={"error": "No face detected"}
        )
    
    best_det = max(detections, key=lambda d: d.confidence)
    bbox = best_det.bbox
    
    # Get landmarks
    landmarks = get_face_landmarks(img, bbox)
    if landmarks is None:
        return LivenessCheckResponse(
            live=False, score=0.0, action=request.action,
            details={"error": "Could not detect facial landmarks"}
        )
    
    # Parse previous landmarks if provided
    prev_landmarks = None
    if request.previous_landmarks:
        prev_landmarks = np.array(request.previous_landmarks)
    
    if request.action == "blink":
        result = check_liveness_blink(landmarks)
    elif request.action == "head_turn":
        result = check_liveness_head_turn(landmarks, prev_landmarks)
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use 'blink' or 'head_turn'")
    
    return LivenessCheckResponse(
        live=result.live,
        score=result.score,
        action=result.action,
        details=result.details
    )


@router.get("/reference/{candidate_id}", response_model=List[ReferenceFaceResponse])
def get_reference_faces(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all reference faces for a candidate."""
    if current_user.id != candidate_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    ref_faces = db.query(ReferenceFace).filter(
        ReferenceFace.candidate_id == candidate_id
    ).order_by(ReferenceFace.created_at.desc()).all()
    
    return ref_faces


@router.get("/events/{interview_id}", response_model=List[IdentityEventResponse])
def get_identity_events(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get identity verification events for an interview."""
    events = db.query(IdentityVerificationEvent).filter(
        IdentityVerificationEvent.interview_id == interview_id
    ).order_by(IdentityVerificationEvent.created_at.desc()).all()
    
    return events