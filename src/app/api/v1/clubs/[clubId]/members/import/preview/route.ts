import { defineRoute } from '@/server/http';
import { previewMemberImport } from '@/server/modules/members';
import { previewMemberImportEndpoint } from '@/shared/contracts/members-import';

export const POST = defineRoute(previewMemberImportEndpoint, ({ actor, params, body }) =>
  previewMemberImport(actor, params.clubId, body),
);
