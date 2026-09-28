/**
 * Session flags for the candidate interview flow.
 *
 * `aiv_identity_verified_at` records when this browser session passed the
 * camera + identity check (FR-ID-01 .. FR-ID-06). It lives in sessionStorage
 * so a refresh inside the interview does not force a re-check, but a new
 * session always starts clean.
 */

const IDENTITY_KEY = 'aiv_identity_verified_at';
const IDENTITY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const POSTING_KEY = 'aiv_selected_posting';

/** The position the candidate picked - carried /positions -> /start -> /interview. */
export interface SelectedPosting {
  id: number;
  title: string;
  duration_minutes: number;
  department?: string | null;
  location?: string | null;
}

export function isIdentityVerified(): boolean {
  const ts = Number(sessionStorage.getItem(IDENTITY_KEY) || 0);
  return !!ts && Date.now() - ts < IDENTITY_TTL_MS;
}

export function identityVerifiedAt(): string | null {
  const ts = Number(sessionStorage.getItem(IDENTITY_KEY) || 0);
  return ts ? new Date(ts).toISOString() : null;
}

export function markIdentityVerified(): void {
  sessionStorage.setItem(IDENTITY_KEY, String(Date.now()));
}

export function clearIdentityVerified(): void {
  sessionStorage.removeItem(IDENTITY_KEY);
}

export function setSelectedPosting(posting: SelectedPosting): void {
  sessionStorage.setItem(POSTING_KEY, JSON.stringify(posting));
}

export function getSelectedPosting(): SelectedPosting | null {
  try {
    const raw = sessionStorage.getItem(POSTING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SelectedPosting> | null;
    return parsed && typeof parsed.id === 'number' && typeof parsed.title === 'string'
      ? (parsed as SelectedPosting)
      : null;
  } catch {
    return null;
  }
}

export function clearSelectedPosting(): void {
  sessionStorage.removeItem(POSTING_KEY);
}
