import { defineRoute } from '@/server/http';
import { deleteCommittee } from '@/server/modules/deletions';
import { deleteCommitteeEndpoint } from '@/shared/contracts/deletions';

export const POST = defineRoute(deleteCommitteeEndpoint, ({ actor, params, body }) =>
  deleteCommittee(actor, params.committeeId, body),
);
