import { defineRoute } from '@/server/http';
import { admitMember } from '@/server/modules/members';
import { admitMemberEndpoint } from '@/shared/contracts/members';

export const POST = defineRoute(admitMemberEndpoint, ({ actor, params, body }) =>
  admitMember(actor, params.committeeId, body),
);
