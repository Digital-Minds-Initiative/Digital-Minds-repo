'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** True when the person asked for less motion. Read at the moment of use, never cached. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Fires once, the first time the element is at least a little in view. */
export function useSeenOnce<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    // No IntersectionObserver (an old browser, a test): the badge stays as it was drawn.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

/**
 * The scale that fits a badge drawn at `width` px into the room its container has, never above 1.
 * Measured, so the badge draws at its real size on a desktop and shrinks as a whole on a phone.
 */
export function useFitScale(width: number): [RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setScale(Math.min(1, node.clientWidth / width));
    measure();
    // No ResizeObserver (an old browser, a test): the badge keeps the size it was measured at.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return [ref, scale];
}

/** A number that counts up once to its value (the system's «count up once, about 900 ms»). */
export function useCountUp(value: number, active: boolean, duration = 900): number {
  const [shown, setShown] = useState(0);
  const instant = active && (value === 0 || prefersReducedMotion());
  useEffect(() => {
    if (!active || instant) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, active, instant, duration]);
  return instant ? value : shown;
}

/**
 * The badge leans toward the pointer and its layers move at different depths, as ReactBits'
 * Credit Card and Depth Card do. It writes CSS variables on the element instead of state, so
 * moving the mouse never re-renders React: `--rx`/`--ry` are degrees, `--px`/`--py` run from -1
 * to 1 for the parallax layers, `--mx`/`--my` are the pointer in percent for the light sweep.
 * Touch and keyboard get the flat badge, and so does anyone who asked for less motion.
 */
export function usePointerDepth<T extends HTMLElement>(maxTilt = 6) {
  const ref = useRef<T | null>(null);
  const frame = useRef<number | null>(null);

  const apply = useCallback((values: Record<string, string>) => {
    const node = ref.current;
    if (!node) return;
    for (const [key, value] of Object.entries(values)) node.style.setProperty(key, value);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse' || prefersReducedMotion()) return;
      const box = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() =>
        apply({
          '--rx': `${((0.5 - y) * maxTilt * 2).toFixed(2)}deg`,
          '--ry': `${((x - 0.5) * maxTilt * 2).toFixed(2)}deg`,
          '--px': ((x - 0.5) * 2).toFixed(3),
          '--py': ((y - 0.5) * 2).toFixed(3),
          '--mx': `${(x * 100).toFixed(1)}%`,
          '--my': `${(y * 100).toFixed(1)}%`,
          '--lit': '1',
        }),
      );
    },
    [apply, maxTilt],
  );

  const onPointerLeave = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    apply({ '--rx': '0deg', '--ry': '0deg', '--px': '0', '--py': '0', '--lit': '0' });
  }, [apply]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { ref, onPointerMove, onPointerLeave };
}
