'use client';

import { useEffect, useRef, useState } from 'react';

const COUNT_MS = 700;

/** Counts from the last shown value to `target`; jumps at once under reduced motion. */
export function useTweenedNumber(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    let t0: number | null = null;
    let frame = 0;
    const step = (now: number) => {
      t0 ??= now;
      const progress = reduced ? 1 : Math.min((now - t0) / COUNT_MS, 1);
      const eased = 1 - (1 - progress) ** 3;
      from.current = Math.round(start + (target - start) * eased);
      setShown(from.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}
