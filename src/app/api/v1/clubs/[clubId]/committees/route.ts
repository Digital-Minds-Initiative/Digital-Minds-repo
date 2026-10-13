import { defineRoute } from '@/server/http';
import { createCommittee, listCommittees } from '@/server/modules/clubs';
import { createCommitteeEndpoint, listCommitteesEndpoint } from '@/shared/contracts/clubs';

export const GET = defineRoute(listCommitteesEndpoint, ({ actor, params, query }) =>
  listCommittees(actor, params.clubId, query),
);

export const POST = defineRoute(createCommitteeEndpoint, ({ actor, params, body }) =>
  createCommittee(actor, params.clubId, body),
);
