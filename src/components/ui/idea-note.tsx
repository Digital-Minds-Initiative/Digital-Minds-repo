'use client';

import { useState } from 'react';

import { cn } from '@/client/lib/utils';
import { DoodleArrow, ScrapPaper, Tape } from '@/components/ui/scrapbook';

export interface IdeaNoteProps {
  /** `A LITTLE IDEA` */
  label: string;
  /** `NEW IDEA` */
  action: string;
  /** A small collection of creative prompts, shown one at a time. */
  prompts: readonly string[];
  className?: string;
}

/**
 * A small note with a creative prompt and a button that swaps it for another, never the same one
 * twice in a row. The new prompt flips in (it simply appears when motion is reduced). The first
 * prompt is always the same, so the page renders identically on the server and in the browser.
 */
export function IdeaNote({ label, action, prompts, className }: IdeaNoteProps) {
  const [index, setIndex] = useState(0);
  const [flips, setFlips] = useState(0);

  function next() {
    if (prompts.length < 2) return;
    let pick = index;
    while (pick === index) pick = Math.floor(Math.random() * prompts.length);
    setIndex(pick);
    setFlips((count) => count + 1);
  }

  return (
    <ScrapPaper tint="lilac" torn="bottom" className={cn('px-4 pt-7 pb-7', className)}>
      <Tape tone="teal" className="end-8 -top-2.5 rotate-[7deg]" />
      <p className="m-0 font-(family-name:--font-hand) text-[26px] leading-none font-bold text-tuwaiq-indigo">
        {label}
      </p>
      <p
        // `key` restarts the flip every time the prompt changes.
        key={flips}
        aria-live="polite"
        className="mt-2.5 mb-0 min-h-[72px] origin-top font-serif text-[19px] leading-snug font-semibold text-balance motion-safe:animate-[note-flip_0.45s_ease-out_both]"
      >
        {prompts[index]}
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={next}
          className="cursor-pointer rounded-md border border-tuwaiq-indigo bg-tuwaiq-indigo px-2.5 py-1 text-[12px] font-medium text-paper-cream transition-transform outline-none hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tuwaiq-indigo focus-visible:outline-solid active:translate-y-0"
        >
          {action}
        </button>
        <DoodleArrow className="size-6 -rotate-[20deg] text-club-orange" />
      </div>
    </ScrapPaper>
  );
}
