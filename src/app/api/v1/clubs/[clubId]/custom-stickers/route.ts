import { defineRoute } from '@/server/http';
import { createSticker, listCustomStickers } from '@/server/modules/cards';
import {
  createCustomStickerEndpoint,
  listCustomStickersEndpoint,
} from '@/shared/contracts/stickers';

export const GET = defineRoute(listCustomStickersEndpoint, ({ actor, params, query }) =>
  listCustomStickers(actor, params.clubId, query.includeArchived),
);

export const POST = defineRoute(createCustomStickerEndpoint, ({ actor, params, body }) =>
  createSticker(actor, params.clubId, body),
);
