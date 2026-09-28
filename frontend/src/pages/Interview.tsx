/**
 * Interview page - the secure, monitored interview itself.
 *
 * Layout: question panel (left) + sticky proctoring panel (right) with a live
 * camera feed, an oval stay-in-frame guide, monitoring status and a timestamped
 * event timeline (FR-EVENT-01 .. FR-EVENT-04).
 *
 * Monitoring emitted from here:
 * - camera_started / camera_disabled            (FR-CAM-06)
 * - mic_started / mic_disabled / mic_muted      (audio presence)
 * - audio_silence / audio_resumed               (prolonged silence)
 * - identity_verified / identity_mismatch       (FR-ID-04, checked every second)
 * - focus_lost / focus_restored, tab_hidden     (FR-BROW-04)
 * - fullscreen_entered / fullscreen_exited      (FR-SECENV-05)
 * - cursor_click / cursor_idle / cursor_trace   (cursor tracer)
 * - answer_submitted, interview_started/ended   (FR-EVENT-02)
 *
 * Events are sent to /interview/{id}/event and mirrored locally so the
 * candidate can always see what has been recorded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { interviewService } from '@/services/interviewService';
import { API_BASE_URL, faceService } from '../services/api';
import { AppHeader, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea, Webcam } from '../components';
import { useAudioMonitor } from '../hooks/useAudioMonitor';
import { useCursorTracker } from '../hooks/useCursorTracker';
import { useKeyboardTracer } from '../hooks/useKeyboardTracer';
import { getSelectedPosting, identityVerifiedAt } from '../lib/session';
import { EVENT_LABELS } from '../lib/eventLabels';
import type { ReviewItem } from '../types';

interface Question {
  id: number;
  text: string;
  type: 'mcq' | 'coding' | 'text';
  options?: string[];
  time_limit?: number;
}

interface InterviewData {
  id: number;
  title: string;
  duration_minutes?: number;
  questions: Question[];
}

interface TimelineEvent {
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

type CamStatus = 'starting' | 'live' | 'off' | 'error';
type IdentityState = 'idle' | 'checking' | 'ok' | 'review';

const IDENTITY_REFRESH_MS = 1_000;

/** Short chip labels for the reasons the backend returns (and the stale-frame guard). */
const IDENTITY_REASONS: Record<string, string> = {
  'No face detected': 'face not in frame',
  'Multiple faces detected': 'multiple faces in frame',
  'Failed to extract face embedding': 'face unclear - adjust position',
  'Camera paused or tab hidden - presence cannot be verified': 'camera paused - presence unverifiable',
  'Face did not match the enrolled identity': 'person not identified',
};

export function InterviewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [camStatus, setCamStatus] = useState<CamStatus>('starting');
  const [identity, setIdentity] = useState<IdentityState>('idle');
  const [identityReason, setIdentityReason] = useState<string | null>(null);
  // Prominent notice while someone who is NOT the enrolled candidate is in
  // frame: 'Person not identified' (a face that fails the match) or
  // 'Multiple people in frame'. Cleared as soon as the check is green again.
  const [personAlert, setPersonAlert] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [keyCount, setKeyCount] = useState(0); // live keystroke total (tracer)
  const [focusOk, setFocusOk] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // every question answered - waiting for the final "Submit all"
  const [reviewStage, setReviewStage] = useState(false);

  const startedRef = useRef(false);
  const startedAtRef = useRef<number>(0); // wall-clock when the interview started
  const interviewIdRef = useRef<number | null>(null);
  const frameRef = useRef<string | null>(null);
  const lastFrameAtRef = useRef(0); // when the last fresh camera frame arrived
  const identityBusyRef = useRef(false);
  const endedRef = useRef(false);
  const camEventRef = useRef<'none' | 'live' | 'error'>('none');

  // Current answer is derived from the answers map (single source of truth)
  const answer = answers[currentQ] ?? '';
  const updateAnswer = (value: string) => setAnswers((prev) => ({ ...prev, [currentQ]: value }));

  // ---- Event logging (local timeline + backend) ----
  const logEvent = useCallback((eventType: string, data: Record<string, unknown> = {}) => {
    const evt: TimelineEvent = { event_type: eventType, timestamp: new Date().toISOString(), data };
    setEvents((prev) => [...prev, evt].slice(-40));
    const id = interviewIdRef.current;
    if (id) {
      interviewService.logEvent(id, evt).catch(() => {
        /* timeline still shown locally if the API call fails */
      });
    }
  }, []);

  // ---- Start interview (once; StrictMode-safe) ----
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        // The position picked on /positions names the interview; the backend
        // fills in the posting's own questions (topped up from the bank).
        const posting = getSelectedPosting();
        const data: InterviewData = await interviewService.startInterview({
          title: posting?.title || 'Technical Interview',
          duration_minutes: posting?.duration_minutes || 60,
          posting_id: posting?.id ?? null,
        });
        setInterview(data);
        interviewIdRef.current = data.id;
        startedAtRef.current = Date.now();
        setTimeLeft(Math.max(1, (data.duration_minutes ?? 60) * 60));
        logEvent('interview_started', { interview_id: data.id, candidate: user?.email ?? null });
      } catch (e: unknown) {
        const axiosError = e as { response?: { data?: { detail?: string } } };
        setError(axiosError.response?.data?.detail || 'Failed to start the interview. Please try again.');
      }
    })();
  }, [logEvent, user?.email]);

  // ---- Countdown ----
  useEffect(() => {
    if (!interview || timeLeft <= 0) return;
    const timer = window.setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [interview, timeLeft]);

  // ---- Finish ----
  const finishInterview = useCallback(
    async (reason: 'completed' | 'timeout' = 'completed', answeredCount?: number) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const id = interviewIdRef.current;
      logEvent('interview_ended', { reason });
      // actual time the candidate spent in the interview (shown on /complete)
      const durationSeconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
      let review: ReviewItem[] | undefined;
      let score: { correct: number; total: number } | undefined;
      let moments: { event_type: string; timestamp: string; data: Record<string, unknown> }[] | undefined;
      try {
        if (id) {
          const res = await interviewService.endInterview(id);
          // debrief payload: graded questions, score and every recorded moment
          if (Array.isArray(res?.questions)) {
            review = res.questions.map(
              (q: { id: number; text: string; type: string; model_answer?: string; your_answer?: string; correct?: boolean; grading_method?: string }) => ({
                id: q.id,
                text: q.text,
                type: q.type,
                modelAnswer: q.model_answer ?? '',
                yourAnswer: q.your_answer ?? '',
                correct: !!q.correct,
                gradingMethod: q.grading_method,
              })
            );
          }
          if (res?.score && typeof res.score.correct === 'number' && typeof res.score.total === 'number') {
            score = { correct: res.score.correct, total: res.score.total };
          }
          if (Array.isArray(res?.events)) moments = res.events;
        }
      } catch {
        /* session already closed server-side - continue without a debrief */
      }
      navigate('/complete', {
        replace: true,
        state: {
          reason,
          answered: answeredCount ?? Object.keys(submitted).length,
          events: events.length,
          review,
          score,
          moments,
          durationSeconds,
        },
      });
    },
    [submitted, events.length, logEvent, navigate]
  );

  useEffect(() => {
    if (interview && timeLeft === 0) void finishInterview('timeout');
  }, [interview, timeLeft, finishInterview]);

  // ---- Focus / visibility monitoring (FR-BROW-04, FR-SECENV-04) ----
  // Also measures *how long* the candidate was away: a long absence is the
  // clearest observable that another tab or app (e.g. an AI assistant) was in
  // front of the interview, and it feeds the reviewer's external-activity view.
  useEffect(() => {
    let awaySince: number | null = null; // window blurred (another window/tab focused)
    let hiddenSince: number | null = null; // tab in the background

    const onBlur = () => {
      if (awaySince === null) awaySince = Date.now();
      setFocusOk(false);
      logEvent('focus_lost', { path: window.location.pathname });
    };
    const onFocus = () => {
      setFocusOk(true);
      const awayMs = awaySince === null ? null : Date.now() - awaySince;
      awaySince = null;
      logEvent('focus_restored', awayMs === null ? {} : { away_ms: awayMs });
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (hiddenSince === null) hiddenSince = Date.now();
        logEvent('tab_hidden', {});
      } else {
        const hiddenMs = hiddenSince === null ? null : Date.now() - hiddenSince;
        hiddenSince = null;
        logEvent('tab_visible', hiddenMs === null ? {} : { hidden_ms: hiddenMs });
      }
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [logEvent]);

  // ---- Network connectivity (FR-NET) ----
  // Losing the connection mid-interview (wifi drop, airplane mode) and coming
  // back is worth a reviewer's glance; the reconnect event carries how long
  // the outage lasted, so the timeline shows the gap even if the offline
  // event itself never reached the API.
  useEffect(() => {
    if (!interview) return;
    let offlineSince: number | null = null;

    const onOffline = () => {
      if (offlineSince === null) offlineSince = Date.now();
      logEvent('network_offline', {});
    };
    const onOnline = () => {
      const offlineMs = offlineSince === null ? null : Date.now() - offlineSince;
      offlineSince = null;
      logEvent('network_online', offlineMs === null ? {} : { offline_ms: offlineMs });
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [interview, logEvent]);

  // ---- Clipboard & print monitoring (FR-BROW-06) ----
  // Copying the question out and pasting an answer in is how an AI assistant
  // gets used from another tab or device - recorded as review events with a
  // short snippet so a human can judge them (FR-RES-01..03).
  useEffect(() => {
    if (!interview) return;

    const snippet = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 160);

    const onCopy = () => {
      const selected = window.getSelection()?.toString() ?? '';
      if (!selected.trim()) return;
      logEvent('question_copied', { length: selected.length, snippet: snippet(selected) });
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text) return;
      logEvent('pasted_text', { length: text.length, snippet: snippet(text) });
    };
    const onPrint = () => logEvent('page_printed', {});

    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [interview, logEvent]);

  // ---- Leaving the interview page (FR-BROW-03/07) ----
  // A real navigation (address bar, another tab, closing the window) unloads
  // the page; a keepalive fetch records `page_left` before we're gone. Skipped
  // once the interview has been submitted, so finishing normally isn't flagged.
  useEffect(() => {
    if (!interview) return;

    const onPageHide = () => {
      const id = interviewIdRef.current;
      if (!id || endedRef.current) return;
      const token = localStorage.getItem('access_token');
      if (!token) return;
      try {
        void fetch(`${API_BASE_URL}/interview/${id}/event`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            event_type: 'page_left',
            timestamp: new Date().toISOString(),
            data: { path: window.location.pathname },
          }),
        });
      } catch {
        /* best effort - the page is going away */
      }
    };

    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [interview]);

  // ---- Full screen monitoring (FR-SECENV-05) ----
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* fullscreen may be blocked by the browser */
    }
  }, []);

  useEffect(() => {
    const onFullscreen = () => {
      const active = !!document.fullscreenElement;
      setFullscreen(active);
      logEvent(active ? 'fullscreen_entered' : 'fullscreen_exited', {});
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, [logEvent]);

  // ---- Camera callbacks (stable) ----
  const handleFrame = useCallback((frame: string) => {
    frameRef.current = frame;
    lastFrameAtRef.current = Date.now();
  }, []);

  const handleCamReady = useCallback(() => {
    setCamStatus('live');
    if (camEventRef.current === 'live') return;
    camEventRef.current = 'live';
    logEvent('camera_started', {});
  }, [logEvent]);

  const handleCamError = useCallback(
    (message: string) => {
      setCamStatus('error');
      if (camEventRef.current === 'error') return;
      camEventRef.current = 'error';
      logEvent('camera_disabled', { message });
    },
    [logEvent]
  );

  // ---- Microphone / audio monitoring (levels only - nothing is recorded) ----
  const micEventRef = useRef<'none' | 'live' | 'error'>('none');
  const handleAudioEvent = useCallback(
    (eventType: string, data: Record<string, unknown> = {}) => {
      // mic_started / mic_disabled are reported once per state change
      if (eventType === 'mic_started' || eventType === 'mic_disabled') {
        const wanted = eventType === 'mic_started' ? 'live' : 'error';
        if (micEventRef.current === wanted) return;
        micEventRef.current = wanted;
      }
      logEvent(eventType, data);
    },
    [logEvent]
  );

  const mic = useAudioMonitor({ enabled: !!interview, onEvent: handleAudioEvent });

  // ---- Cursor tracking (FR-EVENT) - path samples, clicks, idle, leave/enter ----
  // logEvent is stable (useCallback []), safe to pass directly.
  useCursorTracker({ enabled: !!interview, onEvent: logEvent });
  // onKeys feeds the live "keys typed" counter - visible proof the keyboard
  // tracer is active while the candidate answers.
  useKeyboardTracer({ enabled: !!interview, onEvent: logEvent, onKeys: setKeyCount });

  // ---- Periodic identity re-check (FR-ID-03 / FR-CAM-05) ----
  // Runs every second; only state *changes* go to the timeline so the log stays
  // readable (a repeated mismatch is summarised at most once per 15s).
  // 'stale' = no fresh camera frame (tab hidden / video paused / stream died):
  // a frozen picture must never keep claiming the candidate is present.
  const identityLogRef = useRef<{ state: 'ok' | 'review' | 'stale' | null; lastReviewAt: number }>({
    state: null,
    lastReviewAt: 0,
  });

  useEffect(() => {
    if (!interview || !user) return;
    const interval = window.setInterval(() => {
      const frame = frameRef.current;
      if (!frame || identityBusyRef.current) return;

      // Verify only against fresh frames. The Webcam stops emitting when the
      // tab is hidden or the video is paused, so frameRef then holds the last
      // picture with the candidate in it - verifying that would report
      // "identity verified" while they are away.
      if (Date.now() - lastFrameAtRef.current > 2_000) {
        const log = identityLogRef.current;
        if (log.state !== 'stale') {
          log.state = 'stale';
          log.lastReviewAt = Date.now();
          setIdentity('review');
          setIdentityReason('Camera paused or tab hidden - presence cannot be verified');
          setPersonAlert(null); // a stale frame says nothing about who is in view
          logEvent('identity_mismatch', { similarity: 0, error: 'camera_frame_stalled' });
        }
        return;
      }

      identityBusyRef.current = true;
      // keep the last result on screen while re-checking (only the very first
      // check shows "checking") - avoids the chip flickering every second
      if (identityLogRef.current.state === null) setIdentity('checking');
      faceService
        .verify({ candidate_id: user.id, image_base64: frame, interview_id: interviewIdRef.current ?? undefined })
        .then((result) => {
          const similarity = Number(result.similarity ?? 0);
          setSimilarity(similarity);
          const now = Date.now();
          if (result.verified) {
            setIdentity('ok');
            setIdentityReason(null);
            setPersonAlert(null);
            if (identityLogRef.current.state !== 'ok') {
              identityLogRef.current.state = 'ok';
              logEvent('identity_verified', { similarity });
            }
          } else {
            setIdentity('review');
            setIdentityReason(result.error ?? 'Face did not match the enrolled identity');
            // A person who is NOT the enrolled candidate is in frame: say so
            // prominently instead of only tinting the chip. (NFR-SAFE-01 -
            // this is a notice for review, not a verdict.)
            const facesInFrame = Number(result.faces_detected ?? 0);
            if (result.error === 'Multiple faces detected') {
              setPersonAlert('Multiple people in frame');
            } else if (!result.error && facesInFrame >= 1) {
              setPersonAlert('Person not identified');
            } else {
              setPersonAlert(null);
            }
            const log = identityLogRef.current;
            if (log.state !== 'review' || now - log.lastReviewAt >= 15_000) {
              log.state = 'review';
              log.lastReviewAt = now;
              logEvent('identity_mismatch', { similarity, error: result.error ?? null });
            }
          }
        })
        .catch(() => setIdentity('idle'))
        .finally(() => {
          identityBusyRef.current = false;
        });
    }, IDENTITY_REFRESH_MS);
    return () => clearInterval(interval);
  }, [interview, user, logEvent]);

  // ---- Answers ----
  // One-way flow: answers lock as soon as they are submitted - once you click
  // "Submit & next" you cannot return to a previous question (enforced by
  // removing all back navigation; the backend stores the answer immediately).
  const submitAnswer = async () => {
    if (!interview || !answer.trim() || busy) return;
    const question = interview.questions[currentQ];
    const isLast = currentQ >= interview.questions.length - 1;

    setBusy(true);
    setError(null);
    try {
      await interviewService.submitAnswer(interview.id, { question_id: question.id, answer: answer.trim() });
      setSubmitted((prev) => ({ ...prev, [currentQ]: true }));
      logEvent('answer_submitted', { question_id: question.id, question_type: question.type, last: isLast });
      if (isLast) {
        // all questions answered - show the final "Submit all" step
        setReviewStage(true);
      } else {
        setCurrentQ((c) => c + 1);
      }
    } catch (e: unknown) {
      const axiosError = e as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || 'Failed to submit your answer.');
    } finally {
      setBusy(false);
    }
  };

  // ---- Loading / failure states ----
  if (error && !interview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="max-w-md text-center">
          <CardContent>
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
            <Button className="mt-4" variant="secondary" onClick={() => navigate('/positions')}>
              Back to start
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" aria-label="Loading interview" />
        <p className="text-sm text-gray-500">Preparing your secure interview...</p>
      </div>
    );
  }

  const question = interview.questions[currentQ];
  const isLast = currentQ >= interview.questions.length - 1;
  const answeredCount = Object.keys(submitted).length;
  const progressPct = reviewStage ? 100 : Math.round(((currentQ + 1) / interview.questions.length) * 100);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const lowTime = timeLeft <= 300;

  const camChip =
    camStatus === 'live'
      ? { text: 'Camera on', cls: 'bg-green-50 text-green-700' }
      : camStatus === 'error'
        ? { text: 'Camera unavailable', cls: 'bg-red-50 text-red-700' }
        : { text: 'Starting...', cls: 'bg-gray-100 text-gray-500' };

  const micChip =
    mic.status === 'live'
      ? mic.silent
        ? { text: 'No speech detected', cls: 'bg-amber-50 text-amber-700' }
        : { text: 'Mic on', cls: 'bg-green-50 text-green-700' }
      : mic.status === 'muted'
        ? { text: 'Mic muted', cls: 'bg-amber-50 text-amber-700' }
        : mic.status === 'error'
          ? { text: 'Mic unavailable', cls: 'bg-red-50 text-red-700' }
          : { text: mic.status === 'starting' ? 'Mic starting...' : 'Mic off', cls: 'bg-gray-100 text-gray-500' };

  const identityChip =
    identity === 'ok'
      ? { text: `Identity verified${similarity !== null ? ` · ${Math.round(similarity * 100)}%` : ''}`, cls: 'bg-green-50 text-green-700' }
      : identity === 'checking'
        ? { text: 'Checking identity...', cls: 'bg-blue-50 text-blue-700' }
        : identity === 'review'
          ? {
              text: `Identity: ${identityReason ? (IDENTITY_REASONS[identityReason] ?? 'flagged for review') : 'flagged for review'}`,
              cls: 'bg-amber-50 text-amber-700',
            }
          : { text: 'Identity pending', cls: 'bg-gray-100 text-gray-500' };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader steps={['Position', 'Readiness', 'Identity', 'Interview']} activeStep={4} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Session bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{interview.title}</p>
              <p className="text-xs text-gray-500">
                Question {currentQ + 1} of {interview.questions.length} · {answeredCount} answered
              </p>
            </div>
            <div className="hidden w-40 sm:block">
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <span>Progress</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-lg px-3 py-1.5 font-mono text-lg font-semibold ${
                lowTime ? 'bg-red-50 text-red-600' : 'bg-gray-900 text-white'
              }`}
              aria-label="Time remaining"
            >
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            <Button variant="outline" size="sm" onClick={toggleFullscreen}>
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ---- Question column ---- */}
          <section>
            {!reviewStage && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Question {currentQ + 1}</CardTitle>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      question.type === 'mcq'
                        ? 'bg-purple-50 text-purple-700'
                        : question.type === 'coding'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {question.type === 'mcq' ? 'Multiple choice' : question.type === 'coding' ? 'Coding' : 'Written'}
                  </span>
                </div>
                <CardDescription>
                  {question.type === 'mcq'
                    ? 'Select the single best answer.'
                    : question.type === 'coding'
                      ? 'Write your solution - explain the approach if helpful.'
                      : 'Type your answer below.'}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                <p className="text-lg leading-relaxed text-gray-900">{question.text}</p>

                {question.type === 'mcq' && question.options ? (
                  <div className="grid gap-2">
                    {question.options.map((option, i) => {
                      const selected = answer === option;
                      return (
                        <label
                          key={`${question.id}-${i}`}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                            selected
                              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q-${question.id}`}
                            value={option}
                            checked={selected}
                            onChange={() => updateAnswer(option)}
                            className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-800">{option}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Textarea
                    value={answer}
                    onChange={(e) => updateAnswer(e.target.value)}
                    className={`h-64 p-4 ${question.type === 'coding' ? 'font-mono text-sm' : ''}`}
                    placeholder={
                      question.type === 'coding' ? 'function reverse(list) {\n  // ...\n}' : 'Type your answer here...'
                    }
                    disabled={busy}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-400">
                    {currentQ === 0
                      ? 'First question - answers lock as soon as they are submitted'
                      : 'No going back - previous answers are locked'}
                  </p>

                  <div className="flex items-center gap-3">
                    {!answer.trim() && <span className="text-xs text-gray-400">Answer required to continue</span>}
                    <Button onClick={submitAnswer} disabled={!answer.trim() || busy} loading={busy}>
                      {isLast ? 'Submit & continue' : 'Submit & next'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}

            {reviewStage && (
              <Card>
                <CardHeader>
                  <CardTitle>All {interview.questions.length} questions answered</CardTitle>
                  <CardDescription>
                    Your answers are saved and locked. Submit to finish - afterwards you will see your score, the
                    reference answers and every recorded moment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {interview.questions.map((q, i) => (
                      <li
                        key={q.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            Q{i + 1}. {q.text}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {submitted[i] ? 'Answer submitted - locked' : 'No answer submitted'}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            submitted[i] ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {submitted[i] ? 'Saved' : 'Missing'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-400">
                    Questions are one-way: once you continue you cannot return to a previous question.
                  </p>
                  <div className="flex justify-end border-t border-gray-100 pt-4">
                    <Button
                      onClick={() => {
                        setBusy(true);
                        void finishInterview('completed', Object.keys(submitted).length);
                      }}
                      disabled={busy}
                      loading={busy}
                    >
                      Submit all
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          {/* ---- Proctoring column ---- */}
          <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader className="mb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Proctoring camera</CardTitle>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${micChip.cls}`}>{micChip.text}</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${camChip.cls}`}>{camChip.text}</span>
                  </div>
                </div>
                <CardDescription>Keep your face inside the oval at all times.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-hidden rounded-xl bg-gray-900">
                  <Webcam
                    className="w-full"
                    guide="oval"
                    showControls={camStatus === 'error'}
                    onFrame={handleFrame}
                    onReady={handleCamReady}
                    onError={handleCamError}
                  />
                </div>

                {/* Audio level meter (levels only - audio is never recorded) */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                    <span>Audio level</span>
                    <span>{mic.status === 'live' ? (mic.silent ? 'Silence' : 'Listening') : '—'}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                    <div
                      className={`h-full rounded-full transition-all ${
                        mic.silent ? 'bg-amber-400' : mic.status === 'live' ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                      style={{ width: `${Math.round(mic.level * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${identityChip.cls}`}>
                    {identityChip.text}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      focusOk ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {focusOk ? 'Focus active' : 'Focus lost'}
                  </span>
                  {/* live keystroke total - typing monitoring is visibly active */}
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                    Keyboard · {keyCount} {keyCount === 1 ? 'key' : 'keys'}
                  </span>
                </div>

                {/* Prominent notice when someone else is in front of the camera */}
                {personAlert && (
                  <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-semibold">{personAlert}</p>
                    <p className="mt-1">
                      {personAlert === 'Person not identified'
                        ? 'A face is visible in the camera but it does not match your enrolled identity. Only the enrolled candidate should be on camera - this moment is recorded for the reviewer.'
                        : 'More than one person is visible in the camera frame - this moment is recorded for the reviewer.'}
                    </p>
                  </div>
                )}

                <p className="text-xs text-gray-500">
                  Identity is re-checked {IDENTITY_REFRESH_MS >= 1000 ? 'every second' : `every ${IDENTITY_REFRESH_MS / 1000} seconds`}{' '}
                  and the match percentage updates live. Only fresh camera frames count - if the camera stops
                  updating (tab hidden, video paused, stream lost) presence is marked unverifiable, never verified.
                  Audio is only monitored for presence and silence - levels are never recorded. Cursor path, clicks and
                  idle periods are recorded for review. Looking away is never treated as cheating on its own.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="mb-3">
                <CardTitle className="text-base">Activity log</CardTitle>
                <CardDescription>Timestamped events recorded for review</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-gray-400">No events yet.</p>
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {[...events].reverse().map((evt, i) => {
                      const meta = EVENT_LABELS[evt.event_type] || { label: evt.event_type, tone: 'neutral' as const };
                      const dot =
                        meta.tone === 'ok' ? 'bg-green-500' : meta.tone === 'warn' ? 'bg-amber-500' : 'bg-gray-400';
                      return (
                        <li key={`${evt.timestamp}-${i}`} className="flex items-start gap-2 text-sm">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block text-gray-800">{meta.label}</span>
                            <span className="text-xs text-gray-400">
                              {new Date(evt.timestamp).toLocaleTimeString()}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-gray-500">
                  Verified this session at {identityVerifiedAt() ? new Date(identityVerifiedAt()!).toLocaleTimeString() : '—'}
                  . Events are reviewed by a human - never used for an automatic verdict.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default InterviewPage;
