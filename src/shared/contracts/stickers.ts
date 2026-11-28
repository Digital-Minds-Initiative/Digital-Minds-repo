import { z } from 'zod';

import {
  CUSTOM_STICKER_LIMITS,
  STICKER_COLORS,
  STICKER_ICONS,
  STICKER_RARITIES,
  STICKER_SHAPES,
} from '@/shared/lib/stickers';
import { collapseWhitespace } from '@/shared/lib/text';

import { awardableStickerSchema } from './cards';
import { defineEndpoint, idSchema, isoDateTimeSchema } from './core';
import { customStickerDefSchema, stickerKeySchema } from './wallet';

/*
 * The sticker studio: stickers a club's leaders design themselves, with the colours, the icon, the
 * words and how to get them (docs/adr/0033-custom-stickers.md); and, on top of it, the album, the
 * claim codes and the sticker's numbers (docs/adr/0034-album-claims-and-seasons.md). Colours and
 * icons are names from the lists in src/shared/lib/stickers.ts, so a sticker can only ever look
 * like the design system.
 */

const line = (max: number) =>
  z.string().transform(collapseWhitespace).pipe(z.string().min(1).max(max));

export const stickerAwardBySchema = z.enum(['LEAD', 'OFFICER']);

const fields = {
  name: line(CUSTOM_STICKER_LIMITS.name),
  howTo: line(CUSTOM_STICKER_LIMITS.howTo),
  label: line(CUSTOM_STICKER_LIMITS.label),
  icon: z.enum(STICKER_ICONS),
  shape: z.enum(STICKER_SHAPES),
  background: z.enum(STICKER_COLORS),
  ink: z.enum(STICKER_COLORS),
  hidden: z.boolean(),
  awardableBy: stickerAwardBySchema,
  rarity: z.enum(STICKER_RARITIES),
  /** A seasonal sticker can only be given inside this window; null at either end leaves it open. */
  availableFrom: isoDateTimeSchema.nullable(),
  availableUntil: isoDateTimeSchema.nullable(),
  /** The most members who may hold it; null for no limit. */
  maxHolders: z.number().int().min(1).max(100_000).nullable(),
};

const windowIsOrdered = (value: {
  availableFrom?: string | null | undefined;
  availableUntil?: string | null | undefined;
}) =>
  !value.availableFrom ||
  !value.availableUntil ||
  new Date(value.availableFrom) < new Date(value.availableUntil);

/** What a leader writes and picks. Every field is required on create; strict, so nothing is silently dropped. */
export const customStickerFieldsSchema = z
  .strictObject(fields)
  .refine(windowIsOrdered, { message: 'season_window_invalid', path: ['availableUntil'] });
export type CustomStickerFields = z.infer<typeof customStickerFieldsSchema>;

/** A custom sticker as the studio lists it. */
export const studioStickerSchema = customStickerDefSchema.extend({
  id: idSchema,
  clubId: idSchema,
  awardableBy: stickerAwardBySchema,
  archived: z.boolean(),
  createdAt: isoDateTimeSchema,
  /** How many members hold it now. */
  heldBy: z.number().int().min(0),
  maxHolders: z.number().int().nullable(),
  /** Whether the caller may change it: officers and full admins, and the leader who made it. */
  canEdit: z.boolean(),
});
export type StudioSticker = z.infer<typeof studioStickerSchema>;

const clubParams = z.object({ clubId: idSchema });
const stickerParams = z.object({ stickerId: idSchema });

/** The club's custom stickers, for whoever may award or manage them. Archived ones only on request. */
export const listCustomStickersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/custom-stickers',
  access: 'actor',
  params: clubParams,
  query: z.object({ includeArchived: z.stringbool().optional() }),
  response: z.object({ stickers: z.array(studioStickerSchema) }),
});

/**
 * Makes a sticker. Club officers, full admins and the leads of the club's committees may (403
 * `sticker_design_not_allowed` for anyone else who can see the club); an archived club refuses
 * (409 `club_archived`); a club keeps at most 40 live ones (409 `sticker_limit_reached`).
 */
export const createCustomStickerEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/custom-stickers',
  access: 'actor',
  params: clubParams,
  body: customStickerFieldsSchema,
  response: studioStickerSchema,
});

/**
 * Changes a sticker, or archives or restores it. Officers and full admins may change any; a lead
 * only their own. An archived sticker cannot be given any more and stays on the cards that hold it.
 */
export const updateCustomStickerEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/custom-stickers/:stickerId',
  access: 'actor',
  params: stickerParams,
  body: z
    .strictObject({
      name: fields.name.optional(),
      howTo: fields.howTo.optional(),
      label: fields.label.optional(),
      icon: fields.icon.optional(),
      shape: fields.shape.optional(),
      background: fields.background.optional(),
      ink: fields.ink.optional(),
      hidden: fields.hidden.optional(),
      awardableBy: fields.awardableBy.optional(),
      rarity: fields.rarity.optional(),
      availableFrom: fields.availableFrom.optional(),
      availableUntil: fields.availableUntil.optional(),
      maxHolders: fields.maxHolders.optional(),
      archived: z.boolean().optional(),
    })
    .refine((value) => Object.values(value).some((field) => field !== undefined), {
      message: 'at_least_one_field',
    })
    .refine(windowIsOrdered, { message: 'season_window_invalid', path: ['availableUntil'] }),
  response: studioStickerSchema,
});

// ─── The album ────────────────────────────────────────────────

/** One sticker in a member's album, held or still to get. */
export const albumEntrySchema = z.object({
  key: stickerKeySchema,
  /** The design of a custom sticker; null for a built-in one. */
  custom: customStickerDefSchema.nullable(),
  rarity: z.enum(STICKER_RARITIES),
  held: z.boolean(),
  /** Of the club's active members, how many per cent hold it. Null for a sticker a rule gives. */
  heldPercent: z.number().int().min(0).max(100).nullable(),
  /** A seasonal sticker's window, or null for both ends. */
  availableFrom: isoDateTimeSchema.nullable(),
  availableUntil: isoDateTimeSchema.nullable(),
  /** Whether it can still be given right now (inside its season, not archived, not sold out). */
  open: z.boolean(),
});
export type AlbumEntry = z.infer<typeof albumEntrySchema>;

/**
 * The album of one of the caller's own memberships: every sticker the club has that they may know
 * about, held or not. A hidden sticker they do not hold is not listed, only counted (`secretCount`),
 * so the album can show a «؟» without saying what is behind it.
 */
export const albumEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/me/cards/:membershipId/album',
  access: 'actor',
  params: z.object({ membershipId: idSchema }),
  response: z.object({
    entries: z.array(albumEntrySchema),
    secretCount: z.number().int().min(0),
  }),
});

// ─── Claim codes ──────────────────────────────────────────────

export const CLAIM_LIMITS = { maxClaims: 500, maxMinutes: 24 * 60, minMinutes: 5 } as const;

export const createClaimBodySchema = z.strictObject({
  key: awardableStickerSchema,
  title: line(60),
  maxClaims: z.number().int().min(1).max(CLAIM_LIMITS.maxClaims),
  minutes: z.number().int().min(CLAIM_LIMITS.minMinutes).max(CLAIM_LIMITS.maxMinutes),
  /** Required for a lead: only members of this committee may claim. Optional for officers. */
  committeeId: idSchema.nullable(),
});
export type CreateClaimBody = z.infer<typeof createClaimBodySchema>;

export const claimSchema = z.object({
  id: idSchema,
  clubId: idSchema,
  committeeId: idSchema.nullable(),
  key: stickerKeySchema,
  custom: customStickerDefSchema.nullable(),
  title: z.string(),
  maxClaims: z.number().int(),
  claimed: z.number().int().min(0),
  expiresAt: isoDateTimeSchema,
  closedAt: isoDateTimeSchema.nullable(),
  status: z.enum(['open', 'full', 'expired', 'closed']),
  createdAt: isoDateTimeSchema,
});
export type StickerClaim = z.infer<typeof claimSchema>;

/**
 * Makes a code for an event. Officers and full admins may for any sticker they can give; a lead
 * only for a committee they lead and a sticker leads may give (403 `sticker_claim_not_allowed`).
 * Archived club 409 `club_archived`; a sticker that cannot be given now 409 `sticker_archived` or
 * `sticker_not_available`.
 */
export const createClaimEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/clubs/:clubId/sticker-claims',
  access: 'actor',
  params: clubParams,
  body: createClaimBodySchema,
  response: claimSchema,
});

/** The club's codes: all of them for officers and full admins, a lead's own for a lead. */
export const listClaimsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/clubs/:clubId/sticker-claims',
  access: 'actor',
  params: clubParams,
  response: z.object({ claims: z.array(claimSchema) }),
});

const claimParams = z.object({ claimId: idSchema });

/** Stops a code at once. Closing one already closed answers 200 and changes nothing. */
export const closeClaimEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/sticker-claims/:claimId/close',
  access: 'actor',
  params: claimParams,
  response: claimSchema,
});

/**
 * The code to show on the screen right now. It is good for about a minute and the next one is
 * different, so a photo of it stops working. `refreshInSeconds` says when to ask again.
 */
export const claimCodeEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/sticker-claims/:claimId/code',
  access: 'actor',
  params: claimParams,
  response: z.object({ code: z.string(), refreshInSeconds: z.number().int().min(1) }),
});

export const CLAIM_CODE_PATTERN = /^[0-9a-f-]{36}\.[0-9a-z]{1,12}\.[A-Za-z0-9_-]{16}$/;

/**
 * Scanning a code: the caller gets the sticker once. 404 for a code that is wrong or too old
 * (nothing says which), 403 `claim_not_for_you` for someone outside the club or committee, 409
 * `claim_expired`, `claim_full`, `already_claimed`, `already_holds`, `sticker_archived`,
 * `sticker_not_available` or `sticker_sold_out`, and 429 when they try too fast.
 */
export const redeemClaimEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/me/sticker-claims/redeem',
  access: 'actor',
  body: z.strictObject({ code: z.string().regex(CLAIM_CODE_PATTERN) }),
  response: z.object({
    key: stickerKeySchema,
    custom: customStickerDefSchema.nullable(),
    title: z.string(),
    clubName: z.string(),
  }),
});

// ─── A sticker's numbers ──────────────────────────────────────

/** How a sticker is doing: for the leaders who may design stickers in its club. */
export const stickerStatsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/custom-stickers/:stickerId/stats',
  access: 'actor',
  params: stickerParams,
  response: z.object({
    heldBy: z.number().int().min(0),
    /** Of the club's active members. */
    percentOfMembers: z.number().int().min(0).max(100),
    /** Of the people holding it, how many per cent stuck it on their card. */
    placedPercent: z.number().int().min(0).max(100),
    /** The last six months of awards, oldest first, as `YYYY-MM`. */
    byMonth: z.array(z.object({ month: z.string(), count: z.number().int().min(0) })),
    /** Who gave it most, up to three. */
    givers: z.array(z.object({ name: z.string(), count: z.number().int().min(1) })),
  }),
});
