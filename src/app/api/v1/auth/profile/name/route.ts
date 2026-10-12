import { defineRoute, withSession } from '@/server/http';
import { completeName } from '@/server/modules/auth';
import { completeNameEndpoint } from '@/shared/contracts/auth';

export const POST = defineRoute(completeNameEndpoint, ({ body, client }) =>
  completeName(body, client).then(withSession),
);
