import { defineRoute } from '@/server/http';
import { confirmMemberImport } from '@/server/modules/members';
import { confirmMemberImportEndpoint } from '@/shared/contracts/members-import';

export const POST = defineRoute(confirmMemberImportEndpoint, ({ actor, params, body }) =>
  confirmMemberImport(actor, params.clubId, body),
);
