import { defineRoute } from '@/server/http';
import { deletePerson } from '@/server/modules/deletions';
import { deletePersonEndpoint } from '@/shared/contracts/deletions';

export const POST = defineRoute(deletePersonEndpoint, ({ actor, params, body }) =>
  deletePerson(actor, params.memberId, body),
);
