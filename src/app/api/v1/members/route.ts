import { listMembersEndpoint } from '@/modules/members/contracts';
import { listMembers } from '@/modules/members/server';
import { defineRoute } from '@/server/http';

/*
 * THE REFERENCE ROUTE HANDLER — copy this shape for every endpoint:
 *   contract (validates input and output) → service(actor, input) → response.
 * No business logic, no Prisma, no authorization checks here: the wrapper resolves the actor and
 * the service applies the actor's scope.
 */
export const GET = defineRoute(listMembersEndpoint, ({ actor, query }) =>
  listMembers(actor, query),
);
