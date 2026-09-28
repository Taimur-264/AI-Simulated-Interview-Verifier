/**
 * Start page - interview readiness, monitoring disclosure and consent.
 *
 * Flow: /login -> /start -> /enroll (camera + identity) -> /interview -> /complete
 *
 * The candidate reads what is monitored (NFR-PRIV-02), consents, and only then
 * can continue to the identity check or straight into the interview when this
 * session already passed it (FR-ID-01).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { faceService } from '../services/api';
import { AppHeader, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components';
import { getSelectedPosting, isIdentityVerified, type SelectedPosting } from '../lib/session';

type CheckState = 'idle' | 'checking' | 'ok' | 'failed';

const MONITORING_POINTS = [
  'Webcam feed: face presence, single/multiple person and identity match',
  'Microphone: audio presence and prolonged silence (levels only - no audio is recorded)',
  'Identity: reference-face comparison and liveness (blink / head turn)',
  'Browser: tab changes, focus loss, time away, full-screen exits and leaving the interview page',
  'Clipboard: copy and paste actions with a short text snippet (possible external help)',
  'Keyboard: keystroke counts, characters typed in the interview answer boxes, and monitored shortcuts (new tab, window switch, find, developer tools) - keys typed in other tabs or apps are not observable',
  'Cursor: click activity, leaving the window, idle periods and a movement path sample',
  'Session events: timestamped and stored for human review only',
];

const TIMELINE = [
  { label: 'Identity & camera check', detail: 'Capture your face, liveness and identity match' },
  { label: 'Secure interview', detail: 'Answer questions while being monitored' },
  { label: 'Human review', detail: 'Flags are reviewed - no automatic verdicts' },
];

function StatusDot({ state }: { state: 'ok' | 'fail' | 'idle' }) {
  if (state === 'ok') return <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />;
  if (state === 'fail') return <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />;
  return <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gray-300" />;
}

export function Start() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // The position picked on /positions (stored once so the reference is stable)
  const [posting] = useState<SelectedPosting | null>(() => getSelectedPosting());

  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [camera, setCamera] = useState<CheckState>('idle');
  const [cameraMessage, setCameraMessage] = useState('');
  const [mic, setMic] = useState<CheckState>('idle');
  const [micMessage, setMicMessage] = useState('');
  const [consent, setConsent] = useState(false);

  const identityOk = isIdentityVerified();

  // No position selected -> back to the board to pick one
  useEffect(() => {
    if (!posting) navigate('/positions', { replace: true });
  }, [posting, navigate]);

  // Reference face status (FR-ID-01)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    faceService
      .getReferenceFaces(user.id)
      .then((faces) => {
        if (!cancelled) setEnrolled(Array.isArray(faces) && faces.length > 0);
      })
      .catch(() => {
        if (!cancelled) setEnrolled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const runSystemCheck = useCallback(async () => {
    setCamera('checking');
    setMic('checking');
    setCameraMessage('');
    setMicMessage('');

    const cameraCheck = navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        setCamera('ok');
        setCameraMessage('Camera ready.');
      })
      .catch((err: unknown) => {
        setCamera('failed');
        setCameraMessage(err instanceof Error ? err.message : 'Camera unavailable.');
      });

    const micCheck = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        setMic('ok');
        setMicMessage('Microphone ready.');
      })
      .catch((err: unknown) => {
        setMic('failed');
        setMicMessage(err instanceof Error ? err.message : 'Microphone unavailable.');
      });

    await Promise.all([cameraCheck, micCheck]);
  }, []);

  const items: Array<{ label: string; state: 'ok' | 'fail' | 'idle'; hint: string }> = [
    {
      label: 'Account authenticated',
      state: user ? 'ok' : 'fail',
      hint: user?.email || 'Not signed in',
    },
    {
      label: 'Camera',
      state: camera === 'ok' ? 'ok' : camera === 'failed' ? 'fail' : 'idle',
      hint: camera === 'idle' ? 'Not checked yet' : cameraMessage,
    },
    {
      label: 'Microphone',
      state: mic === 'ok' ? 'ok' : mic === 'failed' ? 'fail' : 'idle',
      hint: mic === 'idle' ? 'Not checked yet' : micMessage,
    },
    {
      label: 'Reference face enrolled',
      state: enrolled === null ? 'idle' : enrolled ? 'ok' : 'fail',
      hint: enrolled ? 'Stored securely for identity checks' : 'You will capture it in the next step',
    },
    {
      label: 'Identity verified (this session)',
      state: identityOk ? 'ok' : 'idle',
      hint: identityOk ? 'Passed - ready to start' : 'Completed during the identity check',
    },
  ];

  const ctaTarget = identityOk ? '/interview' : '/enroll';
  const ctaLabel = identityOk ? 'Start interview' : 'Continue to identity check';

  if (!posting) return null; // redirecting to /positions

  const meta = [
    { label: 'Duration', value: `${posting.duration_minutes} minutes` },
    { label: 'Questions', value: '5 questions' },
    { label: 'Format', value: 'MCQ, text, coding' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader steps={['Position', 'Readiness', 'Identity', 'Interview']} activeStep={2} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Hero */}
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Candidate portal</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">Ready for your {posting.title} interview?</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Complete the identity and camera check first, then the interview begins in a monitored, secure
            environment.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Interview card */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>{posting.title}</CardTitle>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    Not started
                  </span>
                </div>
                <CardDescription>
                  {[posting.department, posting.location].filter(Boolean).join(' · ') ||
                    'Monitored technical screening'}{' '}
                  - 5 questions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {meta.map((entry) => (
                    <div key={entry.label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">{entry.label}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{entry.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h4 className="font-semibold text-amber-900">What is monitored during the interview</h4>
                  <ul className="mt-2 space-y-1.5 text-sm text-amber-800">
                    {MONITORING_POINTS.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span aria-hidden="true">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-amber-800">
                    Signals are reviewed by a human. No event automatically decides your result.
                  </p>
                </div>

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    I understand and agree to camera, microphone, identity and session monitoring for this
                    interview.
                  </span>
                </label>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button size="lg" disabled={!consent} onClick={() => navigate(ctaTarget)}>
                    {ctaLabel}
                  </Button>
                  {!consent && <span className="text-sm text-gray-500">Accept monitoring to continue.</span>}
                </div>
              </CardContent>
            </Card>

            {/* What happens next */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">What happens next</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {TIMELINE.map((step, i) => (
                    <li key={step.label} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{step.label}</p>
                        <p className="text-sm text-gray-600">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Readiness</CardTitle>
                <CardDescription>Everything that must pass before you start</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-4">
                  {items.map((item) => (
                    <li key={item.label} className="flex gap-3">
                      <StatusDot state={item.state} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{item.label}</p>
                        <p className="break-words text-xs text-gray-500">{item.hint}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-5 w-full"
                  onClick={runSystemCheck}
                  loading={camera === 'checking' || mic === 'checking'}
                >
                  {camera === 'ok' || mic === 'ok' ? 'Re-run system check' : 'Run system check'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Requirements</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• A working webcam and microphone</li>
                  <li>• Good lighting with your face clearly visible</li>
                  <li>• A quiet room - only you in the camera view</li>
                  <li>• Stable internet connection</li>
                  <li>• Keep this tab focused during the interview</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
