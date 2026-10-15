'use client';

import { useEffect, useRef } from 'react';

import { countUp } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * A number people can compare, counted up once — states scale without adjectives.
 * Up to 4 in a row, hairline above each, always Western digits (lining + tabular).
 * Exact wording required; sample figures carry SAMPLE somewhere nearby.
 */
export interface StatItem {
  value: number;
  label: string;
}

export interface StatProps {
  items: StatItem[];
  className?: string;
}

function StatCell({ value, label }: StatItem) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return countUp(value, (v) => {
      el.textContent = Math.round(v).toLocaleString('en');
    });
  }, [value]);

  return (
    <div className="flex flex-col gap-1 border-t border-ink pt-3">
      <b
        ref={ref}
        className="text-end font-serif text-[clamp(2.5rem,1.5rem+4vw,4rem)] leading-[1.1] font-medium [font-variant-numeric:lining-nums_tabular-nums] [direction:ltr]"
      >
        0
      </b>
      <span className="text-[15px] leading-6">{label}</span>
    </div>
  );
}

export function Stat({ items, className }: StatProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-4 md:grid-cols-4', className)}>
      {items.map((item) => (
        <StatCell key={item.label} {...item} />
      ))}
    </div>
  );
}
