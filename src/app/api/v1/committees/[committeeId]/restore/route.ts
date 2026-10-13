import { defineRoute } from '@/server/http';
import { restoreCommittee } from '@/server/modules/clubs';
import { restoreCommitteeEndpoint } from '@/shared/contracts/clubs';

export const POST = defineRoute(restoreCommitteeEndpoint, ({ actor, params }) =>
  restoreCommittee(actor, params.committeeId),
);
