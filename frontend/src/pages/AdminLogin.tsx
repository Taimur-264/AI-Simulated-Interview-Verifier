/**
 * AdminLogin - dedicated sign-in for the admin console.
 *
 * Same backend credentials as the candidate login, but this page only lets
 * recruiter/admin accounts through (roles are enforced again on every API
 * call - NFR-SEC-02). A candidate account that signs in here is signed right
 * back out with a clear message.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { authService, tokenService } from '../services/api';
import { Button, Input } from '../components';
import { useAuth } from '../hooks/useAuth';
import type { UserResponse } from '../types';

export function AdminLogin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in with console access -> go straight to the dashboard
  if (user && (user.role === 'admin' || user.role === 'recruiter')) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { access_token } = await authService.login({ email, password });
      tokenService.setToken(access_token);
      const me: UserResponse = await authService.getMe();
      tokenService.setUser(me);
      if (me.role === 'admin' || me.role === 'recruiter') {
        navigate('/admin', { replace: true });
      } else {
        // Not a console account - do not keep the session alive
        tokenService.clearAll();
        setError('This account does not have admin console access. Use a recruiter or admin account.');
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { detail?: string } } };
      setError(axiosError.response?.data?.detail || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">AI Interview Verifier</p>
            <p className="text-sm text-blue-200">Admin console</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-white">
            Review sessions, manage job postings, generate security reports.
          </h1>
          <ul className="mt-6 space-y-3 text-sm text-blue-100">
            {[
              'Interview sessions with flags, timelines and answers',
              'Job postings and their custom question sets',
              'Post-interview security reports for human review',
            ].map((point) => (
              <li key={point} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs">
                  ✓
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-blue-200/80">
          Access is role-gated - candidates cannot open console endpoints (NFR-SEC-02, NFR-PRIV-03).
        </p>
      </div>

      {/* Form panel */}
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-12 sm:px-6 lg:bg-white">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <p className="font-semibold text-white lg:text-gray-900">Admin console</p>
          </div>

          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Admin console</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">Sign in to manage interviews</h2>
          <p className="mt-2 text-sm text-gray-500">
            Recruiter or admin credentials only.{' '}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
              Candidate sign-in
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[38px] text-xs font-medium text-gray-400 hover:text-gray-600"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              Sign in to console
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-gray-400">
            AI Interview Verifier &copy; 2026 · Admin console
          </p>
        </div>
      </div>
    </div>
  );
}
