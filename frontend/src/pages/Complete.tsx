/**
 * Complete page - "progress saved" confirmation with the end-of-interview
 * debrief: score out of total, reference answers vs submitted answers, and
 * every recorded moment (proctoring timeline).
 *
 * The score is a quiz auto-check only - flags and results are reviewed by a
 * human, never decided automatically (NFR-SAFE-01).
 */
import { useLocation } from 'react-router-dom';
import { AppHeader, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components';
import { EVENT_LABELS } from '../lib/eventLabels';
import { useAuth } from '../hooks/useAuth';
import type { InterviewScore, Moment, ReviewItem } from '../types';

interface CompleteState {
  reason?: 'completed' | 'timeout';
  answered?: number;
  events?: number;
  review?: ReviewItem[];
  score?: InterviewScore;
  moments?: Moment[];
  /** actual seconds spent in the interview (started -> submitted) */
  durationSeconds?: number;
}

export function Complete() {
  const location = useLocation();
  const { logout } = useAuth();
  const state = (location.state as CompleteState | null) ?? {};
  const timedOut = state.reason === 'timeout';
  const review = state.review ?? [];
  const moments = state.moments ?? [];
  const score = state.score;

  const formatDuration = (totalSeconds?: number) => {
    if (!totalSeconds || totalSeconds <= 0) return '—';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const stats = [
    { label: 'Time spent', value: formatDuration(state.durationSeconds) },
    { label: 'Score', value: score ? `${score.correct} / ${score.total}` : '—' },
    { label: 'Answers submitted', value: state.answered ?? '—' },
    { label: 'Events recorded', value: state.events ?? '—' },
    { label: 'Status', value: timedOut ? 'Time expired' : 'Submitted' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader steps={['Position', 'Readiness', 'Identity', 'Interview']} activeStep={5} />

      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <CardTitle>Your progress has been saved</CardTitle>
            <CardDescription>
              {timedOut
                ? 'Time expired - your submitted answers were saved and the session was recorded.'
                : 'All answers submitted. Your answers and the session timeline have been recorded for human review.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{stat.label}</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{stat.value}</p>
                </div>
              ))}
            </div>

            {review.length > 0 && (
              <section className="mt-8">
                <h2 className="text-base font-semibold text-gray-900">Answer review</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Your questions were drawn at random from the question bank, so no two interviews are the same.
                  Multiple choice is checked exactly; written answers are checked against the key terms of the
                  reference answer. This score is a study aid - the interview result is decided by a human reviewer.
                </p>
                <ol className="mt-4 space-y-3">
                  {review.map((item, i) => (
                    <li key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Question {i + 1} ·{' '}
                          {item.type === 'mcq' ? 'Multiple choice' : item.type === 'coding' ? 'Coding' : 'Written'}
                        </p>
                        {typeof item.correct === 'boolean' && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              item.correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                            }`}
                          >
                            {item.correct ? 'Correct' : 'Incorrect'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-medium leading-relaxed text-gray-900">{item.text}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md bg-gray-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your answer</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                            {item.yourAnswer || <span className="italic text-gray-400">Not answered</span>}
                          </p>
                        </div>
                        <div className="rounded-md bg-blue-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                            Reference answer
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{item.modelAnswer}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {moments.length > 0 && (
              <section className="mt-8">
                <h2 className="text-base font-semibold text-gray-900">All recorded moments</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Every event recorded during your session, in order. Flags are indicators for review only.
                </p>
                <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {moments.map((m, i) => {
                    const meta = EVENT_LABELS[m.event_type] ?? { label: m.event_type, tone: 'neutral' as const };
                    const dot =
                      meta.tone === 'ok' ? 'bg-green-500' : meta.tone === 'warn' ? 'bg-amber-500' : 'bg-gray-400';
                    return (
                      <li key={`${m.timestamp}-${i}`} className="flex items-start gap-2 text-sm">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-gray-800">{meta.label}</span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {(() => {
                            const d = new Date(m.timestamp);
                            return isNaN(d.getTime()) ? m.timestamp : d.toLocaleTimeString();
                          })()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-900">What happens next</p>
              <p className="mt-1">
                A recruiter reviews the recorded events together with your answers. Flags are indicators for review
                only - no automated decision is made about your result.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button onClick={logout}>Back to start</Button>
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">
              Back to start signs you out - every interview begins again with login, consent, liveness and the face
              check.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
