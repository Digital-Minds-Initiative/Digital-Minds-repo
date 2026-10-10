'use client';

import { useEffect, useRef } from 'react';

import { countUp } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';
import { Button } from '@/components/ui/button';
import { SpecLabel } from '@/components/ui/spec-label';

/**
 * A commitment meter — weeks done, members in, one action to join. Dark `slab`
 * card; the figure counts up once; week cells: done = filled, remaining = outline
 * (the fill is the signal, backed by the number — never a progress bar or percent).
 */
export interface SprintProps {
  sprintIndex: string;
  dateRange: string;
  weeksDone: number;
  weeksTotal?: number;
  sentence: string;
  actionLabel: string;
  onAction?: () => void;
  className?: string;
}

export function Sprint({
  sprintIndex,
  dateRange,
  weeksDone,
  weeksTotal = 8,
  sentence,
  actionLabel,
  onAction,
  className,
}: SprintProps) {
  const figureRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    return countUp(
      weeksDone,
      (v) => {
        el.textContent = Math.round(v).toLocaleString('en');
      },
      700,
    );
  }, [weeksDone]);

  return (
    <div
      className={cn(
        'mx-auto flex w-[380px] flex-col gap-3 rounded-card bg-slab p-6 text-on-slab',
        className,
      )}
    >
      <SpecLabel tone="on-deep">
        SPRINT {sprintIndex} · {dateRange}
      </SpecLabel>
      <div className="flex items-baseline justify-end gap-3 [direction:ltr]">
        <b
          ref={figureRef}
          className="font-serif text-[88px] leading-[92px] font-medium [font-variant-numeric:lining-nums_tabular-nums]"
        >
          0
        </b>
        <span className="font-serif text-[32px] text-on-slab-muted">/ {weeksTotal}</span>
      </div>
      <div className="flex gap-1.5 [direction:ltr]">
        {Array.from({ length: weeksTotal }, (_, i) => (
          <span
            key={i}
            className={cn(
              'block size-4 rounded-cell',
              i < weeksDone ? 'bg-tuwaiq-lilac' : 'border-[1.5px] border-on-slab-muted',
            )}
          />
        ))}
      </div>
      <p className="text-on-slab-muted">{sentence}</p>
      <Button onClick={onAction} className="self-start">
        {actionLabel}
      </Button>
    </div>
  );
}
