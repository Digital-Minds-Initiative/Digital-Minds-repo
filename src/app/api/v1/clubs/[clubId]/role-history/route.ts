import { defineRoute } from '@/server/http';
import { listRoleHistory } from '@/server/modules/permissions';
import { listRoleHistoryEndpoint } from '@/shared/contracts/permissions';

export const GET = defineRoute(listRoleHistoryEndpoint, ({ actor, params, query }) =>
  listRoleHistory(actor, params.clubId, query),
);
