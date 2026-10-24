'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useInView } from './use-in-view';

const REDUCED = '(prefers-reduced-motion: reduce)';
const CHAR_MS = 45;

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(REDUCED);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

/**
 * Text typed one character at a time when it first comes into view. The whole string sits
 * invisibly underneath, so the line never changes size while it types. Screen readers get the
 * whole string from a visually hidden copy — not from `aria-label`, which a plain span may not
 * carry (axe: aria-prohibited-attr). On the server, and under reduced motion, the text is simply
 * there.
 */
export function TypeText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref);
  const animate = useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(REDUCED).matches,
    () => false,
  );
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!animate || !seen) return;
    const timer = setInterval(() => {
      setCount((current) => {
        if (current + 1 >= text.length) clearInterval(timer);
        return Math.min(current + 1, text.length);
      });
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [animate, seen, text]);

  if (!animate) return <span ref={ref}>{text}</span>;
  return (
    <span ref={ref} className="relative inline-block">
      <span className="sr-only">{text}</span>
      <span aria-hidden className="invisible">
        {text}
      </span>
      <span aria-hidden className="absolute inset-y-0 start-0 whitespace-nowrap">
        {text.slice(0, count)}
      </span>
    </span>
  );
}
