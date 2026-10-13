import { defineRoute } from '@/server/http';
import { updateClub } from '@/server/modules/clubs';
import { updateClubEndpoint } from '@/shared/contracts/clubs';

export const PATCH = defineRoute(updateClubEndpoint, ({ actor, params, body }) =>
  updateClub(actor, params.clubId, body),
);
