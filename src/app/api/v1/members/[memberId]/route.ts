import { defineRoute } from '@/server/http';
import { getMember, removeMember, updateMember } from '@/server/modules/members';
import {
  getMemberEndpoint,
  removeMemberEndpoint,
  updateMemberEndpoint,
} from '@/shared/contracts/members';

export const GET = defineRoute(getMemberEndpoint, ({ actor, params }) =>
  getMember(actor, params.memberId),
);

export const PATCH = defineRoute(updateMemberEndpoint, ({ actor, params, body }) =>
  updateMember(actor, params.memberId, body),
);

export const DELETE = defineRoute(removeMemberEndpoint, ({ actor, params }) =>
  removeMember(actor, params.memberId),
);
