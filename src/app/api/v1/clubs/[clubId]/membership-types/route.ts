import { defineRoute } from '@/server/http';
import { createMembershipType, listMembershipTypes } from '@/server/modules/clubs';
import {
  createMembershipTypeEndpoint,
  listMembershipTypesEndpoint,
} from '@/shared/contracts/clubs';

export const GET = defineRoute(listMembershipTypesEndpoint, ({ actor, params }) =>
  listMembershipTypes(actor, params.clubId),
);

export const POST = defineRoute(createMembershipTypeEndpoint, ({ actor, params, body }) =>
  createMembershipType(actor, params.clubId, body),
);
