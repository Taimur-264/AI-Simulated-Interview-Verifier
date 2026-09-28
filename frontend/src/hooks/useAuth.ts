/**
 * useAuth hook - manages authentication state across the app.
 * Provides user, login, logout, and loading states.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService, tokenService } from '../services/api';
import { clearIdentityVerified, clearSelectedPosting } from '../lib/session';
import type { UserResponse, UserLogin, UserCreate } from '../types';

export function useAuth() {
  const [user, setUser] = useState<UserResponse | null>(tokenService.getUser());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // ---- Initialize auth on mount ----
  useEffect(() => {
    const initAuth = async () => {
      const token = tokenService.getToken();
      if (token) {
        try {
          const userData = await authService.getMe();
          setUser(userData);
          tokenService.setUser(userData);
        } catch (e: unknown) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403) {
            // The server explicitly rejected the token - sign out
            tokenService.clearAll();
            setUser(null);
          }
          // Network/server error (e.g. backend restarting): keep the cached
          // session instead of dumping the candidate back on the login page.
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  // ---- Login ----
  const login = useCallback(async (credentials: UserLogin, redirectTo?: string) => {
    const { access_token } = await authService.login(credentials);
    tokenService.setToken(access_token);
    // A new login starts a fresh identity-verification session
    clearIdentityVerified();

    const userData = await authService.getMe();
    setUser(userData);
    tokenService.setUser(userData);

    // Redirect to intended page or the start of the candidate flow
    const from = redirectTo || location.state?.from?.pathname || '/positions';
    setTimeout(() => navigate(from, { replace: true }), 0);
  }, [navigate, location]);

  // ---- Register ----
  const register = useCallback(async (data: UserCreate, redirectTo?: string) => {
    await authService.register(data);
    // Auto-login after registration
    await login({ email: data.email, password: data.password }, redirectTo);
  }, [login]);

  // ---- Logout ----
  const logout = useCallback(() => {
    tokenService.clearAll();
    clearIdentityVerified();
    clearSelectedPosting();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  // ---- Value returned to components ----
  return {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };
}