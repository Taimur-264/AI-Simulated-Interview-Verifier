/**
 * Recruiter / reviewer dashboard (FR-ADMIN-01..05).
 *
 * - /review            list of active + completed sessions with flags (FR-ADMIN-01/02)
 * - /review/:id        one session: identity, answers, flags, timeline (FR-ADMIN-03/04)
 * - "Generate report"  post-interview security report (FR-ADMIN-05, FR-REPORT-01..05)
 *
 * Everything shown is review context for a human - classifications and flags
 * never decide the candidate's outcome (NFR-SAFE-01, FR-CLASS-03).
 * Access is limited to recruiter/admin roles (NFR-SEC-02, NFR-PRIV-03).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components';
import { reviewService } from '../services/api';
import { EVENT_LABELS } from '../lib/eventLabels';
import { useAuth } from '../hooks/useAuth';
import type {
  EventClassification,
  ReviewInterviewDetail,
  ReviewInterviewItem,
  SecurityReport,
} from '../types';

// ---- shared formatting helpers ----

const formatDuration = (totalSeconds?: number | null) => {
  if (!totalSeconds || totalSeconds <= 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const formatWhen = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const eventLabel = (eventType: string) => EVENT_LABELS[eventType]?.label ?? eventType;

const CLASS_STYLES: Record<EventClassification, string> = {
  high_review: 'bg-rose-50 text-rose-700 border-rose-200',
  review: 'bg-amber-50 text-amber-700 border-amber-200',
  normal: 'bg-gray-50 text-gray-600 border-gray-200',
};

function ClassificationChip({ classification, label }: { classification: string; label: string }) {
  const style = CLASS_STYLES[(classification as EventClassification) ?? 'normal'] ?? CLASS_STYLES.normal;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</div>
  );
}

// ---- session list (/review) ----

export function SessionList({ items, onOpen }: { items: ReviewInterviewItem[]; onOpen: (id: number) => void }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="py-6 text-center text-sm text-gray-500">
            No interviews recorded yet. Sessions appear here as soon as a candidate starts one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((session) => {
        const needsReview = session.review_status.code === 'requires_review';
        return (
          <li key={session.id}>
            <Card>
              <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center">
                {/* Candidate + session */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900">
                      {session.candidate?.full_name || session.candidate?.email || `Candidate #${session.candidate?.id}`}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        session.status === 'active'
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-gray-50 text-gray-600'
                      }`}
                    >
                      {session.status === 'active' ? 'In progress' : 'Completed'}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        needsReview
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-green-200 bg-green-50 text-green-700'
                      }`}
                    >
                      {session.review_status.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-500">
                    Session #{session.id} · {session.title} ·{' '}
                    {session.candidate?.email ?? 'unknown candidate'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">Started {formatWhen(session.started_at)}</p>
                </div>

                {/* Numbers */}
                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:w-auto">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Duration</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatDuration(session.actual_duration_seconds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Score</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {session.score ? `${session.score.correct} / ${session.score.total}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Events</p>
                    <p className="text-sm font-semibold text-gray-900">{session.events_total}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Flags</p>
                    <p className="text-sm font-semibold text-gray-900">
                      <span className="text-amber-600">{session.flags.review}</span>
                      <span className="mx-1 text-gray-300">/</span>
                      <span className="text-rose-600">{session.flags.high_review}</span>
                    </p>
                  </div>
                </div>

                <Button variant="outline" size="sm" onClick={() => onOpen(session.id)} className="shrink-0">
                  Open session
                </Button>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ---- session detail (/review/:interviewId) ----

function SessionDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [detail, setDetail] = useState<ReviewInterviewDetail | null>(null);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    // Initial state (loading, no error, no report) is set on mount; the parent
    // remounts this component per interview via key, so no reset is needed here.
    let cancelled = false;
    reviewService
      .getInterview(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          setError(status === 403 ? 'Recruiter access required for stored monitoring records.' : 'Could not load this session.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const generateReport = async () => {
    setReportLoading(true);
    try {
      setReport(await reviewService.getReport(id));
    } catch {
      setError('Could not generate the security report.');
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) return <Spinner label="Loading session..." />;
  if (error && !detail) return <ErrorNote message={error} />;
  if (!detail) return <ErrorNote message="Session not found." />;

  const {
    interview,
    candidate,
    summary,
    flags,
    review_status: status,
    identity,
    incidents,
    external_activity: external,
    keyboard_activity: keyboard,
    timeline,
    questions,
  } = detail;
  const needsReview = status.code === 'requires_review';

  const stats = [
    { label: 'Status', value: interview.status === 'active' ? 'In progress' : 'Completed' },
    { label: 'Duration', value: formatDuration(interview.actual_duration_seconds) },
    { label: 'Score', value: interview.score ? `${interview.score.correct} / ${interview.score.total}` : '—' },
    { label: 'Events', value: String(summary.events_total) },
    { label: 'Review flags', value: String(flags.total) },
    { label: 'Identity mismatches', value: String(identity.mismatches) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            &larr; All sessions
          </Button>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Session #{interview.id} · {candidate?.full_name || candidate?.email || 'Unknown candidate'}
          </h1>
          <p className="text-sm text-gray-500">
            {interview.title} · {candidate?.email ?? '—'} · started {formatWhen(interview.started_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={generateReport} disabled={reportLoading}>
            {reportLoading ? 'Generating…' : report ? 'Refresh report' : 'Generate security report'}
          </Button>
        </div>
      </div>

      {/* Review banner - advisory, never a verdict (NFR-SAFE-01) */}
      <div
        className={`rounded-lg border p-4 text-sm ${
          needsReview ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'
        }`}
      >
        <p className="font-semibold">{status.label}</p>
        <p className="mt-1">{status.note}</p>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline (FR-ADMIN-04) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Event timeline</CardTitle>
            <CardDescription>
              Every recorded event in order - camera, browser, mouse, audio and identity sources merged into one
              synchronized view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400">No events recorded for this session.</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {timeline.map((entry) => {
                  // evidence sub-line: what was copied out / pasted in / typed
                  const d = entry.data as { snippet?: string; typed?: string; length?: number };
                  let evidence: string | null = null;
                  if (typeof d.snippet === 'string' && d.snippet) {
                    evidence = `"${d.snippet}"${typeof d.length === 'number' ? ` (${d.length} chars)` : ''}`;
                  } else if (typeof d.typed === 'string' && d.typed) {
                    evidence = `typed: ${d.typed}${d.typed.length >= 600 ? '…' : ''}`;
                  }
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                    >
                      <span className="w-16 shrink-0 text-xs text-gray-400">
                        {(() => {
                          const d2 = new Date(entry.timestamp);
                          return isNaN(d2.getTime()) ? '—' : d2.toLocaleTimeString();
                        })()}
                      </span>
                      <span className="min-w-0 flex-1 text-gray-800">{eventLabel(entry.event_type)}</span>
                      <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500">
                        {entry.source}
                      </span>
                      <ClassificationChip classification={entry.classification} label={entry.classification_label} />
                      {evidence && (
                        <span className="w-full min-w-0 truncate pl-16 font-mono text-xs text-gray-500">
                          {evidence}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Correlated incidents (FR-AI-01..03) */}
          <Card>
            <CardHeader>
              <CardTitle>Correlated signals</CardTitle>
              <CardDescription>Related events grouped as reviewable incident context.</CardDescription>
            </CardHeader>
            <CardContent>
              {incidents.length === 0 ? (
                <p className="text-sm text-gray-400">No flagged signals to correlate.</p>
              ) : (
                <ul className="space-y-2">
                  {incidents.map((incident) => (
                    <li key={incident.event_type} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">{eventLabel(incident.event_type)}</p>
                        <ClassificationChip
                          classification={incident.classification}
                          label={incident.classification_label}
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {incident.count}× · first {formatWhen(incident.first_at)} · last{' '}
                        {formatWhen(incident.last_at)}
                        {incident.repeated ? ' · repeated' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* External resource / AI assistant indicators (FR-RES-01..03) */}
          <Card>
            <CardHeader>
              <CardTitle>External activity</CardTitle>
              <CardDescription>Clipboard, print, page-exit and time-away signals.</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`mb-3 rounded-md border p-3 text-sm font-semibold ${
                  external.possible_external_use
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-green-200 bg-green-50 text-green-800'
                }`}
              >
                {external.possible_external_use ? 'Possible external resource use' : 'No external signals'}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: 'Question copied', value: external.copied },
                  { label: 'Text pasted', value: external.pasted },
                  { label: 'Printed', value: external.printed },
                  { label: 'Left the page', value: external.left_page },
                  { label: 'Longest absence', value: `${external.longest_absence_seconds}s` },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-2 rounded-md bg-gray-50 px-2 py-1">
                    <dt className="text-gray-500">{row.label}</dt>
                    <dd className="font-medium text-gray-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {external.possible_lookup && external.lookup_evidence && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs leading-relaxed text-amber-900">
                  <span className="font-semibold">Possible external lookup: </span>
                  {external.lookup_evidence}
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{external.note}</p>
            </CardContent>
          </Card>

          {/* Keyboard tracer (FR-BROW-01, FR-SECENV-03) - counts/combos only */}
          <Card>
            <CardHeader>
              <CardTitle>Keyboard activity</CardTitle>
              <CardDescription>Keystroke counts and monitored shortcuts (no characters stored).</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`mb-3 rounded-md border p-3 text-sm font-semibold ${
                  keyboard.environment_switch_attempted
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-green-200 bg-green-50 text-green-800'
                }`}
              >
                {keyboard.environment_switch_attempted
                  ? 'Shortcut attempt recorded'
                  : 'No switch attempts'}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: 'Keystrokes', value: keyboard.total_keys },
                  { label: 'Typing intervals', value: keyboard.typing_sessions },
                  { label: 'Shortcut attempts', value: keyboard.shortcut_attempts },
                  { label: 'DevTools attempts', value: keyboard.devtools_attempts },
                  { label: 'Search attempts', value: keyboard.search_attempts },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-2 rounded-md bg-gray-50 px-2 py-1">
                    <dt className="text-gray-500">{row.label}</dt>
                    <dd className="font-medium text-gray-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {Object.keys({ ...keyboard.shortcuts, ...keyboard.devtools, ...keyboard.searches }).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries({ ...keyboard.shortcuts, ...keyboard.devtools, ...keyboard.searches }).map(
                    ([combo, count]) => (
                    <span
                      key={combo}
                      className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700"
                    >
                      {combo} ×{count}
                    </span>
                  ))}
                </div>
              )}
              {keyboard.typed_content && (
                <div className="mt-3 rounded-md bg-gray-50 p-2 text-xs leading-relaxed text-gray-600">
                  <span className="font-semibold text-gray-700">Typed in page ({keyboard.typed_chars} chars): </span>
                  <span className="break-all">
                    {keyboard.typed_content.slice(0, 180)}
                    {keyboard.typed_content.length > 180 ? '…' : ''}
                  </span>
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{keyboard.note}</p>
            </CardContent>
          </Card>

          {/* Identity (FR-ADMIN-03, FR-ID-01..04) */}
          <Card>
            <CardHeader>
              <CardTitle>Identity &amp; reference</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Reference faces enrolled</dt>
                  <dd className="font-medium text-gray-900">{identity.reference_faces}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Identity checks stored</dt>
                  <dd className="font-medium text-gray-900">{identity.checks}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Mismatches</dt>
                  <dd className="font-medium text-gray-900">{identity.mismatches}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Last similarity</dt>
                  <dd className="font-medium text-gray-900">
                    {identity.last_similarity === null || identity.last_similarity === undefined
                      ? '—'
                      : identity.last_similarity.toFixed(3)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Answers (FR-ADMIN-03) */}
      <Card>
        <CardHeader>
          <CardTitle>Answers</CardTitle>
          <CardDescription>
            The candidate&apos;s submitted answers with the reference answer. The score is a study aid - the result is
            decided by a human reviewer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {questions.length === 0 ? (
            <p className="text-sm text-gray-400">No questions stored for this session.</p>
          ) : (
            <ol className="space-y-3">
              {questions.map((question) => (
                <li key={question.position} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Question {question.position} ·{' '}
                      {question.type === 'mcq' ? 'Multiple choice' : question.type === 'coding' ? 'Coding' : 'Written'}
                    </p>
                    {typeof question.correct === 'boolean' && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          question.correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {question.correct ? 'Correct' : 'Incorrect'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-medium leading-relaxed text-gray-900">{question.text}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Candidate answer
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                        {question.your_answer || <span className="italic text-gray-400">Not answered</span>}
                      </p>
                    </div>
                    <div className="rounded-md bg-blue-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                        Reference answer
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{question.model_answer}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Security report (FR-REPORT-01..05) */}
      {report && (
        <Card>
          <CardHeader className="print:hidden">
            <CardTitle>{report.report_type}</CardTitle>
            <CardDescription>
              Generated {formatWhen(report.generated_at)} · identifies the candidate and interview, summarizes events
              by source, and lists important events with timestamps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Candidate</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {report.candidate?.full_name || report.candidate?.email || '—'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Interview</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  #{report.interview.id} · {report.interview.title}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Duration</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatDuration(report.interview.actual_duration_seconds)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Final status</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{report.final_status.label}</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Event summary by source</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(report.event_summary.by_source).length === 0 && (
                  <p className="text-sm text-gray-400">No events recorded.</p>
                )}
                {Object.entries(report.event_summary.by_source).map(([source, count]) => (
                  <span
                    key={source}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700"
                  >
                    {source}: {count}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">External resource activity</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={
                    report.external_activity.possible_external_use
                      ? 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700'
                      : 'rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700'
                  }
                >
                  {report.external_activity.possible_external_use
                    ? 'Possible external resource use'
                    : 'No external signals'}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  copied: {report.external_activity.copied}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  pasted: {report.external_activity.pasted}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  printed: {report.external_activity.printed}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  left page: {report.external_activity.left_page}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  longest absence: {report.external_activity.longest_absence_seconds}s
                </span>
              </div>
              {report.external_activity.possible_lookup && report.external_activity.lookup_evidence && (
                <p className="mt-2 text-xs leading-relaxed text-amber-700">
                  <span className="font-semibold">Possible external lookup: </span>
                  {report.external_activity.lookup_evidence}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{report.external_activity.note}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Keyboard activity</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={
                    report.keyboard_activity.environment_switch_attempted
                      ? 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700'
                      : 'rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700'
                  }
                >
                  {report.keyboard_activity.environment_switch_attempted
                    ? 'Shortcut switch attempt'
                    : 'No switch attempts'}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  keys: {report.keyboard_activity.total_keys}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  shortcuts: {report.keyboard_activity.shortcut_attempts}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  devtools: {report.keyboard_activity.devtools_attempts}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700">
                  search: {report.keyboard_activity.search_attempts}
                </span>
                {Object.entries({
                  ...report.keyboard_activity.shortcuts,
                  ...report.keyboard_activity.devtools,
                  ...report.keyboard_activity.searches,
                }).map(([combo, count]) => (
                  <span
                    key={combo}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700"
                  >
                    {combo} ×{count}
                  </span>
                ))}
              </div>
              {report.keyboard_activity.typed_content && (
                <p className="mt-2 text-xs leading-relaxed text-gray-500">
                  <span className="font-semibold">Typed in page ({report.keyboard_activity.typed_chars} chars): </span>
                  <span className="break-all">
                    {report.keyboard_activity.typed_content.slice(0, 200)}
                    {report.keyboard_activity.typed_content.length > 200 ? '…' : ''}
                  </span>
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{report.keyboard_activity.note}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Important events ({report.important_event_count})
              </h3>
              {report.important_events.length === 0 ? (
                <p className="mt-1 text-sm text-gray-400">No Review or High Review events recorded.</p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {report.important_events.map((event, index) => (
                    <li key={`${event.timestamp}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-40 shrink-0 text-xs text-gray-400">{formatWhen(event.timestamp)}</span>
                      <span className="text-gray-800">{eventLabel(event.event_type)}</span>
                      <span className="text-xs text-gray-400">({event.source})</span>
                      <ClassificationChip
                        classification={event.classification}
                        label={event.classification_label}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="rounded-md bg-gray-50 p-3 text-xs text-gray-500">{report.final_status.note}</p>

            <div className="print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                Print / save as PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- session list (/review) ----

export function DashboardList({ onOpen }: { onOpen: (id: number) => void }) {
  const [items, setItems] = useState<ReviewInterviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reviewService
      .listInterviews()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sessions. Is the backend running?');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner label="Loading sessions..." />;
  if (error) return <ErrorNote message={error} />;
  return <SessionList items={items} onOpen={onOpen} />;
}

// ---- page ----

export function Recruiter() {
  const navigate = useNavigate();
  const params = useParams();
  const { user } = useAuth();

  const interviewId = params.interviewId ? Number(params.interviewId) : null;
  const isReviewer = user?.role === 'recruiter' || user?.role === 'admin';

  let body: ReactNode;
  if (!isReviewer) {
    // Access gate (the backend enforces this too - NFR-SEC-02)
    body = (
      <Card>
        <CardHeader className="text-center">
          <CardTitle>Recruiter access required</CardTitle>
          <CardDescription>
            Stored monitoring records are restricted to authorized reviewers (NFR-PRIV-03). Your account is a
            candidate - ask an administrator to grant the recruiter role.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={() => navigate('/positions')}>Back to the candidate flow</Button>
        </CardContent>
      </Card>
    );
  } else if (interviewId !== null) {
    body = <SessionDetail key={interviewId} id={interviewId} onBack={() => navigate('/review')} />;
  } else {
    body = (
      <>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Recruiter dashboard</h1>
            <p className="text-sm text-gray-500">
              Active and completed sessions with review flags, timelines and answers. Flags support human review - no
              automatic verdicts are made (NFR-SAFE-01).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </div>
        <DashboardList onOpen={(id) => navigate(`/review/${id}`)} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{body}</main>
    </div>
  );
}
