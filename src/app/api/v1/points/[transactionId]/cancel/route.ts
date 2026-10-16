import { defineRoute } from '@/server/http';
import { cancelPointTransaction } from '@/server/modules/points';
import { cancelPointTransactionEndpoint } from '@/shared/contracts/points';

export const POST = defineRoute(cancelPointTransactionEndpoint, ({ actor, params, body }) =>
  cancelPointTransaction(actor, params.transactionId, body),
);
