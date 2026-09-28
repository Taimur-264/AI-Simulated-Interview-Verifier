/**
 * FaceEnrollCheck - Blocks the interview until this session has passed the
 * camera + identity check (reference face enrolled AND /enroll completed).
 * Redirects to /enroll otherwise.
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { faceService } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { isIdentityVerified } from '../lib/session';

interface FaceEnrollCheckProps {
  children: React.ReactNode;
}

export function FaceEnrollCheck({ children }: FaceEnrollCheckProps) {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [hasReferenceFace, setHasReferenceFace] = useState(false);

  useEffect(() => {
    const checkReferenceFace = async () => {
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        const refFaces = await faceService.getReferenceFaces(user.id);
        setHasReferenceFace(Array.isArray(refFaces) && refFaces.length > 0);
      } catch {
        setHasReferenceFace(false);
      } finally {
        setChecking(false);
      }
    };

    checkReferenceFace();
  }, [user]);

  // Show loading while checking
  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" aria-label="Checking face enrollment" />
      </div>
    );
  }

  // Redirect to the enrolment/identity check if no reference face or not verified this session
  if (user && (!hasReferenceFace || !isIdentityVerified())) {
    return <Navigate to="/enroll" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}