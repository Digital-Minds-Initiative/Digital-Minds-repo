import { defineRoute } from '@/server/http';
import { updateCommittee } from '@/server/modules/clubs';
import { updateCommitteeEndpoint } from '@/shared/contracts/clubs';

export const PATCH = defineRoute(updateCommitteeEndpoint, ({ actor, params, body }) =>
  updateCommittee(actor, params.committeeId, body),
);
