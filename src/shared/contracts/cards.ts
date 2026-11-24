import { z } from 'zod';

import { AWARDABLE_STICKER_KEYS, MAX_PLACED_STICKERS } from '@/shared/lib/stickers';

import { defineEndpoint, idSchema, isoDateSchema, isoDateTimeSchema } from './core';
import {
  cardToneSchema,
  memberCardSchema,
  stickerKeySchema,
  stickerPlacementSchema,
  walletPassParams,
} from './wallet';

/*
 * The member's own card: what colour it is, what its QR opens, and where the stickers lie — and the
 * page that QR opens, and the awards that fill the sticker tray (docs/adr/0032-card-link-and-stickers.md).
 */

// ─── The member's own choices ─────────────────────────────────

const shareChangesSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    showPoints: z.boolean().optional(),
    showActivity: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at_least_one_field',
  });

/**
 * Changes the colour of the card and what its QR page shows. The body is strict, so a field this
 * endpoint does not know is a 422 rather than silently dropped; `tone: null` goes back to the
 * colour the role gives.
 */
export const updateMyCardEndpoint = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/me/cards/:membershipId',
  access: 'actor',
  params: walletPassParams,
  body: z
    .strictObject({
      tone: cardToneSchema.nullable().optional(),
      share: shareChangesSchema.optional(),
    })
    .refine((value) => value.tone !== undefined || value.share !== undefined, {
      message: 'at_least_one_field',
    }),
  response: memberCardSchema,
});
export type UpdateMyCardBody = z.input<typeof updateMyCardEndpoint.body>;

/**
 * Replaces where the member's stickers lie: every sticker listed is placed, every one left out is
 * taken off the card. A sticker the member has not earned is a 422 (`sticker_not_earned`), so the
 * back of a card cannot claim anything it was not given.
 */
export const placeMyStickersEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/me/cards/:membershipId/stickers',
  access: 'actor',
  params: walletPassParams,
  body: z.strictObject({
    placements: z
      .array(stickerPlacementSchema)
      .max(MAX_PLACED_STICKERS)
      .refine((items) => new Set(items.map((item) => item.key)).size === items.length, {
        message: 'duplicate_sticker',
      }),
  }),
  response: memberCardSchema,
});

/** Makes a new link for the QR, so the old one stops working: for a link that went further than meant. */
export const renewCardLinkEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/me/cards/:membershipId/share-link',
  access: 'actor',
  params: walletPassParams,
  response: memberCardSchema,
});

// ─── Awards ───────────────────────────────────────────────────

export const awardableStickerSchema = z.enum(AWARDABLE_STICKER_KEYS);
const memberParams = z.object({ memberId: idSchema });

export const awardedStickerSchema = z.object({
  key: awardableStickerSchema,
  awardedAt: isoDateTimeSchema,
  /** Whether the caller may take it back: the same standing that lets them give it. */
  revocable: z.boolean(),
});

/**
 * The stickers a member was awarded (the ones a rule gives are worked out, not listed), and which
 * of the awardable ones the caller may still give them. Both follow what the caller may do: a lead
 * is not offered the founder sticker.
 */
export const listMemberStickersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/members/:memberId/stickers',
  access: 'actor',
  params: memberParams,
  response: z.object({
    awarded: z.array(awardedStickerSchema),
    awardable: z.array(awardableStickerSchema),
  }),
});

/**
 * Gives a member a sticker. Their club's officers and full admins may give any; the lead of a
 * committee the member is in, any but «عضو مؤسس». Nobody awards their own (403
 * `cannot_award_self`) unless they are a full admin. Awarding what the member already holds
 * answers 200 and changes nothing.
 */
export const awardStickerEndpoint = defineEndpoint({
  method: 'POST',
  path: '/api/v1/members/:memberId/stickers',
  access: 'actor',
  params: memberParams,
  body: z.strictObject({ key: awardableStickerSchema }),
  response: awardedStickerSchema,
});

/** Takes an awarded sticker back from a member. The ones a rule gives cannot be taken back. */
export const revokeStickerEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/members/:memberId/stickers/:key',
  access: 'actor',
  params: memberParams.extend({ key: awardableStickerSchema }),
  response: null,
});

// ─── The page the QR opens ────────────────────────────────────

/** 32 URL-safe characters (192 random bits), from a cryptographically secure source. */
export const cardTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

/** Where the public page lives, under APP_ORIGIN: `https://…/c/<token>`. */
export const CARD_LINK_PATH = '/c';

export const publicCardSchema = z.object({
  fullName: z.string(),
  club: z.object({ name: z.string(), slug: z.string() }),
  mood: z.enum(['tech', 'gem']),
  tone: cardToneSchema,
  /** What the person holds: «مسؤول النادي», «مسؤول لجنة …», or their membership type. */
  role: z.string(),
  hijriYear: z.number().int(),
  stampsTotal: z.number().int(),
  /** The next four are null when the member keeps their points to themselves. */
  points: z.number().int().nullable(),
  stampsEarned: z.number().int().nullable(),
  thisMonth: z.number().int().nullable(),
  /** The last six months, oldest first, as `YYYY-MM`. */
  monthly: z.array(z.object({ month: z.string(), points: z.number().int() })).nullable(),
  /** Every earned sticker, with where it lies if the member placed it. */
  stickers: z.array(
    z.object({ key: stickerKeySchema, placement: stickerPlacementSchema.nullable() }),
  ),
  /** The last few transactions, only if the member turned that on. */
  activity: z
    .array(z.object({ workDate: isoDateSchema, reason: z.string(), amount: z.number().int() }))
    .nullable(),
});
export type PublicCard = z.infer<typeof publicCardSchema>;

/**
 * Opened by the QR on someone's card. The token is the whole permission, so an unknown, renewed,
 * turned-off or removed one answers the same 404, and the page shows only what the member allowed:
 * never a contact detail, a committee's name list, or another person.
 */
export const publicCardEndpoint = defineEndpoint({
  method: 'GET',
  path: '/api/v1/public/cards/:token',
  access: 'public',
  params: z.object({ token: cardTokenSchema }),
  response: publicCardSchema,
});
