import { defineRoute } from '@/server/http';
import { getMe } from '@/server/modules/auth';
import { meEndpoint } from '@/shared/contracts/auth';

export const GET = defineRoute(meEndpoint, ({ actor }) => getMe(actor));
