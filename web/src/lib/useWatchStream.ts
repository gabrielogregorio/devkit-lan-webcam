import { useEffect, useRef, useState } from 'react';
import type { SessionStore } from '@/lib/sessionStore';
import { framesPerSecond } from '@/lib/watchText';

const FPS_WINDOW_MS = 1000;

export interface WatchStream {
  fps: number | null;
  frameUrl: string | null;
}

// Each relayed frame becomes an object URL and the previous one is freed; the picture clears when access ends.
export function useWatchStream(store: SessionStore, approved: boolean): WatchStream {
  const [fps, setFps] = useState<number | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const frameUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!approved) {
      return undefined;
    }
    let frameCount = 0;
    let windowStart = performance.now();
    const replaceFrame = (nextUrl: string | null): void => {
      if (frameUrlRef.current) {
        URL.revokeObjectURL(frameUrlRef.current);
      }
      frameUrlRef.current = nextUrl;
      setFrameUrl(nextUrl);
    };
    const unsubscribe = store.onFrame((frame) => {
      replaceFrame(URL.createObjectURL(new Blob([frame as BlobPart], { type: 'image/jpeg' })));
      frameCount += 1;
      const now = performance.now();
      if (now - windowStart >= FPS_WINDOW_MS) {
        setFps(framesPerSecond(frameCount, now - windowStart));
        frameCount = 0;
        windowStart = now;
      }
    });

    return () => {
      unsubscribe();
      replaceFrame(null);
      setFps(null);
    };
  }, [store, approved]);

  return { fps, frameUrl };
}
