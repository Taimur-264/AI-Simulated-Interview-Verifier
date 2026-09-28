/**
 * Main App Component - Routing & Providers
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { tokenService } from './services/api';
import {
  Login,
  Register,
  Positions,
  Start,
  Enroll,
  Interview,
  Complete,
  Recruiter,
  AdminLogin,
  AdminDashboard,
  Postings,
} from './pages';
import { ProtectedRoute, FaceEnrollCheck } from './components';

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Reviewers land on the admin console, candidates on the position board. */
function resolveHome(): string {
  const user = tokenService.getUser();
  return user && (user.role === 'recruiter' || user.role === 'admin') ? '/admin' : '/positions';
}

// Inner app with auth-dependent routes
function AppRoutes() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* Dedicated admin console sign-in */}
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* Candidate flow: /positions -> /start -> /enroll -> /interview -> /complete */}
      <Route
        path="/positions"
        element={
          <ProtectedRoute>
            <Positions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/start"
        element={
          <ProtectedRoute>
            <Start />
          </ProtectedRoute>
        }
      />
      {/* Face enrolment + capture + identity check (the interview gate) */}
      <Route
        path="/enroll"
        element={
          <ProtectedRoute>
            <Enroll />
          </ProtectedRoute>
        }
      />
      {/* Legacy URL - enrolment owns the identity check now */}
      <Route path="/verify" element={<Navigate to="/enroll" replace />} />
      <Route
        path="/interview"
        element={
          <ProtectedRoute>
            <FaceEnrollCheck>
              <Interview />
            </FaceEnrollCheck>
          </ProtectedRoute>
        }
      />
      <Route
        path="/complete"
        element={
          <ProtectedRoute>
            <Complete />
          </ProtectedRoute>
        }
      />

      {/* Admin console: dashboard + job postings (role-gated on the backend) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/postings"
        element={
          <ProtectedRoute>
            <Postings />
          </ProtectedRoute>
        }
      />

      {/* Recruiter / reviewer dashboard (FR-ADMIN) - session detail */}
      <Route
        path="/review"
        element={
          <ProtectedRoute>
            <Recruiter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/review/:interviewId"
        element={
          <ProtectedRoute>
            <Recruiter />
          </ProtectedRoute>
        }
      />

      {/* Root + catch-all: reviewers to the console, candidates to the board */}
      <Route path="/" element={<Navigate to={resolveHome()} replace />} />
      <Route path="*" element={<Navigate to={resolveHome()} replace />} />
    </Routes>
  );
}

// Main App with providers
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}