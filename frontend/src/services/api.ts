/**
 * API service layer - handles all HTTP communication with backend.
 * Uses Axios with interceptors for auth tokens and error handling.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { UserCreate, UserLogin, UserResponse, Token, FaceEnrollResponse } from '../types';

// ---- Axios Instance ----

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';
// Exported for unload-time requests (keepalive fetch) that bypass the axios instance
export { API_BASE_URL };

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ---- Request Interceptor: Attach JWT Token ----

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// ---- Response Interceptor: Handle 401 (Token Expired) ----

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isLoginAttempt = (error.config?.url ?? '').includes('/auth/login');
    const onAuthPage = ['/login', '/register'].includes(window.location.pathname);

    // 401 on the login/register form just means bad credentials - let the page
    // render its own error message instead of hard-reloading (which wipes state)
    //
    // Only a real response signs the user out - network failures (backend
    // restarting, offline) and 5xx errors must NOT kill the session, so the
    // candidate keeps their cached login and the interview page keeps its state.
    // 403 is left alone here: it can come from a feature endpoint (e.g. face
    // ownership checks) and must not wipe a live interview.
    if (error.response?.status === 401 && !isLoginAttempt && !onAuthPage) {
      // Token expired or invalid - clear storage and redirect to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ---- Face API Functions ----

export const faceService = {
  /**
   * Enroll a reference face
   */
  async enroll(data: { candidate_id: number; image_base64: string; source?: string }): Promise<FaceEnrollResponse> {
    const response = await api.post<FaceEnrollResponse>('/face/enroll', data);
    return response.data;
  },

  /**
   * Verify face against reference
   */
  async verify(data: { candidate_id: number; image_base64: string; interview_id?: number }): Promise<any> {
    const response = await api.post('/face/verify', data);
    return response.data;
  },

  /**
   * Liveness check
   */
  async liveness(data: { candidate_id: number; image_base64: string; action: string; previous_landmarks?: number[][] }): Promise<any> {
    const response = await api.post('/face/liveness', data);
    return response.data;
  },

  /**
   * Get reference faces
   */
  async getReferenceFaces(candidateId: number): Promise<any> {
    const response = await api.get(`/face/reference/${candidateId}`);
    return response.data;
  },

  /**
   * Get identity events
   */
  async getIdentityEvents(interviewId: number): Promise<any> {
    const response = await api.get(`/face/events/${interviewId}`);
    return response.data;
  },
};

// ---- Auth API Functions ----

export const authService = {
  /**
   * Register a new user
   */
  async register(data: UserCreate): Promise<UserResponse> {
    const response = await api.post<UserResponse>('/auth/register', data);
    return response.data;
  },

  /**
   * Login and get JWT token
   */
  async login(data: UserLogin): Promise<Token> {
    const response = await api.post<Token>('/auth/login', data);
    return response.data;
  },

  /**
   * Get current user profile (requires valid token)
   */
  async getMe(): Promise<UserResponse> {
    const response = await api.get<UserResponse>('/auth/me');
    return response.data;
  },
};

// ---- Token Management ----

export const tokenService = {
  getToken(): string | null {
    return localStorage.getItem('access_token');
  },

  setToken(token: string): void {
    localStorage.setItem('access_token', token);
  },

  removeToken(): void {
    localStorage.removeItem('access_token');
  },

  getUser(): UserResponse | null {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  },

  setUser(user: UserResponse): void {
    localStorage.setItem('user', JSON.stringify(user));
  },

  removeUser(): void {
    localStorage.removeItem('user');
  },

  clearAll(): void {
    this.removeToken();
    this.removeUser();
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};

// ---- Interview API Functions ----

export { interviewService } from './interviewService';
export { reviewService } from './reviewService';
export { postingService } from './postingService';

export { api };