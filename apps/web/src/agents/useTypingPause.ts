/**
 * Detects when the user pauses writing. Returns [paused, reset] — `paused`
 * goes true after `delay` ms of no change to `value`; `reset` dismisses it
 * immediately (call on Tab so the nudge disappears the instant autopilot fires).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useTypingPause(value: string, delay = 1800): [boolean, () => void] {
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setPaused(false);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    reset();
    timer.current = setTimeout(() => setPaused(true), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay]); // eslint-disable-line react-hooks/exhaustive-deps

  return [paused, reset];
}
