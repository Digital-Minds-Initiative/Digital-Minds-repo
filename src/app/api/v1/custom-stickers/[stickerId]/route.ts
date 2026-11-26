import { defineRoute } from '@/server/http';
import { changeSticker } from '@/server/modules/cards';
import { updateCustomStickerEndpoint } from '@/shared/contracts/stickers';

export const PATCH = defineRoute(updateCustomStickerEndpoint, ({ actor, params, body }) =>
  changeSticker(actor, params.stickerId, body),
);
