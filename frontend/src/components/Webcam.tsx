/**
 * Webcam Component - Handles camera access, preview, and frame capture.
 * Uses MediaDevices API for webcam access.
 *
 * Extras:
 * - `guide="oval"` draws a "stay in the frame" face guide (dashed oval + vignette)
 * - `onReady` hands the parent a `capture()` function once the stream is live
 * - `showControls={false}` hides the built-in start/stop/capture buttons
 * - `children` renders arbitrary overlays (badges, hints) above the video
 *
 * All callbacks are read through a ref so passing inline arrows never
 * restarts the camera stream.
 */
import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

interface WebcamProps {
  onFrame?: (frame: string) => void; // base64 JPEG (auto-capture, ~10 FPS)
  onCapture?: (frame: string) => void; // manual capture callback
  onError?: (error: string) => void;
  onReady?: (capture: () => string | null) => void;
  width?: number;
  height?: number;
  facingMode?: 'user' | 'environment';
  autoStart?: boolean;
  className?: string;
  guide?: 'oval' | 'none';
  showControls?: boolean;
  children?: ReactNode;
}

export function Webcam({
  onFrame,
  onCapture,
  onError,
  onReady,
  width = 640,
  height = 480,
  facingMode = 'user',
  autoStart = true,
  className = 'max-w-md mx-auto',
  guide = 'none',
  showControls = true,
  children,
}: WebcamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const trackEndedHandlersRef = useRef<Array<() => void>>([]);
  const [isActive, setIsActive] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest callbacks without changing start/stop identity
  const cbRef = useRef({ onFrame, onCapture, onError, onReady });
  useEffect(() => {
    cbRef.current = { onFrame, onCapture, onError, onReady };
  });

  // Capture frame as base64 JPEG
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Mirror for user-facing camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Return base64 JPEG
    return canvas.toDataURL('image/jpeg', 0.8);
  }, [facingMode]);

  // Stop camera (defined before start - start's "stream ended" handler calls it)
  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        trackEndedHandlersRef.current.forEach((handler) => track.removeEventListener('ended', handler));
        track.stop();
      });
      streamRef.current = null;
    }
    trackEndedHandlersRef.current = [];
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsActive(false);
  }, []);

  // Start camera
  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode,
        },
        audio: false,
      });

      streamRef.current = stream;
      // If the operating system or another app takes the camera away, the
      // video silently freezes on its last frame - report it instead of
      // letting verification keep accepting a stale picture.
      const onTrackEnded = () => {
        cbRef.current.onError?.('Camera stream stopped');
        stop();
      };
      trackEndedHandlersRef.current = stream.getTracks().map((track) => {
        track.addEventListener('ended', onTrackEnded);
        return onTrackEnded;
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Handle play promise to avoid interruption errors
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          try {
            await playPromise;
          } catch (playErr: unknown) {
            // Ignore AbortError (interrupted by navigation)
            if (playErr instanceof Error && playErr.name !== 'AbortError') {
              throw playErr;
            }
          }
        }
      }
      setIsActive(true);
      setHasPermission(true);
      cbRef.current.onReady?.(captureFrame);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Camera access denied';
      setError(message);
      setHasPermission(false);
      cbRef.current.onError?.(message);
    }
  }, [width, height, facingMode, captureFrame, stop]);

  // Auto-capture frames for real-time processing
  useEffect(() => {
    if (isActive && cbRef.current.onFrame) {
      intervalRef.current = window.setInterval(() => {
        const video = videoRef.current;
        // Never emit a frozen frame: when the tab is hidden or the video is
        // paused, the canvas would just re-draw the last picture - identity
        // verification would keep accepting it as proof of presence.
        if (!video || video.paused || video.ended || document.hidden) return;
        const frame = captureFrame();
        if (frame) {
          cbRef.current.onFrame?.(frame);
        }
      }, 100); // ~10 FPS
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, captureFrame]);

  // Handle page visibility change - pause video when tab hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (videoRef.current && document.hidden) {
        videoRef.current.pause();
      } else if (videoRef.current && !document.hidden && isActive) {
        videoRef.current.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  // Auto-start / cleanup on unmount
  useEffect(() => {
    if (autoStart) {
      start();
    }
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div className={`relative w-full ${className}`}>
      {/* Video Preview */}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-gray-900">
        <video
          ref={videoRef}
          className={`h-full w-full object-cover ${facingMode === 'user' ? 'mirror' : ''}`}
          autoPlay
          muted
          playsInline
          aria-label="Webcam preview"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Stay-in-frame face guide */}
        {guide === 'oval' && isActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[78%] w-[58%] rounded-[50%] border-2 border-dashed border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
          </div>
        )}

        {/* Caller-provided overlays */}
        {children}

        {/* Overlay when inactive */}
        {!isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 text-white">
            <div className="p-4 text-center">
              <svg className="mx-auto mb-3 h-16 w-16 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <p className="text-lg font-medium">Camera Off</p>
              <p className="mt-1 text-sm opacity-70">Enable camera access to continue</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute left-0 right-0 top-0 bg-red-600/90 p-3 text-center text-sm text-white">{error}</div>
        )}

        {/* Recording indicator */}
        {isActive && cbRef.current.onFrame && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-1 text-xs font-medium text-white animate-pulse">
            <span className="h-2 w-2 rounded-full bg-white" />
            LIVE
          </div>
        )}
      </div>

      {showControls && (
        <>
          {/* Controls */}
          <div className="mt-4 flex items-center justify-center gap-3">
            {!isActive ? (
              <button
                onClick={start}
                className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {hasPermission === false ? 'Retry camera' : 'Start Camera'}
              </button>
            ) : (
              <button
                onClick={stop}
                className="rounded-lg bg-red-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-red-700"
              >
                Stop Camera
              </button>
            )}

            {isActive && (
              <button
                onClick={() => {
                  const frame = captureFrame();
                  if (frame) {
                    cbRef.current.onCapture?.(frame);
                  }
                }}
                className="rounded-lg bg-gray-100 px-6 py-2.5 font-medium text-gray-900 transition-colors hover:bg-gray-200"
              >
                Capture Frame
              </button>
            )}
          </div>

          {/* Status */}
          <div className="mt-2 text-center text-sm text-gray-500">
            {isActive ? 'Camera active' : hasPermission === false ? 'Camera permission denied' : 'Camera ready'}
          </div>
        </>
      )}
    </div>
  );
}
