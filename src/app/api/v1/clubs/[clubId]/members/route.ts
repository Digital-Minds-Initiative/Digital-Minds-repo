import { defineRoute } from '@/server/http';
import { createMember } from '@/server/modules/members';
import { createMemberEndpoint } from '@/shared/contracts/members';

export const POST = defineRoute(createMemberEndpoint, ({ actor, params, body }) =>
  createMember(actor, params.clubId, body),
);
