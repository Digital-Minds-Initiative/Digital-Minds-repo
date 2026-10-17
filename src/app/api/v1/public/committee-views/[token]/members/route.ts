import { defineRoute } from '@/server/http';
import { searchPublicCommitteeMembers } from '@/server/modules/clubs';
import { searchPublicCommitteeMembersEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(searchPublicCommitteeMembersEndpoint, ({ params, query, client }) =>
  searchPublicCommitteeMembers(params.token, query, client),
);
