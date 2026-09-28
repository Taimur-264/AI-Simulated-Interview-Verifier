"""
Face Service - OpenCV YuNet detection, MediaPipe Tasks landmarks, InsightFace verification, Liveness detection.

Architecture:
- OpenCV YuNet: Fast face detection (built-in, NO model file needed)
- MediaPipe Tasks API: Face landmarks (auto-downloads model)
- InsightFace/ArcFace: 512-dim face embeddings for verification
- Liveness: Simple challenge-response (blink, head turn)
"""
import cv2
import numpy as np
import pickle
import base64
import logging
import os
import urllib.request
from typing import Optional, Tuple, List, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ---- Configuration ----
FACE_DETECTION_CONFIDENCE = 0.7
FACE_VERIFICATION_THRESHOLD = 0.55
LIVENESS_THRESHOLD = 0.7
EMBEDDING_DIM = 512

# Model paths (auto-downloaded)
FACE_LANDMARKER_MODEL = "face_landmarker.task"
FACE_LANDMARKER_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

# Global model instances
_mp_face_landmarker = None
_insightface_app = None
_yunet_detector = None


def _ensure_model_downloaded(model_path: str, url: str):
    """Download model if not present."""
    if not os.path.exists(model_path):
        logger.info(f"Downloading model to {model_path}...")
        urllib.request.urlretrieve(url, model_path)
        logger.info(f"Downloaded to {model_path}")


def _get_yunet_detector():
    """Lazy-load OpenCV YuNet Face Detector (with downloaded model)."""
    global _yunet_detector
    if _yunet_detector is None:
        try:
            model_path = "yunet.onnx"
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"YuNet model not found at {model_path}")
            
            _yunet_detector = cv2.FaceDetectorYN.create(
                model=model_path,  # Use downloaded model
                config="",
                input_size=(320, 320),
                score_threshold=0.7,
                nms_threshold=0.3,
                top_k=5000,
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU
            )
            logger.info("YuNet face detector initialized with downloaded model")
        except Exception as e:
            logger.error(f"Failed to initialize YuNet detector: {e}")
            raise
    return _yunet_detector


def _get_mp_face_landmarker():
    """Lazy-load MediaPipe Face Landmarker (Tasks API with auto-download)."""
    global _mp_face_landmarker
    if _mp_face_landmarker is None:
        try:
            import mediapipe as mp
            
            model_path = "face_landmarker.task"
            model_url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
            
            if not os.path.exists(model_path):
                logger.info(f"Downloading face landmarker model...")
                urllib.request.urlretrieve(model_url, model_path)
            
            options = mp.tasks.vision.FaceLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_faces=2,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
                output_face_blendshapes=False,
                output_facial_transformation_matrixes=False
            )
            _mp_face_landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        except (ImportError, AttributeError) as e:
            logger.error(f"Failed to initialize face landmarker: {e}")
            raise
    return _mp_face_landmarker


def _get_insightface_app():
    global _insightface_app
    if _insightface_app is None:
        import insightface
        _insightface_app = insightface.app.FaceAnalysis(
            name='buffalo_l',
            providers=['CPUExecutionProvider']
        )
        _insightface_app.prepare(ctx_id=0, det_size=(640, 640))
    return _insightface_app


# ---- Data Classes ----
@dataclass
class FaceDetectionResult:
    """Result of face detection."""
    bbox: Tuple[int, int, int, int]  # x, y, w, h
    confidence: float
    landmarks: Optional[np.ndarray] = None

@dataclass
class VerificationResult:
    """Result of face verification."""
    verified: bool
    similarity: float
    threshold: float
    error: Optional[str] = None


@dataclass
class LivenessResult:
    """Result of liveness check."""
    live: bool
    score: float
    action: str
    details: Dict[str, Any]


# ---- Core Functions ----

def decode_base64_image(data: str) -> np.ndarray:
    try:
        if ',' in data:
            data = data.split(',')[1]
        img_bytes = base64.b64decode(data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {e}")
        return None


def encode_image_base64(img: np.ndarray) -> str:
    _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode('utf-8')


def detect_faces_yunet(img: np.ndarray) -> List[FaceDetectionResult]:
    """Detect faces using OpenCV YuNet (built-in, no model file)."""
    if img is None:
        return []
    
    h, w = img.shape[:2]
    detector = _get_yunet_detector()
    
    # YuNet requires specific input size
    detector.setInputSize((w, h))
    
    _, detections = detector.detect(img)
    
    results = []
    if detections is not None:
        for det in detections:
            x, y, w, h = det[:4].astype(int)
            confidence = det[4]  # YuNet layout: [x1, y1, x2, y2, score, *10 landmark coords]
            
            # Clamp
            x = max(0, min(x, img.shape[1] - 1))
            y = max(0, min(y, img.shape[0] - 1))
            w = min(w, img.shape[1] - x)
            h = min(h, img.shape[0] - y)
            
            results.append(FaceDetectionResult(
                bbox=(x, y, w, h),
                confidence=float(confidence)
            ))
    
    return results


def get_face_landmarks(img: np.ndarray, bbox: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """Get 468 facial landmarks using MediaPipe Face Landmarker."""
    if img is None:
        return None
    
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    x, y, bw, bh = bbox
    center_x, center_y = x + bw // 2, y + bh // 2
    
    try:
        import mediapipe as mp
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        landmarker = _get_mp_face_landmarker()
        landmark_result = landmarker.detect(mp_image)
        
        if landmark_result.face_landmarks:
            best_landmarks = None
            best_dist = float('inf')
            
            for face_landmarks in landmark_result.face_landmarks:
                # Get nose tip (landmark 1) as reference
                nose = face_landmarks[1]  # Tasks API returns list of NormalizedLandmark
                nose_x, nose_y = int(nose.x * w), int(nose.y * h)
                dist = (nose_x - center_x) ** 2 + (nose_y - center_y) ** 2
                
                if dist < best_dist:
                    best_dist = dist
                    best_landmarks = np.array([(lm.x, lm.y, lm.z) for lm in face_landmarks])
            
            return best_landmarks
    except (AttributeError, ImportError) as e:
        logger.error(f"Failed to get face landmarks: {e}")
        return None
    
    return None


def extract_embedding_insightface(img: np.ndarray, bbox: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """
    Extract 512-dim face embedding using InsightFace (ArcFace).
    """
    if img is None:
        return None
    
    try:
        app = _get_insightface_app()
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        # Crop face region with margin
        x, y, w, h = bbox
        margin = int(max(w, h) * 0.3)
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(img.shape[1], x + w + margin)
        y2 = min(img.shape[0], y + h + margin)
        face_crop = rgb[y1:y2, x1:x2]
        
        if face_crop.size == 0:
            return None
        
        faces = app.get(face_crop)
        if not faces:
            return None
        
        # Return normalized embedding (512-dim)
        embedding = faces[0].normed_embedding
        return embedding.astype(np.float32)
    
    except Exception as e:
        logger.error(f"InsightFace embedding extraction failed: {e}")
        return None


def verify_face(embedding1: np.ndarray, embedding2: np.ndarray, threshold: float = FACE_VERIFICATION_THRESHOLD) -> VerificationResult:
    """
    Verify two face embeddings match using cosine similarity.
    """
    try:
        # Normalize
        e1 = embedding1 / np.linalg.norm(embedding1)
        e2 = embedding2 / np.linalg.norm(embedding2)
        
        # Cosine similarity
        similarity = float(np.dot(e1, e2))
        verified = similarity >= threshold
        
        return VerificationResult(
            verified=verified,
            similarity=similarity,
            threshold=threshold
        )
    except Exception as e:
        return VerificationResult(
            verified=False,
            similarity=0.0,
            threshold=threshold,
            error=str(e)
        )


def check_liveness_blink(landmarks: np.ndarray) -> LivenessResult:
    """
    Detect blink using eye aspect ratio (EAR).
    Landmarks: 468 points from MediaPipe Face Mesh.
    Eye landmarks: Left eye [33, 160, 158, 133, 153, 144], Right eye [362, 385, 387, 263, 373, 380]
    """
    if landmarks is None or len(landmarks) < 468:
        return LivenessResult(live=False, score=0.0, action="blink", details={"error": "No landmarks"})
    
    # Eye landmarks indices (MediaPipe Face Mesh)
    LEFT_EYE = [33, 160, 158, 133, 153, 144]
    RIGHT_EYE = [362, 385, 387, 263, 373, 380]
    
    def eye_aspect_ratio(eye_points):
        # Vertical distances
        v1 = np.linalg.norm(eye_points[1] - eye_points[5])
        v2 = np.linalg.norm(eye_points[2] - eye_points[4])
        # Horizontal distance
        h = np.linalg.norm(eye_points[0] - eye_points[3])
        return (v1 + v2) / (2.0 * h) if h > 0 else 0
    
    left_ear = eye_aspect_ratio(landmarks[LEFT_EYE][:, :2])
    right_ear = eye_aspect_ratio(landmarks[RIGHT_EYE][:, :2])
    avg_ear = (left_ear + right_ear) / 2.0
    
    # EAR threshold for blink detection (typically ~0.2-0.25)
    blinked = bool(avg_ear < 0.22)

    return LivenessResult(
        live=blinked,
        score=float(avg_ear),
        action="blink",
        details={"left_ear": float(left_ear), "right_ear": float(right_ear), "avg_ear": float(avg_ear), "threshold": 0.22}
    )


def check_liveness_head_turn(landmarks: np.ndarray, prev_landmarks: Optional[np.ndarray] = None) -> LivenessResult:
    """
    Detect head turn using pose estimation from landmarks.
    Uses nose tip (1) and eye corners to estimate yaw.
    """
    if landmarks is None or len(landmarks) < 468:
        return LivenessResult(live=False, score=0.0, action="head_turn", details={"error": "No landmarks"})
    
    # Key points: nose tip (1), left eye corner (33), right eye corner (263)
    nose = landmarks[1][:2]
    left_eye = landmarks[33][:2]
    right_eye = landmarks[263][:2]
    
    # Calculate yaw from eye-nose geometry
    eye_center = (left_eye + right_eye) / 2
    nose_offset = nose - eye_center
    eye_distance = np.linalg.norm(right_eye - left_eye)
    
    if eye_distance > 0:
        yaw_ratio = nose_offset[0] / eye_distance  # Normalized horizontal offset
    else:
        yaw_ratio = 0
    
    # Detect significant turn - 0.10 normalized nose offset ~ 9-10 degrees,
    # well above the ~0.02 jitter of a frontal face
    turned = bool(abs(yaw_ratio) > 0.10)

    # If we have previous landmarks, check for change
    movement_score: float = 0.0
    if prev_landmarks is not None:
        prev_nose = prev_landmarks[1][:2]
        movement = np.linalg.norm(nose - prev_nose)
        movement_score = float(min(movement / 50.0, 1.0))  # Normalize

    return LivenessResult(
        live=bool(turned or movement_score > 0.3),
        score=float(abs(yaw_ratio) + movement_score),
        action="head_turn",
        details={"yaw_ratio": float(yaw_ratio), "movement_score": movement_score, "turned": turned}
    )


def serialize_embedding(embedding: np.ndarray) -> bytes:
    """Serialize numpy array to bytes for DB storage."""
    return pickle.dumps(embedding)


def deserialize_embedding(data: bytes) -> np.ndarray:
    """Deserialize bytes to numpy array."""
    return pickle.loads(data)


def calculate_image_hash(img: np.ndarray) -> str:
    """Calculate SHA256 hash of image for deduplication."""
    import hashlib
    _, buffer = cv2.imencode('.jpg', img)
    return hashlib.sha256(buffer.tobytes()).hexdigest()


def decode_base64_image(data: str) -> np.ndarray:
    try:
        if ',' in data:
            data = data.split(',')[1]
        img_bytes = base64.b64decode(data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.error(f"Failed to decode base64 image: {e}")
        return None


def encode_image_base64(img: np.ndarray) -> str:
    _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode('utf-8')