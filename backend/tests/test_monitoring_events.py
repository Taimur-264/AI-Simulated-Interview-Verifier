"""
External-resource / AI-assistant monitoring smoke test
(FR-BROW-03/06/07, FR-RES-01..03, keyboard tracer evidence).

Copies/paste/print/page-exit and keyboard events must be:
  - stored with the right source and Review/High Review classification
  - summarized in /review/interviews/{id} as external_activity + keyboard_activity
  - included in the security report
  - advisory only (no automatic verdicts, NFR-SAFE-01)

Also covers network connectivity events (FR-NET): an outage is recorded with
its duration and never treated as a verdict.

Each test runs the full flow (register -> promote -> start -> post events ->
end) against its own throwaway account; teardown removes everything.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

TYPED = ("Deadlock is a state where two processes wait for each other"
         "{Enter}hold and wait")

EVENTS = [
    ("interview_started", {}),
    ("question_copied", {"length": 84,
                         "snippet": "Explain the difference between a list and a tuple in Python..."}),
    ("focus_lost", {"path": "/interview"}),
    ("focus_restored", {"away_ms": 42_000}),
    ("tab_hidden", {}),
    ("tab_visible", {"hidden_ms": 17_000}),
    ("pasted_text", {"length": 320,
                     "snippet": "Lists are mutable, tuples are immutable and hashable..."}),
    ("page_printed", {}),
    ("page_left", {"path": "/interview"}),
    # network connectivity (FR-NET)
    ("network_offline", {}),
    ("network_online", {"offline_ms": 25_000}),
    # keyboard tracer
    ("typing_activity", {"keys": 412, "input_keys": 380, "other_keys": 32, "typed": TYPED}),
    ("key_shortcut", {"combo": "CTRL+T", "key": "T"}),
    ("key_shortcut", {"combo": "CTRL+T", "key": "T"}),
    ("devtools_shortcut", {"combo": "CTRL+SHIFT+I", "key": "I"}),
    ("page_search", {"combo": "CTRL+F", "key": "F"}),
]


@pytest.fixture()
def monitored(api, new_user, promote):
    """A finished interview seeded with the full external/keyboard event set."""
    user = new_user("ext.monitor")
    promote(user.email, "recruiter")  # review endpoints are role-gated

    status, interview = api("POST", "/interview/start", token=user.token,
                            body={"title": "External monitor test", "duration_minutes": 30})
    assert status == 200 and interview.get("id"), f"start failed: {status} {interview!r}"
    iid = interview["id"]

    for event_type, data in EVENTS:
        status, body = api("POST", f"/interview/{iid}/event", token=user.token,
                           body={"event_type": event_type,
                                 "timestamp": "2026-09-28T18:00:00Z", "data": data})
        assert status == 200, f"log {event_type} failed: {status} {body!r}"

    status, _ = api("POST", f"/interview/{iid}/end", token=user.token)
    assert status == 200, f"end interview failed: {status}"

    cache: dict[str, SimpleNamespace] = {}

    def detail():
        if "detail" not in cache:
            status, body = api("GET", f"/review/interviews/{iid}", token=user.token)
            assert status == 200, f"detail failed: {status} {body!r}"
            cache["detail"] = body
        return cache["detail"]

    def report():
        if "report" not in cache:
            status, body = api("GET", f"/review/interviews/{iid}/report", token=user.token)
            assert status == 200, f"report failed: {status} {body!r}"
            cache["report"] = body
        return cache["report"]

    return SimpleNamespace(user=user, iid=iid, detail=detail, report=report)


# --------------------------------------------------------------------------- #
# External activity summary (FR-RES-01..03)
# --------------------------------------------------------------------------- #
def test_external_activity_summary(monitored):
    detail = monitored.detail()
    ext = detail.get("external_activity") or {}
    assert ext, f"external_activity missing: keys={list(detail)}"

    assert (ext.get("copied") == 1 and ext.get("pasted") == 1
            and ext.get("printed") == 1 and ext.get("left_page") == 1), \
        f"unexpected external counts: {ext}"
    # focus away (42s) beats tab hidden (17s)
    assert ext.get("longest_absence_seconds") == 42, f"unexpected absence: {ext}"
    assert ext.get("possible_external_use") is True, f"not flagged: {ext}"
    # FR-RES-03: advisory only - never an automatic verdict (NFR-SAFE-01)
    assert "not proof of cheating" in (ext.get("note") or ""), \
        f"advisory note missing: {ext.get('note')!r}"


# --------------------------------------------------------------------------- #
# Per-event source + classification
# --------------------------------------------------------------------------- #
def test_event_sources_and_classifications(monitored):
    detail = monitored.detail()
    classes = {e["event_type"]: (e["source"], e["classification"])
               for e in detail["timeline"]
               if e["event_type"] in ("question_copied", "pasted_text", "page_printed",
                                      "page_left", "typing_activity", "key_shortcut",
                                      "devtools_shortcut", "page_search",
                                      "network_offline", "network_online")}

    assert classes.get("question_copied") == ("external", "review"), classes
    assert classes.get("pasted_text") == ("external", "review"), classes
    assert classes.get("page_printed") == ("external", "review"), classes
    assert classes.get("page_left") == ("external", "high_review"), classes
    assert classes.get("typing_activity") == ("keyboard", "normal"), classes
    assert classes.get("key_shortcut") == ("keyboard", "review"), classes
    assert classes.get("devtools_shortcut") == ("keyboard", "high_review"), classes
    assert classes.get("page_search") == ("keyboard", "review"), classes
    assert classes.get("network_offline") == ("network", "review"), classes
    assert classes.get("network_online") == ("network", "normal"), classes

    restored = next((e for e in detail["timeline"] if e["event_type"] == "focus_restored"),
                    None)
    assert restored and restored.get("data", {}).get("away_ms") == 42_000, \
        f"absence not recorded on restore: {restored}"

    reconnected = next((e for e in detail["timeline"] if e["event_type"] == "network_online"),
                       None)
    assert reconnected and reconnected.get("data", {}).get("offline_ms") == 25_000, \
        f"outage duration not recorded on reconnect: {reconnected}"


# --------------------------------------------------------------------------- #
# External lookup evidence (FR-RES-02)
# --------------------------------------------------------------------------- #
def test_lookup_evidence(monitored):
    ext = monitored.detail().get("external_activity") or {}
    assert ext.get("possible_lookup") is True, f"not flagged: {ext}"
    evidence = ext.get("lookup_evidence") or ""
    assert 'copied out: "Explain the difference' in evidence, evidence
    assert "pasted back (320 chars)" in evidence, evidence
    assert "away 42s" in evidence, evidence
    assert (ext.get("pasted_snippet") or "").startswith("Lists are mutable"), \
        f"pasted snippet lost: {ext.get('pasted_snippet')!r}"


# --------------------------------------------------------------------------- #
# Keyboard activity summary (keyboard tracer evidence)
# --------------------------------------------------------------------------- #
def test_keyboard_activity_summary(monitored):
    kb = monitored.detail().get("keyboard_activity") or {}
    assert kb, f"keyboard_activity missing: keys={list(monitored.detail())}"

    assert kb.get("total_keys") == 412 and kb.get("typing_sessions") == 1, kb
    assert kb.get("shortcuts") == {"CTRL+T": 2} and kb.get("shortcut_attempts") == 2, kb
    assert kb.get("devtools") == {"CTRL+SHIFT+I": 1} and kb.get("devtools_attempts") == 1, kb
    assert kb.get("searches") == {"CTRL+F": 1} and kb.get("search_attempts") == 1, kb
    assert (kb.get("typed_content") == TYPED
            and kb.get("typed_chars") == len(TYPED)), \
        f"typed content mismatch: {kb.get('typed_chars')}"
    assert kb.get("environment_switch_attempted") is True, kb
    assert "not observable by any web page" in (kb.get("note") or ""), \
        f"observability note missing: {kb.get('note')!r}"


# --------------------------------------------------------------------------- #
# Security report (FR-REP-*)
# --------------------------------------------------------------------------- #
def test_security_report(monitored):
    report = monitored.report()
    assert isinstance(report.get("external_activity"), dict) \
        and report["external_activity"].get("copied") == 1, \
        f"report lost external_activity: {report.get('external_activity')!r}"
    assert isinstance(report.get("keyboard_activity"), dict) \
        and report["keyboard_activity"].get("total_keys") == 412, \
        f"report lost keyboard_activity: {report.get('keyboard_activity')!r}"
    # 6 external + 2 shortcuts + 1 devtools + 1 search + 1 network outage
    assert report.get("important_event_count") == 11, \
        f"important_event_count={report.get('important_event_count')}, expected 11"
