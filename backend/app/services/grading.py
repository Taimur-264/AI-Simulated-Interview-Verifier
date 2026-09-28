"""
Answer grading - simple, transparent auto-check for the end-of-interview score.

Rules (documented to the candidate on the /complete screen):
- Multiple choice: exact match with the correct option (case-insensitive), or its letter.
- Written / coding: the answer's significant terms are compared with the terms of the
  reference answer - covering at least 35% of the reference terms counts as correct.

This is a quiz score only. It is never used as an interview verdict (NFR-SAFE-01):
the proctoring timeline and answers are reviewed by a human.
"""
import re
from typing import Any, Dict, Optional

KEYWORD_COVERAGE = 0.35
MIN_ANSWER_CHARS = 15

_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her", "was", "one",
    "our", "out", "get", "has", "him", "his", "how", "its", "new", "now", "old", "see", "two",
    "way", "who", "did", "than", "then", "this", "that", "these", "those", "with", "from",
    "they", "them", "have", "had", "what", "when", "where", "which", "while", "will", "would",
    "could", "should", "about", "into", "over", "under", "after", "before", "between", "because",
    "also", "only", "very", "much", "more", "most", "some", "such", "each", "other", "using",
    "used", "use", "uses", "via", "per", "onto", "does", "doing", "done", "been", "being",
    "may", "might", "must", "shall", "need", "needs", "want", "make", "makes", "made",
    "your", "yours", "they", "their", "there", "here", "how", "why", "yes", "no",
    "code", "function", "returns", "return", "value", "values", "example", "e.g", "ie",
    "answer", "question", "correct", "true", "false", "none", "null", "void", "int", "str",
}


def significant_terms(text: str) -> set:
    """Lowercase alphanumeric terms of length > 2, minus stopwords."""
    tokens = re.findall(r"[a-z0-9_+#.]+", (text or "").lower())
    return {t for t in tokens if len(t) > 2 and t not in _STOPWORDS and not t.endswith(".")}


def grade_answer(question: Dict[str, Any], answer: Optional[str]) -> Dict[str, Any]:
    """
    Grade one answer against its question.

    Returns: {"correct": bool, "method": "mcq" | "keywords" | "unanswered",
              "matched": int, "required": int}
    """
    answer = (answer or "").strip()
    if not answer:
        return {"correct": False, "method": "unanswered", "matched": 0, "required": 0}

    if question.get("type") == "mcq":
        options = question.get("options") or []
        idx = question.get("answer_index")
        if not options or idx is None or idx >= len(options):
            return {"correct": False, "method": "mcq", "matched": 0, "required": 0}
        given = answer.lower()
        expected = options[idx].lower()
        letter_ok = len(given) == 1 and given.isalpha() and (ord(given) - ord("a")) == idx
        return {"correct": given == expected or letter_ok, "method": "mcq", "matched": 0, "required": 0}

    if len(answer) < MIN_ANSWER_CHARS:
        return {"correct": False, "method": "keywords", "matched": 0, "required": 0}

    required = significant_terms(question.get("model_answer", ""))
    if not required:
        return {"correct": False, "method": "keywords", "matched": 0, "required": 0}
    matched = len(required & significant_terms(answer))
    return {
        "correct": (matched / len(required)) >= KEYWORD_COVERAGE,
        "method": "keywords",
        "matched": matched,
        "required": len(required),
    }
