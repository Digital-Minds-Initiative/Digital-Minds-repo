import { defineRoute } from '@/server/http';
import { deleteMembershipType, updateMembershipType } from '@/server/modules/clubs';
import {
  deleteMembershipTypeEndpoint,
  updateMembershipTypeEndpoint,
} from '@/shared/contracts/clubs';

export const PATCH = defineRoute(updateMembershipTypeEndpoint, ({ actor, params, body }) =>
  updateMembershipType(actor, params.membershipTypeId, body),
);

export const DELETE = defineRoute(deleteMembershipTypeEndpoint, ({ actor, params, query }) =>
  deleteMembershipType(actor, params.membershipTypeId, query),
);
