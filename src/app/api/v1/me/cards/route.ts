import { defineRoute } from '@/server/http';
import { listMyCards } from '@/server/modules/wallet';
import { myCardsEndpoint } from '@/shared/contracts/wallet';

export const GET = defineRoute(myCardsEndpoint, ({ actor }) => listMyCards(actor));
