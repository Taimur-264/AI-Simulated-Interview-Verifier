/**
 * Positions - the candidate's job board (post-login landing).
 *
 * Flow: /login -> /positions -> pick a position -> /start (readiness +
 * consent) -> /enroll (identity) -> /interview -> /complete.
 *
 * The chosen posting is stored in sessionStorage so the whole flow knows
 * which position the interview belongs to; the backend ties the interview
 * row to it and draws the posting's own questions (topped up from the
 * shared bank).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader, Button, Card, CardContent } from '../components';
import { postingService } from '../services/api';
import { setSelectedPosting } from '../lib/session';
import type { JobPosting } from '../types';

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
      {children}
    </span>
  );
}

export function Positions() {
  const navigate = useNavigate();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    postingService
      .getPostings()
      .then((data) => {
        if (!cancelled) setPostings(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load open positions. Is the backend running?');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startInterview = (posting: JobPosting) => {
    setSelectedPosting({
      id: posting.id,
      title: posting.title,
      duration_minutes: posting.duration_minutes,
      department: posting.department,
      location: posting.location,
    });
    navigate('/start');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader steps={['Position', 'Readiness', 'Identity', 'Interview']} activeStep={1} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Hero */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Candidate portal</p>
            <h1 className="mt-1 text-3xl font-bold text-gray-900">Open positions</h1>
            <p className="mt-2 max-w-2xl text-gray-600">
              Choose the position you are applying for. You will review what is monitored, consent, pass the
              identity check, and then start the interview for that role.
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="font-semibold">5 questions · monitored · human-reviewed</p>
            <p className="text-xs text-blue-600">No result is ever decided automatically.</p>
          </div>
        </div>

        {/* States */}
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
        )}

        {!error && postings === null && (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-500">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Loading open positions...
          </div>
        )}

        {!error && postings?.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-500">
              No open positions right now. Check back soon - new postings are added regularly.
            </CardContent>
          </Card>
        )}

        {/* Position cards */}
        {postings && postings.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {postings.map((posting) => (
              <Card key={posting.id} className="flex flex-col transition hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {posting.department && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                          {posting.department}
                        </p>
                      )}
                      <h2 className="mt-1 text-lg font-semibold leading-snug text-gray-900">{posting.title}</h2>
                    </div>
                    <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                      Open
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {posting.location && <MetaChip>{posting.location}</MetaChip>}
                    <MetaChip>{posting.duration_minutes} minutes</MetaChip>
                    <MetaChip>5 questions</MetaChip>
                    {posting.question_count > 0 && (
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                        Custom question set
                      </span>
                    )}
                  </div>

                  {posting.description && (
                    <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-gray-600">
                      {posting.description}
                    </p>
                  )}

                  <div className="mt-5 border-t border-gray-100 pt-4">
                    <Button className="w-full" onClick={() => startInterview(posting)}>
                      Apply &amp; start interview
                    </Button>
                    <p className="mt-2 text-center text-xs text-gray-400">
                      Camera, identity and session monitoring apply (consent on the next screen).
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
