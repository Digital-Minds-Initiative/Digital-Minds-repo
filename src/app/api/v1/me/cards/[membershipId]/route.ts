import { defineRoute } from '@/server/http';
import { updateMyCard } from '@/server/modules/wallet';
import { updateMyCardEndpoint } from '@/shared/contracts/cards';

export const PATCH = defineRoute(updateMyCardEndpoint, ({ actor, params, body }) =>
  updateMyCard(actor, params.membershipId, body),
);
