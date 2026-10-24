import { defineRoute } from '@/server/http';
import { deleteClub } from '@/server/modules/deletions';
import { deleteClubEndpoint } from '@/shared/contracts/deletions';

export const POST = defineRoute(deleteClubEndpoint, ({ actor, params }) =>
  deleteClub(actor, params.clubId),
);
