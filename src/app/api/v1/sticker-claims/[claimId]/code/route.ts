import { defineRoute } from '@/server/http';
import { getClaimCode } from '@/server/modules/cards';
import { claimCodeEndpoint } from '@/shared/contracts/stickers';

export const GET = defineRoute(claimCodeEndpoint, ({ actor, params }) =>
  getClaimCode(actor, params.claimId),
);
