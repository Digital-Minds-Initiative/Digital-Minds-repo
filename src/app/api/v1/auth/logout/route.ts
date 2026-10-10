import { defineRoute, withSession } from '@/server/http';
import { logout } from '@/server/modules/auth';
import { logoutEndpoint } from '@/shared/contracts/auth';

export const POST = defineRoute(logoutEndpoint, ({ client }) => logout(client).then(withSession));
