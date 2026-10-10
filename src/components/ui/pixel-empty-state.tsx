import type * as React from 'react';

import { glyphCells } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * An inviting first step for a screen's primary empty state: a faint cell grid
 * with one glyph half-drawn, a short line and the one action. The first 9 cells
 * of the glyph draw solid in `brand`; the rest of the grid is outline-only.
 */
export interface PixelEmptyStateProps {
  title: string;
  description: string;
  action: React.ReactNode;
  className?: string;
}

function GridArt() {
  const step = 14;
  const cells = glyphCells('plus', step, 'solid');
  const glyphKeys = new Set(cells.map((c) => `${c.x}-${c.y}`));
  const nodes: React.ReactNode[] = [];
  let drawn = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const key = `${x * step}-${y * step}`;
      const inGlyph = glyphKeys.has(key);
      if (inGlyph && drawn < 9) {
        nodes.push(
          <rect
            key={key}
            x={x * step}
            y={y * step}
            width={step}
            height={step}
            rx={Math.max(1, step * 0.18)}
            className="fill-brand"
          />,
        );
        drawn += 1;
      } else {
        nodes.push(
          <rect
            key={key}
            x={x * step + 1}
            y={y * step + 1}
            width={step - 2}
            height={step - 2}
            rx={Math.max(1, step * 0.18)}
            fill="none"
            strokeWidth={1.5}
            className={inGlyph ? 'stroke-control-border' : 'stroke-line'}
          />,
        );
      }
    }
  }
  return (
    <svg viewBox={`0 0 ${8 * step} ${8 * step}`} width={8 * step} height={8 * step} aria-hidden>
      {nodes}
    </svg>
  );
}

export function PixelEmptyState({ title, description, action, className }: PixelEmptyStateProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-8 bg-surface-sunken p-8', className)}>
      <GridArt />
      <div>
        <h3 className="font-serif text-[30px] leading-[44px] font-semibold">{title}</h3>
        <p className="mt-1 mb-5 max-w-80 text-[16px] leading-7 text-muted">{description}</p>
        {action}
      </div>
    </div>
  );
}
