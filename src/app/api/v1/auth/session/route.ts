import { defineRoute } from '@/server/http';
import { getSessionState } from '@/server/modules/auth';
import { sessionStateEndpoint } from '@/shared/contracts/auth';

export const GET = defineRoute(sessionStateEndpoint, ({ client }) => getSessionState(client));
