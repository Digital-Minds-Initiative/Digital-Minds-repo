import { useTranslations } from 'next-intl';

import { cn } from '@/client/lib/utils';
import type { StickerKey } from '@/shared/lib/stickers';

import { STICKER_ART } from '../lib/sticker-art';

/**
 * A die-cut sticker: a white border, a coloured disc, a stitch ring, a pixel glyph and its name.
 * `locked` is the same sticker not yet earned, grey and quiet. Size is the diameter in pixels.
 */
export function Sticker({
  stickerKey,
  size,
  locked = false,
  peel = false,
  className,
  label,
}: {
  stickerKey: StickerKey;
  size: number;
  locked?: boolean;
  /** Lifts one corner, as if it was stuck on by hand. */
  peel?: boolean;
  className?: string;
  /** The name shown on the disc; the sticker's own name when left out. */
  label?: string;
}) {
  const t = useTranslations('walletPass.sticker');
  const art = STICKER_ART[stickerKey];
  const name = label ?? t(stickerKey);
  const rows = art.glyph;
  const face = locked
    ? 'color-mix(in oklab, var(--badge-ink) 14%, var(--badge-white))'
    : art.background;
  const ink = locked ? 'color-mix(in oklab, var(--badge-ink) 38%, transparent)' : art.ink;
  const fontSize = name.length > 11 ? 9 : name.length > 8 ? 10.5 : 12;

  return (
    <svg
      role="img"
      aria-label={name}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('block shrink-0 overflow-visible', className)}
    >
      <circle
        cx="50"
        cy="50"
        r="49.5"
        fill="var(--badge-white)"
        stroke="color-mix(in oklab, var(--badge-ink) 28%, transparent)"
        strokeWidth="1"
      />
      <circle cx="50" cy="50" r="44" fill={face} />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke={ink}
        strokeOpacity={0.4}
        strokeWidth="1.1"
        strokeDasharray="2.2 3"
      />
      <g transform="translate(30 19)" shapeRendering="crispEdges">
        {rows.flatMap((row, y) =>
          [...row].map((cell, x) =>
            cell === '#' ? (
              <rect
                key={`${x}-${y}`}
                x={x * 5}
                y={y * 5}
                width="5"
                height="5"
                rx="0.6"
                fill={ink}
              />
            ) : null,
          ),
        )}
      </g>
      <text
        x="50"
        y="75"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={700}
        fill={ink}
        style={{ fontFamily: 'var(--font-sans)', direction: 'rtl' }}
      >
        {name}
      </text>
      {peel ? (
        <g aria-hidden>
          <path
            d="M70 6 Q92 10 94 32 L74 30 Z"
            fill="var(--badge-white)"
            stroke="color-mix(in oklab, var(--badge-ink) 26%, transparent)"
            strokeWidth="0.8"
          />
          <path
            d="M70 6 L74 30 L94 32"
            fill="none"
            stroke="color-mix(in oklab, var(--badge-ink) 20%, transparent)"
            strokeWidth="0.8"
          />
        </g>
      ) : null}
    </svg>
  );
}
