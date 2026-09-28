"""
Event classification (FR-CLASS-01..03) and source tagging (FR-EVENT-02).

Every stored event gets:
  - source         which detector produced it: identity / camera / audio /
                   browser / mouse / keyboard / external / network / system
  - classification Normal | Review | High Review

The classification only *assists* human review - it never decides a candidate's
outcome (NFR-SAFE-01, FR-CLASS-03). Mappings are plain data so labels can be
retuned without touching route code (NFR-MAINT-01).
"""
from typing import Dict, Tuple

CLASS_NORMAL = "normal"
CLASS_REVIEW = "review"
CLASS_HIGH_REVIEW = "high_review"

# Human-readable classification labels for dashboards/reports
CLASSIFICATION_LABELS: Dict[str, str] = {
    CLASS_NORMAL: "Normal",
    CLASS_REVIEW: "Review",
    CLASS_HIGH_REVIEW: "High Review",
}

# event_type -> (source, classification)
_EVENT_MAP: Dict[str, Tuple[str, str]] = {
    # System / flow
    "interview_started": ("system", CLASS_NORMAL),
    "interview_ended": ("system", CLASS_NORMAL),
    "answer_submitted": ("system", CLASS_NORMAL),

    # Identity (per-second re-check)
    "identity_verified": ("identity", CLASS_NORMAL),
    "identity_mismatch": ("identity", CLASS_HIGH_REVIEW),

    # Camera
    "camera_started": ("camera", CLASS_NORMAL),
    "camera_disabled": ("camera", CLASS_HIGH_REVIEW),

    # Audio / microphone (levels only - nothing is recorded)
    "mic_started": ("audio", CLASS_NORMAL),
    "mic_unmuted": ("audio", CLASS_NORMAL),
    "mic_disabled": ("audio", CLASS_REVIEW),
    "mic_muted": ("audio", CLASS_REVIEW),
    "audio_silence": ("audio", CLASS_REVIEW),
    "audio_resumed": ("audio", CLASS_NORMAL),

    # Browser / controlled environment
    "focus_restored": ("browser", CLASS_NORMAL),
    "tab_visible": ("browser", CLASS_NORMAL),
    "fullscreen_entered": ("browser", CLASS_NORMAL),
    "focus_lost": ("browser", CLASS_REVIEW),
    "tab_hidden": ("browser", CLASS_REVIEW),
    "fullscreen_exited": ("browser", CLASS_REVIEW),

    # Network connectivity (FR-NET): losing the connection mid-interview is
    # worth a reviewer's glance; the recovery itself is normal and carries
    # the outage duration as evidence.
    "network_offline": ("network", CLASS_REVIEW),
    "network_online": ("network", CLASS_NORMAL),

    # Keyboard tracer (FR-BROW-01, FR-SECENV-03): keystroke *counts* per
    # interval are normal typing activity; monitored shortcut combinations
    # (new tab/close, window switch, developer tools) are attempts to leave or
    # inspect the controlled environment - review signals, never a verdict.
    "typing_activity": ("keyboard", CLASS_NORMAL),
    "key_shortcut": ("keyboard", CLASS_REVIEW),
    "devtools_shortcut": ("keyboard", CLASS_HIGH_REVIEW),
    "page_search": ("keyboard", CLASS_REVIEW),

    # External resource / AI assistant monitoring (FR-RES-01..03, FR-BROW-06/07).
    # A web page cannot read another tab's address, so these are the observable
    # traces of moving text in/out of the interview or leaving it - reported as
    # events for human review, never as proof of cheating (FR-RES-03).
    "question_copied": ("external", CLASS_REVIEW),
    "pasted_text": ("external", CLASS_REVIEW),
    "page_printed": ("external", CLASS_REVIEW),
    "page_left": ("external", CLASS_HIGH_REVIEW),

    # Mouse / cursor tracer
    "cursor_click": ("mouse", CLASS_NORMAL),
    "cursor_entered": ("mouse", CLASS_NORMAL),
    "cursor_resumed": ("mouse", CLASS_NORMAL),
    "cursor_trace": ("mouse", CLASS_NORMAL),
    "cursor_context_menu": ("mouse", CLASS_REVIEW),
    "cursor_left": ("mouse", CLASS_REVIEW),
    "cursor_idle": ("mouse", CLASS_REVIEW),
}

# Unknown types are still stored, just tagged conservatively.
_DEFAULT_SOURCE = "system"


def classify_event(event_type: str) -> Tuple[str, str]:
    """Return (source, classification) for an event type."""
    return _EVENT_MAP.get(event_type, (_DEFAULT_SOURCE, CLASS_NORMAL))


def is_flagged(classification: str) -> bool:
    """True when the event needs a human's eyes (Review or High Review)."""
    return classification in (CLASS_REVIEW, CLASS_HIGH_REVIEW)
