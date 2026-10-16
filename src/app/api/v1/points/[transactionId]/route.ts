import { defineRoute } from '@/server/http';
import { updatePointTransaction } from '@/server/modules/points';
import { updatePointTransactionEndpoint } from '@/shared/contracts/points';

export const PATCH = defineRoute(updatePointTransactionEndpoint, ({ actor, params, body }) =>
  updatePointTransaction(actor, params.transactionId, body),
);
