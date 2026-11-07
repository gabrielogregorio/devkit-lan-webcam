import { useEffect, useState } from 'react';

const TICK_MS = 1000;
const MILLISECONDS_PER_SECOND = 1000;

export const secondsRemaining = (secondsLeft: number, receivedAt: number, now: number): number =>
  Math.max(0, secondsLeft - Math.floor((now - receivedAt) / MILLISECONDS_PER_SECOND));

export const clockLabel = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Counts down from what the server said, without asking it every second.
export function useCountdown(secondsLeft: number, receivedAt: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(timer);
  }, []);

  return secondsRemaining(secondsLeft, receivedAt, now);
}
