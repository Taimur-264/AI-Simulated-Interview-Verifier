"""
Recruiter dashboard data (FR-ADMIN-01..05) and security reports (FR-REPORT-01..05).

Everything here is read-only reporting over stored rows:
- list_sessions()      candidate list with status, score and flag counts
- session_detail()     one session: identity info, answers, flags, timeline
- build_report()       post-interview security report (FR-REPORT-01..05)

Classifications and incidents are advisory context for a human reviewer only -
nothing here produces a verdict (NFR-SAFE-01, FR-CLASS-03, FR-AI-04).
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.face import IdentityVerificationEvent, ReferenceFace
from app.models.interview import Interview, InterviewEvent, InterviewQuestion
from app.models.user import User
from app.services.event_classification import (
    CLASSIFICATION_LABELS,
    CLASS_HIGH_REVIEW,
    CLASS_REVIEW,
    is_flagged,
)

# How many repeats of one flagged event make it an "incident" (FR-AI-01..03)
INCIDENT_MIN_REPEATS = 2

REVIEW_REQUIRED = "requires_review"
REVIEW_CLEAR = "clear"

_STATUS_LABELS = {
    REVIEW_REQUIRED: "Requires Human Review",
    REVIEW_CLEAR: "No review flags",
}
_STATUS_NOTE = (
    "Advisory only - flags are signals for a reviewer, never an automatic "
    "decision about the candidate (NFR-SAFE-01)."
)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Normalize naive DB datetimes to UTC so durations are correct."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    aware = _aware(dt)
    return aware.isoformat().replace("+00:00", "Z") if aware else None


def _duration_seconds(interview: Interview) -> Optional[int]:
    start = _aware(interview.started_at)
    if start is None:
        return None
    end = _aware(interview.ended_at) or datetime.now(timezone.utc)
    return max(0, int((end - start).total_seconds()))


def _status(flags_review: int, flags_high: int, mismatches: int = 0) -> Dict[str, str]:
    code = REVIEW_REQUIRED if (flags_review or flags_high or mismatches) else REVIEW_CLEAR
    return {"code": code, "label": _STATUS_LABELS[code], "note": _STATUS_NOTE}


def _candidate_payload(user: Optional[User]) -> Optional[Dict[str, Any]]:
    if user is None:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
    }


def _event_counts(db: Session, interview_ids: List[int]) -> Dict[int, Dict[str, int]]:
    """{interview_id: {"total": n, "review": n, "high_review": n}} in one query."""
    counts: Dict[int, Dict[str, int]] = {i: {"total": 0, "review": 0, "high_review": 0} for i in interview_ids}
    if not interview_ids:
        return counts
    rows = (
        db.query(
            InterviewEvent.interview_id,
            InterviewEvent.classification,
            func.count(InterviewEvent.id),
        )
        .filter(InterviewEvent.interview_id.in_(interview_ids))
        .group_by(InterviewEvent.interview_id, InterviewEvent.classification)
        .all()
    )
    for interview_id, classification, count in rows:
        bucket = counts.setdefault(interview_id, {"total": 0, "review": 0, "high_review": 0})
        bucket["total"] += int(count)
        if classification in bucket:
            bucket[classification] += int(count)
    return counts


def _mismatch_counts(db: Session, interview_ids: List[int]) -> Dict[int, int]:
    """{interview_id: number of stored identity mismatches} in one query."""
    if not interview_ids:
        return {}
    rows = (
        db.query(IdentityVerificationEvent.interview_id, func.count(IdentityVerificationEvent.id))
        .filter(
            IdentityVerificationEvent.interview_id.in_(interview_ids),
            IdentityVerificationEvent.verified == 0,
        )
        .group_by(IdentityVerificationEvent.interview_id)
        .all()
    )
    return {interview_id: int(count) for interview_id, count in rows if interview_id is not None}


def list_sessions(db: Session) -> List[Dict[str, Any]]:
    """All interviews, newest first, with candidate + flag summary (FR-ADMIN-01/02)."""
    interviews = db.query(Interview).order_by(Interview.id.desc()).all()
    if not interviews:
        return []

    ids = [i.id for i in interviews]
    event_counts = _event_counts(db, ids)
    mismatches = _mismatch_counts(db, ids)

    candidate_ids = {i.candidate_id for i in interviews}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(candidate_ids)).all()}

    items = []
    for interview in interviews:
        counts = event_counts.get(interview.id, {"total": 0, "review": 0, "high_review": 0})
        mismatch = mismatches.get(interview.id, 0)
        score = None
        if interview.score_total is not None:
            score = {"correct": interview.score_correct or 0, "total": interview.score_total}
        items.append(
            {
                "id": interview.id,
                "title": interview.title,
                "status": interview.status,
                "started_at": _iso(interview.started_at),
                "ended_at": _iso(interview.ended_at),
                "duration_minutes": interview.duration_minutes,
                "actual_duration_seconds": _duration_seconds(interview),
                "score": score,
                "candidate": _candidate_payload(users.get(interview.candidate_id)),
                "events_total": counts["total"],
                "flags": {
                    "review": counts["review"],
                    "high_review": counts["high_review"],
                    "total": counts["review"] + counts["high_review"],
                },
                "identity_mismatches": mismatch,
                "review_status": _status(counts["review"], counts["high_review"], mismatch),
            }
        )
    return items


def _identity_summary(db: Session, interview: Interview) -> Dict[str, Any]:
    """Reference-face presence + condensed identity check history (FR-ID-01..04)."""
    reference_faces = (
        db.query(func.count(ReferenceFace.id))
        .filter(ReferenceFace.candidate_id == interview.candidate_id)
        .scalar()
        or 0
    )
    rows = (
        db.query(IdentityVerificationEvent)
        .filter(IdentityVerificationEvent.interview_id == interview.id)
        .order_by(IdentityVerificationEvent.id.asc())
        .all()
    )
    mismatches = [r for r in rows if r.verified == 0]
    last = rows[-1] if rows else None
    return {
        "reference_faces": int(reference_faces),
        "checks": len(rows),
        "mismatches": len(mismatches),
        "last_similarity": round(last.similarity_score, 4) if last and last.similarity_score is not None else None,
        "last_check_at": _iso(last.created_at) if last else None,
    }


def _timeline(db: Session, interview: Interview) -> List[Dict[str, Any]]:
    """Chronological proctoring events (FR-EVENT-03/04, FR-ADMIN-04)."""
    entries = []
    for event in interview.events:  # ordered by timestamp
        entries.append(
            {
                "id": event.id,
                "timestamp": _iso(event.timestamp),
                "event_type": event.event_type,
                "source": event.source,
                "classification": event.classification,
                "classification_label": CLASSIFICATION_LABELS.get(event.classification, event.classification),
                "data": event.data or {},
            }
        )
    return entries


def _external_activity(timeline: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    External resource / AI assistant indicators (FR-RES-01..03, FR-BROW-06/07).

    Browser security means a page can never read another tab's address, so
    "AI site X was open" is not directly observable. What *is* observable are
    the traces of using an outside resource: copying the question out, pasting
    an answer in, printing, long absences (focus/tab away), and leaving the
    interview page. These are reported as events for a human to judge - never
    as an automatic conclusion of cheating (FR-RES-03).
    """
    copied = pasted = printed = left = 0
    longest_absence_ms = 0.0
    copied_snippet = ""
    pasted_snippet = ""
    pasted_length = 0

    for entry in timeline:
        event_type = entry["event_type"]
        data = entry.get("data") or {}
        if event_type == "question_copied":
            copied += 1
            snippet = data.get("snippet")
            if isinstance(snippet, str) and snippet.strip():
                copied_snippet = snippet  # keep the latest: closest before a lookup
        elif event_type == "pasted_text":
            pasted += 1
            snippet = data.get("snippet")
            if isinstance(snippet, str) and snippet.strip():
                pasted_snippet = snippet
            length = data.get("length")
            if isinstance(length, (int, float)):
                pasted_length = int(length)
        elif event_type == "page_printed":
            printed += 1
        elif event_type == "page_left":
            left += 1
        for key in ("away_ms", "hidden_ms"):
            value = data.get(key)
            if isinstance(value, (int, float)):
                longest_absence_ms = max(longest_absence_ms, float(value))

    longest_absence_seconds = int(longest_absence_ms // 1000)
    # Any text moved in/out of the interview, any page exit, or an absence of
    # >= 5s is worth a reviewer's eyes.
    possible = bool(copied or pasted or printed or left or longest_absence_seconds >= 5)

    # Sharper "did they search for it outside?" pattern: text taken out and/or
    # brought back around a gap in presence. The copied snippet shows *what*
    # was taken (usually the question = the search query); the pasted snippet
    # shows *what came back* (the found/AI-generated answer). The reviewer
    # reads these to judge the type of search - never an automatic verdict.
    possible_lookup = bool((copied or pasted) and (longest_absence_seconds >= 5 or left))
    evidence = ""
    if possible_lookup:
        parts = []
        if copied_snippet:
            parts.append(f'copied out: "{copied_snippet[:90]}"')
        parts.append(f"away {longest_absence_seconds}s")
        if pasted_snippet:
            shown = pasted_snippet[:120]
            total = pasted_length or len(pasted_snippet)
            parts.append(f'pasted back ({total} chars): "{shown}"')
        evidence = "; ".join(parts)

    return {
        "copied": copied,
        "pasted": pasted,
        "printed": printed,
        "left_page": left,
        "longest_absence_seconds": longest_absence_seconds,
        "possible_external_use": possible,
        "possible_lookup": possible_lookup,
        "copied_snippet": copied_snippet,
        "pasted_snippet": pasted_snippet,
        "lookup_evidence": evidence,
        "note": (
            "Signals that an outside resource (AI assistant, search, another tab or "
            "device) may have been used. Observable copy/paste/print, focus and tab "
            "absence, and page exits are correlated here as review context - an "
            "event for human review, not proof of cheating (FR-RES-03)."
        ),
    }


def _keyboard_activity(timeline: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Keyboard tracer summary (FR-BROW-01, FR-SECENV-03).

    Keystroke counts, the characters typed *inside the interview page* (answer
    drafts), and monitored shortcut/search combinations. Keys typed in other
    tabs, the browser address bar or other applications are NOT observable by
    any web page (browser security) - those surface indirectly as focus, tab
    or page-exit events. Advisory - a signal for human review, never a verdict
    (FR-RES-03, NFR-SAFE-01).
    """
    total_keys = 0
    typing_sessions = 0
    shortcuts: Dict[str, int] = {}
    devtools: Dict[str, int] = {}
    searches: Dict[str, int] = {}
    typed_parts: List[str] = []
    typed_chars = 0

    for entry in timeline:
        event_type = entry["event_type"]
        data = entry.get("data") or {}
        if event_type == "typing_activity":
            typing_sessions += 1
            keys = data.get("keys")
            if isinstance(keys, (int, float)):
                total_keys += int(keys)
            typed = data.get("typed")
            if isinstance(typed, str) and typed:
                typed_parts.append(typed)
                typed_chars += len(typed)
        elif event_type in ("key_shortcut", "devtools_shortcut", "page_search"):
            combo = str(data.get("combo") or "unknown")
            if event_type == "devtools_shortcut":
                devtools[combo] = devtools.get(combo, 0) + 1
            elif event_type == "page_search":
                searches[combo] = searches.get(combo, 0) + 1
            else:
                shortcuts[combo] = shortcuts.get(combo, 0) + 1

    shortcut_attempts = sum(shortcuts.values())
    devtools_attempts = sum(devtools.values())
    return {
        "total_keys": total_keys,
        "typing_sessions": typing_sessions,
        "shortcuts": shortcuts,
        "shortcut_attempts": shortcut_attempts,
        "devtools": devtools,
        "devtools_attempts": devtools_attempts,
        "searches": searches,
        "search_attempts": sum(searches.values()),
        "typed_content": "".join(typed_parts)[:4000],
        "typed_chars": typed_chars,
        "environment_switch_attempted": bool(shortcut_attempts or devtools_attempts),
        "note": (
            "Keystroke counts, characters typed inside the interview page "
            "(answer drafts) and monitored shortcut/search combinations. Keys "
            "typed in other tabs, the address bar or other applications are "
            "not observable by any web page - those appear indirectly as "
            "focus, tab or page-exit events. Advisory for human review, "
            "never a verdict (NFR-SAFE-01)."
        ),
    }


def _incidents(timeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Correlate repeated flagged signals into reviewable incidents (FR-AI-01..03):
    what happened, how often, and when it started/last occurred.
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for entry in timeline:
        if not is_flagged(entry["classification"]):
            continue
        group = groups.get(entry["event_type"])
        if group is None:
            groups[entry["event_type"]] = {
                "event_type": entry["event_type"],
                "source": entry["source"],
                "classification": entry["classification"],
                "classification_label": entry["classification_label"],
                "count": 1,
                "first_at": entry["timestamp"],
                "last_at": entry["timestamp"],
            }
        else:
            group["count"] += 1
            group["last_at"] = entry["timestamp"]

    incidents = sorted(
        groups.values(),
        key=lambda g: (0 if g["classification"] == CLASS_HIGH_REVIEW else 1, -g["count"]),
    )
    for incident in incidents:
        incident["repeated"] = incident["count"] >= INCIDENT_MIN_REPEATS
    return incidents


def _questions(db: Session, interview: Interview) -> List[Dict[str, Any]]:
    rows = (
        db.query(InterviewQuestion)
        .filter(InterviewQuestion.interview_id == interview.id)
        .order_by(InterviewQuestion.position.asc())
        .all()
    )
    return [
        {
            "position": row.position,
            "text": row.text,
            "type": row.type,
            "options": row.options,
            "time_limit": row.time_limit,
            "model_answer": row.model_answer,
            "your_answer": row.your_answer,
            "correct": row.correct,
            "grading_method": row.grading_method,
        }
        for row in rows
    ]


def session_detail(db: Session, interview: Interview) -> Dict[str, Any]:
    """Full review payload for one session (FR-ADMIN-03/04)."""
    timeline = _timeline(db, interview)
    incidents = _incidents(timeline)
    identity = _identity_summary(db, interview)

    by_classification: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    for entry in timeline:
        by_classification[entry["classification"]] = by_classification.get(entry["classification"], 0) + 1
        by_source[entry["source"]] = by_source.get(entry["source"], 0) + 1

    review_count = by_classification.get(CLASS_REVIEW, 0)
    high_count = by_classification.get(CLASS_HIGH_REVIEW, 0)
    score = None
    if interview.score_total is not None:
        score = {"correct": interview.score_correct or 0, "total": interview.score_total}

    candidate = db.get(User, interview.candidate_id)
    return {
        "interview": {
            "id": interview.id,
            "title": interview.title,
            "status": interview.status,
            "started_at": _iso(interview.started_at),
            "ended_at": _iso(interview.ended_at),
            "duration_minutes": interview.duration_minutes,
            "actual_duration_seconds": _duration_seconds(interview),
            "score": score,
        },
        "candidate": _candidate_payload(candidate),
        "summary": {
            "events_total": len(timeline),
            "by_classification": by_classification,
            "by_source": by_source,
        },
        "flags": {"review": review_count, "high_review": high_count, "total": review_count + high_count},
        "review_status": _status(review_count, high_count, identity["mismatches"]),
        "identity": identity,
        "incidents": incidents,
        "external_activity": _external_activity(timeline),
        "keyboard_activity": _keyboard_activity(timeline),
        "timeline": timeline,
        "questions": _questions(db, interview),
    }


def build_report(db: Session, interview: Interview) -> Dict[str, Any]:
    """Post-interview security report (FR-REPORT-01..05, FR-ADMIN-05)."""
    detail = session_detail(db, interview)
    flagged = [
        {
            "timestamp": entry["timestamp"],
            "event_type": entry["event_type"],
            "source": entry["source"],
            "classification": entry["classification"],
            "classification_label": entry["classification_label"],
            "data": entry["data"],
        }
        for entry in detail["timeline"]
        if is_flagged(entry["classification"])
    ]
    return {
        "report_type": "Interview Security Report",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "interview": detail["interview"],
        "candidate": detail["candidate"],
        # FR-REPORT-05: a review-oriented status, never a verdict
        "final_status": detail["review_status"],
        "score": detail["interview"]["score"],
        # FR-REPORT-03: camera / browser / mouse / audio / identity summaries
        "event_summary": detail["summary"],
        "identity": detail["identity"],
        "incidents": detail["incidents"],
        # FR-RES-02/03: observable external-resource activity, as an event
        "external_activity": detail["external_activity"],
        # FR-BROW-01, FR-SECENV-03: keystroke counts and shortcut attempts
        "keyboard_activity": detail["keyboard_activity"],
        # FR-REPORT-04: important events with timestamps
        "important_events": flagged,
        "important_event_count": len(flagged),
    }
