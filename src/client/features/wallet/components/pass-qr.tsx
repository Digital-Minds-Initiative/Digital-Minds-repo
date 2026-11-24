'use client';

import { encode } from 'uqr';

import { cn } from '@/client/lib/utils';

/**
 * A QR code drawn the way the system draws everything: square cells, no smoothing. Dark cells use
 * the current text colour, so the code is always ink on paper.
 */
export function PassQr({
  value,
  label,
  className,
  color,
}: {
  value: string;
  label: string;
  className?: string;
  /** Ink for the dark cells; the ground is whatever is behind. */
  color?: string;
}) {
  const { data } = encode(value, { ecc: 'M', border: 0 });
  const size = data.length;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('block size-full text-on-paper', className)}
      style={color ? { color } : undefined}
    >
      {data.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
          ) : null,
        ),
      )}
    </svg>
  );
}
