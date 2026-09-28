/**
 * TypeScript types for the AI Interview Verifier frontend.
 * Matches backend Pydantic schemas exactly.
 */

// ---- Auth Types ----

export interface UserCreate {
  email: string;
  password: string;
  full_name?: string;
}

export interface UserLogin {
  email: string;
  password: string;
}

export interface UserResponse {
  id: number;
  email: string;
  full_name?: string;
  /** candidate | recruiter | admin - decides dashboard access (NFR-PRIV-03) */
  role?: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string; // ISO datetime string
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface TokenData {
  user_id?: number;
}

// ---- API Response Wrapper ----

export interface ApiError {
  detail: string;
}

// ---- Interview Types (for future phases) ----

export interface Interview {
  id: number;
  candidate_id: number;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  started_at?: string;
  ended_at?: string;
}

export interface Question {
  id: number;
  text: string;
  options: string[];
  correct_answer: number;
}

// ---- Face Verification Types ----

export interface FaceEnrollResponse {
  success: boolean;
  reference_face_id?: number;
  quality_score?: number;
  faces_detected: number;
  error?: string;
}

export interface FaceVerifyResponse {
  verified: boolean;
  similarity: number;
  threshold: number;
  faces_detected: number;
  liveness_verified?: boolean;
  liveness_score?: number;
  liveness_action?: string;
  event_id?: number;
  error?: string;
}

export interface LivenessCheckResponse {
  live: boolean;
  score: number;
  action: string;
  details: Record<string, any>;
}

export interface ReferenceFaceResponse {
  id: number;
  candidate_id: number;
  image_hash?: string;
  quality_score?: number;
  source: string;
  created_at: string;
}

export interface IdentityEventResponse {
  id: number;
  interview_id?: number;
  candidate_id: number;
  verified: number;
  similarity_score?: number;
  threshold_used?: number;
  liveness_verified?: number;
  liveness_score?: number;
  liveness_action?: string;
  faces_detected?: number;
  error_message?: string;
  created_at: string;
}

// ---- Interview Types ----

export interface InterviewCreate {
  title: string;
  duration_minutes: number;
}

export interface InterviewResponse {
  id: number;
  candidate_id: number;
  title: string;
  status: 'pending' | 'active' | 'completed';
  started_at?: string;
  ended_at?: string;
  duration_minutes: number;
  current_question: number;
  questions: InterviewQuestion[];
}

export interface InterviewQuestion {
  id: number;
  text: string;
  type: 'mcq' | 'coding' | 'text';
  options?: string[];
  time_limit: number;
}

export interface AnswerSubmit {
  question_id: number;
  answer: string;
}

export interface InterviewEvent {
  event_type: string;
  timestamp: string;
  data: Record<string, any>;
}

/** End-of-interview debrief: question, model answer and the candidate's answer. */
export interface ReviewItem {
  id: number;
  text: string;
  type: 'mcq' | 'coding' | 'text';
  modelAnswer: string;
  yourAnswer: string;
  /** auto-check against the reference answer (quiz score, not a verdict) */
  correct?: boolean;
  gradingMethod?: 'mcq' | 'keywords' | 'unanswered';
}

/** Quiz score returned when the interview is submitted. */
export interface InterviewScore {
  correct: number;
  total: number;
}

/** One recorded proctoring moment shown on the /complete screen. */
export interface Moment {
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ---- Recruiter dashboard types (FR-ADMIN-01..05) ----

/** Flags assist review only - never an automatic decision (NFR-SAFE-01). */
export type ReviewStatusCode = 'requires_review' | 'clear';

export interface ReviewStatusInfo {
  code: ReviewStatusCode;
  label: string;
  note?: string;
}

export interface ReviewCandidate {
  id: number;
  email: string;
  full_name?: string | null;
  role: string;
  is_active: boolean;
}

export interface ReviewScore {
  correct: number;
  total: number;
}

export interface ReviewInterviewItem {
  id: number;
  title: string;
  status: 'pending' | 'active' | 'completed';
  started_at?: string | null;
  ended_at?: string | null;
  duration_minutes: number;
  actual_duration_seconds?: number | null;
  score?: ReviewScore | null;
  candidate?: ReviewCandidate | null;
  events_total: number;
  flags: { review: number; high_review: number; total: number };
  identity_mismatches: number;
  review_status: ReviewStatusInfo;
}

export type EventClassification = 'normal' | 'review' | 'high_review';

export interface ReviewTimelineEntry {
  id: number;
  timestamp: string;
  event_type: string;
  source: string;
  classification: EventClassification;
  classification_label: string;
  data: Record<string, unknown>;
}

/** Related repeated signals grouped for review (FR-AI-01..03). */
export interface ReviewIncident {
  event_type: string;
  source: string;
  classification: EventClassification;
  classification_label: string;
  count: number;
  repeated: boolean;
  first_at: string;
  last_at: string;
}

/** Observable external-resource / AI-assistant indicators (FR-RES-01..03). */
export interface ExternalActivity {
  copied: number;
  pasted: number;
  printed: number;
  left_page: number;
  longest_absence_seconds: number;
  possible_external_use: boolean;
  possible_lookup: boolean;
  copied_snippet: string;
  pasted_snippet: string;
  lookup_evidence: string;
  note: string;
}

/** Keyboard tracer summary - counts, in-page typed text, shortcuts (FR-BROW-01, FR-SECENV-03). */
export interface KeyboardActivity {
  total_keys: number;
  typing_sessions: number;
  shortcuts: Record<string, number>;
  shortcut_attempts: number;
  devtools: Record<string, number>;
  devtools_attempts: number;
  searches: Record<string, number>;
  search_attempts: number;
  typed_content: string;
  typed_chars: number;
  environment_switch_attempted: boolean;
  note: string;
}

export interface ReviewAnswer {
  position: number;
  text: string;
  type: 'mcq' | 'coding' | 'text';
  options?: string[] | null;
  time_limit: number;
  model_answer?: string | null;
  your_answer?: string | null;
  correct?: boolean | null;
  grading_method?: string | null;
}

export interface ReviewInterviewDetail {
  interview: {
    id: number;
    title: string;
    status: string;
    started_at?: string | null;
    ended_at?: string | null;
    duration_minutes: number;
    actual_duration_seconds?: number | null;
    score?: ReviewScore | null;
  };
  candidate?: ReviewCandidate | null;
  summary: {
    events_total: number;
    by_classification: Record<string, number>;
    by_source: Record<string, number>;
  };
  flags: { review: number; high_review: number; total: number };
  review_status: ReviewStatusInfo;
  identity: {
    reference_faces: number;
    checks: number;
    mismatches: number;
    last_similarity?: number | null;
    last_check_at?: string | null;
  };
  incidents: ReviewIncident[];
  external_activity: ExternalActivity;
  keyboard_activity: KeyboardActivity;
  timeline: ReviewTimelineEntry[];
  questions: ReviewAnswer[];
}

/** Post-interview security report (FR-REPORT-01..05). */
export interface SecurityReport {
  report_type: string;
  generated_at: string;
  interview: ReviewInterviewDetail['interview'];
  candidate?: ReviewCandidate | null;
  final_status: ReviewStatusInfo;
  score?: ReviewScore | null;
  event_summary: ReviewInterviewDetail['summary'];
  identity: ReviewInterviewDetail['identity'];
  incidents: ReviewIncident[];
  external_activity: ExternalActivity;
  keyboard_activity: KeyboardActivity;
  important_events: Array<{
    timestamp: string;
    event_type: string;
    source: string;
    classification: EventClassification;
    classification_label: string;
    data: Record<string, unknown>;
  }>;
  important_event_count: number;
}

// ---- Job postings (admin-managed positions) ----

/** Open position a candidate may interview for. */
export interface JobPosting {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  duration_minutes: number;
  is_active: boolean;
  /** Custom questions on the posting (draw tops up from the shared bank). */
  question_count: number;
  created_at: string | null;
}

/** One custom question attached to a posting. */
export interface PostingQuestion {
  id: number;
  text: string;
  type: 'mcq' | 'text' | 'coding' | string;
  options: string[] | null;
  model_answer: string | null;
  answer_index: number | null;
  time_limit: number;
}

/** Admin view of a posting - includes its question list. */
export interface AdminJobPosting extends JobPosting {
  questions: PostingQuestion[];
}