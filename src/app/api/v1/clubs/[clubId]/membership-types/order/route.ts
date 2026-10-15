import { defineRoute } from '@/server/http';
import { reorderMembershipTypes } from '@/server/modules/clubs';
import { reorderMembershipTypesEndpoint } from '@/shared/contracts/clubs';

export const PUT = defineRoute(reorderMembershipTypesEndpoint, ({ actor, params, body }) =>
  reorderMembershipTypes(actor, params.clubId, body),
);
