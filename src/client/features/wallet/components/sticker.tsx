import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { cn } from '@/client/lib/utils';
import {
  type CustomStickerDef,
  type StickerRef,
  type StickerShape,
  isCustomStickerKey,
} from '@/shared/lib/stickers';

import { customArt, STICKER_ART } from '../lib/sticker-art';

/**
 * The three outlines of a sticker's shape (the white border, the coloured face, the stitch line),
 * each drawn in a 100 × 100 box.
 */
function shapeLayers(
  shape: StickerShape,
  paint: { border: string; face: string; ink: string },
): ReactElement {
  const border = { fill: 'var(--badge-white)', stroke: paint.border, strokeWidth: 1 };
  const stitch = {
    fill: 'none',
    stroke: paint.ink,
    strokeOpacity: 0.4,
    strokeWidth: 1.1,
    strokeDasharray: '2.2 3',
  };
  const around = (k: number) => `translate(50 50) scale(${k}) translate(-50 -50)`;
  switch (shape) {
    case 'square':
      return (
        <>
          <rect x="1" y="1" width="98" height="98" rx="22" {...border} />
          <rect x="6" y="6" width="88" height="88" rx="18" fill={paint.face} />
          <rect x="10.5" y="10.5" width="79" height="79" rx="14" {...stitch} />
        </>
      );
    case 'hex': {
      const hex = '50,1 94,25.5 94,74.5 50,99 6,74.5 6,25.5';
      return (
        <>
          <polygon points={hex} strokeLinejoin="round" {...border} />
          <polygon points={hex} fill={paint.face} transform={around(0.91)} />
          <polygon points={hex} {...stitch} transform={around(0.82)} />
        </>
      );
    }
    case 'shield': {
      const shield = 'M50 1 L92 13 V48 C92 75 72 92 50 99 C28 92 8 75 8 48 V13 Z';
      return (
        <>
          <path d={shield} strokeLinejoin="round" {...border} />
          <path d={shield} fill={paint.face} transform={around(0.91)} />
          <path d={shield} {...stitch} transform={around(0.82)} />
        </>
      );
    }
    default:
      return (
        <>
          <circle cx="50" cy="50" r="49.5" {...border} />
          <circle cx="50" cy="50" r="44" fill={paint.face} />
          <circle cx="50" cy="50" r="40" {...stitch} />
        </>
      );
  }
}

/**
 * A die-cut sticker: a white border, a coloured face, a stitch line, a pixel glyph and its name.
 * Built-in ones are known by their key; one the club's leaders designed arrives as `custom`, with
 * its own shape, colours, icon and words. `locked` is the same sticker not yet earned, grey and
 * quiet. Size is the diameter in pixels.
 */
export function Sticker({
  stickerKey,
  custom = null,
  size,
  locked = false,
  peel = false,
  className,
  label,
}: {
  stickerKey: StickerRef;
  /** The design of a custom sticker; omitted for a built-in one. */
  custom?: CustomStickerDef | null;
  size: number;
  locked?: boolean;
  /** Lifts one corner, as if it was stuck on by hand. */
  peel?: boolean;
  className?: string;
  /** The name shown on the face; the sticker's own name when left out. */
  label?: string;
}) {
  const t = useTranslations('walletPass.sticker');
  const builtinKey = isCustomStickerKey(stickerKey) ? null : stickerKey;
  // A custom key whose design did not arrive draws as a quiet blank rather than breaking the page.
  const art = custom
    ? customArt(custom)
    : builtinKey
      ? STICKER_ART[builtinKey]
      : customArt({ icon: 'star', background: 'white', ink: 'ink' });
  const name = label ?? (custom ? custom.label : builtinKey ? t(builtinKey) : '');
  const accessible = custom ? custom.name : name;
  const face = locked
    ? 'color-mix(in oklab, var(--badge-ink) 14%, var(--badge-white))'
    : art.background;
  const ink = locked ? 'color-mix(in oklab, var(--badge-ink) 38%, transparent)' : art.ink;
  const fontSize = name.length > 11 ? 9 : name.length > 8 ? 10.5 : 12;

  return (
    <svg
      role="img"
      aria-label={accessible}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('block shrink-0 overflow-visible', className)}
    >
      {shapeLayers(custom?.shape ?? 'disc', {
        border: 'color-mix(in oklab, var(--badge-ink) 28%, transparent)',
        face,
        ink,
      })}
      <g transform="translate(30 19)" shapeRendering="crispEdges">
        {art.glyph.flatMap((row, y) =>
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
