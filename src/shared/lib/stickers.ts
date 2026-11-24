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
] as const;
export type StickerKey = (typeof STICKER_KEYS)[number];

type StickerSource = 'role' | 'points' | 'activity' | 'awarded';

interface StickerRule {
  source: StickerSource;
  /** Who may award it, for the awarded ones: every officer and lead, or officers only. */
  awardableBy?: 'lead' | 'officer';
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
};

/** The stickers someone can award, in the order the award dialog lists them. */
export const AWARDABLE_STICKER_KEYS = STICKER_KEYS.filter(
  (key) => STICKER_RULES[key].source === 'awarded',
) as readonly Extract<StickerKey, 'star' | 'hack' | 'founder' | 'workshop' | 'kind'>[];

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

export interface StickerPlacement {
  key: StickerKey;
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
export function defaultPlacement(key: StickerKey, index: number): StickerPlacement {
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
