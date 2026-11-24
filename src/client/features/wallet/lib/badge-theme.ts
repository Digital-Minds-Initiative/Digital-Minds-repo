import type { MemberCard } from '@/shared/contracts/wallet';
import type { CardMood, CardTone } from '@/shared/lib/member-card';

/**
 * How one badge is dressed. A colourway is a tone (white for members, matte for officers and
 * leads) in a mood (Tech for Tuwaiq, Gem for UQU Computing), exactly the badges of the final
 * reveal. Every value is a design token, never a free colour, and none of them follows the
 * room's light: a badge is the same in Oasis and Dusk, like paper.
 */
export interface BadgeTheme {
  /** The badge's ground and the text on it. */
  ground: string;
  text: string;
  textMuted: string;
  /** The role line and the logo mark. */
  accent: string;
  /** A hairline around the badge, so a matte badge still has an edge on a dark page. */
  ring: string;
  /** The website's pixel head beside the name. */
  mark: string;
  /** The slot punched at the top. */
  slot: string;
  /** The gradient panel: its base and the three blobs of light that drift in it. */
  panelBase: string;
  panelBlobs: readonly [string, string, string];
  panelText: string;
  panelTextMuted: string;
  /** Grain on a light panel needs a different blend than on a dark one. */
  panelIsLight: boolean;
  /** The outline shapes crossing the panel. */
  panelOutline: string;
  /** Stamps and the chip that holds the QR. */
  stamp: string;
  stampOff: string;
  chip: string;
  chipInk: string;
  /** The corner mosaic: rows of cell codes and what each code paints. */
  mosaic: Record<string, string>;
  mosaicPerforated: string;
  /** The club's own logo, as the design system supplies it for this ground. */
  logo: { src: string; height: number; alt: string };
}

const MOSAIC_ROWS = ['......Bo', '....LpBb', '..Tl.LoP', '.lBpTB..'] as const;
export const BADGE_MOSAIC_ROWS: readonly string[] = MOSAIC_ROWS;

const TECH_MOSAIC = {
  l: 'var(--tuwaiq-lilac)',
  b: 'var(--tuwaiq-indigo)',
  t: 'var(--tuwaiq-teal)',
  o: 'var(--tuwaiq-orange)',
  p: 'var(--paper-lilac)',
};

const GEM_MOSAIC = {
  // Same cells, Computing's colours: gold, teal-blue, deep teal, cream.
  l: 'var(--badge-gold)',
  b: 'var(--uqu-teal-blue)',
  t: 'var(--uqu-deep-teal)',
  o: 'var(--badge-cream)',
  p: 'var(--badge-gold)',
};

const TUWAIQ_PRIMARY = { src: '/clubs/tuwaiq-club-logo.png', height: 62, alt: 'Tuwaiq Club' };
const TUWAIQ_WHITE = {
  src: '/clubs/tuwaiq-club-logo-reversed.png',
  height: 62,
  alt: 'Tuwaiq Club',
};
const COMPUTING_PRIMARY = {
  src: '/clubs/uqu-computing-diamond-era.png',
  height: 52,
  alt: 'UQU Computing',
};
const COMPUTING_WHITE = {
  src: '/clubs/uqu-computing-logo-white.png',
  height: 52,
  alt: 'UQU Computing',
};

const THEMES: Record<`${CardTone}-${CardMood}`, BadgeTheme> = {
  'paper-tech': {
    ground: 'var(--badge-white)',
    ring: 'color-mix(in oklab, var(--badge-ink) 12%, transparent)',
    text: 'var(--badge-ink)',
    textMuted: 'color-mix(in oklab, var(--badge-ink) 62%, transparent)',
    accent: 'var(--tuwaiq-indigo)',
    mark: 'var(--tuwaiq-indigo)',
    slot: 'color-mix(in oklab, var(--badge-ink) 16%, var(--badge-white))',
    panelBase: 'var(--badge-panel-lilac)',
    panelBlobs: ['var(--tuwaiq-lilac)', 'var(--tuwaiq-orange)', 'var(--tuwaiq-teal)'],
    panelText: 'var(--badge-ink)',
    panelTextMuted: 'color-mix(in oklab, var(--badge-ink) 78%, transparent)',
    panelIsLight: true,
    panelOutline: 'color-mix(in oklab, var(--badge-ink) 28%, transparent)',
    stamp: 'var(--badge-ink)',
    stampOff: 'color-mix(in oklab, var(--badge-ink) 45%, transparent)',
    chip: 'var(--badge-cream)',
    chipInk: 'var(--badge-ink)',
    mosaic: TECH_MOSAIC,
    mosaicPerforated: 'b',
    logo: TUWAIQ_PRIMARY,
  },
  'matte-tech': {
    ground: 'var(--badge-matte)',
    ring: 'color-mix(in oklab, var(--badge-canvas) 14%, transparent)',
    text: 'var(--badge-canvas)',
    textMuted: 'color-mix(in oklab, var(--badge-canvas) 70%, transparent)',
    accent: 'var(--tuwaiq-lilac)',
    mark: 'var(--badge-canvas)',
    slot: 'var(--badge-ink)',
    panelBase: 'var(--badge-panel-indigo)',
    panelBlobs: ['var(--tuwaiq-lilac)', 'var(--badge-blue)', 'var(--deep)'],
    panelText: 'var(--badge-canvas)',
    panelTextMuted: 'color-mix(in oklab, var(--badge-canvas) 84%, transparent)',
    panelIsLight: false,
    panelOutline: 'color-mix(in oklab, var(--badge-canvas) 32%, transparent)',
    stamp: 'var(--badge-canvas)',
    stampOff: 'color-mix(in oklab, var(--badge-canvas) 50%, transparent)',
    chip: 'var(--badge-cream)',
    chipInk: 'var(--badge-ink)',
    mosaic: TECH_MOSAIC,
    mosaicPerforated: 'l',
    logo: TUWAIQ_WHITE,
  },
  'matte-gem': {
    ground: 'var(--uqu-dark-cyan)',
    ring: 'color-mix(in oklab, var(--badge-canvas) 14%, transparent)',
    text: 'var(--badge-canvas)',
    textMuted: 'color-mix(in oklab, var(--badge-canvas) 70%, transparent)',
    accent: 'var(--badge-gold)',
    mark: 'var(--badge-gold)',
    slot: 'var(--badge-ink)',
    panelBase: 'var(--badge-panel-cyan)',
    panelBlobs: ['var(--badge-gold)', 'var(--uqu-teal-blue)', 'var(--uqu-deep-teal)'],
    panelText: 'var(--badge-canvas)',
    panelTextMuted: 'color-mix(in oklab, var(--badge-canvas) 86%, transparent)',
    panelIsLight: false,
    panelOutline: 'color-mix(in oklab, var(--badge-canvas) 30%, transparent)',
    stamp: 'var(--badge-gold)',
    stampOff: 'color-mix(in oklab, var(--badge-gold) 50%, transparent)',
    chip: 'var(--badge-cream)',
    chipInk: 'var(--uqu-dark-cyan)',
    mosaic: GEM_MOSAIC,
    mosaicPerforated: 'l',
    logo: COMPUTING_WHITE,
  },
  'paper-gem': {
    ground: 'var(--badge-white)',
    ring: 'color-mix(in oklab, var(--badge-ink) 12%, transparent)',
    text: 'var(--badge-ink)',
    textMuted: 'color-mix(in oklab, var(--badge-ink) 62%, transparent)',
    accent: 'var(--uqu-deep-teal)',
    mark: 'var(--uqu-deep-teal)',
    slot: 'color-mix(in oklab, var(--badge-ink) 16%, var(--badge-white))',
    panelBase: 'var(--badge-panel-mint)',
    panelBlobs: ['var(--badge-gold)', 'var(--uqu-teal-blue)', 'var(--tuwaiq-teal)'],
    panelText: 'var(--badge-ink)',
    panelTextMuted: 'color-mix(in oklab, var(--badge-ink) 78%, transparent)',
    panelIsLight: true,
    panelOutline: 'color-mix(in oklab, var(--badge-ink) 28%, transparent)',
    stamp: 'var(--badge-ink)',
    stampOff: 'color-mix(in oklab, var(--badge-ink) 45%, transparent)',
    chip: 'var(--badge-cream)',
    chipInk: 'var(--badge-ink)',
    mosaic: GEM_MOSAIC,
    mosaicPerforated: 'l',
    logo: COMPUTING_PRIMARY,
  },
};

export function badgeThemeFor(card: Pick<MemberCard, 'mood' | 'tone'>): BadgeTheme {
  return THEMES[`${card.tone}-${card.mood}`];
}
