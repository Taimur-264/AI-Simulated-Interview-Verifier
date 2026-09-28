/**
 * Admin console - shell + session dashboard (FR-ADMIN-01..05).
 *
 * - /admin            stats + active/completed sessions with review flags
 * - /admin/postings   job posting manager (Postings.tsx, admin role only)
 * - /admin/login      dedicated console sign-in (AdminLogin.tsx)
 *
 * Session detail stays at /review/:id (Recruiter.tsx). Everything shown is
 * review context for a human - flags never decide a candidate's outcome
 * (NFR-SAFE-01) and console access is role-gated (NFR-SEC-02, NFR-PRIV-03).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, CardContent } from '../components';
import { useAuth } from '../hooks/useAuth';
import { reviewService } from '../services/api';
import { ErrorNote, SessionList, Spinner } from './Recruiter';
import type { ReviewInterviewItem } from '../types';

// ---- shell ----

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = user?.role === 'admin';
  const onPostings = location.pathname.startsWith('/admin/postings');
  const tabs = [
    { label: 'Sessions', to: '/admin', active: !onPostings },
    ...(isAdmin ? [{ label: 'Job postings', to: '/admin/postings', active: onPostings }] : []),
  ];

  const name = user?.full_name || user?.email || 'Reviewer';
  const initials = (user?.full_name || user?.email || '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950 print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Brand + tabs */}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2.5 text-left"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/40">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-white">AI Interview Verifier</span>
                <span className="block text-xs text-gray-400">Admin console</span>
              </span>
            </button>

            <nav className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => navigate(tab.to)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    tab.active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* User + actions */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-gray-300 hover:bg-white/10 hover:text-white" onClick={() => navigate('/positions')}>
              Candidate view
            </Button>
            <div className="hidden items-center gap-2.5 border-l border-gray-700 pl-3 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
                {initials || '?'}
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium text-white">{name}</span>
                <span className="block text-xs capitalize text-gray-400">{user?.role || 'reviewer'}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-gray-600 text-gray-200 hover:bg-white/10 hover:text-white"
              onClick={logout}
            >
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

// ---- stat card ----

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: 'default' | 'warn' | 'danger' | 'info';
}) {
  const tones = {
    default: 'from-white to-gray-50 border-gray-200',
    warn: 'from-amber-50 to-white border-amber-200',
    danger: 'from-rose-50 to-white border-rose-200',
    info: 'from-blue-50 to-white border-blue-200',
  } as const;
  return (
    <Card className={`bg-gradient-to-br ${tones[tone]}`}>
      <CardContent>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

// ---- dashboard (/admin) ----

export function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isReviewer = user?.role === 'recruiter' || user?.role === 'admin';

  const [items, setItems] = useState<ReviewInterviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReviewer) return;
    let cancelled = false;
    reviewService
      .listInterviews()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sessions. Is the backend running?');
      });
    return () => {
      cancelled = true;
    };
  }, [isReviewer]);

  if (!isReviewer) {
    return (
      <AdminShell>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-xl font-semibold text-gray-900">Admin access required</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
              Stored monitoring records are restricted to authorized reviewers (NFR-PRIV-03). Your account is a
              candidate - ask an administrator for console access, or use the{' '}
              <button type="button" className="font-medium text-blue-600 underline" onClick={() => navigate('/positions')}>
                candidate portal
              </button>
              .
            </p>
          </CardContent>
        </Card>
      </AdminShell>
    );
  }

  const total = items?.length ?? 0;
  const active = items?.filter((item) => item.status === 'active').length ?? 0;
  const needsReview = items?.filter((item) => item.review_status.code === 'requires_review').length ?? 0;
  const flagged = items?.reduce((sum, item) => sum + item.flags.total, 0) ?? 0;

  return (
    <AdminShell>
      {/* Header row */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active and completed sessions with review flags, timelines and answers. Flags support human review -
            no automatic verdicts are made (NFR-SAFE-01).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total sessions" value={total} hint="All recorded interviews" />
        <StatCard label="In progress" value={active} hint="Candidates currently in an interview" tone="info" />
        <StatCard label="Needs human review" value={needsReview} hint="Sessions over the flag threshold" tone="warn" />
        <StatCard label="Flagged events" value={flagged} hint="Review + high-review events total" tone="danger" />
      </div>

      {/* Sessions */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Interview sessions</h2>
      </div>
      {error ? (
        <ErrorNote message={error} />
      ) : items === null ? (
        <Spinner label="Loading sessions..." />
      ) : (
        <SessionList items={items} onOpen={(id) => navigate(`/review/${id}`)} />
      )}
    </AdminShell>
  );
}
