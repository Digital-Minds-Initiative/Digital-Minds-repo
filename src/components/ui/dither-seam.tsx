import { seamCells } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * Where two colours meet, they trade cells through a 4x4 ordered (Bayer) dither — the
 * system's replacement for every gradient. `from`/`to` are CSS colour values (pass a
 * token: `"var(--brand)"`, `"var(--deep)"`…); cell size is `cell-s` in UI, `cell-m` in
 * dividers, `cell-l` on posters. Never more than two colours in one seam.
 */
export interface DitherSeamProps {
  from: string;
  to: string;
  cell?: number;
  cols?: number;
  rows?: number;
  direction?: 'h' | 'v';
  className?: string;
}

export function DitherSeam({
  from,
  to,
  cell = 8,
  cols = 80,
  rows = 4,
  direction = 'h',
  className,
}: DitherSeamProps) {
  const cells = seamCells(cols, rows, cell, direction);
  return (
    <svg
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      className={cn('block h-auto w-full', className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect
        x={0}
        y={0}
        width={cols * cell}
        height={rows * cell}
        fill={from}
        shapeRendering="crispEdges"
      />
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.s}
          height={c.s}
          fill={to}
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  );
}
