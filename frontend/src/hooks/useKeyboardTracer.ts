/**
 * useKeyboardTracer - keyboard monitoring during the interview (proctoring).
 *
 * Emits review-signal events (FR-BROW-01, FR-SECENV-03) to the timeline:
 * - typing_activity        keystroke counts per interval PLUS the characters
 *                          typed inside the interview page (answer drafts -
 *                          flushed every `flushMs`, capped per interval)
 * - key_shortcut           monitored shortcut that switches or tries to leave
 *                          the controlled window (Ctrl+T/N/W/L/R, Alt+Tab,
 *                          Win key, PrintScreen, task manager ...) - Review
 * - page_search            find/search shortcut (Ctrl+F) pressed in the
 *                          interview - Review
 * - devtools_shortcut      developer-tools combinations (F12, Ctrl+Shift+I/
 *                          J/C, Cmd+Opt+I ...) - High Review (inspect sources
 *                          or network to read answers/identity payloads)
 *
 * What this CAN see: every key delivered to the interview page - exact
 * characters typed into answer fields, and shortcut combos the browser lets
 * through. What it CANNOT see (no web page can): keys typed in another tab,
 * in the address bar, or in any other application - that is browser security,
 * not a setting. Those actions surface indirectly as focus/tab/page-exit
 * events instead. Combinations are debounced so auto-repeat doesn't flood the
 * timeline. Everything is advisory - a signal for human review, never a
 * verdict (NFR-SAFE-01).
 */
import { useEffect, useRef } from 'react';

export interface KeyboardTracerOptions {
  /** start tracking (typically once the interview session exists) */
  enabled: boolean;
  /** called for every monitoring event; keep it stable (useCallback) */
  onEvent: (eventType: string, data?: Record<string, unknown>) => void;
  /** how often keystroke counts are flushed (default 10s) */
  flushMs?: number;
  /** same combination ignored within this window (default 1.2s) */
  debounceMs?: number;
  /**
   * live totals on every keystroke - lets the interview page show a running
   * "keys typed" counter so monitoring is visibly active while typing.
   */
  onKeys?: (totalKeys: number, inPageKeys: number) => void;
}

/** Devtools / inspector combinations (FR-SECENV-03). */
const DEVTOOLS_COMBOS = new Set([
  'F12',
  'CTRL+SHIFT+I',
  'CTRL+SHIFT+J',
  'CTRL+SHIFT+C',
  'CTRL+SHIFT+E',
  'CTRL+SHIFT+K',
  'META+ALT+I',
  'META+ALT+J',
  'META+ALT+C',
]);

/** Find/search shortcuts delivered to the page (search inside the interview). */
const SEARCH_COMBOS = new Set(['CTRL+F']);

/**
 * Window / tab / application switching and environment-escape combinations.
 * (Copy/paste/print are deliberately absent - they have dedicated events.)
 */
const SWITCH_COMBOS = new Set([
  'CTRL+T', // new tab
  'CTRL+N', // new window
  'CTRL+W', // close tab
  'CTRL+L', // focus address bar
  'CTRL+R', // reload (re-enters with a fresh page)
  'CTRL+F5',
  'CTRL+K', // browser search shortcut (usually consumed; delivered sometimes)
  'CTRL+E', // address-bar search (usually consumed; delivered sometimes)
  'CTRL+SHIFT+ESC', // task manager
  'CTRL+ESC', // start menu
  'ALT+TAB', // switch window
  'ALT+F4', // close window
  'META', // Windows/Start key alone
  'META+TAB', // task view
  'META+D', // show desktop
  'META+E', // file explorer
  'META+L', // lock screen
  'META+M', // minimize all
  'PRINTSCREEN', // capture the screen (question extraction)
]);

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** keys worth showing as content in the typed stream */
const TYPED_NAMED_KEYS = new Set(['Backspace', 'Enter', 'Delete', 'Tab']);

/** max characters kept per flush interval */
const TYPED_MAX = 600;

/** 't' -> 'T', 'Tab' -> 'TAB', ' ' -> 'SPACE' */
function keyName(key: string): string {
  if (key === ' ') return 'SPACE';
  return key.toUpperCase();
}

export function useKeyboardTracer({
  enabled,
  onEvent,
  flushMs = 10_000,
  debounceMs = 1_200,
  onKeys,
}: KeyboardTracerOptions): void {
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  });
  const onKeysRef = useRef(onKeys);
  useEffect(() => {
    onKeysRef.current = onKeys;
  });

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let keys = 0; // keystrokes since last flush
    let inputKeys = 0; // ... typed into an input/textarea/contenteditable
    const typed: string[] = []; // characters typed in-page since last flush
    let typedLen = 0;
    let totalKeys = 0; // cumulative - drives the on-screen counter
    let totalInputKeys = 0;
    let firstKeyTimer: number | null = null; // quick flush after typing starts
    const lastSent = new Map<string, number>(); // shortcut debounce

    const emit = (type: string, data: Record<string, unknown> = {}) => {
      if (!stopped) cbRef.current(type, data);
    };

    const flush = (force: boolean) => {
      if (firstKeyTimer !== null) {
        clearTimeout(firstKeyTimer);
        firstKeyTimer = null;
      }
      if (keys === 0) return;
      const typedText = typed.join('');
      const payload: Record<string, unknown> = {
        keys,
        input_keys: inputKeys,
        other_keys: keys - inputKeys,
      };
      if (typedText) payload.typed = typedText; // what was typed in-page
      if (force) cbRef.current('typing_activity', payload); // unmount: emit() is off
      else emit('typing_activity', payload);
      keys = 0;
      inputKeys = 0;
      typed.length = 0;
      typedLen = 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const combo = [
        e.ctrlKey ? 'CTRL' : '',
        e.altKey ? 'ALT' : '',
        e.shiftKey ? 'SHIFT' : '',
        e.metaKey ? 'META' : '',
        keyName(e.key),
      ]
        .filter(Boolean)
        .join('+');

      // 1. monitored combinations -> review events (not counted as typing)
      const isDevtools = DEVTOOLS_COMBOS.has(combo);
      const isSearch = !isDevtools && SEARCH_COMBOS.has(combo);
      const isSwitch = !isDevtools && !isSearch && SWITCH_COMBOS.has(combo);
      if (isDevtools || isSearch || isSwitch) {
        const now = Date.now();
        const last = lastSent.get(combo) ?? 0;
        if (now - last >= debounceMs) {
          lastSent.set(combo, now);
          emit(isDevtools ? 'devtools_shortcut' : isSearch ? 'page_search' : 'key_shortcut', {
            combo,
            key: keyName(e.key),
            ctrl: e.ctrlKey,
            alt: e.altKey,
            shift: e.shiftKey,
            meta: e.metaKey,
          });
        }
        return;
      }

      // 2. bare modifier presses are not keystrokes
      if (MODIFIER_KEYS.has(e.key)) return;

      // 3. count the keystroke, where it landed, and what it was
      if (e.repeat) return;
      keys += 1;
      totalKeys += 1;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        inputKeys += 1;
        totalInputKeys += 1;
      }
      onKeysRef.current?.(totalKeys, totalInputKeys);
      // First keystroke of an interval: report soon (4s) so typing shows up
      // in the timeline almost immediately instead of at the next interval.
      if (keys === 1 && firstKeyTimer === null) {
        firstKeyTimer = window.setTimeout(() => {
          firstKeyTimer = null;
          flush(false);
        }, 4_000);
      }
      // record the characters/named keys - in-page only, capped per interval
      if (typedLen < TYPED_MAX && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key.length === 1) {
          typed.push(e.key);
          typedLen += 1;
        } else if (TYPED_NAMED_KEYS.has(e.key)) {
          typed.push(`{${e.key}}`);
          typedLen += e.key.length + 2;
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const flushTimer = window.setInterval(() => flush(false), flushMs);
    // Switching away is exactly when partial counts matter most: flush what
    // was typed so it is not lost from the timeline while the tab is hidden.
    const onVisibilityChange = () => {
      if (document.hidden) flush(false);
    };
    const onPageHide = () => flush(false);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearInterval(flushTimer);
      if (firstKeyTimer !== null) {
        clearTimeout(firstKeyTimer);
        firstKeyTimer = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('keydown', onKeyDown, true);
      // unmount: report the partial interval straight through
      flush(true);
      stopped = true;
    };
  }, [enabled, flushMs, debounceMs]);
}
