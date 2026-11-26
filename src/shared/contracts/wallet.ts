import { z } from 'zod';

import { defineEndpoint, idSchema, isoDateTimeSchema } from '@/shared/contracts/core';
import {
  CUSTOM_STICKER_LIMITS,
  isCustomStickerKey,
  STICKER_COLORS,
  STICKER_ICONS,
  STICKER_KEYS,
  STICKER_SHAPES,
  type StickerKey,
} from '@/shared/lib/stickers';

import { clubRefSchema } from './clubs';

export const builtinStickerKeySchema = z.enum(STICKER_KEYS);

/** A built-in sticker's key, or `custom:<id>` for one a club's leaders designed. */
export const stickerKeySchema = z.union([
  builtinStickerKeySchema,
  z.string().refine(isCustomStickerKey, { message: 'invalid_sticker_key' }),
]);

/** A sticker a club's leaders designed: everything needed to draw it and say how to get it. */
export const customStickerDefSchema = z.object({
  key: z.string().refine(isCustomStickerKey, { message: 'invalid_sticker_key' }),
  name: z.string().min(1).max(CUSTOM_STICKER_LIMITS.name),
  howTo: z.string().min(1).max(CUSTOM_STICKER_LIMITS.howTo),
  label: z.string().min(1).max(CUSTOM_STICKER_LIMITS.label),
  icon: z.enum(STICKER_ICONS),
  shape: z.enum(STICKER_SHAPES),
  background: z.enum(STICKER_COLORS),
  ink: z.enum(STICKER_COLORS),
  hidden: z.boolean(),
});
export const cardToneSchema = z.enum(['paper', 'matte']);

/** Where a sticker lies on the back of the card. */
export const stickerPlacementSchema = z.object({
  key: stickerKeySchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  rotation: z.number().min(-45).max(45),
  scale: z.number().min(0.6).max(1.6),
  z: z.number().int().min(0).max(100),
});

/** A sticker the member has earned, and where they stuck it, if they did. */
export const earnedStickerSchema = z.object({
  key: stickerKeySchema,
  source: z.enum(['role', 'points', 'activity', 'awarded']),
  placement: stickerPlacementSchema.nullable(),
  /** When it was given: only for an awarded sticker (a rule's sticker has no single moment). */
  earnedAt: isoDateTimeSchema.nullable(),
  /** What it was given for, in the giver's words, when they wrote one. */
  reason: z.string().nullable(),
  /** The design, for a sticker the club's leaders made; null for a built-in one. */
  custom: customStickerDefSchema.nullable(),
});
export type EarnedSticker = z.infer<typeof earnedStickerSchema>;
export type { StickerKey };

/** What the QR opens, and how much of it the member shows. */
export const cardShareSchema = z.object({
  enabled: z.boolean(),
  showPoints: z.boolean(),
  showActivity: z.boolean(),
  /** The address the QR holds, or null while sharing is off. */
  url: z.url().nullable(),
});

/** One member card: a membership in one club, as the card and the Wallet pass show it. */
export const memberCardSchema = z.object({
  membershipId: idSchema,
  club: clubRefSchema,
  mood: z.enum(['tech', 'gem']),
  /** Printed on the card and encoded in its QR. */
  memberCode: z.string(),
  fullName: z.string(),
  /** The membership type, e.g. «عضو فعال». */
  role: z.string(),
  /** How the badge is dressed: the member's own choice, or what their role gives. */
  tone: cardToneSchema,
  /** The member's own choice, or null when the role decides. */
  tonePreference: cardToneSchema.nullable(),
  /** The stickers earned, by a rule or by an award, with where each one is stuck. */
  stickers: z.array(earnedStickerSchema),
  /** Stickers of the member's clubs they can see and have not earned yet, shown locked with how to get them. */
  lockedStickers: z.array(customStickerDefSchema),
  share: cardShareSchema,
  /** What the QR on the card and on the passes holds: the share address, or the member code. */
  qr: z.string(),
  /** What the person holds in the club: decides how the card is dressed and what it calls them. */
  clubRole: z.enum(['MEMBER', 'CLUB_OFFICER']),
  committees: z.array(z.string()),
  /** The committees they lead (a subset of `committees`). */
  ledCommittees: z.array(z.string()),
  hijriYear: z.number().int(),
  gregorianYear: z.number().int(),
  /** The active points balance across the club's committees. */
  points: z.number().int(),
  stampsEarned: z.number().int().min(0),
  /** The next stamp is half earned: its box is drawn half filled. */
  stampsHalf: z.boolean(),
  stampsTotal: z.number().int().min(1),
  /**
   * Which wallets this server can issue the pass to. False for one that is not set up yet (no Apple
   * signing certificate, no Google issuer account): its button is switched off, the card is not.
   */
  wallet: z.object({ apple: z.boolean(), google: z.boolean() }),
});
export type MemberCard = z.infer<typeof memberCardSchema>;

/**
 * The caller's own cards, one per active club membership (a person in two clubs has two). Nobody
 * else's: the rows come from the caller's own memberships, never from the dashboard scopes.
 */
export const myCardsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me/cards',
  access: 'actor',
  response: z.object({ cards: z.array(memberCardSchema) }),
});

export const walletPassParams = z.object({ membershipId: idSchema });

/**
 * The Apple Wallet pass (`.pkpass`) for one of the caller's own memberships. 404 for anyone
 * else's, 503 `wallet_not_configured` while the Apple certificate is not set up.
 */
export const walletPassEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me/cards/:membershipId/wallet-pass',
  access: 'actor',
  params: walletPassParams,
  response: z.instanceof(Uint8Array),
});

export const WALLET_PASS_CONTENT_TYPE = 'application/vnd.apple.pkpass';

/**
 * The "Save to Google Wallet" link for one of the caller's own memberships: a signed address the
 * browser opens on any Android phone. 404 for anyone else's, 409 `wallet_not_configured` while
 * the Google issuer account is not set up.
 */
export const googleWalletEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me/cards/:membershipId/google-wallet',
  access: 'actor',
  params: walletPassParams,
  response: z.object({ url: z.url() }),
});

/** The pictures a wallet fetches over HTTP. Public, and only ever the badge's art. */
export const walletArtNames = [
  'hero-paper-tech',
  'hero-matte-tech',
  'hero-matte-gem',
  'hero-paper-gem',
  'logo-paper-tech',
  'logo-matte-tech',
  'logo-matte-gem',
  'logo-paper-gem',
] as const;
export type WalletArtName = (typeof walletArtNames)[number];

export const walletArtEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/wallet-art/:name',
  access: 'public',
  params: z.object({ name: z.enum(walletArtNames) }),
  response: z.instanceof(Uint8Array),
});
