import { meEndpoint } from '@/modules/auth/contracts';
import { getMe } from '@/modules/auth/server';
import { defineRoute } from '@/server/http';

export const GET = defineRoute(meEndpoint, ({ actor }) => getMe(actor));
