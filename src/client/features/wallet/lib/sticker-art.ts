import type { StickerKey } from '@/shared/lib/stickers';

/**
 * What each sticker looks like: a pixel glyph on a coloured disc, in the design system's colours.
 * What it is called and how it is earned is in `src/i18n/messages/ar/walletPass.json`, so the
 * website, the passes and the award dialog say the same thing. Colours are tokens, so a sticker is
 * the same in the light and the dark theme, like paper.
 */

type Glyph = readonly string[];

const GLYPHS = {
  star: [
    '...##...',
    '...##...',
    '########',
    '.######.',
    '..####..',
    '..####..',
    '.##..##.',
    '.#....#.',
  ],
  check: [
    '........',
    '......##',
    '.....##.',
    '#...##..',
    '##.##...',
    '.###....',
    '..#.....',
    '........',
  ],
  crown: [
    '#..##..#',
    '#.####.#',
    '########',
    '.######.',
    '.######.',
    '........',
    '........',
    '........',
  ],
  diamond: [
    '........',
    '.######.',
    '#.#..#.#',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
  spark: [
    '...#....',
    '...#....',
    '..###...',
    '#######.',
    '..###...',
    '...#....',
    '...#....',
    '........',
  ],
  plus: [
    '...##...',
    '...##...',
    '...##...',
    '########',
    '########',
    '...##...',
    '...##...',
    '...##...',
  ],
  trophy: [
    '########',
    '#.####.#',
    '#.####.#',
    '.######.',
    '..####..',
    '...##...',
    '...##...',
    '..####..',
  ],
  heart: [
    '.##..##.',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
} satisfies Record<string, Glyph>;

export interface StickerArt {
  glyph: Glyph;
  /** The disc and the glyph on it. */
  background: string;
  ink: string;
}

export const STICKER_ART: Record<StickerKey, StickerArt> = {
  star: { glyph: GLYPHS.star, background: 'var(--tuwaiq-indigo)', ink: 'var(--badge-canvas)' },
  lead: { glyph: GLYPHS.crown, background: 'var(--tuwaiq-lilac)', ink: 'var(--deep)' },
  k: { glyph: GLYPHS.trophy, background: 'var(--tuwaiq-teal)', ink: 'var(--deep)' },
  hack: { glyph: GLYPHS.check, background: 'var(--tuwaiq-orange)', ink: 'var(--deep)' },
  founder: { glyph: GLYPHS.diamond, background: 'var(--deep)', ink: 'var(--badge-gold)' },
  workshop: { glyph: GLYPHS.spark, background: 'var(--paper-peach)', ink: 'var(--tuwaiq-indigo)' },
  kind: { glyph: GLYPHS.heart, background: 'var(--club-rose)', ink: 'var(--badge-canvas)' },
  first: { glyph: GLYPHS.plus, background: 'var(--club-sky)', ink: 'var(--badge-canvas)' },
};
