import { api } from './api';

export const interviewService = {
  /**
   * Start a new interview session (posting_id ties it to a job posting)
   */
  async startInterview(data: {
    title: string;
    duration_minutes: number;
    posting_id?: number | null;
  }): Promise<any> {
    const response = await api.post('/interview/start', data);
    return response.data;
  },

  /**
   * Get interview details
   */
  async getInterview(interviewId: number): Promise<any> {
    const response = await api.get(`/interview/${interviewId}`);
    return response.data;
  },

  /**
   * Submit answer for a question
   */
  async submitAnswer(interviewId: number, data: { question_id: number; answer: string }): Promise<any> {
    const response = await api.post(`/interview/${interviewId}/answer`, data);
    return response.data;
  },

  /**
   * Log an event during interview
   */
  async logEvent(interviewId: number, data: { event_type: string; timestamp: string; data: any }): Promise<any> {
    const response = await api.post(`/interview/${interviewId}/event`, data);
    return response.data;
  },

  /**
   * End interview session
   */
  async endInterview(interviewId: number): Promise<any> {
    const response = await api.post(`/interview/${interviewId}/end`, {});
    return response.data;
  },
};