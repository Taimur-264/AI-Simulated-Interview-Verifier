/**
 * Timeline event labels - shared by the interview activity log and the
 * /complete "all the moments" list so both read the same wording.
 */
export type EventTone = 'ok' | 'warn' | 'neutral';

export const EVENT_LABELS: Record<string, { label: string; tone: EventTone }> = {
  interview_started: { label: 'Interview started', tone: 'neutral' },
  interview_ended: { label: 'Interview ended', tone: 'neutral' },
  camera_started: { label: 'Camera turned on', tone: 'ok' },
  camera_disabled: { label: 'Camera unavailable', tone: 'warn' },
  mic_started: { label: 'Microphone turned on', tone: 'ok' },
  mic_disabled: { label: 'Microphone unavailable', tone: 'warn' },
  mic_muted: { label: 'Microphone muted', tone: 'warn' },
  mic_unmuted: { label: 'Microphone unmuted', tone: 'ok' },
  audio_silence: { label: 'No speech detected', tone: 'warn' },
  audio_resumed: { label: 'Speech detected again', tone: 'ok' },
  identity_verified: { label: 'Identity verified', tone: 'ok' },
  identity_mismatch: { label: 'Identity mismatch - review', tone: 'warn' },
  // External resource / AI assistant monitoring (FR-BROW-06/07, FR-RES-01..03)
  question_copied: { label: 'Question copied to clipboard', tone: 'warn' },
  pasted_text: { label: 'Text pasted into the interview', tone: 'warn' },
  page_printed: { label: 'Interview page printed', tone: 'warn' },
  page_left: { label: 'Left the interview page', tone: 'warn' },
  focus_lost: { label: 'Window focus lost', tone: 'warn' },
  focus_restored: { label: 'Window focus restored', tone: 'ok' },
  tab_hidden: { label: 'Tab hidden', tone: 'warn' },
  tab_visible: { label: 'Tab visible', tone: 'ok' },
  fullscreen_entered: { label: 'Full screen entered', tone: 'ok' },
  fullscreen_exited: { label: 'Full screen exited', tone: 'warn' },
  // Network connectivity (FR-NET) - the outage duration rides on the online event
  network_offline: { label: 'Connection lost', tone: 'warn' },
  network_online: { label: 'Connection restored', tone: 'ok' },
  cursor_click: { label: 'Cursor click', tone: 'neutral' },
  cursor_context_menu: { label: 'Right-click (context menu)', tone: 'warn' },
  cursor_left: { label: 'Cursor left the window', tone: 'warn' },
  cursor_entered: { label: 'Cursor back in the window', tone: 'ok' },
  cursor_idle: { label: 'No cursor movement', tone: 'warn' },
  cursor_resumed: { label: 'Cursor movement resumed', tone: 'ok' },
  cursor_trace: { label: 'Cursor path recorded', tone: 'neutral' },
  // Keyboard tracer (FR-BROW-01, FR-SECENV-03) - counts/combos, never characters
  typing_activity: { label: 'Typing activity recorded', tone: 'neutral' },
  key_shortcut: { label: 'Window/tab switch shortcut', tone: 'warn' },
  page_search: { label: 'Find/search shortcut (Ctrl+F)', tone: 'warn' },
  devtools_shortcut: { label: 'Developer tools shortcut', tone: 'warn' },
  answer_submitted: { label: 'Answer submitted', tone: 'ok' },
};

export function eventTone(eventType: string): EventTone {
  return EVENT_LABELS[eventType]?.tone ?? 'neutral';
}
