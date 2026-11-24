import { defineRoute } from '@/server/http';
import { awardSticker, listMemberStickers } from '@/server/modules/cards';
import { awardStickerEndpoint, listMemberStickersEndpoint } from '@/shared/contracts/cards';

export const GET = defineRoute(listMemberStickersEndpoint, ({ actor, params }) =>
  listMemberStickers(actor, params.memberId),
);

export const POST = defineRoute(awardStickerEndpoint, ({ actor, params, body }) =>
  awardSticker(actor, params.memberId, body.key),
);
