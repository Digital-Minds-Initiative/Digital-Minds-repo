import { defineRoute } from '@/server/http';
import { setMemberCommitteeRole } from '@/server/modules/permissions';
import { setCommitteeRoleEndpoint } from '@/shared/contracts/permissions';

export const PUT = defineRoute(setCommitteeRoleEndpoint, ({ actor, params, body }) =>
  setMemberCommitteeRole(actor, params.memberId, params.committeeId, body.role),
);
