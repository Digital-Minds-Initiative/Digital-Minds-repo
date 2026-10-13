import { defineRoute } from '@/server/http';
import { archiveClub } from '@/server/modules/clubs';
import { archiveClubEndpoint } from '@/shared/contracts/clubs';

export const POST = defineRoute(archiveClubEndpoint, ({ actor, params }) =>
  archiveClub(actor, params.clubId),
);
