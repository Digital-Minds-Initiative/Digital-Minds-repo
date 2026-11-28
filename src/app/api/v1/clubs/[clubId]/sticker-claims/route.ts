import { defineRoute } from '@/server/http';
import { createClaim, listClaims } from '@/server/modules/cards';
import { createClaimEndpoint, listClaimsEndpoint } from '@/shared/contracts/stickers';

export const GET = defineRoute(listClaimsEndpoint, ({ actor, params }) =>
  listClaims(actor, params.clubId),
);

export const POST = defineRoute(createClaimEndpoint, ({ actor, params, body }) =>
  createClaim(actor, params.clubId, body),
);
