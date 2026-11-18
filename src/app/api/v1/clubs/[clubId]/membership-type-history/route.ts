import { defineRoute } from '@/server/http';
import { listClubMembershipTypeHistory } from '@/server/modules/clubs';
import { listClubMembershipTypeHistoryEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(listClubMembershipTypeHistoryEndpoint, ({ actor, params, query }) =>
  listClubMembershipTypeHistory(actor, params.clubId, query),
);
