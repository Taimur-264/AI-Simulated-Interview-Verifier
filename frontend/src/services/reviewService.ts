import { api } from './api';
import type { ReviewInterviewDetail, ReviewInterviewItem, SecurityReport } from '../types';

/**
 * Recruiter/reviewer dashboard API (FR-ADMIN-01..05).
 * All endpoints require a recruiter/admin role on the backend.
 */
export const reviewService = {
  /** Active + completed sessions with candidate, score and flag counts. */
  async listInterviews(): Promise<ReviewInterviewItem[]> {
    const response = await api.get('/review/interviews');
    return response.data?.interviews ?? [];
  },

  /** One session: identity checks, answers, flags and the full timeline. */
  async getInterview(interviewId: number): Promise<ReviewInterviewDetail> {
    const response = await api.get(`/review/interviews/${interviewId}`);
    return response.data;
  },

  /** Post-interview security report (FR-REPORT-01..05). */
  async getReport(interviewId: number): Promise<SecurityReport> {
    const response = await api.get(`/review/interviews/${interviewId}/report`);
    return response.data;
  },
};
