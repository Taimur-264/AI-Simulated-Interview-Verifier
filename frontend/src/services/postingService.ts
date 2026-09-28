import { api } from './api';
import type { AdminJobPosting, JobPosting, PostingQuestion } from '../types';

/** Payload to create a posting (admin console). */
export interface PostingCreateInput {
  title: string;
  department?: string | null;
  location?: string | null;
  description?: string | null;
  duration_minutes?: number;
}

/** Payload to edit a posting - every field optional. */
export type PostingUpdateInput = Partial<PostingCreateInput> & { is_active?: boolean };

/** Payload to create/edit a posting question. */
export interface PostingQuestionInput {
  text: string;
  type: 'mcq' | 'text' | 'coding';
  options?: string[] | null;
  model_answer?: string | null;
  answer_index?: number | null;
  time_limit?: number;
}

export const postingService = {
  /** Open positions for the candidate position board. */
  async getPostings(): Promise<JobPosting[]> {
    const response = await api.get('/postings');
    return response.data;
  },

  /** All postings incl. questions (admin only). */
  async adminList(): Promise<AdminJobPosting[]> {
    const response = await api.get('/admin/postings');
    return response.data;
  },

  async create(data: PostingCreateInput): Promise<AdminJobPosting> {
    const response = await api.post('/admin/postings', data);
    return response.data;
  },

  async update(postingId: number, data: PostingUpdateInput): Promise<AdminJobPosting> {
    const response = await api.put(`/admin/postings/${postingId}`, data);
    return response.data;
  },

  async remove(postingId: number): Promise<void> {
    await api.delete(`/admin/postings/${postingId}`);
  },

  async addQuestion(postingId: number, data: PostingQuestionInput): Promise<PostingQuestion> {
    const response = await api.post(`/admin/postings/${postingId}/questions`, data);
    return response.data;
  },

  async updateQuestion(
    postingId: number,
    questionId: number,
    data: PostingQuestionInput,
  ): Promise<PostingQuestion> {
    const response = await api.put(`/admin/postings/${postingId}/questions/${questionId}`, data);
    return response.data;
  },

  async removeQuestion(postingId: number, questionId: number): Promise<void> {
    await api.delete(`/admin/postings/${postingId}/questions/${questionId}`);
  },
};
