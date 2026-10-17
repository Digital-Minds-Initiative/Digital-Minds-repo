import { defineRoute, withCreatedOrReplayed } from '@/server/http';
import { addClubPointsBatch } from '@/server/modules/points';
import { clubPointsBulkEndpoint } from '@/shared/contracts/points';

export const POST = defineRoute(clubPointsBulkEndpoint, ({ actor, params, body }) =>
  addClubPointsBatch(actor, params.clubId, body).then(withCreatedOrReplayed),
);
