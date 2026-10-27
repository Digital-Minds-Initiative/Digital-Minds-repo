import { defineRoute } from '@/server/http';
import { previewCommitteeMemberImport } from '@/server/modules/members';
import { previewCommitteeMemberImportEndpoint } from '@/shared/contracts/members-import';

export const POST = defineRoute(previewCommitteeMemberImportEndpoint, ({ actor, params, body }) =>
  previewCommitteeMemberImport(actor, params.committeeId, body),
);
