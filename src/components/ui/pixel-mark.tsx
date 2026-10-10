import { cva, type VariantProps } from 'class-variance-authority';

import { glyphCells, type CellFinish, type GlyphName } from '@/client/lib/dm-engine';
import { cn } from '@/client/lib/utils';

/**
 * One glyph on an 8x8 cell grid — the system's only motif. `plus` (Tech, default),
 * `diamond`/`spark` (Gem, UQU Computing), `khatam` (ceremonies). Used only in membership
 * cards, section dividers, empty states, posters and a sparse scatter on `deep` — never
 * tiled as wallpaper or as an action icon.
 */

const pixelMarkVariants = cva('inline-block', {
  variants: {
    tone: {
      brand: 'text-brand',
      deep: 'text-on-deep',
      muted: 'text-on-paper-muted',
      current: 'text-current',
    },
  },
  defaultVariants: { tone: 'brand' },
});

export interface PixelMarkProps extends VariantProps<typeof pixelMarkVariants> {
  glyph: GlyphName;
  size?: number;
  finish?: CellFinish;
  gap?: number;
  className?: string;
}

export function PixelMark({
  glyph,
  size = 10,
  finish = 'solid',
  gap = 0,
  tone,
  className,
}: PixelMarkProps) {
  const cells = glyphCells(glyph, size, finish, gap);
  const dim = 8 * size;
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={dim}
      height={dim}
      aria-hidden
      className={cn(pixelMarkVariants({ tone }), className)}
    >
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.s}
          height={c.s}
          rx={c.rx}
          fill={c.finish === 'outline' ? 'none' : 'currentColor'}
          stroke={c.finish === 'outline' ? 'currentColor' : undefined}
          strokeWidth={c.finish === 'outline' ? 1.5 : undefined}
          mask={c.maskId ? `url(#${c.maskId})` : undefined}
        />
      ))}
      {cells
        .filter((c) => c.finish === 'perforated' && c.maskId)
        .map((c) => (
          <mask key={c.maskId} id={c.maskId}>
            <rect x={c.x} y={c.y} width={c.s} height={c.s} fill="#fff" />
            <circle cx={c.x + c.s / 2} cy={c.y + c.s / 2} r={c.s * 0.17} fill="#000" />
          </mask>
        ))}
    </svg>
  );
}
