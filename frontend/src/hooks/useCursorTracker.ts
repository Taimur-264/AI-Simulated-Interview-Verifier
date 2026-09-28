/**
 * useCursorTracker - cursor monitoring during the interview (proctoring).
 *
 * Emits review-signal events (FR-EVENT) to the timeline:
 * - cursor_click / cursor_context_menu   click activity (clicks throttled to 1/s)
 * - cursor_left / cursor_entered         pointer left / re-entered the window
 * - cursor_idle / cursor_resumed         no movement for `idleSeconds`
 * - cursor_trace                         periodic path sample (viewport coords)
 *
 * The trace samples the pointer every `sampleMs` and flushes a compact path
 * array every `flushMs`, so a reviewer can reconstruct movement without the
 * event log growing per-pixel. Everything is advisory - a signal for human
 * review, never a verdict (NFR-SAFE-01).
 */
import { useEffect, useRef } from 'react';

export interface CursorTrackerOptions {
  /** start tracking (typically once the interview session exists) */
  enabled: boolean;
  /** called for every monitoring event; keep it stable (useCallback) */
  onEvent: (eventType: string, data?: Record<string, unknown>) => void;
  /** path sampling interval in ms (default 250) */
  sampleMs?: number;
  /** how often the accumulated path is flushed (default 30s) */
  flushMs?: number;
  /** seconds without movement before a cursor_idle event (default 45) */
  idleSeconds?: number;
}

const CLICK_THROTTLE_MS = 1_000;

export function useCursorTracker({
  enabled,
  onEvent,
  sampleMs = 250,
  flushMs = 30_000,
  idleSeconds = 45,
}: CursorTrackerOptions): void {
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    const startedAt = Date.now();
    const path: Array<[number, number, number]> = []; // x, y, ms since start
    const maxPoints = (flushMs / sampleMs) * 2;
    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;
    let lastMoveAt = Date.now();
    let lastClickAt = 0;
    let idleLogged = false;
    let idleSince = 0;

    const sendTrace = (drain: boolean) => {
      if (path.length === 0) return;
      const points = drain ? path.splice(0, path.length) : path.slice();
      cbRef.current('cursor_trace', {
        points: points.length,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        path: points,
      });
    };

    const emit = (type: string, data: Record<string, unknown> = {}) => {
      if (!stopped) cbRef.current(type, data);
    };

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveAt = Date.now();
      if (idleLogged) {
        idleLogged = false;
        emit('cursor_resumed', { idle_for_seconds: Math.round((Date.now() - idleSince) / 1000) });
      }
    };

    const onSample = () => {
      if (path.length >= maxPoints) path.splice(0, path.length - maxPoints + 1);
      path.push([Math.round(lastX), Math.round(lastY), Date.now() - startedAt]);
    };

    const onClick = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastClickAt < CLICK_THROTTLE_MS) return;
      lastClickAt = now;
      emit('cursor_click', { x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button });
    };

    const onContextMenu = (e: MouseEvent) => {
      emit('cursor_context_menu', { x: Math.round(e.clientX), y: Math.round(e.clientY) });
    };

    const onLeave = () => emit('cursor_left', {});
    const onEnter = () => emit('cursor_entered', {});

    const checkIdle = () => {
      const idleFor = Date.now() - lastMoveAt;
      if (!idleLogged && idleFor >= idleSeconds * 1000) {
        idleLogged = true;
        idleSince = lastMoveAt;
        emit('cursor_idle', { idle_seconds: Math.round(idleFor / 1000) });
      }
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('click', onClick);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseenter', onEnter);

    const sampleTimer = window.setInterval(onSample, sampleMs);
    const flushTimer = window.setInterval(() => sendTrace(true), flushMs);
    const idleTimer = window.setInterval(checkIdle, 1_000);

    return () => {
      stopped = true;
      clearInterval(sampleTimer);
      clearInterval(flushTimer);
      clearInterval(idleTimer);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('click', onClick);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseenter', onEnter);
      // unmount: send the remaining buffer straight through (emit() is off)
      if (path.length > 0) {
        cbRef.current('cursor_trace', {
          points: path.length,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          path: path.slice(),
        });
        path.length = 0;
      }
    };
  }, [enabled, sampleMs, flushMs, idleSeconds]);
}
