import { defineRoute } from '@/server/http';
import { setMemberClubRole } from '@/server/modules/permissions';
import { setClubRoleEndpoint } from '@/shared/contracts/permissions';

export const PUT = defineRoute(setClubRoleEndpoint, ({ actor, params, body }) =>
  setMemberClubRole(actor, params.memberId, body.role),
);
