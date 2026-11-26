'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/client/lib/utils';
import { withKashida } from '@/shared/lib/member-card';

interface Fit {
  text: string;
  size: number;
  wrap: boolean;
}

/** The face names are set in: Thmanyah Serif Display, whose own kashida glyphs draw the stretch. */
const NAME_FONT =
  "'Thmanyah Serif Display', 'Thmanyah Sans', var(--font-amiri), var(--font-ibm-plex-sans-arabic), serif";

let canvas: HTMLCanvasElement | null = null;

/**
 * How wide `text` is at `size` pixels in the name font, shaped by the browser exactly as it will be
 * drawn (the font's own kashida glyphs included). Zero where there is no canvas (a test), which
 * means "unknown".
 */
function textWidth(text: string, size: number, weight: number): number {
  try {
    canvas ??= document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.font = `${weight} ${size}px ${NAME_FONT}`;
    context.direction = 'rtl';
    return context.measureText(text).width;
  } catch {
    return 0;
  }
}

/**
 * A person's name, set so that none of it is ever cut off. It tries the name with its kashida (the
 * stretch Arabic lettering puts after a joining letter) at the full size first; if that is wider
 * than the room it falls back to the plain name, then to a smaller size, and only at the smallest
 * size does it go onto a second line. It measures the real text in the real font, so it is right
 * whether Thmanyah is installed on the device or the fallback is drawn.
 */
export function FitName({
  name,
  size,
  min = 20,
  weight = 500,
  className,
  stretch = true,
  labelled = true,
}: {
  name: string;
  /** The size it is drawn at when it fits, in pixels. */
  size: number;
  /** The smallest it shrinks to before wrapping. */
  min?: number;
  weight?: number;
  className?: string;
  /** Draw the kashida at all (the back of the card sets the name plain). */
  stretch?: boolean;
  /** Name the box for a screen reader (the plain name); off where the same name is read elsewhere. */
  labelled?: boolean;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const kashida = stretch ? withKashida(name) : name;
  const [fit, setFit] = useState<Fit>({ text: kashida, size, wrap: false });

  const measure = useCallback(() => {
    const room = box.current?.clientWidth ?? 0;
    const a = textWidth(kashida, size, weight);
    const b = textWidth(name, size, weight);
    // Not laid out or no canvas (a test, a hidden panel): keep the stretched name at its own size.
    if (room <= 0 || b <= 0) return setFit({ text: kashida, size, wrap: false });
    if (a > 0 && a <= room) return setFit({ text: kashida, size, wrap: false });
    if (b <= room) return setFit({ text: name, size, wrap: false });
    const shrunk = Math.floor((size * room) / b);
    if (shrunk >= min) return setFit({ text: name, size: shrunk, wrap: false });
    setFit({ text: name, size: min, wrap: true });
  }, [kashida, min, name, size, weight]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const node = box.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (node && observer) observer.observe(node);
    // The installed font arrives after the first paint: measure again once it is in.
    void document.fonts?.ready.then(measure);
    return () => observer?.disconnect();
  }, [measure]);

  return (
    <div
      ref={box}
      aria-label={labelled ? name : undefined}
      className={cn('relative w-full', className)}
    >
      <span
        aria-hidden
        className={
          fit.wrap ? 'block text-balance [overflow-wrap:anywhere]' : 'block whitespace-nowrap'
        }
        style={{
          fontFamily: NAME_FONT,
          fontSize: fit.size,
          lineHeight: 1.35,
          fontWeight: weight,
        }}
      >
        {fit.text}
      </span>
    </div>
  );
}
