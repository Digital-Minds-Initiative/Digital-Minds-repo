import { defineRoute } from '@/server/http';
import { createPointTransaction } from '@/server/modules/points';
import { createPointTransactionEndpoint } from '@/shared/contracts/points';

export const POST = defineRoute(createPointTransactionEndpoint, ({ actor, params, body }) =>
  createPointTransaction(actor, params.memberId, params.committeeId, body),
);
