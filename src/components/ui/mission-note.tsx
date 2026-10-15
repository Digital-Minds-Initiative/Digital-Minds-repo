'use client';

import { useState } from 'react';

import { cn } from '@/client/lib/utils';
import { DoodleCheck, DoodleSquiggle, ScrapPaper, Tape } from '@/components/ui/scrapbook';

export interface MissionNoteProps {
  /** The heading, for example `TODAY'S MISSION`. */
  title: string;
  items: readonly string[];
  /** The stamp shown when every item is ticked, for example `DONE!`. */
  done: string;
  /** Counter pattern with `{done}` and `{total}` in it, for example `{done}/{total}`. */
  progress: string;
  /** What this is: a demonstration that is not saved anywhere. */
  footnote: string;
  className?: string;
}

/**
 * A three-item checklist to tick and untick. A row of pips and a counter follow it, and when all
 * are ticked a `DONE!` stamp lands on the page. It is a demonstration: nothing here is saved.
 */
export function MissionNote({
  title,
  items,
  done,
  progress,
  footnote,
  className,
}: MissionNoteProps) {
  const [checked, setChecked] = useState<readonly boolean[]>(() => items.map(() => false));
  const count = checked.filter(Boolean).length;
  const complete = count === items.length;

  return (
    <ScrapPaper tint="peach" className={cn('p-4 pb-3.5', className)}>
      <Tape tone="purple" className="start-9 -top-2.5 -rotate-3" />
      <p className="m-0 font-(family-name:--font-hand) text-[26px] leading-none font-bold text-tuwaiq-indigo">
        {title}
      </p>
      <DoodleSquiggle className="mt-0.5 text-club-orange" />

      <ul className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, index) => {
          const isOn = checked[index] === true;
          return (
            <li key={item}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isOn}
                onClick={() =>
                  setChecked((current) => current.map((value, i) => (i === index ? !value : value)))
                }
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-md bg-transparent p-0 text-start outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tuwaiq-indigo focus-visible:outline-solid"
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
                    isOn ? 'border-tuwaiq-indigo bg-tuwaiq-indigo/15' : 'border-on-paper/60',
                  )}
                >
                  {isOn ? <DoodleCheck className="size-4 text-tuwaiq-indigo" /> : null}
                </span>
                <span
                  className={cn(
                    'text-[14px] leading-snug transition-opacity',
                    isOn && 'line-through decoration-tuwaiq-indigo/70 decoration-2 opacity-60',
                  )}
                >
                  {item}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-2" aria-live="polite">
        <span aria-hidden className="flex gap-1">
          {items.map((item, index) => (
            <span
              key={item}
              className={cn(
                'h-1.5 w-6 rounded-full transition-colors',
                checked[index] ? 'bg-tuwaiq-indigo' : 'bg-on-paper/20',
              )}
            />
          ))}
        </span>
        <span className="font-mono text-[11px] tracking-[0.06em] text-on-paper-muted [direction:ltr]">
          {progress.replace('{done}', String(count)).replace('{total}', String(items.length))}
        </span>
      </div>
      <p className="mt-1.5 mb-0 text-[11px] text-on-paper-muted">{footnote}</p>

      {complete ? (
        <span
          aria-hidden
          className="pointer-events-none absolute end-3 bottom-8 z-20 -rotate-[14deg] rounded-md border-[3px] border-uqu-deep-teal px-2.5 py-0.5 font-(family-name:--font-hand) text-[34px] leading-none font-bold text-uqu-deep-teal motion-safe:animate-[stamp-pop_0.45s_ease-out_both]"
        >
          {done}
        </span>
      ) : null}
    </ScrapPaper>
  );
}
