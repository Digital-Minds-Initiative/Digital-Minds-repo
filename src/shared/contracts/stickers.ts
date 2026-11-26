import { z } from 'zod';

import {
  CUSTOM_STICKER_LIMITS,
  STICKER_COLORS,
  STICKER_ICONS,
  STICKER_SHAPES,
} from '@/shared/lib/stickers';
import { collapseWhitespace } from '@/shared/lib/text';

import { defineEndpoint, idSchema, isoDateTimeSchema } from './core';
import { customStickerDefSchema } from './wallet';

/*
 * The sticker studio: stickers a club's leaders design themselves, with the colours, the icon, the
 * words and how to get them (docs/adr/0033-custom-stickers.md). Colours and icons are names from
 * the lists in src/shared/lib/stickers.ts, so a sticker can only ever look like the design system.
 */

const line = (max: number) =>
  z.string().transform(collapseWhitespace).pipe(z.string().min(1).max(max));

export const stickerAwardBySchema = z.enum(['LEAD', 'OFFICER']);

/** What a leader writes and picks. Every field is required on create; strict, so nothing is silently dropped. */
export const customStickerFieldsSchema = z.strictObject({
  name: line(CUSTOM_STICKER_LIMITS.name),
  howTo: line(CUSTOM_STICKER_LIMITS.howTo),
  label: line(CUSTOM_STICKER_LIMITS.label),
  icon: z.enum(STICKER_ICONS),
  shape: z.enum(STICKER_SHAPES),
  background: z.enum(STICKER_COLORS),
  ink: z.enum(STICKER_COLORS),
  hidden: z.boolean(),
  awardableBy: stickerAwardBySchema,
});
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
  body: customStickerFieldsSchema
    .partial()
    .extend({ archived: z.boolean().optional() })
    .refine((value) => Object.values(value).some((field) => field !== undefined), {
      message: 'at_least_one_field',
    }),
  response: studioStickerSchema,
});
