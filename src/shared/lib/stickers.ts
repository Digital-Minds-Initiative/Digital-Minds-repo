/**
 * The stickers a member can stick on the back of their card (docs/adr/0032-card-link-and-stickers.md).
 * The list lives here, with the rule for each one, so the API, the mocks and the screen agree. What
 * a sticker looks like and what it is called on screen belong to the client.
 *
 * Two kinds. A sticker earned by a rule is worked out from what the system already knows, so it
 * can never be wrong or forged; one that is *awarded* is given by someone with the right: a club's
 * officers, and the leads of the committee the member is in.
 */

export const STICKER_KEYS = [
  'star',
  'lead',
  'k',
  'hack',
  'founder',
  'workshop',
  'kind',
  'first',
  'legend',
] as const;
export type StickerKey = (typeof STICKER_KEYS)[number];

type StickerSource = 'role' | 'points' | 'activity' | 'awarded';

interface StickerRule {
  source: StickerSource;
  /** Who may award it, for the awarded ones: every officer and lead, or officers only. */
  awardableBy?: 'lead' | 'officer';
  /**
   * A hidden sticker is not listed to members, with its name or how to get it, until they hold
   * one: it is only ever given by a person, as a surprise.
   */
  hidden?: boolean;
}

export const STICKER_RULES: Record<StickerKey, StickerRule> = {
  star: { source: 'awarded', awardableBy: 'lead' },
  lead: { source: 'role' },
  k: { source: 'points' },
  hack: { source: 'awarded', awardableBy: 'lead' },
  founder: { source: 'awarded', awardableBy: 'officer' },
  workshop: { source: 'awarded', awardableBy: 'lead' },
  kind: { source: 'awarded', awardableBy: 'lead' },
  first: { source: 'activity' },
  legend: { source: 'awarded', awardableBy: 'officer', hidden: true },
};

/** The stickers someone can award, in the order the award dialog lists them. */
export const AWARDABLE_STICKER_KEYS = STICKER_KEYS.filter(
  (key) => STICKER_RULES[key].source === 'awarded',
) as readonly Extract<StickerKey, 'star' | 'hack' | 'founder' | 'workshop' | 'kind' | 'legend'>[];

/** Points at which «١٠٠٠ نقطة» is earned. */
export const THOUSAND_POINTS = 1000;

/** The most stickers that fit on one card, so a card stays a card. */
export const MAX_PLACED_STICKERS = 12;

export interface StickerFacts {
  clubRole: 'MEMBER' | 'CLUB_OFFICER';
  ledCommittees: number;
  /** The active points balance. */
  points: number;
  /** How many active transactions the member has. */
  transactions: number;
}

/** The stickers earned by a rule: an officer or a lead, a thousand points, a first achievement. */
export function derivedStickers(facts: StickerFacts): StickerKey[] {
  const earned: StickerKey[] = [];
  if (facts.clubRole === 'CLUB_OFFICER' || facts.ledCommittees > 0) earned.push('lead');
  if (facts.points >= THOUSAND_POINTS) earned.push('k');
  if (facts.transactions > 0) earned.push('first');
  return earned;
}

/** Who is awarding: what the actor is to the member's club and committee. */
export interface AwarderStanding {
  fullAdmin: boolean;
  /** An officer of the member's club. */
  officer: boolean;
  /** A lead of a committee the member is in. */
  lead: boolean;
}

/** Whether that standing may award that sticker. Only the awarded kind can be given. */
export function canAwardSticker(standing: AwarderStanding, key: StickerKey): boolean {
  const rule = STICKER_RULES[key];
  if (rule.source !== 'awarded') return false;
  if (standing.fullAdmin || standing.officer) return true;
  return standing.lead && rule.awardableBy === 'lead';
}

/** Whether that standing may give a custom sticker, by who its designer said may give it. */
export function canAwardCustomSticker(
  standing: AwarderStanding,
  awardableBy: 'LEAD' | 'OFFICER',
): boolean {
  if (standing.fullAdmin || standing.officer) return true;
  return standing.lead && awardableBy === 'LEAD';
}

export interface StickerPlacement {
  key: StickerRef;
  /** The sticker's centre, as a fraction of the card's width and height. */
  x: number;
  y: number;
  /** Degrees, turned either way. */
  rotation: number;
  /** 1 is the size it was drawn at. */
  scale: number;
  /** Stacking order: the higher one lies on top. */
  z: number;
}

export const PLACEMENT_LIMITS = {
  rotation: { min: -45, max: 45 },
  scale: { min: 0.6, max: 1.6 },
} as const;

/** Where a sticker lands when it is first stuck on: a little different each time, never off the card. */
export function defaultPlacement(key: StickerRef, index: number): StickerPlacement {
  const spots = [
    [0.27, 0.32],
    [0.64, 0.3],
    [0.46, 0.56],
    [0.78, 0.52],
    [0.22, 0.58],
    [0.5, 0.34],
  ] as const;
  const [x, y] = spots[index % spots.length] ?? [0.5, 0.4];
  const turn = [-9, 7, -5, 11, -13, 4][index % 6] ?? 0;
  return { key, x, y, rotation: turn, scale: 1, z: index };
}

// ─── Stickers a club's leaders design (docs/adr/0033-custom-stickers.md) ──────────────────────

/** A custom sticker's key on a card or an award: `custom:` and the sticker's id. */
const CUSTOM_STICKER_PREFIX = 'custom:';
export type CustomStickerKey = `custom:${string}`;
export type StickerRef = StickerKey | CustomStickerKey;

export const isCustomStickerKey = (value: string): value is CustomStickerKey =>
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export const customStickerKey = (id: string): CustomStickerKey => `${CUSTOM_STICKER_PREFIX}${id}`;

export const customStickerId = (key: CustomStickerKey): string =>
  key.slice(CUSTOM_STICKER_PREFIX.length);

/** True for a hidden built-in sticker: it is not shown to members until they hold it. */
export const isHiddenBuiltin = (key: StickerKey): boolean => STICKER_RULES[key].hidden === true;

/** The pixel icons a sticker can carry (drawn by the client, `lib/sticker-art.ts`). */
export const STICKER_ICONS = [
  'star',
  'check',
  'crown',
  'diamond',
  'spark',
  'plus',
  'trophy',
  'heart',
  'bolt',
  'flag',
  'rocket',
  'book',
  'code',
  'moon',
  'mic',
  'bulb',
] as const;
export type StickerIcon = (typeof STICKER_ICONS)[number];

export const STICKER_SHAPES = ['disc', 'square', 'hex', 'shield'] as const;
export type StickerShape = (typeof STICKER_SHAPES)[number];

/** The design system's colours a sticker can wear, by name: never a free colour. */
export const STICKER_COLORS = [
  'indigo',
  'lilac',
  'teal',
  'orange',
  'peach',
  'rose',
  'sky',
  'deep',
  'gold',
  'cream',
  'white',
  'ink',
] as const;
export type StickerColor = (typeof STICKER_COLORS)[number];

/** How rare a sticker is. A built-in one has its own; a designed one is whatever its designer says. */
export const STICKER_RARITIES = ['COMMON', 'RARE', 'LEGENDARY'] as const;
export type StickerRarity = (typeof STICKER_RARITIES)[number];

export const BUILTIN_RARITY: Record<StickerKey, StickerRarity> = {
  star: 'COMMON',
  lead: 'RARE',
  k: 'RARE',
  hack: 'RARE',
  founder: 'LEGENDARY',
  workshop: 'COMMON',
  kind: 'COMMON',
  first: 'COMMON',
  legend: 'LEGENDARY',
};

/** Whether a seasonal sticker may be given at `now`: inside its window, or always when it has none. */
export function isStickerOpen(
  now: Date,
  season: { availableFrom: Date | string | null; availableUntil: Date | string | null },
): boolean {
  const from = season.availableFrom === null ? null : new Date(season.availableFrom);
  const until = season.availableUntil === null ? null : new Date(season.availableUntil);
  return (from === null || now >= from) && (until === null || now < until);
}

export const CUSTOM_STICKER_LIMITS = {
  name: 40,
  label: 14,
  howTo: 240,
  reason: 120,
  /** How many live custom stickers one club keeps, so the tray stays a tray. */
  perClub: 40,
} as const;

/** What a custom sticker is: all of it, as the card, the page and the studio draw it. */
export interface CustomStickerDef {
  key: CustomStickerKey;
  name: string;
  howTo: string;
  label: string;
  icon: StickerIcon;
  shape: StickerShape;
  background: StickerColor;
  ink: StickerColor;
  hidden: boolean;
  rarity: StickerRarity;
  /** A seasonal sticker: the window it can be given in, as ISO instants, or null for both ends. */
  availableFrom: string | null;
  availableUntil: string | null;
}
