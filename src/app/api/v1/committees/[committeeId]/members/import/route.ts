import { defineRoute } from '@/server/http';
import { confirmCommitteeMemberImport } from '@/server/modules/members';
import { confirmCommitteeMemberImportEndpoint } from '@/shared/contracts/members-import';

export const POST = defineRoute(confirmCommitteeMemberImportEndpoint, ({ actor, params, body }) =>
  confirmCommitteeMemberImport(actor, params.committeeId, body),
);
