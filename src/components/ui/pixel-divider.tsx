import type { CSSProperties } from 'react';

import { cn } from '@/client/lib/utils';
import { Reveal } from '@/components/motion/reveal';

/**
 * The pixel edge between two sections of different colour: three rows of square cells on one
 * grid — a solid row, a checkerboard row, then a cell every fourth — so the upper colour thins
 * out into the lower one.
 *
 * Every size is a multiple of one cell (`--px`), and the pattern is a repeating background rather
 * than a stretched drawing, so the cells stay the same square at every width. It is anchored to
 * the left edge in either page direction; a width that is not a whole number of cells only clips
 * the last cell. `from` and `to` are the colours of the section above and the section below (pass
 * tokens such as `var(--canvas)`).
 *
 * `position="bottom"` hangs under the upper section: the solid row meets it and the cells thin
 * out downwards in its colour. `position="top"` is the same pattern upside down, sitting on the
 * lower section: it ends in a solid row of that section's colour. Use one divider per boundary.
 */
export interface PixelDividerProps {
  from: string;
  to: string;
  /** The side of the cell, in px. */
  cell?: number;
  position?: 'top' | 'bottom';
  className?: string;
}

const ROWS = 3;

export function PixelDivider({
  from,
  to,
  cell = 8,
  position = 'bottom',
  className,
}: PixelDividerProps) {
  const bottom = position === 'bottom';
  // The cells take the colour of the section the solid row belongs to; the rest is the other one.
  const ink = bottom ? from : to;
  const ground = bottom ? to : from;
  const layer = (period: number, row: number, stop: number, shift = 0) =>
    `linear-gradient(90deg, var(--pd-ink) ${stop}%, transparent ${stop}%) calc(var(--px) * ${shift}) calc(var(--px) * ${row}) / calc(var(--px) * ${period}) var(--px) repeat-x`;
  // Rows counted from the top of the divider; the top variant lists them in the opposite order.
  const [solidRow, checkerRow, sparseRow] = bottom ? [0, 1, 2] : [2, 1, 0];

  return (
    // Uncovered from the right edge in pixel steps when it scrolls into view.
    <Reveal variant="clip" className={bottom ? '-mb-px' : '-mt-px'}>
      <div
        aria-hidden
        data-position={position}
        className={cn('block w-full', className)}
        style={
          {
            '--px': `${cell}px`,
            '--pd-ink': ink,
            height: `calc(var(--px) * ${ROWS})`,
            // The `background` shorthand, because the position and size of each layer live in it; the
            // last layer is the colour of the section the cells thin out into.
            background: [
              `linear-gradient(var(--pd-ink), var(--pd-ink)) 0 calc(var(--px) * ${solidRow}) / 100% var(--px) no-repeat`,
              layer(2, checkerRow, 50),
              // One cell in four, under a gap of the checker row so the dots stand alone.
              layer(4, sparseRow, 25, 1),
              ground,
            ].join(', '),
            imageRendering: 'pixelated',
          } as CSSProperties
        }
      />
    </Reveal>
  );
}
