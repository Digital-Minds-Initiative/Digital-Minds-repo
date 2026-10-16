import { defineRoute } from '@/server/http';
import { getClubPermissions } from '@/server/modules/permissions';
import { listClubPermissionsEndpoint } from '@/shared/contracts/permissions';

export const GET = defineRoute(listClubPermissionsEndpoint, ({ actor, params }) =>
  getClubPermissions(actor, params.clubId),
);
