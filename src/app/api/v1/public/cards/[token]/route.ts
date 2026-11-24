import { defineRoute } from '@/server/http';
import { getPublicCard } from '@/server/modules/cards';
import { publicCardEndpoint } from '@/shared/contracts/cards';

export const GET = defineRoute(publicCardEndpoint, ({ params, client }) =>
  getPublicCard(params.token, client),
);
