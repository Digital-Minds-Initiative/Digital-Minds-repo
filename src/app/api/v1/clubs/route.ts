import { defineRoute } from '@/server/http';
import { createClub, listClubs } from '@/server/modules/clubs';
import { createClubEndpoint, listClubsEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(listClubsEndpoint, ({ actor, query }) => listClubs(actor, query));

export const POST = defineRoute(createClubEndpoint, ({ actor, body }) => createClub(actor, body));
