/**
 * AppHeader - Shared top bar for candidate pages and the session detail view.
 *
 * Shows the gradient brand, the optional flow stepper, role-aware navigation
 * (candidates -> position board, reviewers -> admin console) and the signed-in
 * user chip + logout. The admin console has its own dark header (AdminShell).
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui';

interface AppHeaderProps {
  /** Labels for the flow stepper, e.g. ['Identity', 'Interview'] */
  steps?: string[];
  /** 1-based index of the current step */
  activeStep?: number;
}

const ROLE_BADGES: Record<string, string> = {
  candidate: 'bg-blue-50 text-blue-700 border-blue-200',
  recruiter: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  admin: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function AppHeader({ steps, activeStep = 0 }: AppHeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const path = location.pathname;
  const onConsole = path.startsWith('/review') || path.startsWith('/admin');
  const isReviewer = user?.role === 'recruiter' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  const name = user?.full_name || user?.email || 'Candidate';
  const initials =
    (user?.full_name || user?.email || '?')
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Brand -> home for this role */}
        <button
          type="button"
          onClick={() => navigate(isReviewer ? '/admin' : '/positions')}
          className="flex items-center gap-3 text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-blue-600/25">
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
            <span className="block text-sm font-semibold text-gray-900">AI Interview Verifier</span>
            <span className="block text-xs text-gray-500">Secure interview environment</span>
          </span>
        </button>

        {/* Flow stepper */}
        {steps && steps.length > 0 && (
          <ol className="hidden items-center gap-1 md:flex">
            {steps.map((label, i) => {
              const n = i + 1;
              const state = n < activeStep ? 'done' : n === activeStep ? 'active' : 'todo';
              return (
                <li key={label} className="flex items-center gap-1">
                  {i > 0 && <span className="mx-1 h-px w-6 bg-gray-300" aria-hidden="true" />}
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      state === 'active'
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                        : state === 'done'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                    aria-hidden="true"
                  >
                    {state === 'done' ? '✓' : n}
                  </span>
                  <span
                    className={`text-sm ${
                      state === 'active' ? 'font-semibold text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* Nav + user + logout */}
        <div className="flex items-center gap-2">
          {!onConsole && (
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => navigate('/positions')}>
              Open positions
            </Button>
          )}
          {isReviewer && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(onConsole ? '/positions' : '/admin')}
            >
              {onConsole ? 'Candidate view' : 'Admin console'}
            </Button>
          )}

          {/* User chip */}
          <div className="hidden items-center gap-2.5 border-l border-gray-200 pl-3 sm:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
              {initials}
            </span>
            <span className="leading-tight">
              <span className="block max-w-[10rem] truncate text-sm font-medium text-gray-900">{name}</span>
              <span
                className={`mt-0.5 inline-block rounded-full border px-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                  ROLE_BADGES[user?.role || 'candidate'] || ROLE_BADGES.candidate
                }`}
              >
                {isAdmin ? 'admin' : isReviewer ? 'reviewer' : 'candidate'}
              </span>
            </span>
          </div>

          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
