'use client';

import { useRef, type CSSProperties, type ElementType } from 'react';

import { useRevealOnView } from './reveal';

/**
 * A heading that comes in one word at a time when it first scrolls into view. The words are laid
 * out from the start, each fading in and rising a little after the one before it, so the line
 * wraps exactly as the finished heading does. Under reduced motion the heading is simply there.
 */
export function RevealWords({
  text,
  as: Tag = 'h2',
  className,
  step = 90,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  /** Milliseconds between one word and the next. */
  step?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useRevealOnView(ref);
  const words = text.split(' ');
  return (
    <Tag ref={ref} data-words className={className} aria-label={text}>
      {words.map((word, index) => (
        <span
          key={index}
          aria-hidden
          data-word
          className="inline-block"
          style={{ '--word-delay': `${index * step}ms` } as CSSProperties}
        >
          {word}
          {index < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </Tag>
  );
}
