import { defineRoute } from '@/server/http';
import { listPointTransactionRevisions } from '@/server/modules/points';
import { listPointTransactionRevisionsEndpoint } from '@/shared/contracts/points';

export const GET = defineRoute(listPointTransactionRevisionsEndpoint, ({ actor, params }) =>
  listPointTransactionRevisions(actor, params.transactionId),
);
