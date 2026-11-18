import { defineRoute } from '@/server/http';
import { listMemberTypeHistory } from '@/server/modules/clubs';
import { listMemberTypeHistoryEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(listMemberTypeHistoryEndpoint, ({ actor, params, query }) =>
  listMemberTypeHistory(actor, params.memberId, query),
);
