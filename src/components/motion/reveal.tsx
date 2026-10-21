'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '@/client/lib/utils';

/**
 * How an element comes in once, when 20% of it first scrolls into view (see the "Motion" rules in
 * globals.css, which also turn it all off under `prefers-reduced-motion`):
 * - `up` fades and rises; `start` / `end` slide in from the reading-direction start or end edge, so
 *   they mirror in a right-to-left page; `drop` lands like a note being stuck on, with a small
 *   bounce; `clip` uncovers the element from the right edge in pixel steps.
 * Only opacity, translate, rotate, scale and clip-path move — never layout — so nothing shifts.
 */
export type RevealVariant = 'up' | 'start' | 'end' | 'drop' | 'clip';

export interface RevealProps {
  children?: ReactNode;
  variant?: RevealVariant;
  /** Milliseconds to wait after the element comes into view. */
  delay?: number;
  /** The tag to render, for lists (`li`) and the like. */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** For `drop`: the resting tilt the element lands on, in degrees (it arrives tilted three times as far). */
  tilt?: number;
}

/** The observer behind `Reveal`, for an element that has to carry the attributes itself. */
export function useRevealOnView(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      element.setAttribute('data-revealed', '');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          element.setAttribute('data-revealed', '');
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

export function Reveal({
  children,
  variant = 'up',
  delay = 0,
  as: Tag = 'div',
  className,
  style,
  tilt,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      element.setAttribute('data-revealed', '');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          element.setAttribute('data-revealed', '');
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clip = variant === 'clip';
  return (
    <Tag
      ref={ref}
      // A clipped element reports no visible area, so the observer would never see it: the clip is
      // put on an inner box and the outer one, which stays whole, is what scrolls into view.
      {...(clip ? { 'data-reveal-clip': '' } : { 'data-reveal': variant })}
      className={cn(className)}
      style={
        {
          ...style,
          '--reveal-delay': `${delay}ms`,
          ...(tilt === undefined ? {} : { '--reveal-tilt': `${tilt}deg` }),
        } as CSSProperties
      }
    >
      {clip ? <div data-clip>{children}</div> : children}
    </Tag>
  );
}
