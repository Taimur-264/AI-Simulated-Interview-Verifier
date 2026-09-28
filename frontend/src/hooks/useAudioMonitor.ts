/**
 * useAudioMonitor - microphone access + audio level monitoring for proctoring.
 *
 * - requests microphone permission and keeps the stream alive during the interview
 * - measures input level with the Web Audio API (only a numeric level is used;
 *   no audio is recorded, stored or uploaded)
 * - emits review-signal events (FR-EVENT): mic_started / mic_disabled /
 *   mic_muted / mic_unmuted / audio_silence / audio_resumed
 *
 * Silence is advisory only - it is a signal for human review, never a verdict.
 */
import { useEffect, useRef, useState } from 'react';

export type MicStatus = 'idle' | 'starting' | 'live' | 'muted' | 'error';

export interface AudioMonitorOptions {
  /** start monitoring (typically once the interview session exists) */
  enabled: boolean;
  /** called for every monitoring event; keep it stable (useCallback) */
  onEvent: (eventType: string, data?: Record<string, unknown>) => void;
  /** seconds of continuous silence before an audio_silence event (default 45) */
  silenceSeconds?: number;
  /** RMS level (0..1) below which the mic counts as silent (default 0.015) */
  threshold?: number;
}

export interface AudioMonitorState {
  status: MicStatus;
  /** display level 0..1 (already scaled for a progress bar) */
  level: number;
  /** true while a prolonged-silence event is active */
  silent: boolean;
}

export function useAudioMonitor({
  enabled,
  onEvent,
  silenceSeconds = 45,
  threshold = 0.015,
}: AudioMonitorOptions): AudioMonitorState {
  const [status, setStatus] = useState<MicStatus>('idle');
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);

  // Keep the callback without restarting the stream
  const cbRef = useRef(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let timer: number | null = null;
    let silentSince: number | null = null;
    let silenceLogged = false;
    let displayLevel = 0; // smoothed meter value (fast attack, slow decay)

    const emit = (type: string, data: Record<string, unknown> = {}) => {
      if (!stopped) cbRef.current(type, data);
    };

    (async () => {
      setStatus('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (stopped) return;
        setStatus('error');
        emit('mic_disabled', {
          message: err instanceof Error ? err.message : 'Microphone access denied',
        });
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const track = stream.getAudioTracks()[0] ?? null;
      track?.addEventListener('mute', () => {
        if (stopped) return;
        setStatus('muted');
        emit('mic_muted', {});
      });
      track?.addEventListener('unmute', () => {
        if (stopped) return;
        setStatus('live');
        emit('mic_unmuted', {});
      });
      track?.addEventListener('ended', () => {
        if (stopped) return;
        setStatus('error');
        emit('mic_disabled', { message: 'Microphone device was disconnected or stopped' });
      });

      try {
        const Ctor: typeof AudioContext =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctor();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);

        setStatus('live');
        emit('mic_started', { device: track?.label || 'default microphone' });

        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const value = (buffer[i] - 128) / 128;
            sum += value * value;
          }
          const rms = Math.sqrt(sum / buffer.length);
          // Meter gain: x8 with fast attack / slow decay so normal speech reads clearly
          const target = Math.min(1, rms * 8);
          displayLevel = target > displayLevel ? target : displayLevel * 0.7 + target * 0.3;
          setLevel(displayLevel);

          const now = Date.now();
          if (rms < threshold) {
            if (silentSince === null) silentSince = now;
            if (!silenceLogged && now - silentSince >= silenceSeconds * 1000) {
              silenceLogged = true;
              setSilent(true);
              emit('audio_silence', { silent_for_seconds: silenceSeconds });
            }
          } else {
            if (silenceLogged) {
              silenceLogged = false;
              setSilent(false);
              emit('audio_resumed', {
                silent_for_seconds: silentSince ? Math.round((now - silentSince) / 1000) : null,
              });
            }
            silentSince = null;
          }
        }, 250);
      } catch (err) {
        if (stopped) return;
        setStatus('error');
        emit('mic_disabled', {
          message: err instanceof Error ? err.message : 'Audio monitoring unavailable',
        });
      }
    })();

    return () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
      setStatus('idle');
      setLevel(0);
      setSilent(false);
    };
  }, [enabled, silenceSeconds, threshold]);

  return { status, level, silent };
}
