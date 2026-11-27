import { defineRoute } from '@/server/http';
import { closeClaim } from '@/server/modules/cards';
import { closeClaimEndpoint } from '@/shared/contracts/stickers';

export const POST = defineRoute(closeClaimEndpoint, ({ actor, params }) =>
  closeClaim(actor, params.claimId),
);
