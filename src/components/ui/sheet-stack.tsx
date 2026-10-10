'use client';

import { useEffect, useRef } from 'react';

import { attachStack } from '@/lib/dm-engine';
import { cn } from '@/lib/utils';

/**
 * Cards that stick and stack as you scroll — each new card lands on the last, the
 * ones underneath step back, scaling down and dimming by `--depth` (scroll-driven).
 * Dark `slab` cards, grounds step lighter (`slab` → `slab-2` → `slab-3`); 2-3 cards
 * per stack. Reduced motion: cards still stick, no scale/dim.
 */
export interface SheetStackCard {
  index: string;
  headline: string;
  headlineMuted: string;
  tags: string[];
  body: string;
}

const GROUND = ['bg-slab', 'bg-slab-2', 'bg-slab-3'] as const;

export interface SheetStackProps {
  cards: SheetStackCard[];
  className?: string;
}

export function SheetStack({ cards, className }: SheetStackProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachStack(el);
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={0}
      aria-label="شغل المنصة"
      className={cn('h-[440px] scrollbar-none overflow-y-auto bg-canvas', className)}
    >
      {cards.map((card, i) => (
        <section
          key={card.index}
          data-stack-card
          className={cn(
            'sticky mb-6 flex origin-top flex-col gap-4 rounded-card p-8 pb-6 text-on-slab',
            'scale-[calc(1-var(--depth,0)*var(--stack-scale))] brightness-[calc(1-var(--depth,0)*0.25)] filter',
            GROUND[Math.min(i, GROUND.length - 1)],
          )}
          style={{ top: `calc(${i} * var(--stack-step))`, minHeight: 352 }}
        >
          <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-on-slab-muted uppercase [unicode-bidi:isolate]">
            {card.index}
          </span>
          <h3 className="m-0 font-serif text-[56px] leading-[68px] font-medium">
            {card.headline}{' '}
            <em className="font-normal text-on-slab-muted not-italic">{card.headlineMuted}</em>
          </h3>
          <div className="flex flex-wrap gap-2">
            {card.tags.map((tag) => (
              <i
                key={tag}
                className="rounded-cell border border-on-slab-muted px-2.5 py-0.5 text-[12px] leading-[18px] font-semibold text-on-slab-muted not-italic"
              >
                {tag}
              </i>
            ))}
          </div>
          <p className="text-on-slab-muted">{card.body}</p>
        </section>
      ))}
    </div>
  );
}
