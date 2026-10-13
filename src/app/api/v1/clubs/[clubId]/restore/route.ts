import { defineRoute } from '@/server/http';
import { restoreClub } from '@/server/modules/clubs';
import { restoreClubEndpoint } from '@/shared/contracts/clubs';

export const POST = defineRoute(restoreClubEndpoint, ({ actor, params }) =>
  restoreClub(actor, params.clubId),
);
