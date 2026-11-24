import { defineRoute } from '@/server/http';
import { placeStickers } from '@/server/modules/wallet';
import { placeMyStickersEndpoint } from '@/shared/contracts/cards';

export const PUT = defineRoute(placeMyStickersEndpoint, ({ actor, params, body }) =>
  placeStickers(actor, params.membershipId, body.placements),
);
