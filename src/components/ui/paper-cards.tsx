import type { CSSProperties } from 'react';

import { cn } from '@/client/lib/utils';
import { PixelSticker, type PixelStickerName } from '@/components/ui/pixel-sticker';

/**
 * A handful of punched paper notes fanned out and overlapping, each a small editorial poster: an
 * expressive Arabic headline, a short rule, three lines (some led by a mark like + ↗ ◆) and a mono
 * label. Pixel stickers are scattered around and between the notes. Everything is sized from the
 * note's (or the stage's) own width, so the cluster scales from a phone to a desktop without
 * breakpoints. Decorative: render it where the same information is also in the text.
 */
export type PaperCardTint = 'lilac' | 'peach' | 'teal' | 'cream';

export interface PaperCardItem {
  key: string;
  headline: string;
  /** Supporting lines. A leading `+`, `↗` or `◆` becomes a coloured mark; `verb · role` is split. */
  lines: string[];
  /** Small mono label, for example `→ 01 · MEMBERS`. */
  spec: string;
  tint: PaperCardTint;
}

const TINTS: Record<PaperCardTint, string> = {
  lilac: '[--card:var(--paper-lilac)]',
  peach: '[--card:var(--paper-peach)]',
  teal: '[--card:var(--paper-teal)]',
  cream: '[--card:var(--paper-cream)]',
};

interface Spot {
  place: string;
  tilt: string;
  delay: string;
}

/** Back to front, from the inline-start edge. Cards past the fourth share the last spot. */
const SPOTS: readonly Spot[] = [
  { place: 'top-[14%] start-0 z-10', tilt: 'rotate-3', delay: '-1s' },
  { place: 'top-[2%] start-[21.5%] z-20', tilt: '-rotate-2', delay: '-3s' },
  { place: 'top-[28%] start-[42%] z-30', tilt: 'rotate-3', delay: '-5s' },
  { place: 'top-[10%] start-[66.5%] z-40', tilt: '-rotate-4', delay: '0s' },
];
const LAST_SPOT: Spot = { place: 'top-[10%] start-[66.5%] z-40', tilt: '-rotate-4', delay: '0s' };

interface StickerSpot {
  name: PixelStickerName;
  /** Position and layer. Negative offsets let a sticker hang over the edge of the stack. */
  place: string;
  /** Width as a share of the stage. */
  size: string;
  /** Resting tilt, in degrees. */
  tilt: number;
  /** One bob: its length and offset, different for each so they never move together. */
  float: { duration: number; delay: number };
}

/*
 * A few stickers around the OUTSIDE of the stack: a row above it and a row below it, never on a
 * note, so every headline, line and label stays clear. Sizes and tilts differ so it still reads as
 * scattered; the stage's `mt` leaves room for the ones that hang above.
 */
const STICKERS: readonly StickerSpot[] = [
  {
    name: 'bulb',
    place: 'top-[-17%] start-[84%] z-50',
    size: 'w-[9%]',
    tilt: -10,
    float: { duration: 7.5, delay: -3 },
  },
  {
    name: 'khatam',
    place: 'top-[-14%] start-[57%] z-50',
    size: 'w-[11.5%]',
    tilt: 12,
    float: { duration: 6.5, delay: 0 },
  },
  {
    name: 'plus',
    place: 'top-[-12%] start-[24%] z-50',
    size: 'w-[9.5%]',
    tilt: -8,
    float: { duration: 8, delay: -4 },
  },
  {
    name: 'trophy',
    place: 'top-[88%] start-[7%] z-50',
    size: 'w-[9.5%]',
    tilt: -6,
    float: { duration: 9, delay: -1 },
  },
  {
    name: 'arrow',
    place: 'top-[91%] start-[56%] z-50',
    size: 'w-[7%]',
    tilt: 9,
    float: { duration: 8.5, delay: -5 },
  },
  {
    name: 'cross',
    place: 'top-[93%] start-[89%] z-50',
    size: 'w-[3.5%]',
    tilt: 0,
    float: { duration: 5.5, delay: -2 },
  },
];

/** `+ إنجاز يُحتسب` → the mark and the text. Other lines have no mark. */
function parseLine(line: string): { mark: string | null; text: string } {
  const match = /^([+↗◆])\s+(.*)$/u.exec(line);
  return match
    ? { mark: match[1] as string, text: match[2] as string }
    : { mark: null, text: line };
}

const MARK_STYLE: Record<string, string> = {
  '+': 'text-club-orange',
  '↗': 'text-tuwaiq-indigo',
  '◆': 'text-uqu-deep-teal',
};

/** `يشرف · المسؤول العام`: the verb stands out, the role recedes. */
function LineText({ text }: { text: string }) {
  const [lead, ...rest] = text.split(' · ');
  if (rest.length === 0) return <>{text}</>;
  return (
    <>
      <span className="font-semibold">{lead}</span>
      <span className="text-on-paper-muted"> · {rest.join(' · ')}</span>
    </>
  );
}

/** Tractor-feed holes down the card's start edge; the page shows through them. */
const RAIL_MASK =
  'radial-gradient(circle at 50% 4.5cqw, transparent 1.6cqw, black 1.9cqw) 0 0 / 100% 9cqw repeat-y';

function Card({ card, spot }: { card: PaperCardItem; spot: Spot }) {
  return (
    <li
      className={cn(
        'absolute w-[35%] drop-shadow-[0_16px_22px_color-mix(in_oklab,var(--slab)_45%,transparent)]',
        'motion-safe:animate-[folder-float_8s_ease-in-out_infinite]',
        spot.place,
      )}
      style={{ animationDelay: spot.delay }}
    >
      <div
        className={cn(
          '[container-type:inline-size] relative flex aspect-[210/290] rounded-cell border border-paper-rule text-on-paper',
          'transition-transform duration-(--duration-slow) ease-out motion-safe:hover:-translate-y-1.5',
          spot.tilt,
          TINTS[card.tint],
        )}
      >
        <div
          aria-hidden
          className="w-[12%] shrink-0 rounded-s-cell border-e border-dashed border-paper-rule bg-(--card)"
          style={{ WebkitMask: RAIL_MASK, mask: RAIL_MASK }}
        />
        <div className="flex min-w-0 flex-1 flex-col rounded-e-cell bg-(--card) px-[6cqw] py-[6cqw]">
          <span className="font-serif text-[max(0.95rem,13.5cqw)] leading-[1.15] font-bold text-balance">
            {card.headline}
          </span>
          {/* An understated rule between the headline and the lines. */}
          <span aria-hidden className="mt-[3.5cqw] mb-[3cqw] block h-px w-[34%] bg-on-paper/35" />
          <ul className="m-0 flex list-none flex-col gap-[2.2cqw] p-0">
            {card.lines.map((line) => {
              const { mark, text } = parseLine(line);
              return (
                <li
                  key={line}
                  className="flex items-baseline gap-[2cqw] text-[max(10px,7cqw)] leading-snug"
                >
                  {mark ? (
                    <span
                      aria-hidden
                      className={cn(
                        'w-[4cqw] shrink-0 text-center font-mono font-bold',
                        MARK_STYLE[mark],
                      )}
                    >
                      {mark}
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className="mt-[1.6cqw] block size-[2.4cqw] shrink-0 rotate-45 bg-on-paper"
                    />
                  )}
                  <span>
                    <LineText text={text} />
                  </span>
                </li>
              );
            })}
          </ul>
          <span className="mt-auto pt-[3cqw] font-mono text-[max(8px,5.2cqw)] tracking-[0.06em] text-on-paper-muted uppercase [direction:ltr] [unicode-bidi:isolate]">
            {card.spec}
          </span>
        </div>
      </div>
    </li>
  );
}

export function PaperCards({ cards, className }: { cards: PaperCardItem[]; className?: string }) {
  return (
    <div aria-hidden className={cn('relative mt-8 aspect-[1/0.82] w-full lg:mt-6', className)}>
      <ul className="m-0 list-none p-0">
        {cards.map((card, index) => (
          <Card key={card.key} card={card} spot={SPOTS[index] ?? LAST_SPOT} />
        ))}
      </ul>
      {STICKERS.map((sticker) => (
        <div
          key={sticker.name}
          className={cn(
            'pointer-events-none absolute drop-shadow-[0_4px_6px_color-mix(in_oklab,var(--slab)_40%,transparent)]',
            'motion-safe:animate-[sticker-bob_var(--bob)_ease-in-out_infinite]',
            sticker.place,
            sticker.size,
          )}
          style={
            {
              rotate: `${sticker.tilt}deg`,
              '--bob': `${sticker.float.duration}s`,
              animationDelay: `${sticker.float.delay}s`,
            } as CSSProperties
          }
        >
          <PixelSticker name={sticker.name} />
        </div>
      ))}
    </div>
  );
}
