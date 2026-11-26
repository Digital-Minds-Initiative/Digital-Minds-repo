'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/client/lib/utils';

import { fitFontSize } from '../lib/number-fit';

/**
 * A big figure that always fits its box on one line, aligned to the end of it: 107 and 1,250,000
 * both sit square, the second just smaller. It measures the room it is given (and again when that
 * changes), so the same figure fits a narrow card and a wide page. It is sized for the value it is
 * heading to (`final`), so it never changes size while `shown` counts up to it.
 */
export function FitFigure({
  shown,
  final,
  base,
  className,
}: {
  /** What is drawn now: the figure part-way through counting, or the figure itself. */
  shown: string;
  /** The figure it ends on: what the size is worked out from, and what a screen reader says. */
  final: string;
  /** The size it takes while it fits, in pixels. */
  base: number;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement | null>(null);
  const [room, setRoom] = useState<number | null>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setRoom(node.clientWidth);
    measure();
    // No ResizeObserver (an old browser, a test): it keeps the room it measured once.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Until it is measured, a size that fits the narrowest place it is used.
  const size = fitFontSize(final, base, room && room > 0 ? room : 120);

  return (
    <span ref={box} dir="ltr" aria-label={final} className="block w-full min-w-0 text-end">
      <span
        aria-hidden
        className={cn(
          'inline-block max-w-full font-mono leading-none font-medium whitespace-nowrap [font-variant-numeric:lining-nums_tabular-nums] motion-safe:transition-[font-size] motion-safe:duration-300',
          className,
        )}
        style={{ fontSize: size }}
      >
        {shown}
      </span>
    </span>
  );
}
