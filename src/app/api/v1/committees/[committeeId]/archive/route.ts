import { defineRoute } from '@/server/http';
import { archiveCommittee } from '@/server/modules/clubs';
import { archiveCommitteeEndpoint } from '@/shared/contracts/clubs';

export const POST = defineRoute(archiveCommitteeEndpoint, ({ actor, params }) =>
  archiveCommittee(actor, params.committeeId),
);
