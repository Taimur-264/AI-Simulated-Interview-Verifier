# SRS Traceability Matrix

Maps every requirement ID referenced in this repository to its implementation and its
automated tests.

**How to read this document**

- Requirement IDs come from annotations placed at the implementation sites
  (`# FR-…` / `NFR-…` in Python, `/** … */` in TypeScript). The authoritative SRS
  document itself is **not** stored in this repo; if a requirement exists in the SRS
  but is never annotated in code, it will not appear here — treat this matrix as the
  *implementation-side* view of the SRS.
- **Status:** ✅ implemented with automated coverage · 🟡 implemented, manual
  verification only · ⚠️ implemented but untested/partial · ⛔ not implemented
- **Tests** refer to `backend/tests/` (run from the repo root with
  `backend\venv\Scripts\python -m pytest`) unless marked *manual*.

---

## 1. User journey → requirements

| # | Journey step (route) | Requirements |
|---|---|---|
| 1 | Register / login (`/register`, `/login`) | FR-AUTH-03/04, NFR-SEC-02 |
| 2 | Choose a position (`/positions`) | FR-ADMIN-01 (position board), FR-Q-02 |
| 3 | Monitoring disclosure + consent (`/start`) | NFR-PRIV-02 |
| 4 | Camera + identity gate (`/enroll`: enrol → liveness → capture frame → check) | FR-ID-01..06, FR-CAM-05/06 |
| 5 | Monitored interview (`/interview`) | FR-EVENT-01..04, FR-BROW-01/03/04/06/07, FR-SECENV-03/04/05, FR-CLASS-01..03, FR-RES-01..03, FR-AI-01..04, FR-NET, NFR-TRACE-01, NFR-SAFE-01 |
| 6 | Completion (`/complete`) | NFR-SAFE-01 |
| 7 | Recruiter review (`/review`, `/review/:id`, report) | FR-ADMIN-01..05, FR-REPORT-01..05, NFR-SEC-02, NFR-PRIV-03 |
| 8 | Admin console (`/admin`, `/admin/postings`) | FR-ADMIN-01, NFR-SEC-02 |

---

## 2. Identity verification

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-ID-01..06 | Reference-face enrolment (**re-enrolment replaces the stored face — one identity per candidate**); verification gate before the interview; **per-second re-check**; every outcome (pass / no-face / multi-face / stalled camera) stored as a timestamped event; liveness challenge (blink, head turn); verified-at session gate with 2 h TTL | `backend/app/api/face.py` (`/enroll`, `/verify`, `/liveness`, `_record_verify_event`), `backend/app/services/face_service.py` (YuNet detection, MediaPipe landmarks, InsightFace 512-d embeddings, thresholds), `frontend/src/pages/Enroll.tsx` (FR-ID-01/04/05 — enrol → liveness → capture frame → match check), `frontend/src/pages/Interview.tsx:408` (FR-ID-03 re-check + candidate-facing "Person not identified" notice), `frontend/src/lib/session.ts` (FR-ID-06 gate/TTL), `frontend/src/components/FaceEnrollCheck.tsx` | ✅ | `test_identity_events.py` (3 tests: absence rejected, absence stored without similarity/threshold claims, condensed logging reuses one row); `test_enrollment.py` (2 tests: re-enrol replaces the previous face so a second person cannot pass, failed enrol keeps the face on file) |
| FR-CAM-05/06 | Re-check cadence wiring; camera start/stop/permission events; frozen-frame, paused and ended-stream guards make stale frames *unverifiable* (amber) instead of falsely verified | `frontend/src/pages/Interview.tsx:408` (FR-CAM-05), event list in `Interview.tsx` header comment + `frontend/src/components/Webcam.tsx` (FR-CAM-06) | 🟡 | Manual: leave/return frame walkthrough in a real browser |

---

## 3. Events & monitoring

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-EVENT-01..04 | Timestamped proctoring events with **server-clock** timestamps, persisted and rendered as the review timeline; includes mic lifecycle/silence events (level only — no audio recorded) | `backend/app/models/interview.py` (`InterviewEvent`), `backend/app/api/interview.py` (`/interview/{id}/event`), `frontend/src/hooks/useAudioMonitor.ts` (mic events), `frontend/src/pages/Recruiter.tsx:284` (timeline) | ✅ | `test_monitoring_events.py` (event posting + timeline assertions) |
| FR-BROW-01 | Keyboard tracer: keystroke totals, typed characters of the interview's own inputs, shortcut/devtools/search attempts; counts + in-page text only, with documented cross-tab limits | `frontend/src/hooks/useKeyboardTracer.ts`, summary in `backend/app/services/review_service.py:294`, UI `Recruiter.tsx:409` | ✅ | `test_monitoring_events.py::test_keyboard_activity_summary` |
| FR-BROW-03/04/06/07 | Leaving the interview page, focus/visibility changes, clipboard copy/paste snippets, print attempts — recorded and classified | `frontend/src/pages/Interview.tsx:241` (focus/visibility), `:299` (clipboard/print), `:337` (page exit) | ✅ | `test_monitoring_events.py::test_event_sources_and_classifications`, `test_external_activity_summary` |
| FR-NET | Connectivity-loss events: `offline`/`online` transitions recorded mid-interview; the reconnect event carries the outage duration as evidence; offline = Review, online = Normal, source `network` | `frontend/src/pages/Interview.tsx:270` (listeners), `backend/app/services/event_classification.py` (classification), labels in `frontend/src/lib/eventLabels.ts` | ✅ | `test_monitoring_events.py` (classification + `offline_ms` assertions) |
| FR-SECENV-03/04/05 | Devtools/inspector shortcut detection; focus discipline in the secure environment; fullscreen enter/exit events | `frontend/src/hooks/useKeyboardTracer.ts:44` (FR-SECENV-03), `frontend/src/pages/Interview.tsx:241` (FR-SECENV-04), `:344` (FR-SECENV-05) | ⚠️ | Devtools/search covered by `test_event_sources_and_classifications`; fullscreen 🟡 manual |

---

## 4. Classification & advisory intelligence

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-CLASS-01..03 | Source tagging (`external` / `keyboard` / `network` / …) and `normal` / `review` / `high_review` classification as plain, retunable data — never an outcome | `backend/app/services/event_classification.py`, `frontend/src/lib/eventLabels.ts` | ✅ | `test_monitoring_events.py::test_event_sources_and_classifications` |
| FR-AI-01..03 | Repeated flagged signals correlated into reviewable "incidents" (repeat threshold constant) | `backend/app/services/review_service.py:359`, UI `Recruiter.tsx:337` | 🟡 | Manual (no automated incident fixture yet) |
| FR-AI-04 | AI / supportive-site indicators remain advisory — presented as events, never as a conclusion | `backend/app/services/review_service.py:10` | ⚠️ | Indirect via FR-RES note assertions |

---

## 5. External resources (FR-RES-01..03)

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-RES-01 | External-activity summary: copied / pasted / printed / left-page counts, longest absence, `possible_external_use` flag | `backend/app/services/review_service.py:209`, UI `Recruiter.tsx:369` | ✅ | `test_monitoring_events.py::test_external_activity_summary` |
| FR-RES-02 | Lookup evidence: what was copied out, what was pasted back (snippet), how long the candidate was away | `review_service.py` lookup evidence + `pasted_snippet` | ✅ | `test_monitoring_events.py::test_lookup_evidence` |
| FR-RES-03 | Advisory wording everywhere ("not proof of cheating", "for human review") — never an automatic conclusion | `review_service.py:216/287`, `Interview.tsx:849`, `event_classification.py:69` | ✅ | `test_external_activity_summary` (note assertion), `test_monitoring_events` overview |

---

## 6. Questions & grading

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-Q-02 | Random question draw: posting questions first, topped up from the shared bank to 5, shuffled | `backend/app/api/interview.py:107` (`_draw_questions`), bank `backend/app/services/question_bank.py` | ✅ | `test_postings.py::test_posting_crud_and_question_draw` (draw = 5 incl. both custom) |
| FR-Q-03 | Draw is shuffled before delivery (`random.shuffle`) | `backend/app/api/interview.py:122` | ✅ | `test_question_draw.py` (each question once + order varies across 30 draws) |
| Grading | Quiz score only; explicitly never an interview verdict | `backend/app/services/grading.py:9`, `interview.py:339` | 🟡 | Manual (covered by design note, NFR-SAFE-01 assertions elsewhere) |

---

## 7. Admin console & recruiter review

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| FR-ADMIN-01 | Candidate position board + admin console (postings CRUD, question management, session list), role-gated | `backend/app/api/postings.py`, `frontend/src/pages/Postings.tsx`, `Admin.tsx`, `Positions.tsx` | ✅ | `test_postings.py` (5 tests incl. 403 gating) |
| FR-ADMIN-02 | Session list with candidate + flag summary | `backend/app/services/review_service.py:121`, UI `/review` | 🟡 | Manual |
| FR-ADMIN-03/04 | Session detail: identity history, answers, classified timeline | `review_service.py:414`, UI `Recruiter.tsx:467/500` | ✅ | Detail assertions in `test_monitoring_events.py` |
| FR-ADMIN-05 | "Generate report" action producing the security report | `review_service.py:461`, UI `Recruiter.tsx:555` | ✅ | `test_monitoring_events.py::test_security_report` |
| FR-REPORT-01..05 | Report with status (review-oriented), camera/browser/audio/identity summaries, external + keyboard sections, important-event list | `review_service.py:461..491` | ✅ | `test_security_report` (sections + `important_event_count == 10`) |
| FR-AUTH-03/04 | Unique interview identity; drawn questions/answers persisted server-side | `backend/app/models/interview.py:9`, `interview.py:202` | ✅ | Start flows in `test_postings.py` / `test_monitoring_events.py` |

---

## 8. Non-functional requirements

| Requirement | What is implemented | Where | Status | Tests |
|---|---|---|---|---|
| NFR-SAFE-01 | No automatic verdicts anywhere: advisory banners, report wording, quiz-only grading, incidents as review aids | `review_service.py:40/352/480`, `grading.py:9`, UI banners in `Recruiter.tsx:262`, `Admin.tsx:205`, `Complete.tsx` | ✅ | Advisory-note assertions in `test_monitoring_events.py` |
| NFR-SEC-02 | Server-side role gates (`require_admin`, recruiter/admin reviewer) + matching UI gates; sliding-window throttles on `/auth/login` (per IP + email) and `/face/verify` (per candidate) returning `429` + `Retry-After` | `backend/app/core/security.py:155/174`, `backend/app/core/rate_limit.py`, `api/auth.py` (login), `api/face.py` (verify), `AdminLogin.tsx:6`, `Recruiter.tsx:777` | ✅ | `test_postings.py::test_candidate_blocked_from_admin_postings`, `test_rate_limit.py` (5 tests incl. per-account keying) |
| NFR-PRIV-02 | Monitoring disclosed and consented before any capture starts | `frontend/src/pages/Start.tsx`, `Login.tsx:82` | 🟡 | Manual |
| NFR-PRIV-03 | Stored monitoring data readable only by authorized reviewers; emails promoted at startup | `backend/app/core/config.py:29`, `database.py:111` (`REVIEWER_EMAILS`), `security.py` | ✅ | 403 tests + `test_owner_account_is_admin` |
| NFR-TRACE-01 | Server clock stamps every event so the shared timeline can't be forged by client time | `backend/app/api/interview.py:291`, `models/interview.py:127` | 🟡 | Manual |
| NFR-MAINT-01 | Classification/labels are plain data maps, retunable without touching routes | `event_classification.py:11`, `eventLabels.ts` | ✅ | n/a (structural) |

---

## 9. Known gaps (not implemented / untested)

| Item | Notes |
|---|---|
| Frontend automated tests | None — quality gates are `npm run lint` (oxlint) and `npm run build` (tsc). |
| Incident correlation test | FR-AI-01..03 grouping has no fixture producing repeated signals in the suite. |
| Formal migrations | `alembic` is in `requirements.txt` but no migration history exists; startup uses `create_all` + small in-code migrations (`database.py`). |
| Unannotated IDs | Requirement numbers that never appear in source annotations cannot be traced here — reconcile this matrix against the authoritative SRS. |

---

## 10. Test suite → requirements map

| Test file | Tests | Primary coverage |
|---|---|---|
| `backend/tests/test_postings.py` | 5 | FR-ADMIN-01, FR-Q-02, FR-AUTH-03/04, NFR-SEC-02, NFR-PRIV-03 |
| `backend/tests/test_identity_events.py` | 3 | FR-ID-01..06 (absence recording + condensed logging) |
| `backend/tests/test_enrollment.py` | 2 | FR-ID-01 (one enrolled identity per candidate: re-enrol replaces, failed enrol keeps) |
| `backend/tests/test_monitoring_events.py` | 5 | FR-EVENT-01..04, FR-BROW-01/03/04/06/07, FR-CLASS-01..03, FR-NET, FR-RES-01..03, FR-REPORT-01..05, FR-ADMIN-03/05, NFR-SAFE-01 |
| `backend/tests/test_question_draw.py` | 2 | FR-Q-02/03 (each posting question once + shuffled delivery) |
| `backend/tests/test_rate_limit.py` | 5 | NFR-SEC-02 throttling (login/verify `429`, per-account keying, window eviction) |
| **Total** | **22** | Run: `backend\venv\Scripts\python -m pytest` (backend must be up) |
