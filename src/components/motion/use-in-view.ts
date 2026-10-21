'use client';

import { useEffect, useState, type RefObject } from 'react';

/** Where the observer is made: wherever `IntersectionObserver` is missing the element counts as seen. */
const THRESHOLD = 0.2;

/**
 * True once, the first time 20% of the element is on screen, and it stays true. Without an
 * `IntersectionObserver` (old browsers, jsdom) it is true on the next tick, so nothing waits for
 * a signal that never comes.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setSeen(true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: THRESHOLD },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return seen;
}
