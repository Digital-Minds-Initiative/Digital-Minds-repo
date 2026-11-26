import type {
  CustomStickerDef,
  StickerColor,
  StickerIcon,
  StickerKey,
} from '@/shared/lib/stickers';

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
  bolt: [
    '....##..',
    '...##...',
    '..##....',
    '.######.',
    '...##...',
    '..##....',
    '.##.....',
    '.#......',
  ],
  flag: [
    '#.####..',
    '#.#####.',
    '#.######',
    '#.#####.',
    '#.####..',
    '#.......',
    '#.......',
    '#.......',
  ],
  rocket: [
    '...##...',
    '..####..',
    '..####..',
    '.######.',
    '.#.##.#.',
    '.#.##.#.',
    '...##...',
    '..#..#..',
  ],
  book: [
    '.##..##.',
    '########',
    '#.####.#',
    '#.#..#.#',
    '#.####.#',
    '#.#..#.#',
    '########',
    '........',
  ],
  code: [
    '........',
    '..#..#..',
    '.#....#.',
    '#..##..#',
    '#..##..#',
    '.#....#.',
    '..#..#..',
    '........',
  ],
  moon: [
    '..####..',
    '.###....',
    '###.....',
    '###.....',
    '###.....',
    '.###..#.',
    '..######',
    '...####.',
  ],
  mic: [
    '..####..',
    '..####..',
    '#.####.#',
    '#.####.#',
    '.######.',
    '...##...',
    '...##...',
    '..####..',
  ],
  bulb: [
    '..####..',
    '.######.',
    '.######.',
    '.######.',
    '..####..',
    '..####..',
    '...##...',
    '...##...',
  ],
} satisfies Record<StickerIcon, Glyph>;

/** The design system's colours a sticker can wear, by name: tokens, so it is the same in light and dark. */
export const STICKER_COLOR_VAR: Record<StickerColor, string> = {
  indigo: 'var(--tuwaiq-indigo)',
  lilac: 'var(--tuwaiq-lilac)',
  teal: 'var(--tuwaiq-teal)',
  orange: 'var(--tuwaiq-orange)',
  peach: 'var(--paper-peach)',
  rose: 'var(--club-rose)',
  sky: 'var(--club-sky)',
  deep: 'var(--deep)',
  gold: 'var(--badge-gold)',
  cream: 'var(--badge-cream)',
  white: 'var(--badge-white)',
  ink: 'var(--badge-ink)',
};

export interface StickerArt {
  glyph: Glyph;
  /** The disc and the glyph on it. */
  background: string;
  ink: string;
}

/** The pixel drawing of an icon, by name: the studio's picker and a custom sticker both use it. */
export const ICON_GLYPHS: Record<StickerIcon, Glyph> = GLYPHS;

export const STICKER_ART: Record<StickerKey, StickerArt> = {
  star: { glyph: GLYPHS.star, background: 'var(--tuwaiq-indigo)', ink: 'var(--badge-canvas)' },
  lead: { glyph: GLYPHS.crown, background: 'var(--tuwaiq-lilac)', ink: 'var(--deep)' },
  k: { glyph: GLYPHS.trophy, background: 'var(--tuwaiq-teal)', ink: 'var(--deep)' },
  hack: { glyph: GLYPHS.check, background: 'var(--tuwaiq-orange)', ink: 'var(--deep)' },
  founder: { glyph: GLYPHS.diamond, background: 'var(--deep)', ink: 'var(--badge-gold)' },
  workshop: { glyph: GLYPHS.spark, background: 'var(--paper-peach)', ink: 'var(--tuwaiq-indigo)' },
  kind: { glyph: GLYPHS.heart, background: 'var(--club-rose)', ink: 'var(--badge-canvas)' },
  first: { glyph: GLYPHS.plus, background: 'var(--club-sky)', ink: 'var(--badge-canvas)' },
  legend: { glyph: GLYPHS.moon, background: 'var(--deep)', ink: 'var(--badge-gold)' },
};

/** What a custom sticker looks like: the leader's own icon and colours, by name. */
export function customArt(def: Pick<CustomStickerDef, 'icon' | 'background' | 'ink'>): StickerArt {
  return {
    glyph: ICON_GLYPHS[def.icon],
    background: STICKER_COLOR_VAR[def.background],
    ink: STICKER_COLOR_VAR[def.ink],
  };
}
