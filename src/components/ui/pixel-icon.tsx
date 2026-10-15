import { iconCells, type IconName } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * The platform's icon: an 8×8 pixel drawing in the same cell grid as the logo mark. Drawn in
 * `currentColor`, so it takes the colour of the text it sits in. Decorative — the label beside it
 * (or on its button) carries the meaning.
 */
export type PixelIconName = IconName;

export function PixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
  const cells = iconCells(name, 6);
  return (
    <svg viewBox="0 0 48 48" className={cn('size-5 shrink-0', className)} aria-hidden>
      {cells.map((cell, index) => (
        <rect
          key={index}
          x={cell.x}
          y={cell.y}
          width={cell.s}
          height={cell.s}
          rx={cell.rx}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
