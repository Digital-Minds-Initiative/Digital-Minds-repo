import { defineRoute } from '@/server/http';
import { redeemClaim } from '@/server/modules/cards';
import { redeemClaimEndpoint } from '@/shared/contracts/stickers';

export const POST = defineRoute(redeemClaimEndpoint, ({ actor, body }) =>
  redeemClaim(actor, body.code),
);
