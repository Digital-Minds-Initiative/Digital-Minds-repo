import { defineRoute, withCreatedOrReplayed } from '@/server/http';
import { addCommitteePointsBatch } from '@/server/modules/points';
import { committeePointsBulkEndpoint } from '@/shared/contracts/points';

export const POST = defineRoute(committeePointsBulkEndpoint, ({ actor, params, body }) =>
  addCommitteePointsBatch(actor, params.committeeId, body).then(withCreatedOrReplayed),
);
