import { defineRoute } from '@/server/http';
import { revokeSticker } from '@/server/modules/cards';
import { revokeStickerEndpoint } from '@/shared/contracts/cards';

export const DELETE = defineRoute(revokeStickerEndpoint, async ({ actor, params }) => {
  await revokeSticker(actor, params.memberId, params.key);
});
