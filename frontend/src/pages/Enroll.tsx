/**
 * Enrol page - face enrolment & identity gate (FR-ID-01 .. FR-ID-06).
 *
 * A dedicated page for enrolling a candidate's face, then a separate capture
 * step, then the match check:
 *
 *   Camera access -> Enrol reference face -> Liveness -> Capture frame -> Check -> Interview
 *
 * - Enrol captures the reference face. Re-enrolling REPLACES the previous
 *   reference face on the backend, so only one person is ever enrolled on a
 *   candidate's account (two people can no longer both pass the check).
 * - Liveness (blink / head turn) is recorded and shown; a miss is not fatal,
 *   it is a review signal (NFR-SAFE-01: humans decide, not the model)
 * - Capture frame takes a FRESH frame, separate from the enrolment shot
 * - Check compares that captured frame against the enrolled face via
 *   /face/verify; only a match continues straight to the interview. A
 *   mismatch writes an identity event on the backend (FR-ID-04) and offers a
 *   retake / re-enrol, with an explicit "continue flagged" escape hatch.
 *
 * On success this session is marked verified (lib/session) and the candidate
 * continues to /interview.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { faceService } from '../services/api';
import { AppHeader, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Webcam } from '../components';
import { markIdentityVerified } from '../lib/session';

type Stage = 'permissions' | 'enroll' | 'liveness' | 'capture' | 'check' | 'success';
type PermState = 'idle' | 'checking' | 'ok' | 'denied';

interface LivenessResult {
  live: boolean;
  score: number;
  action: string;
}

interface VerifyResult {
  verified: boolean;
  similarity: number;
  threshold?: number;
  error?: string;
}

const STEP_LABELS = ['Camera access', 'Reference face', 'Liveness', 'Capture frame', 'Identity check'];

/** Stepper order - the active step is looked up by stage, not by label. */
const STAGE_ORDER: Stage[] = ['permissions', 'enroll', 'liveness', 'capture', 'check'];

const LIVENESS_PROMPTS: Record<string, string> = {
  blink: 'When the countdown starts, close your eyes and KEEP them closed for about a second (a normal blink may be too quick to catch).',
  head_turn: 'We capture a short burst of frames - turn your head to one side and HOLD it there while the countdown runs.',
};

const LIVENESS_FRAMES = 15; // frames sampled per attempt
const LIVENESS_GAP_MS = 200; // spacing between samples (3s window)
const LIVENESS_SECONDS = Math.ceil((LIVENESS_FRAMES * LIVENESS_GAP_MS) / 1000);

export function Enroll() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const captureRef = useRef<(() => string | null) | null>(null);
  const [stage, setStage] = useState<Stage>('permissions');
  const [perm, setPerm] = useState<PermState>('idle');
  const [hasRef, setHasRef] = useState<boolean | null>(null);
  const [captured, setCaptured] = useState<string | null>(null); // enrolment frame
  const [checkFrame, setCheckFrame] = useState<string | null>(null); // fresh check frame
  const [busy, setBusy] = useState(false);
  const [livenessCountdown, setLivenessCountdown] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [livenessAction, setLivenessAction] = useState<'blink' | 'head_turn'>('blink');
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [flagged, setFlagged] = useState(false);

  const activeIndex = stage === 'success' ? STEP_LABELS.length : Math.max(0, STAGE_ORDER.indexOf(stage));

  // ---- Boot: probe camera + existing reference face ----
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach((t) => t.stop());
        if (cancelled) return;
        setPerm('ok');
      } catch (err) {
        if (cancelled) return;
        setPerm('denied');
        setError(err instanceof Error ? err.message : 'Camera access denied');
        setStage('permissions');
        return;
      }

      try {
        const faces = await faceService.getReferenceFaces(user.id);
        const exists = Array.isArray(faces) && faces.length > 0;
        if (cancelled) return;
        setHasRef(exists);
        setStage(exists ? 'liveness' : 'enroll');
        setMessage(
          exists
            ? 'Reference face on file - continue with the liveness check.'
            : 'Step 1: capture your reference face. Enrolling again always replaces the previous face.'
        );
      } catch {
        if (cancelled) return;
        setHasRef(false);
        setStage('enroll');
        setMessage('Step 1: capture your reference face. Enrolling again always replaces the previous face.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const takeFrame = useCallback((): string | null => {
    const frame = captureRef.current?.() ?? null;
    if (!frame) setError('No frame captured - make sure the camera is on.');
    return frame;
  }, []);

  // ---- Stage handlers ----
  const requestPermission = async () => {
    setPerm('checking');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPerm('ok');
      setStage(hasRef ? 'liveness' : 'enroll');
      setMessage(hasRef ? 'Reference face on file - continue with the liveness check.' : 'Capture your reference face to continue.');
    } catch (err) {
      setPerm('denied');
      setError(err instanceof Error ? err.message : 'Camera access denied');
    }
  };

  const handleEnroll = async () => {
    if (!captured || !user) return;
    setBusy(true);
    setError('');
    try {
      const response = await faceService.enroll({
        candidate_id: user.id,
        image_base64: captured,
        source: 'enrollment',
      });
      if (response.success) {
        setHasRef(true);
        setCaptured(null);
        setStage('liveness');
        setMessage(
          `Reference face stored (quality ${Math.round((response.quality_score || 0) * 100)}%). Now complete the liveness check.`
        );
      } else {
        setError(response.error || 'Enrollment failed - try again with better lighting.');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || 'Enrollment failed - please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleLiveness = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError('');

    try {
      // 1. Capture a short burst so the blink / head turn lands inside the window
      const frames: string[] = [];
      for (let i = 0; i < LIVENESS_FRAMES; i++) {
        setLivenessCountdown(Math.ceil(((LIVENESS_FRAMES - i) * LIVENESS_GAP_MS) / 1000));
        const frame = captureRef.current?.() ?? null;
        if (frame) frames.push(frame);
        await new Promise((resolve) => setTimeout(resolve, LIVENESS_GAP_MS));
      }
      setLivenessCountdown(0);

      if (frames.length === 0) {
        setError('No frames captured - make sure the camera is on.');
        return;
      }

      // 2. Send them one by one; stop at the first frame that passes
      let passed: { score: number; action: string } | null = null;
      let closest: { score: number; action: string } | null = null;
      let firstFrameError: string | null = null;
      let badFrames = 0;

      for (const frame of frames) {
        let result:
          | { live?: boolean; score?: number; action?: string; details?: Record<string, unknown> }
          | undefined;
        try {
          result = await faceService.liveness({
            candidate_id: user.id,
            image_base64: frame,
            action: livenessAction,
          });
        } catch {
          continue; // transient frame failure - the next one may still pass
        }
        if (result?.details?.error) {
          // no face / no landmarks in that frame
          badFrames += 1;
          firstFrameError = firstFrameError || String(result.details.error);
          continue;
        }

        const score = Number(result?.score ?? 0);
        const action = result?.action || livenessAction;
        if (result?.live) {
          passed = { score, action };
          break;
        }
        // remember the closest attempt for feedback (for a blink, lower is closer)
        if (!closest || (livenessAction === 'blink' ? score < closest.score : score > closest.score)) {
          closest = { score, action };
        }
      }

      if (passed) {
        setLiveness({ live: true, score: passed.score, action: passed.action });
        setStage('capture');
        setMessage(
          livenessAction === 'blink'
            ? 'Eye closure detected - liveness confirmed. Now capture a fresh frame for the identity check.'
            : 'Head turn detected - liveness confirmed. Now capture a fresh frame for the identity check.'
        );
      } else if (!closest && badFrames > 0) {
        setLiveness({ live: false, score: 0, action: livenessAction });
        setError(
          `${firstFrameError || 'No face detected'} in ${badFrames} of ${frames.length} frames - move closer and keep your whole face inside the oval, then try again.`
        );
      } else {
        const hint = closest
          ? livenessAction === 'blink'
            ? ` Closest frame: eye ratio ${closest.score.toFixed(2)} (needs below 0.22).`
            : ` Closest frame: head turn ${closest.score.toFixed(2)} (needs above 0.10).`
          : '';
        const faceNote = badFrames > 0 ? ` ${badFrames} of ${frames.length} frames had no detectable face.` : '';
        setLiveness({ live: false, score: closest?.score ?? 0, action: livenessAction });
        setError(
          `Liveness not detected in ${frames.length} frames.${hint}${faceNote} Try again, or skip it (it stays recorded as a review signal).`
        );
        // alternate the challenge so a retry is not impossible
        setLivenessAction((a) => (a === 'blink' ? 'head_turn' : 'blink'));
      }
    } finally {
      setLivenessCountdown(0);
      setBusy(false);
    }
  };

  const finish = (wasFlagged: boolean) => {
    markIdentityVerified();
    setFlagged(wasFlagged);
    setStage('success');
    setError('');
  };

  const handleCheck = async (allowFlagged = false) => {
    if (!user || !checkFrame) return;
    setBusy(true);
    setError('');
    try {
      const result = await faceService.verify({ candidate_id: user.id, image_base64: checkFrame });
      const outcome: VerifyResult = {
        verified: !!result.verified,
        similarity: Number(result.similarity ?? 0),
        threshold: result.threshold,
        error: result.error,
      };
      setVerifyResult(outcome);
      if (outcome.verified) {
        finish(false);
      } else if (allowFlagged) {
        finish(true);
      } else {
        setError(
          outcome.error ||
            `The captured frame does not match your enrolled face (similarity ${Math.round(outcome.similarity * 100)}%). Retake the frame, re-enrol, or continue flagged for review.`
        );
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || 'Identity check failed - please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ---- Render ----
  const camActive = stage !== 'permissions' && stage !== 'success';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader steps={['Position', 'Readiness', 'Identity', 'Interview']} activeStep={3} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page head + stepper */}
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Step 2 of 3</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">Face enrolment & identity check</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Enrol your reference face, pass the liveness prompt, then capture a fresh frame and confirm it matches the
            face you enrolled. Only a match continues to the interview.
          </p>
        </div>

        <ol className="mb-6 flex flex-wrap gap-2">
          {STEP_LABELS.map((label, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
            return (
              <li
                key={label}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  state === 'active'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : state === 'done'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-500'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
                  {state === 'done' ? '✓' : i + 1}
                </span>
                {label}
              </li>
            );
          })}
        </ol>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Camera column */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">Live camera</CardTitle>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      perm === 'ok' ? 'bg-green-50 text-green-700' : perm === 'denied' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {perm === 'ok' ? 'Camera on' : perm === 'denied' ? 'Permission denied' : 'Checking...'}
                  </span>
                </div>
                <CardDescription>Keep a single face centered inside the oval, shoulders visible.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Webcam
                  className="mx-auto w-full max-w-xl"
                  guide="oval"
                  showControls={false}
                  autoStart={camActive}
                  onReady={(capture) => {
                    captureRef.current = capture;
                  }}
                  onError={(err) => {
                    setPerm('denied');
                    setError(err);
                    setStage((s) => (s === 'success' ? s : 'permissions'));
                  }}
                />

                {/* Stage-specific prompt */}
                {stage === 'permissions' && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">Camera access required</p>
                    <p className="mt-1">
                      Allow camera and microphone access in your browser to continue with the identity check.
                    </p>
                    <Button className="mt-3" onClick={requestPermission} loading={perm === 'checking'}>
                      Grant camera &amp; microphone access
                    </Button>
                  </div>
                )}

                {stage === 'enroll' && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-medium text-gray-900">Enrol your reference face</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Neutral expression, eyes open, good lighting, no glasses or hats. Enrolling again replaces the
                      face stored earlier - only one person can be enrolled on your account.
                    </p>
                    {captured ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <img
                          src={captured}
                          alt="Captured reference face"
                          className="h-28 w-36 rounded-lg border border-gray-200 object-cover"
                        />
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={() => setCaptured(null)} disabled={busy}>
                            Retake
                          </Button>
                          <Button onClick={handleEnroll} loading={busy}>
                            Enrol this face
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        className="mt-3"
                        onClick={() => {
                          const frame = takeFrame();
                          if (frame) setCaptured(frame);
                        }}
                      >
                        Capture face
                      </Button>
                    )}
                  </div>
                )}

                {stage === 'liveness' && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-medium text-gray-900">Liveness check</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {busy && livenessCountdown > 0
                        ? `Capturing ${livenessCountdown}s of ${LIVENESS_SECONDS} - ${
                            livenessAction === 'blink' ? 'close your eyes now' : 'turn and hold'
                          }...`
                        : busy
                          ? 'Checking frames...'
                          : LIVENESS_PROMPTS[livenessAction]}
                    </p>

                    {busy && livenessCountdown > 0 && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all"
                          style={{ width: `${((LIVENESS_SECONDS - livenessCountdown) / LIVENESS_SECONDS) * 100}%` }}
                        />
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={handleLiveness} loading={busy}>
                        {busy ? 'Capturing...' : 'Capture & check'}
                      </Button>
                      <Button variant="ghost" onClick={() => setStage('capture')} disabled={busy}>
                        Skip liveness
                      </Button>
                      {hasRef && (
                        <Button variant="ghost" onClick={() => setStage('enroll')} disabled={busy}>
                          Re-enrol face
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {stage === 'capture' && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-medium text-gray-900">Capture check frame</p>
                    <p className="mt-1 text-sm text-gray-600">
                      Take a fresh frame - separate from the enrolment shot. It will be checked against the face you
                      enrolled.
                    </p>
                    {checkFrame ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <img
                          src={checkFrame}
                          alt="Captured check frame"
                          className="h-28 w-36 rounded-lg border border-gray-200 object-cover"
                        />
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={() => setCheckFrame(null)} disabled={busy}>
                            Retake
                          </Button>
                          <Button onClick={() => setStage('check')} disabled={busy}>
                            Use this frame
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        className="mt-3"
                        onClick={() => {
                          const frame = takeFrame();
                          if (frame) setCheckFrame(frame);
                        }}
                      >
                        Capture frame
                      </Button>
                    )}
                  </div>
                )}

                {stage === 'check' && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-sm font-medium text-gray-900">Identity check</p>
                    <p className="mt-1 text-sm text-gray-600">
                      We compare the captured frame with your enrolled reference face. A match continues to the
                      interview.
                    </p>
                    {checkFrame && (
                      <img
                        src={checkFrame}
                        alt="Frame being checked"
                        className="mt-3 h-28 w-36 rounded-lg border border-gray-200 object-cover"
                      />
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => handleCheck(false)} loading={busy} disabled={!checkFrame}>
                        Check my identity
                      </Button>
                      <Button variant="ghost" onClick={() => setStage('capture')} disabled={busy}>
                        Retake frame
                      </Button>
                      <Button variant="ghost" onClick={() => setStage('enroll')} disabled={busy}>
                        Re-enrol face
                      </Button>
                    </div>
                    {verifyResult && !verifyResult.verified && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                        <p className="w-full text-sm font-medium text-red-700">
                          No match - the captured frame does not belong to the enrolled face
                          {verifyResult.similarity ? ` (similarity ${Math.round(verifyResult.similarity * 100)}%)` : ''}.
                        </p>
                        <Button variant="secondary" onClick={() => handleCheck(true)} disabled={busy}>
                          Continue anyway (flagged for review)
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {stage === 'success' && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <p className="font-medium text-green-900">
                      {flagged ? 'Identity check completed - flagged for review' : 'Identity verified'}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-green-800">
                      <li>
                        • Identity:{' '}
                        {verifyResult
                          ? `${Math.round(verifyResult.similarity * 100)}% match${verifyResult.verified ? '' : ' (below threshold)'}`
                          : 'checked'}
                      </li>
                      <li>
                        • Liveness:{' '}
                        {liveness ? `${liveness.live ? 'passed' : 'not confirmed'} (${liveness.action})` : 'skipped'}
                      </li>
                      {flagged && <li>• A review flag was recorded for the recruiter</li>}
                    </ul>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => navigate('/interview')}>Continue to interview</Button>
                      <Button variant="ghost" onClick={() => navigate('/positions')}>
                        Back to start
                      </Button>
                    </div>
                  </div>
                )}

                {/* Messages */}
                {message && !error && <p className="text-sm text-gray-600">{message}</p>}
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Guidance sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">How to pass</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Face the camera straight on, head and shoulders in frame</li>
                  <li>• Even lighting - avoid backlight and shadows</li>
                  <li>• Neutral expression, eyes open, no glasses or hats</li>
                  <li>• Only one person visible at a time</li>
                  <li>• Sit still while each frame is captured</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Why we check</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  Your reference face proves it is really you (FR-ID-01) - re-enrolling always replaces the previous
                  face, so a second person can never be enrolled on your account. The check compares a fresh capture
                  against that face, liveness blocks photo or video spoofing (FR-ID-05), and every result is stored as a
                  timestamped event for human review - never an automatic verdict.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
